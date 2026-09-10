import { Router } from "express";
import { z } from "zod";
import { UPDATE_POLICIES } from "@beacon/shared";
import type { DeviceSettingsDto, DeviceStaticInfo, ListProcessesResult } from "@beacon/shared";
import { activeAlertCounts } from "../alerts/repo.js";
import { audit } from "../audit.js";
import { actorOf, ipOf, requireAdmin } from "../auth/middleware.js";
import {
  agentCompatibility,
  createEnrollToken,
  deleteDevice,
  deleteEnrollToken,
  deviceCapabilities,
  deviceSettings,
  getDeviceRow,
  listDeviceRows,
  listEnrollTokens,
  rotateDeviceToken,
  toDeviceDto,
  toDeviceSummaryDto,
  toEnrollTokenDto,
  updateDevice,
  updateDeviceIdentity,
} from "../devices.js";
import { agentFor, isOnline, onlineDeviceIds, pushConfig } from "../hub/agents.js";
import {
  agentManifest,
  requestAgentUpdate,
  updateStateFor,
  UpdateNotPossible,
  agentNeedsUpdate,
} from "../agentUpdates.js";
import { getLatestSample, getLatestSamples, getSpark } from "../metrics/store.js";
import { mergeDeviceSettings } from "../settings.js";
import { handler, notFound, parseBody } from "./helpers.js";

export const devicesRouter = Router();

/** The build this hub would hand out, used for every compatibility decision. */
function target() {
  const manifest = agentManifest();
  return manifest
    ? { version: manifest.version, minProtocol: manifest.minProtocol, protocol: manifest.protocol }
    : null;
}

function describe(row: Parameters<typeof deviceSettings>[0]) {
  const info = row.static_info ? (JSON.parse(row.static_info) as { agentVersion?: string; protocolVersion?: number }) : null;
  return {
    compatibility: agentCompatibility(info?.agentVersion ?? null, info?.protocolVersion ?? null, target()),
    updateState: updateStateFor(row.id),
  };
}

devicesRouter.get(
  "/",
  handler((_req, res) => {
    const latest = getLatestSamples();
    const alerts = activeAlertCounts();
    const online = onlineDeviceIds();
    res.json(
      listDeviceRows().map((row) =>
        toDeviceSummaryDto(row, {
          online: online.has(row.id),
          latest: latest.get(row.id) ?? null,
          activeAlerts: alerts.get(row.id) ?? 0,
          spark: getSpark(row.id),
          ...describe(row),
        })
      )
    );
  })
);

devicesRouter.get(
  "/:id",
  handler((req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    res.json(
      toDeviceDto(row, {
        online: isOnline(row.id),
        latest: getLatestSample(row.id),
        activeAlerts: activeAlertCounts().get(row.id) ?? 0,
        ...describe(row),
      })
    );
  })
);

const settingsSchema = z.object({
  sampleIntervalMs: z.number().int().min(1000).max(300_000).optional(),
  allowProcessKill: z.boolean().optional(),
  updatePolicy: z.enum(UPDATE_POLICIES).nullable().optional(),
  offlineAfterSec: z.number().int().min(15).max(86_400).optional(),
  panels: z
    .object({
      panels: z.array(z.string()).max(40).optional(),
      hiddenDisks: z.array(z.string()).max(100).optional(),
      hiddenInterfaces: z.array(z.string()).max(100).optional(),
    })
    .optional(),
});

const devicePatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().trim().max(24).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  notes: z.string().max(2000).optional(),
  settings: settingsSchema.optional(),
});

devicesRouter.patch(
  "/:id",
  requireAdmin,
  handler((req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    const body = parseBody(devicePatchSchema, req, res);
    if (!body) return;

    const current = deviceSettings(row);
    const nextSettings: DeviceSettingsDto = body.settings
      ? mergeDeviceSettings({
          ...current,
          ...body.settings,
          panels: { ...current.panels, ...(body.settings.panels ?? {}) },
        })
      : current;

    const updated = updateDevice(row.id, { ...body, settings: nextSettings });
    if (!updated) return notFound(res, "Device not found.");

    // A connected agent should not have to wait for its next reconnect.
    pushConfig(row.id);
    audit({
      actor: actorOf(req),
      action: "device.updated",
      target: row.id,
      detail: Object.keys(body).join(", "),
      ip: ipOf(req),
    });
    res.json(
      toDeviceDto(updated, {
        online: isOnline(updated.id),
        latest: getLatestSample(updated.id),
        activeAlerts: activeAlertCounts().get(updated.id) ?? 0,
        ...describe(updated),
      })
    );
  })
);

