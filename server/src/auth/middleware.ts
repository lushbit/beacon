import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@beacon/shared";
import { db } from "../db/index.js";
import { clientIp, readSession, touchSession, SESSION_COOKIE } from "./sessions.js";
import { findUserById, type UserRow } from "./users.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      sessionId?: string;
    }
  }
}

export function loadSession(req: Request, _res: Response, next: NextFunction): void {
  const cookie = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const session = readSession(cookie);
  if (session) {
    const user = findUserById(session.user_id);
    if (user && user.is_active === 1) {
      req.user = user;
      req.sessionId = session.id;
      // Cheap keep-alive; a minute of granularity is plenty.
      if (Date.now() - session.last_seen_at > 60_000) touchSession(session.id);
    } else {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    }
  }
  next();
}

/**
 * Cookies are SameSite=strict, but state-changing requests additionally have to
 * come from our own origin. This blocks cross-origin form posts outright.
 */
export function verifyOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser clients (curl, scripts) never attach Origin and cannot be
    // tricked by a third-party page, so there is nothing to forge here.
    next();
    return;
  }
  const host = req.headers.host;
  try {
    if (new URL(origin).host === host) {
      next();
      return;
    }
  } catch {
    /* fall through to the rejection below */
  }
  res.status(403).json({ error: "Cross-origin request rejected." });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have access to this." });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole("admin");

export function actorOf(req: Request): string {
  return req.user ? `${req.user.username} (${req.user.id})` : "anonymous";
}

export function ipOf(req: Request): string {
  return clientIp(req);
}

