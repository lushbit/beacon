import type {
  CanvasAlertsDto,
  CanvasBlock,
  CanvasContent,
  CanvasDeviceMeta,
  CanvasDeviceSnapshot,
  CanvasMetric,
  CanvasNeeds,
  CanvasSeriesDto,
  CanvasSeriesKey,
  CanvasUptimeDto,
  DeviceStaticInfo,
  MetricSeriesDto,
  MetricSummary,
  MetricTier,
} from "@beacon/shared";
import {
  aggregateValues,
  blockDeviceIds,
  buildSnapshot,
  canvasMetric,
  pageNeeds,
  sourceField,
} from "@beacon/shared";
import { db, parseJson } from "../db/index.js";
import { deviceSettings, deviceStatus, listDeviceRows, type DeviceRow } from "../devices.js";
import { isOnline } from "../hub/agents.js";
import {
  getLatestSamples,
  pickTier,
  queryCoreSeries,
  queryDiskSeries,
  queryGpuSeries,
  queryNetSeries,
  querySeries,
} from "../metrics/store.js";
import { getServerSettings } from "../settings.js";

/* ----------------------------------------------------------------- devices */

export function metaFor(row: DeviceRow, latest: CanvasDeviceMeta["latest"]): CanvasDeviceMeta {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    tags: parseJson<string[]>(row.tags, []),
    status: deviceStatus(row, isOnline(row.id)),
    lastSeenAt: row.last_seen_at,
    staticInfo: parseJson<DeviceStaticInfo | null>(row.static_info, null),
    panels: deviceSettings(row).panels,
    latest,
  };
}

/** Every device as the editor sees it, with its latest sample. */
export function deviceMetas(): CanvasDeviceMeta[] {
  const latest = getLatestSamples();
  return listDeviceRows().map((row) => metaFor(row, latest.get(row.id) ?? null));
}

/** What a published page sends its visitors about the devices it shows. */
export function pageSnapshots(content: CanvasContent): {
  devices: CanvasDeviceSnapshot[];
  blockDevices: Record<string, string[]>;
  needs: Map<string, CanvasNeeds>;
} {
  const metas = deviceMetas();
  const needs = pageNeeds(content.blocks, metas);
  const blockDevices: Record<string, string[]> = {};
  for (const block of content.blocks) {
    const ids = blockDeviceIds(block, metas);
    if (ids.length > 0) blockDevices[block.id] = ids;
  }
  const devices = metas.filter((meta) => needs.has(meta.id)).map((meta) => buildSnapshot(meta, needs.get(meta.id)!));
  // A device listed by a block that needs nothing from it, such as a status
  // block, still has to be named on the page.
  for (const meta of metas) {
    if (needs.has(meta.id)) continue;
    if (Object.values(blockDevices).some((ids) => ids.includes(meta.id))) {
      devices.push(buildSnapshot({ ...meta, latest: null }, { summary: [], gpus: false, drives: false, ifaces: false, cores: false, volumes: false, containers: false, info: [] }));
    }
  }
  return { devices, blockDevices, needs };
}

/* ------------------------------------------------------------------ series */

type Point = { ts: number } & Record<string, number | null>;

/**
 * Raw samples from different devices never share a timestamp, so a fleet line
 * puts them into buckets first. Fifteen seconds holds two or three samples at
 * the default interval, which keeps a sum from flickering as devices drift.
 */
function fleetBucketMs(tier: MetricTier): number {
  return tier === "raw" ? 15_000 : tier === "minute" ? 60_000 : 3_600_000;
}

