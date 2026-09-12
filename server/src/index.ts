import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import cookieParser from "cookie-parser";
import { BEACON_VERSION } from "@beacon/shared";
import express from "express";
import { config } from "./config.js";
import { loadSession, requireAuth, verifyOrigin } from "./auth/middleware.js";
import { rememberDashboardOrigin } from "./dashboardOrigin.js";
import { attachHub } from "./hub/index.js";
import { startJobs } from "./jobs.js";
import { startUpdateChecks } from "./updates.js";
import { alertsRouter, rulesRouter } from "./routes/alerts.js";
import { authRouter } from "./routes/auth.js";
import { channelsRouter } from "./routes/channels.js";
import { agentRouter } from "./routes/agent.js";
import { devicesRouter, enrollRouter } from "./routes/devices.js";
import { downloadsRouter } from "./routes/downloads.js";
import { errorHandler } from "./routes/helpers.js";
import { metricsRouter } from "./routes/metrics.js";
import { settingsRouter, versionRouter } from "./routes/settings.js";
import { usersRouter } from "./routes/users.js";
import { logger } from "./utils/log.js";

const log = logger("server");
const app = express();

if (config.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      // Allow inline data/blob images (generated avatars, chart exports).
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "form-action 'self'",
    ].join("; ")
  );
  next();
});

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());
app.use(loadSession);
app.use("/api", verifyOrigin);
// Notifications link back to wherever people actually open the dashboard, the
// same address the install commands are built from. Only a signed-in request
// counts, so nothing else reaching the API can point the links elsewhere.
app.use("/api", (req, _res, next) => {
  const host = req.get("host");
  if (req.user && host) rememberDashboardOrigin(`${req.protocol}://${host}`);
  next();
});
// Lets the dashboard measure "checked 2m ago" against this clock rather than
// the browser's, which may be minutes off in either direction.
app.use("/api", (_req, res, next) => {
  res.setHeader("X-Beacon-Time", String(Date.now()));
  next();
});

app.use(downloadsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: BEACON_VERSION, time: Date.now() });
});

app.use("/api", authRouter);
app.use("/api/users", requireAuth, usersRouter);
app.use("/api/devices", requireAuth, metricsRouter);
app.use("/api/devices", requireAuth, devicesRouter);
app.use("/api/enroll-tokens", requireAuth, enrollRouter);
app.use("/api/alerts", requireAuth, alertsRouter);
app.use("/api/alert-rules", requireAuth, rulesRouter);
app.use("/api/channels", requireAuth, channelsRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/version", requireAuth, versionRouter);
app.use("/api/agent", requireAuth, agentRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Unknown endpoint." });
});

/* --------------------------------------------------------------- static client */

const indexHtml = path.join(config.clientDir, "index.html");
if (fs.existsSync(indexHtml)) {
  app.use(
    express.static(config.clientDir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Hashed asset filenames can be cached hard; index.html never is.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexHtml);
  });
} else {
  log.warn(`no client build found at ${config.clientDir} — API only`);
}

app.use(errorHandler);

const server = http.createServer(app);
attachHub(server);
startJobs();
startUpdateChecks();

server.listen(config.port, config.host, () => {
  log.info(`Beacon ${BEACON_VERSION} listening on http://${config.host}:${config.port}`);
});

function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
