"use client";

import { useEffect } from "react";
import { StoryApp as StoryAppBase } from "./story-app-base";

type StoryAppProps = {
  onClose: () => void;
};

export function StoryApp(props: StoryAppProps) {
  useEffect(() => {
    let lockedStage: HTMLElement | null = null;
    let lockedScrollTop = 0;
    let lockUntil = 0;
    const editorSelector = ".story-inline-edit textarea";

    const getStage = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || !target.matches(editorSelector)) return null;
      return target.closest(".story-app-shell")?.querySelector<HTMLElement>(".story-stage") ?? null;
    };

    const restore = () => {
      if (!lockedStage || performance.now() > lockUntil) return;
      lockedStage.scrollTop = lockedScrollTop;
    };

    const beginLock = (event: Event) => {
      const stage = getStage(event.target);
      if (!stage) return;
      lockedStage = stage;
      lockedScrollTop = stage.scrollTop;
      lockUntil = performance.now() + 320;
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
      window.setTimeout(restore, 60);
      window.setTimeout(restore, 180);
    };

    const handleScroll = (event: Event) => {
      if (event.target === lockedStage && performance.now() <= lockUntil) {
        restore();
      }
    };

    document.addEventListener("beforeinput", beginLock, true);
    document.addEventListener("input", beginLock, true);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("beforeinput", beginLock, true);
      document.removeEventListener("input", beginLock, true);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  return <StoryAppBase {...props} />;
}
