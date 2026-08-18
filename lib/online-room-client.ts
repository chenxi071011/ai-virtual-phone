// 联机房间客户端：房间元数据走自己的服务端路由（登录/封禁/准入校验），
// 房内消息走浏览器直连 Supabase Realtime（broadcast + presence，不落库）。
// 自定义 APP 桥与游戏大厅桥共用这一份实现。

import { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";

import { fetchCurrentAccount, type AccountProfile } from "./account-client";

export type OnlineRoomInfo = {
  id: string;
  code: string;
  channel: string;
  namespace: string;
  hostUserId: string;
  hostName: string;
  title: string;
  maxPlayers: number;
  meta: Record<string, unknown>;
  isHost: boolean;
  createdAt: string;
};

export type OnlineRoomPlayer = {
  userId: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
};

export type OnlineRoomEvents = {
  onMessage?: (message: { from: { userId: string; name: string }; payload: unknown; sentAt: number }) => void;
  onPlayers?: (players: OnlineRoomPlayer[]) => void;
  onState?: (state: Record<string, unknown>) => void;
  onClosed?: (reason: "host_closed" | "host_left" | "kicked" | "connection_lost") => void;
};

type OnlineConfig = { supabaseUrl: string; anonKey: string };

const HOST_LEAVE_GRACE_MS = 30_000;
// 玩家瞬断宽限：iOS Safari 锁屏/切后台会挂起 WebSocket，presence 短暂消失后又回来。
// 宽限期内不把"离开"上报给应用——否则应用会把重连的原局玩家当新人处理（狼人杀踢人事故）。
const PEER_LEAVE_GRACE_MS = 20_000;
const STATE_REBROADCAST_DEBOUNCE_MS = 600;
const SEND_WINDOW_MS = 1000;
const SEND_WINDOW_MAX = 25;
const MAX_PAYLOAD_CHARS = 16_000;

let _configPromise: Promise<OnlineConfig | null> | null = null;

async function fetchOnlineConfig(): Promise<OnlineConfig | null> {
  if (!_configPromise) {
    _configPromise = (async () => {
      try {
        const response = await fetch("/api/online/config", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as {
          configured?: boolean; supabaseUrl?: string; anonKey?: string;
        };
        if (data.configured && data.supabaseUrl && data.anonKey) {
          return { supabaseUrl: data.supabaseUrl, anonKey: data.anonKey };
        }
        return null;
      } catch {
        _configPromise = null;
        return null;
      }
    })();
  }
  return _configPromise;
}

export async function isOnlinePlayAvailable(): Promise<boolean> {
  return (await fetchOnlineConfig()) !== null;
}

async function requireAccount(): Promise<AccountProfile> {
  const result = await fetchCurrentAccount();
  if (!result.ok || !result.account) throw new Error("联机功能需要先登录账号。");
  if (result.account.status === "disabled") throw new Error("当前账号已被停用。");
  return result.account;
}

async function roomApi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/online/rooms", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) {
    throw new Error(String(data.error ?? `联机房间接口失败（HTTP ${response.status}）`));
  }
  return data;
}

/** 一个已连接的联机房间。用完必须调用 leave()（宿主在 APP/游戏关闭时兜底）。 */
export class OnlineRoomConnection {
  readonly info: OnlineRoomInfo;
  readonly selfUserId: string;
  readonly selfName: string;

  private client: RealtimeClient;
  private channel: RealtimeChannel;
  private events: OnlineRoomEvents;
  private playersMap = new Map<string, OnlineRoomPlayer>();
  private currentState: Record<string, unknown> = {};
  private hostLeaveTimer: number | null = null;
  private stateRebroadcastTimer: number | null = null;
  private sendTimestamps: number[] = [];
  private closed = false;
  // 瞬断宽限：presence 里暂时消失的玩家 → 定时器；宽限内回来就取消，不惊动应用
  private pendingLeaveTimers = new Map<string, number>();
  private rawPresentIds = new Set<string>();
  private selfPresencePayload: { userId: string; name: string; isHost: boolean; joinedAt: number } | null = null;
  private visibilityHandler: (() => void) | null = null;

