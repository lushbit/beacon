import { DEFAULT_USER_PREFERENCES, DEVICE_SORTS } from "@beacon/shared";
import type { UserDto, UserPreferences, UserRole } from "@beacon/shared";
import { db, parseJson } from "../db/index.js";
import { newId } from "../utils/ids.js";
import { hashPassword } from "./password.js";

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  preferences: string;
  created_at: number;
  last_login_at: number | null;
}

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function userPreferences(row: UserRow): UserPreferences {
  const stored = { ...DEFAULT_USER_PREFERENCES, ...parseJson<Partial<UserPreferences>>(row.preferences, {}) };
  // A sort that has since been removed, such as the old Status column, falls
  // back to the default order.
  if (!DEVICE_SORTS.includes(stored.deviceSort)) return { ...stored, deviceSort: "none", deviceSortDir: "asc" };
  return stored;
}

export function findUserById(id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function listUsers(): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
}

export function countUsers(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return row.n;
}

export function countAdmins(activeOnly = true): number {
  const sql = activeOnly
    ? "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1"
    : "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'";
  const row = db.prepare(sql).get() as { n: number };
  return row.n;
}

export async function createUser(input: {
  username: string;
  password: string;
  role: UserRole;
  displayName?: string;
}): Promise<UserRow> {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, is_active, preferences, created_at)
     VALUES (?, ?, ?, ?, ?, 1, '{}', ?)`
  ).run(
    id,
    input.username,
    input.displayName ?? input.username,
    await hashPassword(input.password),
    input.role,
    now
  );
  return findUserById(id)!;
}

export function updatePreferences(userId: string, patch: Partial<UserPreferences>): UserPreferences {
  const row = findUserById(userId);
  if (!row) throw new Error("user not found");
  const next = { ...userPreferences(row), ...patch };
  db.prepare("UPDATE users SET preferences = ? WHERE id = ?").run(JSON.stringify(next), userId);
  return next;
}
