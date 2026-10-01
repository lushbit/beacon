import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  CANVAS_ACCESS,
  CANVAS_EMBED,
  CANVAS_RANGE_SECONDS,
  CANVAS_SLUG_PATTERN,
  canvasMetric,
  emptyCanvasContent,
  formatCanvasValue,
  sourceValue,
  thresholdLevel,
} from "@beacon/shared";
import type { CanvasBlock, CanvasContent, CanvasDeviceSnapshot, PublicCanvasDto } from "@beacon/shared";
import { audit } from "../audit.js";
import { actorOf, ipOf } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { allowRequest, normaliseOrigin, noteUnlockFailure, openCanvas, passwordToken, unlockBlocked } from "../canvas/access.js";
import { badgeSvg, type BadgeTone } from "../canvas/badge.js";
import { blockAlerts, blockSeries, blockUptime, cached, deviceMetas, forgetCached, pageSnapshots } from "../canvas/data.js";
import { blockOnlySchema, parseContent } from "../canvas/schema.js";
import {
  createCanvas,
  deleteCanvas,
  discardDraft,
  draftOf,
  getCanvasBySlug,
  getCanvasRow,
  listCanvasRows,
  publishCanvas,
  saveDraft,
  slugTaken,
  toCanvasDto,
  toCanvasSummary,
  updateCanvasSettings,
} from "../canvas/store.js";
import { bus } from "../events.js";
import { newToken } from "../utils/ids.js";
import { handler, notFound, parseBody } from "./helpers.js";

function changed(pageId: string): void {
  forgetCached(`page:${pageId}:`);
  bus.emit("canvas_changed", { pageId });
}

const slug = z.string().trim().toLowerCase().regex(CANVAS_SLUG_PATTERN, "use 2 to 48 lowercase letters, digits and dashes");

/* ------------------------------------------------------------------- admin */

export const canvasAdminRouter = Router();

canvasAdminRouter.get(
  "/",
  handler((_req, res) => {
    res.json(listCanvasRows().map(toCanvasSummary));
  })
);

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug,
  content: z.unknown().optional(),
});

canvasAdminRouter.post(
  "/",
  handler((req, res) => {
    const body = parseBody(createSchema, req, res);
    if (!body) return;
    if (slugTaken(body.slug)) {
      res.status(409).json({ error: "Another page already uses this address." });
      return;
    }
    let content: CanvasContent = emptyCanvasContent(body.title);
    if (body.content !== undefined) {
      const parsed = parseContent(body.content);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      content = parsed.content;
    }
    content.title = body.title;
    const row = createCanvas({ slug: body.slug, content, createdBy: req.user?.id ?? null });
    audit({ actor: actorOf(req), action: "canvas.create", target: row.slug, ip: ipOf(req) });
    res.status(201).json(toCanvasDto(row));
  })
);

/** Every device with all it reports, so the editor can offer and preview anything. */
canvasAdminRouter.get(
  "/devices",
  handler((_req, res) => {
    res.json(deviceMetas());
  })
);

const previewSchema = z.object({
  block: z.unknown(),
  range: z.number().int().optional(),
  tz: z.number().int().min(-840).max(840).optional(),
});

function previewBlock(req: Request, res: Response): { block: CanvasBlock; range: number; tz: number } | null {
  const body = parseBody(previewSchema, req, res);
  if (!body) return null;
  const parsed = blockOnlySchema.safeParse(body.block);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ error: first ? `block.${first.path.join(".")}: ${first.message}` : "Invalid block." });
    return null;
  }
  const range = body.range ?? 3600;
  if (!CANVAS_RANGE_SECONDS.includes(range)) {
    res.status(400).json({ error: "range: is not a range a chart can show" });
    return null;
  }
  return { block: parsed.data as CanvasBlock, range, tz: body.tz ?? 0 };
}

canvasAdminRouter.post(
  "/preview/series",
  handler((req, res) => {
    const input = previewBlock(req, res);
    if (input) res.json(blockSeries(input.block, input.range, deviceMetas()));
  })
);

canvasAdminRouter.post(
  "/preview/uptime",
  handler((req, res) => {
    const input = previewBlock(req, res);
    if (input) res.json(blockUptime(input.block, deviceMetas(), input.tz));
  })
);

