import type { Database } from "better-sqlite3";
import { logger } from "../utils/log.js";

const log = logger("db:migrate");

interface ColumnInfo {
  name: string;
}

function columns(db: Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  return new Set(rows.map((row) => row.name));
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

/**
 * Additive column migrations.
 *
 * `CREATE TABLE IF NOT EXISTS` leaves an existing database untouched, so new
 * columns have to be added explicitly. Every entry here is idempotent: it is
 * applied only when the column is missing, which means upgrading an old
 * database and creating a fresh one end up identical.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "samples", column: "containers_running", definition: "REAL" },
  { table: "samples", column: "containers_total", definition: "REAL" },
];

/**
 * Default rules used to be named after the rule and the device, joined by an
 * em dash, and that name reached every notification. The device is shown
 * beside each rule anyway, so these names are trimmed to the rule alone, on the
 * rules and on the alerts they raised. Names that do not follow that pattern
 * are left as they are, and a trimmed name never matches again.
 */
const SEEDED_RULE_NAME = /^(High CPU|High memory|Disk almost full|Device offline) — .+$/;

function trimSeededRuleNames(db: Database): number {
  let renamed = 0;
  for (const [table, column] of [
    ["alert_rules", "name"],
    ["alerts", "rule_name"],
  ] as const) {
    if (!tableExists(db, table)) continue;
    const rows = db.prepare(`SELECT id, ${column} AS name FROM ${table} WHERE ${column} LIKE '% — %'`).all() as {
      id: string;
      name: string;
    }[];
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
    for (const row of rows) {
      const match = SEEDED_RULE_NAME.exec(row.name);
      if (!match) continue;
      update.run(match[1], row.id);
      renamed += 1;
    }
  }
  return renamed;
}

export function migrate(db: Database): void {
  let applied = 0;

  for (const entry of ADDED_COLUMNS) {
    if (!tableExists(db, entry.table)) continue;
    if (columns(db, entry.table).has(entry.column)) continue;
    db.exec(`ALTER TABLE ${entry.table} ADD COLUMN ${entry.column} ${entry.definition}`);
    log.info(`added ${entry.table}.${entry.column}`);
    applied += 1;
  }

  const renamed = trimSeededRuleNames(db);
  if (renamed > 0) {
    log.info(`trimmed ${renamed} default rule name${renamed === 1 ? "" : "s"}`);
    applied += 1;
  }

  if (applied > 0) log.info(`applied ${applied} migration${applied === 1 ? "" : "s"}`);
}
