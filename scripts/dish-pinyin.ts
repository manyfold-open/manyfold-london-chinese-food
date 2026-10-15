/**
 * Writes kinds/dish-pinyin.ts: every standard dish's name in pinyin with tone marks, for the
 * "show the staff" card English readers point at when they order. Run it after adding dishes to
 * kinds/dish-vocab.ts:
 *
 *   node scripts/dish-pinyin.ts
 *
 * pinyin-pro reads words, not single characters, so 担担面 comes out dàn dàn miàn and 炒 chǎo; the
 * few it still gets wrong are corrected in FIXES below.
 */

import { writeFileSync } from 'node:fs';
import { pinyin } from 'pinyin-pro';
import { DISH_VOCAB } from '../kinds/dish-vocab.ts';

/** Readings pinyin-pro gets wrong for these dishes, whole. */
const FIXES: Record<string, string> = {
  担担面: 'dàn dàn miàn',
  // 子鸡 is a young chicken: zǐ, not the neutral suffix.
  脆皮炸子鸡: 'cuì pí zhà zǐ jī',
};

/**
 * Character by character, what food names read differently: 卷 in a roll is juǎn, and 子 after
 * another character is the neutral zi of 饺子 and 包子 (子姜 keeps zǐ).
 */
function reading(zh: string): string {
  const fixed = FIXES[zh];
  if (fixed) return fixed;
  const chars = [...zh];
  const syllables = pinyin(zh, { toneType: 'symbol', nonZh: 'consecutive', type: 'array' });
  if (syllables.length !== chars.length) return syllables.join(' ');
  return syllables
    .map((syllable, i) => (chars[i] === '卷' ? 'juǎn' : chars[i] === '子' && i > 0 ? 'zi' : syllable))
    .join(' ');
}

const lines = DISH_VOCAB.map(({ zh }) => `  ${JSON.stringify(zh)}: ${JSON.stringify(reading(zh))},`);

writeFileSync(
  new URL('../kinds/dish-pinyin.ts', import.meta.url),
  `/**
 * The standard dishes' names in pinyin, with tone marks: what the "show the staff" card prints under
 * the characters for readers who do not read Chinese. Written by scripts/dish-pinyin.ts; do not edit.
 */

export const DISH_PINYIN: Readonly<Record<string, string>> = {
${lines.join('\n')}
};
`,
);
console.log(`${lines.length} dishes`);
