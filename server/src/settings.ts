import type { DeviceSettingsDto, RetentionSettings, ServerSettingsDto } from "@beacon/shared";
import { getSetting, setSetting } from "./db/index.js";

export const DEFAULT_SERVER_SETTINGS: ServerSettingsDto = {
  retention: { rawHours: 48, minuteDays: 30, hourDays: 365 },
  defaultSampleIntervalMs: 5000,
  defaultOfflineAfterSec: 30,
  sessionTtlHours: 24 * 30,
  updateChecks: true,
  defaultUpdatePolicy: "manual",
  updateWindowStartHour: 3,
  updateWindowEndHour: 5,
  siteName: "Beacon",
};

export function getServerSettings(): ServerSettingsDto {
  const stored = getSetting<Partial<ServerSettingsDto>>("server", {});
  return {
    ...DEFAULT_SERVER_SETTINGS,
    ...stored,
    retention: { ...DEFAULT_SERVER_SETTINGS.retention, ...(stored.retention ?? {}) },
  };
}

/** Accepts a partial retention block so callers can change one tier at a time. */
export type ServerSettingsPatch = Partial<Omit<ServerSettingsDto, "retention">> & {
  retention?: Partial<RetentionSettings>;
};

export function saveServerSettings(patch: ServerSettingsPatch): ServerSettingsDto {
  const next: ServerSettingsDto = {
    ...getServerSettings(),
    ...patch,
    retention: { ...getServerSettings().retention, ...(patch.retention ?? {}) },
  };
  setSetting("server", next);
  return next;
}

export function defaultDeviceSettings(): DeviceSettingsDto {
  const server = getServerSettings();
  return {
    sampleIntervalMs: server.defaultSampleIntervalMs,
    screenEnabled: false,
    screenFps: 4,
    screenQuality: 60,
    screenMaxWidth: 1280,
    allowProcessKill: false,
    updatePolicy: null,
    offlineAfterSec: server.defaultOfflineAfterSec,
    panels: { panels: [], hiddenDisks: [], hiddenInterfaces: [] },
  };
}

export function mergeDeviceSettings(stored: Partial<DeviceSettingsDto> | null): DeviceSettingsDto {
  const base = defaultDeviceSettings();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    panels: { ...base.panels, ...(stored.panels ?? {}) },
  };
}
