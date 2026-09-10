import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_AGENT_CONFIG,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type AgentConfig,
  type AgentMessage,
  type AgentRpcMethod,
  type HubMessage,
} from "@beacon/shared";
import { evaluateSample, seedDefaultRules } from "../alerts/engine.js";
import { audit } from "../audit.js";
import {
  consumeEnrollToken,
  noteEnrollment,
  createDevice,
  deviceSettings,
  getDeviceByInstallId,
  getDeviceByTokenHash,
  getDeviceRow,
  rotateDeviceToken,
  touchDevice,
  updateDeviceCapabilities,
  updateDeviceIdentity,
} from "../devices.js";
import { bus } from "../events.js";
import { insertSample } from "../metrics/store.js";
import { hashToken, newId } from "../utils/ids.js";
import { logger } from "../utils/log.js";

const log = logger("hub:agent");

const HELLO_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 20_000;
const IDLE_TIMEOUT_MS = 70_000;
const RPC_TIMEOUT_MS = 15_000;

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AgentConnection {
  readonly pending = new Map<string, PendingRpc>();
  deviceId: string | null = null;
  deviceName = "";
  lastMessageAt = Date.now();

  constructor(readonly socket: WebSocket) {}

  send(message: HubMessage): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  call(method: AgentRpcMethod, params?: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = newId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The device did not answer in time."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: "rpc", id, method, params });
    });
  }

  settle(id: string, ok: boolean, result: unknown, error?: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (ok) pending.resolve(result);
    else pending.reject(new Error(error ?? "The device reported an error."));
  }

  close(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    try {
      this.socket.close();
    } catch {
      /* already gone */
    }
  }
}

/** deviceId -> live agent connection. */
const connections = new Map<string, AgentConnection>();

export function agentFor(deviceId: string): AgentConnection | undefined {
  return connections.get(deviceId);
}

export function onlineDeviceIds(): Set<string> {
  return new Set(connections.keys());
}

export function isOnline(deviceId: string): boolean {
  return connections.has(deviceId);
}

export function configFor(deviceId: string): AgentConfig {
  const row = getDeviceRow(deviceId);
  if (!row) return DEFAULT_AGENT_CONFIG;
  const settings = deviceSettings(row);
  return {
    sampleIntervalMs: settings.sampleIntervalMs,
    allowProcessKill: settings.allowProcessKill,
  };
}

/** Pushes changed settings to a connected agent right away. */
export function pushConfig(deviceId: string): void {
  const connection = connections.get(deviceId);
  if (!connection) return;
  connection.send({ type: "config", config: configFor(deviceId) });
}

export const agentWss = new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024 });

agentWss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
  const connection = new AgentConnection(socket);
  const remote = request.socket.remoteAddress ?? "unknown";

  const helloTimer = setTimeout(() => {
    if (!connection.deviceId) {
      connection.send({ type: "error", code: "protocol", message: "No hello received." });
      connection.close("handshake timeout");
    }
  }, HELLO_TIMEOUT_MS);

  const pingTimer = setInterval(() => {
    if (Date.now() - connection.lastMessageAt > IDLE_TIMEOUT_MS) {
      log.warn(`agent ${connection.deviceName || remote} timed out`);
      connection.close("idle timeout");
      return;
    }
    connection.send({ type: "ping", ts: Date.now() });
  }, PING_INTERVAL_MS);

  socket.on("message", (raw) => {
    connection.lastMessageAt = Date.now();
    let message: AgentMessage;
    try {
      message = JSON.parse(raw.toString()) as AgentMessage;
    } catch {
      connection.send({ type: "error", code: "protocol", message: "Malformed message." });
      return;
    }
    handleMessage(connection, message, remote);
  });

  socket.on("close", () => {
    clearTimeout(helloTimer);
    clearInterval(pingTimer);
    if (connection.deviceId && connections.get(connection.deviceId) === connection) {
      connections.delete(connection.deviceId);
      const row = getDeviceRow(connection.deviceId);
      bus.emit("device_status", {
        deviceId: connection.deviceId,
        status: "offline",
        lastSeenAt: row?.last_seen_at ?? null,
      });
      log.info(`agent disconnected: ${connection.deviceName}`);
    }
    connection.close("socket closed");
  });

  socket.on("error", (error) => {
    log.debug(`agent socket error: ${error.message}`);
  });
});

function handleMessage(connection: AgentConnection, message: AgentMessage, remote: string): void {
  switch (message.type) {
    case "hello":
      handleHello(connection, message, remote);
      return;
    case "pong":
      return;
    default:
      break;
  }

  if (!connection.deviceId) {
    connection.send({ type: "error", code: "unauthorized", message: "Send hello first." });
    connection.close("unauthenticated message");
    return;
  }

  switch (message.type) {
    case "sample": {
      const deviceId = connection.deviceId;
      insertSample(deviceId, message.sample);
      touchDevice(deviceId, message.sample.ts);
      bus.emit("sample", { deviceId, sample: message.sample });
      try {
        evaluateSample(deviceId, connection.deviceName, message.sample);
      } catch (error) {
        log.error("alert evaluation failed", error);
      }
      return;
    }
    case "capabilities":
      updateDeviceCapabilities(connection.deviceId, message.capabilities);
      return;
    case "rpc_result":
      connection.settle(message.id, message.ok, message.result, message.error);
      return;
    default:
      return;
  }
}

