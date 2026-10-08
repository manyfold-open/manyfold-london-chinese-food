/**
 * The collectors' work feed: things the site wants done, each handed to one agent at a time so two
 * agents do not do the same work.
 *
 *   lead        a place someone (OpenStreetMap, the Food Standards Agency) suggests exists:
 *               research it, then send it as a place, or dismiss it with a reason
 *   menu        a public place with no menu yet
 *   reviews     a public place with few review excerpts
 *   transcribe  a menu photo a visitor uploaded, to type up as a menu
 *   illustrate  a standard dish no illustration shows yet: generate one, upload it
 *
 * An item is handed out for HANDOUT_MS; an agent that answers it sends `work_item` with its
 * record (or uploads the illustration with it), which marks it submitted. When that record is
 * verified the item is done; when it is rejected the item opens again with the reason
 * (src/worker/effects.ts).
 */

import type { WorkItem, WorkType } from '../shared/types';
import { WORK_TYPES } from '../shared/types';
import { newId } from './ids';
import { HOUR } from './ratelimit';
import { illustrationSettings } from './settings';
import type { Token } from './tokens';
import { HttpError } from './types';

export const HANDOUT_MS = 2 * HOUR;
export const HANDOUT_MAX = 20;

interface ItemRow {
  id: string;
  type: WorkType;
  subject: string;
  priority: number;
  payload_json: string | null;
  status: string;
  handed_until: string | null;
  note: string | null;
}

const toItem = (row: ItemRow): WorkItem => ({
  id: row.id,
  type: row.type,
  subject: row.subject,
  priority: row.priority,
  payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : null,
  status: row.status,
  handed_until: row.handed_until,
  note: row.note,
});

export const isWorkType = (value: unknown): value is WorkType => typeof value === 'string' && (WORK_TYPES as readonly string[]).includes(value);

/** How many illustrate items went out today, for the admin's daily bound. */
async function illustratedToday(db: D1Database, now: Date): Promise<number> {
  const row = await db
    .prepare(`SELECT value FROM settings WHERE scope = 'illustrate-day' AND key = ?`)
    .bind(now.toISOString().slice(0, 10))
    .first<{ value: string }>();
  return Number(row?.value ?? 0);
}

/**
 * Hands up to `limit` open items of a type to the token, most wanted first, and returns every
 * item of that type the token holds. One statement, so two agents never get the same item.
 */
export async function handOut(db: D1Database, token: Token, type: WorkType, limit: number, now: Date): Promise<WorkItem[]> {
  const at = now.toISOString();
  let room = Math.max(0, Math.min(limit, HANDOUT_MAX));
  if (type === 'illustrate') {
    const settings = await illustrationSettings(db);
    room = settings.requested ? Math.min(room, Math.max(0, settings.daily - (await illustratedToday(db, now)))) : 0;
  }
  if (room > 0) {
    const result = await db
      .prepare(
        `UPDATE work_items SET handed_to = ?1, handed_until = ?2, updated_at = ?3
         WHERE id IN (
           SELECT id FROM work_items INDEXED BY work_items_open
           WHERE type = ?4 AND status = 'open' AND (handed_to IS NULL OR handed_until <= ?3) AND created_at <= ?3
           ORDER BY priority DESC, created_at LIMIT ?5)`,
      )
      .bind(token.id, new Date(now.getTime() + HANDOUT_MS).toISOString(), at, type, room)
      .run();
    const handed = Number(result.meta.changes ?? 0);
    if (type === 'illustrate' && handed > 0) {
      await db
        .prepare(
          `INSERT INTO settings (scope, key, value, updated_at) VALUES ('illustrate-day', ?1, ?2, ?3)
           ON CONFLICT (scope, key) DO UPDATE SET value = CAST(value AS INTEGER) + ?2, updated_at = ?3`,
        )
        .bind(at.slice(0, 10), handed, at)
        .run();
    }
  }
  const { results } = await db
    .prepare(
      `SELECT id, type, subject, priority, payload_json, status, handed_until, note FROM work_items INDEXED BY work_items_handed
       WHERE handed_to = ? AND type = ? AND status = 'open' AND handed_until > ? ORDER BY priority DESC, created_at`,
    )
    .bind(token.id, type, at)
    .all<ItemRow>();
  return results.map(toItem);
}

/** A held item the agent gives up on: a lead that is not a place to list is dismissed for good, anything else goes back. */
export async function dismiss(db: D1Database, token: Token, id: string, body: { reason?: unknown }, now: Date): Promise<WorkItem> {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  if (reason.length < 3) throw new HttpError(422, 'invalid_body', 'Say why, in 3 to 300 characters: e.g. "closed in 2023", "a Thai restaurant", "same as rec_...".');
  const row = await db.prepare('SELECT * FROM work_items WHERE id = ?').bind(id).first<ItemRow & { handed_to: string | null }>();
  if (!row || row.handed_to !== token.id || row.status !== 'open' || !row.handed_until || row.handed_until <= now.toISOString()) {
    throw new HttpError(404, 'not_found', 'You hold no open work item with that id; ask for work with GET /api/work first.');
  }
  const at = now.toISOString();
  if (row.type === 'lead') {
    await db.prepare(`UPDATE work_items SET status = 'dismissed', note = ?, updated_at = ? WHERE id = ?`).bind(reason, at, id).run();
  } else {
    // Someone else may find what this agent could not; it goes to the back of the queue.
    await db
      .prepare(`UPDATE work_items SET handed_to = NULL, handed_until = NULL, priority = priority - 1, note = ?, updated_at = ? WHERE id = ?`)
      .bind(reason, at, id)
      .run();
  }
  return toItem((await db.prepare('SELECT * FROM work_items WHERE id = ?').bind(id).first<ItemRow>())!);
}

