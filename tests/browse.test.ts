import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISH_PINYIN } from '../kinds/dish-pinyin';
import { DISH_VOCAB } from '../kinds/dish-vocab';
import { CATEGORIES, CUISINES, LINES } from '../kinds/vocab';
import { matchRoute, paths } from '../src/app/routes';
import { CAMPUSES, campusById, nearestStation, placesNear, walkMinutes } from '../src/shared/campuses';
import { DAY_DISHES, dishOfDay } from '../src/shared/day-dish';
import { standardDish } from '../src/shared/dish';
import { GUIDES, inGuide } from '../src/shared/guides';
import { COPY } from '../src/shared/i18n';
import { lineCounts, linesOf } from '../src/shared/lines';
import type { IndexEntry } from '../src/shared/place-doc';
import { findRating } from '../src/shared/rating-guard';
import { pathTitle } from '../src/shared/titles';
import { sitemap } from '../src/worker/seo';

const entry = (overrides: Partial<IndexEntry> = {}): IndexEntry => ({
  id: 'rec_a',
  s: 'a',
  n: 'A',
  z: null,
  c: 'restaurant',
  k: [],
  b: null,
  pc: null,
  o: 'W1D',
  la: 51.5115,
  lo: -0.131,
  t: 'open',
  br: null,
  r: 0,
  m: 0,
  p: 0,
  l: null,
  u: '2026-10-14T00:00:00.000Z',
  ...overrides,
});

describe('the lines', () => {
  it('put every cuisine on exactly one line, and only real cuisines and categories', () => {
    const onLines = LINES.flatMap((line) => line.cuisines);
    expect([...onLines].sort()).toEqual([...CUISINES].sort());
    expect(new Set(onLines).size).toBe(onLines.length);
    for (const line of LINES) for (const category of line.categories) expect(CATEGORIES).toContain(category);
  });

  it('each have a colour in every theme of the stylesheet', () => {
    const css = readFileSync(new URL('../src/app/styles.css', import.meta.url), 'utf8');
    for (const marker of ['/* theme: light */', '/* theme: dark (system) */', '/* theme: dark (chosen) */']) {
      const start = css.indexOf(marker);
      const block = css.slice(start, css.indexOf('}', css.indexOf('{', start)));
      for (const line of LINES) expect(block, `${line.id} in ${marker}`).toMatch(new RegExp(`${line.color}:\\s*#[0-9a-f]{6}`));
    }
  });

  it('place a place by its cuisines and its category, in the lines’ order', () => {
    expect(linesOf(entry({ k: ['sichuan', 'cantonese'] }))).toEqual(['dimsum', 'spicy']);
    expect(linesOf(entry({ c: 'takeaway', k: ['cantonese'] }))).toEqual(['dimsum', 'takeaway']);
    expect(linesOf(entry({ c: 'tea-drinks' }))).toEqual(['boba']);
    expect(lineCounts([entry({ k: ['shaanxi'] }), entry({ k: ['lanzhou'], t: 'closed' })]).north).toBe(1);
  });
});

describe('campuses and stations', () => {
  it('have their own ids and a line colour', () => {
    expect(new Set(CAMPUSES.map((campus) => campus.id)).size).toBe(CAMPUSES.length);
    for (const campus of CAMPUSES) expect(LINES.map((line) => line.id)).toContain(campus.line);
  });

  it('find the places a walk away, nearest first, and the station nearest a point', () => {
    const ucl = campusById('ucl')!;
    const near = placesNear([entry({ id: 'far', la: 51.45, lo: 0 }), entry({ id: 'b', la: 51.5232, lo: -0.1327 }), entry({ id: 'c', la: 51.5246, lo: -0.1341 })], ucl);
    expect(near.map((n) => n.entry.id)).toEqual(['c', 'b']);
    expect(nearestStation({ lat: 51.5229, lng: -0.1243 })?.name).toBe('Russell Square');
    expect(walkMinutes(0.87)).toBe(13);
  });
});

