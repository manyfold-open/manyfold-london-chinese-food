/**
 * How alike two passages are, for one question: is a maintainer's quote of a review the same
 * passage the collector sent, or another one? Character bigrams work for Chinese as well as
 * English, and ignore what copying across tools changes: spacing, punctuation, width, case.
 */

const comparable = (text: string): string =>
  text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const chars = [...text];
  for (let index = 0; index < chars.length - 1; index += 1) {
    const pair = chars[index]! + chars[index + 1]!;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Dice's coefficient over character bigrams: 1 for the same passage, near 0 for unrelated ones. */
export function similarity(a: string, b: string): number {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const left = bigrams(x);
  const right = bigrams(y);
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
  return (2 * shared) / ([...x].length - 1 + [...y].length - 1);
}

/** The least similarity at which a maintainer's quote still counts as the collector's passage. */
export const SAME_PASSAGE = 0.8;
