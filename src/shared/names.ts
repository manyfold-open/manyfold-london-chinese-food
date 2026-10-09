/**
 * One place under two spellings: the tests the site uses to tell that two records of places are
 * the same (src/worker/submit.ts) and which business an outside listing is (src/worker/facts.ts,
 * scripts/qualify-leads.ts).
 */

import { normalizeUrl, normName, type RecordData } from './kinds.ts';

export const phoneOf = (value: unknown): string => {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '').replace(/^44/, '0') : '';
  return digits.length >= 10 ? digits : '';
};

export const websiteOf = (value: unknown): string => (typeof value === 'string' && value ? normalizeUrl(value) : '');

/** The house number of an address: "63B Dartmouth Road" gives "63b". */
export const houseNumberOf = (value: unknown): string => (typeof value === 'string' ? (/\b(\d+[a-z]?)\b/i.exec(value)?.[1]?.toLowerCase() ?? '') : '');

/** Words that say what a place is rather than which one. */
const GENERIC_WORDS = /\b(the|new|chinese|takeaway|take|away|restaurant|cuisine|express|kitchen|food|house|ltd|limited|and|co)\b/g;

/** A place's name with spaces, apostrophes and generic words gone: "New Chan's Take-away" gives "chans". */
export const coreName = (data: RecordData): string =>
  normName(String(data.name_en ?? data.name_zh ?? ''))
    .replace(/['’]s\b/g, '')
    .replace(GENERIC_WORDS, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Whether two strings differ by at most one letter added, dropped or changed. */
function oneApart(a: string, b: string): boolean {
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let i = 0;
  while (i < short.length && long[i] === short[i]) i += 1;
  return long.slice(i + 1) === (long.length === short.length ? short.slice(i + 1) : short.slice(i));
}

/** Two names that are one name spelled two ways. */
export function namesAlike(a: RecordData, b: RecordData): boolean {
  const x = coreName(a);
  const y = coreName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x))) return true;
  return Math.min(x.length, y.length) >= 4 && oneApart(x, y);
}

