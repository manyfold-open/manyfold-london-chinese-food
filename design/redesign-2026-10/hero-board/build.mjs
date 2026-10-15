// Builds ../hero-board.html: the front page's hero with the arrivals board in each state it can be
// in, drawn with the site's own stylesheet and the live site's places. Run from the repo root:
//   node design/redesign-2026-10/hero-board/build.mjs
// The rows are real: checks (verified_at) of the menus, review excerpts, photos and places of the
// places changed most recently, and for the fallback the places themselves by when their page last
// changed. Only the clock is simulated, to show the board at midday and early in the morning.

import { readFileSync, writeFileSync } from 'node:fs';
import { CAMPUSES, placesNear } from '../../../src/shared/campuses.ts';
import { LINES, linesOf } from '../../../src/shared/lines.ts';

const SITE = 'https://app.manyfold.ai/london-chinese-food';
const here = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, here), 'utf8');

const { places } = await (await fetch(`${SITE}/api/index`)).json();
const byId = new Map(places.map((p) => [p.id, p]));
const name = (p) => p.z || p.n || '';
const lineIds = LINES.map((line) => line.id);
const listed = places.filter((p) => p.t !== 'closed');
const open = places.filter((p) => p.t === 'open');

// Every place as a dot, in its first line's colour (an index into LINES; -1 for none).
const dots = listed.filter((p) => p.la !== null && p.lo !== null).map((p) => [+p.la.toFixed(5), +p.lo.toFixed(5), lineIds.indexOf(linesOf(p)[0] ?? '')]);

// The front page's pins, counted as HomePage counts them.
const pins = [
  ...CAMPUSES.filter((c) => ['ucl', 'imperial', 'qmul'].includes(c.id)).map((c) => ({
    lat: c.lat,
    lng: c.lng,
    kind: 'uni',
    label: c.short,
    sub: placesNear(open, c).length,
    shift: c.id === 'ucl' ? '-20% -150%' : c.id === 'imperial' ? '-90% 40%' : null,
  })),
  { lat: 51.5115, lng: -0.131, kind: 'hub', label: '唐人街', sub: open.filter((p) => p.o === 'W1D' || p.o === 'WC2H').length, shift: '-108% 30%' },
];

// The fallback: places by when their public page last changed.
const newest = [...listed].sort((a, b) => b.u.localeCompare(a.u));
const updated = newest.slice(0, 12).map((p) => ({ name: name(p), o: p.o, at: p.u }));

// The checks behind the most recently changed pages, as the activity dataset would show them.
const events = [];
for (const p of newest.slice(0, 40)) {
  const doc = await (await fetch(`${SITE}/api/places/${p.id}`)).json();
  const where = { name: name(p), o: p.o };
  if (doc.source?.verified_at) events.push({ type: 'place', at: doc.source.verified_at, ...where });
  for (const menu of doc.menus ?? []) {
    const items = menu.sections.flatMap((section) => section.items).filter((item) => item.price_pence !== undefined && item.price_pence !== null).length;
    if (menu.verified_at && menu.owner === 'place') events.push({ type: 'menu', at: menu.verified_at, items, ...where });
  }
  for (const review of doc.reviews ?? []) if (review.verified_at) events.push({ type: 'quote', at: review.verified_at, publication: review.publication, ...where });
  for (const photo of doc.photos ?? []) if (photo.verified_at) events.push({ type: 'photo', at: photo.verified_at, ...where });
}
events.sort((a, b) => b.at.localeCompare(a.at));

const data = {
  built: new Date().toISOString(),
  lines: LINES.map((line) => line.color),
  dots,
  pins,
  updated,
  events: events.slice(0, 60),
  open: open.length,
  updatedAt: newest.map((p) => p.u).slice(0, 400),
};

const styles = readFileSync(new URL('../../../src/app/styles.css', import.meta.url), 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '');
const html = read('page.html')
  .replace('/*STYLES*/', () => styles)
  .replace('/*BOARD_CSS*/', () => read('board.css'))
  .replace('<!--HERO-->', () => read('hero.html').replace('<!--BOARD-->', '<section class="live-board" id="board" aria-label="实时到站"></section>'))
  .replace('/*DATA*/', () => `const DATA = ${JSON.stringify(data)};`)
  .replace('/*BOARD_JS*/', () => read('board.js'));
writeFileSync(new URL('../hero-board.html', here), html);
console.log('hero-board.html', html.length, 'bytes;', events.length, 'checks,', dots.length, 'dots');
