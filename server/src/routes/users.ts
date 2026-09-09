import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import { actorOf, ipOf, requireAdmin } from "../auth/middleware.js";
import { checkPasswordStrength, hashPassword } from "../auth/password.js";
import { destroyUserSessions } from "../auth/sessions.js";
import { countAdmins, createUser, findUserById, findUserByUsername, listUsers, toUserDto } from "../auth/users.js";
import { db } from "../db/index.js";
import { handler, notFound, parseBody } from "./helpers.js";

export const usersRouter = Router();

usersRouter.use(requireAdmin);

usersRouter.get(
  "/",
  handler((_req, res) => {
    res.json(listUsers().map(toUserDto));
  })
);

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores."),
  password: z.string(),
  displayName: z.string().trim().max(80).optional(),
  role: z.enum(["admin", "viewer"]),
});

usersRouter.post(
  "/",
  handler(async (req, res) => {
    const body = parseBody(createSchema, req, res);
    if (!body) return;

    if (findUserByUsername(body.username)) {
      res.status(409).json({ error: "That username is taken." });
      return;
    }
    const strength = checkPasswordStrength(body.password);
    if (!strength.ok) {
      res.status(400).json({ error: strength.reason });
      return;
    }

    const user = await createUser({
      username: body.username,
      password: body.password,
      role: body.role,
      displayName: body.displayName || body.username,
    });
    audit({ actor: actorOf(req), action: "user.created", target: user.id, detail: user.username, ip: ipOf(req) });
    res.status(201).json(toUserDto(user));
  })
);

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  role: z.enum(["admin", "viewer"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().optional(),
});

usersRouter.patch(
  "/:id",
  handler(async (req, res) => {
    const target = findUserById(req.params.id);
    if (!target) return notFound(res, "User not found.");
    const body = parseBody(patchSchema, req, res);
    if (!body) return;

    const demoting = (body.role && body.role !== "admin") || body.isActive === false;
    if (target.role === "admin" && demoting && countAdmins() <= 1) {
      res.status(400).json({ error: "There must always be one active admin." });
      return;
    }
    if (target.id === req.user!.id && body.isActive === false) {
      res.status(400).json({ error: "You cannot deactivate your own account." });
      return;
    }

    if (body.displayName !== undefined) {
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(body.displayName, target.id);
    }
    if (body.role !== undefined) {
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, target.id);
    }
    if (body.isActive !== undefined) {
      db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(body.isActive ? 1 : 0, target.id);
      if (!body.isActive) destroyUserSessions(target.id);
    }
    if (body.password) {
      const strength = checkPasswordStrength(body.password);
      if (!strength.ok) {
        res.status(400).json({ error: strength.reason });
        return;
      }
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(body.password), target.id);
      // Force the user to sign in again with the new password.
      destroyUserSessions(target.id);
    }

    audit({
      actor: actorOf(req),
      action: "user.updated",
      target: target.id,
      detail: Object.keys(body).join(", "),
      ip: ipOf(req),
    });
    res.json(toUserDto(findUserById(target.id)!));
  })
);

usersRouter.delete(
  "/:id",
  handler((req, res) => {
    const target = findUserById(req.params.id);
    if (!target) return notFound(res, "User not found.");
    if (target.id === req.user!.id) {
      res.status(400).json({ error: "You cannot delete your own account." });
      return;
    }
    if (target.role === "admin" && countAdmins() <= 1) {
      res.status(400).json({ error: "There must always be one active admin." });
      return;
    }
    destroyUserSessions(target.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
    audit({ actor: actorOf(req), action: "user.deleted", target: target.id, detail: target.username, ip: ipOf(req) });
    res.json({ ok: true });
  })
);
