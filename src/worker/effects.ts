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
 *   any record decided          the work item it answered is done, or open again for someone else;
 *                               a lead two attempts failed on is dismissed instead (invariant 24)
 *   a record decided that others  verified: they are merged into it; rejected or withdrawn: their
 *   were found to duplicate     tasks open again; merged: they wait for the record it went into
 *   an illustration verified    its dish shows it; one that stops being verified stops showing
 *   a photo of a menu verified  becomes a menu for collectors to transcribe (one item for the pages
 *                               of one menu sent together)
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

/** Failed attempts after which a lead is dismissed rather than handed out again. */
export const LEAD_ATTEMPTS = 2;
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

  // First, records a maintainer found to duplicate this one: merged into it, a child of theirs then
  // moves here before this record's own children stop waiting below.
  statements.push(...(await resolveWaiting(db, record, to, at, options)));

  if (PARENT_KINDS.includes(record.kind)) {
    if (to === 'verified') {
      statements.push(
        db
          .prepare(
            `UPDATE tasks SET status = 'open' WHERE status = 'blocked'
             AND record_id IN (SELECT id FROM records WHERE parent_id = ? AND status = 'pending')
             AND NOT EXISTS (SELECT 1 FROM task_waits w WHERE w.task_id = tasks.id)`,
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
    // A lead someone already failed on once, failed on again, is closed: no one is handed it a
    // third time. Any other item opens again, with the reason, for someone else.
    const note = options.reason ? `The last attempt was rejected: ${options.reason}` : 'The last attempt was rejected.';
    statements.push(
      db
        .prepare(
          `UPDATE work_items SET
             status = CASE WHEN type = 'lead' AND COALESCE(json_extract(payload_json, ?4), 0) + 1 >= ?5 THEN 'dismissed' ELSE 'open' END,
             payload_json = json_set(COALESCE(payload_json, '{}'), ?4, COALESCE(json_extract(payload_json, ?4), 0) + 1),
             handed_to = NULL, handed_until = NULL, record_id = NULL, note = ?1, updated_at = ?2
           WHERE record_id = ?3 AND status = 'submitted'`,
        )
        .bind(note, at, record.id, '$.attempts', LEAD_ATTEMPTS),
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

  // The pages of one menu sent together share one item, named by the set (its first page). It is
  // handed out only once none of its pages waits for review (src/worker/work.ts).
  if (record.kind === 'photo' && to === 'verified') {
    const data = JSON.parse(record.data_json) as RecordData;
    if (data.subject === 'menu') {
      const set = typeof data.set === 'string' ? data.set : record.id;
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
             VALUES (?, 'transcribe', ?, 10, ?, 'open', ?, ?)`,
          )
          .bind(newId('wrk', Date.parse(at)), set, JSON.stringify({ place: data.place, set }), at, at),
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

/**
 * Records a maintainer found to duplicate `record` wait, their tasks parked (task_waits), until
 * `record` is decided. Verified (or stale): each is merged into it, as the maintainer said, with
 * `record` as the cause. Rejected or withdrawn: their tasks open again for a maintainer to decide
 * them on their own. Merged into another record: they wait for that one, or merge into it at once
 * if it is verified.
 */
async function resolveWaiting(
  db: D1Database,
  record: ChangingRecord,
  to: RecordStatus,
  at: string,
  options: { mergedInto?: string },
): Promise<D1PreparedStatement[]> {
  const { results: waiting } = await db
    .prepare(
      `SELECT w.task_id, r.id, r.kind, r.status, r.data_json, r.identity_key, r.parent_id, r.root_id
       FROM task_waits w INDEXED BY task_waits_for JOIN tasks t ON t.id = w.task_id JOIN records r ON r.id = w.record_id
       WHERE w.waits_for = ? AND t.status = 'blocked' AND r.status = 'pending'`,
    )
    .bind(record.id)
    .all<ChangingRecord & { task_id: string }>();
  if (waiting.length === 0) return [];
  const statements: D1PreparedStatement[] = [];
  let into: string | null = null;
  if (to === 'verified' || to === 'stale') into = record.id;
  else if (to === 'merged' && options.mergedInto) {
    const next = await db.prepare('SELECT status FROM records WHERE id = ?').bind(options.mergedInto).first<{ status: RecordStatus }>();
    if (next?.status === 'verified' || next?.status === 'stale') into = options.mergedInto;
    else {
      for (const twin of waiting) statements.push(db.prepare('UPDATE task_waits SET waits_for = ? WHERE task_id = ?').bind(options.mergedInto, twin.task_id));
      return statements;
    }
  }
  for (const twin of waiting) {
    statements.push(db.prepare('DELETE FROM task_waits WHERE task_id = ?').bind(twin.task_id));
    if (into) {
      const { task_id: _task, ...changing } = twin;
      void _task;
      statements.push(
        moveStanding(db, twin.id, 'merged', 'pending'),
        systemRevision(db, twin, 'merge', { status: 'merged', merged_into: into }, record.id, `A maintainer found it a duplicate of ${record.id}, now decided.`, at),
        db.prepare(`UPDATE records SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).bind(into, at, twin.id),
        cancelTasks(db, twin.id, at),
        ...(await statusEffects(db, changing, 'merged', at, { mergedInto: into })),
      );
    } else if (to === 'rejected' || to === 'withdrawn') {
      statements.push(
        db
          .prepare(`UPDATE tasks SET status = 'open', note = COALESCE(note, '') || ? WHERE id = ? AND status = 'blocked'`)
          .bind(` The record it was found to duplicate, ${record.id}, was not accepted: decide this one on its own.`, twin.task_id),
      );
    }
  }
  return statements;
}
