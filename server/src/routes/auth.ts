import { Router } from "express";
import { z } from "zod";
import { DEFAULT_USER_PREFERENCES, DEVICE_SORTS } from "@beacon/shared";
import type { SessionDto, SetupStateDto } from "@beacon/shared";
import { audit } from "../audit.js";
import { actorOf, ipOf, requireAuth } from "../auth/middleware.js";
import { checkPasswordStrength, DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { attemptKeys, clearAttempts, evaluateThrottle, recordFailure } from "../auth/ratelimit.js";
import { createSession, destroySession, destroyUserSessions } from "../auth/sessions.js";
import {
  countUsers,
  createUser,
  findUserByUsername,
  toUserDto,
  updatePreferences,
  userPreferences,
} from "../auth/users.js";
import { db } from "../db/index.js";
import { getServerSettings, saveServerSettings } from "../settings.js";
import { checkForUpdatesOnLogin } from "../updates.js";
import { handler, parseBody } from "./helpers.js";

export const authRouter = Router();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores.");

authRouter.get(
  "/setup-state",
  handler((_req, res) => {
    const body: SetupStateDto = { needsSetup: countUsers() === 0, siteName: getServerSettings().siteName };
    res.json(body);
  })
);

const setupSchema = z.object({
  username: usernameSchema,
  password: z.string(),
  displayName: z.string().trim().max(80).optional(),
  siteName: z.string().trim().min(1).max(60).optional(),
});

/** Only usable while no account exists — the very first run of a new install. */
authRouter.post(
  "/setup",
  handler(async (req, res) => {
    if (countUsers() > 0) {
      res.status(409).json({ error: "Beacon is already set up." });
      return;
    }
    const body = parseBody(setupSchema, req, res);
    if (!body) return;

    const strength = checkPasswordStrength(body.password);
    if (!strength.ok) {
      res.status(400).json({ error: strength.reason });
      return;
    }

    const user = await createUser({
      username: body.username,
      password: body.password,
      role: "admin",
      displayName: body.displayName || body.username,
    });
    if (body.siteName) saveServerSettings({ siteName: body.siteName });

    createSession(user.id, req, res);
    audit({ actor: user.username, action: "setup.completed", target: user.id, ip: ipOf(req) });

    const session: SessionDto = { user: toUserDto(user), preferences: DEFAULT_USER_PREFERENCES };
    res.status(201).json(session);
  })
);

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  handler(async (req, res) => {
    const body = parseBody(loginSchema, req, res);
    if (!body) return;

    const ip = ipOf(req);
    const keys = attemptKeys(ip, body.username);
    const throttle = evaluateThrottle(keys);

    if (throttle.blocked) {
      audit({ actor: body.username, action: "auth.login.blocked", ip });
      res.status(429).json({ error: "Too many failed attempts for this account. Try again later." });
      return;
    }

    const user = findUserByUsername(body.username);
    // Always run a comparison so a missing account is not faster than a wrong password.
    const hash = user?.password_hash ?? DUMMY_HASH;
    const ok = await verifyPassword(body.password, hash);

    if (!user || !ok || user.is_active !== 1) {
      recordFailure(keys);
      audit({ actor: body.username, action: "auth.login.failed", ip });
      // The delay is applied only to a wrong answer, so someone signing in
      // correctly is never made to wait for other people's mistakes.
      if (throttle.delayMs > 0) await sleep(throttle.delayMs);
      res.status(401).json({ error: "Incorrect username or password." });
      return;
    }

    clearAttempts(keys);
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), user.id);
    // An admin is about to look at the dashboard, so make sure the release
    // information is fresh. Nobody else can act on a new version, so nobody
    // else's sign-in reaches out to the release feed. Not awaited, so signing
    // in stays instant.
    if (user.role === "admin") checkForUpdatesOnLogin();
    createSession(user.id, req, res);
    audit({ actor: user.username, action: "auth.login", target: user.id, ip });

    const session: SessionDto = { user: toUserDto(user), preferences: userPreferences(user) };
    res.json(session);
  })
);

authRouter.post(
  "/logout",
  handler((req, res) => {
    if (req.sessionId) destroySession(req.sessionId, res);
    res.json({ ok: true });
  })
);

authRouter.get(
  "/me",
  handler((req, res) => {
    if (!req.user) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    const session: SessionDto = { user: toUserDto(req.user), preferences: userPreferences(req.user) };
    res.json(session);
  })
);

const preferencesSchema = z.object({
  defaultRange: z.number().int().min(300).max(31_536_000).optional(),
  unitBase: z.union([z.literal(1000), z.literal(1024)]).optional(),
  temperatureUnit: z.enum(["c", "f"]).optional(),
  deviceSort: z.enum(DEVICE_SORTS).optional(),
  deviceSortDir: z.enum(["asc", "desc"]).optional(),
  compactCards: z.boolean().optional(),
  alertsSeenAt: z.number().int().min(0).optional(),
});

authRouter.patch(
  "/me/preferences",
  requireAuth,
  handler((req, res) => {
    const body = parseBody(preferencesSchema, req, res);
    if (!body) return;
    res.json(updatePreferences(req.user!.id, body));
  })
);

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
});

authRouter.patch(
  "/me",
  requireAuth,
  handler(async (req, res) => {
    const body = parseBody(profileSchema, req, res);
    if (!body) return;
    const user = req.user!;

    if (body.displayName) {
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(body.displayName, user.id);
    }

    if (body.newPassword) {
      if (!body.currentPassword || !(await verifyPassword(body.currentPassword, user.password_hash))) {
        res.status(400).json({ error: "Current password is incorrect." });
        return;
      }
      const strength = checkPasswordStrength(body.newPassword);
      if (!strength.ok) {
        res.status(400).json({ error: strength.reason });
        return;
      }
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(body.newPassword), user.id);
      // Every other session belonged to the old password.
      destroyUserSessions(user.id);
      createSession(user.id, req, res);
      audit({ actor: actorOf(req), action: "auth.password.changed", target: user.id, ip: ipOf(req) });
    }

    res.json({ ok: true });
  })
);
