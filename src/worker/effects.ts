/**
 * What else changes when a record's status changes, as statements for the same batch. Every
 * writer of a status — maintainers' verdicts, the admin's decisions, undoing a token, banning a
 * collector — appends these, so a place and what hangs on it never disagree:
 *
 *   a place or brand verified   its children's tasks stop waiting (blocked → open)
 *   ... sent back to pending    their open tasks wait again
 *   ... rejected                its pending children are withdrawn: never reviewed, no one's fault
 *   ... merged into another     its children (and a brand's places) move to the other one; a child
 *                               that would duplicate one already there is merged into it
 *   any record decided          the work item it answered is done, or open again for someone else
 *   an illustration verified    its dish shows it; one that stops being verified stops showing
 *   a photo of a menu verified  becomes a menu for collectors to transcribe
 *
 * Changes the server makes this way are revisions by 'system' that name their cause, so undoing
 * the cause can undo them too (src/worker/console.ts revertToken).
 */

import { KIND_CONFIGS } from '../../kinds/index';
import { normDish } from '../shared/dish';
import { identityKey, type Kind, type RecordData } from '../shared/kinds';
import type { RecordStatus } from '../shared/types';
import { newId } from './ids';
import { moveStanding } from './tokens';

export const SYSTEM = 'system';

/** The record whose status changes, as it is before the change. */
export interface ChangingRecord {
  id: string;
  kind: Kind;
  status: RecordStatus;
  data_json: string;
  identity_key: string;
  parent_id: string | null;
  root_id: string | null;
}

interface ChildRow {
  id: string;
  kind: Kind;
  status: RecordStatus;
  data_json: string;
  identity_key: string;
  source_url: string;
  evidence: string;
  parent_id: string | null;
  root_id: string | null;
}

const PARENT_KINDS: readonly Kind[] = ['place', 'brand'];
const LIVE = `('pending', 'verified', 'stale')`;

