/**
 * A place's public page, assembled from its records: the one module that knows how a place, its
 * brand, menus, review excerpts and photos fit together (AGENTS.md, invariant 2). Pure, so the
 * Worker builds it and tests read it without a database.
 *
 * What it makes, from the records it is given:
 *   doc      everything the place's page shows, in one JSON document
 *   entry    the place's line in the index readers load whole (list, map, filters, search)
 *   dishes   one row per dish the place serves or reviews mention, for "where can I eat X"
 *   sources  one row per review excerpt, for the pages that list one source's or critic's history
 *   wants    the work it still needs (a menu, reviews)
 *
 * There is no score here, nor anything to rank by: tests/docs.test.ts holds the document's keys.
 */

import { dishKeyOf, dishNames, itemKeyOf, normDish } from './dish.ts';
import { normName, type ListItem, type RecordData } from './kinds.ts';
import type { RecordStatus } from './types.ts';

/** A record as the builder reads it. */
export interface DocRecord {
  id: string;
  kind: string;
  status: RecordStatus;
  data: RecordData;
  source_url: string;
  evidence: string;
  observed_at: string;
  verified_at: string | null;
  updated_at: string;
  parent_id: string | null;
}

export interface DocHistoryEntry {
  at: string;
  action: string;
  kind: string;
  record_id: string;
  by: string;
}

export interface DocItem {
  /** This item at this place (or brand), for its photo. */
  key: string | null;
  /** The dish across places, for search and its illustration. */
  dish: string | null;
  name_zh?: string;
  name_en?: string;
  price_pence?: number;
  price_note?: string;
  description?: string;
  dietary?: string[];
  spicy?: number;
  /** The best real photo of this item here. */
  photo: { id: string; width: number; height: number } | null;
  /** Review excerpts that mention it. */
  mentions: string[];
}

export interface DocMenu {
  id: string;
  /** Whether the menu is the place's own or its brand's, which every branch shares. */
  owner: 'place' | 'brand';
  menu: string;
  title: string | null;
  source_kind: string;
  source_url: string;
  quote: string;
  observed_at: string;
  verified_at: string | null;
  stale: boolean;
  sections: { name: string | null; items: DocItem[] }[];
}

export interface DocReview {
  id: string;
  published_on: string;
  publication: string;
  source_key: string;
  source_type: string;
  author: string | null;
  author_key: string | null;
  language: string;
  excerpt: string;
  translation: string | null;
  source_url: string;
  archive_url: string | null;
  dishes: { name: string; dish: string | null }[];
  verified_at: string | null;
}

export interface DocPhoto {
  id: string;
  subject: string;
  dish_name: string | null;
  item_key: string | null;
  caption: string | null;
  attribution: string | null;
  width: number;
  height: number;
}

export interface PlaceDoc {
  id: string;
  slug: string;
  status: 'verified' | 'stale';
  place: RecordData;
  brand: { id: string; name_en: string | null; name_zh: string | null; website: string | null } | null;
  source: { url: string; quote: string; observed_at: string; verified_at: string | null };
  menus: DocMenu[];
  reviews: DocReview[];
  /** Dishes reviews mention that no menu here lists. */
  mentioned: { dish: string; name: string; reviews: string[] }[];
  photos: DocPhoto[];
  /** Records about this place still waiting for review, by kind. */
  pending: Record<string, number>;
  history: DocHistoryEntry[];
  updated_at: string;
}

/** A place's line in the index. Short keys: readers load every line at once. */
export interface IndexEntry {
  id: string;
  /** slug */
  s: string;
  /** names */
  n: string | null;
  z: string | null;
  /** category, cuisines */
  c: string;
  k: string[];
  /** borough code, postcode, postcode district, coordinates */
  b: string | null;
  pc: string | null;
  o: string | null;
  la: number | null;
  lo: number | null;
  /** trading: open, temporarily-closed, closed */
  t: string;
  /** brand id */
  br: string | null;
  /** what there is to read: review excerpts, menu items, photos */
  r: number;
  m: number;
  p: number;
  /** the newest review's date, and when the page last changed */
  l: string | null;
  u: string;
}

export interface DishRow {
  dish_key: string;
  via: 'menu' | 'review';
  entry: { name_zh: string | null; name_en: string | null; price_pence: number | null; item_key: string | null; photo: string | null };
}

export interface SourceRow {
  review_id: string;
  source_key: string;
  author_key: string | null;
  published_on: string;
  entry: {
    place_id: string;
    slug: string;
    place_en: string | null;
    place_zh: string | null;
    publication: string;
    author: string | null;
    source_type: string;
    language: string;
    excerpt: string;
    source_url: string;
    published_on: string;
  };
}

export interface BuiltPlace {
  doc: PlaceDoc;
  entry: IndexEntry;
  dishes: DishRow[];
  sources: SourceRow[];
  wants: { menu: boolean; reviews: { en: number; zh: number } | null };
}

