// lib/browser-notification.ts
// Notification wrapper for background alerts — uses Capacitor's native
// LocalNotifications plugin inside the packaged APK shell (Android WebView
// has no Notification API at all), falls back to the browser Notification
// API when running in a plain browser tab (dev/desktop).

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { loadChatAppSettings } from "./chat-storage";

let _notifCounter = 0;
let _nativePermissionGranted = false;

export function isNativeShell(): boolean {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}

/** Check if notifications are enabled in app settings. */
export function isNotificationEnabled(): boolean {
    if (typeof window === "undefined") return false;
    const settings = loadChatAppSettings();
    if (settings.browserNotificationsEnabled !== true) return false;
    if (isNativeShell()) return _nativePermissionGranted;
    if (!("Notification" in window)) return false;
    return Notification.permission === "granted";
}

/** Async permission check — works for both the native shell and a plain browser. */
export async function checkNotificationPermission(): Promise<"granted" | "denied" | "default" | "unsupported"> {
    if (typeof window === "undefined") return "default";
    if (isNativeShell()) {
        try {
            const { display } = await LocalNotifications.checkPermissions();
            _nativePermissionGranted = display === "granted";
            return display === "granted" ? "granted" : display === "denied" ? "denied" : "default";
        } catch {
            return "unsupported";
        }
    }
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
}

/** Request notification permission. Returns true if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
    if (typeof window === "undefined") return false;

    if (isNativeShell()) {
        try {
            const { display } = await LocalNotifications.requestPermissions();
            _nativePermissionGranted = display === "granted";
            return _nativePermissionGranted;
        } catch {
            _nativePermissionGranted = false;
            return false;
        }
    }

    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;

    const result = await new Promise<NotificationPermission>((resolve) => {
        let settled = false;
        const finish = (permission: NotificationPermission) => {
            if (settled) return;
            settled = true;
            resolve(permission);
        };

        try {
            const request = Notification.requestPermission(finish);
            if (request && typeof request.then === "function") {
                request.then(finish).catch(() => finish(Notification.permission));
            }
        } catch {
            finish(Notification.permission);
        }

        window.setTimeout(() => finish(Notification.permission), 3000);
    });

    return result === "granted";
}

function constructNotification(title: string, payload: NotificationOptions): void {
    try {
        const notification = new Notification(title, payload);
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } catch {
        // Android Chrome/Edge: "Illegal constructor" — handled by the SW path below.
    }
}

function sendNativeNotification(title: string, body: string | undefined): void {
    const id = Math.floor(Math.random() * 2_147_483_000) + 1;
    LocalNotifications.schedule({
        notifications: [{
            id,
            title,
            body: body ?? "",
            schedule: { at: new Date(Date.now() + 200) },
        }],
    }).catch(() => undefined);
}

/**
 * Send a notification if enabled and the page/app is hidden.
 * Does nothing if visible, permission denied, or the setting is off.
 *
 * Android Chrome/Edge does NOT support the `new Notification()` constructor in
 * pages (throws Illegal constructor) — notifications there must go through the
 * service worker's showNotification(). We prefer the SW path everywhere and fall
 * back to the constructor (desktop / dev where the SW isn't registered).
 */
export function sendBrowserNotification(
    title: string,
    options?: { body?: string; icon?: string },
): void {
    if (!isNotificationEnabled()) return;
    if (!document.hidden) return;

    if (isNativeShell()) {
        sendNativeNotification(title, options?.body);
        return;
    }

    const payload: NotificationOptions = {
        body: options?.body,
        icon: options?.icon || "/icon-192.png",
        tag: `ai-phone-${Date.now()}-${_notifCounter++}`,
    };

    if ("serviceWorker" in navigator) {
        // `ready` never rejects and may hang forever when no SW is registered
        // (dev mode) — race it with a short timeout, then fall back.
        const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 800));
        Promise.race([navigator.serviceWorker.ready, timeout])
            .then((registration) => {
                if (registration && typeof registration.showNotification === "function") {
                    return registration.showNotification(title, payload);
                }
                constructNotification(title, payload);
            })
            .catch(() => constructNotification(title, payload));
        return;
    }
    constructNotification(title, payload);
}
