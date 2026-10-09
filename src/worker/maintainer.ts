/**
 * Maintainers' work: leasing tasks and applying verdicts.
 *
 * A lease reserves a task for one token for 30 minutes; a verdict only counts for a task leased
 * to the token sending it, while the lease lasts, and never for a record the same token
 * submitted. Every change writes a revision with the record before and after, moves the record
 * in its submitter's standing, and appends its effects (src/worker/effects.ts), in one batch.
 *
 *   task     verdicts                       record
 *   verify   verified rejected duplicate    pending  -> verified | rejected | merged
 *   update   verified rejected              proposal -> applied (its target changed in place) | rejected
 *   recheck  verified stale                 verified -> verified (again, maybe corrected) | stale
 *   any      unsure                         unchanged; the task waits for the admin
 *
 * A page or image the maintainer could not open is unsure, never grounds to reject or mark
 * stale: such verdicts are refused with an error that says so.
 */

import { KIND_CONFIGS } from '../../kinds/index';
import {
  cleanText,
  corrected,
  identityKey,
  normalizeUrl,
  patchList,
  recordName,
  validateProvenance,
  validateRecordData,
  type FieldError,
  type Kind,
  type KindConfig,
  type ListItem,
  type Provenance,
  type RecordData,
} from '../shared/kinds';
import { SAME_PASSAGE, similarity } from '../shared/similar';
import type { LeasedRecord, LeasedTask, LeaseResponse, RecordStatus, TaskType, Verdict, VerdictResult, VerdictsResponse, Work } from '../shared/types';
import { statusEffects, type ChangingRecord } from './effects';
import { sha256Hex } from './ids';
import { lookupPostcodes, placeFieldsFrom, type PostcodeAnswer } from './postcodes';
import { MINUTE } from './ratelimit';
import { DAILY_TASK_LIMIT, kindsOf, moveStanding, tallyOf, VERDICT_ACTIONS, type Token } from './tokens';
import { menuPages } from './work';
import { HttpError } from './types';

export const LEASE_MS = 30 * MINUTE;
export const LEASE_MAX = 10;
export const VERDICTS_MAX = 20;
const REASON_MAX = 300;

/** Collectors are suspended once this many records are reviewed and over half were rejected. */
export const SUSPEND_AFTER = 10;

const VERDICTS: Record<TaskType, readonly Verdict[]> = {
  verify: ['verified', 'rejected', 'duplicate', 'unsure'],
  update: ['verified', 'rejected', 'unsure'],
  recheck: ['verified', 'stale', 'unsure'],
};

const dayStart = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

/** The hash a maintainer echoes with list patches: a record's data as it was leased. */
export const dataHash = async (dataJson: string): Promise<string> => (await sha256Hex(dataJson)).slice(0, 16);

