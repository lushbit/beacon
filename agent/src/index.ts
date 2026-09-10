#!/usr/bin/env node
import WebSocket from "ws";
import {
  DEFAULT_AGENT_CONFIG,
  PROTOCOL_VERSION,
  type AgentConfig,
  type AgentMessage,
  type DeviceCapabilities,
  type DeviceStaticInfo,
  type HubMessage,
  type KillProcessParams,
  type AgentUpdateParams,
  type ListProcessesParams,
  type MetricSample,
} from "@beacon/shared";
import { collectSample, collectStaticInfo, isDockerAvailable, listProcesses, probeDocker } from "./collect.js";
import { HELP_TEXT, loadConfig, parseArgs, saveConfig, toSocketUrl, type AgentFileConfig } from "./config.js";
import { applyUpdate, confirmRunningVersion, detectLayout } from "./update.js";
import { AGENT_VERSION } from "./version.js";

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}
if (options.version) {
  process.stdout.write(`${AGENT_VERSION}\n`);
  process.exit(0);
}

const fileConfig: AgentFileConfig = loadConfig(options);

if (!fileConfig.url) {
  process.stderr.write("No hub URL configured. Pass --url, or set BEACON_URL.\n\n");
  process.stderr.write(HELP_TEXT);
  process.exit(1);
}
if (!fileConfig.token && !fileConfig.deviceToken) {
  process.stderr.write("No token configured. Pass --token with an enrollment token from the dashboard.\n\n");
  process.stderr.write(HELP_TEXT);
  process.exit(1);
}

const socketUrl = toSocketUrl(fileConfig.url);

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

/* ------------------------------------------------------------------- runtime */

let socket: WebSocket | null = null;
let hubConfig: AgentConfig = DEFAULT_AGENT_CONFIG;
let sampleTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = 1000;
let staticInfo: DeviceStaticInfo | null = null;
let stopping = false;

function emptyCapabilities(): DeviceCapabilities {
  return {
    docker: isDockerAvailable(),
    selfUpdate: detectLayout() !== null,
    temperatures: false,
    gpu: false,
    battery: false,
    diskIo: false,
    processes: true,
    processKill: true,
  };
}

/** Derived from a real sample, so the dashboard only offers what this OS reports. */
function capabilities(probe: MetricSample): DeviceCapabilities {
  return {
    docker: isDockerAvailable(),
    selfUpdate: detectLayout() !== null,
    temperatures: probe.summary.cpuTempC !== null,
    gpu: probe.detail.gpus.length > 0,
    battery: probe.detail.battery !== null,
    diskIo: probe.summary.diskReadBps !== null || probe.summary.diskWriteBps !== null,
    processes: true,
    processKill: true,
  };
}

