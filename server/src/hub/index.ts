import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { readSession, SESSION_COOKIE } from "../auth/sessions.js";
import { findUserById } from "../auth/users.js";
import { logger } from "../utils/log.js";
import { agentWss } from "./agents.js";
import { liveWss } from "./live.js";
import { canvasWss, socketsFrom } from "./canvasLive.js";
import { openCanvas, SOCKETS_PER_ADDRESS } from "../canvas/access.js";
import { config } from "../config.js";

const log = logger("hub");

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function addressOf(request: IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
    if (first) return first.trim();
  }
  return request.socket.remoteAddress ?? "unknown";
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function attachHub(server: Server): void {
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = "/";
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      reject(socket, 400, "Bad Request");
      return;
    }

    if (pathname === "/agent") {
      agentWss.handleUpgrade(request, socket, head, (ws) => {
        agentWss.emit("connection", ws, request);
      });
      return;
    }

    if (pathname === "/live") {
      const cookies = parseCookies(request.headers.cookie);
      const session = readSession(cookies[SESSION_COOKIE]);
      const user = session ? findUserById(session.user_id) : undefined;
      if (!user || user.is_active !== 1) {
        reject(socket, 401, "Unauthorized");
        return;
      }
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit("connection", ws, request, user);
      });
      return;
    }

    // A Canvas page's own socket. It answers to the same rules as the page:
    // the key, the password token or a session, whichever the page asks for.
    if (pathname === "/live/canvas") {
      const params = new URL(request.url ?? "/", "http://localhost").searchParams;
      const cookies = parseCookies(request.headers.cookie);
      const session = readSession(cookies[SESSION_COOKIE]);
      const user = session ? findUserById(session.user_id) : undefined;
      const opened = openCanvas((params.get("slug") ?? "").toLowerCase(), {
        key: (params.get("key") ?? "").slice(0, 200),
        token: (params.get("token") ?? "").slice(0, 200),
        user,
      });
      if (!opened.ok) {
        reject(socket, opened.refusal.status, opened.refusal.status === 404 ? "Not Found" : "Unauthorized");
        return;
      }
      const ip = addressOf(request);
      if (socketsFrom(ip) >= SOCKETS_PER_ADDRESS) {
        reject(socket, 429, "Too Many Requests");
        return;
      }
      canvasWss.handleUpgrade(request, socket, head, (ws) => {
        canvasWss.emit("connection", ws, request, opened.row.id, ip);
      });
      return;
    }

    reject(socket, 404, "Not Found");
  });

  log.info("websocket endpoints ready on /agent, /live and /live/canvas");
}