/** What a maintainer token holds and has done today, in one statement. */
export async function workOf(db: D1Database, token: Token, now: Date): Promise<Work> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM revisions INDEXED BY revisions_actor_time WHERE actor = ?1 AND created_at >= ?2
                AND action IN (SELECT value FROM json_each(?4))) AS done,
              (SELECT COUNT(*) FROM tasks INDEXED BY tasks_leased WHERE leased_to = ?1 AND status = 'leased' AND lease_expires_at > ?3) AS leased`,
    )
    .bind(token.id, dayStart(now), now.toISOString(), JSON.stringify(VERDICT_ACTIONS))
    .first<{ done: number; leased: number }>();
  return { leased: row?.leased ?? 0, done_today: row?.done ?? 0, daily_task_limit: token.dailyTaskLimit ?? DAILY_TASK_LIMIT };
}

interface HeldRow {
  task_id: string;
  type: TaskType;
  lease_expires_at: string;
  note: string | null;
  id: string;
  kind: Kind;
  status: RecordStatus;
  data_json: string;
  source_url: string;
  evidence: string;
  observed_at: string;
  created_at: string;
  verified_at: string | null;
  parent_id: string | null;
  target_id: string | null;
}

interface PlainRow {
  id: string;
  kind: Kind;
  status: RecordStatus;
  data_json: string;
  source_url: string;
  evidence: string;
  observed_at: string;
  created_at: string;
  verified_at: string | null;
}

async function leasedRecord(row: PlainRow): Promise<LeasedRecord> {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    data: JSON.parse(row.data_json) as RecordData,
    source_url: row.source_url,
    evidence: row.evidence,
    observed_at: row.observed_at,
    submitted_at: row.created_at,
    verified_at: row.verified_at,
    hash: await dataHash(row.data_json),
  };
}

/**
 * Leases open tasks — and tasks whose lease ran out — until the token holds `limit`, within its
 * daily limit, oldest first, skipping records it submitted itself and kinds it does not review.
 * Blocked tasks (a parent not verified yet) are never walked. Returns every task the token holds,
 * so an agent that lost its place picks up where it was. `mediaUrl` makes the address of a held
 * image, for photos and illustrations.
 */
export async function leaseTasks(
  db: D1Database,
  token: Token,
  options: { limit: number; kind?: Kind; mediaUrl: (taskId: string) => string; photoUrl?: (photoId: string) => string },
  now: Date,
): Promise<LeaseResponse> {
  const at = now.toISOString();
  const work = await workOf(db, token, now);
  const room = Math.max(0, Math.min(options.limit - work.leased, work.daily_task_limit - work.done_today - work.leased));
  const kinds = options.kind ? [options.kind] : kindsOf(token);
  if (room > 0 && kinds.length > 0) {
    const everyKind = !options.kind && token.kinds.includes('*');
    // One statement, so two maintainers leasing at once never get the same task. The status test
    // must stay word for word the index's WHERE, or SQLite cannot use it.
    await db
      .prepare(
        everyKind
          ? `UPDATE tasks SET status = 'leased', leased_to = ?1, lease_expires_at = ?2
             WHERE id IN (
               SELECT t.id FROM tasks t INDEXED BY tasks_open JOIN records r ON r.id = t.record_id
               WHERE t.status IN ('open', 'leased') AND (t.status = 'open' OR t.lease_expires_at <= ?3)
                 AND r.submitted_by != ?1 AND r.flagged = 0
               ORDER BY t.created_at, t.id LIMIT ?4)`
          : `UPDATE tasks SET status = 'leased', leased_to = ?1, lease_expires_at = ?2
             WHERE id IN (
               SELECT t.id FROM tasks t INDEXED BY tasks_open_kind JOIN records r ON r.id = t.record_id
               WHERE t.record_kind IN (SELECT value FROM json_each(?5)) AND t.status IN ('open', 'leased')
                 AND (t.status = 'open' OR t.lease_expires_at <= ?3) AND r.submitted_by != ?1 AND r.flagged = 0
               ORDER BY t.created_at, t.id LIMIT ?4)`,
      )
      .bind(token.id, new Date(now.getTime() + LEASE_MS).toISOString(), at, room, ...(everyKind ? [] : [JSON.stringify(kinds)]))
      .run();
  }
  const { results } = await db
    .prepare(
      `SELECT t.id AS task_id, t.type, t.lease_expires_at, t.note, r.id, r.kind, r.status, r.data_json, r.source_url, r.evidence,
         r.observed_at, r.created_at, r.verified_at, r.parent_id, r.target_id
       FROM tasks t INDEXED BY tasks_leased JOIN records r ON r.id = t.record_id
       WHERE t.status = 'leased' AND t.leased_to = ? AND t.lease_expires_at > ?
       ORDER BY t.created_at, t.id`,
    )
    .bind(token.id, at)
    .all<HeldRow>();

  const related = [...new Set(results.flatMap((row) => [row.parent_id, row.target_id].filter((id): id is string => Boolean(id))))];
  const others = new Map<string, PlainRow>();
  if (related.length > 0) {
    const { results: rows } = await db
      .prepare(
        `SELECT id, kind, status, data_json, source_url, evidence, observed_at, created_at, verified_at
         FROM records WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(JSON.stringify(related))
      .all<PlainRow>();
    for (const row of rows) others.set(row.id, row);
  }

  const tasks: LeasedTask[] = await Promise.all(
    results.map(async (row) => {
      const parent = row.parent_id ? others.get(row.parent_id) : undefined;
      const target = row.target_id ? others.get(row.target_id) : undefined;
      const parentData = parent ? (JSON.parse(parent.data_json) as RecordData) : null;
      return {
        id: row.task_id,
        type: row.type,
        kind: row.kind,
        lease_expires_at: row.lease_expires_at,
        note: row.note,
        record: await leasedRecord(row),
        parent: parent
          ? {
              id: parent.id,
              kind: parent.kind,
              name: recordName(KIND_CONFIGS[parent.kind], parentData!),
              postcode: typeof parentData!.postcode === 'string' ? parentData!.postcode : null,
              status: parent.status,
            }
          : null,
        target: target ? await leasedRecord(target) : null,
        media_url: KIND_CONFIGS[row.kind].provenance === 'upload' ? options.mediaUrl(row.task_id) : null,
        ...(row.kind === 'menu' ? await menuPhotoPages(db, row, options.photoUrl) : {}),
      };
    }),
  );
  if (tasks.length > 0) return { ...work, leased: tasks.length, tasks };
  return { ...work, leased: 0, tasks, note: await nothingToLease(db, token, kinds, room, work, at) };
}

