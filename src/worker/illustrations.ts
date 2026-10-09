/**
 * AI illustrations as work (AGENTS.md, invariants 18 and 24). The Worker calls no image model: it
 * keeps an `illustrate` work item open for every standard dish places serve that has no
 * illustration, most served first, with the prompt to use (filled in from the admin's template
 * each time an item is handed out, src/worker/work.ts), and agents generate and upload them
 * (src/worker/uploads.ts). A maintainer looks at each; an approved one becomes its dish's picture
 * (src/worker/effects.ts) wherever no real photo of that dish at that place exists.
 *
 * Only standard dishes (kinds/dish-vocab.ts) are asked for. A menu's own lines are not all dishes
 * (a can of Coke, "set meal for 2", "add a special sauce", a section heading), and an agent cannot
 * tell the site which of them are: an item it could not finish would only hold its place in the
 * queue. So every item names a dish the upload takes, with its names and what it looks like.
 */

import { KIND_CONFIGS } from '../../kinds/index';
import { DISH_VOCAB, type DishEntry } from '../../kinds/dish-vocab';
import { normDish } from '../shared/dish';
import { cleanText, validateRecordData } from '../shared/kinds';
import { decide } from './console';
import { illustrationSettings, promptFor, putSetting, type IllustrationSettings } from './settings';
import { HttpError } from './types';

/** How many dishes one run looks at for missing work items. */
const SYNC_MAX = 200;

/** The longest note the admin leaves for the next illustration of a dish; it goes into the prompt. */
const NOTE_MAX = 300;

/** What the upload, checking a field as it does, would say against this value for it, or null if it takes it. */
function uploadRefuses(field: 'dish' | 'prompt', value: string): string | null {
  const checked = validateRecordData(KIND_CONFIGS.illustration, { [field]: value });
  return checked.ok ? null : (checked.errors.find((error) => error.field === field)?.message ?? null);
}

/** The dishes an illustrate item may ask for, by dish key: the standard dishes whose name the upload takes as `dish`. */
export const ILLUSTRATABLE: ReadonlyMap<string, DishEntry> = new Map(
  DISH_VOCAB.filter((entry) => uploadRefuses('dish', entry.zh) === null).map((entry) => [normDish(entry.zh), entry]),
);

/** Why an item for any other dish is closed, as the admin sees it. */
const NOT_STANDARD = 'Not a standard dish: illustrations are asked for only the dishes in kinds/dish-vocab.ts (GET /api/schema lists them).';

/** What an item for a standard dish gives the agent: the name to send as `dish`, what it looks like, the prompt. */
function payloadFor(entry: DishEntry, template: string): Record<string, unknown> {
  return {
    dish: entry.zh,
    name_zh: entry.zh,
    name_en: entry.en,
    description: entry.description,
    prompt: promptFor(template, { key: normDish(entry.zh), zh: entry.zh, en: entry.en }),
    size: 'square, at least 1024 x 1024 pixels',
  };
}

/**
 * Closes the open items no agent could finish, opens one for each standard dish places serve with
 * no illustration and none waiting, and refreshes the priority (how many places serve it) of open
 * ones. Items being worked on are left alone. Returns how many items it changed.
 */
export async function syncIllustrateWork(db: D1Database, now: Date): Promise<number> {
  const at = now.toISOString();
  const { results: open } = await db
    .prepare(`SELECT id, subject, priority FROM work_items INDEXED BY work_items_open WHERE type = 'illustrate' AND status = 'open'`)
    .all<{ id: string; subject: string; priority: number }>();
  const statements: D1PreparedStatement[] = [];
  // Items opened for a menu's own lines before items were limited to standard dishes, or for a
  // dish the vocabulary no longer lists; one an agent holds leaves its hands too.
  const unanswerable = open.filter((item) => !ILLUSTRATABLE.has(item.subject)).map((item) => item.id);
  if (unanswerable.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE work_items SET status = 'dismissed', handed_to = NULL, handed_until = NULL, note = ?, updated_at = ?
           WHERE id IN (SELECT value FROM json_each(?)) AND status = 'open'`,
        )
        .bind(NOT_STANDARD, at, JSON.stringify(unanswerable)),
    );
  }
  const settings = await illustrationSettings(db);
  if (settings.requested) {
    // From the standard names to their rows (CROSS JOIN keeps that order): the dishes index, in
    // places order, would walk past every other menu line served more widely first.
    const { results } = await db
      .prepare(
        `SELECT d.dish_key, d.places FROM json_each(?1) AS k CROSS JOIN dishes AS d ON d.dish_key = k.value
         WHERE d.illustration_id IS NULL AND d.places > 0 ORDER BY d.places DESC LIMIT ?2`,
      )
      .bind(JSON.stringify([...ILLUSTRATABLE.keys()]), SYNC_MAX)
      .all<{ dish_key: string; places: number }>();
    const priority = new Map(open.map((item) => [item.subject, item.priority]));
    // An open item whose priority holds needs nothing. A dish closed while it was not standard
    // opens again once the vocabulary lists it.
    for (const dish of results.filter((candidate) => priority.get(candidate.dish_key) !== candidate.places)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
             VALUES ('wrk_' || lower(hex(randomblob(13))), 'illustrate', ?1, ?2, ?3, 'open', ?4, ?4)
             ON CONFLICT (type, subject) DO UPDATE SET status = 'open', priority = excluded.priority, updated_at = excluded.updated_at,
               payload_json = CASE WHEN work_items.status = 'dismissed' THEN excluded.payload_json ELSE work_items.payload_json END,
               note = CASE WHEN work_items.status = 'dismissed' THEN NULL ELSE work_items.note END
               WHERE work_items.status = 'dismissed' OR (work_items.status = 'open' AND work_items.priority != excluded.priority)`,
          )
          .bind(dish.dish_key, dish.places, JSON.stringify(payloadFor(ILLUSTRATABLE.get(dish.dish_key)!, settings.template)), at),
      );
    }
  }
  if (statements.length === 0) return 0;
  const outcomes = await db.batch(statements);
  return outcomes.reduce((sum, outcome) => sum + Number(outcome.meta?.changes ?? 0), 0);
}

