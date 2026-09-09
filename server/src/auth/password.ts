import bcrypt from "bcryptjs";

const ROUNDS = 12;

/**
 * Compared against when the username does not exist, so a missing account takes
 * the same time as a wrong password.
 */
export const DUMMY_HASH = bcrypt.hashSync("beacon-nonexistent-account", ROUNDS);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

/** Deliberately simple rules: long enough, and not one of the obvious ones. */
const COMMON = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwertyuiop",
  "letmein123",
  "administrator",
]);

export function checkPasswordStrength(plain: string): PasswordCheck {
  if (plain.length < 10) return { ok: false, reason: "Password must be at least 10 characters." };
  if (plain.length > 200) return { ok: false, reason: "Password must be at most 200 characters." };
  if (COMMON.has(plain.toLowerCase())) return { ok: false, reason: "That password is too common." };
  if (/^(.)\1+$/.test(plain)) return { ok: false, reason: "Password cannot be a single repeated character." };
  return { ok: true };
}