/** A menu typed up from visitors' photos: every page, so the maintainer checks it against all of them. */
async function menuPhotoPages(db: D1Database, row: HeldRow, photoUrl?: (photoId: string) => string): Promise<{ pages?: string[] }> {
  const photo = (JSON.parse(row.data_json) as RecordData).photo;
  if (typeof photo !== 'string' || !photoUrl) return {};
  const first = await db.prepare(`SELECT parent_id, data_json FROM records WHERE id = ? AND kind = 'photo'`).bind(photo).first<{ parent_id: string; data_json: string }>();
  if (!first) return {};
  const set = ((JSON.parse(first.data_json) as RecordData).set as string | undefined) ?? photo;
  return { pages: (await menuPages(db, first.parent_id, set)).map(photoUrl) };
}

/** Why a maintainer got no task: its daily limit, its kinds, or tasks it may not take. */
async function nothingToLease(db: D1Database, token: Token, kinds: readonly string[], room: number, work: Work, at: string): Promise<string> {
  if (kinds.length === 0) return 'This token may review none of the kinds asked for; check GET /api/me for the kinds it covers.';
  if (room === 0) return `You have used today's limit of ${work.daily_task_limit} verdicts; tasks come again after midnight UTC.`;
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN r.submitted_by = ?1 THEN 1 ELSE 0 END) AS own,
         SUM(CASE WHEN r.submitted_by != ?1 AND t.status = 'leased' AND t.lease_expires_at > ?2 THEN 1 ELSE 0 END) AS held,
         SUM(CASE WHEN r.flagged = 1 THEN 1 ELSE 0 END) AS flagged
       FROM tasks t INDEXED BY tasks_open JOIN records r ON r.id = t.record_id
       WHERE t.status IN ('open', 'leased')`,
    )
    .bind(token.id, at)
    .first<{ own: number | null; held: number | null; flagged: number | null }>();
  const waiting = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM tasks INDEXED BY tasks_blocked WHERE status = 'blocked') AS blocked,
              (SELECT COUNT(*) FROM tasks INDEXED BY tasks_review WHERE status = 'review') AS review`,
    )
    .first<{ blocked: number | null; review: number | null }>();
  const reasons = [
    row?.own ? `${row.own} open ${row.own === 1 ? 'task is' : 'tasks are'} for records this token sent, and a maintainer never reviews its own: another maintainer will. To add records yourself, send them with a collector token (POST /api/join) and keep this one for reviewing.` : '',
    row?.held ? `${row.held} ${row.held === 1 ? 'is' : 'are'} leased to other maintainers until their leases end.` : '',
    waiting?.blocked ? `${waiting.blocked} wait for their place to be verified first.` : '',
    waiting?.review ? `${waiting.review} wait for the site team, because a maintainer was unsure of them; the site team decides them or sends them back.` : '',
    row?.flagged ? `${row.flagged} ${row.flagged === 1 ? 'is' : 'are'} held for the site team.` : '',
  ].filter(Boolean);
  return reasons.length ? `Nothing to review for you now. ${reasons.join(' ')}` : 'Nothing to review right now: every record sent has a verdict.';
}

interface TaskRow {
  task_id: string;
  type: TaskType;
  task_status: string;
  leased_to: string | null;
  lease_expires_at: string | null;
  id: string;
  kind: Kind;
  status: RecordStatus;
  identity_key: string;
  data_json: string;
  source_url: string;
  evidence: string;
  observed_at: string;
  submitted_by: string;
  parent_id: string | null;
  root_id: string | null;
  target_id: string | null;
  created_at: string;
}

interface TargetRow {
  id: string;
  kind: Kind;
  status: RecordStatus;
  identity_key: string;
  data_json: string;
  parent_id: string | null;
  root_id: string | null;
  updated_at: string;
}

