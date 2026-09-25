#!/usr/bin/env node
/**
 * OS updates, in two halves.
 *
 * First the agent's parsers, against output copied from each tool. A tool that
 * changes its output format is the likeliest way for this feature to break, and
 * these are the only tests that can run without that tool installed.
 *
 * Then the hub's side, end to end: a scripted agent answers the hub's calls the
 * way a real one does, and a browser-style client watches the live socket. It
 * covers a check, an install, a cancel, a restart that comes back, an agent
 * that restarts part way through, and the device setting that turns it off.
 *
 * Run against a release build:  node scripts/test-os-updates.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "release");
const require = createRequire(join(release, "package.json"));
const WebSocket = require("ws");

const {
  parseAptList,
  parseDnfCheckUpdate,
  parseZypperUpdates,
  parsePacmanUpdates,
  parseApkVersions,
  parseSoftwareUpdate,
  parseWindowsList,
  WINDOWS_LIST,
  WINDOWS_INSTALL,
  WINDOWS_CIM_LIST,
  WINDOWS_CIM_INSTALL,
} = await import(pathToFileURL(join(root, "agent", "dist", "osUpdates.js")).href);

const PORT = 4898;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join("/tmp", `beacon-os-test-${Date.now()}.db`);

const failures = [];
let server;

function check(condition, description) {
  if (condition) {
    console.log(`  ok    ${description}`);
  } else {
    console.log(`  FAIL  ${description}`);
    failures.push(description);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ parsers */

console.log("apt…");
{
  const items = parseAptList(`Listing... Done
libssl3/stable-security 3.0.15-1~deb12u1 amd64 [upgradable from: 3.0.14-1~deb12u2]
linux-image-amd64/stable 6.1.119-1 amd64 [upgradable from: 6.1.115-1]
curl/stable 7.88.1-10+deb12u8 amd64 [upgradable from: 7.88.1-10+deb12u7]
WARNING: apt does not have a stable CLI interface. Use with caution in scripts.`);
  check(items.length === 3, "finds every upgradable package and nothing else");
  const ssl = items.find((entry) => entry.name === "libssl3");
  check(ssl?.security === true, "a package from the security suite is a security update");
  check(ssl?.currentVersion === "3.0.14-1~deb12u2" && ssl?.newVersion === "3.0.15-1~deb12u1", "reads both versions");
  check(items.find((entry) => entry.name === "linux-image-amd64")?.restart === true, "a kernel needs a restart");
  check(items.find((entry) => entry.name === "curl")?.security === false, "an ordinary update is not marked security");
}

console.log("dnf…");
{
  const items = parseDnfCheckUpdate(
    `Last metadata expiration check: 0:12:01 ago on Tue 24 Sep 2026 10:00:00 AM UTC.

kernel.x86_64                          6.10.10-200.fc40             updates
openssl-libs.x86_64                    1:3.2.2-3.fc40               updates
a-very-long-package-name-that-wraps.noarch
                                       2.1.0-1.fc40                 updates
Obsoleting Packages
foo.x86_64                             1-1                          updates`,
    new Map([["kernel.x86_64", "6.10.9-200.fc40"]]),
    ["openssl-libs-1:3.2.2-3.fc40.x86_64"]
  );
  check(items.length === 3, "finds every update and stops at the obsoletes");
  check(items.some((entry) => entry.name === "a-very-long-package-name-that-wraps"), "joins a name that wrapped");
  check(items.find((entry) => entry.name === "openssl-libs")?.security === true, "matches a security advisory");
  check(items.find((entry) => entry.name === "kernel")?.restart === true, "a kernel needs a restart");
  check(items.find((entry) => entry.name === "kernel")?.currentVersion === "6.10.9-200.fc40", "fills in the installed version");
  check(items.find((entry) => entry.name === "kernel")?.id === "kernel.x86_64", "keeps the architecture in the id");
}

console.log("zypper…");
{
  const items = parseZypperUpdates(`<?xml version='1.0'?>
<stream>
<update-status version="0.6">
<update-list>
<update kind="package" name="libopenssl3" edition="3.1.4-150600.5.15.1" arch="x86_64" edition-old="3.1.4-150600.5.12.1" >
<summary>Secure Sockets and Transport Layer Security</summary>
<source url="https://example.invalid/update" alias="repo-update"/>
</update>
<update kind="patch" name="SUSE-2024-1234" edition="1" arch="noarch">
</update>
</update-list>
</update-status>
</stream>`);
  check(items.length === 1, "keeps packages and leaves patches out");
  check(items[0]?.currentVersion === "3.1.4-150600.5.12.1" && items[0]?.newVersion === "3.1.4-150600.5.15.1", "reads both versions");
}

