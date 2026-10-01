import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CanvasAlertsDto,
  CanvasBlock,
  CanvasDeviceSnapshot,
  CanvasOptions,
  CanvasSeriesDto,
  CanvasUptimeDto,
} from "@beacon/shared";
import { aggregateValues, canvasMetric, snapshotValue, sourceField } from "@beacon/shared";
import { isLiveRange } from "@/lib/time";

/**
 * Where a page's numbers come from. A public page reads the hub's public API
 * by block id, and the editor reads the signed-in API with the block it is
 * working on. Blocks only ever talk to this, so they draw the same in both.
 */
export interface CanvasDataValue {
  mode: "public" | "editor";
  options: CanvasOptions;
  /** The range charts without their own one show, in seconds. */
  range: number;
  devices: Record<string, CanvasDeviceSnapshot>;
  deviceIds: (block: CanvasBlock) => string[];
  fetchSeries: (block: CanvasBlock, range: number) => Promise<CanvasSeriesDto>;
  fetchUptime: (block: CanvasBlock) => Promise<CanvasUptimeDto>;
  fetchAlerts: (block: CanvasBlock) => Promise<CanvasAlertsDto>;
}

const CanvasDataContext = createContext<CanvasDataValue | null>(null);

export function CanvasDataProvider({ value, children }: { value: CanvasDataValue; children: ReactNode }) {
  return <CanvasDataContext.Provider value={value}>{children}</CanvasDataContext.Provider>;
}

export function useCanvasData(): CanvasDataValue {
  const value = useContext(CanvasDataContext);
  if (!value) throw new Error("useCanvasData must be used inside CanvasDataProvider");
  return value;
}

/** The snapshots of the devices a block draws from, in its order. */
export function useBlockDevices(block: CanvasBlock): { ids: string[]; snapshots: CanvasDeviceSnapshot[] } {
  const { deviceIds, devices } = useCanvasData();
  const ids = deviceIds(block);
  const snapshots = ids.map((id) => devices[id]).filter((device): device is CanvasDeviceSnapshot => Boolean(device));
  return { ids, snapshots };
}

/** A block's settings as a string, so a change to any of them fetches again. */
function blockKey(block: CanvasBlock): string {
  return `${block.type}:${JSON.stringify(block.config)}`;
}

/**
 * A chart's history, kept moving from live snapshots while the range is short
 * enough to see new points arrive. Longer ranges reload every minute.
 */
export function useBlockSeries(block: CanvasBlock, range: number, enabled = true) {
  const data = useCanvasData();
  const { fetchSeries, mode } = data;
  const [series, setSeries] = useState<CanvasSeriesDto | null>(null);
  const [failed, setFailed] = useState(false);
  const key = blockKey(block);
  const blockRef = useRef(block);
  blockRef.current = block;
  const lastTs = useRef(0);
  const seriesRef = useRef(series);
  seriesRef.current = series;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchSeries(blockRef.current, range);
        if (cancelled) return;
        lastTs.current = result.points.length > 0 ? result.points[result.points.length - 1].ts : 0;
        setSeries(result);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    // The editor changes a block with every keystroke. Waiting a moment keeps
    // that from sending a request for each one.
    const timer = window.setTimeout(() => void load(), mode === "editor" ? 350 : 0);
    const refresh = isLiveRange(range) ? null : window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (refresh) window.clearInterval(refresh);
    };
  }, [key, range, fetchSeries, mode, enabled]);

  // New points from live snapshots.
  const ids = data.deviceIds(block);
  const idKey = ids.join(",");
  const snapshots = ids.map((id) => data.devices[id]);
  const newest = Math.max(0, ...snapshots.map((snapshot) => snapshot?.ts ?? 0));
  const hasSeries = series !== null;
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !isLiveRange(range) || newest <= lastTs.current) return;
    const current = blockRef.current;
    const point: { ts: number } & Record<string, number | null> = { ts: newest };

    if (current.type === "cores") {
      const perCore = snapshots[0]?.perCore ?? [];
      perCore.forEach((value, index) => {
        point[`c${index}`] = value;
      });
    } else if (current.type === "chart" || current.type === "value") {
      const source = current.config.source;
      const metric = canvasMetric(source.metric);
      if (!metric) return;
      if (source.target.kind === "device") {
        const snapshot = snapshots[0];
        if (!snapshot) return;
        for (const entry of series.keys) point[entry.key] = snapshotValue(snapshot, metric, entry.key, source.sub);
      } else {
        // A fleet line moves on any device's sample, but at most every few
        // seconds, so ten devices do not add ten points a cycle.
        if (newest - lastTs.current < 4000) return;
        const online = snapshots.map((snapshot) => (snapshot && snapshot.status === "online" ? snapshot : null));
        if (current.type === "chart" && source.target.split) {
          const field = sourceField(metric, source);
          series.keys.forEach((entry, index) => {
            const snapshot = online[index];
            point[entry.key] = snapshot ? snapshotValue(snapshot, metric, field, source.sub) : null;
          });
        } else {
          const agg = source.target.agg;
          for (const entry of series.keys) {
            point[entry.key] = aggregateValues(
              online.map((snapshot) => (snapshot ? snapshotValue(snapshot, metric, entry.key, source.sub) : null)),
              agg
            );
          }
        }
      }
    } else {
      return;
    }

    lastTs.current = newest;
    setSeries((existing) => {
      if (!existing) return existing;
      const from = newest - range * 1000;
      return {
        ...existing,
        from,
        to: Math.max(existing.to, newest),
        points: [...existing.points.filter((entry) => entry.ts > from), point],
      };
    });
    // Snapshots are read through `newest` and the device list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest, idKey, hasSeries, range]);

  return { series, failed };
}

/** Polls something a block shows, such as its uptime bars or alerts. */
export function useBlockPoll<T>(block: CanvasBlock, load: (block: CanvasBlock) => Promise<T>, everyMs: number) {
  const { mode } = useCanvasData();
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const key = blockKey(block);
  const blockRef = useRef(block);
  blockRef.current = block;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const result = await loadRef.current(blockRef.current);
        if (!cancelled) {
          setValue(result);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    const timer = window.setTimeout(() => void run(), mode === "editor" ? 350 : 0);
    const interval = window.setInterval(() => void run(), everyMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [key, everyMs, mode]);

  return { value, failed };
}

/** The range a block shows: its own, or the page's. */
export function useBlockRange(own: number | null): number {
  const { range } = useCanvasData();
  return own ?? range;
}

export function useSnapshotsById(): Record<string, CanvasDeviceSnapshot> {
  return useCanvasData().devices;
}

export function useMemoDevices(snapshots: CanvasDeviceSnapshot[]): Record<string, CanvasDeviceSnapshot> {
  return useMemo(() => Object.fromEntries(snapshots.map((snapshot) => [snapshot.id, snapshot])), [snapshots]);
}