const reasonOf = (value: unknown): string => (typeof value === 'string' ? cleanText(value) : '');

/**
 * Reasons that say the maintainer could not read the page or image, rather than that it
 * contradicts the record: a timeout, a refused or blocked request, a login or paywall. Such a task
 * is unsure, for a person to check. A page that is gone (404, 410) is another matter: that can
 * make a record stale.
 */
const COULD_NOT_READ: readonly RegExp[] = [
  /\bunreachable\b/i,
  /\b(?:could ?n[o']t|cannot|can ?not|unable to|failed to|fails to)\s+(?:be\s+)?(?:load|reach|fetch|access|open|retrieve|connect|view|download|see)/i,
  /\b(?:did ?n[o']t|does ?n[o']t|will not|won't|would ?n[o']t)\s+load\b/i,
  /\btim(?:ed|es|ing)?[ -]?out\b|\btimeouts?\b/i,
  /\b(?:HTTP|status|code|error)\s*(?:status\s*)?(?:code\s*)?:?\s*(?:0|403|429|5\d\d)\b/i,
  /\breturned\s+(?:an?\s+)?(?:HTTP\s+)?(?:403|429|5\d\d)\b/i,
  /\b(?:forbidden|access denied|captcha|rate[ -]limit(?:ed)?|too many requests|bot (?:check|protection|challenge|detection))\b/i,
  /\b(?:connection (?:refused|reset|error|failed)|network error|fetch failed|ssl error|certificate error)\b/i,
  /\bblock(?:s|ed|ing)?\b[^.]{0,40}\b(?:requests?|crawlers?|bots?|automated|fetch)\b/i,
  /\b(?:requires?|needs?)\s+(?:a\s+)?(?:log ?in|sign[ -]?in|browser|javascript)\b|\b(?:login|sign[ -]?in)\s+(?:wall|required)\b|\bpaywall/i,
  /打不开|无法(?:打开|访问|加载)|需要登录|验证码/,
];

export const couldNotRead = (reason: string): boolean => COULD_NOT_READ.some((pattern) => pattern.test(reason));

type Prepared = { task: TaskRow; verdict: Verdict; statements: D1PreparedStatement[]; recordStatus: RecordStatus } | { errors: FieldError[] };

/** The next version of a record: list patches (against the leased hash), then corrections, then the rules. */
async function nextData(
  config: KindConfig,
  data: RecordData,
  dataJson: string,
  item: Record<string, unknown>,
): Promise<{ data: RecordData } | { errors: FieldError[] }> {
  let draft: Record<string, unknown> = { ...data };
  const errors: FieldError[] = [];
  if (item.patches !== undefined) {
    if (typeof item.patches !== 'object' || item.patches === null || Array.isArray(item.patches)) {
      return { errors: [{ field: 'patches', message: 'must be an object: {"items": [{index, set} | {index, remove: true} | {add, after}]}' }] };
    }
    if (item.base_hash !== (await dataHash(dataJson))) {
      return {
        errors: [{ field: 'base_hash', message: 'must be record.hash from your lease: patches apply to the list as you read it. Lease again and redo them.' }],
      };
    }
    for (const [field, patches] of Object.entries(item.patches as Record<string, unknown>)) {
      const def = config.fields[field];
      if (def?.type !== 'list') {
        errors.push({ field: `patches.${field}`, message: 'patches change list fields only; use corrections for other fields' });
        continue;
      }
      const patched = patchList((draft[field] as ListItem[] | undefined) ?? [], patches, field);
      if (patched.ok) draft[field] = patched.value;
      else errors.push(...patched.errors);
    }
  }
  if (item.corrections !== undefined) {
    if (typeof item.corrections !== 'object' || item.corrections === null || Array.isArray(item.corrections)) {
      errors.push({ field: 'corrections', message: 'must be an object of the fields to change, with null to remove one' });
    } else {
      for (const field of Object.keys(item.corrections as object)) {
        if (config.fields[field]?.server) errors.push({ field: `corrections.${field}`, message: 'is set by the server; correct the postcode instead' });
        if (item.patches && field in (item.patches as object)) errors.push({ field: `corrections.${field}`, message: 'is patched too; do one or the other' });
      }
      draft = corrected(draft as RecordData, item.corrections as Record<string, unknown>);
    }
  }
  if (errors.length > 0) return { errors };
  // Server fields stay as stored; a changed postcode gets new ones below.
  const checked = validateRecordData(config, draft, { allowServer: true });
  if (!checked.ok) return { errors: checked.errors.map((error) => ({ field: `corrections.${error.field}`, message: error.message })) };
  return { data: checked.value };
}

async function prepareVerdict(
  db: D1Database,
  token: Token,
  item: Record<string, unknown>,
  now: Date,
  locate: (postcodes: string[]) => Promise<Map<string, PostcodeAnswer>>,
): Promise<Prepared> {
  const at = now.toISOString();
  const taskId = typeof item.task_id === 'string' ? item.task_id : '';
  const task = await db
    .prepare(
      `SELECT t.id AS task_id, t.type, t.status AS task_status, t.leased_to, t.lease_expires_at,
         r.id, r.kind, r.status, r.identity_key, r.data_json, r.source_url, r.evidence, r.observed_at, r.submitted_by,
         r.parent_id, r.root_id, r.target_id, r.created_at
       FROM tasks t JOIN records r ON r.id = t.record_id WHERE t.id = ?`,
    )
    .bind(taskId)
    .first<TaskRow>();
  if (!task) return { errors: [{ field: 'task_id', message: `no task ${JSON.stringify(taskId)}` }] };
  if (task.task_status !== 'leased' || task.leased_to !== token.id) {
    return { errors: [{ field: 'task_id', message: 'this task is not leased to you; lease tasks with GET /api/tasks first' }] };
  }
  if (!task.lease_expires_at || task.lease_expires_at <= at) {
    return { errors: [{ field: 'task_id', message: `your lease ran out at ${task.lease_expires_at}; lease the task again` }] };
  }
  if (task.submitted_by === token.id) return { errors: [{ field: 'task_id', message: 'you cannot give a verdict on a record you submitted' }] };

  const allowed = VERDICTS[task.type];
  const verdict = item.verdict as Verdict;
  if (!allowed.includes(verdict)) {
    return { errors: [{ field: 'verdict', message: `must be one of ${allowed.join(', ')} for a ${task.type} task; got ${JSON.stringify(item.verdict)}` }] };
  }

  const config = KIND_CONFIGS[task.kind];
  const data = JSON.parse(task.data_json) as RecordData;
  const before = JSON.stringify({ status: task.status, data });
  const revision = (recordId: string, action: string, beforeJson: string, after: unknown, extra: { reason?: string; source_url?: string; evidence?: string } = {}) =>
    db
      .prepare(
        `INSERT INTO revisions (record_id, kind, actor, action, before_json, after_json, reason, source_url, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(recordId, task.kind, token.id, action, beforeJson, JSON.stringify(after), extra.reason ?? null, extra.source_url ?? null,
        extra.evidence ?? null, at);
  const closeTask = (status: 'done' | 'review') => db.prepare('UPDATE tasks SET status = ?, done_at = ? WHERE id = ?').bind(status, at, task.task_id);
  const changing: ChangingRecord = { id: task.id, kind: task.kind, status: task.status, data_json: task.data_json, identity_key: task.identity_key, parent_id: task.parent_id, root_id: task.root_id };

  if (verdict === 'verified') {
    const next = await nextData(config, data, task.data_json, item);
    if ('errors' in next) return next;
    let nextValue = next.data;

    // Where it came from, by the kind's provenance.
    let provenance: Provenance = { source_url: task.source_url, evidence: task.evidence, observed_at: task.observed_at };
    if (config.provenance === 'upload') {
      if (item.source_url !== undefined || item.evidence !== undefined) {
        return { errors: [{ field: 'evidence', message: `a ${config.noun.en.one} is an image sent here: send no source_url or evidence, only what you saw` }] };
      }
    } else if (config.provenance === 'quote') {
      const checked = validateProvenance(config, { source_url: item.source_url, evidence: item.evidence, observed_at: item.observed_at ?? at }, now);
      if (!checked.ok) return { errors: checked.errors };
      provenance = checked.value;
    } else if (item.evidence !== undefined || item.source_url !== undefined) {
      // An excerpt is the content: the maintainer may set it right, word for word, not swap it.
      const checked = validateProvenance(
        config,
        { source_url: item.source_url ?? task.source_url, evidence: item.evidence ?? task.evidence, observed_at: item.observed_at ?? at },
        now,
      );
      if (!checked.ok) return { errors: checked.errors };
      if (normalizeUrl(checked.value.source_url) !== normalizeUrl(task.source_url)) {
        return { errors: [{ field: 'source_url', message: "is another page than the excerpt's; an excerpt stays with its page. Reject it if its page does not hold it" }] };
      }
      if (similarity(checked.value.evidence, task.evidence) < SAME_PASSAGE) {
        return { errors: [{ field: 'evidence', message: 'is a different passage from the one submitted; set the submitted passage right word for word, or reject it' }] };
      }
      provenance = checked.value;
    }

    // A place whose postcode changed is placed again.
    if (task.kind === 'place' && nextValue.postcode !== data.postcode) {
      const answer = (await locate([String(nextValue.postcode)])).get(String(nextValue.postcode));
      if (answer === undefined || answer === 'unavailable') return { errors: [{ field: 'corrections.postcode', message: 'the postcode service did not answer; send this verdict again in a few minutes' }] };
      if (answer === 'unknown' || !answer.london) {
        return { errors: [{ field: 'corrections.postcode', message: `${String(nextValue.postcode)} is not a London postcode in use` }] };
      }
      nextValue = { ...nextValue, ...placeFieldsFrom(answer) };
    }

    if (task.type === 'update') return applyProposal(db, token, task, config, nextValue, provenance, item, now, revision, closeTask);

    const key = config.identity.length === 0 ? task.identity_key : identityKey(config, nextValue, provenance);
    if (key !== task.identity_key) {
      const twin = await db
        .prepare(`SELECT id FROM records WHERE kind = ? AND identity_key = ? AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL AND id != ?`)
        .bind(task.kind, key, task.id)
        .first<{ id: string }>();
      if (twin) {
        return { errors: [{ field: 'corrections', message: `the corrected record matches ${twin.id}; send verdict duplicate with duplicate_of ${twin.id}` }] };
      }
    }
    const statements = [
      moveStanding(db, task.id, 'verified', task.status),
      db
        .prepare(
          `UPDATE records SET status = 'verified', data_json = ?, identity_key = ?, source_url = ?, evidence = ?, observed_at = ?,
             verified_at = ?, updated_at = ?
           WHERE id = ? AND status = ?`,
        )
        .bind(JSON.stringify(nextValue), key, provenance.source_url, provenance.evidence, provenance.observed_at, at, at, task.id, task.status),
      revision(task.id, 'verify', before, { status: 'verified', data: nextValue }, { source_url: provenance.source_url, evidence: provenance.evidence }),
      closeTask('done'),
      ...(await statusEffects(db, { ...changing, data_json: JSON.stringify(nextValue) }, 'verified', at)),
    ];
    return { task, verdict, statements, recordStatus: 'verified' };
  }

  if (verdict === 'duplicate') {
    const original = typeof item.duplicate_of === 'string' ? item.duplicate_of : '';
    const target = await db
      .prepare(`SELECT id FROM records WHERE id = ? AND kind = ? AND status = 'verified' AND target_id IS NULL AND id != ?`)
      .bind(original, task.kind, task.id)
      .first<{ id: string }>();
    if (!target) return { errors: [{ field: 'duplicate_of', message: `must be the id of another verified ${config.noun.en.one}` }] };
    return {
      task,
      verdict,
      recordStatus: 'merged',
      statements: [
        moveStanding(db, task.id, 'merged', 'pending'),
        db.prepare(`UPDATE records SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).bind(target.id, at, task.id),
        revision(task.id, 'merge', before, { status: 'merged', merged_into: target.id }),
        closeTask('done'),
        ...(await statusEffects(db, changing, 'merged', at, { mergedInto: target.id })),
      ],
    };
  }

  // rejected, stale and unsure carry a reason and nothing else.
  const reason = reasonOf(item.reason);
  if (!reason || reason.length > REASON_MAX) return { errors: [{ field: 'reason', message: `must say why, in 1 to ${REASON_MAX} characters` }] };
  if (verdict === 'unsure') {
    return { task, verdict, recordStatus: task.status, statements: [revision(task.id, 'unsure', before, { status: task.status }, { reason }), closeTask('review')] };
  }
  if (couldNotRead(reason)) {
    return {
      errors: [{
        field: 'verdict',
        message: 'the reason says you could not open the page or image, which says nothing about the record; send verdict unsure with this reason, and a person will check it',
      }],
    };
  }
  const status: RecordStatus = verdict === 'rejected' ? 'rejected' : 'stale';
  return {
    task,
    verdict,
    recordStatus: status,
    statements: [
      moveStanding(db, task.id, status, task.status),
      db.prepare('UPDATE records SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind(status, at, task.id, task.status),
      revision(task.id, verdict === 'rejected' ? 'reject' : 'stale', before, { status }, { reason }),
      closeTask('done'),
      ...(await statusEffects(db, changing, status, at, { reason })),
    ],
  };
}