  private constructor(input: {
    info: OnlineRoomInfo;
    account: AccountProfile;
    client: RealtimeClient;
    channel: RealtimeChannel;
    events: OnlineRoomEvents;
  }) {
    this.info = input.info;
    this.selfUserId = input.account.id;
    this.selfName = input.account.displayName || input.account.username;
    this.client = input.client;
    this.channel = input.channel;
    this.events = input.events;
  }

  static async create(input: {
    namespace: string;
    title?: string;
    maxPlayers?: number;
    meta?: Record<string, unknown>;
  }, events: OnlineRoomEvents = {}): Promise<OnlineRoomConnection> {
    const account = await requireAccount();
    const data = await roomApi({
      action: "create",
      namespace: input.namespace,
      title: input.title ?? "",
      maxPlayers: input.maxPlayers ?? 8,
      meta: input.meta ?? {},
    });
    return OnlineRoomConnection.connect(data.room as OnlineRoomInfo, account, events);
  }

  static async join(input: { namespace: string; code: string }, events: OnlineRoomEvents = {}): Promise<OnlineRoomConnection> {
    const account = await requireAccount();
    const data = await roomApi({ action: "join", namespace: input.namespace, code: input.code });
    return OnlineRoomConnection.connect(data.room as OnlineRoomInfo, account, events);
  }

