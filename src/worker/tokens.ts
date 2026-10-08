/**
 * Agent tokens. A secret is `lcf_` plus 32 random characters and is shown once; the database
 * keeps only its SHA-256. The role decides what a token may do. `/join` can only ever create
 * collector tokens — maintainer tokens are issued by the admin, for some kinds or for all.
 */

import { KIND_CONFIGS } from '../../kinds/index';
import { cleanText, KINDS, type Kind, type KindConfig } from '../shared/kinds';
import type { AdminToken, RecordStatus, Role, Standing } from '../shared/types';
import { newId, newSecret, SECRET, sha256Hex } from './ids';
import { HttpError } from './types';

export type TokenStatus = 'active' | 'suspended' | 'revoked';

export interface Token {
  id: string;
  role: Role;
  label: string;
  /** The kinds a maintainer reviews, or ['*']. Collectors may send every kind. */
  kinds: string[];
  status: TokenStatus;
  pendingCap: number | null;
  dailyTaskLimit: number | null;
  expiresAt: string | null;
  createdAt: string;
}

interface TokenRow {
  id: string;
  role: string;
  label: string;
  kinds_json: string;
  status: string;
  pending_cap: number | null;
  daily_task_limit: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** Where agents keep their token. */
export const TOKEN_ENV = 'LONDON_CHINESE_FOOD_TOKEN';

/** last_used_at is written at most this often per token: the console needs minutes, not calls. */
const LAST_USED_EVERY_MS = 10 * 60 * 1000;

const AGENT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u;

const toToken = (row: TokenRow): Token => ({
  id: row.id,
  role: row.role as Role,
  label: row.label,
  kinds: JSON.parse(row.kinds_json) as string[],
  status: row.status as TokenStatus,
  pendingCap: row.pending_cap,
  dailyTaskLimit: row.daily_task_limit,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

/** A collector token. Returns the secret, which is never stored. */
export async function createCollectorToken(db: D1Database, agentName: unknown, now: Date): Promise<{ token: Token; secret: string }> {
  const label = typeof agentName === 'string' ? cleanText(agentName) : '';
  if (!AGENT_NAME.test(label)) {
    throw new HttpError(
      422,
      'invalid_agent_name',
      'agent_name must be 1 to 60 characters — letters, digits, spaces, dots, hyphens or underscores — starting with a letter or digit.',
    );
  }
  const secret = newSecret();
  const token: Token = {
    id: newId('tok', now.getTime()),
    role: 'collector',
    label,
    kinds: ['*'],
    status: 'active',
    pendingCap: null,
    dailyTaskLimit: null,
    expiresAt: null,
    createdAt: now.toISOString(),
  };
  await db
    .prepare(
      `INSERT INTO tokens (id, secret_hash, role, label, kinds_json, status, created_at)
       VALUES (?, ?, 'collector', ?, '["*"]', 'active', ?)`,
    )
    .bind(token.id, await sha256Hex(secret), label, token.createdAt)
    .run();
  return { token, secret };
}

/** The token behind an Authorization header, or an error an agent can act on. */
export async function authenticate(db: D1Database, header: string | undefined, now: Date): Promise<Token> {
  const secret = /^Bearer\s+(\S+)$/i.exec((header ?? '').trim())?.[1];
  if (!secret) {
    throw new HttpError(401, 'token_required', 'Send your token in the header "Authorization: Bearer lcf_...". Get one from POST /api/join.');
  }
  if (!SECRET.test(secret)) {
    throw new HttpError(401, 'token_invalid', 'That is not a token of this site: tokens are lcf_ followed by 32 letters and digits.');
  }
  const row = await db.prepare('SELECT * FROM tokens WHERE secret_hash = ?').bind(await sha256Hex(secret)).first<TokenRow>();
  if (!row) throw new HttpError(401, 'token_invalid', `This token is not recognized. Check ${TOKEN_ENV} in your .env file.`);
  const token = toToken(row);
  if (token.status === 'revoked') throw new HttpError(403, 'token_revoked', 'This token was revoked. Stop using it.');
  if (token.status === 'suspended') {
    throw new HttpError(
      403,
      'token_suspended',
      'This token is suspended because too many of its records were rejected. Your owner can ask the site team to review it.',
    );
  }
  if (token.expiresAt && token.expiresAt <= now.toISOString()) {
    throw new HttpError(403, 'token_expired', `This token expired on ${token.expiresAt}. Your owner can ask for a new one.`);
  }
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (now.getTime() - last >= LAST_USED_EVERY_MS) {
    await db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').bind(now.toISOString(), token.id).run();
  }
  return token;
}

/** Whether a maintainer token reviews this kind. */
export const reviews = (token: Token, kind: Kind): boolean => token.kinds.includes('*') || token.kinds.includes(kind);

/** The kinds a token's work covers. */
export const kindsOf = (token: Token): Kind[] => (token.kinds.includes('*') ? [...KINDS] : KINDS.filter((kind) => token.kinds.includes(kind)));

/** Refuses a token whose role cannot do this. */
export function requireRole(token: Token, roles: readonly Role[]): void {
  if (!roles.includes(token.role)) {
    throw new HttpError(403, 'wrong_role', `Only ${roles.join(' or ')} tokens can do this; this is a ${token.role} token.`);
  }
}

/**
 * The most records of a kind a token may have waiting for review: its base plus one per verified
 * record of that kind, up to the kind's ceiling. Maintainers get twice a collector's. A base the
 * admin set stands, even above the ceiling.
 */
export function pendingCap(token: Token, config: KindConfig, verified: number): number {
  const factor = token.role === 'maintainer' ? 2 : 1;
  const base = token.pendingCap ?? config.pendingCap.start * factor;
  return Math.max(base, Math.min(config.pendingCap.max * factor, base + verified));
}

/** A token's reviewed records of one kind, as the standings table keeps them. */
export interface Tally {
  verified: number;
  rejected: number;
  merged: number;
  stale: number;
}

/** A standings row older than this is counted again from records, in case a change ever slipped past moveStanding. */
const RECOUNT_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Counts a token's reviewed records of one kind from scratch and stores the counts, through
 * records_submitter. An applied proposal counts as verified; withdrawn records count for no one.
 */
async function recount(db: D1Database, tokenId: string, kind: Kind, now: Date): Promise<Tally> {
  const row = await db
    .prepare(
      `INSERT INTO standings (token_id, kind, verified, rejected, merged, stale, counted_at)
       SELECT ?1, ?2, COUNT(*) FILTER (WHERE status IN ('verified', 'applied')), COUNT(*) FILTER (WHERE status = 'rejected'),
         COUNT(*) FILTER (WHERE status = 'merged'), COUNT(*) FILTER (WHERE status = 'stale'), ?3
       FROM records INDEXED BY records_submitter WHERE submitted_by = ?1 AND kind = ?2
       ON CONFLICT (token_id, kind) DO UPDATE SET verified = excluded.verified, rejected = excluded.rejected,
         merged = excluded.merged, stale = excluded.stale, counted_at = excluded.counted_at
       RETURNING verified, rejected, merged, stale`,
    )
    .bind(tokenId, kind, now.toISOString())
    .first<Tally>();
  return row ?? { verified: 0, rejected: 0, merged: 0, stale: 0 };
}

type StoredTally = { [K in keyof Tally]: number | null } & { counted_at: string | null };

const current = (row: StoredTally | null, now: Date): Tally | null =>
  row?.counted_at && now.getTime() - Date.parse(row.counted_at) < RECOUNT_AFTER_MS
    ? { verified: row.verified ?? 0, rejected: row.rejected ?? 0, merged: row.merged ?? 0, stale: row.stale ?? 0 }
    : null;

/** A token's reviewed records of one kind: its standings row, counted again when missing or a day old. */
export async function tallyOf(db: D1Database, tokenId: string, kind: Kind, now: Date): Promise<Tally> {
  const row = await db
    .prepare('SELECT verified, rejected, merged, stale, counted_at FROM standings WHERE token_id = ? AND kind = ?')
    .bind(tokenId, kind)
    .first<StoredTally>();
  return current(row, now) ?? recount(db, tokenId, kind, now);
}

/** The standings bucket a status counts in, or null. */
const BUCKET_SQL = (value: string) =>
  `CASE WHEN ${value} IN ('verified', 'applied') THEN 'verified' WHEN ${value} IN ('rejected', 'merged', 'stale') THEN ${value} END`;

/**
 * The statement that moves one record in its submitter's standing from the status it has now to
 * `to`. Put it in the batch that changes the record, before the UPDATE: it reads the status the
 * UPDATE is about to replace. `from` repeats that UPDATE's own status guard, so the counts move
 * exactly when the record does. A submitter with no standings row yet is left alone.
 */
export function moveStanding(db: D1Database, recordId: string, to: RecordStatus, from: string | null = null): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE standings SET
         verified = verified + (${BUCKET_SQL('?2')} IS 'verified') - (${BUCKET_SQL('r.status')} IS 'verified'),
         rejected = rejected + (${BUCKET_SQL('?2')} IS 'rejected') - (${BUCKET_SQL('r.status')} IS 'rejected'),
         merged = merged + (${BUCKET_SQL('?2')} IS 'merged') - (${BUCKET_SQL('r.status')} IS 'merged'),
         stale = stale + (${BUCKET_SQL('?2')} IS 'stale') - (${BUCKET_SQL('r.status')} IS 'stale')
       FROM (SELECT submitted_by, kind, status FROM records WHERE id = ?1 AND status = coalesce(?3, status)) AS r
       WHERE standings.token_id = r.submitted_by AND standings.kind = r.kind`,
    )
    .bind(recordId, to, from);
}

/**
 * A token's records of one kind by status, its cap, and what it should change. Reads the token's
 * waiting records of that kind, which its cap keeps few, and one standings row.
 */
export async function standing(db: D1Database, token: Token, kind: Kind, now: Date): Promise<Standing> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM records INDEXED BY records_submitter
                WHERE submitted_by = ?1 AND kind = ?2 AND status = 'pending') AS pending,
              s.verified, s.rejected, s.merged, s.stale, s.counted_at
       FROM (SELECT 1) LEFT JOIN standings s ON s.token_id = ?1 AND s.kind = ?2`,
    )
    .bind(token.id, kind)
    .first<StoredTally & { pending: number }>();
  const tally = current(row, now) ?? (await recount(db, token.id, kind, now));
  const counts = { pending: row?.pending ?? 0, ...tally };
  const config = KIND_CONFIGS[kind];
  const cap = pendingCap(token, config, counts.verified);
  const warnings: string[] = [];
  if (counts.pending >= cap) {
    warnings.push(
      `You have ${counts.pending} ${config.noun.en.other} waiting for review, which is your limit. Send more once maintainers have reviewed some.`,
    );
  }
  const decided = counts.verified + counts.rejected;
  if (decided >= 5 && counts.rejected / decided > 0.3) {
    warnings.push(
      `${counts.rejected} of your ${decided} reviewed ${config.noun.en.other} were rejected. Check every value against its source before submitting: a token is suspended once more than half of 10 or more reviewed records are rejected.`,
    );
  }
  return { ...counts, pending_cap: cap, warnings };
}

/* ───────── admin ───────── */

/** Revision actions that count as a maintainer's verdicts: one per verdict. */
export const VERDICT_ACTIONS = ['verify', 'reject', 'merge', 'stale', 'unsure', 'apply'] as const;
const VERDICT_SQL = VERDICT_ACTIONS.map((action) => `'${action}'`).join(', ');

/** Tasks a maintainer may take in one UTC day, unless the admin sets another number. */
export const DAILY_TASK_LIMIT = 300;

const LABEL_MAX = 80;

const dayStart = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

function wholeNumber(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new HttpError(422, 'invalid_body', `${field} must be a whole number from 0 to ${max}.`);
  }
  return value;
}