devicesRouter.delete(
  "/:id",
  requireAdmin,
  handler((req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    agentFor(row.id)?.close("device removed");
    deleteDevice(row.id);
    audit({ actor: actorOf(req), action: "device.deleted", target: row.id, detail: row.name, ip: ipOf(req) });
    res.json({ ok: true });
  })
);

devicesRouter.post(
  "/:id/rotate-token",
  requireAdmin,
  handler((req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    const token = rotateDeviceToken(row.id);
    agentFor(row.id)?.close("token rotated");
    audit({ actor: actorOf(req), action: "device.token.rotated", target: row.id, ip: ipOf(req) });
    res.json({ token });
  })
);

devicesRouter.get(
  "/:id/processes",
  handler(async (req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    const agent = agentFor(row.id);
    if (!agent) {
      res.status(409).json({ error: "Device is offline." });
      return;
    }
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? "60"), 10) || 60, 300);
    const sortBy = req.query.sortBy === "mem" ? "mem" : "cpu";
    const result = (await agent.call("list_processes", { limit, sortBy })) as ListProcessesResult;
    res.json(result);
  })
);

const killSchema = z.object({ pid: z.number().int().positive(), signal: z.enum(["term", "kill"]).default("term") });

devicesRouter.post(
  "/:id/processes/kill",
  requireAdmin,
  handler(async (req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    if (!deviceSettings(row).allowProcessKill) {
      res.status(403).json({ error: "Ending processes is disabled for this device." });
      return;
    }
    const body = parseBody(killSchema, req, res);
    if (!body) return;
    const agent = agentFor(row.id);
    if (!agent) {
      res.status(409).json({ error: "Device is offline." });
      return;
    }
    await agent.call("kill_process", body);
    audit({
      actor: actorOf(req),
      action: "device.process.killed",
      target: row.id,
      detail: `pid ${body.pid} (${body.signal})`,
      ip: ipOf(req),
    });
    res.json({ ok: true });
  })
);

/** Asks a connected agent to re-read the machine's static details. */
devicesRouter.post(
  "/:id/refresh",
  requireAdmin,
  handler(async (req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    const agent = agentFor(row.id);
    if (!agent) {
      res.status(409).json({ error: "Device is offline." });
      return;
    }
    const staticInfo = (await agent.call("refresh_static")) as DeviceStaticInfo;
    updateDeviceIdentity(row.id, staticInfo, deviceCapabilities(row));
    audit({ actor: actorOf(req), action: "device.refreshed", target: row.id, ip: ipOf(req) });
    const updated = getDeviceRow(row.id)!;
    res.json(
      toDeviceDto(updated, {
        online: isOnline(updated.id),
        latest: getLatestSample(updated.id),
        activeAlerts: activeAlertCounts().get(updated.id) ?? 0,
        ...describe(updated),
      })
    );
  })
);

devicesRouter.post(
  "/:id/update",
  requireAdmin,
  handler(async (req, res) => {
    const row = getDeviceRow(req.params.id);
    if (!row) return notFound(res, "Device not found.");
    try {
      res.json(await requestAgentUpdate(row.id, actorOf(req)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the update.";
      res.status(error instanceof UpdateNotPossible ? 409 : 500).json({ error: message });
    }
  })
);

/* ------------------------------------------------------------- enrollment API */

export const enrollRouter = Router();
enrollRouter.use(requireAdmin);

enrollRouter.get(
  "/",
  handler((_req, res) => {
    res.json(listEnrollTokens().map((row) => toEnrollTokenDto(row)));
  })
);

const enrollSchema = z.object({
  label: z.string().trim().max(60).default(""),
  expiresInHours: z.number().int().min(1).max(8760).nullable().default(24),
  maxUses: z.number().int().min(0).max(1000).default(1),
});

enrollRouter.post(
  "/",
  handler((req, res) => {
    const body = parseBody(enrollSchema, req, res);
    if (!body) return;
    const { row, token } = createEnrollToken({
      label: body.label,
      createdBy: req.user!.username,
      expiresAt: body.expiresInHours === null ? null : Date.now() + body.expiresInHours * 3600_000,
      maxUses: body.maxUses,
    });
    audit({ actor: actorOf(req), action: "enroll.token.created", target: row.id, detail: body.label, ip: ipOf(req) });
    // The plaintext token is shown once, here, and never stored.
    res.status(201).json(toEnrollTokenDto(row, token));
  })
);

enrollRouter.delete(
  "/:id",
  handler((req, res) => {
    deleteEnrollToken(req.params.id);
    audit({ actor: actorOf(req), action: "enroll.token.deleted", target: req.params.id, ip: ipOf(req) });
    res.json({ ok: true });
  })
);
