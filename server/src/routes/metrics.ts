import { Router } from "express";
import { METRIC_TIERS } from "@beacon/shared";
import type { MetricSummary, MetricTier } from "@beacon/shared";
import { getDeviceRow } from "../devices.js";
import { pickTier, queryCoreSeries, queryDiskSeries, queryGpuSeries, queryNetSeries, querySeries } from "../metrics/store.js";
import { getServerSettings } from "../settings.js";
import { handler, notFound } from "./helpers.js";

export const metricsRouter = Router();

const MAX_RANGE_MS = 400 * 86400_000;

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

metricsRouter.get(
  "/:id/series",
  handler((req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");

    const now = Date.now();
    const to = parseNumber(req.query.to, now);
    const from = parseNumber(req.query.from, to - 3600_000);
    if (to <= from) {
      res.status(400).json({ error: "`to` must be after `from`." });
      return;
    }
    if (to - from > MAX_RANGE_MS) {
      res.status(400).json({ error: "Range is too large." });
      return;
    }

    const requestedTier = String(req.query.tier ?? "");
    const tier: MetricTier = (METRIC_TIERS as readonly string[]).includes(requestedTier)
      ? (requestedTier as MetricTier)
      : pickTier(from, to, getServerSettings().retention.rawHours);

    // A device with more than one GPU charts whichever the page asks for. The
    // answer is shaped like any other series, so the chart needs no special case.
    const gpu = req.query.gpu === undefined ? null : parseNumber(req.query.gpu, -1);
    if (gpu !== null) {
      if (gpu < 0 || gpu > 15) {
        res.status(400).json({ error: "`gpu` is out of range." });
        return;
      }
      res.json(queryGpuSeries(row.id, from, to, tier, gpu));
      return;
    }

    // Same idea for a machine with more than one drive.
    const disk = typeof req.query.disk === "string" ? req.query.disk.slice(0, 200) : "";
    if (disk) {
      res.json(queryDiskSeries(row.id, from, to, tier, disk));
      return;
    }

    // Every core at once, for the per-core chart.
    if (req.query.cores === "1") {
      res.json(queryCoreSeries(row.id, from, to, tier));
      return;
    }

    // And one network interface on its own.
    const iface = typeof req.query.iface === "string" ? req.query.iface.slice(0, 200) : "";
    if (iface) {
      res.json(queryNetSeries(row.id, from, to, tier, iface));
      return;
    }

    const fields = String(req.query.fields ?? "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean) as (keyof MetricSummary)[];

    res.json(querySeries(row.id, from, to, tier, fields));
  })
);
