/**
 * What the front page's arrivals board and crew show: the newest checks of public records, and the
 * agents doing the work. src/worker/docs.ts builds both as stored datasets from revisions it has
 * not read before (AGENTS.md, invariant 15); this module is the pure part, shared with the app's
 * types and with tests. Only a record that is public right now is ever an event (invariant 1), and
 * nothing here scores a place: an event says what was checked, never how good anything is.
 */

import type { IndexEntry } from './place-doc.ts';

export type ActivityType = 'place' | 'menu' | 'quote' | 'art' | 'photo';

export interface ActivityPlace {
  id: string;
  s: string;
  n: string | null;
  z: string | null;
  o: string | null;
}

export interface ActivityEvent {
  /** The record checked. */
  id: string;
  at: string;
  type: ActivityType;
  /** Who checked it, as the place's history names them. */
  by: string;
  place: ActivityPlace | null;
  /** A menu's priced items. */
  items?: number;
  quote?: { publication: string; author: string | null; language: string; excerpt: string; translation: string | null };
  /** An illustration's standard dish. */
  dish?: string;
  /** A photo that is its place's first. */
  first?: boolean;
}

export interface Activity {
  events: ActivityEvent[];
  /** London's date the counts are for. */
  day: string;
  /** Records checked that day, and how many agents sent or checked one. */
  checked: number;
  agents: number;
  built_at: string;
}

export interface CrewMember {
  label: string;
  role: 'collector' | 'maintainer';
  /** A collector's records that passed, all told; a maintainer's checks in the last week. */
  count: number;
  /** The kind it works on most. */
  kind: string | null;
  last_at: string | null;
}

/** The revision and record an event is made from, as docs.ts reads them. */
export interface ActivityRow {
  revision: number;
  record_id: string;
  kind: string;
  action: string;
  created_at: string;
  status: string;
  /** The place a child record belongs to. */
  place_id: string | null;
  data: Record<string, unknown>;
  evidence: string;
}

/** How many events the board keeps. */
export const ACTIVITY_KEEP = 40;
const PUBLIC = ['verified', 'stale'];

const LONDON_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });

/** London's calendar date of an instant, YYYY-MM-DD. */
export const londonDay = (iso: string): string => LONDON_DATE.format(new Date(iso));

export const placeOf = (entry: IndexEntry): ActivityPlace => ({ id: entry.id, s: entry.s, n: entry.n, z: entry.z, o: entry.o });

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/**
 * The event a check makes, or null: a record that is not public now, or a child of a place that is
 * not, makes none, and only checks (verify) are news. `entry` is the place's index line.
 */
export function activityEvent(row: ActivityRow, entry: IndexEntry | null, by: string): ActivityEvent | null {
  if (row.action !== 'verify' || !PUBLIC.includes(row.status)) return null;
  const base = { id: row.record_id, at: row.created_at, by };
  if (row.kind === 'illustration') {
    const dish = text(row.data.dish);
    return dish ? { ...base, type: 'art', place: null, dish } : null;
  }
  if (!entry) return null;
  const place = placeOf(entry);
  if (row.kind === 'place') return { ...base, type: 'place', place };
  if (row.kind === 'menu') {
    const items = Array.isArray(row.data.items) ? row.data.items.filter((item) => typeof (item as { price_pence?: unknown }).price_pence === 'number').length : 0;
    return { ...base, type: 'menu', place, items };
  }
  if (row.kind === 'review') {
    const excerpt = row.evidence.length > 160 ? `${row.evidence.slice(0, 157)}…` : row.evidence;
    return {
      ...base,
      type: 'quote',
      place,
      quote: {
        publication: text(row.data.publication) ?? '',
        author: text(row.data.author),
        language: text(row.data.language) ?? 'en',
        excerpt,
        translation: text(row.data.translation),
      },
    };
  }
  if (row.kind === 'photo') return { ...base, type: 'photo', place, first: entry.p <= 1 };
  return null;
}

/** A line of the board: checks of one place (or dish), of one kind, close together, as one. */
export interface BoardRow extends ActivityEvent {
  /** How many checks the line stands for. */
  count: number;
}

/** Checks of one place and one kind within this long of each other share a line. */
export const MERGE_MS = 15 * 60_000;

/**
 * The board's lines from its events, newest first: a place's four menus checked together are one
 * line ("4 menus, 25 prices"), so the board never shows the same name four times running.
 */
export function boardRows(events: readonly ActivityEvent[]): BoardRow[] {
  const rows: BoardRow[] = [];
  let oldest = 0;
  const subject = (event: ActivityEvent) => event.place?.id ?? event.dish ?? event.id;
  for (const event of events) {
    const last = rows.at(-1);
    const at = Date.parse(event.at);
    if (last && last.type === event.type && subject(last) === subject(event) && oldest - at <= MERGE_MS) {
      last.count += 1;
      if (event.items !== undefined) last.items = (last.items ?? 0) + event.items;
      if (event.first) last.first = true;
      oldest = at;
      continue;
    }
    rows.push({ ...event, count: 1 });
    oldest = at;
  }
  return rows;
}

/** The day's counts, while it is still that day in London; null once the day has turned or none was checked. */
export function checkedToday(activity: Pick<Activity, 'day' | 'checked' | 'agents'>, now: Date): { checked: number; agents: number } | null {
  if (activity.day !== londonDay(now.toISOString()) || activity.checked === 0) return null;
  return { checked: activity.checked, agents: activity.agents };
}

/** The board's fallback when there are no checks to show: public places by when their page last changed. */
export function recentlyUpdated(entries: readonly IndexEntry[], most = 12): IndexEntry[] {
  return entries
    .filter((entry) => entry.t !== 'closed')
    .sort((a, b) => b.u.localeCompare(a.u))
    .slice(0, most);
}
