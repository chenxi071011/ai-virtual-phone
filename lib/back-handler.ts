"use client";

/**
 * Android back / swipe-back routing.
 *
 * The app is a single-page shell that navigates with React state, not the
 * History API, so `webView.canGoBack()` is always false and Capacitor's default
 * back behaviour finishes the activity — i.e. one swipe from anywhere quits the
 * app. Instead, every layer that can be "backed out of" (an opened app, a chat
 * session, a modal, a bottom sheet) registers a handler while it is mounted.
 * Back pops the top-most one; only when the stack is empty do we fall through to
 * the double-press-to-exit at the desktop.
 *
 * Mount = layer opened, unmount = layer closed, so `useBackHandler` needs no
 * explicit open/close bookkeeping for conditionally rendered overlays.
 */

import { useEffect, useRef } from "react";

type Entry = { id: number; fn: () => void };

let sequence = 0;
const stack: Entry[] = [];

/** Register a layer. Returns the unregister function. */
export function pushBackHandler(fn: () => void): () => void {
    const id = ++sequence;
    stack.push({ id, fn });
    return () => {
        const index = stack.findIndex((entry) => entry.id === id);
        if (index >= 0) stack.splice(index, 1);
    };
}

/** Run the top-most layer's handler. Returns false when nothing is stacked. */
export function runBackHandler(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    try {
        top.fn();
    } catch (error) {
        console.warn("[BackHandler] layer threw while closing:", error);
        // A throwing layer would otherwise wedge the stack and make back dead.
        const index = stack.findIndex((entry) => entry.id === top.id);
        if (index >= 0) stack.splice(index, 1);
    }
    return true;
}

export function backHandlerDepth(): number {
    return stack.length;
}

/**
 * Register `fn` as the back action while `active` is true.
 *
 * `fn` is read through a ref, so passing a fresh closure each render does not
 * re-register (and therefore does not reorder the stack).
 */
export function useBackHandler(active: boolean, fn: () => void): void {
    const latest = useRef(fn);
    latest.current = fn;

    useEffect(() => {
        if (!active) return;
        return pushBackHandler(() => latest.current());
    }, [active]);
}