canvasAdminRouter.post(
  "/preview/alerts",
  handler((req, res) => {
    const input = previewBlock(req, res);
    if (input) res.json(blockAlerts(input.block, deviceMetas()));
  })
);

canvasAdminRouter.get(
  "/:id",
  handler((req, res) => {
    const row = getCanvasRow(req.params.id);
    if (!row) return notFound(res, "Page not found.");
    res.json(toCanvasDto(row));
  })
);

const settingsSchema = z.object({
  slug: slug.optional(),
  access: z.enum(CANVAS_ACCESS).optional(),
  enabled: z.boolean().optional(),
  /** A new password, or null to remove it. */
  password: z.string().min(6, "must be at least 6 characters").max(200).nullable().optional(),
  regenerateKey: z.boolean().optional(),
  embed: z.enum(CANVAS_EMBED).optional(),
  embedOrigins: z.array(z.string().max(200)).max(50).optional(),
});

canvasAdminRouter.patch(
  "/:id",
  handler(async (req, res) => {
    const row = getCanvasRow(req.params.id);
    if (!row) return notFound(res, "Page not found.");
    const body = parseBody(settingsSchema, req, res);
    if (!body) return;

    if (body.slug && slugTaken(body.slug, row.id)) {
      res.status(409).json({ error: "Another page already uses this address." });
      return;
    }
    const access = body.access ?? row.access;
    const willHavePassword = body.password === undefined ? Boolean(row.password_hash) : body.password !== null;
    if (access === "password" && !willHavePassword) {
      res.status(400).json({ error: "Set a password before protecting the page with one." });
      return;
    }
    let origins: string[] | undefined;
    if (body.embedOrigins) {
      origins = [];
      for (const entry of body.embedOrigins) {
        if (!entry.trim()) continue;
        const origin = normaliseOrigin(entry);
        if (!origin) {
          res.status(400).json({ error: `"${entry}" is not a site address. Use the form https://example.com.` });
          return;
        }
        if (!origins.includes(origin)) origins.push(origin);
      }
    }

    updateCanvasSettings(row.id, {
      slug: body.slug,
      access: body.access,
      enabled: body.enabled,
      passwordHash: body.password === undefined ? undefined : body.password === null ? null : await hashPassword(body.password),
      shareKey: body.regenerateKey ? newToken(18) : undefined,
      embed: body.embed,
      embedOrigins: origins,
    });
    audit({
      actor: actorOf(req),
      action: "canvas.settings",
      target: body.slug ?? row.slug,
      detail: Object.keys(body)
        .filter((key) => key !== "password")
        .concat(body.password !== undefined ? ["password"] : [])
        .join(", "),
      ip: ipOf(req),
    });
    changed(row.id);
    res.json(toCanvasDto(getCanvasRow(row.id)!));
  })
);

const draftSchema = z.object({ content: z.unknown() });

canvasAdminRouter.put(
  "/:id/draft",
  handler((req, res) => {
    const row = getCanvasRow(req.params.id);
    if (!row) return notFound(res, "Page not found.");
    const body = parseBody(draftSchema, req, res);
    if (!body) return;
    const parsed = parseContent(body.content);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    saveDraft(row.id, parsed.content);
    res.json(toCanvasSummary(getCanvasRow(row.id)!));
  })
);

canvasAdminRouter.post(
  "/:id/publish",
  handler((req, res) => {
    const row = getCanvasRow(req.params.id);
    if (!row) return notFound(res, "Page not found.");
    publishCanvas(row.id);
    audit({ actor: actorOf(req), action: "canvas.publish", target: row.slug, ip: ipOf(req) });
    changed(row.id);
    res.json(toCanvasDto(getCanvasRow(row.id)!));
  })
);

canvasAdminRouter.post(
  "/:id/discard",
  handler((req, res) => {
    const row = getCanvasRow(req.params.id);
    if (!row) return notFound(res, "Page not found.");
    discardDraft(row.id);
    res.json(toCanvasDto(getCanvasRow(row.id)!));
  })
);

