"use client";

import { useEffect } from "react";

/** Poll only while visible, with one timer and at most one request in flight per effect. */
export function useVisiblePolling(load: () => Promise<void>, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    let running = false;
    let stopped = false;

    function clearTimer() {
      window.clearTimeout(timer);
      timer = undefined;
    }

    async function poll() {
      clearTimer();
      if (stopped || running || document.visibilityState === "hidden") return;

      running = true;
      try {
        await load();
      } catch (error) {
        console.warn("Game refresh failed", error);
      } finally {
        running = false;
        if (!stopped && document.visibilityState !== "hidden") {
          timer = window.setTimeout(() => void poll(), intervalMs);
        }
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") clearTimer();
      else void poll();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load, intervalMs, enabled]);
}
