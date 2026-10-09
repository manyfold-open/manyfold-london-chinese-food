/**
 * Taking records from agents. Every record in a batch gets its own answer, so an agent can fix
 * its batch in the same run. Checks run cheapest first:
 *
 *   1. kind, field values, the passage, accepted ranges          no I/O
 *   2. the records it refers to, and what it would update        one query
 *   3. postcodes (places), then each source page                 one lookup per distinct value
 *   4. in order: references, duplicates, per-source limits,
 *      the token's cap for the kind, then storing                as records are stored
 *
 * A batch may hold a new place and its reviews and menu: they refer to it as "#n", its index in
 * the batch. A record whose parent is not verified yet is stored with its review task blocked;
 * the task opens when the parent is verified (src/worker/effects.ts).
 *
 * A record sent with `updates: <id>` is a proposal: a newer version of a live place, brand or menu,
 * reviewed like any record and then applied to its target in place.
 *
 * Text that looks aimed at AI agents is accepted but flagged: it waits for the admin, not a
 * maintainer, and gets no review task.
 */

import { KIND_CONFIGS, kindConfig } from '../../kinds/index';
import {
  BATCH_REF,
  checkAccept,
  identityKey,
  normName,
  RECORD_ID,
  textsOf,
  todayUtc,
  validateProvenance,
  validateRecordData,
  type FieldError,
  type Kind,
  type KindConfig,
  type Provenance,
  type RecordData,
} from '../shared/kinds';
import { quoteOnPage } from '../shared/quote';
import { similarity } from '../shared/similar';
import type { RecordStatus, SubmitResponse, SubmitResult, WorkType } from '../shared/types';
import { newId } from './ids';
import { lookupPostcodes, placeFieldsFrom, type PostcodeAnswer } from './postcodes';
import { DAY } from './ratelimit';
import { blockedBy, blockedHosts } from './settings';
import { standing, type Token } from './tokens';
import { HttpError } from './types';
import { ANSWERED_BY } from './work';

export const BATCH_MAX = 20;

// Phrases that address an AI instead of describing the record, and markup that has no
// business in a field value.
const AIMED_AT_AGENTS: readonly RegExp[] = [
  /\bignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts|messages)\b/i,
  /\bdisregard (all |any |the )?(previous|prior|above|earlier)\b/i,
  /\b(system|developer) prompt\b/i,
  /\byou are (now )?(an? )?(ai|assistant|agent|language model|llm)\b/i,
  /\b(mark|set|label) (this|it|them|all|every)( records?)? (as )?(verified|approved|valid)\b/i,
  /<\/?(script|iframe|object|embed|img)\b/i,
  /\[\/?INST\]|<\|im_(start|end)\|>/i,
  /忽略(之前|以上|上面)的(指令|提示|说明)/,
];

export const looksAimedAtAgents = (texts: readonly string[]): boolean =>
  texts.some((text) => AIMED_AT_AGENTS.some((pattern) => pattern.test(text)));

/** What fetching a source page found. */
export interface PageCheck {
  /** False only when the page plainly does not exist: no DNS record, or 404/410. */
  exists: boolean;
  /** The page's text, or null when it could not be read (blocked, needs a browser, not text). */
  text: string | null;
}

/** Whether a passage was on the page the server got, or the page could not be read. */
export type QuoteCheck = 'found' | 'not_found' | 'unreadable';

const PAGE_MAX = 3_000_000;

/**
 * Fetches a source page once: does it exist, and what does it say? Many sites block automated
 * requests or need a browser, so anything short of "gone" counts as existing, and a page the
 * server cannot read is only reported to the maintainer.
 */
export async function fetchPage(url: string, fetcher: typeof fetch = fetch): Promise<PageCheck> {
  const host = new URL(url).hostname;
  try {
    const dns = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (dns.ok && ((await dns.json()) as { Status?: number }).Status === 3) return { exists: false, text: null };
  } catch {
    // No DNS answer in time: the page request decides.
  }
  try {
    const page = await fetcher(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; LondonChineseFood/0.1; +https://app.manyfold.ai/london-chinese-food/)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (page.status === 404 || page.status === 410) {
      await page.body?.cancel();
      return { exists: false, text: null };
    }
    const type = page.headers.get('content-type') ?? '';
    if (!page.ok || !/text|html|json/.test(type) || Number(page.headers.get('content-length') ?? 0) > PAGE_MAX) {
      await page.body?.cancel();
      return { exists: true, text: null };
    }
    return { exists: true, text: (await page.text()).slice(0, PAGE_MAX) };
  } catch {
    return { exists: true, text: null };
  }
}