const PUBLIC: readonly RecordStatus[] = ['verified', 'stale'];
const isPublic = (record: DocRecord) => PUBLIC.includes(record.status);
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const number = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** A URL-friendly form of a name: Latin letters and digits, joined by hyphens. Empty for a name in Chinese only. */
export function slugify(name: string | null): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** The key two review sources are compared by: "The Guardian" and "the guardian" are one. */
export const sourceKey = (publication: string): string => normName(publication).replace(/\s+/g, '-');

/** The history readers see: who added or changed what. Verdicts not taken, flags and system moves are left out. */
export const PUBLIC_ACTIONS: readonly string[] = ['submit', 'verify', 'update', 'stale', 'admin_edit', 'revert'];

export function buildPlace(input: {
  place: DocRecord;
  brand: DocRecord | null;
  /** Records whose page is this place's: its menus, reviews and photos, in any status. */
  children: DocRecord[];
  /** The brand's menus, every branch's too. */
  brandMenus: DocRecord[];
  history: DocHistoryEntry[];
}): BuiltPlace {
  const { place } = input;
  const data = place.data;
  const slug = slugify(text(data.name_en));
  const publicChildren = input.children.filter(isPublic);
  const pending: Record<string, number> = {};
  for (const child of input.children) if (child.status === 'pending') pending[child.kind] = (pending[child.kind] ?? 0) + 1;

  const photos: DocPhoto[] = publicChildren
    .filter((child) => child.kind === 'photo')
    .sort((a, b) => (a.verified_at ?? '').localeCompare(b.verified_at ?? ''))
    .map((photo) => ({
      id: photo.id,
      subject: String(photo.data.subject),
      dish_name: text(photo.data.dish_name),
      item_key: photo.data.subject === 'dish' && text(photo.data.dish_name) ? itemKeyOf(place.id, { name: photo.data.dish_name }) : null,
      caption: text(photo.data.caption),
      attribution: text(photo.data.attribution),
      width: number(photo.data.width) ?? 0,
      height: number(photo.data.height) ?? 0,
    }));
  const photoByItem = new Map<string, DocPhoto>();
  for (const photo of photos) if (photo.item_key && !photoByItem.has(photo.item_key)) photoByItem.set(photo.item_key, photo);

  const reviews: DocReview[] = publicChildren
    .filter((child) => child.kind === 'review')
    .map((review) => {
      const author = text(review.data.author);
      const publication = String(review.data.publication ?? '');
      const dishes = Array.isArray(review.data.dishes) ? (review.data.dishes as ListItem[]) : [];
      return {
        id: review.id,
        published_on: String(review.data.published_on ?? ''),
        publication,
        source_key: sourceKey(publication),
        source_type: String(review.data.source_type ?? ''),
        author,
        author_key: author ? sourceKey(author) : null,
        language: String(review.data.language ?? ''),
        excerpt: review.evidence,
        translation: text(review.data.translation),
        source_url: review.source_url,
        archive_url: text(review.data.archive_url),
        dishes: dishes.map((dish) => ({ name: String(dish.name ?? ''), dish: dishKeyOf(dish) })),
        verified_at: review.verified_at,
      };
    })
    .sort((a, b) => b.published_on.localeCompare(a.published_on) || b.id.localeCompare(a.id));

  // Which reviews mention which dish.
  const mentions = new Map<string, string[]>();
  for (const review of reviews) {
    for (const dish of review.dishes) {
      if (!dish.dish) continue;
      const list = mentions.get(dish.dish) ?? [];
      if (!list.includes(review.id)) list.push(review.id);
      mentions.set(dish.dish, list);
    }
  }

  const menuRecords = [
    ...publicChildren.filter((child) => child.kind === 'menu').map((menu) => ({ menu, owner: 'place' as const })),
    ...input.brandMenus.filter(isPublic).map((menu) => ({ menu, owner: 'brand' as const })),
  ];
  const onMenus = new Set<string>();
  const dishRows = new Map<string, DishRow>();
  const menus: DocMenu[] = menuRecords.map(({ menu, owner }) => {
    const items = Array.isArray(menu.data.items) ? (menu.data.items as ListItem[]) : [];
    const sections: DocMenu['sections'] = [];
    for (const item of items) {
      const section = text(item.section);
      let current = sections.at(-1);
      if (!current || current.name !== section) {
        current = { name: section, items: [] };
        sections.push(current);
      }
      const dish = dishKeyOf(item);
      const key = itemKeyOf(owner === 'place' ? place.id : String(menu.parent_id), item);
      const photo = (key && photoByItem.get(key)) || (dish ? photos.find((candidate) => candidate.item_key && candidate.dish_name && normDish(candidate.dish_name) === dish) : undefined);
      if (dish) {
        onMenus.add(dish);
        if (!dishRows.has(dish)) {
          const names = dishNames(item);
          dishRows.set(dish, {
            dish_key: dish,
            via: 'menu',
            entry: { name_zh: names.zh, name_en: names.en, price_pence: number(item.price_pence), item_key: key, photo: photo?.id ?? null },
          });
        }
      }
      current.items.push({
        key,
        dish,
        ...(text(item.name_zh) ? { name_zh: String(item.name_zh) } : {}),
        ...(text(item.name_en) ? { name_en: String(item.name_en) } : {}),
        ...(number(item.price_pence) !== null ? { price_pence: Number(item.price_pence) } : {}),
        ...(text(item.price_note) ? { price_note: String(item.price_note) } : {}),
        ...(text(item.description) ? { description: String(item.description) } : {}),
        ...(Array.isArray(item.dietary) && item.dietary.length ? { dietary: item.dietary as string[] } : {}),
        ...(number(item.spicy) !== null ? { spicy: Number(item.spicy) } : {}),
        photo: photo ? { id: photo.id, width: photo.width, height: photo.height } : null,
        mentions: dish ? (mentions.get(dish) ?? []) : [],
      });
    }
    return {
      id: menu.id,
      owner,
      menu: String(menu.data.menu ?? 'main'),
      title: text(menu.data.title),
      source_kind: String(menu.data.source_kind ?? ''),
      source_url: menu.source_url,
      quote: menu.evidence,
      observed_at: menu.observed_at,
      verified_at: menu.verified_at,
      stale: menu.status === 'stale',
      sections,
    };
  });

  const mentioned: PlaceDoc['mentioned'] = [];
  for (const review of reviews) {
    for (const dish of review.dishes) {
      if (!dish.dish || onMenus.has(dish.dish)) continue;
      const known = mentioned.find((entry) => entry.dish === dish.dish);
      if (known) {
        if (!known.reviews.includes(review.id)) known.reviews.push(review.id);
      } else {
        mentioned.push({ dish: dish.dish, name: dish.name, reviews: [review.id] });
        if (!dishRows.has(dish.dish)) {
          const names = dishNames({ name: dish.name });
          dishRows.set(dish.dish, { dish_key: dish.dish, via: 'review', entry: { name_zh: names.zh, name_en: names.en, price_pence: null, item_key: null, photo: null } });
        }
      }
    }
  }

  const brand = input.brand && isPublic(input.brand)
    ? { id: input.brand.id, name_en: text(input.brand.data.name_en), name_zh: text(input.brand.data.name_zh), website: text(input.brand.data.website) }
    : null;
  const updatedAt = [place.updated_at, ...publicChildren.map((child) => child.updated_at), ...input.brandMenus.filter(isPublic).map((menu) => menu.updated_at)].sort().at(-1)!;

  const doc: PlaceDoc = {
    id: place.id,
    slug,
    status: place.status === 'stale' ? 'stale' : 'verified',
    place: data,
    brand,
    source: { url: place.source_url, quote: place.evidence, observed_at: place.observed_at, verified_at: place.verified_at },
    menus,
    reviews,
    mentioned,
    photos,
    pending,
    history: input.history.filter((entry) => PUBLIC_ACTIONS.includes(entry.action)).slice(0, 30),
    updated_at: updatedAt,
  };

  const itemCount = menus.reduce((sum, menu) => sum + menu.sections.reduce((inner, section) => inner + section.items.length, 0), 0);
  const entry: IndexEntry = {
    id: place.id,
    s: slug,
    n: text(data.name_en),
    z: text(data.name_zh),
    c: String(data.category ?? ''),
    k: Array.isArray(data.cuisines) ? (data.cuisines as string[]) : [],
    b: text(data.borough_code),
    pc: text(data.postcode),
    o: text(data.outcode),
    la: number(data.lat),
    lo: number(data.lng),
    t: String(data.trading ?? 'open'),
    br: brand?.id ?? null,
    r: reviews.length,
    m: itemCount,
    p: photos.length,
    l: reviews[0]?.published_on ?? null,
    u: updatedAt,
  };

  const sources: SourceRow[] = reviews.map((review) => ({
    review_id: review.id,
    source_key: review.source_key,
    author_key: review.author_key,
    published_on: review.published_on,
    entry: {
      place_id: place.id,
      slug,
      place_en: text(data.name_en),
      place_zh: text(data.name_zh),
      publication: review.publication,
      author: review.author,
      source_type: review.source_type,
      language: review.language,
      excerpt: review.excerpt,
      source_url: review.source_url,
      published_on: review.published_on,
    },
  }));

  const byLanguage = { en: reviews.filter((review) => review.language === 'en').length, zh: reviews.filter((review) => review.language === 'zh').length };
  const trading = data.trading !== 'closed';
  return {
    doc,
    entry,
    dishes: [...dishRows.values()],
    sources,
    wants: {
      menu: trading && data.category !== 'grocery' && menus.length === 0,
      reviews: trading && (byLanguage.en < 3 || byLanguage.zh < 3) ? byLanguage : null,
    },
  };
}
