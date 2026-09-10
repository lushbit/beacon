import { useSyncExternalStore } from "react";

/**
 * Times like "checked 4m ago" are written by the hub, so they are measured
 * against the hub's clock rather than this computer's. When the two disagree by
 * a few minutes, every fresh check otherwise reads as minutes old. The hub
 * stamps each API response with its time, and this keeps the difference.
 */
let offsetMs = 0;

/** Records the hub's time from a response, if the answer came back quickly. */
export function noteServerTime(serverMs: number, sentAt: number, receivedAt: number): void {
  // A slow answer says little about the moment the hub read its clock.
  if (!Number.isFinite(serverMs) || serverMs <= 0 || receivedAt - sentAt > 2000) return;
  offsetMs = serverMs - (sentAt + receivedAt) / 2;
}

/** The current time on the hub, as best this browser can tell. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/*
 * One shared one-second clock. Relative times read it so they move on their
 * own, instead of only when new data happens to re-render the page.
 */
const listeners = new Set<() => void>();
let now = serverNow();
let timer: number | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = window.setInterval(() => {
      now = serverNow();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot(): number {
  // Nothing was ticking, so the stored time may be old. Catch up before use.
  if (timer === null && serverNow() - now >= 1000) now = serverNow();
  return now;
}

/** The hub's time, updated every second while something is showing it. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot);
}