describe('the guides', () => {
  it('have their own slugs and issues, and say nothing that rates a place', () => {
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(GUIDES.length);
    expect(new Set(GUIDES.map((guide) => guide.issue)).size).toBe(GUIDES.length);
    for (const guide of GUIDES) {
      for (const text of [guide.tag, guide.title, guide.dek, guide.rule].flatMap((bilingual) => [bilingual.zh, bilingual.en])) expect(findRating(text), text).toBeNull();
      expect(LINES.map((line) => line.id)).toContain(guide.line);
      expect(Boolean(guide.filter) !== Boolean(guide.routes)).toBe(true);
    }
  });

  it('route only from known campuses, through stops that name menu items by key (the place’s, or its brand’s)', () => {
    for (const guide of GUIDES.filter((g) => g.routes)) {
      for (const [campus, stops] of Object.entries(guide.routes!)) {
        expect(campusById(campus), campus).toBeDefined();
        expect(stops.length).toBeGreaterThan(0);
        for (const stop of stops) {
          expect(stop.place).toMatch(/^rec_[0-9a-z]+$/);
          for (const item of stop.items) expect(item, stop.place).toMatch(/^rec_[0-9a-z]+:.+/);
        }
      }
    }
  });

  it('take a place by any of their kinds, and by area or distance when they say', () => {
    const north = GUIDES.find((guide) => guide.slug === 'taste-of-home-north')!.filter!;
    expect(inGuide(north, entry({ k: ['shaanxi'] }))).toBe(true);
    expect(inGuide(north, entry({ k: ['cantonese'] }))).toBe(false);
    expect(inGuide(north, entry({ k: ['shaanxi'], t: 'closed' }))).toBe(false);
    const chinatown = GUIDES.find((guide) => guide.slug === 'chinatown-by-dish')!.filter!;
    expect(inGuide(chinatown, entry({ o: 'WC2H' }))).toBe(true);
    expect(inGuide(chinatown, entry({ o: 'E14' }))).toBe(false);
    const wharf = GUIDES.find((guide) => guide.slug === 'canary-wharf-lunch')!.filter!;
    expect(inGuide(wharf, entry({ la: 51.505, lo: -0.02 }))).toBe(true);
    expect(inGuide(wharf, entry())).toBe(false);
  });
});

describe('dishes', () => {
  it('have pinyin for every standard dish, with tone marks', () => {
    for (const dish of DISH_VOCAB) expect(DISH_PINYIN[dish.zh], dish.zh).toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/);
    expect(DISH_PINYIN['小笼包']).toBe('xiǎo lóng bāo');
    expect(DISH_PINYIN['担担面']).toBe('dàn dàn miàn');
  });

  it('of the day are standard dishes, one a day, turning over', () => {
    for (const dish of DAY_DISHES) expect(standardDish(dish), dish).toBeDefined();
    expect(dishOfDay(new Date('2026-10-14T09:00:00Z'))).toBe(dishOfDay(new Date('2026-10-14T21:00:00Z')));
    expect(dishOfDay(new Date('2026-10-14T09:00:00Z'))).not.toBe(dishOfDay(new Date('2026-10-15T09:00:00Z')));
  });
});

describe('the pages', () => {
  it('are found by path, and their paths are what the routes match', () => {
    expect(matchRoute(paths.map('zh'), 'en')).toEqual({ page: 'map', locale: 'zh' });
    expect(matchRoute(paths.line('en', 'north'), 'zh')).toEqual({ page: 'line', locale: 'en', id: 'north' });
    expect(matchRoute(paths.near('zh', 'ucl'), 'zh')).toEqual({ page: 'near', locale: 'zh', campus: 'ucl' });
    expect(matchRoute(paths.guide('zh', 'full-for-a-tenner', 'lse'), 'zh')).toEqual({ page: 'guide', locale: 'zh', slug: 'full-for-a-tenner', campus: 'lse' });
    expect(matchRoute(paths.guides('en'), 'zh')).toEqual({ page: 'guides', locale: 'en' });
    expect(matchRoute(paths.lightUp('en'), 'zh')).toEqual({ page: 'light-up', locale: 'en' });
    expect(matchRoute('/zh/map/extra', 'zh')).toEqual({ page: 'not-found', locale: 'zh' });
  });

  it('have titles, and an unknown line, campus or guide is not found', () => {
    expect(pathTitle('zh', '/line/north')).toEqual({ found: true, title: '北方线 · 伦敦中餐地图' });
    expect(pathTitle('en', '/near/ucl')).toEqual({ found: true, title: 'Chinese food near UCL · London Chinese Food' });
    expect(pathTitle('zh', '/guide/full-for-a-tenner/ucl').title).toBe('伦敦 £10 吃饱指南 · UCL · 伦敦中餐地图');
    expect(pathTitle('en', '/map').found).toBe(true);
    for (const rest of ['/line/nowhere', '/near/oxford', '/guide/nothing', '/guide/full-for-a-tenner/oxford', '/guide/hotpot-night/ucl']) expect(pathTitle('zh', rest).found, rest).toBe(false);
  });

  it('are in the sitemap, in both languages', () => {
    const xml = sitemap('https://site', [], []);
    for (const path of ['/zh/map', '/en/dishes', '/zh/line/spicy', '/en/near/lse', '/zh/guide/full-for-a-tenner/kcl', '/en/guides', '/zh/light-up']) expect(xml).toContain(`<loc>https://site${path}</loc>`);
  });

  it('say nothing in the new copy that rates a place', () => {
    for (const copy of Object.values(COPY)) for (const text of [copy.front.hero.before, copy.lines.lead, copy.guides.lead, copy.lightUp.text, copy.crew.lead]) expect(findRating(text)).toBeNull();
  });
});
