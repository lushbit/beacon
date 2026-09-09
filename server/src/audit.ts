import type { AuditEntryDto } from "@beacon/shared";
import { db } from "./db/index.js";
import { newId } from "./utils/ids.js";

export function audit(entry: {
  actor: string;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
}): void {
  db.prepare(
    "INSERT INTO audit_log (id, ts, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(newId(), Date.now(), entry.actor, entry.action, entry.target ?? null, entry.detail ?? null, entry.ip ?? null);
}

export function listAudit(limit = 200): AuditEntryDto[] {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?").all(limit) as {
    id: string;
    ts: number;
    actor: string;
    action: string;
    target: string | null;
    detail: string | null;
    ip: string | null;
  }[];
  return rows;
}

export function purgeOldAudit(days = 90): void {
  db.prepare("DELETE FROM audit_log WHERE ts < ?").run(Date.now() - days * 86400_000);
}