canvasAdminRouter.post(
  "/:id/duplicate",
  handler((req, res) => {
    const row = getCanvasRow(req.params.id);
    if (!row) return notFound(res, "Page not found.");
    let candidate = `${row.slug}-copy`.slice(0, 44);
    for (let attempt = 2; slugTaken(candidate); attempt += 1) candidate = `${row.slug.slice(0, 40)}-copy-${attempt}`;
    const content = draftOf(row);
    const copy = createCanvas({
      slug: candidate,
      content: { ...content, title: `${content.title} (copy)`.slice(0, 120) },
      createdBy: req.user?.id ?? null,
    });
    audit({ actor: actorOf(req), action: "canvas.create", target: copy.slug, detail: `copy of ${row.slug}`, ip: ipOf(req) });
    res.status(201).json(toCanvasDto(copy));
  })
);

canvasAdminRouter.delete(
  "/:id",
  handler((req, res) => {
    const row = getCanvasRow(req.params.id);
    if (!row) return notFound(res, "Page not found.");
    deleteCanvas(row.id);
    audit({ actor: actorOf(req), action: "canvas.delete", target: row.slug, ip: ipOf(req) });
    changed(row.id);
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ public */

export const canvasPublicRouter = Router();

canvasPublicRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!allowRequest(ipOf(req))) {
    res.status(429).json({ error: "Too many requests. Try again in a minute." });
    return;
  }
  next();
});

function credentials(req: Request) {
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value ?? "").slice(0, 200);
  };
  return { key: header("x-canvas-key"), token: header("x-canvas-token"), user: req.user };
}

function open(req: Request, res: Response) {
  const result = openCanvas(String(req.params.slug ?? "").toLowerCase(), credentials(req));
  if (!result.ok) {
    res.status(result.refusal.status).json({ error: result.refusal.error, code: result.refusal.code });
    return null;
  }
  return result;
}

canvasPublicRouter.get(
  "/:slug",
  handler((req, res) => {
    const page = open(req, res);
    if (!page) return;
    const { devices, blockDevices } = pageSnapshots(page.content);
    const body: PublicCanvasDto = {
      id: page.row.id,
      slug: page.row.slug,
      content: page.content,
      devices,
      blockDevices,
      publishedAt: page.row.published_at,
      badges: page.row.access === "public" || page.row.access === "unlisted",
    };
    res.json(body);
  })
);

canvasPublicRouter.post(
  "/:slug/unlock",
  handler(async (req, res) => {
    const row = getCanvasBySlug(String(req.params.slug ?? "").toLowerCase());
    if (!row || row.enabled !== 1 || row.live === null || row.access !== "password" || !row.password_hash) {
      return notFound(res, "This page does not exist or is not available.");
    }
    const ip = ipOf(req);
    if (unlockBlocked(ip, row.id)) {
      res.status(429).json({ error: "Too many wrong passwords. Try again in a few minutes." });
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 200) : "";
    if (!(await verifyPassword(password, row.password_hash))) {
      noteUnlockFailure(ip, row.id);
      res.status(403).json({ error: "That password is not right." });
      return;
    }
    res.json({ token: passwordToken(row) });
  })
);

canvasPublicRouter.get(
  "/:slug/live",
  handler((req, res) => {
    const page = open(req, res);
    if (!page) return;
    const value = cached(`page:${page.row.id}:live`, 2000, () => pageSnapshots(page.content).devices);
    res.json({ devices: value });
  })
);

function findBlock(content: CanvasContent, id: string): CanvasBlock | undefined {
  return content.blocks.find((block) => block.id === id);
}

canvasPublicRouter.get(
  "/:slug/blocks/:blockId/series",
  handler((req, res) => {
    const page = open(req, res);
    if (!page) return;
    const block = findBlock(page.content, req.params.blockId);
    if (!block || (block.type !== "chart" && block.type !== "value" && block.type !== "cores")) {
      return notFound(res, "Block not found.");
    }
    // A block with its own range always shows that one. Otherwise only the
    // ranges the page offers its visitors can be asked for.
    const own = block.config.range;
    const asked = Number.parseInt(String(req.query.range ?? ""), 10);
    const options = page.content.options;
    const range = own ?? (asked === options.defaultRange || options.visitorRanges.includes(asked) ? asked : options.defaultRange);
    const key = `page:${page.row.id}:${page.row.published_at}:series:${block.id}:${range}`;
    res.json(cached(key, range <= 21_600 ? 5000 : 60_000, () => blockSeries(block, range, deviceMetas())));
  })
);