/**
 * A new device takes the name typed in when its token was created, or its
 * hostname when none was. A token for several devices would give them all the
 * same name, so there the hostname is added to tell them apart. Kept within the
 * 60 characters a rename allows, so the device settings can still be saved.
 */
function deviceNameFor(label: string, maxUses: number, hostname: string): string {
  const base = label.trim();
  if (!base) return hostname;
  if (maxUses === 1 || !hostname) return base;
  const suffix = ` (${hostname})`;
  return `${base.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`.slice(0, 60);
}

function handleHello(connection: AgentConnection, message: AgentMessage, remote: string): void {
  if (message.type !== "hello") return;
  if (connection.deviceId) return;

  // A range, not an exact match: an agent one protocol behind still connects so
  // that it can be told to update. Only something below the floor is refused,
  // and that always means a manual reinstall on the device.
  if (message.protocolVersion < MIN_PROTOCOL_VERSION || message.protocolVersion > PROTOCOL_VERSION) {
    log.warn(
      `rejected agent from ${remote}: protocol v${message.protocolVersion}, hub accepts v${MIN_PROTOCOL_VERSION}-v${PROTOCOL_VERSION}`
    );
    connection.send({
      type: "error",
      code: "protocol",
      message:
        `This hub speaks protocol v${MIN_PROTOCOL_VERSION}-v${PROTOCOL_VERSION}; ` +
        `the agent speaks v${message.protocolVersion}. Reinstall the agent from the dashboard.`,
    });
    connection.close("protocol mismatch");
    return;
  }

  const tokenHash = hashToken(message.token);
  let deviceRow = getDeviceByTokenHash(tokenHash);
  let issuedToken: string | undefined;

  if (!deviceRow) {
    const enrollment = consumeEnrollToken(message.token);
    if (!enrollment) {
      log.warn(`rejected agent from ${remote}: unknown token`);
      connection.send({ type: "error", code: "unauthorized", message: "Token not recognised." });
      connection.close("unauthorized");
      return;
    }

    const existing = getDeviceByInstallId(message.installId);
    if (existing) {
      // Re-enrolling a device we already know: keep its history, issue a new token.
      issuedToken = rotateDeviceToken(existing.id);
      deviceRow = getDeviceRow(existing.id)!;
    } else {
      const name =
        deviceNameFor(enrollment.label, enrollment.max_uses, message.staticInfo.hostname) ||
        `Device ${message.installId.slice(0, 6)}`;
      const created = createDevice({
        installId: message.installId,
        name,
        staticInfo: message.staticInfo,
        capabilities: message.capabilities,
        enrolledBy: enrollment.created_by,
      });
      deviceRow = created.row;
      issuedToken = created.token;
      seedDefaultRules(deviceRow.id, deviceRow.name);
      audit({ actor: "agent", action: "device.enrolled", target: deviceRow.id, detail: name, ip: remote });
      log.info(`enrolled new device "${name}" (${deviceRow.id})`);
    }

    // Lets the "add a device" dialog report which machine checked in.
    noteEnrollment(enrollment.id, deviceRow.id);
  } else if (deviceRow.install_id !== message.installId) {
    log.warn(`rejected agent from ${remote}: token belongs to another install`);
    connection.send({ type: "error", code: "unauthorized", message: "Token does not match this device." });
    connection.close("install mismatch");
    return;
  }

  updateDeviceIdentity(deviceRow.id, message.staticInfo, message.capabilities);
  touchDevice(deviceRow.id);

  const previous = connections.get(deviceRow.id);
  if (previous && previous !== connection) previous.close("replaced by a newer connection");

  connection.deviceId = deviceRow.id;
  connection.deviceName = deviceRow.name;
  connections.set(deviceRow.id, connection);

  connection.send({
    type: "hello_ack",
    deviceId: deviceRow.id,
    deviceName: deviceRow.name,
    serverTime: Date.now(),
    config: configFor(deviceRow.id),
    ...(issuedToken ? { deviceToken: issuedToken } : {}),
  });

  bus.emit("device_status", { deviceId: deviceRow.id, status: "online", lastSeenAt: Date.now() });
  log.info(
    `agent connected: ${deviceRow.name} (${deviceRow.id}) v${message.staticInfo.agentVersion} protocol v${message.protocolVersion}`
  );

  // Closes the loop on a pending update, and applies the "on connect" policy.
  // Imported lazily to keep this module free of a cycle with the orchestrator.
  const enrolled = deviceRow;
  void import("../agentUpdates.js").then(({ noteAgentConnected }) => {
    noteAgentConnected(enrolled.id, message.staticInfo.agentVersion);
  });
}

