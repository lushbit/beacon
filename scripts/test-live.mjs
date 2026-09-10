#!/usr/bin/env node
/**
 * End-to-end check of the live pipeline.
 *
 * Boots the built hub, enrolls a fake agent, connects a browser-style client to
 * /live, pushes a sample through the agent socket, and asserts the browser
 * receives it without polling. This is the path behind every value on the
 * dashboard updating on its own.
 *
 * Run against a release build:  node scripts/test-live.mjs
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "release");
const require = createRequire(join(release, "package.json"));
const WebSocket = require("ws");

const PORT = 4899;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join("/tmp", `beacon-live-test-${Date.now()}.db`);

let server;
const failures = [];

function check(condition, description) {
  if (condition) {
    console.log(`  ok    ${description}`);
  } else {
    console.log(`  FAIL  ${description}`);
    failures.push(description);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves with the first message satisfying `predicate`, or rejects on timeout. */
function expectMessage(socket, predicate, description, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`timed out waiting for ${description}`));
    }, timeoutMs);

    function onMessage(raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!predicate(parsed)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(parsed);
    }

    socket.on("message", onMessage);
  });
}

async function startServer() {
  server = spawn(process.execPath, ["server/dist/index.js"], {
    cwd: release,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      SESSION_SECRET: randomUUID() + randomUUID(),
      DATABASE_PATH: DB,
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`    [hub] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`    [hub] ${chunk}`));

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(200);
  }
  throw new Error("the hub did not start");
}

const staticInfo = {
  hostname: "live-test",
  platform: "linux",
  distro: "Test",
  release: "1",
  kernel: "test",
  arch: "x64",
  cpuManufacturer: "Test",
  cpuBrand: "Test CPU",
  cpuCores: 4,
  cpuPhysicalCores: 4,
  memTotalBytes: 8 * 1024 ** 3,
  isVirtual: true,
  manufacturer: "Test",
  model: "Test",
  serial: null,
  agentVersion: "0.0.0-test",
  nodeVersion: process.versions.node,
  bootedAt: Date.now() - 60_000,
};

const capabilities = {
  docker: false,
  temperatures: false,
  gpu: false,
  battery: false,
  diskIo: false,
  processes: true,
  processKill: false,
};

function sampleWith(cpuPct) {
  return {
    ts: Date.now(),
    summary: {
      cpuPct,
      memPct: 40,
      memUsedBytes: 3 * 1024 ** 3,
      memTotalBytes: 8 * 1024 ** 3,
      swapPct: null,
      diskMaxPct: 20,
      diskUsedBytes: null,
      diskTotalBytes: null,
      diskReadBps: null,
      diskWriteBps: null,
      netRxBps: 1000,
      netTxBps: 2000,
      gpuPct: null,
      gpuMemPct: null,
      cpuTempC: null,
      load1: 0.5,
      load5: 0.4,
      load15: 0.3,
      uptimeSec: 1000,
      processCount: 100,
      batteryPct: null,
      containersRunning: null,
      containersTotal: null,
    },
    detail: {
      cpu: { perCore: [1, 2, 3, 4], speedGhz: null, temperatures: [] },
      disks: [],
      network: [],
      gpus: [],
      battery: null,
      topProcesses: [],
      containers: [],
    },
  };
}

async function main() {
  console.log("Starting the hub…");
  await startServer();

  console.log("Creating the first administrator…");
  const setup = await fetch(`${BASE}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "tester", password: "test-password-123", siteName: "Test" }),
  });
  check(setup.ok, "setup creates the first admin");
  const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0];
  check(Boolean(cookie), "setup returns a session cookie");

  console.log("Creating an enrollment token…");
  const tokenResponse = await fetch(`${BASE}/api/enroll-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ label: "test", expiresInHours: 1, maxUses: 1 }),
  });
  const enrollment = await tokenResponse.json();
  check(Boolean(enrollment.token), "enrollment token is issued");

  console.log("Connecting the agent…");
  const agent = new WebSocket(`ws://127.0.0.1:${PORT}/agent`);
  await new Promise((resolve, reject) => {
    agent.once("open", resolve);
    agent.once("error", reject);
  });
  agent.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      token: enrollment.token,
      installId: randomUUID(),
      staticInfo,
      capabilities,
    })
  );
  const ack = await expectMessage(agent, (m) => m.type === "hello_ack", "hello_ack");
  check(Boolean(ack.deviceId), "agent is accepted and given a device id");
  check(Boolean(ack.deviceToken), "agent receives its own device token");

  console.log("Connecting a browser-style live client…");
  const live = new WebSocket(`ws://127.0.0.1:${PORT}/live`, { headers: { Cookie: cookie } });
  await new Promise((resolve, reject) => {
    live.once("open", resolve);
    live.once("error", reject);
  });
  check(true, "/live accepts a session cookie");
  live.send(JSON.stringify({ type: "subscribe", deviceIds: "all" }));

  // Give the subscription a moment to land before pushing data through.
  await wait(250);

  console.log("Pushing a sample through the agent…");
  const pending = expectMessage(
    live,
    (m) => m.type === "sample" && m.deviceId === ack.deviceId,
    "live sample broadcast"
  );
  agent.send(JSON.stringify({ type: "sample", sample: sampleWith(73.5) }));

  try {
    const received = await pending;
    check(received.sample.summary.cpuPct === 73.5, "the live client receives the sample the agent sent");
  } catch (error) {
    check(false, `the live client receives the sample the agent sent (${error.message})`);
  }

  console.log("Pushing a second sample…");
  const second = expectMessage(
    live,
    (m) => m.type === "sample" && m.sample.summary.cpuPct === 12.5,
    "second live sample"
  );
  agent.send(JSON.stringify({ type: "sample", sample: sampleWith(12.5) }));
  try {
    await second;
    check(true, "further samples keep arriving without reconnecting");
  } catch (error) {
    check(false, `further samples keep arriving without reconnecting (${error.message})`);
  }

  console.log("Reporting capabilities found after the hello…");
  agent.send(JSON.stringify({ type: "capabilities", capabilities: { ...capabilities, temperatures: true } }));
  await wait(250);
  const device = await (await fetch(`${BASE}/api/devices/${ack.deviceId}`, { headers: { Cookie: cookie } })).json();
  check(device.capabilities?.temperatures === true, "capabilities sent after the hello are stored");

  console.log("Checking the offline notice…");
  const statusPending = expectMessage(
    live,
    (m) => m.type === "device_status" && m.deviceId === ack.deviceId && m.status === "offline",
    "device_status offline"
  );
  agent.close();
  try {
    await statusPending;
    check(true, "the dashboard is told when a device goes offline");
  } catch (error) {
    check(false, `the dashboard is told when a device goes offline (${error.message})`);
  }

  live.close();
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
    console.log("live pipeline ok");
    process.exit(0);
  });
