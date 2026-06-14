"use client";

import { useCallback } from "react";

/**
 * Returns an updater wrapper that preserves the current scroll position across
 * state-triggered re-renders. Used by dashboard filter controls that would
 * otherwise cause the viewport to jump.
 */
export function useScrollSafeUpdate(): (update: () => void) => void {
  return useCallback((update: () => void) => {
    const x = window.scrollX;
    const y = window.scrollY;
    update();
    const restore = () => {
      if (Math.abs(window.scrollY - y) > 1 || Math.abs(window.scrollX - x) > 1) {
        window.scrollTo({ left: x, top: y, behavior: "auto" });
      }
    };
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }, []);
}
