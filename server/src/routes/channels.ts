import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import { actorOf, ipOf, requireAdmin } from "../auth/middleware.js";
import {
  createChannel,
  deleteChannel,
  getChannel,
  listChannels,
  toChannelDto,
  updateChannel,
} from "../alerts/repo.js";
import { testChannel } from "../alerts/notify.js";
import { handler, notFound, parseBody } from "./helpers.js";

export const channelsRouter = Router();

channelsRouter.use(requireAdmin);

channelsRouter.get(
  "/",
  handler((_req, res) => {
    res.json(listChannels().map((row) => toChannelDto(row)));
  })
);

const configSchema = z.record(z.string().max(500)).refine((value) => Object.keys(value).length <= 12, {
  message: "Too many configuration keys.",
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(["ntfy", "webhook", "discord"]),
  enabled: z.boolean().default(true),
  minSeverity: z.enum(["info", "warning", "critical"]).default("warning"),
  config: configSchema,
});

channelsRouter.post(
  "/",
  handler((req, res) => {
    const body = parseBody(createSchema, req, res);
    if (!body) return;
    const row = createChannel(body);
    audit({ actor: actorOf(req), action: "channel.created", target: row.id, detail: row.name, ip: ipOf(req) });
    res.status(201).json(toChannelDto(row));
  })
);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
  minSeverity: z.enum(["info", "warning", "critical"]).optional(),
  config: configSchema.optional(),
});

channelsRouter.patch(
  "/:id",
  handler((req, res) => {
    if (!getChannel(req.params.id)) return notFound(res, "Channel not found.");
    const body = parseBody(patchSchema, req, res);
    if (!body) return;
    const row = updateChannel(req.params.id, body);
    if (!row) return notFound(res, "Channel not found.");
    audit({ actor: actorOf(req), action: "channel.updated", target: row.id, detail: row.name, ip: ipOf(req) });
    res.json(toChannelDto(row));
  })
);

channelsRouter.post(
  "/:id/test",
  handler(async (req, res) => {
    const row = getChannel(req.params.id);
    if (!row) return notFound(res, "Channel not found.");
    const result = await testChannel(row);
    audit({ actor: actorOf(req), action: "channel.tested", target: row.id, detail: result.ok ? "ok" : result.error, ip: ipOf(req) });
    res.status(result.ok ? 200 : 502).json(result);
  })
);

channelsRouter.delete(
  "/:id",
  handler((req, res) => {
    const row = getChannel(req.params.id);
    if (!row) return notFound(res, "Channel not found.");
    deleteChannel(row.id);
    audit({ actor: actorOf(req), action: "channel.deleted", target: row.id, detail: row.name, ip: ipOf(req) });
    res.json({ ok: true });
  })
);
