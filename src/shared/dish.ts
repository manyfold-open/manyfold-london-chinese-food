/**
 * Dishes across places. A menu item is known two ways:
 *
 *   its item key       the place (or brand) and its own name, normalized: a photo of a dish at a
 *                      place hangs on this, so it survives the menu being updated
 *   its dish key       its standard name, when the dish vocabulary (kinds/dish-vocab.ts) knows it,
 *                      else its own name: "where can I eat 小笼包" and the dish's illustration hang
 *                      on this, so "Xiao Long Bao (6)", "小籠包" and "Soup dumplings" meet
 */

import { DISH_VOCAB, type DishEntry } from '../../kinds/dish-vocab.ts';

/** A dish name as two menus compare it: forms folded, lowercase, portion counts and punctuation dropped. */
export function normDish(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[(（]\s*\d+\s*(?:pcs?|pieces?|只|个|件|粒|串)?\s*[)）]/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEX = new Map<string, DishEntry>();
for (const entry of DISH_VOCAB) {
  for (const name of [entry.zh, entry.en, ...entry.aliases]) {
    const key = normDish(name);
    if (key && !INDEX.has(key)) INDEX.set(key, entry);
  }
}

/** The standard dish a name stands for, if the vocabulary knows it. */
export const standardDish = (name: unknown): DishEntry | null =>
  typeof name === 'string' && name.trim() ? (INDEX.get(normDish(name)) ?? null) : null;

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value;
  return null;
};

/** The names a menu item or a mentioned dish may carry. */
export interface DishNames {
  canonical?: unknown;
  name_zh?: unknown;
  name_en?: unknown;
  name?: unknown;
}

/** The standard entry for an item: its canonical name first, then its own names. */
export const entryOf = (item: DishNames): DishEntry | null =>
  standardDish(item.canonical) ?? standardDish(item.name_zh) ?? standardDish(item.name_en) ?? standardDish(item.name);

/** The key a dish is known by across places, or null for an item with no name. */
export function dishKeyOf(item: DishNames): string | null {
  const entry = entryOf(item);
  if (entry) return normDish(entry.zh);
  const own = firstText(item.canonical, item.name_zh, item.name_en, item.name);
  return own ? normDish(own) : null;
}

/** The key a dish at one place (or brand) is known by. */
export function itemKeyOf(ownerId: string, item: DishNames): string | null {
  const own = firstText(item.name_zh, item.name_en, item.name);
  return own ? `${ownerId}:${normDish(own)}` : null;
}

/** The names to show for a dish key: the standard names when known. */
export function dishNames(item: DishNames): { zh: string | null; en: string | null } {
  const entry = entryOf(item);
  if (entry) return { zh: entry.zh, en: entry.en };
  return { zh: firstText(item.name_zh, item.canonical), en: firstText(item.name_en, item.name) };
}
