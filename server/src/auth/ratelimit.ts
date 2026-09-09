import { config } from "../config.js";
import { db } from "../db/index.js";

/**
 * Login throttling.
 *
 * The rule that matters: a correct password always works. Throttling slows
 * wrong guesses, it never stands between someone and their own account.
 *
 * Failures are counted against three keys, because each answers a different
 * question:
 *
 *  - `pair:<ip>|<username>`  someone guessing at one account from one place.
 *    This is the precise signal, and the only one that hard-blocks early.
 *  - `user:<username>`       one account under attack from anywhere. Adds delay
 *    only, so the owner is never locked out of their own account.
 *  - `ip:<address>`          one address guessing at many accounts. Hard-blocks,
 *    but at a high threshold: behind a reverse proxy or NAT every user shares
 *    one address, and normal people getting their password wrong must never
 *    lock out everyone else.
 */

export interface AttemptKeys {
  pair: string;
  user: string;
  ip: string;
}

export function attemptKeys(ip: string, username: string): AttemptKeys {
  const name = username.trim().toLowerCase();
  return { pair: `pair:${ip}|${name}`, user: `user:${name}`, ip: `ip:${ip}` };
}

export function recordLoginAttempt(key: string, ok: boolean): void {
  db.prepare("INSERT INTO login_attempts (key, ts, ok) VALUES (?, ?, ?)").run(key, Date.now(), ok ? 1 : 0);
}

export function recentFailures(key: string): number {
  const since = Date.now() - config.loginWindowSec * 1000;
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND ok = 0 AND ts >= ?")
    .get(key, since) as { n: number };
  return row.n;
}

export interface ThrottleDecision {
  /** Refuse before even looking at the password. */
  blocked: boolean;
  /** Milliseconds to wait before answering a wrong password. */
  delayMs: number;
}

/**
 * Delay grows with the number of recent failures, which is what makes guessing
 * impractical. It is applied only to answers that are already going to be
 * "wrong password", so it costs a legitimate user nothing.
 */
function delayFor(failures: number): number {
  if (failures < 3) return 0;
  const delay = 250 * 2 ** Math.min(failures - 3, 6);
  return Math.min(delay, config.loginMaxDelayMs);
}

export function evaluateThrottle(keys: AttemptKeys): ThrottleDecision {
  const pair = recentFailures(keys.pair);
  const ip = recentFailures(keys.ip);
  const user = recentFailures(keys.user);

  return {
    blocked: pair >= config.loginPairLimit || ip >= config.loginIpLimit,
    delayMs: delayFor(Math.max(pair, user)),
  };
}

export function recordFailure(keys: AttemptKeys): void {
  for (const key of [keys.pair, keys.user, keys.ip]) recordLoginAttempt(key, false);
}

/** A successful sign-in clears the slate for that person and that address. */
export function clearAttempts(keys: AttemptKeys): void {
  const stmt = db.prepare("DELETE FROM login_attempts WHERE key = ?");
  for (const key of [keys.pair, keys.user, keys.ip]) stmt.run(key);
}

export function purgeOldAttempts(): void {
  db.prepare("DELETE FROM login_attempts WHERE ts < ?").run(Date.now() - config.loginWindowSec * 1000 * 4);
}
