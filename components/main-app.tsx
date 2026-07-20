"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { AccountGate } from "@/components/auth/account-gate";
import { CloudBackupScheduler } from "@/components/cloud-backup-scheduler";
import { MediaMaintenanceScheduler } from "@/components/media-maintenance-scheduler";
import { DesktopShell } from "./desktop-shell";
import { SplashAnimation } from "./splash-animation";
import { Capacitor } from "@capacitor/core";
import { runBackHandler } from "@/lib/back-handler";
import { MusicProvider } from "@/lib/music-context";
import { hydrateKvDb } from "@/lib/kv-db";
import { getThemeAssetMap, readThemeProfile } from "@/lib/theme-storage";
import { resolveActiveIconSkins, type ThemeProfile } from "@/lib/theme-types";
import { hasPendingMcpOAuthCallback } from "@/lib/tool-executor";

const TEXT = {
  loading: "\u52A0\u8F7D\u4E2D...",
};

const BUILTIN_FONT_URLS = [
  "/fonts/huiwen.woff2",
  "/fonts/huiwen.woff2",
  "/fonts/special-elite.woff2",
  "/fonts/splash/instrument-serif-regular-400.woff2",
  "/fonts/splash/instrument-serif-italic-400.woff2",
  "/fonts/splash/inter-300.woff2",
  "/fonts/splash/inter-400.woff2",
  "/fonts/splash/inter-500.woff2",
  "/fonts/splash/major-mono-display-400.woff2",
  "/fonts/splash/jetbrains-mono-300.woff2",
  "/fonts/splash/jetbrains-mono-400.woff2",
  "/fonts/interview/noto-serif-sc.woff2",
  "/fonts/interview/bodoni-moda.woff2",
  "/fonts/interview/bodoni-moda-italic.woff2",
  "/fonts/interview/eb-garamond.woff2",
  "/fonts/interview/eb-garamond-italic.woff2",
  "/fonts/interview/long-cang.woff2",
  "/fonts/interview/cinzel.woff2",
  "/fonts/interview/press-start-2p.woff2",
  "/fonts/notewall/ximai.woff2",
  "/fonts/notewall/xiaozhitiao.woff2",
  "/fonts/notewall/huiwen-upload.woff2",
  "/fonts/notewall/chen-yuluoyan-thin.woff2",
  "/fonts/game-hall/fredoka-400.woff2",
  "/fonts/game-hall/fredoka-500.woff2",
  "/fonts/game-hall/fredoka-600.woff2",
  "/fonts/game-hall/fredoka-700.woff2",
  "/fonts/game-hall/caveat-500.woff2",
  "/fonts/game-hall/caveat-700.woff2",
  "/fonts/game-hall/zen-maru-gothic-500.woff2",
  "/fonts/game-hall/zen-maru-gothic-700.woff2",
  "/fonts/game-hall/zen-maru-gothic-900.woff2",
  "/fonts/\u5B57\u4F53/MISANS-REGULAR.woff2",
  "/fonts/\u5B57\u4F53/MISANS-MEDIUM.woff2",
  "/fonts/\u5B57\u4F53/MISANS-SEMIBOLD.woff2",
] as const;

const BUILTIN_FONT_LOAD_SPECS = [
  '400 1em "Instrument Serif"',
  'italic 400 1em "Instrument Serif"',
  '300 1em "Inter"',
  '400 1em "Inter"',
  '500 1em "Inter"',
  '400 1em "Major Mono Display"',
  '300 1em "JetBrains Mono"',
  '400 1em "JetBrains Mono"',
  '400 1em "Huiwen"',
  '400 1em "Noto Serif SC"',
  '400 1em "Source Han Serif SC"',
  '400 1em "Bodoni Moda"',
  'italic 400 1em "Bodoni Moda"',
  '400 1em "EB Garamond"',
  'italic 400 1em "EB Garamond"',
  '400 1em "Long Cang"',
  '400 1em "Cinzel"',
  '400 1em "Press Start 2P"',
  '400 1em "Special Elite"',
  '400 1em "NoteWall Ximai"',
  '400 1em "NoteWall Xiaozhitiao"',
  '400 1em "NoteWall Huiwen"',
  '400 1em "Game Hall Fredoka"',
  '500 1em "Game Hall Fredoka"',
  '600 1em "Game Hall Fredoka"',
  '700 1em "Game Hall Fredoka"',
  '500 1em "Game Hall Caveat"',
  '700 1em "Game Hall Caveat"',
  '500 1em "Game Hall Zen Maru Gothic"',
  '700 1em "Game Hall Zen Maru Gothic"',
  '900 1em "Game Hall Zen Maru Gothic"',
  '400 1em "MiSans"',
  '500 1em "MiSans"',
  '600 1em "MiSans"',
] as const;

