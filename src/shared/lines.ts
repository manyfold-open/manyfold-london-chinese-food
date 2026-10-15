/**
 * Which of the eight lines (kinds/vocab.ts, LINES) a place is on: every family its cuisines belong
 * to, and its category's line when the category has one (a takeaway rides the Takeaway line, a
 * bubble tea shop the Bubble Tea line). Lines group places for browsing; they never rank them.
 */

import { LINES, type Line } from '../../kinds/vocab.ts';
import type { IndexEntry } from './place-doc.ts';

export type { Line };
export { LINES };

const BY_CUISINE = new Map(LINES.flatMap((line) => line.cuisines.map((cuisine) => [cuisine, line.id] as const)));
const BY_CATEGORY = new Map(LINES.flatMap((line) => line.categories.map((category) => [category, line.id] as const)));

export const lineById = (id: string): Line | undefined => LINES.find((line) => line.id === id);

/** The line a cuisine rides. */
export const lineOfCuisine = (cuisine: string): string | undefined => BY_CUISINE.get(cuisine);

/** The lines a place is on, in the lines' own order. */
export function linesOf(entry: Pick<IndexEntry, 'c' | 'k'>): string[] {
  const ids = new Set<string>();
  for (const cuisine of entry.k) {
    const id = BY_CUISINE.get(cuisine);
    if (id) ids.add(id);
  }
  const byCategory = BY_CATEGORY.get(entry.c);
  if (byCategory) ids.add(byCategory);
  return LINES.map((line) => line.id).filter((id) => ids.has(id));
}

/** The line to show a place by: the first of `chosen` it is on (the lines a reader filtered by), else its first. */
export function lineFor(entry: Pick<IndexEntry, 'c' | 'k'>, chosen: readonly string[] = []): string | null {
  const lines = linesOf(entry);
  return lines.find((id) => chosen.includes(id)) ?? lines[0] ?? null;
}

/** Whether a place is on a line. */
export const onLine = (entry: Pick<IndexEntry, 'c' | 'k'>, id: string): boolean => linesOf(entry).includes(id);

/** How many places that are open each line has. */
export function lineCounts(entries: readonly IndexEntry[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(LINES.map((line) => [line.id, 0]));
  for (const entry of entries) {
    if (entry.t !== 'open') continue;
    for (const id of linesOf(entry)) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
