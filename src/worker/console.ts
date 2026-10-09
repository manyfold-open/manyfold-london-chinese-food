/**
 * What the /settings console reads and does, beyond tokens (tokens.ts): the overview, the review
 * queue, any record with its full history, the admin's own decisions and edits, takedowns, reader
 * reports, activity, undoing one token's work, banning a collector, and the weekly spot-check.
 *
 * Every change to a record writes a revision with actor 'admin', moves the record in its
 * submitter's standing, and appends its effects (src/worker/effects.ts), in one batch.
 */

import { KIND_CONFIGS } from '../../kinds/index';
import { cleanText, identityKey, KINDS, onHosts, recordName, validateProvenance, validateRecordData, type Kind, type Provenance, type RecordData } from '../shared/kinds';
import type {
  ActivityItem,
  AdminRecord,
  AdminRecordDetail,
  AdminRevision,
  KindOverview,
  PlaceFacts,
  Precedent,
  RecordStatus,
  Report,
  RevertReport,
  ReviewItem,
  SpotCheck,
  UnsureType,
} from '../shared/types';
import { RECORD_STATUSES } from '../shared/types';
import { cancelTasks, statusEffects, SYSTEM, type ChangingRecord } from './effects';
import { newId, sha256Hex } from './ids';
import { blockedHosts, hostOf, putSetting } from './settings';
import { moveStanding, suspendMaintainerIfFailing } from './tokens';
import { HttpError } from './types';

const ADMIN = 'admin';
const REASON_MAX = 500;
const PAGE_SIZE = 50;
export const SPOT_CHECK_SIZE = 50;

/* ───────── records as the admin sees them ───────── */

interface RecordRow {
  id: string;
  kind: Kind;
  parent_id: string | null;
  root_id: string | null;
  ref_id: string | null;
  target_id: string | null;
  identity_key: string;
  status: RecordStatus;
  data_json: string;
  source_url: string;
  evidence: string;
  observed_at: string;
  submitted_by: string;
  submitter_label: string | null;
  flagged: number;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
}

const RECORD_SELECT = `SELECT r.*, t.label AS submitter_label FROM records r LEFT JOIN tokens t ON t.id = r.submitted_by`;

export const actorLabel = (id: string, label: string | null | undefined): string =>
  id === ADMIN ? 'Admin' : id === SYSTEM ? 'Site (automatic)' : id === 'visitor' ? 'A visitor' : (label ?? 'Unknown token');

function toAdminRecord(row: RecordRow): AdminRecord {
  const data = JSON.parse(row.data_json) as RecordData;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    name: recordName(KIND_CONFIGS[row.kind], data),
    data,
    parent_id: row.parent_id,
    root_id: row.root_id,
    target_id: row.target_id,
    source_url: row.source_url,
    evidence: row.evidence,
    observed_at: row.observed_at,
    submitted_by: { id: row.submitted_by, label: actorLabel(row.submitted_by, row.submitter_label) },
    flagged: row.flagged === 1,
    merged_into: row.merged_into,
    created_at: row.created_at,
    updated_at: row.updated_at,
    verified_at: row.verified_at,
  };
}

const changingOf = (row: RecordRow): ChangingRecord => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  data_json: row.data_json,
  identity_key: row.identity_key,
  parent_id: row.parent_id,
  root_id: row.root_id,
});

async function recordRow(db: D1Database, id: string): Promise<RecordRow> {
  const row = await db.prepare(`${RECORD_SELECT} WHERE r.id = ?`).bind(id).first<RecordRow>();
  if (!row) throw new HttpError(404, 'not_found', `No record ${id}.`);
  return row;
}

export async function listRecords(
  db: D1Database,
  query: { kind?: string; status?: string; q?: string; parent?: string; by?: string; page?: number },
): Promise<{ total: number; page: number; records: AdminRecord[] }> {
  const kind = query.kind && (KINDS as readonly string[]).includes(query.kind) ? query.kind : null;
  const status = query.status && (RECORD_STATUSES as readonly string[]).includes(query.status) ? query.status : null;
  const like = query.q ? `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const parent = query.parent || null;
  const page = Math.max(1, query.page ?? 1);
  const where = `(?1 IS NULL OR r.kind = ?1) AND (?2 IS NULL OR r.status = ?2) AND (?3 IS NULL OR r.data_json LIKE ?3 ESCAPE '\\' OR r.id = ?4)
    AND (?5 IS NULL OR r.parent_id = ?5 OR r.root_id = ?5) AND (?6 IS NULL OR r.submitted_by = ?6)`;
  const params = [kind, status, like, query.q ?? null, parent, query.by || null];
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM records r WHERE ${where}`).bind(...params),
    db.prepare(`${RECORD_SELECT} WHERE ${where} ORDER BY r.updated_at DESC, r.id LIMIT ?7 OFFSET ?8`).bind(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);
  return {
    total: (count?.results[0] as { n: number } | undefined)?.n ?? 0,
    page,
    records: ((rows?.results ?? []) as RecordRow[]).map(toAdminRecord),
  };
}

