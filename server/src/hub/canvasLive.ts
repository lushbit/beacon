import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { CanvasLiveMessage, CanvasNeeds } from "@beacon/shared";
import { buildSnapshot } from "@beacon/shared";
import { pageSnapshots, metaFor } from "../canvas/data.js";
import { getCanvasRow, liveOf } from "../canvas/store.js";
import { getDeviceRow } from "../devices.js";
import { bus } from "../events.js";
import { logger } from "../utils/log.js";

const log = logger("hub:canvas");

/**
 * Everyone looking at one page shares one of these. A sample is cut down for
 * the page once and the same text goes to every visitor, so a page open on a
 * wall of screens costs the hub one snapshot per sample.
 */
interface PageGroup {
  pageId: string;
  needs: Map<string, CanvasNeeds>;
  devices: Set<string>;
  sockets: Set<WebSocket & { alive?: boolean }>;
  computedAt: number;
}

const groups = new Map<string, PageGroup>();
const perAddress = new Map<string, number>();

function computeGroup(pageId: string, existing?: PageGroup): PageGroup | null {
  const row = getCanvasRow(pageId);
  const content = row ? liveOf(row) : null;
  if (!row || !content) return null;
  const { needs, blockDevices } = pageSnapshots(content);
  const devices = new Set<string>([...needs.keys(), ...Object.values(blockDevices).flat()]);
  return { pageId, needs, devices, sockets: existing?.sockets ?? new Set(), computedAt: Date.now() };
}

function send(socket: WebSocket, text: string): void {
  if (socket.readyState === socket.OPEN) socket.send(text);
}

export const canvasWss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

canvasWss.on("connection", (socket: WebSocket & { alive?: boolean }, _request: IncomingMessage, pageId: string, ip: string) => {
  let group = groups.get(pageId);
  // A device added since the page was first opened shows up once the group is
  // worked out again, which the next visitor after a minute triggers.
  if (!group || Date.now() - group.computedAt > 60_000) {
    const fresh = computeGroup(pageId, group);
    if (!fresh) {
      socket.close(4404, "not found");
      return;
    }
    group = fresh;
    groups.set(pageId, group);
  }
  group.sockets.add(socket);
  perAddress.set(ip, (perAddress.get(ip) ?? 0) + 1);
  socket.alive = true;

  socket.on("pong", () => {
    socket.alive = true;
  });
  // Visitors have nothing to say. Anything they send is ignored.
  socket.on("message", () => undefined);
  const leave = () => {
    const current = groups.get(pageId);
    current?.sockets.delete(socket);
    if (current && current.sockets.size === 0) groups.delete(pageId);
    const count = (perAddress.get(ip) ?? 1) - 1;
    if (count <= 0) perAddress.delete(ip);
    else perAddress.set(ip, count);
  };
  socket.on("close", leave);
  socket.on("error", leave);
});

export function socketsFrom(ip: string): number {
  return perAddress.get(ip) ?? 0;
}

const heartbeat = setInterval(() => {
  for (const group of groups.values()) {
    for (const socket of group.sockets) {
      if (!socket.alive) {
        socket.terminate();
        continue;
      }
      socket.alive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }
}, 30_000);
heartbeat.unref();

bus.on("sample", ({ deviceId, sample }) => {
  let row: ReturnType<typeof getDeviceRow> | null = null;
  for (const group of groups.values()) {
    const needs = group.needs.get(deviceId);
    if (!needs) continue;
    row ??= getDeviceRow(deviceId) ?? null;
    if (!row) return;
    const message: CanvasLiveMessage = { type: "snapshot", device: buildSnapshot(metaFor(row, sample), needs) };
    const text = JSON.stringify(message);
    for (const socket of group.sockets) send(socket, text);
  }
});

bus.on("device_status", ({ deviceId, status, lastSeenAt }) => {
  const text = JSON.stringify({ type: "status", deviceId, status, lastSeenAt } satisfies CanvasLiveMessage);
  for (const group of groups.values()) {
    if (!group.devices.has(deviceId)) continue;
    for (const socket of group.sockets) send(socket, text);
  }
});

bus.on("canvas_changed", ({ pageId }) => {
  const group = groups.get(pageId);
  if (!group) return;
  groups.delete(pageId);
  const text = JSON.stringify({ type: "reload" } satisfies CanvasLiveMessage);
  for (const socket of group.sockets) {
    send(socket, text);
    socket.close(4000, "page changed");
  }
  log.debug(`asked ${group.sockets.size} visitors of a changed page to reload`);
});
