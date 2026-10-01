import { createHmac } from "node:crypto";
import type { CanvasContent } from "@beacon/shared";
import { config } from "../config.js";
import type { UserRow } from "../auth/users.js";
import { parseJson } from "../db/index.js";
import { safeEqual } from "../utils/ids.js";
import { getCanvasBySlug, liveOf, type CanvasRow } from "./store.js";

export type CanvasRefusal =
  | { status: 404; code: "not_found"; error: string }
  | { status: 401; code: "password"; error: string }
  | { status: 401; code: "signin"; error: string };

export interface CanvasCredentials {
  key: string;
  token: string;
  user: UserRow | undefined;
}

const NOT_FOUND: CanvasRefusal = { status: 404, code: "not_found", error: "This page does not exist or is not available." };

/** Proof of the password, valid until the password changes. */
export function passwordToken(row: CanvasRow): string {
  return createHmac("sha256", config.sessionSecret)
    .update(`canvas:${row.id}:${row.password_hash ?? ""}`)
    .digest("base64url");
}

/**
 * Opens a page for a visitor or explains why not. A page that is switched off,
 * has never been published, or wants a key that was not given answers exactly
 * like one that does not exist, so its address cannot be confirmed by guessing.
 */
export function openCanvas(
  slug: string,
  credentials: CanvasCredentials
): { ok: true; row: CanvasRow; content: CanvasContent } | { ok: false; refusal: CanvasRefusal } {
  const row = getCanvasBySlug(slug);
  if (!row || row.enabled !== 1) return { ok: false, refusal: NOT_FOUND };
  const content = liveOf(row);
  if (!content) return { ok: false, refusal: NOT_FOUND };

  switch (row.access) {
    case "public":
      break;
    case "unlisted":
      if (!credentials.key || !safeEqual(credentials.key, row.share_key)) return { ok: false, refusal: NOT_FOUND };
      break;
    case "password":
      if (!row.password_hash) return { ok: false, refusal: NOT_FOUND };
      if (!credentials.token || !safeEqual(credentials.token, passwordToken(row))) {
        return { ok: false, refusal: { status: 401, code: "password", error: "This page needs a password." } };
      }
      break;
    case "users":
      if (!credentials.user || credentials.user.is_active !== 1) {
        return { ok: false, refusal: { status: 401, code: "signin", error: "Sign in to Beacon to see this page." } };
      }
      break;
  }
  return { ok: true, row, content };
}

/* -------------------------------------------------------------- embedding */

/** `https://example.com`, `http://host:8080` or `https://*.example.com`. */
const ORIGIN = /^https?:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/i;

export function normaliseOrigin(input: string): string | null {
  const value = input.trim().replace(/\/+$/, "").toLowerCase();
  return ORIGIN.test(value) ? value : null;
}

/** The frame-ancestors directive for a page, from who may embed it. */
export function frameAncestors(row: CanvasRow | undefined): string {
  if (!row || row.enabled !== 1) return "'none'";
  if (row.embed === "any") return "*";
  if (row.embed === "list") {
    const origins = parseJson<string[]>(row.embed_origins, []).filter((origin) => normaliseOrigin(origin) !== null);
    return origins.length > 0 ? ["'self'", ...origins].join(" ") : "'self'";
  }
  return "'self'";
}

/* ------------------------------------------------------------- throttling */

/**
 * Public requests per address per minute. Generous, since one page with forty
 * blocks makes forty requests when it opens, and behind NAT a whole office
 * shares one address.
 */
const REQUESTS_PER_MINUTE = 600;
const requestLog = new Map<string, { windowStart: number; count: number }>();

export function allowRequest(ip: string): boolean {
  const now = Date.now();
  const entry = requestLog.get(ip);
  if (!entry || now - entry.windowStart >= 60_000) {
    requestLog.set(ip, { windowStart: now, count: 1 });
    if (requestLog.size > 10_000) {
      for (const [key, value] of requestLog) if (now - value.windowStart >= 60_000) requestLog.delete(key);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= REQUESTS_PER_MINUTE;
}

/** Wrong passwords per address and page before the page stops listening for a while. */
const UNLOCK_LIMIT = 10;
const UNLOCK_WINDOW_MS = 15 * 60_000;
const unlockFailures = new Map<string, number[]>();

export function unlockBlocked(ip: string, pageId: string): boolean {
  const key = `${ip}|${pageId}`;
  const now = Date.now();
  const recent = (unlockFailures.get(key) ?? []).filter((ts) => now - ts < UNLOCK_WINDOW_MS);
  unlockFailures.set(key, recent);
  return recent.length >= UNLOCK_LIMIT;
}

export function noteUnlockFailure(ip: string, pageId: string): void {
  const key = `${ip}|${pageId}`;
  const list = unlockFailures.get(key) ?? [];
  list.push(Date.now());
  unlockFailures.set(key, list);
  if (unlockFailures.size > 10_000) {
    const now = Date.now();
    for (const [entry, times] of unlockFailures) if (times.every((ts) => now - ts >= UNLOCK_WINDOW_MS)) unlockFailures.delete(entry);
  }
}

/** Page sockets per address, so one visitor cannot hold the hub open a thousand times. */
export const SOCKETS_PER_ADDRESS = 40;
