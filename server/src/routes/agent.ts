import { Router } from "express";
import { agentManifest, agentNeedsUpdate, requestAgentUpdate, updateStateFor } from "../agentUpdates.js";
import { actorOf, requireAdmin } from "../auth/middleware.js";
import { parseJson } from "../db/index.js";
import { listDeviceRows } from "../devices.js";
import { onlineDeviceIds } from "../hub/agents.js";
import { handler } from "./helpers.js";

export const agentRouter = Router();

agentRouter.get(
  "/manifest",
  handler((_req, res) => {
    const manifest = agentManifest();
    if (!manifest) {
      res.status(404).json({ error: "This hub has no agent build to hand out." });
      return;
    }
    res.json(manifest);
  })
);

/**
 * Updates every online agent that is behind. Requests are issued in sequence so
 * a fleet does not all restart in the same second; each returns as soon as the
 * agent accepts, not when it finishes.
 */
agentRouter.post(
  "/update-all",
  requireAdmin,
  handler(async (req, res) => {
    const manifest = agentManifest();
    if (!manifest) {
      res.status(409).json({ error: "This hub has no agent build to hand out." });
      return;
    }

    const online = onlineDeviceIds();
    const actor = actorOf(req);
    const results: { deviceId: string; name: string; ok: boolean; error?: string }[] = [];

    for (const row of listDeviceRows()) {
      if (!online.has(row.id)) continue;
      const version = parseJson<{ agentVersion?: string } | null>(row.static_info, null)?.agentVersion ?? null;
      if (!agentNeedsUpdate(version)) continue;

      try {
        await requestAgentUpdate(row.id, actor);
        results.push({ deviceId: row.id, name: row.name, ok: true });
      } catch (error) {
        results.push({
          deviceId: row.id,
          name: row.name,
          ok: false,
          error: error instanceof Error ? error.message : "Update failed.",
        });
      }
    }

    res.json({ version: manifest.version, started: results.filter((r) => r.ok).length, results });
  })
);

agentRouter.get(
  "/update-states",
  handler((_req, res) => {
    res.json(Object.fromEntries(listDeviceRows().map((row) => [row.id, updateStateFor(row.id)])));
  })
);
