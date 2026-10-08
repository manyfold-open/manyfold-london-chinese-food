/**
 * Site settings the admin makes in /settings, kept in the settings table under scope '*': the
 * hosts the site may not quote, and how illustrations are handled.
 */

import { CUISINE_LABELS } from '../../kinds/vocab';
import { standardDish } from '../shared/dish';

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM settings WHERE scope = '*' AND key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export function putSetting(db: D1Database, key: string, value: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO settings (scope, key, value, updated_at) VALUES ('*', ?, ?, ?)
       ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now.toISOString());
}

/** A URL's host as the block list compares it: lowercase, without "www.". */
export const hostOf = (url: string): string => new URL(url).hostname.toLowerCase().replace(/^www\./, '');

/** Hosts whose owners asked not to be quoted. A host covers its subdomains. */
export async function blockedHosts(db: D1Database): Promise<string[]> {
  const value = await getSetting(db, 'blocked_hosts');
  return value ? (JSON.parse(value) as string[]) : [];
}

/** The blocked host a URL is on, or null. */
export const blockedBy = (url: string, hosts: readonly string[]): string | null => {
  const host = hostOf(url);
  return hosts.find((blocked) => host === blocked || host.endsWith(`.${blocked}`)) ?? null;
};

/** How the site handles illustrations. */
export interface IllustrationSettings {
  /** Show approved illustrations to readers. */
  shown: boolean;
  /** Hand out illustrate work items to agents. */
  requested: boolean;
  /** Most illustrate items handed out in one UTC day. */
  daily: number;
  /** The prompt template; {zh}, {en}, {description} and {cuisine} are filled in. */
  template: string;
}

export const DEFAULT_TEMPLATE =
  'Realistic food photograph of {en} ({zh}), a {cuisine} dish: {description} One serving on a plain plate or bowl, neutral table, soft daylight, three-quarter view from above. No text, letters, logos, watermarks, people or hands.';

export async function illustrationSettings(db: D1Database): Promise<IllustrationSettings> {
  const value = await getSetting(db, 'illustrations');
  const stored = value ? (JSON.parse(value) as Partial<IllustrationSettings>) : {};
  return {
    shown: stored.shown ?? true,
    requested: stored.requested ?? true,
    daily: stored.daily ?? 100,
    template: stored.template ?? DEFAULT_TEMPLATE,
  };
}

/** The prompt for a dish, from the template the admin can edit, with the note of a replaced illustration. */
export function promptFor(template: string, dish: { key: string; zh: string | null; en: string | null }, note?: string | null): string {
  const entry = standardDish(dish.zh) ?? standardDish(dish.en) ?? standardDish(dish.key);
  const zh = entry?.zh ?? dish.zh ?? dish.key;
  const en = entry?.en ?? dish.en ?? zh;
  const cuisine = entry ? (CUISINE_LABELS[entry.cuisine]?.en ?? 'Chinese') : 'Chinese';
  const description = entry?.description ?? `A typical serving of ${en}.`;
  const prompt = template.replaceAll('{zh}', zh).replaceAll('{en}', en).replaceAll('{cuisine}', cuisine).replaceAll('{description}', description);
  return note ? `${prompt} Note from the last review: ${note}` : prompt;
}
