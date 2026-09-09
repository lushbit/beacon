import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveClientMessage, LiveServerMessage } from "@beacon/shared";
import { audit } from "../audit.js";
import { bus } from "../events.js";
import { getDeviceRow } from "../devices.js";
import { logger } from "../utils/log.js";
import type { UserRow } from "../auth/users.js";
import { isScreenStreaming, startScreen, stopScreen } from "./agents.js";

const log = logger("hub:live");

interface LiveClient {
  socket: WebSocket;
  user: UserRow;
  devices: Set<string> | "all";
  screens: Set<string>;
  alive: boolean;
}

const clients = new Set<LiveClient>();

function subscribed(client: LiveClient, deviceId: string): boolean {
  return client.devices === "all" || client.devices.has(deviceId);
}

function send(client: LiveClient, message: LiveServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

function broadcast(deviceId: string, message: LiveServerMessage, onlyScreenViewers = false): void {
  for (const client of clients) {
    if (onlyScreenViewers ? !client.screens.has(deviceId) : !subscribed(client, deviceId)) continue;
    send(client, message);
  }
}

/** Nobody is watching any more, so tell the agent to stop capturing. */
function releaseScreen(deviceId: string): void {
  const stillWatching = [...clients].some((client) => client.screens.has(deviceId));
  if (!stillWatching && isScreenStreaming(deviceId)) {
    void stopScreen(deviceId);
  }
}

export const liveWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

liveWss.on("connection", (socket: WebSocket, _request: IncomingMessage, user: UserRow) => {
  const client: LiveClient = { socket, user, devices: "all", screens: new Set(), alive: true };
  clients.add(client);

  socket.on("pong", () => {
    client.alive = true;
  });

  socket.on("message", (raw) => {
    let message: LiveClientMessage;
    try {
      message = JSON.parse(raw.toString()) as LiveClientMessage;
    } catch {
      return;
    }
    handleClientMessage(client, message);
  });

  socket.on("close", () => {
    clients.delete(client);
    for (const deviceId of client.screens) releaseScreen(deviceId);
  });

  socket.on("error", () => {
    clients.delete(client);
  });
});

function handleClientMessage(client: LiveClient, message: LiveClientMessage): void {
  if (message.type === "subscribe") {
    client.devices = message.deviceIds === "all" ? "all" : new Set(message.deviceIds);
    return;
  }

  if (message.type === "screen") {
    const device = getDeviceRow(message.deviceId);
    if (!device) return;

    if (message.action === "start") {
      client.screens.add(message.deviceId);
      audit({
        actor: `${client.user.username} (${client.user.id})`,
        action: "device.screen.view",
        target: device.id,
        detail: device.name,
      });
      startScreen(message.deviceId).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        send(client, { type: "screen_state", deviceId: message.deviceId, state: "error", message: text });
        client.screens.delete(message.deviceId);
      });
      return;
    }

    client.screens.delete(message.deviceId);
    releaseScreen(message.deviceId);
  }
}

const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (!client.alive) {
      client.socket.terminate();
      clients.delete(client);
      continue;
    }
    client.alive = false;
    try {
      client.socket.ping();
    } catch {
      clients.delete(client);
    }
  }
}, 30_000);
heartbeat.unref();

bus.on("sample", ({ deviceId, sample }) => {
  broadcast(deviceId, { type: "sample", deviceId, sample });
});

bus.on("device_status", ({ deviceId, status, lastSeenAt }) => {
  broadcast(deviceId, { type: "device_status", deviceId, status, lastSeenAt });
});

bus.on("alert", (alert) => {
  for (const client of clients) {
    if (!subscribed(client, alert.deviceId)) continue;
    send(client, {
      type: "alert",
      alert: {
        id: alert.id,
        deviceId: alert.deviceId,
        deviceName: alert.deviceName,
        ruleName: alert.ruleName,
        severity: alert.severity,
        state: alert.state,
        message: alert.message,
        startedAt: alert.startedAt,
        resolvedAt: alert.resolvedAt,
        value: alert.value,
      },
    });
  }
});

bus.on("agent_update", ({ deviceId, state }) => {
  broadcast(deviceId, {
    type: "agent_update",
    deviceId,
    state: { state: state.state, targetVersion: state.targetVersion, error: state.error },
  });
});

bus.on("screen_frame", (frame) => {
  broadcast(frame.deviceId, { type: "screen_frame", ...frame }, true);
});

bus.on("screen_state", (state) => {
  broadcast(state.deviceId, { type: "screen_state", ...state }, true);
});

log.debug("live socket module ready");