/** A revision the server writes because `cause` changed. */
export function systemRevision(
  db: D1Database,
  record: { id: string; kind: Kind; status: string; data_json: string },
  action: string,
  after: unknown,
  cause: string,
  reason: string,
  at: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO revisions (record_id, kind, actor, action, before_json, after_json, reason, caused_by, created_at)
       VALUES (?, ?, 'system', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(record.id, record.kind, action, JSON.stringify({ status: record.status, data: JSON.parse(record.data_json) }),
      JSON.stringify(after), reason, cause, at);
}

/** Tasks waiting on a record stop waiting. */
export const cancelTasks = (db: D1Database, recordId: string, at: string): D1PreparedStatement =>
  db
    .prepare(`UPDATE tasks SET status = 'cancelled', done_at = ? WHERE record_id = ? AND status IN ('open', 'leased', 'review', 'blocked')`)
    .bind(at, recordId);

/** The statements that follow from `record` moving to `to`. Reads only the record's own children. */
export async function statusEffects(
  db: D1Database,
  record: ChangingRecord,
  to: RecordStatus,
  at: string,
  options: { mergedInto?: string; reason?: string } = {},
): Promise<D1PreparedStatement[]> {
  const from = record.status;
  const statements: D1PreparedStatement[] = [];
  if (from === to) return statements;

  if (PARENT_KINDS.includes(record.kind)) {
    if (to === 'verified') {
      statements.push(
        db
          .prepare(
            `UPDATE tasks SET status = 'open' WHERE status = 'blocked'
             AND record_id IN (SELECT id FROM records WHERE parent_id = ? AND status = 'pending')`,
          )
          .bind(record.id),
      );
    } else if (to === 'pending') {
      statements.push(
        db
          .prepare(
            `UPDATE tasks SET status = 'blocked' WHERE status = 'open'
             AND record_id IN (SELECT id FROM records WHERE parent_id = ? AND status = 'pending')`,
          )
          .bind(record.id),
      );
    } else if (to === 'rejected' || to === 'withdrawn') {
      statements.push(...(await withdrawChildren(db, record, at, options.reason ?? `Its ${record.kind} was not accepted.`)));
    } else if (to === 'merged' && options.mergedInto) {
      statements.push(...(await repointChildren(db, record, options.mergedInto, at)));
    }
  }

  // The work item this record answered.
  if (to === 'verified' || to === 'merged' || to === 'applied') {
    statements.push(
      db.prepare(`UPDATE work_items SET status = 'done', updated_at = ? WHERE record_id = ? AND status = 'submitted'`).bind(at, record.id),
    );
  } else if (to === 'rejected' || to === 'withdrawn') {
    statements.push(
      db
        .prepare(
          `UPDATE work_items SET status = 'open', handed_to = NULL, handed_until = NULL, record_id = NULL, note = ?, updated_at = ?
           WHERE record_id = ? AND status = 'submitted'`,
        )
        .bind(options.reason ? `The last attempt was rejected: ${options.reason}` : 'The last attempt was rejected.', at, record.id),
    );
  }

  if (record.kind === 'illustration') {
    const dish = (JSON.parse(record.data_json) as RecordData).dish;
    const key = typeof dish === 'string' ? normDish(dish) : '';
    if (key && to === 'verified') {
      statements.push(
        db
          .prepare(
            `INSERT INTO dishes (dish_key, name_zh, places, illustration_id, updated_at) VALUES (?1, ?2, 0, ?3, ?4)
             ON CONFLICT (dish_key) DO UPDATE SET illustration_id = excluded.illustration_id, updated_at = excluded.updated_at`,
          )
          .bind(key, dish, record.id, at),
      );
    } else if (key && from === 'verified') {
      statements.push(
        db.prepare('UPDATE dishes SET illustration_id = NULL, updated_at = ? WHERE dish_key = ? AND illustration_id = ?').bind(at, key, record.id),
      );
    }
  }

  if (record.kind === 'photo' && to === 'verified') {
    const data = JSON.parse(record.data_json) as RecordData;
    if (data.subject === 'menu') {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
             VALUES (?, 'transcribe', ?, 10, ?, 'open', ?, ?)`,
          )
          .bind(newId('wrk', Date.parse(at)), record.id, JSON.stringify({ place: data.place, photo: record.id }), at, at),
      );
    }
  }
  return statements;
}

async function childrenOf(db: D1Database, parentId: string): Promise<ChildRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, status, data_json, identity_key, source_url, evidence, parent_id, root_id
       FROM records WHERE parent_id = ? AND status IN ${LIVE}`,
    )
    .bind(parentId)
    .all<ChildRow>();
  return results;
}

/** Pending children of a rejected parent are withdrawn; verified ones stay, hidden with their parent. */
async function withdrawChildren(db: D1Database, parent: ChangingRecord, at: string, reason: string): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  for (const child of await childrenOf(db, parent.id)) {
    if (child.status !== 'pending') continue;
    statements.push(
      systemRevision(db, child, 'withdraw', { status: 'withdrawn' }, parent.id, reason, at),
      db.prepare(`UPDATE records SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(at, child.id),
      cancelTasks(db, child.id, at),
      db
        .prepare(
          `UPDATE work_items SET status = 'open', handed_to = NULL, handed_until = NULL, record_id = NULL, updated_at = ?
           WHERE record_id = ? AND status = 'submitted'`,
        )
        .bind(at, child.id),
    );
  }
  // Proposals waiting to change the parent have nothing left to change.
  const { results: proposals } = await db
    .prepare(`SELECT id, kind, status, data_json FROM records WHERE target_id = ? AND status = 'pending'`)
    .bind(parent.id)
    .all<{ id: string; kind: Kind; status: string; data_json: string }>();
  for (const proposal of proposals) {
    statements.push(
      systemRevision(db, proposal, 'withdraw', { status: 'withdrawn' }, parent.id, reason, at),
      db.prepare(`UPDATE records SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(at, proposal.id),
      cancelTasks(db, proposal.id, at),
    );
  }
  return statements;
}

/**
 * A merged parent's children move to the record it was merged into: their parent, the place whose
 * page shows them, the reference in their data, and their identity, which starts with the parent.
 * A child that would then duplicate one already there is merged into that one. A brand's places
 * move their brand reference too; proposals to change the merged record are withdrawn.
 */
async function repointChildren(db: D1Database, parent: ChangingRecord, targetId: string, at: string): Promise<D1PreparedStatement[]> {
  const target = await db
    .prepare('SELECT id, kind, status FROM records WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; kind: Kind; status: RecordStatus }>();
  if (!target) return [];
  const reason = `Moved to ${targetId}, which ${parent.id} was merged into.`;
  const statements: D1PreparedStatement[] = [];
  const claimed = new Set<string>();

  for (const child of await childrenOf(db, parent.id)) {
    const config = KIND_CONFIGS[child.kind];
    const data = JSON.parse(child.data_json) as RecordData;
    if (config.parent) data[config.parent] = targetId;
    const key = config.identity.length === 0 ? child.identity_key : identityKey(config, data, { source_url: child.source_url, evidence: child.evidence });
    const twin = claimed.has(`${child.kind}|${key}`)
      ? null
      : await db
          .prepare(`SELECT id FROM records WHERE kind = ? AND identity_key = ? AND status IN ${LIVE} AND target_id IS NULL AND id != ?`)
          .bind(child.kind, key, child.id)
          .first<{ id: string }>();
    if (twin) {
      statements.push(
        moveStanding(db, child.id, 'merged', child.status),
        systemRevision(db, child, 'merge', { status: 'merged', merged_into: twin.id }, parent.id, reason, at),
        db.prepare(`UPDATE records SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ? AND status = ?`).bind(twin.id, at, child.id, child.status),
        cancelTasks(db, child.id, at),
      );
      continue;
    }
    claimed.add(`${child.kind}|${key}`);
    const root = target.kind === 'place' ? targetId : child.root_id === parent.id ? null : child.root_id;
    statements.push(
      systemRevision(db, child, 'repoint', { status: child.status, data }, parent.id, reason, at),
      db
        .prepare('UPDATE records SET parent_id = ?, root_id = ?, data_json = ?, identity_key = ?, updated_at = ? WHERE id = ?')
        .bind(targetId, root, JSON.stringify(data), key, at, child.id),
    );
    if (child.status === 'pending' && target.status === 'verified') {
      statements.push(db.prepare(`UPDATE tasks SET status = 'open' WHERE record_id = ? AND status = 'blocked'`).bind(child.id));
    }
  }

  if (parent.kind === 'brand') {
    const { results: branches } = await db
      .prepare(`SELECT id, kind, status, data_json FROM records WHERE ref_id = ? AND status IN ${LIVE}`)
      .bind(parent.id)
      .all<{ id: string; kind: Kind; status: string; data_json: string }>();
    for (const branch of branches) {
      const data = JSON.parse(branch.data_json) as RecordData;
      data.brand = targetId;
      statements.push(
        systemRevision(db, branch, 'repoint', { status: branch.status, data }, parent.id, reason, at),
        db.prepare('UPDATE records SET ref_id = ?, data_json = ?, updated_at = ? WHERE id = ?').bind(targetId, JSON.stringify(data), at, branch.id),
      );
    }
  }

  const { results: proposals } = await db
    .prepare(`SELECT id, kind, status, data_json FROM records WHERE target_id = ? AND status = 'pending'`)
    .bind(parent.id)
    .all<{ id: string; kind: Kind; status: string; data_json: string }>();
  for (const proposal of proposals) {
    statements.push(
      systemRevision(db, proposal, 'withdraw', { status: 'withdrawn' }, parent.id, reason, at),
      db.prepare(`UPDATE records SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(at, proposal.id),
      cancelTasks(db, proposal.id, at),
    );
  }
  return statements;
}
