"use client";

import { useEffect } from "react";

import { getRuntimePwaDisplayMode, readPwaDisplayPreference, PWA_DISPLAY_MODE_CHANGED_EVENT } from "@/lib/pwa-display-mode";

export function PWAManifestInjector() {
  useEffect(() => {
    const root = document.documentElement;
    const displayModeQueries = ["fullscreen", "standalone", "minimal-ui"].map(mode => (
      window.matchMedia(`(display-mode: ${mode})`)
    ));

    const syncRuntimeDisplayMode = () => {
      // 只有用户显式选了「显示系统状态栏」才挂运行时标记。iOS 装到桌面的 PWA 永远
      // 报 standalone（不支持 fullscreen），无门控会让所有 iOS 用户静默丢失虚拟状态栏。
      if (readPwaDisplayPreference(document.cookie) === "standalone") {
        root.dataset.pwaDisplayMode = getRuntimePwaDisplayMode();
      } else {
        delete root.dataset.pwaDisplayMode;
      }
    };

    const refreshManifest = () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) return;
      const base = (link.getAttribute("href") || "/manifest.webmanifest").split("?")[0];
      link.setAttribute("href", `${base}?v=${Date.now()}`);
    };

    const handleSettingsChanged = () => {
      syncRuntimeDisplayMode();
      refreshManifest();
    };

    syncRuntimeDisplayMode();
    refreshManifest();
    document.addEventListener("fullscreenchange", syncRuntimeDisplayMode);
    window.addEventListener("pageshow", syncRuntimeDisplayMode);
    window.addEventListener(PWA_DISPLAY_MODE_CHANGED_EVENT, handleSettingsChanged);
    displayModeQueries.forEach(query => query.addEventListener("change", syncRuntimeDisplayMode));

    return () => {
      document.removeEventListener("fullscreenchange", syncRuntimeDisplayMode);
      window.removeEventListener("pageshow", syncRuntimeDisplayMode);
      window.removeEventListener(PWA_DISPLAY_MODE_CHANGED_EVENT, handleSettingsChanged);
      displayModeQueries.forEach(query => query.removeEventListener("change", syncRuntimeDisplayMode));
      delete root.dataset.pwaDisplayMode;
    };
  }, []);

  return null;
}