export async function recordDetail(db: D1Database, id: string): Promise<AdminRecordDetail> {
  const row = await recordRow(db, id);
  const [revisions, tasks, reports, children] = await db.batch([
    db.prepare(`SELECT v.*, t.label FROM revisions v LEFT JOIN tokens t ON t.id = v.actor WHERE v.record_id = ? ORDER BY v.id`).bind(id),
    db.prepare('SELECT id, type, status, leased_to, note, created_at FROM tasks WHERE record_id = ? ORDER BY created_at').bind(id),
    db.prepare('SELECT * FROM reports WHERE record_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT kind, status, COUNT(*) AS count FROM records WHERE parent_id = ? GROUP BY kind, status').bind(id),
  ]);
  return {
    record: toAdminRecord(row),
    revisions: ((revisions?.results ?? []) as Record<string, string | number | null>[]).map(
      (revision): AdminRevision => ({
        id: Number(revision.id),
        action: String(revision.action),
        actor: { id: String(revision.actor), label: actorLabel(String(revision.actor), revision.label as string | null) },
        reason: (revision.reason as string | null) ?? null,
        before: revision.before_json ? JSON.parse(String(revision.before_json)) : null,
        after: JSON.parse(String(revision.after_json)),
        source_url: (revision.source_url as string | null) ?? null,
        evidence: (revision.evidence as string | null) ?? null,
        caused_by: (revision.caused_by as string | null) ?? null,
        created_at: String(revision.created_at),
      }),
    ),
    tasks: (tasks?.results ?? []) as AdminRecordDetail['tasks'],
    reports: (reports?.results ?? []) as Report[],
    children: (children?.results ?? []) as AdminRecordDetail['children'],
  };
}

/* ───────── overview and review queue ───────── */

export async function overview(db: D1Database): Promise<KindOverview[]> {
  const [counts, tasks, review, browser, oldest] = await db.batch([
    db.prepare('SELECT kind, status, COUNT(*) AS n FROM records GROUP BY kind, status'),
    db.prepare(`SELECT record_kind AS kind, status, COUNT(*) AS n FROM tasks WHERE status IN ('open', 'leased', 'blocked', 'review') GROUP BY record_kind, status`),
    db.prepare(
      `SELECT kind, COUNT(*) AS n FROM (
         SELECT r.kind FROM records r JOIN reports p ON p.record_id = r.id WHERE p.status = 'open'
         UNION ALL SELECT kind FROM records WHERE status = 'pending' AND flagged = 1)
       GROUP BY kind`,
    ),
    db.prepare(
      `SELECT t.record_kind AS kind, COUNT(*) AS n FROM task_needs n JOIN tasks t ON t.id = n.task_id
       WHERE n.need = 'browser' AND t.status IN ('open', 'leased') GROUP BY t.record_kind`,
    ),
    db.prepare(`SELECT record_kind AS kind, MIN(done_at) AS at FROM tasks INDEXED BY tasks_review WHERE status = 'review' GROUP BY record_kind`),
  ]);
  return KINDS.map((kind) => {
    const byStatus = Object.fromEntries(RECORD_STATUSES.map((status) => [status, 0])) as Record<RecordStatus, number>;
    for (const row of (counts?.results ?? []) as { kind: Kind; status: RecordStatus; n: number }[]) if (row.kind === kind) byStatus[row.status] = row.n;
    const taskRows = ((tasks?.results ?? []) as { kind: Kind; status: string; n: number }[]).filter((row) => row.kind === kind);
    const taskCount = (statuses: string[]) => taskRows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.n, 0);
    const extra = ((review?.results ?? []) as { kind: Kind; n: number }[]).find((row) => row.kind === kind)?.n ?? 0;
    return {
      kind,
      counts: byStatus,
      open_tasks: taskCount(['open', 'leased']),
      blocked_tasks: taskCount(['blocked']),
      review: taskCount(['review']) + extra,
      needs_browser: ((browser?.results ?? []) as { kind: Kind; n: number }[]).find((row) => row.kind === kind)?.n ?? 0,
      oldest_review_at: ((oldest?.results ?? []) as { kind: Kind; at: string | null }[]).find((row) => row.kind === kind)?.at ?? null,
    };
  });
}

