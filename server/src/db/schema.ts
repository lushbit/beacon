/**
 * Schema is applied with `CREATE ... IF NOT EXISTS` on every boot, so a fresh
 * install and an existing database follow the same path. Additive changes go
 * in `migrations` below.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  is_active     INTEGER NOT NULL DEFAULT 1,
  preferences   TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  ts  INTEGER NOT NULL,
  ok  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key ON login_attempts(key, ts);

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  install_id   TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  hostname     TEXT NOT NULL DEFAULT '',
  platform     TEXT NOT NULL DEFAULT '',
  os           TEXT NOT NULL DEFAULT '',
  arch         TEXT NOT NULL DEFAULT '',
  token_hash   TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT 'slate',
  tags         TEXT NOT NULL DEFAULT '[]',
  notes        TEXT NOT NULL DEFAULT '',
  capabilities TEXT NOT NULL DEFAULT '{}',
  static_info  TEXT,
  settings     TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  enrolled_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token_hash);

CREATE TABLE IF NOT EXISTS enroll_tokens (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL DEFAULT '',
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  max_uses     INTEGER NOT NULL DEFAULT 1,
  uses         INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS samples (
  device_id      TEXT NOT NULL,
  tier           TEXT NOT NULL,
  ts             INTEGER NOT NULL,
  cpu_pct        REAL,
  cpu_pct_max    REAL,
  mem_pct        REAL,
  mem_pct_max    REAL,
  mem_used       REAL,
  mem_total      REAL,
  swap_pct       REAL,
  disk_max_pct   REAL,
  disk_used      REAL,
  disk_total     REAL,
  disk_read_bps  REAL,
  disk_write_bps REAL,
  net_rx_bps     REAL,
  net_tx_bps     REAL,
  gpu_pct        REAL,
  gpu_mem_pct    REAL,
  cpu_temp_c     REAL,
  load1          REAL,
  load5          REAL,
  load15         REAL,
  uptime_sec     REAL,
  proc_count     REAL,
  battery_pct    REAL,
  containers_running REAL,
  containers_total   REAL,
  detail         TEXT,
  PRIMARY KEY (device_id, tier, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS alert_rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  device_id    TEXT REFERENCES devices(id) ON DELETE CASCADE,
  metric       TEXT NOT NULL,
  operator     TEXT NOT NULL DEFAULT 'gt',
  threshold    REAL NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 60,
  severity     TEXT NOT NULL DEFAULT 'warning',
  cooldown_sec INTEGER NOT NULL DEFAULT 600,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_runtime (
  rule_id       TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  breach_since  INTEGER,
  last_fired_at INTEGER,
  alert_id      TEXT,
  PRIMARY KEY (rule_id, device_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT,
  rule_name       TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  metric          TEXT NOT NULL,
  severity        TEXT NOT NULL,
  state           TEXT NOT NULL,
  value           REAL,
  threshold       REAL,
  message         TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  resolved_at     INTEGER,
  acknowledged_at INTEGER,
  acknowledged_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts(state, started_at DESC);

CREATE TABLE IF NOT EXISTS channels (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  min_severity TEXT NOT NULL DEFAULT 'warning',
  config       TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  last_error   TEXT,
  last_sent_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id     TEXT PRIMARY KEY,
  ts     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
