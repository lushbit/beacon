import { Router } from "express";
import { z } from "zod";
import { ALERT_METRICS } from "@beacon/shared";
import { audit } from "../audit.js";
import { actorOf, ipOf, requireAdmin } from "../auth/middleware.js";
import {
  acknowledgeAlert,
  createRule,
  deleteRule,
  getAlert,
  getRule,
  listAlerts,
  listRules,
  toAlertDto,
  toRuleDto,
  updateRule,
} from "../alerts/repo.js";
import { db } from "../db/index.js";
import { getDeviceRow, listDeviceRows } from "../devices.js";
import { handler, notFound, parseBody } from "./helpers.js";

export const alertsRouter = Router();

function deviceNames(): Map<string, string> {
  return new Map(listDeviceRows().map((row) => [row.id, row.name]));
}

alertsRouter.get(
  "/",
  handler((req, res) => {
    const state = req.query.state === "firing" || req.query.state === "resolved" ? req.query.state : undefined;
    const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
    const limit = Math.min(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const names = deviceNames();
    res.json(listAlerts({ state, deviceId, limit }).map((row) => toAlertDto(row, names.get(row.device_id) ?? "Unknown")));
  })
);

alertsRouter.post(
  "/:id/acknowledge",
  handler((req, res) => {
    const row = getAlert(req.params.id);
    if (!row) return notFound(res, "Alert not found.");
    acknowledgeAlert(row.id, req.user!.username);
    audit({ actor: actorOf(req), action: "alert.acknowledged", target: row.id, ip: ipOf(req) });
    res.json(toAlertDto(getAlert(row.id)!, deviceNames().get(row.device_id) ?? "Unknown"));
  })
);

/* ---------------------------------------------------------------------- rules */

export const rulesRouter = Router();

rulesRouter.get(
  "/",
  handler((_req, res) => {
    res.json(listRules().map(toRuleDto));
  })
);

rulesRouter.use(requireAdmin);

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  deviceId: z.string().nullable(),
  metric: z.enum(ALERT_METRICS),
  operator: z.enum(["gt", "lt"]),
  threshold: z.number().finite(),
  durationSec: z.number().int().min(0).max(86_400),
  severity: z.enum(["info", "warning", "critical"]),
  cooldownSec: z.number().int().min(0).max(86_400),
  enabled: z.boolean(),
});

rulesRouter.post(
  "/",
  handler((req, res) => {
    const body = parseBody(ruleSchema, req, res);
    if (!body) return;
    if (body.deviceId && !getDeviceRow(body.deviceId)) return notFound(res, "Device not found.");
    const row = createRule(body);
    audit({ actor: actorOf(req), action: "alert.rule.created", target: row.id, detail: row.name, ip: ipOf(req) });
    res.status(201).json(toRuleDto(row));
  })
);

rulesRouter.patch(
  "/:id",
  handler((req, res) => {
    if (!getRule(req.params.id)) return notFound(res, "Rule not found.");
    const body = parseBody(ruleSchema.partial(), req, res);
    if (!body) return;
    const row = updateRule(req.params.id, body);
    if (!row) return notFound(res, "Rule not found.");
    // A changed threshold should not inherit the old breach timer.
    db.prepare("DELETE FROM rule_runtime WHERE rule_id = ?").run(row.id);
    audit({ actor: actorOf(req), action: "alert.rule.updated", target: row.id, detail: row.name, ip: ipOf(req) });
    res.json(toRuleDto(row));
  })
);

rulesRouter.delete(
  "/:id",
  handler((req, res) => {
    const row = getRule(req.params.id);
    if (!row) return notFound(res, "Rule not found.");
    deleteRule(row.id);
    audit({ actor: actorOf(req), action: "alert.rule.deleted", target: row.id, detail: row.name, ip: ipOf(req) });
    res.json({ ok: true });
  })
);