/** The note a maintainer reads on a task, from what the server found at submit time. */
export const precheckNote = (check: QuoteCheck): string =>
  check === 'found'
    ? 'When it was submitted, the server found this passage on the source page.'
    : check === 'not_found'
      ? 'When it was submitted, the server did NOT find this passage on the page it got. Check it closely.'
      : 'When it was submitted, the server could not read the source page (it may need a browser). Open it yourself.';

interface Candidate {
  index: number;
  config: KindConfig;
  data: RecordData;
  provenance: Provenance;
  flagged: boolean;
  updates: string | null;
  workItem: string | null;
}

interface RefRow {
  id: string;
  kind: Kind;
  status: RecordStatus;
  merged_into: string | null;
  target_id: string | null;
  parent_id: string | null;
  root_id: string | null;
  data_json: string;
  identity_key: string;
}

const LIVE: readonly RecordStatus[] = ['pending', 'verified', 'stale'];

/** The ref fields of a kind. */
const refFields = (config: KindConfig): string[] =>
  Object.entries(config.fields).filter(([, def]) => def.type === 'ref').map(([name]) => name);

function store(db: D1Database, token: Token, candidate: Candidate, row: {
  id: string; key: string; parentId: string | null; rootId: string | null; refId: string | null; targetId: string | null;
  taskStatus: 'open' | 'blocked'; note: string | null;
}, now: Date) {
  const at = now.toISOString();
  const { source_url, evidence, observed_at } = candidate.provenance;
  const kind = candidate.config.kind;
  const statements = [
    db
      .prepare(
        `INSERT INTO records (id, kind, parent_id, root_id, ref_id, target_id, identity_key, status, data_json, source_url, evidence,
           observed_at, submitted_by, flagged, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, kind, row.parentId, row.rootId, row.refId, row.targetId, row.key, JSON.stringify(candidate.data), source_url,
        evidence, observed_at, token.id, candidate.flagged ? 1 : 0, at, at),
    db
      .prepare(
        `INSERT INTO revisions (record_id, kind, actor, action, after_json, source_url, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, kind, token.id, row.targetId ? 'propose' : 'submit',
        JSON.stringify({ status: 'pending', data: candidate.data, ...(row.targetId ? { target: row.targetId } : {}) }), source_url, evidence, at),
  ];
  if (!candidate.flagged) {
    statements.push(
      db
        .prepare(`INSERT INTO tasks (id, record_id, record_kind, type, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId('tsk', now.getTime()), row.id, kind, row.targetId ? 'update' : 'verify', row.taskStatus, row.note, at),
    );
  }
  if (candidate.workItem) {
    statements.push(
      db
        .prepare(`UPDATE work_items SET status = 'submitted', record_id = ?, updated_at = ? WHERE id = ? AND handed_to = ? AND status = 'open'`)
        .bind(row.id, at, candidate.workItem, token.id),
    );
  }
  return db.batch(statements);
}

interface WorkRow {
  id: string;
  type: string;
  subject: string;
  payload_json: string | null;
  status: string;
  handed_to: string | null;
  handed_until: string | null;
}

/**
 * Why a record cannot answer the work item it names, or null. A lead is answered by the place it
 * points to: the same outcode or a similar name, so a batch whose work item ids were mixed up is
 * refused rather than closing the wrong leads.
 */
function workItemProblem(
  item: WorkRow | undefined,
  id: string,
  token: Token,
  kind: Kind,
  data: RecordData,
  owner: { id: string; kind: Kind } | null,
  photoSet: string | null,
  now: Date,
): string | null {
  if (!item || item.handed_to !== token.id || item.status !== 'open' || !item.handed_until || item.handed_until <= now.toISOString()) {
    return `${id} is not a work item you hold open; GET /api/work lists yours, or send the record without work_item`;
  }
  const answer = ANSWERED_BY[item.type as WorkType] as Kind | undefined;
  if (answer !== kind) return `${id} is a ${item.type} item, answered by ${answer && KIND_CONFIGS[answer].submit === 'agents' ? `a ${answer}` : 'an upload'}, not a ${kind}`;
  if (item.type === 'lead') {
    const lead = (item.payload_json ? JSON.parse(item.payload_json) : {}) as { name?: string; postcode?: string };
    const name = String(data.name_en ?? data.name_zh ?? '');
    const sameArea = Boolean(lead.postcode) && lead.postcode!.split(' ')[0]!.toUpperCase() === String(data.outcode ?? '');
    const sameName = similarity(normName(lead.name ?? ''), normName(name)) >= 0.5;
    if (!sameArea && !sameName) {
      return `${id} is the lead for "${lead.name ?? item.subject}"${lead.postcode ? ` at ${lead.postcode}` : ''}, not ${name} at ${String(data.postcode)}: send this place's own work item, or none`;
    }
  }
  if (item.type === 'reviews' && owner?.id !== item.subject) return `${id} asks for reviews of ${item.subject}, but this review is of ${owner?.id ?? 'another place'}`;
  if ((item.type === 'menu' || item.type === 'menu-link') && owner?.id !== item.subject && owner?.kind !== 'brand') {
    return `${id} asks for the menu of ${item.subject} (or its brand's), but this menu belongs to ${owner?.id ?? 'another place'}`;
  }
  if (item.type === 'transcribe' && photoSet !== item.subject) return `${id} asks for the menu in the photos of ${item.subject}; set "photo" to the first page the work item gives`;
  return null;
}

export interface SubmitOptions {
  now: Date;
  fetchPage: (url: string) => Promise<PageCheck>;
  lookupPostcodes?: (postcodes: string[]) => Promise<Map<string, PostcodeAnswer>>;
}

export async function submitRecords(db: D1Database, token: Token, body: unknown, options: SubmitOptions): Promise<SubmitResponse> {
  const items = (body as { records?: unknown } | null)?.records;
  if (!Array.isArray(items) || items.length === 0 || items.length > BATCH_MAX) {
    throw new HttpError(422, 'invalid_body', `Send JSON like {"records": [...]} with 1 to ${BATCH_MAX} records.`);
  }
  const { now } = options;
  const today = todayUtc(now);
  const results: SubmitResult[] = [];
  const blocked = await blockedHosts(db);

  // 1. Kind, values, passage, accepted ranges.
  const candidates: Candidate[] = [];
  items.forEach((item, index) => {
    const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const config = typeof entry.kind === 'string' ? kindConfig(entry.kind) : undefined;
    if (!config || config.submit !== 'agents') {
      const sendable = Object.values(KIND_CONFIGS).filter((kind) => kind.submit === 'agents').map((kind) => kind.kind);
      results[index] = {
        index,
        status: 'invalid',
        errors: [{
          field: 'kind',
          message: config
            ? `${config.kind} records are not sent here (${config.kind === 'illustration' ? 'upload them with POST /api/illustrations' : 'visitors upload them'})`
            : `must be one of ${sendable.join(', ')}; got ${JSON.stringify(entry.kind)}`,
        }],
      };
      return;
    }
    const data = validateRecordData(config, entry.data);
    const provenance = validateProvenance(config, entry, now);
    const errors: FieldError[] = [...(data.ok ? checkAccept(config, data.value, today) : data.errors), ...(provenance.ok ? [] : provenance.errors)];
    if (data.ok) {
      for (const name of refFields(config)) {
        const ref = BATCH_REF.exec(String(data.value[name] ?? ''));
        if (ref && Number(ref[1]) >= index) errors.push({ field: name, message: `"#${ref[1]}" must refer to a record earlier in this batch` });
      }
    }
    const updates = entry.updates;
    if (updates !== undefined && (typeof updates !== 'string' || !RECORD_ID.test(updates))) {
      errors.push({ field: 'updates', message: 'must be the id (rec_...) of the live record this is a newer version of' });
    } else if (updates !== undefined && !config.updatable) {
      errors.push({ field: 'updates', message: `${config.noun.en.other} are not updated; send a new one instead` });
    }
    const workItem = entry.work_item;
    if (workItem !== undefined && (typeof workItem !== 'string' || !/^wrk_[0-9a-z]{26}$/.test(workItem))) {
      errors.push({ field: 'work_item', message: 'must be the id (wrk_...) of a work item you were handed' });
    }
    if (provenance.ok) {
      const host = blockedBy(provenance.value.source_url, blocked);
      if (host) errors.push({ field: 'source_url', message: `${host} asked this site not to quote it; find another source` });
    }
    if (!data.ok || !provenance.ok || errors.length > 0) {
      results[index] = { index, status: 'invalid', errors };
      return;
    }
    candidates.push({
      index,
      config,
      data: data.value,
      provenance: provenance.value,
      flagged: looksAimedAtAgents([...textsOf(data.value), provenance.value.evidence]),
      updates: typeof updates === 'string' ? updates : null,
      workItem: typeof workItem === 'string' ? workItem : null,
    });
  });

  // 2. The records referred to and updated, merged ones followed to where they went.
  const refs = new Map<string, RefRow>();
  let wanted = [...new Set(candidates.flatMap((candidate) => [
    ...refFields(candidate.config).map((name) => String(candidate.data[name] ?? '')).filter((value) => RECORD_ID.test(value)),
    ...(candidate.updates ? [candidate.updates] : []),
  ]))];
  for (let hop = 0; hop < 3 && wanted.length > 0; hop += 1) {
    const { results: rows } = await db
      .prepare(
        `SELECT id, kind, status, merged_into, target_id, parent_id, root_id, data_json, identity_key
         FROM records WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(JSON.stringify(wanted))
      .all<RefRow>();
    for (const row of rows) refs.set(row.id, row);
    wanted = rows.filter((row) => row.status === 'merged' && row.merged_into && !refs.has(row.merged_into)).map((row) => row.merged_into!);
  }
  const follow = (id: string): RefRow | undefined => {
    let row = refs.get(id);
    for (let hop = 0; row?.status === 'merged' && row.merged_into && hop < 3; hop += 1) row = refs.get(row.merged_into);
    return row;
  };

  // The work items the batch answers.
  const itemIds = [...new Set(candidates.map((candidate) => candidate.workItem).filter((id): id is string => id !== null))];
  const workItems = new Map<string, WorkRow>();
  if (itemIds.length > 0) {
    const { results: rows } = await db
      .prepare('SELECT id, type, subject, payload_json, status, handed_to, handed_until FROM work_items WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(itemIds))
      .all<WorkRow>();
    for (const row of rows) workItems.set(row.id, row);
  }

  // 3. Postcodes of places, then each source once.
  const postcodes = candidates.filter((candidate) => candidate.config.kind === 'place').map((candidate) => String(candidate.data.postcode));
  const located = postcodes.length > 0
    ? await (options.lookupPostcodes ? options.lookupPostcodes(postcodes) : lookupPostcodes(db, postcodes, now))
    : new Map<string, PostcodeAnswer>();
  const urls = [...new Set(candidates.map((candidate) => candidate.provenance.source_url))];
  const pages = new Map(await Promise.all(urls.map(async (url) => [url, await options.fetchPage(url)] as const)));

  // Live reviews per place and source, for the per-source limit.
  const perParent = new Map<string, number>();
  const parentsToCount = new Map<Kind, Set<string>>();
  for (const candidate of candidates) {
    const { perParent: rule, parent } = candidate.config;
    if (!rule || !parent) continue;
    const ref = String(candidate.data[parent] ?? '');
    if (!RECORD_ID.test(ref)) continue;
    const resolved = follow(ref)?.id ?? ref;
    if (!parentsToCount.has(candidate.config.kind)) parentsToCount.set(candidate.config.kind, new Set());
    parentsToCount.get(candidate.config.kind)!.add(resolved);
  }
  for (const [kind, parents] of parentsToCount) {
    const field = KIND_CONFIGS[kind].perParent!.field;
    const { results: rows } = await db
      .prepare(
        `SELECT parent_id, data_json FROM records INDEXED BY records_children
         WHERE parent_id IN (SELECT value FROM json_each(?)) AND status IN ('pending', 'verified', 'stale') AND kind = ?`,
      )
      .bind(JSON.stringify([...parents]), kind)
      .all<{ parent_id: string; data_json: string }>();
    for (const row of rows) {
      const value = (JSON.parse(row.data_json) as RecordData)[field];
      const key = `${row.parent_id}|${normName(String(value ?? ''))}`;
      perParent.set(key, (perParent.get(key) ?? 0) + 1);
    }
  }

  // 4. In order.
  const standings = new Map<Kind, { pending: number; cap: number }>();
  const stored = new Map<number, { id: string; kind: Kind; status: RecordStatus }>();
  const known = new Map<string, string>();

  for (const candidate of candidates) {
    const { index, config } = candidate;
    const errors: FieldError[] = [];
    const data: RecordData = { ...candidate.data };

    // References: "#n" to what record n became, ids to live records of the right kind.
    let parentRow: { id: string; kind: Kind; status: RecordStatus } | null = null;
    let refId: string | null = null;
    for (const name of refFields(config)) {
      const raw = data[name];
      if (raw === undefined) continue;
      const def = config.fields[name]!;
      const allowed = def.type === 'ref' ? def.to : [];
      let target: { id: string; kind: Kind; status: RecordStatus } | null = null;
      const batch = BATCH_REF.exec(String(raw));
      if (batch) {
        const earlier = stored.get(Number(batch[1]));
        if (!earlier) {
          errors.push({ field: name, message: `refers to record #${batch[1]} of this batch, which was not stored (see its result)` });
          continue;
        }
        target = earlier;
      } else {
        const row = follow(String(raw));
        if (!row || row.target_id) {
          errors.push({ field: name, message: `${String(raw)} is not a record here; search with GET /api/search, or send it in this batch and refer to it as "#n"` });
          continue;
        }
        if (!LIVE.includes(row.status)) {
          errors.push({ field: name, message: `${row.id} was ${row.status}; it cannot be referred to` });
          continue;
        }
        target = row;
      }
      if (!allowed.includes(target.kind)) {
        errors.push({ field: name, message: `must refer to a ${allowed.join(' or ')}, but ${target.id} is a ${target.kind}` });
        continue;
      }
      data[name] = target.id;
      if (name === config.parent) parentRow = target;
      else if (config.kind === 'place' && name === 'brand') refId = target.id;
    }
    if (errors.length > 0) {
      results[index] = { index, status: 'invalid', errors };
      continue;
    }

    // A place's location comes from its postcode, never from the agent.
    if (config.kind === 'place') {
      const postcode = String(data.postcode);
      const answer = located.get(postcode);
      if (answer === 'unavailable' || answer === undefined) {
        results[index] = { index, status: 'retry_later', message: 'The postcode service did not answer. Send this record again in a few minutes.' };
        continue;
      }
      if (answer === 'unknown') {
        results[index] = { index, status: 'invalid', errors: [{ field: 'postcode', message: `${postcode} is not a postcode in use; check it against the source` }] };
        continue;
      }
      if (!answer.london) {
        results[index] = {
          index,
          status: 'invalid',
          errors: [{ field: 'postcode', message: `${postcode} is in ${answer.district ?? 'a place'} outside Greater London; this site covers London only` }],
        };
        continue;
      }
      Object.assign(data, placeFieldsFrom(answer));
    }

    const id = newId('rec', now.getTime());
    const key = config.identity.length === 0 ? id : identityKey(config, data, candidate.provenance);
    let targetId: string | null = null;

    if (candidate.updates) {
      const target = refs.get(candidate.updates);
      if (!target || target.kind !== config.kind || target.target_id) {
        results[index] = { index, status: 'invalid', errors: [{ field: 'updates', message: `${candidate.updates} is not a ${config.noun.en.one} here` }] };
        continue;
      }
      if (target.status !== 'verified' && target.status !== 'stale') {
        results[index] = {
          index,
          status: 'invalid',
          errors: [{ field: 'updates', message: `${target.id} is ${target.status}; only a verified or stale ${config.noun.en.one} is updated this way` }],
        };
        continue;
      }
      if (config.parent && target.parent_id !== (parentRow?.id ?? null)) {
        results[index] = { index, status: 'invalid', errors: [{ field: config.parent, message: `must be the same as the record it updates (${target.parent_id})` }] };
        continue;
      }
      const before = JSON.parse(target.data_json) as RecordData;
      if (JSON.stringify(sorted(before)) === JSON.stringify(sorted(data))) {
        results[index] = { index, status: 'unchanged', message: `${target.id} already says exactly this; nothing to update` };
        continue;
      }
      targetId = target.id;
    } else {
      const twin =
        known.get(`${config.kind}|${key}`) ??
        (await db
          .prepare(
            `SELECT id, status FROM records WHERE kind = ? AND identity_key = ? AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL`,
          )
          .bind(config.kind, key)
          .first<{ id: string; status: RecordStatus }>());
      if (twin) {
        const twinId = typeof twin === 'string' ? twin : twin.id;
        const twinStatus = typeof twin === 'string' ? 'pending' : twin.status;
        stored.set(index, { id: twinId, kind: config.kind, status: twinStatus });
        results[index] = {
          index,
          status: 'duplicate',
          existing_id: twinId,
          existing_status: twinStatus,
          ...(config.updatable && twinStatus !== 'pending'
            ? { hint: `If the source shows something has changed, send it again with "updates": "${twinId}".` }
            : {}),
        };
        continue;
      }
    }

    if (candidate.workItem) {
      const photo = typeof data.photo === 'string' ? follow(data.photo) : undefined;
      const photoSet = photo ? (((JSON.parse(photo.data_json) as RecordData).set as string | undefined) ?? photo.id) : null;
      const problem = workItemProblem(workItems.get(candidate.workItem), candidate.workItem, token, config.kind, data, parentRow, photoSet, now);
      if (problem) {
        results[index] = { index, status: 'invalid', errors: [{ field: 'work_item', message: problem }] };
        continue;
      }
    }

    const page = pages.get(candidate.provenance.source_url)!;
    if (!page.exists) {
      results[index] = {
        index,
        status: 'source_not_found',
        message: `${candidate.provenance.source_url} returned 404, or its domain does not exist. Find the page that states this.`,
      };
      continue;
    }

    if (config.perParent && parentRow) {
      const value = normName(String(data[config.perParent.field] ?? ''));
      const counted = `${parentRow.id}|${value}`;
      if ((perParent.get(counted) ?? 0) >= config.perParent.max) {
        results[index] = {
          index,
          status: 'invalid',
          errors: [{
            field: config.perParent.field,
            message: `this place already has ${config.perParent.max} ${config.noun.en.other} from ${String(data[config.perParent.field])}; choose another source`,
          }],
        };
        continue;
      }
      perParent.set(counted, (perParent.get(counted) ?? 0) + 1);
    }

    let quota = standings.get(config.kind);
    if (!quota) {
      const current = await standing(db, token, config.kind, now);
      quota = { pending: current.pending, cap: current.pending_cap };
      standings.set(config.kind, quota);
    }
    if (quota.pending >= quota.cap) {
      results[index] = {
        index,
        status: 'over_cap',
        message: `You have ${quota.pending} ${config.noun.en.other} waiting for review, which is your limit. Stop sending ${config.noun.en.other} for this run.`,
      };
      continue;
    }

    const quote: QuoteCheck = page.text === null ? 'unreadable' : quoteOnPage(page.text, candidate.provenance.evidence) ? 'found' : 'not_found';
    const waits = parentRow !== null && parentRow.status === 'pending';
    // A place under another name at the same postcode may be this one: the maintainer is told.
    let neighbours = '';
    if (config.kind === 'place' && !targetId) {
      const { results: rows } = await db
        .prepare(
          `SELECT id, status, data_json FROM records INDEXED BY records_identity
           WHERE kind = 'place' AND identity_key >= ?1 AND identity_key < ?2 AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL LIMIT 8`,
        )
        .bind(`${String(data.postcode)}|`, `${String(data.postcode)}}`)
        .all<{ id: string; status: string; data_json: string }>();
      if (rows.length > 0) {
        const names = rows.map((row) => {
          const other = JSON.parse(row.data_json) as RecordData;
          return `${[other.name_en, other.name_zh].filter(Boolean).join(' ')} (${row.id}, ${row.status})`;
        });
        neighbours = ` Also at ${String(data.postcode)}: ${names.join('; ')}. If this is one of them under another name, the verdict is duplicate.`;
      }
    }
    try {
      await store(db, token, { ...candidate, data }, {
        id,
        key,
        parentId: parentRow?.id ?? null,
        // The place whose page shows it: a place itself (a proposal, the place it updates), a
        // child its parent place; a brand and a brand's menu, no one place.
        rootId: config.kind === 'place' ? (targetId ?? id) : parentRow?.kind === 'place' ? parentRow.id : null,
        refId,
        targetId,
        taskStatus: waits ? 'blocked' : 'open',
        note: `${precheckNote(quote)}${neighbours}`,
      }, now);
    } catch (error) {
      if (!/UNIQUE/i.test(String(error))) throw error;
      const row = targetId
        ? await db.prepare(`SELECT id FROM records WHERE target_id = ? AND status = 'pending'`).bind(targetId).first<{ id: string }>()
        : await db
            .prepare(`SELECT id, status FROM records WHERE kind = ? AND identity_key = ? AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL`)
            .bind(config.kind, key)
            .first<{ id: string; status: RecordStatus }>();
      results[index] = targetId
        ? { index, status: 'proposal_pending', existing_id: row?.id ?? '', message: `An update to ${targetId} is already waiting for review.` }
        : { index, status: 'duplicate', existing_id: row?.id ?? '', existing_status: (row as { status?: RecordStatus } | null)?.status ?? 'pending' };
      continue;
    }
    known.set(`${config.kind}|${key}`, id);
    stored.set(index, { id, kind: config.kind, status: 'pending' });
    results[index] = { index, status: 'accepted', id, kind: config.kind, ...(waits ? { waits_for: parentRow!.id } : {}) };
    quota.pending += 1;
  }

  const warnings = [...standings].filter(([, quota]) => quota.pending >= quota.cap).map(
    ([kind, quota]) => `You have ${quota.pending} ${KIND_CONFIGS[kind].noun.en.other} waiting for review, which is your limit. Send more once maintainers have reviewed some.`,
  );
  return {
    results,
    standing: Object.fromEntries([...standings].map(([kind, quota]) => [kind, { pending: quota.pending, pending_cap: quota.cap }])),
    warnings,
  };
}

