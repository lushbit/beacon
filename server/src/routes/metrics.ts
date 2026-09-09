import { Router } from "express";
import { METRIC_TIERS } from "@beacon/shared";
import type { MetricSummary, MetricTier } from "@beacon/shared";
import { getDeviceRow } from "../devices.js";
import { pickTier, querySeries } from "../metrics/store.js";
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

    const fields = String(req.query.fields ?? "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean) as (keyof MetricSummary)[];

    res.json(querySeries(row.id, from, to, tier, fields));
  })
);
