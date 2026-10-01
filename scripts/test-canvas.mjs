#!/usr/bin/env node
/**
 * End-to-end check of Beacon Canvas pages.
 *
 * Canvas is the one part of the hub that answers people without an account,
 * so this checks what a visitor can and cannot reach: only published pages,
 * only through the access rule each page sets, only the numbers its blocks
 * show, and never a hostname. It also checks the live page socket, badges and
 * the frame rules for embedding.
 *
 * Run against a release build:  node scripts/test-canvas.mjs
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

const PORT = 4898;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join("/tmp", `beacon-canvas-test-${Date.now()}.db`);
const HOSTNAME = "secret-host-name";

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
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await wait(200);
  }
  throw new Error("the hub did not start");
}

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
      drives: [],
      network: [{ iface: "eth0", rxBytesPerSec: 1000, txBytesPerSec: 2000, rxErrors: 0, txErrors: 0, operstate: "up" }],
      gpus: [],
      battery: null,
      topProcesses: [{ pid: 1, name: "secret-process", cpuPct: 1, memPct: 1, memBytes: 1, user: "root", command: "/sbin/secret", startedAt: null }],
      containers: [],
    },
  };
}

function block(type, id, at, config, extra = {}) {
  return { id, type, x: at[0], y: at[1], w: at[2], h: at[3], title: "", frame: true, config, ...extra };
}

async function main() {
  console.log("Starting the hub…");
  await startServer();

  const setup = await fetch(`${BASE}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "tester", password: "test-password-123", siteName: "Test" }),
  });
  const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0];
  check(setup.ok && Boolean(cookie), "setup creates the first admin");

  const admin = (path, init = {}) =>
    fetch(`${BASE}/api${path}`, { ...init, headers: { Cookie: cookie, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const visitor = (path, headers = {}) => fetch(`${BASE}/api/public/canvas${path}`, { headers });

  console.log("Connecting an agent…");
  const enrollment = await (
    await admin("/enroll-tokens", { method: "POST", body: JSON.stringify({ label: "web", color: "", expiresInHours: 1, maxUses: 1 }) })
  ).json();
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
      staticInfo: {
        hostname: HOSTNAME,
        platform: "linux",
        distro: "Debian",
        release: "13",
        kernel: "6.12",
        arch: "x64",
        cpuManufacturer: "Test",
        cpuBrand: "CPU",
        cpuCores: 4,
        cpuPhysicalCores: 4,
        memTotalBytes: 8 * 1024 ** 3,
        isVirtual: true,
        manufacturer: "Maker",
        model: "Box",
        serial: "SERIAL-123",
        agentVersion: "0.0.0-test",
        nodeVersion: process.versions.node,
        bootedAt: Date.now() - 60_000,
      },
      capabilities: { docker: false, temperatures: false, gpu: false, battery: false, diskIo: false, processes: true, processKill: false },
    })
  );
  const ack = await expectMessage(agent, (m) => m.type === "hello_ack", "hello_ack");
  const deviceId = ack.deviceId;
  // Ten minutes of readings every fifteen seconds, for the uptime bars.
  for (let ts = Date.now() - 10 * 60_000; ts < Date.now() - 5000; ts += 15_000) {
    agent.send(JSON.stringify({ type: "sample", sample: { ...sampleWith(30), ts } }));
  }
  agent.send(JSON.stringify({ type: "sample", sample: sampleWith(42) }));
  await wait(300);

  console.log("Creating a page…");
  const source = (metric) => ({ metric, field: "", sub: "", target: { kind: "device", deviceId } });
  const thresholds = { warn: 75, crit: 90, below: false };
  const content = {
    title: "Status",
    description: "",
    options: {
      defaultRange: 3600,
      visitorRanges: [3600, 86400],
      maxWidth: 1440,
      showHeader: true,
      showUpdated: true,
      unitBase: 1024,
      temperatureUnit: "c",
    },
    blocks: [
      block("value", "cpu", [0, 0, 4, 4], { source: source("cpu"), sparkline: true, range: null, thresholds, caption: "" }, { title: "CPU" }),
      block("chart", "chart", [4, 0, 12, 8], { source: source("network"), range: null, color: "ink", legend: true, showValue: true, alerts: false }),
      block("info", "info", [16, 0, 8, 7], { deviceId, fields: ["os", "cpu", "memory", "model"] }),
      block("status", "status", [0, 8, 6, 4], { select: { mode: "all", tag: "", ids: [] } }),
      block("uptime", "uptime", [6, 8, 18, 6], { select: { mode: "all", tag: "", ids: [] }, days: 30 }),
    ],
  };
  const created = await admin("/canvas", { method: "POST", body: JSON.stringify({ title: "Status", slug: "status", content }) });
  const page = await created.json();
  check(created.status === 201 && page.slug === "status", "an admin creates a page");

  const clash = await admin("/canvas", { method: "POST", body: JSON.stringify({ title: "Again", slug: "status" }) });
  check(clash.status === 409, "two pages cannot share an address");

  const badSlug = await admin("/canvas", { method: "POST", body: JSON.stringify({ title: "Bad", slug: "Not A Slug!" }) });
  check(badSlug.status === 400, "an address with spaces or capitals is refused");

  // The page above is written on the old 24 column grid, with no `grid` field.
  check(page.draft.grid === 48, "a page saved on the old grid comes back on the 48 column grid");
  check(page.draft.blocks[1].x === 8 && page.draft.blocks[1].w === 24, "its blocks keep their place by doubling every column");

  console.log("Checking what the editor may save…");
  {
    const colored = structuredClone(page.draft);
    colored.blocks[0].config.color = "#3987E5";
    const saved = await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content: colored }) });
    const reread = await (await admin(`/canvas/${page.id}`)).json();
    check(saved.ok && reread.draft.blocks[0].config.color === "#3987e5", "a value block keeps its colour");
    check(reread.draft.blocks[1].x === 8, "a page on the new grid is not doubled again");
    colored.blocks[0].config.color = "blue; x";
    const badColor = await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content: colored }) });
    check(badColor.status === 400, "a colour that is not a colour is refused");
    await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content }) });

    const wide = structuredClone(content);
    wide.blocks[0].x = 22;
    const res = await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content: wide }) });
    check(res.status === 400, "a block running past the right edge is refused");

    const unknown = structuredClone(content);
    unknown.blocks[0].config.source.metric = "secrets";
    const res2 = await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content: unknown }) });
    check(res2.status === 400, "a metric the hub does not know is refused");

    // Formatted text keeps only what a page can show. A script link, an unknown
    // node and a colour that is not a colour are all dropped on save.
    const rich = structuredClone(content);
    rich.blocks.push(
      block("text", "words", [0, 20, 12, 3], {
        text: "hello",
        size: "md",
        align: "left",
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "safe", marks: [{ type: "bold" }, { type: "link", attrs: { href: "javascript:alert(1)" } }] },
                { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "red; background:url(x)" } }] },
              ],
            },
            { type: "iframe", attrs: { src: "https://example.com" } },
          ],
        },
      })
    );
    const savedRich = await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content: rich }) });
    check(savedRich.ok, "a text block with formatting saves");
    const stored = (await (await admin(`/canvas/${page.id}`)).json()).draft.blocks.find((entry) => entry.id === "words");
    const storedText = JSON.stringify(stored?.config.doc ?? null);
    check(storedText.includes('"bold"') && storedText.includes("safe"), "formatting the page can show is kept");
    check(!storedText.includes("javascript") && !storedText.includes("iframe") && !storedText.includes("url(x)"), "script links, unknown nodes and bad colours are dropped");
    await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content }) });

    const dupes = structuredClone(content);
    dupes.blocks[1].id = "cpu";
    const res3 = await admin(`/canvas/${page.id}/draft`, { method: "PUT", body: JSON.stringify({ content: dupes }) });
    check(res3.status === 400, "two blocks with one id are refused");
  }

  console.log("Keeping drafts private…");
  check((await visitor("/status")).status === 404, "a page that was never published does not exist for visitors");

  const published = await admin(`/canvas/${page.id}/publish`, { method: "POST" });
  check(published.ok, "the page publishes");

  console.log("Opening it as a visitor…");
  {
    const res = await visitor("/status");
    const text = await res.text();
    check(res.ok, "a public page opens without an account");
    check(!text.includes(HOSTNAME), "the page never carries the device's hostname");
    check(!text.includes("SERIAL-123"), "or its serial number");
    check(!text.includes("secret-process"), "or its process list");
    const body = JSON.parse(text);
    const device = body.devices.find((entry) => entry.id === deviceId);
    check(device?.summary.cpuPct === 42, "the CPU block's number is there");
    check(device && !("memPct" in device.summary), "numbers no block shows are left out");
    check(device?.info?.os === "Debian 13" && device.info.cpu === "Test CPU", "the system info block gets the fields it asked for");
    check(device && !("kernel" in (device.info ?? {})), "and only those");
    check(Array.isArray(device?.ifaces), "the network chart gets its interfaces");
    check(device && device.perCore === undefined, "but not the per-core readings it does not use");

    const series = await (await visitor("/status/blocks/chart/series?range=3600")).json();
    check(series.keys.length === 2 && series.points.length > 0, "a chart's history is read by block");
    const sneaky = await (await visitor("/status/blocks/chart/series?range=2592000")).json();
    check(sneaky.to - sneaky.from === 3600 * 1000, "a range the page does not offer falls back to the default");
    check((await visitor("/status/blocks/nope/series")).status === 404, "a block that is not on the page is not found");
    check((await visitor("/status/blocks/info/series")).status === 404, "a block without history has none to give");

    // Days are counted in the visitor's time zone, which once made every day
    // read as empty because the offset turned the day number into a fraction.
    for (const tz of [0, 120, -300]) {
      const uptime = await (await visitor(`/status/blocks/uptime/uptime?tz=${tz}`)).json();
      const today = uptime.devices?.[0]?.values?.at(-1);
      check(uptime.days.length === 30 && typeof today === "number" && today > 90, `a device reporting all day is up today (time zone ${tz}, got ${today})`);
      check(uptime.devices[0].values.slice(0, -2).every((value) => value === null), `days before its first reading have no bar (time zone ${tz})`);
    }
  }

  console.log("Keeping the editor's endpoints private…");
  {
    const res = await fetch(`${BASE}/api/canvas/preview/series`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ block: content.blocks[0], range: 3600 }),
    });
    check(res.status === 401, "the preview needs a session");
    check((await fetch(`${BASE}/api/canvas/devices`)).status === 401, "the device list needs a session");

    await admin("/users", { method: "POST", body: JSON.stringify({ username: "viewer", password: "viewer-password-1", role: "viewer" }) });
    const login = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "viewer", password: "viewer-password-1" }),
    });
    const viewerCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const asViewer = await fetch(`${BASE}/api/canvas`, { headers: { Cookie: viewerCookie } });
    check(asViewer.status === 403, "a viewer cannot edit pages");
    globalThis.viewerCookie = viewerCookie;
  }

  console.log("Live updates on the page socket…");
  {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/live/canvas?slug=status`);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await wait(200);
    const pending = expectMessage(socket, (m) => m.type === "snapshot" && m.device.summary.cpuPct === 77, "a live snapshot");
    agent.send(JSON.stringify({ type: "sample", sample: sampleWith(77) }));
    try {
      const message = await pending;
      check(true, "a visitor's page moves on its own");
      const text = JSON.stringify(message);
      check(!text.includes(HOSTNAME) && !text.includes("secret-process"), "live snapshots are cut down the same way");
    } catch (error) {
      check(false, `a visitor's page moves on its own (${error.message})`);
    }
    const reload = expectMessage(socket, (m) => m.type === "reload", "reload");
    await admin(`/canvas/${page.id}/publish`, { method: "POST" });
    try {
      await reload;
      check(true, "publishing again tells open pages to reload");
    } catch (error) {
      check(false, `publishing again tells open pages to reload (${error.message})`);
    }
    socket.close();

    const refused = new WebSocket(`ws://127.0.0.1:${PORT}/live/canvas?slug=nope`);
    const outcome = await new Promise((resolve) => {
      refused.once("open", () => resolve("open"));
      refused.once("error", () => resolve("refused"));
      refused.once("unexpected-response", () => resolve("refused"));
    });
    check(outcome === "refused", "the socket refuses a page that does not exist");
  }

  console.log("Badges…");
  {
    const res = await fetch(`${BASE}/p/status/badge/cpu.svg`);
    const svg = await res.text();
    check(res.ok && res.headers.get("content-type")?.includes("image/svg+xml"), "a value block has a badge");
    check(svg.includes("CPU") && svg.includes("77%"), "the badge shows the block's title and current value");
    const status = await (await fetch(`${BASE}/p/status/badge/status.svg`)).text();
    check(status.includes("online"), "a status block's badge says whether the device is online");
    check((await fetch(`${BASE}/p/status/badge/chart.svg`)).status === 404, "a chart has no badge");
  }

  console.log("Embedding rules…");
  {
    const before = await fetch(`${BASE}/p/status`);
    check((before.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'self'"), "a page is not shown on other sites by default");
    await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ embed: "list", embedOrigins: ["https://example.com/"] }) });
    const listed = await fetch(`${BASE}/p/status`);
    const csp = listed.headers.get("content-security-policy") ?? "";
    check(csp.includes("frame-ancestors 'self' https://example.com"), "a listed site may show the page");
    check(listed.headers.get("x-frame-options") === null, "and the old frame header does not overrule it");
    const dashboard = await fetch(`${BASE}/`);
    check((dashboard.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), "the dashboard itself still refuses every frame");
    check(dashboard.headers.get("x-frame-options") === "DENY", "with the old header as well");
    const badOrigin = await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ embedOrigins: ["javascript:alert(1)"] }) });
    check(badOrigin.status === 400, "something that is not a site address is refused");
  }

  console.log("Unlisted pages…");
  {
    const res = await (await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ access: "unlisted" }) })).json();
    check((await visitor("/status")).status === 404, "without the key the page does not exist");
    check((await visitor("/status", { "X-Canvas-Key": "wrong" })).status === 404, "a wrong key is no better");
    check((await visitor("/status", { "X-Canvas-Key": res.shareKey })).ok, "with the key it opens");
    check((await fetch(`${BASE}/p/status/badge/cpu.svg?key=${res.shareKey}`)).ok, "its badges work with the key");
    const fresh = await (await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ regenerateKey: true }) })).json();
    check((await visitor("/status", { "X-Canvas-Key": res.shareKey })).status === 404, "a new link stops the old one working");
    check((await visitor("/status", { "X-Canvas-Key": fresh.shareKey })).ok, "and the new one works");
  }

  console.log("Password pages…");
  {
    const noPassword = await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ access: "password" }) });
    check(noPassword.status === 400, "a page cannot ask for a password it does not have");
    await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ access: "password", password: "open-sesame" }) });
    const locked = await visitor("/status");
    check(locked.status === 401 && (await locked.json()).code === "password", "the page asks for its password");
    const unlock = (password) =>
      fetch(`${BASE}/api/public/canvas/status/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    check((await unlock("wrong")).status === 403, "a wrong password is refused");
    const { token } = await (await unlock("open-sesame")).json();
    check(Boolean(token), "the right one gives a token");
    check((await visitor("/status", { "X-Canvas-Token": token })).ok, "which opens the page");
    check((await fetch(`${BASE}/p/status/badge/cpu.svg`)).status === 404, "password pages have no badges");
    await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ password: "another-one" }) });
    check((await visitor("/status", { "X-Canvas-Token": token })).status === 401, "changing the password signs every visitor out");
  }

  console.log("Pages for signed-in people…");
  {
    await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ access: "users" }) });
    const anonymous = await visitor("/status");
    check(anonymous.status === 401 && (await anonymous.json()).code === "signin", "without an account the page asks to sign in");
    check((await visitor("/status", { Cookie: globalThis.viewerCookie })).ok, "a viewer account opens it");
  }

  console.log("Taking a page down…");
  {
    await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ access: "public", enabled: false }) });
    check((await visitor("/status")).status === 404, "a page switched off is gone for visitors");
    await admin(`/canvas/${page.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    check((await visitor("/status")).ok, "and back once switched on");
    await admin(`/canvas/${page.id}`, { method: "DELETE" });
    check((await visitor("/status")).status === 404, "a deleted page is gone");
  }

  agent.close();
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
    console.log("canvas pages ok");
    process.exit(0);
  });
