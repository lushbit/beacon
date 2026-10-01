import type {
  CanvasAccess,
  CanvasContent,
  CanvasEmbed,
  CanvasPageDto,
  CanvasPageSummaryDto,
} from "@beacon/shared";
import { emptyCanvasContent } from "@beacon/shared";
import { db, parseJson } from "../db/index.js";
import { newId, newToken } from "../utils/ids.js";

export interface CanvasRow {
  id: string;
  slug: string;
  access: CanvasAccess;
  enabled: number;
  share_key: string;
  password_hash: string | null;
  embed: CanvasEmbed;
  embed_origins: string;
  draft: string;
  live: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

export function listCanvasRows(): CanvasRow[] {
  return db.prepare("SELECT * FROM canvas_pages ORDER BY updated_at DESC").all() as CanvasRow[];
}

export function getCanvasRow(id: string): CanvasRow | undefined {
  return db.prepare("SELECT * FROM canvas_pages WHERE id = ?").get(id) as CanvasRow | undefined;
}

export function getCanvasBySlug(slug: string): CanvasRow | undefined {
  return db.prepare("SELECT * FROM canvas_pages WHERE slug = ?").get(slug) as CanvasRow | undefined;
}

export function slugTaken(slug: string, exceptId?: string): boolean {
  const row = getCanvasBySlug(slug);
  return Boolean(row && row.id !== exceptId);
}

export function draftOf(row: CanvasRow): CanvasContent {
  return parseJson<CanvasContent>(row.draft, emptyCanvasContent("Untitled page"));
}

export function liveOf(row: CanvasRow): CanvasContent | null {
  return parseJson<CanvasContent | null>(row.live, null);
}

export function createCanvas(input: { slug: string; content: CanvasContent; createdBy: string | null }): CanvasRow {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO canvas_pages (id, slug, access, enabled, share_key, password_hash, embed, embed_origins,
                               draft, live, created_by, created_at, updated_at, published_at)
     VALUES (?, ?, 'public', 1, ?, NULL, 'none', '[]', ?, NULL, ?, ?, ?, NULL)`
  ).run(id, input.slug, newToken(18), JSON.stringify(input.content), input.createdBy, now, now);
  return getCanvasRow(id)!;
}

export function saveDraft(id: string, content: CanvasContent): void {
  db.prepare("UPDATE canvas_pages SET draft = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(content), Date.now(), id);
}

export function publishCanvas(id: string): void {
  const now = Date.now();
  db.prepare("UPDATE canvas_pages SET live = draft, published_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
}

/** Puts the draft back to what visitors see. */
export function discardDraft(id: string): void {
  db.prepare("UPDATE canvas_pages SET draft = live, updated_at = ? WHERE id = ? AND live IS NOT NULL").run(Date.now(), id);
}

export function updateCanvasSettings(
  id: string,
  patch: {
    slug?: string;
    access?: CanvasAccess;
    enabled?: boolean;
    passwordHash?: string | null;
    shareKey?: string;
    embed?: CanvasEmbed;
    embedOrigins?: string[];
  }
): void {
  const row = getCanvasRow(id);
  if (!row) return;
  db.prepare(
    `UPDATE canvas_pages
        SET slug = ?, access = ?, enabled = ?, password_hash = ?, share_key = ?, embed = ?, embed_origins = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    patch.slug ?? row.slug,
    patch.access ?? row.access,
    patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
    patch.passwordHash === undefined ? row.password_hash : patch.passwordHash,
    patch.shareKey ?? row.share_key,
    patch.embed ?? row.embed,
    patch.embedOrigins ? JSON.stringify(patch.embedOrigins) : row.embed_origins,
    Date.now(),
    id
  );
}

export function deleteCanvas(id: string): void {
  db.prepare("DELETE FROM canvas_pages WHERE id = ?").run(id);
}

export function toCanvasSummary(row: CanvasRow): CanvasPageSummaryDto {
  const draft = draftOf(row);
  return {
    id: row.id,
    slug: row.slug,
    title: draft.title,
    access: row.access,
    enabled: row.enabled === 1,
    published: row.live !== null,
    dirty: row.live === null || row.live !== row.draft,
    blocks: draft.blocks.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

export function toCanvasDto(row: CanvasRow): CanvasPageDto {
  return {
    ...toCanvasSummary(row),
    draft: draftOf(row),
    live: liveOf(row),
    shareKey: row.share_key,
    hasPassword: Boolean(row.password_hash),
    embed: row.embed,
    embedOrigins: parseJson<string[]>(row.embed_origins, []),
  };
}