const FONT_CACHE_BATCH_SIZE = 3;
const FONT_CACHE_BATCH_DELAY_MS = 80;

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdleTask(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => { };
  }

  const idleWindow = window as WindowWithIdleCallback;
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(() => callback(), { timeout: 2400 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 600);
  return () => window.clearTimeout(handle);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function cacheFontUrl(url: string): Promise<void> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) return;
  await response.arrayBuffer();
}

async function warmBuiltinFonts(shouldStop: () => boolean): Promise<void> {
  if (typeof window === "undefined") return;

  for (let index = 0; index < BUILTIN_FONT_URLS.length; index += FONT_CACHE_BATCH_SIZE) {
    if (shouldStop()) return;
    const batch = BUILTIN_FONT_URLS.slice(index, index + FONT_CACHE_BATCH_SIZE);
    await Promise.all(batch.map((url) => cacheFontUrl(url).catch(() => undefined)));
    if (shouldStop()) return;
    await wait(FONT_CACHE_BATCH_DELAY_MS);
  }

  if (shouldStop() || !document.fonts) return;
  await Promise.all(BUILTIN_FONT_LOAD_SPECS.map((spec) => document.fonts.load(spec).catch(() => [])));
}

// 筑境（World Builder）用整页硬跳转打开/返回（见 desktop-shell.tsx 里 openWorldBuilder
// 的说明），每次硬跳转都会让这个 SPA 重新从零启动一次，导致返回后又看到一遍开屏动画、
// 还要再上滑一次才能进去。sessionStorage 在同一个 WebView 会话内的硬跳转之间是保留的，
// 用它记一次「本次会话已经进过」，返回时就跳过开屏动画。
// 首帧的隐藏由 app/layout.tsx 里的同步内联脚本 + styles/base.css 的 html.boot-skip 负责。
const BOOT_ENTERED_SESSION_KEY = "float-boot-entered";

function hasEnteredThisSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(BOOT_ENTERED_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markEnteredThisSession(): void {
  try {
    window.sessionStorage.setItem(BOOT_ENTERED_SESSION_KEY, "1");
  } catch {
    /* 隐私模式下 sessionStorage 可能不可写，失败就退回每次都显示开屏。 */
  }
}

/** 在桌面上再按一次返回就退出的时间窗。 */
const EXIT_CONFIRM_WINDOW_MS = 2000;
const EXIT_HINT_ID = "app-exit-hint";

/** 轻量提示。这里在 DesktopShell 之外，拿不到它的 notice，所以自己挂一个。 */
function showExitHint(): void {
  if (document.getElementById(EXIT_HINT_ID)) return;
  const hint = document.createElement("div");
  hint.id = EXIT_HINT_ID;
  hint.textContent = "再按一次退出";
  hint.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:calc(64px + env(safe-area-inset-bottom,0px))",
    "transform:translateX(-50%)",
    "z-index:99999",
    "padding:9px 18px",
    "border-radius:999px",
    "background:rgba(0,0,0,0.76)",
    "color:#fff",
    "font-size:13px",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity .18s",
  ].join(";");
  document.body.appendChild(hint);
  requestAnimationFrame(() => { hint.style.opacity = "1"; });
  window.setTimeout(() => {
    hint.style.opacity = "0";
    window.setTimeout(() => hint.remove(), 220);
  }, EXIT_CONFIRM_WINDOW_MS - 300);
}

