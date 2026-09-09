import type {
  AgentManifestDto,
  AgentUpdateStateDto,
  AlertDto,
  AlertRuleDto,
  AuditEntryDto,
  ChannelDto,
  DeviceDto,
  DeviceSummaryDto,
  EnrollTokenDto,
  ListProcessesResult,
  MetricSeriesDto,
  ServerSettingsDto,
  SessionDto,
  SetupStateDto,
  UserDto,
  UserPreferences,
  VersionDto,
} from "@beacon/shared";

/** Fired when the hub rejects a request because the session is gone. */
export const UNAUTHORIZED_EVENT = "beacon:unauthorized";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (response.status === 401) {
    // The session expired or was revoked — let the app fall back to sign-in
    // instead of leaving the user staring at a dashboard that cannot refresh.
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const remove = <T>(path: string) => request<T>(path, { method: "DELETE" });

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  setupState: () => request<SetupStateDto>("/setup-state"),
  setup: (body: { username: string; password: string; displayName?: string; siteName?: string }) =>
    post<SessionDto>("/setup", body),
  login: (body: { username: string; password: string }) => post<SessionDto>("/login", body),
  logout: () => post<{ ok: true }>("/logout"),
  me: () => request<SessionDto>("/me"),
  updateProfile: (body: { displayName?: string; currentPassword?: string; newPassword?: string }) =>
    patch<{ ok: true }>("/me", body),
  updatePreferences: (body: Partial<UserPreferences>) => patch<UserPreferences>("/me/preferences", body),

  users: () => request<UserDto[]>("/users"),
  createUser: (body: { username: string; password: string; role: "admin" | "viewer"; displayName?: string }) =>
    post<UserDto>("/users", body),
  updateUser: (
    id: string,
    body: { displayName?: string; role?: "admin" | "viewer"; isActive?: boolean; password?: string }
  ) => patch<UserDto>(`/users/${id}`, body),
  deleteUser: (id: string) => remove<{ ok: true }>(`/users/${id}`),

  devices: () => request<DeviceSummaryDto[]>("/devices"),
  device: (id: string) => request<DeviceDto>(`/devices/${id}`),
  updateDevice: (id: string, body: Record<string, unknown>) => patch<DeviceDto>(`/devices/${id}`, body),
  deleteDevice: (id: string) => remove<{ ok: true }>(`/devices/${id}`),
  rotateDeviceToken: (id: string) => post<{ token: string }>(`/devices/${id}/rotate-token`),
  refreshDevice: (id: string) => post<DeviceDto>(`/devices/${id}/refresh`),
  processes: (id: string, options: { limit?: number; sortBy?: "cpu" | "mem" }) =>
    request<ListProcessesResult>(`/devices/${id}/processes${query(options)}`),
  killProcess: (id: string, body: { pid: number; signal: "term" | "kill" }) =>
    post<{ ok: true }>(`/devices/${id}/processes/kill`, body),
  series: (id: string, options: { from: number; to: number; fields?: string; tier?: string }) =>
    request<MetricSeriesDto>(`/devices/${id}/series${query(options)}`),

  enrollTokens: () => request<EnrollTokenDto[]>("/enroll-tokens"),
  createEnrollToken: (body: { label: string; expiresInHours: number | null; maxUses: number }) =>
    post<EnrollTokenDto>("/enroll-tokens", body),
  deleteEnrollToken: (id: string) => remove<{ ok: true }>(`/enroll-tokens/${id}`),

  alerts: (options: { state?: string; deviceId?: string; limit?: number } = {}) =>
    request<AlertDto[]>(`/alerts${query(options)}`),
  acknowledgeAlert: (id: string) => post<AlertDto>(`/alerts/${id}/acknowledge`),

  rules: () => request<AlertRuleDto[]>("/alert-rules"),
  createRule: (body: Omit<AlertRuleDto, "id" | "createdAt">) => post<AlertRuleDto>("/alert-rules", body),
  updateRule: (id: string, body: Partial<AlertRuleDto>) => patch<AlertRuleDto>(`/alert-rules/${id}`, body),
  deleteRule: (id: string) => remove<{ ok: true }>(`/alert-rules/${id}`),

  channels: () => request<ChannelDto[]>("/channels"),
  createChannel: (body: {
    name: string;
    type: ChannelDto["type"];
    enabled: boolean;
    minSeverity: ChannelDto["minSeverity"];
    config: Record<string, string>;
  }) => post<ChannelDto>("/channels", body),
  updateChannel: (id: string, body: Partial<ChannelDto>) => patch<ChannelDto>(`/channels/${id}`, body),
  testChannel: (id: string) => post<{ ok: boolean; error?: string }>(`/channels/${id}/test`),
  deleteChannel: (id: string) => remove<{ ok: true }>(`/channels/${id}`),

  version: () => request<VersionDto>("/version"),
  agentManifest: () => request<AgentManifestDto>("/agent/manifest"),
  updateAgent: (id: string) => post<AgentUpdateStateDto>(`/devices/${id}/update`),
  updateAllAgents: () =>
    post<{ version: string; started: number; results: { deviceId: string; name: string; ok: boolean; error?: string }[] }>(
      "/agent/update-all"
    ),
  checkVersion: () => post<VersionDto>("/version/check"),

  settings: () => request<ServerSettingsDto>("/settings"),
  updateSettings: (body: Partial<ServerSettingsDto>) => patch<ServerSettingsDto>("/settings", body),
  storage: () => request<{ devices: number; rows: number; sizeBytes: number }>("/settings/storage"),
  pruneStorage: () => post<{ devices: number; rows: number; sizeBytes: number }>("/settings/storage/prune"),
  audit: (limit = 200) => request<AuditEntryDto[]>(`/settings/audit${query({ limit })}`),
};