canvasPublicRouter.get(
  "/:slug/blocks/:blockId/uptime",
  handler((req, res) => {
    const page = open(req, res);
    if (!page) return;
    const block = findBlock(page.content, req.params.blockId);
    if (!block || block.type !== "uptime") return notFound(res, "Block not found.");
    const tz = Math.max(-840, Math.min(840, Number.parseInt(String(req.query.tz ?? "0"), 10) || 0));
    const key = `page:${page.row.id}:${page.row.published_at}:uptime:${block.id}:${tz}`;
    res.json(cached(key, 5 * 60_000, () => blockUptime(block, deviceMetas(), tz)));
  })
);

canvasPublicRouter.get(
  "/:slug/blocks/:blockId/alerts",
  handler((req, res) => {
    const page = open(req, res);
    if (!page) return;
    const block = findBlock(page.content, req.params.blockId);
    if (!block || block.type !== "alerts") return notFound(res, "Block not found.");
    const key = `page:${page.row.id}:${page.row.published_at}:alerts:${block.id}`;
    res.json(cached(key, 10_000, () => blockAlerts(block, deviceMetas())));
  })
);

/* ------------------------------------------------------------------ badges */

export const canvasBadgeRouter = Router();

function sendBadge(res: Response, status: number, label: string, value: string, tone: BadgeTone): void {
  res.status(status);
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  // Image proxies such as the one GitHub puts in front of README images keep
  // what they are allowed to, so tell them not to.
  res.setHeader("Cache-Control", "no-cache, max-age=0");
  res.send(badgeSvg(label, value, tone));
}

/** The label, value and colour a block's badge shows, or null when it has no badge. */
function badgeFor(
  block: CanvasBlock,
  content: CanvasContent,
  devices: CanvasDeviceSnapshot[],
  blockDevices: Record<string, string[]>
): { label: string; value: string; tone: BadgeTone } | null {
  const snapshots = Object.fromEntries(devices.map((device) => [device.id, device]));
  const ids = blockDevices[block.id] ?? [];
  if (block.type === "value" || block.type === "gauge") {
    const metric = canvasMetric(block.config.source.metric);
    if (!metric) return null;
    const value = sourceValue(block.config.source, ids, snapshots);
    const level = thresholdLevel(value, block.config.thresholds);
    return {
      label: block.title || metric.label,
      value: value === null ? "no data" : formatCanvasValue(value, metric.unit, content.options),
      tone: value === null ? "muted" : level === "critical" ? "critical" : level === "warning" ? "warning" : "ok",
    };
  }
  if (block.type === "status") {
    const online = ids.filter((id) => snapshots[id]?.status === "online").length;
    const label = block.title || "status";
    if (ids.length === 0) return { label, value: "no devices", tone: "muted" };
    if (ids.length === 1) return { label, value: online ? "online" : "offline", tone: online ? "ok" : "critical" };
    return {
      label,
      value: `${online} of ${ids.length} online`,
      tone: online === ids.length ? "ok" : online === 0 ? "critical" : "warning",
    };
  }
  return null;
}

canvasBadgeRouter.get(
  "/p/:slug/badge/:blockId.svg",
  handler((req, res) => {
    if (!allowRequest(ipOf(req))) return sendBadge(res, 429, "beacon", "slow down", "muted");
    const key = typeof req.query.key === "string" ? req.query.key.slice(0, 200) : "";
    const page = openCanvas(String(req.params.slug).toLowerCase(), { key, token: "", user: undefined });
    // Badges are images other sites show, so they never carry a password or a
    // session. Only public and unlisted pages have them.
    if (!page.ok || (page.row.access !== "public" && page.row.access !== "unlisted")) {
      return sendBadge(res, 404, "beacon", "not found", "muted");
    }
    const block = findBlock(page.content, req.params.blockId);
    if (!block) return sendBadge(res, 404, "beacon", "not found", "muted");
    const value = cached(`page:${page.row.id}:${page.row.published_at}:badge:${block.id}`, 5000, () => {
      const { devices, blockDevices } = pageSnapshots(page.content);
      return badgeFor(block, page.content, devices, blockDevices);
    });
    if (!value) return sendBadge(res, 404, "beacon", "no badge", "muted");
    sendBadge(res, 200, value.label, value.value, value.tone);
  })
);