/** One device's history of one metric, under the metric's own field keys. */
function deviceSeries(
  deviceId: string,
  metric: CanvasMetric,
  sub: string,
  keys: string[],
  from: number,
  to: number,
  tier: MetricTier
): Point[] {
  let result: MetricSeriesDto;
  if (metric.scope === "gpu" && sub !== "") {
    result = queryGpuSeries(deviceId, from, to, tier, Number.parseInt(sub, 10));
  } else if (metric.scope === "drive" && sub !== "") {
    result = queryDiskSeries(deviceId, from, to, tier, sub);
  } else if (metric.scope === "drive" && metric.id === "diskTemp") {
    // Drive temperature is only kept per drive. Without one picked, the first.
    const first = (getLatestSamples().get(deviceId)?.detail.drives ?? [])[0];
    if (!first) return [];
    result = queryDiskSeries(deviceId, from, to, tier, first.device);
  } else if (metric.scope === "iface" && sub !== "") {
    result = queryNetSeries(deviceId, from, to, tier, sub);
  } else {
    result = querySeries(deviceId, from, to, tier, keys as (keyof MetricSummary)[]);
  }
  return result.points.map((point) => {
    const out: Point = { ts: point.ts };
    const source = point as unknown as Record<string, number | null | undefined>;
    for (const key of keys) out[key] = typeof source[key] === "number" ? (source[key] as number) : null;
    return out;
  });
}

/** Averages each device into buckets, so devices can be lined up against each other. */
function bucketed(points: Point[], key: string, bucketMs: number): Map<number, number> {
  const sums = new Map<number, { sum: number; count: number }>();
  for (const point of points) {
    const value = point[key];
    if (value === null || value === undefined) continue;
    const slot = Math.floor(point.ts / bucketMs) * bucketMs;
    const entry = sums.get(slot) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    sums.set(slot, entry);
  }
  return new Map([...sums].map(([slot, entry]) => [slot, entry.sum / entry.count]));
}

