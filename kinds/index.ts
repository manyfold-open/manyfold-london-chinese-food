/** Every kind of record the site holds, by name. */

import type { Kind, KindConfig } from '../src/shared/kinds.ts';
import { KINDS } from '../src/shared/kinds.ts';
import brand from './brand.ts';
import illustration from './illustration.ts';
import menu from './menu.ts';
import photo from './photo.ts';
import place from './place.ts';
import review from './review.ts';

export const KIND_CONFIGS: Readonly<Record<Kind, KindConfig>> = { place, brand, menu, review, photo, illustration };

export const ALL_KINDS: readonly KindConfig[] = KINDS.map((kind) => KIND_CONFIGS[kind]);

/** The config of a kind named in a request, or undefined. */
export const kindConfig = (name: string): KindConfig | undefined =>
  (KINDS as readonly string[]).includes(name) ? KIND_CONFIGS[name as Kind] : undefined;
