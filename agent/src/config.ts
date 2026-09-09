import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface AgentFileConfig {
  url: string;
  token: string;
  installId: string;
  /** Set once the hub swaps the enrollment token for a device token. */
  deviceToken?: string;
  insecureTls?: boolean;
}

/** Per-user config directory, so the agent works without admin rights. */
function defaultConfigPath(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "beacon", "agent.json");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "beacon", "agent.json");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "beacon", "agent.json");
}

export interface CliOptions {
  url?: string;
  token?: string;
  configPath: string;
  insecureTls: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPath: process.env.BEACON_CONFIG ?? defaultConfigPath(),
    insecureTls: process.env.BEACON_INSECURE_TLS === "1",
    help: false,
    version: false,
  };
  if (process.env.BEACON_URL) options.url = process.env.BEACON_URL;
  if (process.env.BEACON_TOKEN) options.token = process.env.BEACON_TOKEN;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    switch (arg) {
      case "--url":
      case "-u":
        options.url = next();
        break;
      case "--token":
      case "-t":
        options.token = next();
        break;
      case "--config":
      case "-c":
        options.configPath = next();
        break;
      case "--insecure-tls":
        options.insecureTls = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      default:
        break;
    }
  }
  return options;
}

export const HELP_TEXT = `Beacon agent — reports this device to a Beacon hub.

Usage:
  beacon-agent --url https://beacon.example.com --token <enrollment-token>

Options:
  -u, --url <url>       Hub base URL (http/https or ws/wss).
  -t, --token <token>   Enrollment token from Settings → Devices in the dashboard.
                        Only needed the first time; the hub then issues a token
                        unique to this device.
  -c, --config <path>   Config file location.
      --insecure-tls    Accept self-signed certificates on the hub.
  -h, --help            Show this help.
  -v, --version         Print the agent version.

Environment: BEACON_URL, BEACON_TOKEN, BEACON_CONFIG, BEACON_INSECURE_TLS.
`;

export function loadConfig(options: CliOptions): AgentFileConfig {
  let stored: Partial<AgentFileConfig> = {};
  if (fs.existsSync(options.configPath)) {
    try {
      stored = JSON.parse(fs.readFileSync(options.configPath, "utf8")) as Partial<AgentFileConfig>;
    } catch {
      stored = {};
    }
  }

  const merged: AgentFileConfig = {
    url: options.url ?? stored.url ?? "",
    token: options.token ?? stored.token ?? "",
    installId: stored.installId ?? randomUUID(),
    insecureTls: options.insecureTls || stored.insecureTls === true,
  };
  if (stored.deviceToken) merged.deviceToken = stored.deviceToken;
  return merged;
}

export function saveConfig(configPath: string, value: AgentFileConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  // Existing files keep their mode on write, so tighten it explicitly.
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    /* not supported on this filesystem */
  }
}

/** Accepts http(s) or ws(s) and returns the websocket endpoint. */
export function toSocketUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/agent`;
  return url.toString();
}
