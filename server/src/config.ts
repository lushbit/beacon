import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
/** dist/ and src/ are both one level below the server package root. */
export const serverRoot = path.resolve(here, "..");
export const repoRoot = path.resolve(serverRoot, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

const isProduction = process.env.NODE_ENV === "production";

let sessionSecret = process.env.SESSION_SECRET ?? "";
if (!sessionSecret || sessionSecret === "change-me") {
  if (isProduction) {
    throw new Error(
      "SESSION_SECRET must be set to a random value in production. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  // Development convenience only: sessions simply do not survive a restart.
  sessionSecret = randomBytes(48).toString("hex");
}

const databasePath = process.env.DATABASE_PATH || "data/beacon.db";

export const config = {
  isProduction,
  port: int(process.env.PORT, 4800),
  host: process.env.HOST || "0.0.0.0",
  sessionSecret,
  databasePath: path.isAbsolute(databasePath) ? databasePath : path.join(serverRoot, databasePath),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  clientDir: path.resolve(repoRoot, "client/dist"),
  /** Installer scripts and the agent bundle, produced by the release build. */
  publicDir: process.env.PUBLIC_DIR || path.resolve(repoRoot, "public"),
  /**
   * Login throttling. The per-address limit is deliberately high: behind a
   * reverse proxy every user shares one address, and one person mistyping their
   * password must not lock out everybody else.
   */
  loginWindowSec: int(process.env.LOGIN_WINDOW_SEC, 900),
  /** Failures from one address against one username before refusing outright. */
  loginPairLimit: int(process.env.LOGIN_PAIR_LIMIT, 20),
  /** Failures from one address across all usernames before refusing outright. */
  loginIpLimit: int(process.env.LOGIN_IP_LIMIT, 100),
  /** Upper bound on the delay added to a wrong-password answer. */
  loginMaxDelayMs: int(process.env.LOGIN_MAX_DELAY_MS, 8000),
} as const;
