import type {
  AgentCompatibility,
  AgentUpdateStateDto,
  DeviceCapabilities,
  DeviceDto,
  DeviceSettingsDto,
  DeviceStaticInfo,
  DeviceSummaryDto,
  EnrollTokenDto,
} from "@beacon/shared";
import { isNewer } from "@beacon/shared";
import { db, parseJson } from "./db/index.js";
import { mergeDeviceSettings } from "./settings.js";
import { hashToken, newId, newToken } from "./utils/ids.js";

export interface DeviceRow {
  id: string;
  install_id: string;
  name: string;
  hostname: string;
  platform: string;
  os: string;
  arch: string;
  token_hash: string;
  color: string;
  tags: string;
  notes: string;
  capabilities: string;
  static_info: string | null;
  settings: string;
  created_at: number;
  last_seen_at: number | null;
  enrolled_by: string | null;
}

const EMPTY_CAPABILITIES: DeviceCapabilities = {
  docker: false,
  selfUpdate: false,
  temperatures: false,
  gpu: false,
  battery: false,
  diskIo: false,
  processes: false,
  processKill: false,
};

export function deviceSettings(row: DeviceRow): DeviceSettingsDto {
  return mergeDeviceSettings(parseJson<Partial<DeviceSettingsDto>>(row.settings, {}));
}

export function deviceCapabilities(row: DeviceRow): DeviceCapabilities {
  return { ...EMPTY_CAPABILITIES, ...parseJson<Partial<DeviceCapabilities>>(row.capabilities, {}) };
}

/**
 * How this agent stands against what the hub can serve. `incompatible` means the
 * hub would refuse the connection outright, so it needs a manual reinstall.
 */
export function agentCompatibility(
  agentVersion: string | null,
  protocolVersion: number | null,
  target: { version: string; minProtocol: number; protocol: number } | null
): AgentCompatibility {
  if (!agentVersion) return "unknown";
  if (protocolVersion !== null && target && (protocolVersion < target.minProtocol || protocolVersion > target.protocol)) {
    return "incompatible";
  }
  if (!target) return "unknown";
  return isNewer(target.version, agentVersion) ? "outdated" : "current";
}

export function deviceStatus(row: DeviceRow, online: boolean): "online" | "offline" | "never" {
  if (online) return "online";
  return row.last_seen_at ? "offline" : "never";
}

export function listDeviceRows(): DeviceRow[] {
  return db.prepare("SELECT * FROM devices ORDER BY name COLLATE NOCASE ASC").all() as DeviceRow[];
}

export function getDeviceRow(id: string): DeviceRow | undefined {
  return db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | undefined;
}

export function getDeviceByTokenHash(hash: string): DeviceRow | undefined {
  return db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(hash) as DeviceRow | undefined;
}

export function getDeviceByInstallId(installId: string): DeviceRow | undefined {
  return db.prepare("SELECT * FROM devices WHERE install_id = ?").get(installId) as DeviceRow | undefined;
}

export function touchDevice(id: string, ts = Date.now()): void {
  db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(ts, id);
}

export function updateDeviceIdentity(
  id: string,
  staticInfo: DeviceStaticInfo,
  capabilities: DeviceCapabilities
): void {
  db.prepare(
    `UPDATE devices
        SET hostname = ?, platform = ?, os = ?, arch = ?, static_info = ?, capabilities = ?
      WHERE id = ?`
  ).run(
    staticInfo.hostname,
    staticInfo.platform,
    [staticInfo.distro, staticInfo.release].filter(Boolean).join(" ").trim(),
    staticInfo.arch,
    JSON.stringify(staticInfo),
    JSON.stringify(capabilities),
    id
  );
}

export function updateDeviceCapabilities(id: string, capabilities: DeviceCapabilities): void {
  db.prepare("UPDATE devices SET capabilities = ? WHERE id = ?").run(JSON.stringify(capabilities), id);
}

export function createDevice(input: {
  installId: string;
  name: string;
  staticInfo: DeviceStaticInfo;
  capabilities: DeviceCapabilities;
  enrolledBy: string | null;
}): { row: DeviceRow; token: string } {
  const token = newToken(32);
  const id = newId();
  db.prepare(
    `INSERT INTO devices (id, install_id, name, hostname, platform, os, arch, token_hash,
                          color, tags, notes, capabilities, static_info, settings, created_at, enrolled_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'slate', '[]', '', ?, ?, '{}', ?, ?)`
  ).run(
    id,
    input.installId,
    input.name,
    input.staticInfo.hostname,
    input.staticInfo.platform,
    [input.staticInfo.distro, input.staticInfo.release].filter(Boolean).join(" ").trim(),
    input.staticInfo.arch,
    hashToken(token),
    JSON.stringify(input.capabilities),
    JSON.stringify(input.staticInfo),
    Date.now(),
    input.enrolledBy
  );
  return { row: getDeviceRow(id)!, token };
}

export function rotateDeviceToken(id: string): string {
  const token = newToken(32);
  db.prepare("UPDATE devices SET token_hash = ? WHERE id = ?").run(hashToken(token), id);
  return token;
}

export function updateDevice(
  id: string,
  patch: {
    name?: string;
    color?: string;
    tags?: string[];
    notes?: string;
    settings?: DeviceSettingsDto;
  }
): DeviceRow | undefined {
  const row = getDeviceRow(id);
  if (!row) return undefined;
  db.prepare(
    `UPDATE devices SET name = ?, color = ?, tags = ?, notes = ?, settings = ? WHERE id = ?`
  ).run(
    patch.name ?? row.name,
    patch.color ?? row.color,
    JSON.stringify(patch.tags ?? parseJson<string[]>(row.tags, [])),
    patch.notes ?? row.notes,
    JSON.stringify(patch.settings ?? deviceSettings(row)),
    id
  );
  return getDeviceRow(id);
}