/**
 * A proposal verified: its target becomes the proposal's version, in place, keeping its id; the
 * old version stays in the target's history. Refused when the target changed after the proposal
 * was made, since the proposal was written against an older version.
 */
async function applyProposal(
  db: D1Database,
  token: Token,
  task: TaskRow,
  config: KindConfig,
  next: RecordData,
  provenance: Provenance,
  item: Record<string, unknown>,
  now: Date,
  revision: (recordId: string, action: string, beforeJson: string, after: unknown, extra?: { reason?: string; source_url?: string; evidence?: string }) => D1PreparedStatement,
  closeTask: (status: 'done' | 'review') => D1PreparedStatement,
): Promise<Prepared> {
  const at = now.toISOString();
  const target = await db
    .prepare('SELECT id, kind, status, identity_key, data_json, parent_id, root_id, updated_at FROM records WHERE id = ?')
    .bind(task.target_id)
    .first<TargetRow>();
  if (!target || (target.status !== 'verified' && target.status !== 'stale')) {
    return { errors: [{ field: 'task_id', message: `the record this proposal updates is ${target?.status ?? 'gone'}; send verdict rejected` }] };
  }
  if (target.updated_at > task.created_at) {
    return { errors: [{ field: 'task_id', message: 'the record changed after this proposal was made; send verdict unsure, and a person will settle it' }] };
  }
  const key = config.identity.length === 0 ? target.identity_key : identityKey(config, next, provenance);
  if (key !== target.identity_key) {
    const twin = await db
      .prepare(`SELECT id FROM records WHERE kind = ? AND identity_key = ? AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL AND id != ?`)
      .bind(task.kind, key, target.id)
      .first<{ id: string }>();
    if (twin) return { errors: [{ field: 'corrections', message: `the updated record would match ${twin.id}; send verdict rejected and say so` }] };
  }
  void item;
  const refId = config.kind === 'place' && typeof next.brand === 'string' ? next.brand : null;
  const targetBefore = JSON.stringify({ status: target.status, data: JSON.parse(target.data_json) });
  const proposalBefore = JSON.stringify({ status: task.status, data: JSON.parse(task.data_json) });
  const statements = [
    moveStanding(db, target.id, 'verified', target.status),
    db
      .prepare(
        `UPDATE records SET status = 'verified', data_json = ?, identity_key = ?, ref_id = ?, source_url = ?, evidence = ?, observed_at = ?,
           verified_at = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
      )
      .bind(JSON.stringify(next), key, refId, provenance.source_url, provenance.evidence, provenance.observed_at, at, at, target.id, target.status),
    revision(target.id, 'update', targetBefore, { status: 'verified', data: next, proposal: task.id }, { source_url: provenance.source_url, evidence: provenance.evidence }),
    moveStanding(db, task.id, 'applied', 'pending'),
    db.prepare(`UPDATE records SET status = 'applied', merged_into = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).bind(target.id, at, task.id),
    revision(task.id, 'apply', proposalBefore, { status: 'applied', merged_into: target.id }),
    closeTask('done'),
    ...(await statusEffects(db, { ...target, data_json: JSON.stringify(next) }, 'verified', at)),
    ...(await statusEffects(db, { id: task.id, kind: task.kind, status: 'pending', data_json: task.data_json, identity_key: task.identity_key, parent_id: task.parent_id, root_id: task.root_id }, 'applied', at)),
  ];
  void token;
  return { task, verdict: 'verified', statements, recordStatus: 'applied' };
}