console.log("pacman…");
{
  const items = parsePacmanUpdates(`linux 6.10.9.arch1-1 -> 6.10.10.arch1-1
firefox 130.0-1 -> 130.0.1-1
held 1-1 -> 2-1 [ignored]`);
  check(items.length === 2, "finds the updates and skips ignored ones");
  check(items.find((entry) => entry.name === "linux")?.restart === true, "a kernel needs a restart");
}

console.log("apk…");
{
  const items = parseApkVersions(`Installed:                                Available:
openssl-3.3.1-r0                        < 3.3.2-r0
py3-foo-bar-1.2.3-r1                    < 1.2.4-r0`);
  check(items.length === 2, "finds every update");
  check(items[1]?.name === "py3-foo-bar" && items[1]?.currentVersion === "1.2.3-r1", "splits a dashed name from its version");
}

console.log("softwareupdate…");
{
  const items = parseSoftwareUpdate(`Software Update Tool

Finding available software
Software Update found the following new or updated software:
* Label: macOS Sonoma 14.7-23H124
	Title: macOS Sonoma 14.7, Version: 14.7, Size: 1638400KiB, Recommended: YES, Action: restart,
* Label: Safari18.0SonomaAuto-18.0
	Title: Safari, Version: 18.0, Size: 174132KiB, Recommended: YES,`);
  check(items.length === 2, "finds every update");
  check(items[0]?.id === "macOS Sonoma 14.7-23H124", "keeps the label, which is what installs it");
  check(items[0]?.restart === true && items[0]?.kind === "system", "a macOS update needs a restart");
  check(items[1]?.sizeBytes === 174132 * 1024, "reads the size");
  const old = parseSoftwareUpdate(`Software Update found the following new or updated software:
   * Safari12.1-12.1
	Safari (12.1), 64960K [recommended]`);
  check(old.length === 1 && old[0].newVersion === "12.1", "reads the format older releases print");
}

