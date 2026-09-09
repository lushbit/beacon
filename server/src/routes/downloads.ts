import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { config } from "../config.js";
import { logger } from "../utils/log.js";

const log = logger("downloads");

/**
 * Unauthenticated on purpose: the installer runs on a machine that has no
 * session yet, and nothing served here is secret. The enrollment token is
 * supplied by the operator on the command line, never embedded in these files.
 */
export const downloadsRouter = Router();

interface Served {
  route: string;
  file: string;
  contentType: string;
  download?: string;
}

const FILES: Served[] = [
  { route: "/install.sh", file: "install.sh", contentType: "text/x-shellscript; charset=utf-8" },
  { route: "/install.ps1", file: "install.ps1", contentType: "text/plain; charset=utf-8" },
  { route: "/download/manifest.json", file: "manifest.json", contentType: "application/json; charset=utf-8" },
  {
    route: "/download/agent-bundle.tar.gz",
    file: "agent-bundle.tar.gz",
    contentType: "application/gzip",
    download: "agent-bundle.tar.gz",
  },
  // A Docker build context: `docker build <this url>` needs no git, no access
  // to the source repository and no toolchain on the host.
  {
    route: "/download/beacon-agent-docker.tar.gz",
    file: "beacon-agent-docker.tar.gz",
    contentType: "application/gzip",
    download: "beacon-agent-docker.tar.gz",
  },
];

/**
 * Versioned bundles are served by name from the public directory. The name is
 * matched against a strict pattern so a request can never walk out of it.
 */
downloadsRouter.get("/download/:file", (req, res, next) => {
  const file = req.params.file;
  if (!/^agent-[0-9A-Za-z.\-]+\.tar\.gz$/.test(file)) {
    next();
    return;
  }
  const target = path.join(config.publicDir, file);
  if (!fs.existsSync(target)) {
    res.status(404).type("text/plain").send("Unknown agent build.\n");
    return;
  }
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
  // Bundles are immutable once published.
  res.setHeader("Cache-Control", "public, max-age=86400");
  fs.createReadStream(target).pipe(res);
});

for (const served of FILES) {
  downloadsRouter.get(served.route, (_req, res) => {
    const target = path.join(config.publicDir, served.file);
    if (!fs.existsSync(target)) {
      log.warn(`${served.file} was requested but is not present in ${config.publicDir}`);
      res
        .status(404)
        .type("text/plain")
        .send(
          `${served.file} is not available on this hub.\n\n` +
            "It is produced by the release build. If you are running from a source\n" +
            "checkout, install the agent from the repository instead.\n"
        );
      return;
    }
    res.setHeader("Content-Type", served.contentType);
    res.setHeader("Cache-Control", "no-cache");
    if (served.download) res.setHeader("Content-Disposition", `attachment; filename="${served.download}"`);
    fs.createReadStream(target).pipe(res);
  });
}
