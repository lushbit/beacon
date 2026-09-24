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
 *
 * `of` asks for one GPU's, drive's or network interface's own history instead
 * of the summary fields, which is how a machine with two of any of them charts
 * them apart. The points come back under the same keys, so nothing downstream
 * changes. `cores` asks for every core at once, keyed `c0`, `c1` and so on.
 */
export function useSeries(
  deviceId: string,
  rangeSeconds: number,
  fields: Field[],
  of: { gpu?: number; disk?: string; iface?: string; cores?: boolean } = {}
) {
  const { gpu, disk, iface } = of;
  const cores = of.cores ? 1 : undefined;
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
      const series = await api.series(deviceId, { from, to, fields: fieldKey, gpu, disk, iface, cores });
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
  }, [deviceId, rangeSeconds, fieldKey, gpu, disk, iface, cores]);

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
    if (cores !== undefined) {
      (sample.detail.cpu?.perCore ?? []).forEach((value, index) => {
        next[`c${index}`] = value;
      });
    } else if (iface !== undefined) {
      const entry = sample.detail.network?.find((candidate) => candidate.iface === iface);
      next.netRxBps = entry?.rxBytesPerSec ?? null;
      next.netTxBps = entry?.txBytesPerSec ?? null;
    } else if (disk !== undefined) {
      const drive = sample.detail.drives?.find((entry) => entry.device === disk);
      next.diskReadBps = drive?.readBps ?? null;
      next.diskWriteBps = drive?.writeBps ?? null;
    } else if (gpu === undefined) {
      for (const field of fieldKey.split(",") as Field[]) {
        const value = sample.summary[field];
        next[field] = typeof value === "number" ? value : null;
      }
    } else {
      // The live sample carries every adapter, so the chosen one keeps moving
      // between window reloads the same way the summary fields do.
      const entry = sample.detail.gpus[gpu];
      next.gpuPct = entry?.utilizationPct ?? null;
      next.gpuMemPct =
        entry && entry.memoryTotalMb && entry.memoryUsedMb !== null
          ? Math.round((entry.memoryUsedMb / entry.memoryTotalMb) * 1000) / 10
          : null;
      next.gpuTempC = entry?.temperatureC ?? null;
    }

    const range = shownRange.current;
    setPoints((current) => {
      const cutoff = sample.ts - range * 1000;
      return [...current.filter((point) => point.ts > cutoff), next];
    });
    setWindow((current) => ({ from: sample.ts - range * 1000, to: Math.max(sample.ts, current.to) }));
  }, [sample, fieldKey, gpu, disk, iface, cores]);

  return { points, loading, from: window_.from, to: window_.to, reload: load };
}
