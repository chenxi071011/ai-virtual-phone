import { kvGet, kvSet, registerKvMigration } from "./kv-db";

/**
 * 应用时钟：让整个小手机活在用户自定的时间里。
 *
 * 存的是**与真实时间的差值**，不是某个固定时刻——所以时间照样自然流逝，
 * 关掉 APP 一天再打开，自定义时间也过了一天。
 *
 * 只有「内容时间戳」和「显示当前时刻」该走这里：消息/动态的 createdAt、
 * 注入给 AI 的时间、桌面时钟。**基础设施一律继续用 Date.now()**——
 * ID 生成、缓存 TTL、轮询间隔、setTimeout 延时、跟服务器时间的比对，
 * 这些被偏移会出错。
 *
 * 一条铁律：拿「现在」去减一个存下来的内容时间戳时，必须用 appNowMs()。
 * 混用（Date.now() 减虚拟时间戳）会整整差一个偏移量。
 */

const CLOCK_KEY = "ai_phone_custom_clock_v1";
registerKvMigration(CLOCK_KEY);

export const APP_CLOCK_UPDATED_EVENT = "app-clock-updated";

export type AppClockConfig = {
    /** 关闭时 offsetMs 一律按 0 处理，但保留数值，方便再次打开时沿用上次设定。 */
    enabled: boolean;
    /** 自定义时间 − 真实时间，毫秒。可正可负。 */
    offsetMs: number;
};

const DEFAULT_CONFIG: AppClockConfig = { enabled: false, offsetMs: 0 };

// 按原始字符串记忆化，不缓存「读到的结果」本身。
//
// kvGet 只读 kv-db 的内存 Map，而那个 Map 是异步的 hydrateKvDb() 填的；水合完成前
// 一律返回 null。appNow() 在启动极早期就会被调用，要是把那次的 null 当成「用户没开」
// 存下来，配置就再也读不回来了——表现为一进 APP 自定义时间自己关了，而且下次拨动
// 开关时还会拿这份空配置把磁盘上真实的偏移量覆盖掉。
//
// 每次都读一次 Map（就是一次 Map.get，很便宜），只有内容真的变了才重新 JSON.parse，
// 这样水合一完成就自动跟上。
let cachedRaw: string | null = null;
let cachedConfig: AppClockConfig = DEFAULT_CONFIG;
let cachedValid = false;

function readConfig(): AppClockConfig {
    if (typeof window === "undefined") return DEFAULT_CONFIG;
    const raw = kvGet(CLOCK_KEY);
    if (cachedValid && raw === cachedRaw) return cachedConfig;
    cachedRaw = raw;
    cachedValid = true;
    try {
        const parsed = raw ? JSON.parse(raw) : null;
        cachedConfig = parsed && typeof parsed === "object"
            ? {
                enabled: parsed.enabled === true,
                offsetMs: Number.isFinite(parsed.offsetMs) ? Number(parsed.offsetMs) : 0,
            }
            : DEFAULT_CONFIG;
    } catch {
        cachedConfig = DEFAULT_CONFIG;
    }
    return cachedConfig;
}

export function loadAppClockConfig(): AppClockConfig {
    return { ...readConfig() };
}

export function saveAppClockConfig(config: AppClockConfig): void {
    if (typeof window === "undefined") return;
    const next: AppClockConfig = {
        enabled: config.enabled === true,
        offsetMs: Number.isFinite(config.offsetMs) ? Number(config.offsetMs) : 0,
    };
    const serialized = JSON.stringify(next);
    cachedRaw = serialized;
    cachedConfig = next;
    cachedValid = true;
    kvSet(CLOCK_KEY, serialized);
    window.dispatchEvent(new CustomEvent(APP_CLOCK_UPDATED_EVENT, { detail: next }));
}

/** 关闭状态下恒为 0，所以所有调用点在没开这个功能时行为与改造前完全一致。 */
export function getAppClockOffsetMs(): number {
    const config = readConfig();
    return config.enabled ? config.offsetMs : 0;
}

export function isAppClockCustom(): boolean {
    return getAppClockOffsetMs() !== 0;
}

/** 应用时钟的当前毫秒数。等价于 Date.now() + 偏移。 */
export function appNowMs(): number {
    return Date.now() + getAppClockOffsetMs();
}

/** 应用时钟的当前时刻。 */
export function appNow(): Date {
    return new Date(appNowMs());
}

/** 内容时间戳统一用它，别再写 new Date().toISOString()。 */
export function appNowISO(): string {
    return appNow().toISOString();
}

/** 由目标时刻算出该存的偏移量（设置页选完时间后调用）。 */
export function offsetFromTargetTime(target: Date): number {
    return target.getTime() - Date.now();
}

/** 缓存失效——跨标签页改了配置时用。 */
export function invalidateAppClockCache(): void {
    cachedValid = false;
    cachedRaw = null;
}

if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
        if (event.key === CLOCK_KEY) invalidateAppClockCache();
    });
}
