import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { getServerSettings } from "../settings.js";
import { newToken, safeEqual } from "../utils/ids.js";

export const SESSION_COOKIE = "beacon_session";

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
}

function sign(value: string): string {
  return createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

/** Cookie value is `<id>.<hmac>`, so a stolen id alone cannot be replayed. */
function serialize(id: string): string {
  return `${id}.${sign(id)}`;
}

function deserialize(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!safeEqual(mac, sign(id))) return null;
  return id;
}

export function createSession(userId: string, req: Request, res: Response): SessionRow {
  const ttlMs = getServerSettings().sessionTtlHours * 3600_000;
  const now = Date.now();
  const row: SessionRow = {
    id: newToken(24),
    user_id: userId,
    created_at: now,
    expires_at: now + ttlMs,
    last_seen_at: now,
    ip: clientIp(req),
    user_agent: (req.headers["user-agent"] ?? "").toString().slice(0, 300),
  };
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (@id, @user_id, @created_at, @expires_at, @last_seen_at, @ip, @user_agent)`
  ).run(row);

  res.cookie(SESSION_COOKIE, serialize(row.id), {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction && config.trustProxy,
    maxAge: ttlMs,
    path: "/",
  });
  return row;
}

export function readSession(cookieValue: string | undefined): SessionRow | null {
  const id = deserialize(cookieValue);
  if (!id) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  return row;
}

export function touchSession(id: string): void {
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), id);
}

export function destroySession(id: string, res?: Response): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  res?.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function destroyUserSessions(userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function purgeExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

export function clientIp(req: Request): string {
  if (config.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
    if (first) return first.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}