/** What waits for the admin: unsure verdicts, records flagged at submit, open reader reports. */
export async function reviewQueue(db: D1Database, kind?: string): Promise<ReviewItem[]> {
  const only = kind && (KINDS as readonly string[]).includes(kind) ? kind : null;
  const [unsure, flagged, reports] = await db.batch([
    db
      .prepare(
        `${RECORD_SELECT.replace('SELECT r.*', `SELECT r.*, k.id AS task_id,
           (SELECT reason FROM revisions WHERE record_id = r.id AND action = 'unsure' ORDER BY id DESC LIMIT 1) AS note,
           (SELECT actor FROM revisions WHERE record_id = r.id AND action = 'unsure' ORDER BY id DESC LIMIT 1) AS note_by,
           (SELECT t2.label FROM revisions v2 JOIN tokens t2 ON t2.id = v2.actor WHERE v2.record_id = r.id AND v2.action = 'unsure' ORDER BY v2.id DESC LIMIT 1) AS note_by_label,
           (SELECT after_json FROM revisions WHERE record_id = r.id AND action = 'unsure' ORDER BY id DESC LIMIT 1) AS note_after,
           k.done_at AS at`)}
         JOIN tasks k ON k.record_id = r.id WHERE k.status = 'review' AND (? IS NULL OR r.kind = ?)`,
      )
      .bind(only, only),
    db.prepare(`${RECORD_SELECT} WHERE r.status = 'pending' AND r.flagged = 1 AND (? IS NULL OR r.kind = ?)`).bind(only, only),
    db
      .prepare(
        `${RECORD_SELECT.replace('SELECT r.*', 'SELECT r.*, p.id AS report_id, p.type AS report_type, p.reason AS note, p.created_at AS at')}
         JOIN reports p ON p.record_id = r.id WHERE p.status = 'open' AND (? IS NULL OR r.kind = ?)`,
      )
      .bind(only, only),
  ]);
  type Row = RecordRow & {
    task_id?: string;
    report_id?: number;
    report_type?: string;
    note?: string;
    note_by?: string;
    note_by_label?: string | null;
    note_after?: string | null;
    at?: string;
  };
  const rows = [unsure, flagged, reports].flatMap((result) => (result?.results ?? []) as Row[]);
  const facts = await factsOf(db, rows.filter((row) => row.kind === 'place').map((row) => row.id));
  const factsFor = (row: Row) => facts.get(row.id) ?? null;
  const items: ReviewItem[] = [
    ...((unsure?.results ?? []) as Row[]).map((row) => ({
      type: 'unsure' as const,
      record: toAdminRecord(row),
      reason: row.note ?? '',
      unsure_type: row.note_after ? ((JSON.parse(row.note_after) as { unsure_type?: UnsureType }).unsure_type ?? null) : null,
      facts: factsFor(row),
      by: row.note_by ?? null,
      by_label: row.note_by ? actorLabel(row.note_by, row.note_by_label) : null,
      at: row.at ?? row.updated_at,
      task_id: row.task_id ?? null,
      report_id: null,
    })),
    ...((flagged?.results ?? []) as Row[]).map((row) => ({
      type: 'flagged' as const,
      record: toAdminRecord(row),
      reason: 'Text that looks aimed at AI agents',
      unsure_type: null,
      facts: factsFor(row),
      by: row.submitted_by,
      by_label: actorLabel(row.submitted_by, row.submitter_label),
      at: row.created_at,
      task_id: null,
      report_id: null,
    })),
    ...((reports?.results ?? []) as Row[]).map((row) => ({
      type: 'report' as const,
      record: toAdminRecord(row),
      reason: `${row.report_type === 'takedown' ? 'Takedown request: ' : ''}${row.note ?? ''}`,
      unsure_type: null,
      facts: factsFor(row),
      by: null,
      by_label: null,
      at: row.at ?? row.updated_at,
      task_id: null,
      report_id: row.report_id ?? null,
    })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** What the server looked up about these places, by id. */
async function factsOf(db: D1Database, ids: readonly string[]): Promise<Map<string, PlaceFacts>> {
  const facts = new Map<string, PlaceFacts>();
  if (ids.length === 0) return facts;
  const { results } = await db
    .prepare('SELECT record_id, facts_json FROM facts WHERE record_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids))
    .all<{ record_id: string; facts_json: string }>();
  for (const row of results) facts.set(row.record_id, JSON.parse(row.facts_json) as PlaceFacts);
  return facts;
}

/* ───────── the admin's own changes ───────── */

const reasonOf = (value: unknown, required: boolean): string | null => {
  const reason = typeof value === 'string' ? cleanText(value) : '';
  if (reason.length > REASON_MAX) throw new HttpError(422, 'invalid_body', `reason must be at most ${REASON_MAX} characters.`);
  if (!reason && required) throw new HttpError(422, 'invalid_body', 'reason is required for this decision.');
  return reason || null;
};

const adminRevision = (db: D1Database, row: RecordRow, action: string, after: unknown, reason: string | null, at: string, provenance: Provenance | null = null) =>
  db
    .prepare(
      `INSERT INTO revisions (record_id, kind, actor, action, before_json, after_json, reason, source_url, evidence, created_at)
       VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.kind,
      action,
      JSON.stringify({ status: row.status, data: JSON.parse(row.data_json) }),
      JSON.stringify(after),
      reason,
      provenance?.source_url ?? null,
      provenance?.evidence ?? null,
      at,
    );

/** The admin's own passage for a decision, checked like a maintainer's, or null when none was sent. */
function provenanceOf(row: RecordRow, body: { source_url?: unknown; evidence?: unknown; observed_at?: unknown }, now: Date): Provenance | null {
  if (body.source_url === undefined && body.evidence === undefined) return null;
  const config = KIND_CONFIGS[row.kind];
  if (config.provenance === 'upload') throw new HttpError(422, 'invalid_body', `A ${config.noun.en.one} is an image sent here: it has no source page.`);
  const checked = validateProvenance(config, { source_url: body.source_url, evidence: body.evidence, observed_at: body.observed_at ?? now.toISOString() }, now);
  if (!checked.ok) throw new HttpError(422, 'invalid_body', checked.errors.map((error) => `${error.field} ${error.message}`).join('; '));
  return checked.value;
}

/** A precedent the admin wants written into the rules, checked for length. */
function precedentOf(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const rule = typeof value === 'string' ? cleanText(value) : '';
  if (rule.length < 10 || rule.length > 300) throw new HttpError(422, 'invalid_body', 'precedent must state the rule in 10 to 300 characters.');
  return rule;
}

/**
 * After the admin decides a record a maintainer had decided, that maintainer's standing is read
 * again: one whose checked verdicts are mostly overturned is suspended (tokens.ts).
 */
async function checkMaintainerOf(db: D1Database, recordId: string, now: Date): Promise<void> {
  const last = await db
    .prepare(
      `SELECT v.actor FROM revisions v INDEXED BY revisions_record JOIN tokens t ON t.id = v.actor
       WHERE v.record_id = ? AND t.role = 'maintainer' AND v.action IN ('verify', 'reject', 'merge', 'stale', 'apply') ORDER BY v.id DESC LIMIT 1`,
    )
    .bind(recordId)
    .first<{ actor: string }>();
  if (last) await suspendMaintainerIfFailing(db, last.actor, now);
}

const newTask = (db: D1Database, row: RecordRow, status: 'open' | 'blocked', now: Date) =>
  db
    .prepare(`INSERT INTO tasks (id, record_id, record_kind, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(newId('tsk', now.getTime()), row.id, row.kind, row.target_id ? 'update' : 'verify', status, now.toISOString());

/** Whether a record's parent is still waiting, so a task for it must wait too. */
async function parentPending(db: D1Database, row: RecordRow): Promise<boolean> {
  if (!row.parent_id) return false;
  const parent = await db.prepare('SELECT status FROM records WHERE id = ?').bind(row.parent_id).first<{ status: string }>();
  return parent?.status === 'pending';
}

/**
 * The admin sets a record's status: verified, rejected, stale, merged (with duplicate_of), or
 * pending, which sends it back to the maintainers. Open reports on it are resolved. A proposal is
 * decided by its maintainers; the admin rejects it or sends it back, never applies it here.
 *
 * The admin may send a passage of its own (source_url, evidence), checked like a maintainer's and
 * kept with the revision; a place or menu verified with one takes it as its source, and a record
 * whose source cannot stand alone (the kind's `sourceNotAlone`) is verified only with one. A `precedent`
 * states the rule the decision follows, for the rules to learn (listPrecedents).
 */
export async function decide(
  db: D1Database,
  id: string,
  body: { status?: unknown; reason?: unknown; duplicate_of?: unknown; source_url?: unknown; evidence?: unknown; observed_at?: unknown; precedent?: unknown },
  now: Date,
): Promise<AdminRecordDetail> {
  const row = await recordRow(db, id);
  const at = now.toISOString();
  const status = body.status;
  const statements: D1PreparedStatement[] = [];
  const provenance = provenanceOf(row, body, now);
  const precedent = precedentOf(body.precedent);

  if (row.target_id && status !== 'rejected' && status !== 'pending') {
    throw new HttpError(422, 'invalid_body', 'A proposal is applied by a maintainer verdict; here it can only be rejected or sent back (pending).');
  }
  if (status === 'verified') {
    const notAlone = KIND_CONFIGS[row.kind].sourceNotAlone;
    if (!provenance && notAlone && onHosts(row.source_url, notAlone.hosts)) {
      throw new HttpError(422, 'invalid_body', `Its source ${notAlone.message} Send source_url and evidence from such a page with the decision.`);
    }
    const newSource = provenance && KIND_CONFIGS[row.kind].provenance === 'quote';
    statements.push(
      moveStanding(db, id, 'verified'),
      newSource
        ? db
            .prepare(
              `UPDATE records SET status = 'verified', flagged = 0, merged_into = NULL, source_url = ?, evidence = ?, observed_at = ?, verified_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(provenance.source_url, provenance.evidence, provenance.observed_at, at, at, id)
        : db.prepare(`UPDATE records SET status = 'verified', flagged = 0, merged_into = NULL, verified_at = ?, updated_at = ? WHERE id = ?`).bind(at, at, id),
      adminRevision(db, row, 'verify', { status: 'verified' }, reasonOf(body.reason, false), at, provenance),
      cancelTasks(db, id, at),
      ...(await statusEffects(db, changingOf(row), 'verified', at)),
    );
  } else if (status === 'rejected' || status === 'stale') {
    const reason = reasonOf(body.reason, true)!;
    statements.push(
      moveStanding(db, id, status),
      db.prepare('UPDATE records SET status = ?, updated_at = ? WHERE id = ?').bind(status, at, id),
      adminRevision(db, row, status === 'rejected' ? 'reject' : 'stale', { status }, reason, at, provenance),
      cancelTasks(db, id, at),
      ...(await statusEffects(db, changingOf(row), status, at, { reason })),
    );
  } else if (status === 'merged') {
    const target = typeof body.duplicate_of === 'string' ? body.duplicate_of : '';
    const original = await db
      .prepare(`SELECT id FROM records WHERE id = ? AND kind = ? AND status = 'verified' AND target_id IS NULL AND id != ?`)
      .bind(target, row.kind, id)
      .first<{ id: string }>();
    if (!original) throw new HttpError(422, 'invalid_body', `duplicate_of must be the id of another verified ${row.kind}.`);
    statements.push(
      moveStanding(db, id, 'merged'),
      db.prepare(`UPDATE records SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?`).bind(original.id, at, id),
      adminRevision(db, row, 'merge', { status: 'merged', merged_into: original.id }, reasonOf(body.reason, false), at),
      cancelTasks(db, id, at),
      ...(await statusEffects(db, changingOf(row), 'merged', at, { mergedInto: original.id })),
    );
  } else if (status === 'pending') {
    statements.push(
      moveStanding(db, id, 'pending'),
      db.prepare(`UPDATE records SET status = 'pending', flagged = 0, verified_at = NULL, updated_at = ? WHERE id = ?`).bind(at, id),
      adminRevision(db, row, 'reopen', { status: 'pending' }, reasonOf(body.reason, false), at),
      cancelTasks(db, id, at),
      newTask(db, row, (await parentPending(db, row)) ? 'blocked' : 'open', now),
      ...(await statusEffects(db, changingOf(row), 'pending', at)),
    );
  } else {
    throw new HttpError(422, 'invalid_body', 'status must be verified, rejected, stale, merged or pending.');
  }
  statements.push(db.prepare(`UPDATE reports SET status = 'resolved' WHERE record_id = ? AND status = 'open'`).bind(id));
  if (precedent) {
    statements.push(
      db.prepare('INSERT INTO precedents (record_id, kind, decision, rule, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, row.kind, String(status), precedent, at),
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (!/UNIQUE/i.test(String(error))) throw error;
    throw new HttpError(409, 'conflict', 'Another live record already has this identity. Merge this one into it instead.');
  }
  await checkMaintainerOf(db, id, now);
  return recordDetail(db, id);
}

/** The admin corrects field values; status stays. `corrections` work like a maintainer's. */
export async function editRecord(db: D1Database, id: string, body: { corrections?: unknown; reason?: unknown }, now: Date): Promise<AdminRecordDetail> {
  const row = await recordRow(db, id);
  const config = KIND_CONFIGS[row.kind];
  if (typeof body.corrections !== 'object' || body.corrections === null || Array.isArray(body.corrections)) {
    throw new HttpError(422, 'invalid_body', 'corrections must be an object of the fields to change, with null to remove one.');
  }
  const merged: Record<string, unknown> = { ...(JSON.parse(row.data_json) as RecordData) };
  for (const [field, value] of Object.entries(body.corrections)) {
    if (config.fields[field]?.server) throw new HttpError(422, 'invalid_body', `${field} is set by the server.`);
    if (field === config.parent && value !== merged[field]) throw new HttpError(422, 'invalid_body', `${field} cannot be edited; merge the parent instead.`);
    if (value === null) delete merged[field];
    else merged[field] = value;
  }
  const checked = validateRecordData(config, merged, { allowServer: true });
  if (!checked.ok) throw new HttpError(422, 'invalid_body', checked.errors.map((error) => `${error.field} ${error.message}`).join('; '));
  // A place's brand is mirrored in ref_id, which a brand's merge and its pages follow.
  let refId = row.ref_id;
  if (row.kind === 'place') {
    const brand = typeof checked.value.brand === 'string' ? checked.value.brand : null;
    if (brand && brand !== row.ref_id) {
      const found = await db
        .prepare(`SELECT id FROM records WHERE id = ? AND kind = 'brand' AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL`)
        .bind(brand)
        .first<{ id: string }>();
      if (!found) throw new HttpError(422, 'invalid_body', `brand must be the id of a live brand; ${brand} is not one.`);
    }
    refId = brand;
  }
  const at = now.toISOString();
  const key = config.identity.length === 0 ? row.identity_key : identityKey(config, checked.value, row);
  try {
    await db.batch([
      db.prepare('UPDATE records SET data_json = ?, identity_key = ?, ref_id = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(checked.value), key, refId, at, id),
      adminRevision(db, row, 'admin_edit', { status: row.status, data: checked.value }, reasonOf(body.reason, false), at),
    ]);
  } catch (error) {
    if (!/UNIQUE/i.test(String(error))) throw error;
    throw new HttpError(409, 'conflict', 'Another live record already has this identity.');
  }
  return recordDetail(db, id);
}

/**
 * A rights holder asked for something to come down: the record is rejected with the reason, its
 * open reports resolved, and, when asked, its source's whole site is blocked from new submissions.
 * Media files are deleted by the caller.
 */
export async function takedown(db: D1Database, id: string, body: { reason?: unknown; block_host?: unknown }, now: Date): Promise<AdminRecordDetail> {
  const reason = reasonOf(body.reason, true)!;
  const row = await recordRow(db, id);
  if (row.status !== 'rejected') await decide(db, id, { status: 'rejected', reason: `Taken down: ${reason}` }, now);
  if (body.block_host === true && row.source_url) {
    const hosts = await blockedHosts(db);
    const host = hostOf(row.source_url);
    if (!hosts.includes(host)) await putSetting(db, 'blocked_hosts', JSON.stringify([...hosts, host].sort()), now).run();
  }
  return recordDetail(db, id);
}

/** Sets the hosts this site may not quote. */
export async function setBlockedHosts(db: D1Database, hosts: unknown, now: Date): Promise<string[]> {
  if (!Array.isArray(hosts) || !hosts.every((host) => typeof host === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host))) {
    throw new HttpError(422, 'invalid_body', 'hosts must be a list of host names, such as ["example.com"].');
  }
  const clean = [...new Set(hosts.map((host: string) => host.toLowerCase().replace(/^www\./, '')))].sort();
  await putSetting(db, 'blocked_hosts', JSON.stringify(clean), now).run();
  return clean;
}

/* ───────── reader reports ───────── */

/** A reader's report on a public record, or a rights holder's takedown request. */
export async function createReport(db: D1Database, recordId: string, body: { reason?: unknown; type?: unknown }, now: Date): Promise<void> {
  const reason = typeof body.reason === 'string' ? cleanText(body.reason) : '';
  if (reason.length < 3 || reason.length > REASON_MAX) throw new HttpError(422, 'invalid_body', `Say what is wrong, in 3 to ${REASON_MAX} characters.`);
  const type = body.type === 'takedown' ? 'takedown' : 'wrong';
  const record = await db.prepare(`SELECT id FROM records WHERE id = ? AND status IN ('verified', 'stale')`).bind(recordId).first<{ id: string }>();
  if (!record) throw new HttpError(404, 'not_found', 'No public record has that id.');
  await db
    .prepare(`INSERT INTO reports (record_id, type, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)`)
    .bind(recordId, type, reason, now.toISOString())
    .run();
}

export async function resolveReport(db: D1Database, id: number): Promise<void> {
  const result = await db.prepare(`UPDATE reports SET status = 'resolved' WHERE id = ? AND status = 'open'`).bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, 'not_found', 'No open report has that id.');
}

/* ───────── activity ───────── */

export async function activity(db: D1Database, filter: { kind?: string; actor?: string; limit?: number }): Promise<ActivityItem[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.kind, v.record_id, v.action, v.actor, v.reason, v.created_at, r.data_json, t.label
       FROM revisions v JOIN records r ON r.id = v.record_id LEFT JOIN tokens t ON t.id = v.actor
       WHERE (? IS NULL OR v.kind = ?) AND (? IS NULL OR v.actor = ?)
       ORDER BY v.id DESC LIMIT ?`,
    )
    .bind(filter.kind ?? null, filter.kind ?? null, filter.actor ?? null, filter.actor ?? null, Math.min(200, filter.limit ?? 100))
    .all<{ id: number; kind: Kind; record_id: string; action: string; actor: string; reason: string | null; created_at: string; data_json: string; label: string | null }>();
  return results.map((row) => ({
    id: row.id,
    kind: row.kind,
    record_id: row.record_id,
    record_name: recordName(KIND_CONFIGS[row.kind], JSON.parse(row.data_json) as RecordData),
    action: row.action,
    actor: { id: row.actor, label: actorLabel(row.actor, row.label) },
    reason: row.reason,
    created_at: row.created_at,
  }));
}

/* ───────── undoing a token's work ───────── */

interface HistoryRow {
  id: number;
  actor: string;
  action: string;
  before_json: string | null;
  after_json: string;
  caused_by: string | null;
  created_at: string;
}

/**
 * Undoes everything a token changed since `since`: each record it touched goes back to how it was
 * before the token's first change in that window. A record the token created is rejected. A record
 * someone else has changed since is left alone and listed in `skipped`. What the server changed
 * because of those records (children withdrawn or moved) is undone with them. A proposal the
 * token applied puts its target back and waits for review again.
 */
export async function revertToken(db: D1Database, tokenId: string, since: unknown, now: Date): Promise<RevertReport> {
  const from = typeof since === 'string' ? Date.parse(since) : Number.NaN;
  if (!Number.isFinite(from)) throw new HttpError(422, 'invalid_body', 'since must be a date or time in ISO 8601.');
  const token = await db.prepare('SELECT label FROM tokens WHERE id = ?').bind(tokenId).first<{ label: string }>();
  if (!token) throw new HttpError(404, 'not_found', 'No token has that id.');
  const sinceIso = new Date(from).toISOString();
  const reason = `Undid changes by ${token.label} since ${sinceIso}`;

  const { results: touched } = await db
    .prepare(`SELECT DISTINCT record_id FROM revisions WHERE actor = ? AND created_at >= ? AND action NOT IN ('revert', 'unsure', 'defer')`)
    .bind(tokenId, sinceIso)
    .all<{ record_id: string }>();

  const report: RevertReport = { reverted: 0, skipped: [] };
  const restored = new Set<string>();
  for (const { record_id } of touched) {
    const outcome = await restore(db, record_id, (revision) => revision.actor === tokenId && revision.created_at >= sinceIso, reason, now);
    if (outcome === true) {
      report.reverted += 1;
      restored.add(record_id);
    } else report.skipped.push({ record_id, reason: outcome });
  }
  // What the server did because of the records put back.
  for (const cause of restored) {
    const { results: effects } = await db
      .prepare(`SELECT DISTINCT record_id FROM revisions WHERE caused_by = ? AND actor = 'system' AND created_at >= ?`)
      .bind(cause, sinceIso)
      .all<{ record_id: string }>();
    for (const { record_id } of effects) {
      if (restored.has(record_id)) continue;
      const outcome = await restore(db, record_id, (revision) => revision.actor === SYSTEM && revision.caused_by === cause && revision.created_at >= sinceIso, reason, now);
      if (outcome === true) report.reverted += 1;
      else report.skipped.push({ record_id, reason: outcome });
    }
  }
  return report;
}

/** Puts one record back to before the first revision `mine` matches. True, or why not. */
async function restore(db: D1Database, recordId: string, mine: (revision: HistoryRow) => boolean, reason: string, now: Date): Promise<true | string> {
  const at = now.toISOString();
  const { results: history } = await db
    .prepare('SELECT id, actor, action, before_json, after_json, caused_by, created_at FROM revisions WHERE record_id = ? ORDER BY id')
    .bind(recordId)
    .all<HistoryRow>();
  const last = history.filter((revision) => revision.action !== 'unsure' && revision.action !== 'defer').at(-1);
  if (!last || !mine(last)) return 'changed by someone else since; settle it by hand';
  const first = history.find((revision) => mine(revision) && revision.action !== 'revert' && revision.action !== 'unsure' && revision.action !== 'defer')!;
  const row = await db.prepare(`${RECORD_SELECT} WHERE r.id = ?`).bind(recordId).first<RecordRow>();
  if (!row) return 'gone';
  const config = KIND_CONFIGS[row.kind];

  // Created in the window: there is no earlier state, so the record is rejected.
  const target = first.before_json
    ? (JSON.parse(first.before_json) as { status: RecordStatus; data: RecordData; merged_into?: string })
    : { status: 'rejected' as RecordStatus, data: JSON.parse(row.data_json) as RecordData };
  const statements: D1PreparedStatement[] = [];

  // A proposal it applied: put the target back too, and let the proposal wait again.
  if (row.status === 'applied' && row.merged_into) {
    const targetRow = await db.prepare(`${RECORD_SELECT} WHERE r.id = ?`).bind(row.merged_into).first<RecordRow>();
    const update = targetRow
      ? (await db
          .prepare(`SELECT id, before_json FROM revisions WHERE record_id = ? AND action = 'update' AND after_json LIKE ? ORDER BY id DESC LIMIT 1`)
          .bind(targetRow.id, `%"proposal":"${recordId}"%`)
          .first<{ id: number; before_json: string }>())
      : null;
    if (!targetRow || !update) return 'the record it updated cannot be put back; settle it by hand';
    const previous = JSON.parse(update.before_json) as { status: RecordStatus; data: RecordData };
    statements.push(
      moveStanding(db, targetRow.id, previous.status),
      db
        .prepare('UPDATE records SET status = ?, data_json = ?, identity_key = ?, updated_at = ? WHERE id = ?')
        .bind(previous.status, JSON.stringify(previous.data), identityKey(config, previous.data, targetRow), at, targetRow.id),
      adminRevision(db, targetRow, 'revert', { status: previous.status, data: previous.data }, reason, at),
    );
  }

  const parentWaits = await parentPending(db, row);
  statements.push(
    moveStanding(db, recordId, target.status),
    db
      .prepare(
        `UPDATE records SET status = ?, data_json = ?, identity_key = ?, merged_into = ?, parent_id = coalesce(?, parent_id), root_id = coalesce(?, root_id),
           verified_at = CASE WHEN ? = 'verified' THEN verified_at ELSE NULL END, updated_at = ?
         WHERE id = ?`,
      )
      .bind(target.status, JSON.stringify(target.data),
        config.identity.length === 0 ? row.identity_key : identityKey(config, target.data, row),
        target.merged_into ?? null,
        config.parent ? (target.data[config.parent] as string | undefined) ?? null : null,
        config.parent && typeof target.data[config.parent] === 'string' && row.root_id ? (target.data[config.parent] as string) : null,
        target.status, at, recordId),
    adminRevision(db, row, 'revert', { status: target.status, data: target.data }, reason, at),
    cancelTasks(db, recordId, at),
  );
  if (target.status === 'pending') statements.push(newTask(db, row, parentWaits ? 'blocked' : 'open', now));
  statements.push(...(await statusEffects(db, changingOf(row), target.status, at, { reason })));
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (!/UNIQUE/i.test(String(error))) throw error;
    return 'its earlier version would duplicate another live record';
  }
}

/** Revokes a collector and rejects every record it has waiting for review. */
export async function banCollector(db: D1Database, tokenId: string, now: Date): Promise<{ rejected: number }> {
  const token = await db.prepare('SELECT label, role FROM tokens WHERE id = ?').bind(tokenId).first<{ label: string; role: string }>();
  if (!token) throw new HttpError(404, 'not_found', 'No token has that id.');
  if (token.role !== 'collector') throw new HttpError(422, 'invalid_body', 'Only collectors are banned; revoke a maintainer instead.');
  const at = now.toISOString();
  const { results: pending } = await db.prepare(`${RECORD_SELECT} WHERE r.submitted_by = ? AND r.status = 'pending'`).bind(tokenId).all<RecordRow>();
  const statements: D1PreparedStatement[] = [db.prepare(`UPDATE tokens SET status = 'revoked' WHERE id = ?`).bind(tokenId)];
  const reason = `Banned ${token.label}`;
  for (const row of pending) {
    statements.push(
      moveStanding(db, row.id, 'rejected'),
      db.prepare(`UPDATE records SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(at, row.id),
      adminRevision(db, row, 'reject', { status: 'rejected' }, reason, at),
      cancelTasks(db, row.id, at),
      ...(await statusEffects(db, changingOf(row), 'rejected', at, { reason })),
    );
  }
  await db.batch(statements);
  return { rejected: pending.length };
}

/** Queues a recheck of every verified record a token submitted that has a recheck at all. */
export async function recheckToken(db: D1Database, tokenId: string, now: Date): Promise<{ queued: number }> {
  const kinds = KINDS.filter((kind) => KIND_CONFIGS[kind].recheckAfterDays !== null);
  const result = await db
    .prepare(
      `INSERT INTO tasks (id, record_id, record_kind, type, status, created_at)
       SELECT 'tsk_' || lower(hex(randomblob(13))), r.id, r.kind, 'recheck', 'open', ?
       FROM records r WHERE r.submitted_by = ? AND r.status = 'verified' AND r.kind IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.record_id = r.id AND t.status IN ('open', 'leased', 'review', 'blocked'))`,
    )
    .bind(now.toISOString(), tokenId, JSON.stringify(kinds))
    .run();
  return { queued: Number(result.meta.changes ?? 0) };
}

/* ───────── spot-check ───────── */

/** ISO 8601 week, such as 2026-W41: weeks start on Monday, and week 1 holds January 4. */
export function isoWeek(now: Date): string {
  const thursdayOf = (date: Date) => {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 3);
    return day;
  };
  const thursday = thursdayOf(now);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.round((thursday.getTime() - thursdayOf(new Date(Date.UTC(year, 0, 4))).getTime()) / 604_800_000);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * This week's sample of one kind: 50 verified records chosen by hashing each id with the week, so
 * the sample is random but the same all week, plus the marks given so far. Reads the ids of the
 * kind's verified records once, then only the 50 sampled.
 */
export async function spotCheck(db: D1Database, kind: string, now: Date): Promise<SpotCheck> {
  if (!(KINDS as readonly string[]).includes(kind)) throw new HttpError(404, 'not_found', `No kind ${kind}.`);
  const week = isoWeek(now);
  const { results: ids } = await db
    .prepare(`SELECT id FROM records INDEXED BY records_due WHERE kind = ? AND status = 'verified'`)
    .bind(kind)
    .all<{ id: string }>();
  const ranked = await Promise.all(ids.map(async ({ id }) => ({ id, rank: await sha256Hex(`${week}:${id}`) })));
  const sample = ranked.sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, SPOT_CHECK_SIZE).map((entry) => entry.id);
  const [rows, marks] = await db.batch([
    db.prepare(`${RECORD_SELECT} WHERE r.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(sample)),
    db.prepare('SELECT record_id, correct, note, checked_at FROM spot_checks WHERE week = ? AND kind = ?').bind(week, kind),
  ]);
  const byId = new Map(((rows?.results ?? []) as RecordRow[]).map((row) => [row.id, row]));
  const markRows = (marks?.results ?? []) as { record_id: string; correct: number; note: string | null; checked_at: string }[];
  const items = sample
    .map((id) => byId.get(id))
    .filter((row): row is RecordRow => Boolean(row))
    .map((row) => {
      const mark = markRows.find((entry) => entry.record_id === row.id);
      return { record: toAdminRecord(row), mark: mark ? { correct: mark.correct === 1, note: mark.note, checked_at: mark.checked_at } : null };
    });
  const marked = items.filter((item) => item.mark);
  return { week, kind: kind as Kind, items, marked: marked.length, correct: marked.filter((item) => item.mark!.correct).length };
}

export async function markSpotCheck(db: D1Database, kind: string, recordId: string, body: { correct?: unknown; note?: unknown }, now: Date): Promise<SpotCheck> {
  if (typeof body.correct !== 'boolean') throw new HttpError(422, 'invalid_body', 'correct must be true or false.');
  const check = await spotCheck(db, kind, now);
  if (!check.items.some((item) => item.record.id === recordId)) throw new HttpError(422, 'invalid_body', "That record is not in this week's sample.");
  const note = typeof body.note === 'string' ? cleanText(body.note).slice(0, REASON_MAX) : '';
  await db
    .prepare(
      `INSERT INTO spot_checks (week, kind, record_id, correct, note, checked_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (week, record_id) DO UPDATE SET correct = excluded.correct, note = excluded.note, checked_at = excluded.checked_at`,
    )
    .bind(check.week, kind, recordId, body.correct ? 1 : 0, note || null, now.toISOString())
    .run();
  if (!body.correct) await checkMaintainerOf(db, recordId, now);
  return spotCheck(db, kind, now);
}

/* ───────── precedents ───────── */

/** The site team's decisions that state a rule, newest first: the ones not yet in the rules, or all. */
export async function listPrecedents(db: D1Database, all: boolean): Promise<Precedent[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.record_id, p.kind, p.decision, p.rule, p.created_at, p.adopted_at FROM precedents p
       WHERE (? = 1 OR p.adopted_at IS NULL) ORDER BY p.id DESC LIMIT 200`,
    )
    .bind(all ? 1 : 0)
    .all<Precedent>();
  return results;
}

/** A precedent now written into a kind's config (its checks or scope), so agents read it. */
export async function adoptPrecedent(db: D1Database, id: number, now: Date): Promise<Precedent[]> {
  const result = await db.prepare('UPDATE precedents SET adopted_at = ? WHERE id = ? AND adopted_at IS NULL').bind(now.toISOString(), id).run();
  if (!Number(result.meta.changes ?? 0)) throw new HttpError(404, 'not_found', 'No open precedent has that id.');
  return listPrecedents(db, false);
}

/* ───────── rechecks of weak sources ───────── */

/** The note a recheck of a record verified on a source that cannot stand alone carries. */
const WEAK_SOURCE_NOTE = (hosts: readonly string[]) =>
  `Verified earlier on ${hosts.join(', ')}, which does not show what this record needs. Find a page that does and verify with it as your passage; if it closed, verify with trading closed; if no page shows it belongs here, reject it and say so.`;

/**
 * Verified records of a kind whose source is on a host that cannot stand alone (sourceNotAlone):
 * how many there are without a recheck waiting, and, with `limit`, rechecks queued for that many,
 * longest verified first. Reads the kind's verified records' sources once; for the admin and the
 * daily backfill, never readers.
 */
export async function queueWeakSourceRechecks(db: D1Database, kind: Kind, limit: number, now: Date): Promise<{ queued: number; remaining: number }> {
  const config = KIND_CONFIGS[kind];
  if (!config.sourceNotAlone) return { queued: 0, remaining: 0 };
  const { results } = await db
    .prepare(
      `SELECT r.id, r.source_url FROM records r INDEXED BY records_due WHERE r.kind = ? AND r.status = 'verified' AND r.target_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM tasks t INDEXED BY tasks_record WHERE t.record_id = r.id AND t.status IN ('open', 'leased', 'review', 'blocked'))
       ORDER BY r.verified_at`,
    )
    .bind(kind)
    .all<{ id: string; source_url: string }>();
  const weak = results.filter((row) => onHosts(row.source_url, config.sourceNotAlone!.hosts));
  const chosen = weak.slice(0, Math.max(0, limit));
  if (chosen.length > 0) {
    const at = now.toISOString();
    const note = WEAK_SOURCE_NOTE(config.sourceNotAlone.hosts);
    await db.batch(
      chosen.map((row) =>
        db
          .prepare(`INSERT INTO tasks (id, record_id, record_kind, type, status, note, created_at) VALUES (?, ?, ?, 'recheck', 'open', ?, ?)`)
          .bind(newId('tsk', now.getTime()), row.id, kind, note, at),
      ),
    );
  }
  return { queued: chosen.length, remaining: weak.length - chosen.length };
}

/** How many rechecks of weak sources the daily run queues (0: none), set by the admin. */
export async function weakSourceDaily(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT value FROM settings WHERE scope = '*' AND key = 'weak-sources-daily'`).first<{ value: string }>();
  return Number(row?.value ?? 0) || 0;
}

export async function setWeakSourceDaily(db: D1Database, value: unknown, now: Date): Promise<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 500) {
    throw new HttpError(422, 'invalid_body', 'daily must be a whole number from 0 to 500.');
  }
  await putSetting(db, 'weak-sources-daily', String(value), now).run();
  return value;
}