/** A record's data with its keys in order, for comparing two versions. */
const sorted = (data: RecordData): RecordData => Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));

/* ───────── idempotency ───────── */

const KEY = /^[\x21-\x7e]{1,100}$/;

/** Checks an Idempotency-Key header; null when there is none. */
export function idempotencyKey(header: string | undefined): string | null {
  if (header === undefined) return null;
  if (!KEY.test(header)) {
    throw new HttpError(422, 'invalid_idempotency_key', 'Idempotency-Key must be 1 to 100 visible ASCII characters.');
  }
  return header;
}

/** The answer already given for this key in the last 24 hours, if any. */
export async function recall(db: D1Database, tokenId: string, key: string, now: Date): Promise<SubmitResponse | null> {
  const row = await db
    .prepare('SELECT response_json, created_at FROM idempotency WHERE token_id = ? AND key = ?')
    .bind(tokenId, key)
    .first<{ response_json: string; created_at: string }>();
  if (!row || Date.parse(row.created_at) < now.getTime() - DAY) return null;
  return JSON.parse(row.response_json) as SubmitResponse;
}

export async function remember(db: D1Database, tokenId: string, key: string, response: unknown, now: Date): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO idempotency (token_id, key, response_json, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenId, key, JSON.stringify(response), now.toISOString())
    .run();
}