  private static async connect(
    info: OnlineRoomInfo,
    account: AccountProfile,
    events: OnlineRoomEvents,
  ): Promise<OnlineRoomConnection> {
    const config = await fetchOnlineConfig();
    if (!config) throw new Error("站点未配置联机（缺少 SUPABASE_ANON_KEY）。");

    const realtimeUrl = `${config.supabaseUrl.replace(/^http/, "ws")}/realtime/v1`;
    const client = new RealtimeClient(realtimeUrl, {
      params: { apikey: config.anonKey },
      heartbeatIntervalMs: 25_000,
    });
    const channel = client.channel(info.channel, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: account.id },
      },
    });

    const connection = new OnlineRoomConnection({ info, account, client, channel, events });
    connection.wireChannel();

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("连接联机服务超时。")), 15_000);
      channel.subscribe(async (status, err) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(timeout);
          try {
            connection.selfPresencePayload = {
              userId: account.id,
              name: account.displayName || account.username,
              isHost: info.isHost,
              joinedAt: Date.now(),
            };
            await channel.track(connection.selfPresencePayload);
            resolve();
          } catch (trackErr) {
            reject(trackErr instanceof Error ? trackErr : new Error(String(trackErr)));
          }
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          window.clearTimeout(timeout);
          reject(new Error(err?.message || "联机通道连接失败。"));
        }
      });
    }).catch(err => {
      connection.teardown();
      throw err;
    });

    // 满员校验：presence 同步后如果除自己外已达上限，退房
    if (!info.isHost) {
      await connection.waitForFirstSync();
      const others = connection.players().filter(player => player.userId !== account.id);
      if (others.length >= info.maxPlayers) {
        connection.teardown();
        throw new Error("房间已满。");
      }
    }

    return connection;
  }

  private firstSyncResolve: (() => void) | null = null;
  private firstSyncDone = false;

  private waitForFirstSync(): Promise<void> {
    if (this.firstSyncDone) return Promise.resolve();
    return new Promise(resolve => {
      this.firstSyncResolve = resolve;
      window.setTimeout(() => { this.firstSyncDone = true; resolve(); }, 3000);
    });
  }

  private wireChannel(): void {
    this.channel.on("presence", { event: "sync" }, () => {
      const state = this.channel.presenceState<{ userId: string; name: string; isHost: boolean; joinedAt: number }>();
      this.rawPresentIds = new Set<string>();
      let changed = false;
      let rejoined = false;
      for (const presences of Object.values(state)) {
        for (const presence of presences) {
          if (!presence.userId) continue;
          this.rawPresentIds.add(presence.userId);
          // 瞬断的玩家回来了：取消离开宽限，不惊动应用（但要给 TA 补发状态）
          const pending = this.pendingLeaveTimers.get(presence.userId);
          if (pending !== undefined) {
            window.clearTimeout(pending);
            this.pendingLeaveTimers.delete(presence.userId);
            rejoined = true;
          }
          if (!this.playersMap.has(presence.userId)) changed = true;
          this.playersMap.set(presence.userId, {
            userId: presence.userId,
            name: presence.name || "玩家",
            isHost: presence.userId === this.info.hostUserId,
            joinedAt: Number(presence.joinedAt) || this.playersMap.get(presence.userId)?.joinedAt || Date.now(),
          });
        }
      }
      // presence 里消失的玩家：进入宽限期（iOS 挂起重连的常态），到点仍未回来才真正移除
      for (const userId of this.playersMap.keys()) {
        if (this.rawPresentIds.has(userId) || this.pendingLeaveTimers.has(userId)) continue;
        const timer = window.setTimeout(() => {
          this.pendingLeaveTimers.delete(userId);
          if (this.closed || this.rawPresentIds.has(userId)) return;
          this.playersMap.delete(userId);
          this.watchHostPresence();
          this.events.onPlayers?.(this.players());
        }, PEER_LEAVE_GRACE_MS);
        this.pendingLeaveTimers.set(userId, timer);
      }
      if (!this.firstSyncDone) {
        this.firstSyncDone = true;
        this.firstSyncResolve?.();
      }
      this.watchHostPresence();
      if (changed) this.events.onPlayers?.(this.players());
      // 房主：有人进来（或瞬断重连）后补发一次权威状态（去抖，避免连环重发）——
      // 重连玩家靠这份快照找回挂起期间错过的状态
      if (this.info.isHost && (changed || rejoined) && Object.keys(this.currentState).length > 0) {
        this.scheduleStateRebroadcast();
      }
    });

    // iOS 锁屏/切后台会挂起 WebSocket；页面恢复可见时立即重连 + 重报 presence，
    // 把"掉线窗口"压到最短（不然要等下一个心跳周期才发现连接死了）
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState !== "visible" || this.closed) return;
        try {
          this.client.connect();
          if (this.selfPresencePayload) void this.channel.track(this.selfPresencePayload).catch(() => {});
        } catch { /* 尽力而为 */ }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    this.channel.on("broadcast", { event: "msg" }, ({ payload }) => {
      const record = payload as { from?: { userId?: string; name?: string }; payload?: unknown; sentAt?: number };
      if (!record?.from?.userId || record.from.userId === this.selfUserId) return;
      this.events.onMessage?.({
        from: { userId: String(record.from.userId), name: String(record.from.name ?? "玩家") },
        payload: record.payload,
        sentAt: Number(record.sentAt) || Date.now(),
      });
    });

    this.channel.on("broadcast", { event: "state" }, ({ payload }) => {
      const record = payload as { state?: Record<string, unknown>; from?: string };
      // 只认房主发出的权威状态
      if (record?.from !== this.info.hostUserId || !record.state || typeof record.state !== "object") return;
      this.currentState = record.state;
      this.events.onState?.(this.currentState);
    });

    this.channel.on("broadcast", { event: "kick" }, ({ payload }) => {
      const record = payload as { userId?: string; from?: string };
      if (record?.from !== this.info.hostUserId) return;
      if (record.userId === this.selfUserId) {
        this.finish("kicked");
      }
    });

    this.channel.on("broadcast", { event: "closed" }, ({ payload }) => {
      const record = payload as { from?: string };
      if (record?.from !== this.info.hostUserId) return;
      this.finish("host_closed");
    });
  }

  private watchHostPresence(): void {
    if (this.info.isHost) return;
    const hostPresent = this.playersMap.has(this.info.hostUserId);
    if (hostPresent) {
      if (this.hostLeaveTimer !== null) {
        window.clearTimeout(this.hostLeaveTimer);
        this.hostLeaveTimer = null;
      }
      return;
    }
    if (this.hostLeaveTimer !== null || this.closed) return;
    this.hostLeaveTimer = window.setTimeout(() => {
      this.hostLeaveTimer = null;
      if (!this.playersMap.has(this.info.hostUserId)) this.finish("host_left");
    }, HOST_LEAVE_GRACE_MS);
  }

  private scheduleStateRebroadcast(): void {
    if (this.stateRebroadcastTimer !== null) return;
    this.stateRebroadcastTimer = window.setTimeout(() => {
      this.stateRebroadcastTimer = null;
      if (this.closed) return;
      void this.channel.send({
        type: "broadcast",
        event: "state",
        payload: { state: this.currentState, from: this.selfUserId },
      });
    }, STATE_REBROADCAST_DEBOUNCE_MS);
  }

  players(): OnlineRoomPlayer[] {
    return [...this.playersMap.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  state(): Record<string, unknown> {
    return this.currentState;
  }

  private assertSendable(payload: unknown): void {
    if (this.closed) throw new Error("房间连接已关闭。");
    const serialized = JSON.stringify(payload ?? null);
    if (serialized.length > MAX_PAYLOAD_CHARS) {
      throw new Error(`消息过大（上限 ${MAX_PAYLOAD_CHARS} 字符）。`);
    }
    const now = Date.now();
    this.sendTimestamps = this.sendTimestamps.filter(ts => now - ts < SEND_WINDOW_MS);
    if (this.sendTimestamps.length >= SEND_WINDOW_MAX) {
      throw new Error(`发送太频繁（每秒上限 ${SEND_WINDOW_MAX} 条）。`);
    }
    this.sendTimestamps.push(now);
  }

  async send(payload: unknown): Promise<void> {
    this.assertSendable(payload);
    await this.channel.send({
      type: "broadcast",
      event: "msg",
      payload: { from: { userId: this.selfUserId, name: this.selfName }, payload, sentAt: Date.now() },
    });
  }

  /** 房主权威状态：整份替换并广播；新进玩家自动收到最新一份。 */
  async setState(state: Record<string, unknown>): Promise<void> {
    if (!this.info.isHost) throw new Error("只有房主可以写房间状态。");
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("state 必须是对象。");
    this.assertSendable(state);
    this.currentState = state;
    this.events.onState?.(this.currentState);
    await this.channel.send({
      type: "broadcast",
      event: "state",
      payload: { state, from: this.selfUserId },
    });
  }

  async kick(userId: string): Promise<void> {
    if (!this.info.isHost) throw new Error("只有房主可以踢人。");
    const target = String(userId ?? "").trim();
    if (!target || target === this.selfUserId) throw new Error("userId 无效。");
    await roomApi({ action: "kick", namespace: this.info.namespace, roomId: this.info.id, userId: target });
    await this.channel.send({ type: "broadcast", event: "kick", payload: { userId: target, from: this.selfUserId } });
  }

  async close(): Promise<void> {
    if (!this.info.isHost) throw new Error("只有房主可以关闭房间。");
    await roomApi({ action: "close", namespace: this.info.namespace, roomId: this.info.id }).catch(() => undefined);
    await this.channel.send({ type: "broadcast", event: "closed", payload: { from: this.selfUserId } }).catch(() => undefined);
    this.finish("host_closed", { silent: true });
  }

  leave(): void {
    if (this.info.isHost) {
      // 房主直接离开视为关房（异步尽力通知，不阻塞卸载路径）
      void roomApi({ action: "close", namespace: this.info.namespace, roomId: this.info.id }).catch(() => undefined);
      void this.channel.send({ type: "broadcast", event: "closed", payload: { from: this.selfUserId } }).catch(() => undefined);
    }
    this.teardown();
  }

  private finish(reason: "host_closed" | "host_left" | "kicked" | "connection_lost", options?: { silent?: boolean }): void {
    if (this.closed) return;
    this.teardown();
    if (!options?.silent) this.events.onClosed?.(reason);
  }

  private teardown(): void {
    this.closed = true;
    if (this.hostLeaveTimer !== null) window.clearTimeout(this.hostLeaveTimer);
    if (this.stateRebroadcastTimer !== null) window.clearTimeout(this.stateRebroadcastTimer);
    for (const timer of this.pendingLeaveTimers.values()) window.clearTimeout(timer);
    this.pendingLeaveTimers.clear();
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    try { void this.channel.unsubscribe(); } catch { /* noop */ }
    try { this.client.disconnect(); } catch { /* noop */ }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

// ── 异步共享文档（cloud 层）──

export async function onlineCloudApi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/online/docs", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) {
    throw new Error(String(data.error ?? `云端共享数据接口失败（HTTP ${response.status}）`));
  }
  return data;
}