console.log("Windows Update…");
{
  const listed = parseWindowsList(
    `BEACON-JSON {"items":[{"id":"abc","title":"2024-09 Cumulative Update for Windows 11 (KB5043076)","kb":"KB5043076","size":754974720,"severity":"Critical","categories":"Security Updates|Windows 11","type":1,"reboot":1},{"id":"def","title":"Intel - Display - 31.0.101.5590","kb":"","size":0,"severity":"","categories":"Drivers","type":2,"reboot":0}],"reboot":true}`
  );
  check(listed.items.length === 2, "reads the list");
  check(listed.items[0].security && listed.items[0].restart && listed.items[0].title === "KB5043076", "a cumulative update is security and needs a restart");
  check(listed.items[1].kind === "driver" && listed.items[1].sizeBytes === null, "a driver is a driver");
  check(listed.rebootRequired, "reads the pending restart");
  const service = parseWindowsList(
    `BEACON-JSON {"items":[{"id":"a","title":"2024-09 Cumulative Update for Windows 11 Version 23H2 for x64-based Systems (KB5043076)","kb":"KB5043076","size":0,"severity":"Critical","categories":"","type":1,"reboot":0},{"id":"b","title":"Intel Corporation - Display - 31.0.101.5590","kb":"","size":0,"severity":"","categories":"","type":1,"reboot":0},{"id":"c","title":"Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.419.1)","kb":"KB2267602","size":0,"severity":"","categories":"","type":1,"reboot":0}],"reboot":false}`
  );
  check(service.items[0].security && service.items[0].restart, "from the service, a cumulative update still reads as security and restart");
  check(service.items[1].kind === "driver", "a driver is recognised by its title when there are no categories");
  check(service.items[1].optional === true && !service.items[0].optional, "and counts as optional, like in Settings");
  const browse = parseWindowsList(
    `BEACON-JSON {"items":[{"id":"d","title":"Dell Inc. Firmware Driver Update (0.1.35.0)","kb":"","size":41615360,"severity":"","categories":"Drivers","type":2,"reboot":0,"browseOnly":true},{"id":"e","title":"2026-09 Cumulative Update","kb":"KB5099999","size":1,"severity":"Critical","categories":"Security Updates","type":1,"reboot":1,"browseOnly":false}],"reboot":false}`
  );
  check(browse.items[0].optional === true && browse.items[1].optional === false, "Windows' own optional flag is used where it gives one");
  const picked = parseWindowsList(
    `BEACON-JSON {"items":[{"id":"f","title":"Intel Corporation Display Driver Update (32.0.101.7088)","kb":"","size":576716800,"severity":"","categories":"Drivers","type":2,"reboot":0,"browseOnly":false,"autoSelect":false},{"id":"g","title":"2026-09 Cumulative Update","kb":"KB5099999","size":1,"severity":"Critical","categories":"Security Updates","type":1,"reboot":1,"browseOnly":false,"autoSelect":true}],"reboot":false}`
  );
  check(
    picked.items[0].optional === true && picked.items[1].optional === false,
    "an update Windows would not pick by itself is optional, as Settings shows it"
  );
  const flags = parseWindowsList(
    `BEACON-JSON {"items":[` +
      `{"id":"p","title":"2026-09 Preview Update (KB5124010) (26200.9550)","kb":"KB5124010","size":1,"severity":"","categories":"Updates","type":1,"reboot":1,"browseOnly":false,"autoSelect":true,"autoSelection":0,"autoDownload":0,"deployment":4},` +
      `{"id":"d","title":"Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.459.389.0)","kb":"KB2267602","size":1825361100,"severity":"","categories":"Definition Updates","type":1,"reboot":0,"browseOnly":false,"autoSelect":true,"autoSelection":0,"autoDownload":0,"deployment":1},` +
      `{"id":"a","title":"Dell Inc. SoftwareComponent Driver Update (1.1.67.0)","kb":"","size":1,"severity":"","categories":"Drivers","type":2,"reboot":0,"browseOnly":false,"autoSelect":false,"autoSelection":3,"autoDownload":0,"deployment":1},` +
      `{"id":"m","title":"Intel System Driver Update (2.3.20306.4)","kb":"","size":1,"severity":"","categories":"Drivers","type":2,"reboot":0,"browseOnly":false,"autoSelect":false,"autoSelection":2,"autoDownload":1,"deployment":1}` +
      `],"reboot":false}`
  );
  check(flags.items[0].optional === true, "an optional install, such as a preview update, is optional");
  check(flags.items[1].optional === true && flags.items[1].sizeBytes === null, "Defender definitions are left to Defender, with no misleading size");
  check(flags.items[2].optional === false, "a driver Windows always picks is not optional");
  check(flags.items[3].optional === true, "a driver Windows never picks is");
  check(service.items[2].kind === "other" && !service.items[2].security, "a definitions update is neither a driver nor a security fix");
  const single = parseWindowsList(
    `BEACON-JSON {"items":{"id":"x","title":"One","kb":"","size":1,"severity":"","categories":"Updates","type":1,"reboot":0},"reboot":false}`
  );
  check(single.items.length === 1, "copes with PowerShell turning a list of one into an object");
  let message = "";
  try {
    parseWindowsList("BEACON-ERROR Exception from HRESULT: 0x8024402C");
  } catch (error) {
    message = error.message;
  }
  check(message.includes("0x8024402C"), "passes on Windows Update's own error");
}

// PowerShell is not here to run them, so the Windows Update scripts are left
// where the pipeline's PowerShell step checks that they parse.
{
  const dir = join(release, "ps");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "os-updates-list.ps1"), WINDOWS_LIST);
  writeFileSync(join(dir, "os-updates-install.ps1"), WINDOWS_INSTALL);
  writeFileSync(join(dir, "os-updates-service-list.ps1"), WINDOWS_CIM_LIST);
  writeFileSync(join(dir, "os-updates-service-install.ps1"), WINDOWS_CIM_INSTALL);
  check(existsSync(join(dir, "os-updates-install.ps1")), "the Windows Update scripts are written out for the PowerShell check");
}

console.log("Log lines…");
{
  const { formatLogLine, parseLogLine } = await import(pathToFileURL(join(root, "shared", "dist", "index.js")).href);
  const line = formatLogLine("WARN", "Search via Windows Update failed", Date.UTC(2026, 8, 24, 10, 21, 3));
  check(line === "2026-09-24T10:21:03.000Z WARN Search via Windows Update failed", "a log line is a time, a level and a message");
  const back = parseLogLine(line);
  check(back.level === "WARN" && back.text === "Search via Windows Update failed" && back.at === Date.UTC(2026, 8, 24, 10, 21, 3), "and reads back");
  check(parseLogLine("Checking for updates with windows").level === null, "a line from an older agent still reads as plain text");
}