function SplashScreen({ ready = false, onEnter }: { ready?: boolean; onEnter?: () => void }) {
  return (
    <main className="app-root splash-root">
      <section
        className="phone-shell-wrap splash-shell-wrap"
        aria-label={TEXT.loading}
      >
        <div className="phone-case">
          <div className="phone-frame">
            <div className="phone-shell splash-phone-screen">
              <SplashAnimation />
              <button
                type="button"
                className={ready ? "splash-enter-button splash-enter-button-show" : "splash-enter-button"}
                onClick={onEnter}
                disabled={!ready}
                aria-label="Enter"
              >
                <ArrowRight size={18} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

type PreparedDesktopTheme = {
  profile: ThemeProfile;
  assets: Record<string, string>;
};

function collectFirstPaintThemeAssetIds(profile: ThemeProfile): string[] {
  const ids = [
    profile.wallpaperAssetId,
    profile.fontAssetId,
    profile.dockSkinAssetId,
    ...Object.values(resolveActiveIconSkins(profile))
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(ids));
}

function preloadImageDataUrl(url: string): Promise<void> {
  if (typeof window === "undefined" || !url.startsWith("data:image/")) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const image = new Image();
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (typeof image.decode === "function") {
        void image.decode().catch(() => undefined).finally(resolve);
        return;
      }
      resolve();
    };
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
    if (image.complete) {
      finish();
    }
  });
}

async function prepareDesktopThemeForFirstPaint(): Promise<PreparedDesktopTheme> {
  const profile = readThemeProfile();
  const assetIds = collectFirstPaintThemeAssetIds(profile);
  const assets = assetIds.length ? await getThemeAssetMap(assetIds) : {};
  await Promise.all(Object.values(assets).map(preloadImageDataUrl));
  return { profile, assets };
}

export function MainApp() {
  const [preparedDesktopTheme, setPreparedDesktopTheme] = useState<PreparedDesktopTheme | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [splashDismissed, setSplashDismissed] = useState(() => hasEnteredThisSession());

  // 安卓返回 / 左滑手势。
  // 这个应用用 React state 导航，不压 History，所以 webView.canGoBack() 恒为 false，
  // Capacitor 的默认行为是直接 finish Activity —— 也就是从任何界面一划就退出整个 APP。
  // 改成：先交给返回栈里最上层的界面处理，栈空（已在桌面）时才是双击退出。
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let detach: (() => void) | undefined;
    let cancelled = false;
    let lastPressAt = 0;

    void (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("backButton", () => {
        if (runBackHandler()) return;

        const now = Date.now();
        if (now - lastPressAt < EXIT_CONFIRM_WINDOW_MS) {
          void App.exitApp();
          return;
        }
        lastPressAt = now;
        showExitHint();
      });
      if (cancelled) void handle.remove();
      else detach = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await hydrateKvDb();
      if (cancelled) return;

      let nextPreparedTheme: PreparedDesktopTheme | null = null;
      try {
        nextPreparedTheme = await prepareDesktopThemeForFirstPaint();
      } catch (error) {
        console.warn("[MainApp] desktop theme preload failed:", error);
      }

      if (cancelled) return;
      setPreparedDesktopTheme(nextPreparedTheme);
      setHydrated(true);
      if (hasPendingMcpOAuthCallback()) {
        setSplashDismissed(true);
      }
    })();

    // 安卓全屏兜底：点击屏幕进入全屏模式（iOS 不支持此 API，会自动忽略）
    const isMobile = window.matchMedia("(max-width: 500px) and (hover: none) and (pointer: coarse)").matches;
    // Edge 改用 minimal-ui 保留原生状态栏，不能再被强制全屏顶掉（仅 Edge 跳过，其它浏览器照旧）
    const isEdge = /Edg/i.test(navigator.userAgent);
    if (!isMobile || isEdge) return () => {
      cancelled = true;
    };

    function tryFullscreen() {
      const doc = document.documentElement;
      if (document.fullscreenElement) return;
      doc.requestFullscreen?.().catch(() => { });
    }
    // 每次点击都尝试进入全屏（退出后可重新进入）
    document.addEventListener("click", tryFullscreen);
    return () => {
      cancelled = true;
      document.removeEventListener("click", tryFullscreen);
    };
  }, []);

  return (
    <AccountGate>
      {!splashDismissed ? (
        <SplashScreen ready={hydrated} onEnter={() => { markEnteredThisSession(); setSplashDismissed(true); }} />
      ) : (
        <main className="app-root">
          <MusicProvider>
            <DesktopShell
              initialThemeProfile={preparedDesktopTheme?.profile}
              initialThemeAssets={preparedDesktopTheme?.assets}
            />
            <CloudBackupScheduler />
            <MediaMaintenanceScheduler />
          </MusicProvider>
        </main>
      )}
    </AccountGate>
  );
}