export function deleteDevice(id: string): void {
  const tx = db.transaction((deviceId: string) => {
    db.prepare("DELETE FROM samples WHERE device_id = ?").run(deviceId);
    db.prepare("DELETE FROM alerts WHERE device_id = ?").run(deviceId);
    db.prepare("DELETE FROM rule_runtime WHERE device_id = ?").run(deviceId);
    db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
  });
  tx(id);
}

export function toDeviceDto(
  row: DeviceRow,
  extra: {
    online: boolean;
    latest: DeviceDto["latest"];
    activeAlerts: number;
    compatibility: AgentCompatibility;
    updateState: AgentUpdateStateDto;
  }
): DeviceDto {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    platform: row.platform,
    os: row.os,
    arch: row.arch,
    color: row.color,
    tags: parseJson<string[]>(row.tags, []),
    notes: row.notes,
    status: deviceStatus(row, extra.online),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    capabilities: deviceCapabilities(row),
    staticInfo: parseJson<DeviceStaticInfo | null>(row.static_info, null),
    settings: deviceSettings(row),
    agentVersion: parseJson<DeviceStaticInfo | null>(row.static_info, null)?.agentVersion ?? null,
    protocolVersion: parseJson<DeviceStaticInfo | null>(row.static_info, null)?.protocolVersion ?? null,
    compatibility: extra.compatibility,
    updateState: extra.updateState,
    latest: extra.latest,
    activeAlerts: extra.activeAlerts,
  };
}

export function toDeviceSummaryDto(
  row: DeviceRow,
  extra: {
    online: boolean;
    latest: DeviceSummaryDto["latest"];
    activeAlerts: number;
    spark: DeviceSummaryDto["spark"];
    compatibility: AgentCompatibility;
    updateState: AgentUpdateStateDto;
  }
): DeviceSummaryDto {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    platform: row.platform,
    os: row.os,
    color: row.color,
    tags: parseJson<string[]>(row.tags, []),
    status: deviceStatus(row, extra.online),
    lastSeenAt: row.last_seen_at,
    capabilities: deviceCapabilities(row),
    agentVersion: parseJson<DeviceStaticInfo | null>(row.static_info, null)?.agentVersion ?? null,
    compatibility: extra.compatibility,
    updateState: extra.updateState,
    latest: extra.latest,
    activeAlerts: extra.activeAlerts,
    spark: extra.spark,
  };
}

/* ------------------------------------------------------------------ enrollment */

export interface EnrollTokenRow {
  id: string;
  token_hash: string;
  label: string;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
  max_uses: number;
  uses: number;
  last_used_at: number | null;
}

export function createEnrollToken(input: {
  label: string;
  createdBy: string | null;
  expiresAt: number | null;
  maxUses: number;
}): { row: EnrollTokenRow; token: string } {
  const token = newToken(24);
  const id = newId();
  db.prepare(
    `INSERT INTO enroll_tokens (id, token_hash, label, created_by, created_at, expires_at, max_uses, uses)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(id, hashToken(token), input.label, input.createdBy, Date.now(), input.expiresAt, input.maxUses);
  const row = db.prepare("SELECT * FROM enroll_tokens WHERE id = ?").get(id) as EnrollTokenRow;
  return { row, token };
}

export function listEnrollTokens(): EnrollTokenRow[] {
  return db.prepare("SELECT * FROM enroll_tokens ORDER BY created_at DESC").all() as EnrollTokenRow[];
}

/**
 * Remembers which device most recently enrolled with a token, so the "add a
 * device" dialog can name the machine that checked in. Only needed for the few
 * minutes that dialog stays open, so it lives in memory and a hub restart
 * simply falls back to the token's own use count.
 */
const recentEnrollments = new Map<string, { deviceId: string; at: number }>();
const ENROLLMENT_MEMORY_MS = 60 * 60_000;

export function noteEnrollment(tokenId: string, deviceId: string): void {
  const now = Date.now();
  recentEnrollments.set(tokenId, { deviceId, at: now });
  for (const [key, value] of recentEnrollments) {
    if (now - value.at > ENROLLMENT_MEMORY_MS) recentEnrollments.delete(key);
  }
}

export function enrollmentFor(tokenId: string): string | null {
  return recentEnrollments.get(tokenId)?.deviceId ?? null;
}

export function deleteEnrollToken(id: string): void {
  db.prepare("DELETE FROM enroll_tokens WHERE id = ?").run(id);
}

export function consumeEnrollToken(token: string): EnrollTokenRow | null {
  const row = db.prepare("SELECT * FROM enroll_tokens WHERE token_hash = ?").get(hashToken(token)) as
    | EnrollTokenRow
    | undefined;
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= Date.now()) return null;
  if (row.max_uses > 0 && row.uses >= row.max_uses) return null;
  db.prepare("UPDATE enroll_tokens SET uses = uses + 1, last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
  return row;
}

export function toEnrollTokenDto(row: EnrollTokenRow, token?: string): EnrollTokenDto {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    uses: row.uses,
    maxUses: row.max_uses,
    createdBy: row.created_by,
    lastUsedAt: row.last_used_at,
    ...(token ? { token } : {}),
  };
}
