/**
 * Wire protocol.
 *
 * Two WebSocket endpoints exist on the hub:
 *  - `/agent`  — devices connect outward and authenticate with a device token,
 *                so nothing has to be exposed on the device itself.
 *  - `/live`   — browsers subscribe to live metrics, alerts and screen frames
 *                using their normal session cookie.
 */

import type {
  DeviceCapabilities,
  DeviceStaticInfo,
  MetricSample,
  ProcessSummary,
} from "./metrics.js";

export const PROTOCOL_VERSION = 1;

/**
 * Oldest agent protocol the hub still talks to.
 *
 * An agent below this is refused; an agent between this and the current version
 * connects normally and can be told to update. Never raise this until every
 * deployed agent supports remote updates, or those devices have to be visited
 * in person.
 */
export const MIN_PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ agent -> hub */

export interface AgentHelloMessage {
  type: "hello";
  protocolVersion: number;
  token: string;
  /** Stable per-install id so a device keeps its history across restarts. */
  installId: string;
  staticInfo: DeviceStaticInfo;
  capabilities: DeviceCapabilities;
}

export interface AgentSampleMessage {
  type: "sample";
  sample: MetricSample;
}

export interface AgentRpcResultMessage {
  type: "rpc_result";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface AgentScreenFrameMessage {
  type: "screen_frame";
  sessionId: string;
  seq: number;
  ts: number;
  width: number;
  height: number;
  /** Base64 encoded image, `format` tells the browser how to render it. */
  format: "jpeg" | "png";
  data: string;
}

export interface AgentScreenEndedMessage {
  type: "screen_ended";
  sessionId: string;
  reason: string;
}

export interface AgentPongMessage {
  type: "pong";
  ts: number;
}

export type AgentMessage =
  | AgentHelloMessage
  | AgentSampleMessage
  | AgentRpcResultMessage
  | AgentScreenFrameMessage
  | AgentScreenEndedMessage
  | AgentPongMessage;

/* ------------------------------------------------------------------ hub -> agent */

export interface AgentConfig {
  /** How often the agent samples and reports, in milliseconds. */
  sampleIntervalMs: number;
  /** Screen streaming is refused outright unless the hub enables it. */
  screenEnabled: boolean;
  screenFps: number;
  screenQuality: number;
  screenMaxWidth: number;
  /** Terminating processes from the dashboard can be disabled per device. */
  allowProcessKill: boolean;
}

export interface HubHelloAckMessage {
  type: "hello_ack";
  deviceId: string;
  deviceName: string;
  serverTime: number;
  config: AgentConfig;
  /**
   * Returned the first time an agent enrolls: the hub swaps the shared
   * enrollment token for a token unique to this device, which the agent
   * persists and uses from then on.
   */
  deviceToken?: string;
}

export interface HubConfigMessage {
  type: "config";
  config: AgentConfig;
}

export interface HubRpcMessage {
  type: "rpc";
  id: string;
  method: AgentRpcMethod;
  params?: unknown;
}

export interface HubPingMessage {
  type: "ping";
  ts: number;
}

export interface HubErrorMessage {
  type: "error";
  code: "unauthorized" | "protocol" | "rejected";
  message: string;
}

export type HubMessage =
  | HubHelloAckMessage
  | HubConfigMessage
  | HubRpcMessage
  | HubPingMessage
  | HubErrorMessage;

/* ------------------------------------------------------------------------- rpc */

export type AgentRpcMethod =
  | "list_processes"
  | "kill_process"
  | "screen_start"
  | "screen_stop"
  | "refresh_static"
  | "agent_update";

export interface AgentUpdateParams {
  version: string;
  /**
   * Path on the hub, resolved by the agent against the hub URL it is already
   * configured with — the hub never has to guess its own public address.
   */
  path: string;
  /**
   * Checksum of the bundle, delivered over the authenticated socket rather than
   * alongside the download, so a tampered download is caught even where TLS is
   * not trusted.
   */
  sha256: string;
}

export interface AgentUpdateResult {
  /** The agent exits after replying; the service manager restarts it. */
  accepted: boolean;
  version: string;
}

export interface ListProcessesParams {
  limit?: number;
  sortBy?: "cpu" | "mem";
}

export interface ListProcessesResult {
  ts: number;
  total: number;
  processes: ProcessSummary[];
}

export interface KillProcessParams {
  pid: number;
  /** `term` asks politely first; `kill` is the hard stop. */
  signal: "term" | "kill";
}

export interface ScreenStartParams {
  sessionId: string;
  fps: number;
  quality: number;
  maxWidth: number;
  displayIndex?: number;
}

export interface ScreenStopParams {
  sessionId: string;
}

/* ---------------------------------------------------------------- browser live */

export interface LiveSubscribeMessage {
  type: "subscribe";
  deviceIds: string[] | "all";
}

export interface LiveScreenControlMessage {
  type: "screen";
  action: "start" | "stop";
  deviceId: string;
}

export type LiveClientMessage = LiveSubscribeMessage | LiveScreenControlMessage;

export interface LiveSampleMessage {
  type: "sample";
  deviceId: string;
  sample: MetricSample;
}

export interface LiveDeviceStatusMessage {
  type: "device_status";
  deviceId: string;
  status: "online" | "offline";
  lastSeenAt: number | null;
}

export interface LiveAlertMessage {
  type: "alert";
  alert: {
    id: string;
    deviceId: string;
    deviceName: string;
    ruleName: string;
    severity: string;
    state: string;
    message: string;
    startedAt: number;
    resolvedAt: number | null;
    value: number | null;
  };
}

export interface LiveScreenFrameMessage {
  type: "screen_frame";
  deviceId: string;
  ts: number;
  width: number;
  height: number;
  format: "jpeg" | "png";
  data: string;
}

export interface LiveScreenStateMessage {
  type: "screen_state";
  deviceId: string;
  state: "starting" | "streaming" | "stopped" | "error";
  message?: string;
}

export interface LiveAgentUpdateMessage {
  type: "agent_update";
  deviceId: string;
  state: {
    state: string;
    targetVersion: string | null;
    error: string | null;
  };
}

export type LiveServerMessage =
  | LiveSampleMessage
  | LiveDeviceStatusMessage
  | LiveAlertMessage
  | LiveScreenFrameMessage
  | LiveScreenStateMessage
  | LiveAgentUpdateMessage;

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  sampleIntervalMs: 5000,
  screenEnabled: false,
  screenFps: 4,
  screenQuality: 60,
  screenMaxWidth: 1280,
  allowProcessKill: false,
};
