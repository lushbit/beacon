import { Router } from "express";
import { z } from "zod";
import { UPDATE_POLICIES } from "@beacon/shared";
import { audit, listAudit } from "../audit.js";
import { actorOf, ipOf, requireAdmin } from "../auth/middleware.js";
import { db } from "../db/index.js";
import { pruneSamples, storageStats } from "../metrics/store.js";
import { getServerSettings, saveServerSettings } from "../settings.js";
import { checkForUpdates, versionInfo } from "../updates.js";
import { handler, parseBody } from "./helpers.js";

export const settingsRouter = Router();

export const versionRouter = Router();

versionRouter.get(
  "/",
  handler((_req, res) => {
    res.json(versionInfo());
  })
);

versionRouter.post(
  "/check",
  requireAdmin,
  handler(async (req, res) => {
    // Only the Check now button asks the release feed from here. Loading,
    // reloading or moving around the dashboard never does. A tab opened before
    // that change still asks with ?auto=1 on load, and gets the stored answer.
    if (req.query.auto === "1") {
      res.json(versionInfo());
      return;
    }
    res.json(await checkForUpdates(true));
  })
);

settingsRouter.get(
  "/",
  handler((_req, res) => {
    res.json(getServerSettings());
  })
);

settingsRouter.use(requireAdmin);

const patchSchema = z.object({
  siteName: z.string().trim().min(1).max(60).optional(),
  defaultSampleIntervalMs: z.number().int().min(1000).max(300_000).optional(),
  defaultOfflineAfterSec: z.number().int().min(15).max(86_400).optional(),
  sessionTtlHours: z.number().int().min(1).max(24 * 365).optional(),
  updateChecks: z.boolean().optional(),
  defaultUpdatePolicy: z.enum(UPDATE_POLICIES).optional(),
  updateWindowStartHour: z.number().int().min(0).max(23).optional(),
  updateWindowEndHour: z.number().int().min(0).max(23).optional(),
  retention: z
    .object({
      rawHours: z.number().int().min(1).max(24 * 30).optional(),
      minuteDays: z.number().int().min(1).max(365).optional(),
      hourDays: z.number().int().min(1).max(3650).optional(),
    })
    .optional(),
});

settingsRouter.patch(
  "/",
  handler((req, res) => {
    const body = parseBody(patchSchema, req, res);
    if (!body) return;
    const next = saveServerSettings(body);
    audit({ actor: actorOf(req), action: "settings.updated", detail: Object.keys(body).join(", "), ip: ipOf(req) });
    res.json(next);
  })
);

settingsRouter.get(
  "/storage",
  handler((_req, res) => {
    res.json(storageStats());
  })
);

settingsRouter.post(
  "/storage/prune",
  handler((req, res) => {
    pruneSamples(getServerSettings().retention);
    // VACUUM cannot run inside a transaction, and better-sqlite3 runs it fine here.
    db.exec("VACUUM");
    audit({ actor: actorOf(req), action: "storage.pruned", ip: ipOf(req) });
    res.json(storageStats());
  })
);

settingsRouter.get(
  "/audit",
  handler((req, res) => {
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? "200"), 10) || 200, 1000);
    res.json(listAudit(limit));
  })
);