function expiry(value: unknown, now: Date): string | null {
  if (value === null || value === undefined) return null;
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time) || time <= now.getTime()) {
    throw new HttpError(422, 'invalid_body', 'expires_at must be a future date or time in ISO 8601, or null for no expiry.');
  }
  return new Date(time).toISOString();
}

/** A maintainer token, issued by the admin. Returns the secret, which is never stored. */
export async function createMaintainerToken(
  db: D1Database,
  input: { label?: unknown; kinds?: unknown; daily_task_limit?: unknown; expires_at?: unknown },
  now: Date,
): Promise<{ token: Token; secret: string }> {
  const label = typeof input.label === 'string' ? cleanText(input.label) : '';
  if (!label || label.length > LABEL_MAX) {
    throw new HttpError(422, 'invalid_body', `label must name who the token is for, in 1 to ${LABEL_MAX} characters.`);
  }
  const kinds = input.kinds === undefined ? ['*'] : input.kinds;
  if (
    !Array.isArray(kinds) ||
    kinds.length === 0 ||
    !kinds.every((kind) => kind === '*' || (typeof kind === 'string' && (KINDS as readonly string[]).includes(kind)))
  ) {
    throw new HttpError(422, 'invalid_body', `kinds must list kinds (${KINDS.join(', ')}) or be ["*"] for all.`);
  }
  const dailyTaskLimit = input.daily_task_limit === undefined ? DAILY_TASK_LIMIT : wholeNumber(input.daily_task_limit, 'daily_task_limit', 10_000);
  const secret = newSecret();
  const token: Token = {
    id: newId('tok', now.getTime()),
    role: 'maintainer',
    label,
    kinds: kinds as string[],
    status: 'active',
    pendingCap: null,
    dailyTaskLimit,
    expiresAt: expiry(input.expires_at, now),
    createdAt: now.toISOString(),
  };
  await db
    .prepare(
      `INSERT INTO tokens (id, secret_hash, role, label, kinds_json, status, daily_task_limit, expires_at, created_at)
       VALUES (?, ?, 'maintainer', ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(token.id, await sha256Hex(secret), label, JSON.stringify(token.kinds), dailyTaskLimit, token.expiresAt, token.createdAt)
    .run();
  return { token, secret };
}

interface AdminTokenRow extends TokenRow {
  pending: number;
  verified: number;
  rejected: number;
  verdicts_total: number;
  verdicts_today: number;
}

/** Tokens as the admin sees them, newest first: no secrets, with their records and verdicts. */
export async function adminTokens(db: D1Database, now: Date, filter: { role?: Role; id?: string } = {}): Promise<AdminToken[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.role, t.label, t.kinds_json, t.status, t.pending_cap, t.daily_task_limit, t.expires_at,
         t.last_used_at, t.created_at,
         (SELECT COUNT(*) FROM records r WHERE r.submitted_by = t.id AND r.status = 'pending') AS pending,
         (SELECT COUNT(*) FROM records r WHERE r.submitted_by = t.id AND r.status IN ('verified', 'stale', 'applied')) AS verified,
         (SELECT COUNT(*) FROM records r WHERE r.submitted_by = t.id AND r.status = 'rejected') AS rejected,
         (SELECT COUNT(*) FROM revisions v WHERE v.actor = t.id AND v.action IN (${VERDICT_SQL})) AS verdicts_total,
         (SELECT COUNT(*) FROM revisions v WHERE v.actor = t.id AND v.action IN (${VERDICT_SQL}) AND v.created_at >= ?) AS verdicts_today
       FROM tokens t
       WHERE (? IS NULL OR t.role = ?) AND (? IS NULL OR t.id = ?)
       ORDER BY t.created_at DESC`,
    )
    .bind(dayStart(now), filter.role ?? null, filter.role ?? null, filter.id ?? null, filter.id ?? null)
    .all<AdminTokenRow>();
  return results.map((row) => {
    const token = toToken(row);
    return {
      id: token.id,
      role: token.role,
      label: token.label,
      kinds: token.kinds,
      status: token.status,
      pending_cap: token.pendingCap,
      daily_task_limit: token.dailyTaskLimit,
      expires_at: token.expiresAt,
      last_used_at: row.last_used_at,
      created_at: token.createdAt,
      records: { pending: row.pending, verified: row.verified, rejected: row.rejected },
      verdicts: { total: row.verdicts_total, today: row.verdicts_today },
    };
  });
}

