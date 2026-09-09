import type { MetricSample, MetricSeriesDto, MetricSummary, MetricTier } from "@beacon/shared";
import { db, parseJson } from "../db/index.js";

/** Column order used by every insert/select in this module. */
const SUMMARY_COLUMNS = [
  ["cpuPct", "cpu_pct"],
  ["memPct", "mem_pct"],
  ["memUsedBytes", "mem_used"],
  ["memTotalBytes", "mem_total"],
  ["swapPct", "swap_pct"],
  ["diskMaxPct", "disk_max_pct"],
  ["diskUsedBytes", "disk_used"],
  ["diskTotalBytes", "disk_total"],
  ["diskReadBps", "disk_read_bps"],
  ["diskWriteBps", "disk_write_bps"],
  ["netRxBps", "net_rx_bps"],
  ["netTxBps", "net_tx_bps"],
  ["gpuPct", "gpu_pct"],
  ["gpuMemPct", "gpu_mem_pct"],
  ["cpuTempC", "cpu_temp_c"],
  ["load1", "load1"],
  ["load5", "load5"],
  ["load15", "load15"],
  ["uptimeSec", "uptime_sec"],
  ["processCount", "proc_count"],
  ["batteryPct", "battery_pct"],
  ["containersRunning", "containers_running"],
  ["containersTotal", "containers_total"],
] as const satisfies readonly (readonly [keyof MetricSummary, string])[];

const insertStmt = db.prepare(
  `INSERT OR REPLACE INTO samples
     (device_id, tier, ts, ${SUMMARY_COLUMNS.map(([, col]) => col).join(", ")}, cpu_pct_max, mem_pct_max, detail)
   VALUES
     (@device_id, 'raw', @ts, ${SUMMARY_COLUMNS.map(([, col]) => `@${col}`).join(", ")}, NULL, NULL, @detail)`
);

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function insertSample(deviceId: string, sample: MetricSample): void {
  const params: Record<string, unknown> = {
    device_id: deviceId,
    ts: sample.ts,
    detail: JSON.stringify(sample.detail),
  };
  for (const [key, col] of SUMMARY_COLUMNS) {
    params[col] = numberOrNull(sample.summary[key]);
  }
  insertStmt.run(params);
}

interface SampleRow {
  ts: number;
  detail?: string | null;
  [key: string]: unknown;
}

function rowToSummary(row: SampleRow): MetricSummary {
  const summary = {} as Record<string, number | null>;
  for (const [key, col] of SUMMARY_COLUMNS) {
    summary[key] = numberOrNull(row[col]);
  }
  // The two fields the UI always needs a number for.
  summary.cpuPct = summary.cpuPct ?? 0;
  summary.memPct = summary.memPct ?? 0;
  summary.memUsedBytes = summary.memUsedBytes ?? 0;
  summary.memTotalBytes = summary.memTotalBytes ?? 0;
  return summary as unknown as MetricSummary;
}

const EMPTY_DETAIL: MetricSample["detail"] = {
  cpu: { perCore: [], speedGhz: null, temperatures: [] },
  disks: [],
  network: [],
  gpus: [],
  battery: null,
  topProcesses: [],
  containers: [],
};

export function getLatestSample(deviceId: string): MetricSample | null {
  const row = db
    .prepare("SELECT * FROM samples WHERE device_id = ? AND tier = 'raw' ORDER BY ts DESC LIMIT 1")
    .get(deviceId) as SampleRow | undefined;
  if (!row) return null;
  return {
    ts: row.ts,
    summary: rowToSummary(row),
    detail: parseJson(row.detail ?? null, EMPTY_DETAIL),
  };
}

export function getLatestSamples(): Map<string, MetricSample> {
  const rows = db
    .prepare(
      `SELECT s.* FROM samples s
        JOIN (SELECT device_id, MAX(ts) AS ts FROM samples WHERE tier = 'raw' GROUP BY device_id) m
          ON m.device_id = s.device_id AND m.ts = s.ts
       WHERE s.tier = 'raw'`
    )
    .all() as (SampleRow & { device_id: string })[];
  const out = new Map<string, MetricSample>();
  for (const row of rows) {
    out.set(row.device_id, {
      ts: row.ts,
      summary: rowToSummary(row),
      detail: parseJson(row.detail ?? null, EMPTY_DETAIL),
    });
  }
  return out;
}