/**
 * Suspends active collectors among `tokenIds` whose reviewed records, every kind together, are
 * mostly rejected.
 */
export async function suspendIfFailing(db: D1Database, tokenIds: Iterable<string>, now: Date): Promise<void> {
  for (const id of tokenIds) {
    let good = 0;
    let bad = 0;
    for (const kind of Object.keys(KIND_CONFIGS) as Kind[]) {
      const tally = await tallyOf(db, id, kind, now);
      good += tally.verified + tally.stale;
      bad += tally.rejected;
    }
    if (good + bad >= SUSPEND_AFTER && bad / (good + bad) > 0.5) {
      await db.prepare(`UPDATE tokens SET status = 'suspended' WHERE id = ? AND role = 'collector' AND status = 'active'`).bind(id).run();
    }
  }
}

export async function applyVerdicts(db: D1Database, token: Token, body: unknown, now: Date, fetcher: typeof fetch = fetch): Promise<VerdictsResponse> {
  const items = (body as { verdicts?: unknown } | null)?.verdicts;
  if (!Array.isArray(items) || items.length === 0 || items.length > VERDICTS_MAX) {
    throw new HttpError(422, 'invalid_body', `Send JSON like {"verdicts": [...]} with 1 to ${VERDICTS_MAX} verdicts.`);
  }
  const results: VerdictResult[] = [];
  const reviewed = new Set<string>();
  const locate = (postcodes: string[]) => lookupPostcodes(db, postcodes, now, fetcher);

  // One at a time: a later verdict may depend on an earlier one, e.g. duplicate_of a record
  // verified earlier in the same batch.
  for (const [index, raw] of items.entries()) {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const taskId = typeof item.task_id === 'string' ? item.task_id : null;
    const prepared = await prepareVerdict(db, token, item, now, locate);
    if ('errors' in prepared) {
      results.push({ index, task_id: taskId, status: 'error', errors: prepared.errors });
      continue;
    }
    try {
      await db.batch(prepared.statements);
    } catch (error) {
      if (!/UNIQUE/i.test(String(error))) throw error;
      results.push({
        index,
        task_id: taskId,
        status: 'error',
        errors: [{ field: 'corrections', message: 'another live record already has this identity; send verdict duplicate instead' }],
      });
      continue;
    }
    // Only the first review of a submission can count against its collector.
    if (prepared.task.type !== 'recheck' && (prepared.verdict === 'verified' || prepared.verdict === 'rejected')) {
      reviewed.add(prepared.task.submitted_by);
    }
    results.push({ index, task_id: prepared.task.task_id, status: 'applied', record_status: prepared.recordStatus });
  }

  await suspendIfFailing(db, reviewed, now);
  return { ...(await workOf(db, token, now)), results };
}