/**
 * Changes a token's name, status, caps or expiry. A maintainer that stops being active hands its
 * leased tasks back to the queue at once, and any token its work items.
 */
export async function updateToken(
  db: D1Database,
  id: string,
  patch: { label?: unknown; status?: unknown; pending_cap?: unknown; daily_task_limit?: unknown; expires_at?: unknown },
  now: Date,
): Promise<AdminToken> {
  const [found] = await adminTokens(db, now, { id });
  if (!found) throw new HttpError(404, 'not_found', 'No token has that id.');
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.label !== undefined) {
    const label = typeof patch.label === 'string' ? cleanText(patch.label) : '';
    if (!label || label.length > LABEL_MAX) throw new HttpError(422, 'invalid_body', `label must be a name of 1 to ${LABEL_MAX} characters.`);
    sets.push('label = ?');
    values.push(label);
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'active' && patch.status !== 'suspended' && patch.status !== 'revoked') {
      throw new HttpError(422, 'invalid_body', 'status must be active, suspended or revoked.');
    }
    sets.push('status = ?');
    values.push(patch.status);
  }
  if (patch.pending_cap !== undefined) {
    sets.push('pending_cap = ?');
    values.push(patch.pending_cap === null ? null : wholeNumber(patch.pending_cap, 'pending_cap', 1_000));
  }
  if (patch.daily_task_limit !== undefined) {
    sets.push('daily_task_limit = ?');
    values.push(patch.daily_task_limit === null ? null : wholeNumber(patch.daily_task_limit, 'daily_task_limit', 10_000));
  }
  if (patch.expires_at !== undefined) {
    sets.push('expires_at = ?');
    values.push(expiry(patch.expires_at, now));
  }
  if (sets.length === 0) {
    throw new HttpError(422, 'invalid_body', 'Send at least one of label, status, pending_cap, daily_task_limit or expires_at.');
  }
  const statements = [db.prepare(`UPDATE tokens SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id)];
  if (patch.status === 'suspended' || patch.status === 'revoked') {
    statements.push(
      db.prepare(`UPDATE tasks SET status = 'open', leased_to = NULL, lease_expires_at = NULL WHERE leased_to = ? AND status = 'leased'`).bind(id),
      db.prepare(`UPDATE work_items SET handed_to = NULL, handed_until = NULL WHERE handed_to = ? AND status = 'open'`).bind(id),
    );
  }
  await db.batch(statements);
  const [updated] = await adminTokens(db, now, { id });
  return updated!;
}