function alertMarkers(deviceIds: string[], from: number, to: number): CanvasSeriesDto["markers"] {
  if (deviceIds.length === 0) return [];
  const placeholders = deviceIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT rule_name, severity, started_at, resolved_at FROM alerts
        WHERE device_id IN (${placeholders}) AND started_at <= ? AND (resolved_at IS NULL OR resolved_at >= ?)
        ORDER BY started_at ASC LIMIT 100`
    )
    .all(...deviceIds, to, from) as { rule_name: string; severity: string; started_at: number; resolved_at: number | null }[];
  return rows.map((row) => ({
    ts: Math.max(row.started_at, from),
    endTs: row.resolved_at,
    label: row.rule_name,
    severity: row.severity,
  }));
}

/** The history a chart, value or cores block draws, for the range asked for. */
export function blockSeries(block: CanvasBlock, rangeSec: number, metas: CanvasDeviceMeta[]): CanvasSeriesDto {
  const to = Date.now();
  const from = to - rangeSec * 1000;
  const tier = pickTier(from, to, getServerSettings().retention.rawHours);
  const empty: CanvasSeriesDto = { from, to, keys: [], points: [], markers: [] };
  const deviceIds = blockDeviceIds(block, metas);

  if (block.type === "cores") {
    const deviceId = deviceIds[0];
    if (!deviceId) return empty;
    const result = queryCoreSeries(deviceId, from, to, tier);
    const count = Math.max(0, ...result.points.map((point) => Object.keys(point).length - 1));
    const keys = Array.from({ length: count }, (_, core) => ({ key: `c${core}`, label: `Core ${core + 1}` }));
    return { from, to, keys, points: result.points as unknown as Point[], markers: [] };
  }

  if (block.type !== "chart" && block.type !== "value" && block.type !== "gauge") return empty;
  const source = block.config.source;
  const metric = canvasMetric(source.metric);
  if (!metric || deviceIds.length === 0) return empty;

  const single = block.type !== "chart" || source.field !== "";
  const fields = single ? [sourceField(metric, source)] : metric.fields.map((field) => field.key);
  const label = (key: string) => metric.fields.find((field) => field.key === key)?.label ?? key;
  const markers = block.type === "chart" && block.config.alerts ? alertMarkers(deviceIds, from, to) : [];

  if (source.target.kind === "device") {
    const points = deviceSeries(deviceIds[0], metric, source.sub, fields, from, to, tier);
    // A field this device never reports (steal time on bare metal) is left out
    // rather than drawn as an empty line in the legend.
    const present = fields.filter((key) => points.some((point) => point[key] !== null));
    const keys: CanvasSeriesKey[] = (present.length > 0 ? present : fields.slice(0, 1)).map((key) => ({ key, label: label(key) }));
    return { from, to, keys, points, markers };
  }

  const bucketMs = fleetBucketMs(tier);
  const target = source.target;
  const names = new Map(metas.map((meta) => [meta.id, meta.name]));

  if (block.type === "chart" && target.split) {
    // One line per device, for comparing them. Capped so the legend stays readable.
    const field = sourceField(metric, source);
    const chosen = deviceIds.slice(0, 12);
    const perDevice = chosen.map((id) => bucketed(deviceSeries(id, metric, source.sub, [field], from, to, tier), field, bucketMs));
    const slots = [...new Set(perDevice.flatMap((map) => [...map.keys()]))].sort((a, b) => a - b);
    const points = slots.map((slot) => {
      const point: Point = { ts: slot + bucketMs / 2 };
      perDevice.forEach((map, index) => {
        point[`d${index}`] = map.get(slot) ?? null;
      });
      return point;
    });
    const keys = chosen.map((id, index) => ({ key: `d${index}`, label: names.get(id) ?? "Device" }));
    return { from, to, keys, points, markers };
  }

  const perDevice = deviceIds.map((id) => deviceSeries(id, metric, source.sub, fields, from, to, tier));
  const slots = new Set<number>();
  const buckets = perDevice.map((points) =>
    Object.fromEntries(
      fields.map((key) => {
        const map = bucketed(points, key, bucketMs);
        for (const slot of map.keys()) slots.add(slot);
        return [key, map];
      })
    ) as Record<string, Map<number, number>>
  );
  const points = [...slots]
    .sort((a, b) => a - b)
    .map((slot) => {
      const point: Point = { ts: slot + bucketMs / 2 };
      for (const key of fields) {
        point[key] = aggregateValues(
          buckets.map((entry) => entry[key].get(slot) ?? null),
          target.agg
        );
      }
      return point;
    });
  const keys = fields.map((key) => ({ key, label: label(key) }));
  return { from, to, keys, points, markers };
}

/* ------------------------------------------------------------------ uptime */

/**
 * The share of each day a device was reporting. Days still inside the raw
 * history count the minutes that have a reading, which keeps today up to the
 * minute. Older days count the rolled-up minutes while those are kept and the
 * hours after that. Counting starts at the device's first reading, so a device
 * added this week is not marked down for the weeks before. Days run in the
 * visitor's time zone, given as minutes east of UTC.
 */
export function blockUptime(block: CanvasBlock, metas: CanvasDeviceMeta[], tzOffsetMin: number): CanvasUptimeDto {
  if (block.type !== "uptime") return { days: [], devices: [] };
  const days = block.config.days;
  const offsetMs = tzOffsetMin * 60_000;
  const now = Date.now();
  const todayStart = Math.floor((now + offsetMs) / 86_400_000) * 86_400_000 - offsetMs;
  const firstDay = todayStart - (days - 1) * 86_400_000;
  const retention = getServerSettings().retention;
  const rawFrom = now - retention.rawHours * 3_600_000;
  const minuteFrom = now - retention.minuteDays * 86_400_000;
  // The minute still under way has not had the chance to report yet.
  const until = now - 60_000;

  const labels = Array.from({ length: days }, (_, index) =>
    new Date(firstDay + index * 86_400_000 + offsetMs).toISOString().slice(0, 10)
  );

  const ids = blockDeviceIds(block, metas);
  const rows = new Map(listDeviceRows().map((row) => [row.id, row]));
  // The offset arrives as a JavaScript number, which SQLite takes as a real,
  // so the sums are cast back to integers to keep the divisions whole.
  const countStmt = db.prepare(
    `SELECT (CAST(ts + ? AS INTEGER) / 86400000) AS day, COUNT(*) AS n FROM samples
      WHERE device_id = ? AND tier = ? AND ts >= ? AND ts < ?
      GROUP BY day`
  );
  const rawStmt = db.prepare(
    `SELECT (CAST(ts + ? AS INTEGER) / 86400000) AS day, COUNT(DISTINCT CAST(ts AS INTEGER) / 60000) AS n FROM samples
      WHERE device_id = ? AND tier = 'raw' AND ts >= ? AND ts < ?
      GROUP BY day`
  );
  const firstStmt = db.prepare("SELECT MIN(ts) AS ts FROM samples WHERE device_id = ?");
  const counts = (entries: unknown[]) => new Map((entries as { day: number; n: number }[]).map((entry) => [entry.day, entry.n]));

  const devices = ids.map((id) => {
    const row = rows.get(id);
    const meta = metas.find((entry) => entry.id === id);
    const interval = row ? deviceSettings(row).sampleIntervalMs : 5000;
    const first = (firstStmt.get(id) as { ts: number | null }).ts;
    const raw = counts(rawStmt.all(offsetMs, id, firstDay, now));
    const minutes = counts(countStmt.all(offsetMs, id, "minute", Math.max(firstDay, minuteFrom), now));
    const hours = minuteFrom > firstDay ? counts(countStmt.all(offsetMs, id, "hour", firstDay, minuteFrom)) : new Map<number, number>();
    // A device that reports less often than once a minute fills fewer minutes.
    const perMinute = Math.min(1, 60_000 / Math.max(1000, interval));

    let covered = 0;
    let possible = 0;
    const values = labels.map((_, index) => {
      if (first === null) return null;
      const start = firstDay + index * 86_400_000;
      const end = Math.min(start + 86_400_000, until);
      const from = Math.max(start, first);
      if (end <= from) return null;
      const dayKey = Math.floor((start + offsetMs) / 86_400_000);
      let expected: number;
      let seen: number;
      if (start >= rawFrom) {
        expected = ((end - from) / 60_000) * perMinute;
        seen = raw.get(dayKey) ?? 0;
      } else if (start >= minuteFrom) {
        expected = ((end - from) / 60_000) * perMinute;
        seen = minutes.get(dayKey) ?? 0;
      } else {
        expected = (end - from) / 3_600_000;
        seen = hours.get(dayKey) ?? 0;
      }
      if (expected < 1) return null;
      const share = Math.min(100, (seen / expected) * 100);
      covered += Math.min(seen, expected);
      possible += expected;
      return Math.round(share * 100) / 100;
    });
    return {
      id,
      name: meta?.name ?? "Device",
      values,
      overall: possible > 0 ? Math.round((covered / possible) * 10_000) / 100 : null,
    };
  });

  return { days: labels, devices };
}

/* ------------------------------------------------------------------ alerts */

export function blockAlerts(block: CanvasBlock, metas: CanvasDeviceMeta[]): CanvasAlertsDto {
  if (block.type !== "alerts") return { alerts: [] };
  const ids = blockDeviceIds(block, metas);
  if (ids.length === 0) return { alerts: [] };
  const names = new Map(metas.map((meta) => [meta.id, meta.name]));
  const rows = db
    .prepare(
      `SELECT id, device_id, rule_name, severity, started_at FROM alerts
        WHERE state = 'firing' AND device_id IN (${ids.map(() => "?").join(", ")})
        ORDER BY started_at DESC LIMIT ?`
    )
    .all(...ids, block.config.limit) as { id: string; device_id: string; rule_name: string; severity: string; started_at: number }[];
  return {
    alerts: rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      deviceName: names.get(row.device_id) ?? "Device",
      ruleName: row.rule_name,
      severity: row.severity,
      startedAt: row.started_at,
    })),
  };
}

/* ------------------------------------------------------------------- cache */

/**
 * Public answers are kept for a few seconds, so a page open in a thousand
 * browsers costs about the same as one. Long ranges change slowly and are kept
 * for a minute.
 */
const cache = new Map<string, { expires: number; value: unknown }>();
const CACHE_LIMIT = 1000;

export function cached<T>(key: string, ttlMs: number, compute: () => T): T {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = compute();
  if (cache.size >= CACHE_LIMIT) {
    for (const [entry, stored] of cache) {
      if (stored.expires <= now || cache.size >= CACHE_LIMIT) cache.delete(entry);
      if (cache.size < CACHE_LIMIT * 0.8) break;
    }
  }
  cache.set(key, { expires: now + ttlMs, value });
  return value;
}

export function forgetCached(prefix: string): void {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}