/* ------------------------------------------------------------ hub pipeline */

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

const staticInfo = {
  hostname: "os-test",
  platform: "linux",
  distro: "Test",
  release: "1",
  kernel: "test",
  arch: "x64",
  cpuManufacturer: "Test",
  cpuBrand: "Test CPU",
  cpuCores: 2,
  cpuPhysicalCores: 2,
  memTotalBytes: 4 * 1024 ** 3,
  isVirtual: true,
  manufacturer: "Test",
  model: "Test",
  serial: null,
  agentVersion: "0.0.0-test",
  protocolVersion: 1,
  timezone: null,
  nodeVersion: process.versions.node,
  bootedAt: Date.now() - 60_000,
};

const capabilities = {
  docker: false,
  selfUpdate: false,
  temperatures: false,
  gpu: false,
  battery: false,
  diskIo: false,
  processes: true,
  processKill: false,
  osUpdates: true,
};

const ITEMS = [
  { id: "libssl3", name: "libssl3", title: null, currentVersion: "1", newVersion: "2", sizeBytes: null, security: true, restart: false, kind: "package" },
  { id: "linux-image-amd64", name: "linux-image-amd64", title: null, currentVersion: "6.1", newVersion: "6.2", sizeBytes: null, security: false, restart: true, kind: "package" },
];

function inventory(items, rebootRequired = false) {
  return { supported: true, reason: null, manager: "apt", checkedAt: Date.now(), items, rebootRequired, canSelect: true, notes: [] };
}

function snapshot(jobId, kind, patch = {}) {
  return {
    id: jobId,
    kind,
    state: "running",
    phase: "starting",
    progress: null,
    current: null,
    stepDone: null,
    stepTotal: null,
    cancellable: true,
    rebootRequired: false,
    results: [],
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    ...patch,
  };
}

/**
 * Plays the agent. `behaviour` decides what each job does, so a test can hold
 * a job open, cancel it or drop the connection part way.
 */
class FakeAgent {
  constructor(token, installId) {
    this.token = token;
    this.installId = installId;
    this.inventory = inventory(ITEMS);
    this.job = null;
    this.log = [];
    this.behaviour = {};
  }

  async connect() {
    this.socket = new WebSocket(`ws://127.0.0.1:${PORT}/agent`);
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (raw) => void this.handle(JSON.parse(raw.toString())));
    this.send({ type: "hello", protocolVersion: 1, token: this.token, installId: this.installId, staticInfo, capabilities });
    return new Promise((resolve) => {
      this.onAck = resolve;
    });
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  emit(patch, lines = [], withInventory = false) {
    this.job = { ...this.job, ...patch };
    this.log.push(...lines);
    this.send({ type: "os_update_event", job: this.job, log: lines, ...(withInventory ? { inventory: this.inventory } : {}) });
  }

  close() {
    this.socket.close();
    return wait(300);
  }