/** Work items as statements: open one (if new or done before), or close one, for the read-model builder. */
export function wantWork(db: D1Database, type: WorkType, subject: string, priority: number, payload: Record<string, unknown>, now: Date): D1PreparedStatement {
  const at = now.toISOString();
  return db
    .prepare(
      `INSERT INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
       ON CONFLICT (type, subject) DO UPDATE SET priority = excluded.priority, payload_json = excluded.payload_json,
         status = CASE WHEN work_items.status = 'done' THEN 'open' ELSE work_items.status END, updated_at = excluded.updated_at`,
    )
    .bind(newId('wrk', now.getTime()), type, subject, priority, JSON.stringify(payload), at, at);
}

export function doneWork(db: D1Database, type: WorkType, subject: string, now: Date): D1PreparedStatement {
  return db
    .prepare(`UPDATE work_items SET status = 'done', handed_to = NULL, handed_until = NULL, updated_at = ? WHERE type = ? AND subject = ? AND status = 'open'`)
    .bind(now.toISOString(), type, subject);
}

/* ───────── leads ───────── */

export interface Lead {
  /** Where the lead comes from and its id there, e.g. "osm:node/123", "fsa:456". */
  subject: string;
  name: string;
  address?: string;
  postcode?: string;
  /** Why we think it serves Chinese food, e.g. "OSM cuisine=chinese". */
  hint?: string;
  sources?: string[];
  priority?: number;
}

/** Adds leads the admin imported (scripts/leads.ts). One already known is left alone. */
export async function importLeads(db: D1Database, leads: unknown, now: Date): Promise<{ added: number; known: number }> {
  if (!Array.isArray(leads) || leads.length === 0 || leads.length > 500) {
    throw new HttpError(422, 'invalid_body', 'Send {"leads": [...]} with 1 to 500 leads: {subject, name, address?, postcode?, hint?, sources?, priority?}.');
  }
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const [index, raw] of leads.entries()) {
    const lead = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Lead>;
    if (typeof lead.subject !== 'string' || !/^[a-z]+:[A-Za-z0-9/_.-]{1,80}$/.test(lead.subject) || typeof lead.name !== 'string' || !lead.name.trim()) {
      throw new HttpError(422, 'invalid_body', `leads[${index}] needs subject (like "osm:node/123") and name.`);
    }
    const payload = {
      name: lead.name.trim().slice(0, 120),
      address: typeof lead.address === 'string' ? lead.address.trim().slice(0, 200) : undefined,
      postcode: typeof lead.postcode === 'string' ? lead.postcode.trim().slice(0, 10) : undefined,
      hint: typeof lead.hint === 'string' ? lead.hint.trim().slice(0, 200) : undefined,
      sources: Array.isArray(lead.sources) ? lead.sources.filter((source): source is string => typeof source === 'string').slice(0, 5) : undefined,
    };
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
           VALUES (?, 'lead', ?, ?, ?, 'open', ?, ?)`,
        )
        .bind(newId('wrk', now.getTime()), lead.subject, typeof lead.priority === 'number' ? Math.round(lead.priority) : 0, JSON.stringify(payload), at, at),
    );
  }
  const results = await db.batch(statements);
  const added = results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
  return { added, known: leads.length - added };
}

/** The work feed as the admin sees it: counts by type and status, and the latest items of a type. */
export async function workAdmin(db: D1Database, type: WorkType | null, status: string | null): Promise<{ counts: { type: string; status: string; n: number }[]; items: WorkItem[] }> {
  const [counts, items] = await db.batch([
    db.prepare('SELECT type, status, COUNT(*) AS n FROM work_items GROUP BY type, status'),
    db
      .prepare(
        `SELECT id, type, subject, priority, payload_json, status, handed_until, note FROM work_items
         WHERE (? IS NULL OR type = ?) AND (? IS NULL OR status = ?) ORDER BY updated_at DESC LIMIT 100`,
      )
      .bind(type, type, status, status),
  ]);
  return {
    counts: (counts?.results ?? []) as { type: string; status: string; n: number }[],
    items: ((items?.results ?? []) as ItemRow[]).map(toItem),
  };
}

/** The admin opens an item again (a lead dismissed by mistake). */
export async function reopenWork(db: D1Database, id: string, now: Date): Promise<void> {
  const result = await db
    .prepare(`UPDATE work_items SET status = 'open', handed_to = NULL, handed_until = NULL, record_id = NULL, updated_at = ? WHERE id = ?`)
    .bind(now.toISOString(), id)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'not_found', 'No work item has that id.');
}