/** Compact recent history used by the overview cards. */
export function getSpark(deviceId: string, points = 40, windowSec = 900) {
  const rows = db
    .prepare(
      `SELECT ts, cpu_pct, mem_pct FROM samples
        WHERE device_id = ? AND tier = 'raw' AND ts >= ?
        ORDER BY ts DESC LIMIT ?`
    )
    .all(deviceId, Date.now() - windowSec * 1000, points) as {
    ts: number;
    cpu_pct: number | null;
    mem_pct: number | null;
  }[];
  return rows
    .reverse()
    .map((row) => ({ ts: row.ts, cpuPct: row.cpu_pct ?? 0, memPct: row.mem_pct ?? 0 }));
}

const TIER_STEP_SEC: Record<MetricTier, number> = { raw: 5, minute: 60, hour: 3600 };

/** Pick the cheapest tier that still has enough resolution for the range. */
export function pickTier(fromMs: number, toMs: number, rawHours: number): MetricTier {
  const rangeSec = Math.max(1, (toMs - fromMs) / 1000);
  const rawCutoff = Date.now() - rawHours * 3600_000;
  if (fromMs >= rawCutoff && rangeSec <= 6 * 3600) return "raw";
  if (rangeSec <= 14 * 86400) return "minute";
  return "hour";
}

export function querySeries(
  deviceId: string,
  fromMs: number,
  toMs: number,
  tier: MetricTier,
  fields: (keyof MetricSummary)[]
): MetricSeriesDto {
  const wanted = SUMMARY_COLUMNS.filter(([key]) => fields.length === 0 || fields.includes(key));
  const cols = wanted.map(([, col]) => col);
  const rows = db
    .prepare(
      `SELECT ts, ${cols.join(", ")} FROM samples
        WHERE device_id = ? AND tier = ? AND ts >= ? AND ts <= ?
        ORDER BY ts ASC`
    )
    .all(deviceId, tier, fromMs, toMs) as SampleRow[];

  return {
    deviceId,
    tier,
    from: fromMs,
    to: toMs,
    stepSec: TIER_STEP_SEC[tier],
    points: rows.map((row) => {
      const point: Record<string, number | null> = { ts: row.ts };
      for (const [key, col] of wanted) point[key] = numberOrNull(row[col]);
      return point as unknown as MetricSeriesDto["points"][number];
    }),
  };
}

/* ------------------------------------------------------------------- rollups */

const AGG_COLUMNS = SUMMARY_COLUMNS.map(([, col]) => col);

function rollupSql(target: MetricTier, source: MetricTier, bucketMs: number): string {
  const aggregates = AGG_COLUMNS.map((col) => `AVG(${col})`).join(", ");
  return `
    INSERT OR REPLACE INTO samples
      (device_id, tier, ts, ${AGG_COLUMNS.join(", ")}, cpu_pct_max, mem_pct_max, detail)
    SELECT device_id, '${target}', (ts / ${bucketMs}) * ${bucketMs} AS bucket, ${aggregates},
           MAX(COALESCE(cpu_pct_max, cpu_pct)), MAX(COALESCE(mem_pct_max, mem_pct)), NULL
      FROM samples
     WHERE tier = '${source}' AND ts >= ? AND ts < ?
     GROUP BY device_id, bucket`;
}

const rollupMinute = db.prepare(rollupSql("minute", "raw", 60_000));
const rollupHour = db.prepare(rollupSql("hour", "minute", 3_600_000));

/** Roll up everything that has finished since the last run. */
export function runRollups(now = Date.now()): void {
  const minuteEnd = Math.floor(now / 60_000) * 60_000;
  rollupMinute.run(minuteEnd - 10 * 60_000, minuteEnd);
  const hourEnd = Math.floor(now / 3_600_000) * 3_600_000;
  rollupHour.run(hourEnd - 3 * 3_600_000, hourEnd);
}

export function pruneSamples(retention: { rawHours: number; minuteDays: number; hourDays: number }): void {
  const now = Date.now();
  const stmt = db.prepare("DELETE FROM samples WHERE tier = ? AND ts < ?");
  stmt.run("raw", now - retention.rawHours * 3600_000);
  stmt.run("minute", now - retention.minuteDays * 86400_000);
  stmt.run("hour", now - retention.hourDays * 86400_000);
}

export function storageStats(): { devices: number; rows: number; sizeBytes: number } {
  const rows = (db.prepare("SELECT COUNT(*) AS n FROM samples").get() as { n: number }).n;
  const devices = (db.prepare("SELECT COUNT(DISTINCT device_id) AS n FROM samples").get() as { n: number }).n;
  const pageCount = (db.pragma("page_count", { simple: true }) as number) ?? 0;
  const pageSize = (db.pragma("page_size", { simple: true }) as number) ?? 0;
  return { devices, rows, sizeBytes: pageCount * pageSize };
}