  async handle(message) {
    if (message.type === "hello_ack") {
      if (message.deviceToken) this.token = message.deviceToken;
      this.deviceId = message.deviceId;
      this.onAck?.(message);
      return;
    }
    if (message.type !== "rpc") return;
    const reply = (ok, result, error) => this.send({ type: "rpc_result", id: message.id, ok, result, error });
    const { method, params } = message;

    if (method === "os_updates_status") {
      reply(true, { job: this.job, log: this.log, inventory: this.inventory });
      return;
    }
    if (method === "os_updates_cancel") {
      if (!this.job?.cancellable) return reply(false, undefined, "Updates are being installed now.");
      reply(true, { accepted: true });
      await wait(50);
      this.emit({ state: "cancelled", phase: "done", cancellable: false, finishedAt: Date.now() }, ["Cancelled before anything was installed."]);
      this.job = null;
      return;
    }
    if (method === "os_updates_check" || method === "os_updates_install" || method === "os_reboot") {
      const kind = method === "os_updates_check" ? "check" : method === "os_reboot" ? "reboot" : "install";
      this.job = snapshot(params.jobId, kind);
      this.log = [];
      this.lastParams = params;
      reply(true, { accepted: true });
      await (this.behaviour[kind] ?? (() => undefined))(this);
    }
  }
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
  const headers = { "Content-Type": "application/json", Cookie: cookie };
  const api = async (method, path, body) => {
    const response = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  const enrollment = (await api("POST", "/enroll-tokens", { label: "os", expiresInHours: 1, maxUses: 1 })).body;
  const agent = new FakeAgent(enrollment.token, randomUUID());
  await agent.connect();
  const id = agent.deviceId;
  check(Boolean(id), "the agent is accepted");

  const live = new WebSocket(`ws://127.0.0.1:${PORT}/live`, { headers: { Cookie: cookie } });
  await new Promise((resolve, reject) => {
    live.once("open", resolve);
    live.once("error", reject);
  });
  live.send(JSON.stringify({ type: "subscribe", deviceIds: "all" }));
  const events = [];
  live.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "os_update") events.push(message);
  });
  await wait(400);

  /** Resolves once the job reaches a state the test is waiting for. */
  const until = async (predicate, description, timeoutMs = 5000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = (await api("GET", `/devices/${id}/os-updates`)).body;
      if (predicate(state)) return state;
      await wait(100);
    }
    throw new Error(`timed out waiting for ${description}`);
  };

  console.log("On connect…");
  {
    const state = await until((s) => s.inventory !== null, "the inventory from the status call");
    check(state.agentSupports === true, "an agent that says it can is offered updates");
    check(state.allowed === true, "installing is allowed by default");
    check(state.inventory.items.length === 2, "the hub asks the agent what it knows on connect");
    const device = (await api("GET", `/devices/${id}`)).body;
    check(device.osUpdates?.pending === 2 && device.osUpdates?.security === 1, "the device carries a summary for the tab badge");
  }

  console.log("A check…");
  {
    agent.behaviour.check = async (a) => {
      a.emit({ phase: "checking" }, ["$ apt-get update", "Hit:1 http://deb.example stable InRelease"]);
      await wait(100);
      a.inventory = inventory([ITEMS[0]]);
      a.emit({ state: "succeeded", phase: "done", progress: 100, cancellable: false, finishedAt: Date.now() }, ["1 update available."], true);
      a.job = null;
    };
    const started = await api("POST", `/devices/${id}/os-updates/check`);
    check(started.status === 202 && started.body.kind === "check", "a check starts");
    const state = await until((s) => s.active === null && s.history[0]?.state === "succeeded", "the check to finish");
    check(state.inventory.items.length === 1, "the finished check replaces the list");
    const job = (await api("GET", `/devices/${id}/os-updates/jobs/${state.history[0].id}`)).body;
    check(job.log.length === 3 && job.log[0] === "$ apt-get update", "the whole log is kept, in order");
    check(events.some((e) => e.job?.phase === "checking" && e.log.length === 2), "the live socket carries each step with its new lines");
    check(events.some((e) => e.inventory?.items.length === 1), "and the new list");
  }

  console.log("An install…");
  {
    agent.inventory = inventory(ITEMS);
    agent.behaviour.install = async (a) => {
      a.emit({ phase: "downloading", progress: 40, current: "Retrieving file 2 of 5" }, ["Get:1 libssl3"]);
      await wait(100);
      a.emit({ phase: "installing", progress: 60, cancellable: false, current: "Unpacking libssl3" }, ["Unpacking libssl3"]);
      await wait(100);
      a.inventory = inventory([ITEMS[1]], true);
      a.emit(
        {
          state: "succeeded",
          phase: "done",
          progress: 100,
          rebootRequired: true,
          results: [{ name: "libssl3", ok: true, message: "Updated to 2" }],
          finishedAt: Date.now(),
        },
        ["Finished."],
        true
      );
      a.job = null;
    };
    const started = await api("POST", `/devices/${id}/os-updates/install`, { ids: ["libssl3"], rebootAfter: false });
    check(started.status === 202 && started.body.requested?.[0] === "libssl3", "an install of one update starts");
    check(agent.lastParams?.ids?.[0] === "libssl3" && agent.lastParams.rebootAfter === false, "the agent is told exactly what to install");
    const state = await until((s) => s.active === null && s.history[0]?.kind === "install", "the install to finish");
    const job = state.history[0];
    check(job.state === "succeeded" && job.results[0]?.ok === true, "the outcome and each result are recorded");
    check(job.rebootRequired && state.inventory.rebootRequired, "a restart it needs is shown");
    check(events.some((e) => e.job?.phase === "installing" && e.job.cancellable === false), "the dashboard is told when stopping stops being safe");
  }

  console.log("Refusals…");
  {
    let release_;
    agent.behaviour.install = (a) =>
      new Promise((resolve) => {
        a.emit({ phase: "downloading", progress: 5 }, ["Get:1 something"]);
        release_ = () => {
          a.emit({ state: "succeeded", phase: "done", finishedAt: Date.now(), cancellable: false }, ["Finished."]);
          a.job = null;
          resolve();
        };
      });
    await api("POST", `/devices/${id}/os-updates/install`, { ids: null, rebootAfter: false });
    const second = await api("POST", `/devices/${id}/os-updates/check`);
    check(second.status === 409, "nothing else starts while a job runs");
    const agentUpdate = await api("POST", `/devices/${id}/update`);
    check(
      agentUpdate.status === 409 && /OS update/.test(agentUpdate.body?.error ?? ""),
      "the Beacon agent will not update itself in the middle of an OS update"
    );
    release_();
    await until((s) => s.active === null, "the held install to finish");
  }

  console.log("Cancelling…");
  {
    agent.behaviour.install = (a) => a.emit({ phase: "downloading", progress: 10, cancellable: true }, ["Get:1 big-package"]);
    const started = await api("POST", `/devices/${id}/os-updates/install`, { ids: null, rebootAfter: false });
    await until((s) => s.active?.phase === "downloading", "the download to start");
    const cancelled = await api("POST", `/devices/${id}/os-updates/jobs/${started.body.id}/cancel`);
    check(cancelled.status === 202, "a download can be cancelled");
    const state = await until((s) => s.active === null, "the cancel to land");
    check(state.history[0].state === "cancelled", "and is recorded as cancelled");
  }

  console.log("A restart…");
  {
    agent.inventory = inventory([], true);
    agent.behaviour.reboot = async (a) => {
      a.emit({ phase: "rebooting", cancellable: false, current: "Restarting" }, ["Restart requested from the dashboard."]);
      await wait(150);
      await a.close();
      // Back as a freshly started agent, which knows nothing of the job.
      a.job = null;
      a.log = [];
      a.inventory = inventory([]);
      await wait(300);
      await a.connect();
    };
    const started = await api("POST", `/devices/${id}/os-updates/reboot`);
    check(started.status === 202, "a restart starts");
    const state = await until((s) => s.history[0]?.kind === "reboot" && s.history[0].state !== "running", "the device to come back", 8000);
    check(state.history[0].state === "succeeded", "coming back online is what makes a restart succeed");
    const job = (await api("GET", `/devices/${id}/os-updates/jobs/${state.history[0].id}`)).body;
    check(job.log.some((line) => /back online/.test(line)), "and the log says so");
  }

  console.log("An agent that restarts part way…");
  {
    // The check the hub starts after a restart has to settle first.
    await wait(200);
    agent.behaviour.install = async (a) => {
      a.emit({ phase: "installing", cancellable: false }, ["Unpacking something"]);
      await wait(150);
      await a.close();
      a.job = null;
      a.log = [];
      await a.connect();
    };
    await api("POST", `/devices/${id}/os-updates/install`, { ids: null, rebootAfter: false });
    const state = await until((s) => s.history.some((j) => j.kind === "install" && j.state === "interrupted"), "the lost job to be settled", 8000);
    check(state.active === null, "a job the agent no longer knows is not left running");
    check(state.history.find((j) => j.state === "interrupted")?.error !== null, "it says why it ended");
  }

  console.log("Turned off in the settings…");
  {
    await api("PATCH", `/devices/${id}`, { settings: { allowOsUpdates: false } });
    const install = await api("POST", `/devices/${id}/os-updates/install`, { ids: null, rebootAfter: false });
    check(install.status === 409, "installing is refused");
    const reboot = await api("POST", `/devices/${id}/os-updates/reboot`);
    check(reboot.status === 409, "so is restarting");
    agent.behaviour.check = async (a) => {
      a.emit({ state: "succeeded", phase: "done", finishedAt: Date.now(), cancellable: false }, ["Checked."], true);
      a.job = null;
    };
    const checkRun = await api("POST", `/devices/${id}/os-updates/check`);
    check(checkRun.status === 202, "checking still works");
  }

  live.close();
  await agent.close();
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
    console.log("os updates ok");
    process.exit(0);
  });