/**
 * Why the admin may not open an illustrate item again, or null: one for a dish that is not standard
 * would be closed at the next run, and one whose dish has an illustration waiting or on the site
 * could not be answered (the upload refuses a second), so that one is replaced instead.
 */
export async function reopenProblem(db: D1Database, subject: string): Promise<string | null> {
  if (!ILLUSTRATABLE.has(subject)) return `${subject} is not a standard dish, and illustrations are asked for only those; add it to kinds/dish-vocab.ts first.`;
  const live = await db
    .prepare(`SELECT id FROM records WHERE kind = 'illustration' AND identity_key = ? AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL`)
    .bind(subject)
    .first<{ id: string }>();
  return live ? `${subject} has an illustration (${live.id}) waiting for review or on the site; replace it from Illustrations instead.` : null;
}

/**
 * The admin replaces a dish's illustration: the current one is rejected (off the site at once),
 * and its work item opens again with the admin's note in the prompt, for the next agent. A dish
 * that is not standard gets no new item: its illustration only comes down.
 */
export async function replaceIllustration(db: D1Database, id: string, body: { note?: unknown }, now: Date): Promise<{ reopened: boolean; standard: boolean }> {
  const note = typeof body.note === 'string' ? cleanText(body.note).slice(0, NOTE_MAX) : '';
  const record = await db.prepare(`SELECT identity_key, status FROM records WHERE id = ? AND kind = 'illustration'`).bind(id).first<{ identity_key: string; status: string }>();
  if (!record) throw new HttpError(404, 'not_found', 'No illustration has that id.');
  if (record.status !== 'rejected') await decide(db, id, { status: 'rejected', reason: `Replaced by the admin${note ? `: ${note}` : ''}` }, now);
  const entry = ILLUSTRATABLE.get(record.identity_key);
  if (!entry) return { reopened: false, standard: false };
  const settings = await illustrationSettings(db);
  const prompt = promptFor(settings.template, { key: record.identity_key, zh: entry.zh, en: entry.en }, note || null);
  const result = await db
    .prepare(
      `UPDATE work_items SET status = 'open', handed_to = NULL, handed_until = NULL, record_id = NULL, note = ?,
         payload_json = json_set(coalesce(payload_json, '{}'), '$.prompt', ?, '$.note', ?), updated_at = ?
       WHERE type = 'illustrate' AND subject = ?`,
    )
    .bind(note || 'The last illustration was replaced.', prompt, note || null, now.toISOString(), record.identity_key)
    .run();
  return { reopened: Number(result.meta.changes ?? 0) > 0, standard: true };
}

/** Why the upload would refuse the prompt a template makes for some standard dish with the longest note, or null. */
function promptRefused(template: string): string | null {
  const note = 'x'.repeat(NOTE_MAX);
  for (const entry of ILLUSTRATABLE.values()) {
    const refused = uploadRefuses('prompt', promptFor(template, { key: normDish(entry.zh), zh: entry.zh, en: entry.en }, note));
    if (refused) return `for ${entry.zh}, with a replacement note, the prompt ${refused}`;
  }
  return null;
}

/** The admin changes how illustrations are handled. */
export async function updateIllustrationSettings(db: D1Database, patch: Record<string, unknown>, now: Date): Promise<IllustrationSettings> {
  const current = await illustrationSettings(db);
  const next = { ...current };
  if (patch.shown !== undefined) {
    if (typeof patch.shown !== 'boolean') throw new HttpError(422, 'invalid_body', 'shown must be true or false.');
    next.shown = patch.shown;
  }
  if (patch.requested !== undefined) {
    if (typeof patch.requested !== 'boolean') throw new HttpError(422, 'invalid_body', 'requested must be true or false.');
    next.requested = patch.requested;
  }
  if (patch.daily !== undefined) {
    if (typeof patch.daily !== 'number' || !Number.isInteger(patch.daily) || patch.daily < 0 || patch.daily > 5000) {
      throw new HttpError(422, 'invalid_body', 'daily must be a whole number from 0 to 5000.');
    }
    next.daily = patch.daily;
  }
  if (patch.template !== undefined) {
    if (typeof patch.template !== 'string' || !patch.template.includes('{en}') || patch.template.length > 1000) {
      throw new HttpError(422, 'invalid_body', 'template must be at most 1000 characters and include {en}; {zh}, {cuisine} and {description} are filled in too.');
    }
    // Agents send the prompt back with the image, so every prompt it makes must be one the upload takes.
    const refused = promptRefused(patch.template);
    if (refused) throw new HttpError(422, 'invalid_body', `template makes prompts an upload would refuse: ${refused}. Use the placeholders fewer times.`);
    next.template = patch.template;
  }
  await putSetting(db, 'illustrations', JSON.stringify(next), now).run();
  return next;
}
