#!/usr/bin/env node
/**
 * Login throttling must stop guessing without ever standing between someone and
 * their own account. Behind a reverse proxy every user shares one address, so
 * the important property is that one person's wrong password cannot lock anyone
 * else out.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "release");
const PORT = 4903;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join("/tmp", `beacon-throttle-${Date.now()}.db`);

const PAIR_LIMIT = 5;
let server;
const failures = [];

function check(condition, description) {
  console.log(`  ${condition ? "ok  " : "FAIL"}  ${description}`);
  if (!condition) failures.push(description);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(username, password) {
  const response = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, cookie: (response.headers.get("set-cookie") ?? "").split(";")[0] };
}

async function start() {
  server = spawn(process.execPath, ["server/dist/index.js"], {
    cwd: release,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      SESSION_SECRET: randomUUID() + randomUUID(),
      DATABASE_PATH: DB,
      LOG_LEVEL: "error",
      // Keep the test quick; the logic under test is unchanged.
      LOGIN_MAX_DELAY_MS: "10",
      LOGIN_PAIR_LIMIT: String(PAIR_LIMIT),
      LOGIN_IP_LIMIT: "500",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (chunk) => process.stderr.write(`    [hub] ${chunk}`));

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await wait(200);
  }
  throw new Error("the hub did not start");
}

async function main() {
  await start();

  const setup = await fetch(`${BASE}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "alice", password: "alice-correct-password" }),
  });
  check(setup.ok, "first admin created");
  const adminCookie = (setup.headers.get("set-cookie") ?? "").split(";")[0];

  const created = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ username: "bob", password: "bob-correct-password", role: "viewer" }),
  });
  check(created.ok, "second account created");

  console.log("\nSomeone repeatedly gets alice's password wrong, from this address:");
  for (let i = 0; i < PAIR_LIMIT - 1; i += 1) {
    const result = await login("alice", "wrong-password");
    check(result.status === 401, `attempt ${i + 1} rejected`);
  }

  console.log("\nEveryone else must be unaffected:");
  const bob = await login("bob", "bob-correct-password");
  check(bob.status === 200, "bob can still sign in from the same address");

  console.log("\nAnd alice herself must still get in:");
  const alice = await login("alice", "alice-correct-password");
  check(alice.status === 200, "alice signs in with the correct password despite the failures");

  console.log("\nSustained guessing at one account is eventually refused:");
  for (let i = 0; i < PAIR_LIMIT; i += 1) await login("alice", "wrong-password");
  const blocked = await login("alice", "wrong-password");
  check(blocked.status === 429, "further guesses at alice are refused outright");

  const bobAgain = await login("bob", "bob-correct-password");
  check(bobAgain.status === 200, "bob is still unaffected while alice's account is blocked");
}

main()
  .catch((error) => {
    console.error(`\nunexpected failure: ${error.stack ?? error.message}`);
    failures.push(error.message);
  })
  .finally(async () => {
    server?.kill("SIGTERM");
    await wait(300);
    server?.kill("SIGKILL");
    console.log("");
    if (failures.length > 0) {
      console.error(`${failures.length} check(s) failed`);
      process.exit(1);
    }
    console.log("login throttling ok");
    process.exit(0);
  });
