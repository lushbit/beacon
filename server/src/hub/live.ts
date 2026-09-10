import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveClientMessage, LiveServerMessage } from "@beacon/shared";
import { bus } from "../events.js";
import { logger } from "../utils/log.js";
import type { UserRow } from "../auth/users.js";

const log = logger("hub:live");

interface LiveClient {
  socket: WebSocket;
  user: UserRow;
  devices: Set<string> | "all";
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

function broadcast(deviceId: string, message: LiveServerMessage): void {
  for (const client of clients) {
    if (!subscribed(client, deviceId)) continue;
    send(client, message);
  }
}

export const liveWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

liveWss.on("connection", (socket: WebSocket, _request: IncomingMessage, user: UserRow) => {
  const client: LiveClient = { socket, user, devices: "all", alive: true };
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
  });

  socket.on("error", () => {
    clients.delete(client);
  });
});

function handleClientMessage(client: LiveClient, message: LiveClientMessage): void {
  if (message.type === "subscribe") {
    client.devices = message.deviceIds === "all" ? "all" : new Set(message.deviceIds);
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

log.debug("live socket module ready");
