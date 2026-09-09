import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricSummary } from "@beacon/shared";
import type { Point } from "@/components/charts/chartUtils";
import { useLive } from "@/context/LiveContext";
import { api } from "@/lib/api";
import { isLiveRange } from "@/lib/time";

type Field = keyof MetricSummary;

/**
 * Loads a metric window, then keeps it moving from the live socket while the
 * range is short enough for new samples to be visible.
 */
export function useSeries(deviceId: string, rangeSeconds: number, fields: Field[]) {
  const { samples } = useLive();
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [window_, setWindow] = useState(() => ({ from: Date.now() - rangeSeconds * 1000, to: Date.now() }));
  const fieldKey = fields.join(",");
  const liveRef = useRef<number>(0);

  // The range the points on screen actually belong to. Until a new range has
  // arrived, live samples must keep being trimmed against the old one.
  const shownRange = useRef(rangeSeconds);
  // Guards against a slow answer for a range the user has already left.
  const request = useRef(0);

  const load = useCallback(async () => {
    const to = Date.now();
    const from = to - rangeSeconds * 1000;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const series = await api.series(deviceId, { from, to, fields: fieldKey });
      if (ticket !== request.current) return;
      // Points and axis change in the same render. Moving the axis first leaves
      // the previous range's data squeezed into a corner of the new one for a
      // frame or two, which is visible as the curve settling after a switch.
      setPoints(series.points as Point[]);
      setWindow({ from, to });
      shownRange.current = rangeSeconds;
    } catch {
      if (ticket !== request.current) return;
      setPoints([]);
      setWindow({ from, to });
      shownRange.current = rangeSeconds;
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [deviceId, rangeSeconds, fieldKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Longer ranges are served by the rollup tiers, so they refresh on a timer.
  useEffect(() => {
    if (isLiveRange(rangeSeconds)) return;
    const timer = globalThis.setInterval(() => void load(), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [load, rangeSeconds]);

  const sample = samples[deviceId];
  useEffect(() => {
    if (!sample || !isLiveRange(shownRange.current)) return;
    if (sample.ts <= liveRef.current) return;
    liveRef.current = sample.ts;

    const next: Point = { ts: sample.ts };
    for (const field of fieldKey.split(",") as Field[]) {
      const value = sample.summary[field];
      next[field] = typeof value === "number" ? value : null;
    }

    const range = shownRange.current;
    setPoints((current) => {
      const cutoff = sample.ts - range * 1000;
      return [...current.filter((point) => point.ts > cutoff), next];
    });
    setWindow((current) => ({ from: sample.ts - range * 1000, to: Math.max(sample.ts, current.to) }));
  }, [sample, fieldKey]);

  return { points, loading, from: window_.from, to: window_.to, reload: load };
}