/**
 * A collector asks for a live place, brand or menu to be checked again: it closed, it moved, its
 * menu changed. The recheck carries the reason and the page as its note. Already waiting: nothing.
 */
export async function flagRecord(
  db: D1Database,
  token: Token,
  id: string,
  body: { reason?: unknown; source_url?: unknown },
  now: Date,
): Promise<{ queued: boolean }> {
  const reason = reasonOf(body.reason);
  if (reason.length < 3 || reason.length > REASON_MAX) {
    throw new HttpError(422, 'invalid_body', `reason must say what changed, in 3 to ${REASON_MAX} characters.`);
  }
  let source: string | null = null;
  if (body.source_url !== undefined) {
    try {
      const url = new URL(String(body.source_url));
      if (url.protocol !== 'https:') throw new Error('not https');
      source = url.toString();
    } catch {
      throw new HttpError(422, 'invalid_body', 'source_url must be the full https:// URL of the page that shows the change.');
    }
  }
  const record = await db.prepare(`SELECT id, kind, status FROM records WHERE id = ? AND target_id IS NULL`).bind(id).first<{ id: string; kind: Kind; status: RecordStatus }>();
  if (!record || (record.status !== 'verified' && record.status !== 'stale')) throw new HttpError(404, 'not_found', 'No live record has that id.');
  if (KIND_CONFIGS[record.kind].recheckAfterDays === null) {
    throw new HttpError(422, 'invalid_body', `${KIND_CONFIGS[record.kind].noun.en.other} are not rechecked; report a problem with it instead.`);
  }
  const waiting = await db
    .prepare(`SELECT id FROM tasks WHERE record_id = ? AND status IN ('open', 'leased', 'review', 'blocked')`)
    .bind(id)
    .first<{ id: string }>();
  if (waiting) return { queued: false };
  await db
    .prepare(`INSERT INTO tasks (id, record_id, record_kind, type, status, note, created_at) VALUES (?, ?, ?, 'recheck', 'open', ?, ?)`)
    .bind(
      `tsk_${(await sha256Hex(`${id}:${now.toISOString()}`)).slice(0, 26)}`,
      id,
      record.kind,
      `Flagged by ${token.label}: ${reason}${source ? ` (${source})` : ''}`,
      now.toISOString(),
    )
    .run();
  return { queued: true };
}