function send(message: AgentMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function stopSampling(): void {
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = null;
}

function startSampling(): void {
  stopSampling();
  const interval = Math.max(1000, hubConfig.sampleIntervalMs);
  const tick = async () => {
    try {
      const sample = await collectSample();
      send({ type: "sample", sample });
    } catch (error) {
      logError(`sample failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  sampleTimer = setInterval(() => void tick(), interval);
  void tick();
}

async function handleRpc(id: string, method: string, params: unknown): Promise<void> {
  const reply = (ok: boolean, result?: unknown, error?: string) => {
    send({ type: "rpc_result", id, ok, result, error });
  };

  try {
    switch (method) {
      case "list_processes": {
        const input = (params ?? {}) as ListProcessesParams;
        const limit = Math.min(Math.max(input.limit ?? 60, 1), 300);
        reply(true, await listProcesses(limit, input.sortBy === "mem" ? "mem" : "cpu"));
        return;
      }
      case "kill_process": {
        const input = params as KillProcessParams;
        if (!hubConfig.allowProcessKill) throw new Error("Ending processes is disabled for this device.");
        if (!Number.isInteger(input?.pid) || input.pid <= 0) throw new Error("Invalid process id.");
        if (input.pid === process.pid) throw new Error("The agent will not end itself.");
        process.kill(input.pid, input.signal === "kill" ? "SIGKILL" : "SIGTERM");
        reply(true, { ok: true });
        return;
      }
      case "agent_update": {
        const input = params as AgentUpdateParams;
        log(`updating to ${input.version}…`);
        await applyUpdate({
          ...input,
          hubUrl: fileConfig.url,
          insecureTls: fileConfig.insecureTls === true,
        });
        reply(true, { accepted: true, version: input.version });
        log(`updated to ${input.version} — restarting`);
        // Let the reply flush, then hand over to the service manager.
        setTimeout(() => {
          stopping = true;
          socket?.close();
          process.exit(0);
        }, 750);
        return;
      }
      case "refresh_static": {
        staticInfo = await collectStaticInfo();
        reply(true, staticInfo);
        return;
      }
      default:
        reply(false, undefined, `Unknown method: ${method}`);
    }
  } catch (error) {
    reply(false, undefined, error instanceof Error ? error.message : String(error));
  }
}

function handleMessage(message: HubMessage): void {
  switch (message.type) {
    case "hello_ack": {
      reconnectDelayMs = 1000;
      hubConfig = message.config;
      if (message.deviceToken) {
        fileConfig.deviceToken = message.deviceToken;
        // The one-time enrollment token is no longer needed once we have our own.
        fileConfig.token = "";
      } else if (fileConfig.token) {
        // The device token still works, so the spare enrollment token the
        // installer left behind can go.
        fileConfig.token = "";
      }
      // The installer waits for this to move before it reports success. Without
      // it, a device token the hub no longer knows looks exactly like a working
      // install.
      fileConfig.lastConnectedAt = Date.now();
      saveConfig(options.configPath, fileConfig);
      if (message.deviceToken) {
        log(`enrolled as "${message.deviceName}" — device token saved to ${options.configPath}`);
      }
      log(`connected to hub as "${message.deviceName}" (every ${Math.round(hubConfig.sampleIntervalMs / 1000)}s)`);
      // Talking to the hub is what proves this build works; until this runs the
      // launcher would roll it back on the next restart.
      confirmRunningVersion();
      startSampling();
      return;
    }
    case "config": {
      const previousInterval = hubConfig.sampleIntervalMs;
      hubConfig = message.config;
      if (hubConfig.sampleIntervalMs !== previousInterval) startSampling();
      return;
    }
    case "rpc":
      void handleRpc(message.id, message.method, message.params);
      return;
    case "ping":
      send({ type: "pong", ts: Date.now() });
      return;
    case "error":
      logError(`hub rejected the agent (${message.code}): ${message.message}`);
      if (message.code === "unauthorized") {
        if (fileConfig.deviceToken && fileConfig.token) {
          // A hub rebuilt from an empty database does not know this device any
          // more. The installer leaves its enrollment token in place for
          // exactly this, so enroll again instead of waiting for a human.
          log("the device token was refused, enrolling again with the enrollment token");
          delete fileConfig.deviceToken;
          saveConfig(options.configPath, fileConfig);
          reconnectDelayMs = 1000;
          return;
        }
        // Back off hard: a bad token will not fix itself in a second.
        reconnectDelayMs = 60_000;
      }
      return;
    default:
      return;
  }
}

async function connect(): Promise<void> {
  if (stopping) return;
  if (!staticInfo) staticInfo = await collectStaticInfo();

  log(`connecting to ${socketUrl}`);
  const ws = new WebSocket(socketUrl, {
    rejectUnauthorized: !fileConfig.insecureTls,
    handshakeTimeout: 15_000,
  });
  socket = ws;

  ws.on("open", () => {
    void (async () => {
      // The first sample doubles as a capability probe.
      const probe = await collectSample().catch(() => null);
      send({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        token: fileConfig.deviceToken || fileConfig.token,
        installId: fileConfig.installId,
        staticInfo: staticInfo!,
        capabilities: probe ? capabilities(probe) : emptyCapabilities(),
      });
      if (probe) send({ type: "sample", sample: probe });
    })();
  });

  ws.on("message", (raw) => {
    try {
      handleMessage(JSON.parse(raw.toString()) as HubMessage);
    } catch {
      logError("received a malformed message from the hub");
    }
  });

  ws.on("close", () => {
    stopSampling();
    socket = null;
    if (stopping) return;
    const delay = reconnectDelayMs + Math.round(Math.random() * 1000);
    log(`disconnected — retrying in ${Math.round(delay / 1000)}s`);
    setTimeout(() => void connect(), delay);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  });

  ws.on("error", (error) => {
    logError(`socket error: ${error.message}`);
  });
}

/** The install id is written on first run so the hub can recognise the device again. */
saveConfig(options.configPath, fileConfig);

log(`Beacon agent ${AGENT_VERSION} starting (${process.platform}/${process.arch})`);

void (async () => {
  // The docker probe settles before the first hello, so the hub is told what
  // this device can actually do rather than what its platform usually can.
  const docker = await probeDocker();
  if (docker) log("docker detected — container stats enabled");
  void connect();
})();

function shutdown(): void {
  stopping = true;
  stopSampling();
  socket?.close();
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
