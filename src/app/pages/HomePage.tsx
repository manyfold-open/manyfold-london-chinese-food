/**
 * The front page: London's Chinese food as a city guide, drawn like the Underground. A search, the
 * arrivals board of checks happening now, the eight lines, a dish of the day with every menu price
 * for it, the places near each campus, what writers said, the guides, the campaign for real photos,
 * and the agents at work. Every number is counted from the index or the API as it stands: none is
 * made up, and nothing is ranked by how good anyone says it is (AGENTS.md, invariant 17).
 */

import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import type { ActivityEvent } from '../../shared/activity';
import { CAMPUSES, placesNear } from '../../shared/campuses';
import { dishOfDay } from '../../shared/day-dish';
import { standardDish } from '../../shared/dish';
import { GUIDES, inGuide, type Guide } from '../../shared/guides';
import { lineCounts } from '../../shared/lines';
import type { IndexEntry } from '../../shared/place-doc';
import { DishImage } from '../components/DishImage';
import { CENTRAL, CityMap, LONDON, type Marker } from '../components/CityMap';
import { lineColor, LineLegend, lineVars, TubeMap } from '../components/Lines';
import { LiveBoard } from '../components/LiveBoard';
import { PricePlot, priceStats } from '../components/PricePlot';
import { useActivity, useCrew, useDish, useIllustrations, useIndex } from '../data';
import { price } from '../format';
import { useCopy, useLocale } from '../i18n';
import { placeNames } from '../labels';
import { Link, navigate } from '../router';
import { paths } from '../routes';
import { Icon, Skeleton } from '../ui';

/** The guide each quick link opens. */
const CHIP_GUIDES = { tenner: 'full-for-a-tenner', home: 'taste-of-home-north', boba: 'bubble-tea-run', hotpot: 'hotpot-night' } as const;

const big = (count: number, locale: 'zh' | 'en') =>
  locale === 'zh' ? (count >= 10_000 ? `${Math.round(count / 10_000)} 万` : count.toLocaleString('en-GB')) : count >= 10_000 ? `${Math.round(count / 1000)}k` : count.toLocaleString('en-GB');

export function HomePage() {
  const copy = useCopy();
  const locale = useLocale();
  const index = useIndex();
  const activity = useActivity();
  const places = useMemo(() => index.data?.places ?? [], [index.data]);
  const open = useMemo(() => places.filter((entry) => entry.t === 'open'), [places]);
  const counts = useMemo(() => lineCounts(places), [places]);
  const chinatown = useMemo(() => open.filter((entry) => entry.o === 'W1D' || entry.o === 'WC2H').length, [open]);
  const [q, setQ] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(`${paths.map(locale)}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  };

  const campusMarkers = useMemo<Marker[]>(
    () => [
      ...CAMPUSES.filter((campus) => ['ucl', 'imperial', 'qmul'].includes(campus.id)).map((campus) => ({
        lat: campus.lat,
        lng: campus.lng,
        kind: 'uni' as const,
        label: campus.short,
        sub: placesNear(open, campus).length,
        href: paths.near(locale, campus.id),
        shift: campus.id === 'ucl' ? '-20% -150%' : campus.id === 'imperial' ? '-90% 40%' : undefined,
      })),
      { lat: 51.5115, lng: -0.131, kind: 'hub' as const, label: copy.lines.hub, sub: chinatown, href: paths.guide(locale, 'chinatown-by-dish'), shift: '-108% 30%' },
    ],
    [open, locale, copy, chinatown],
  );

  return (
    <div className="front screen">
      <section className="front-hero">
        <div className="front-hero-main">
          {index.data ? (
            <p className="kicker">
              <span>
                <b>{open.length.toLocaleString('en-GB')}</b> {copy.front.kicker.open}
              </span>
              <span>
                <b>{big(places.reduce((sum, entry) => sum + entry.r, 0), locale)}</b> {copy.front.kicker.quotes}
              </span>
              <span>
                <b>{big(places.reduce((sum, entry) => sum + entry.m, 0), locale)}</b> {copy.front.kicker.dishes}
              </span>
            </p>
          ) : (
            <Skeleton height={18} width="60%" />
          )}
          <h1 className="front-title">
            {copy.front.hero.before}
            <br />
            {copy.front.hero.eat}
            <Rotator words={copy.front.hero.words} />
            {copy.front.hero.after}
          </h1>
          <form className="front-search" role="search" onSubmit={submit}>
            <Icon name="search" size={20} />
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder={copy.front.search} aria-label={copy.home.searchLabel} enterKeyHint="search" />
            <button type="submit">{copy.front.go}</button>
          </form>
          <div className="front-chips">
            <Link className="chip-link" href={paths.near(locale, 'ucl')} style={{ '--c': lineColor('grocery') } as CSSProperties}>
              <i />
              {copy.front.chips.near('UCL')}
            </Link>
            {(['tenner', 'home', 'boba', 'hotpot'] as const).map((key) => {
              const guide = GUIDES.find((g) => g.slug === CHIP_GUIDES[key])!;
              return (
                <Link key={key} className="chip-link" href={paths.guide(locale, guide.slug)} style={{ '--c': lineColor(guide.line) } as CSSProperties}>
                  <i />
                  {copy.front.chips[key]}
                </Link>
              );
            })}
          </div>
          <LiveBoard activity={activity.data} failed={activity.error !== null} places={index.data?.places ?? null} />
        </div>
        <div className="front-map">
          <CityMap entries={places} tone="line" bounds={CENTRAL} fit="cover" markers={campusMarkers} label={copy.nav.map} />
          <LineLegend counts={counts} variant="map" />
          <Link className="front-map-open" href={paths.map(locale)}>
            <Icon name="map" size={16} /> {copy.nav.map}
          </Link>
        </div>
      </section>

      <section className="front-section">
        <div className="section-head">
          <h2>{copy.lines.title}</h2>
          <span className="section-tag">{copy.lines.tag}</span>
          <p className="section-lead">{copy.lines.lead}</p>
        </div>
        <div className="tube-card tube-phone">
          <TubeMap counts={counts} hubCount={chinatown} />
        </div>
        <div className="tube-card tube-wide">
          <TubeMap counts={counts} hubCount={chinatown} wide />
        </div>
        <LineLegend counts={counts} />
      </section>

      <div className="front-pair">
        <DayDish index={places} />
        <Campuses entries={open} />
      </div>

      <Quotes events={activity.data?.events ?? []} total={places.reduce((sum, entry) => sum + entry.r, 0)} />

      <Guides entries={places} />

      <LightUp entries={places} />

      <Crew />
    </div>
  );
}

/** The headline's dish, turning over every few seconds; still when the reader asks for less motion. */
function Rotator({ words }: { words: string[] }) {
  return (
    <span className="rotator" aria-label={words[0]}>
      <span className="rotator-track" aria-hidden="true">
        {[...words, words[0]].map((word, i) => (
          <span key={i}>{word}</span>
        ))}
      </span>
    </span>
  );
}

function DayDish({ index }: { index: readonly IndexEntry[] }) {
  const copy = useCopy();
  const locale = useLocale();
  const key = useMemo(() => dishOfDay(new Date()), []);
  const dish = useDish(key);
  const illustrations = useIllustrations();
  const entry = standardDish(key);
  const name = (locale === 'zh' ? entry?.zh : entry?.en) ?? key;
  const other = locale === 'zh' ? entry?.en : entry?.zh;
  const rows = useMemo(() => {
    const byId = new Map(index.map((place) => [place.id, place]));
    const seen = new Map<string, { place: IndexEntry; pence: number | null }>();
    for (const row of dish.data?.places ?? []) {
      const place = byId.get(row.place_id);
      if (!place || place.t === 'closed') continue;
      const known = seen.get(place.id);
      if (!known || (known.pence === null && row.entry.price_pence !== null)) seen.set(place.id, { place, pence: row.entry.price_pence });
    }
    return [...seen.values()];
  }, [dish.data, index]);
  const prices = rows.flatMap((row) => (row.pence !== null ? [row.pence] : []));
  const stats = priceStats(prices);
  const cheapest = rows.filter((row) => row.pence !== null).sort((a, b) => a.pence! - b.pence!).slice(0, 3);

  return (
    <article className="day-dish">
      <div className="day-dish-pic">
        <DishImage photo={null} dish={key} name={name} illustrations={illustrations.data} size="full" />
      </div>
      <div className="day-dish-body">
        <p className="board-kicker">
          {copy.dayDish.kicker} · {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date())}
        </p>
        <h2 className="day-dish-name">
          <Link href={paths.dish(locale, key)}>{name}</Link>
          {other ? <small>{other}</small> : null}
        </h2>
        {stats ? (
          <>
            <p className="day-dish-lead">{copy.dayDish.lead(rows.length, price(stats.min), price(stats.max), price(stats.median))}</p>
            <PricePlot prices={prices} dark width={400} height={90} />
            <p className="plot-caption">{copy.dayDish.plotCaption(stats.count)}</p>
            <ul className="cheap-list">
              {cheapest.map(({ place, pence }) => (
                <li key={place.id}>
                  <b>{price(pence!)}</b>
                  <Link href={paths.place(locale, place.id, place.s)}>{placeNames({ en: place.n, zh: place.z }, locale).main}</Link>
                  <span>{place.o}</span>
                </li>
              ))}
            </ul>
          </>
        ) : dish.data ? (
          <p className="day-dish-lead">{copy.dish.lead(rows.length)}</p>
        ) : (
          <Skeleton height={120} />
        )}
        <Link className="button-amber" href={paths.dish(locale, key)}>
          {copy.dayDish.seeAll(rows.length)} <Icon name="right" size={16} />
        </Link>
      </div>
    </article>
  );
}

function Campuses({ entries }: { entries: readonly IndexEntry[] }) {
  const copy = useCopy();
  const locale = useLocale();
  const rows = useMemo(
    () =>
      CAMPUSES.map((campus) => {
        const near = placesNear(entries, campus).map((n) => n.entry);
        const restaurants = near.filter((e) => e.c === 'restaurant' || e.c === 'takeaway').length;
        const tea = near.filter((e) => e.c === 'tea-drinks' || e.c === 'bakery-dessert').length;
        return { campus, count: near.length, restaurants, tea, other: near.length - restaurants - tea };
      }).sort((a, b) => b.count - a.count),
    [entries],
  );
  return (
    <section className="campuses">
      <div className="section-head">
        <h2>{copy.near.title}</h2>
        <span className="section-tag">{copy.near.tag}</span>
      </div>
      <div className="campus-list">
        {rows.map(({ campus, count, restaurants, tea, other }) => (
          <Link key={campus.id} className="campus" href={paths.near(locale, campus.id)} style={lineVars(campus.line)}>
            <span className="campus-sign">
              {campus.short}
              <small>{campus.area}</small>
            </span>
            <span className="campus-count">
              <span className="campus-within">{copy.near.within}</span>
              <b>{count}</b>
              <span className="campus-mix">{copy.near.mix(restaurants, tea, other)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Quotes({ events, total }: { events: readonly ActivityEvent[]; total: number }) {
  const copy = useCopy();
  const locale = useLocale();
  const quotes = events.filter((event) => event.type === 'quote' && event.quote && event.place).slice(0, 8);
  if (quotes.length === 0) return null;
  const tones = ['yellow', 'plain', 'ink', 'green', 'pink', 'plain', 'ink', 'yellow'];
  return (
    <section className="front-section">
      <div className="section-head">
        <h2>{copy.quotes.title}</h2>
        <span className="section-tag">{copy.quotes.tag}</span>
      </div>
      <div className="quote-wall">
        {quotes.map((event, i) => {
          const quote = event.quote!;
          const translated = quote.language !== locale && quote.translation !== null;
          const names = placeNames({ en: event.place!.n, zh: event.place!.z }, locale);
          return (
            <Link key={event.id} className={`quote-bubble ${tones[i % tones.length]}${i === 0 ? ' big' : ''}`} href={paths.place(locale, event.place!.id, event.place!.s)}>
              <blockquote lang={translated ? (locale === 'zh' ? 'zh-Hans' : 'en') : quote.language === 'zh' ? 'zh-Hans' : 'en'}>{translated ? quote.translation : quote.excerpt}</blockquote>
              <cite>
                {translated ? <span className="tr">{copy.quotes.translated}</span> : null}
                {quote.publication} · {names.main}
              </cite>
            </Link>
          );
        })}
      </div>
      <p className="section-foot">{copy.quotes.foot(total)}</p>
    </section>
  );
}

/** How many places a guide holds: a route's stops on its first campus, else its filter's places. */
const guideSize = (guide: Guide, entries: readonly IndexEntry[]) => (guide.routes ? Object.keys(guide.routes).length : entries.filter((entry) => inGuide(guide.filter ?? {}, entry)).length);

const GUIDE_DISH: Record<string, string> = { 'full-for-a-tenner': '肉夹馍', 'taste-of-home-north': '油泼面', 'bubble-tea-run': '珍珠奶茶', 'hotpot-night': '麻辣烫' };

function Guides({ entries }: { entries: readonly IndexEntry[] }) {
  const copy = useCopy();
  const locale = useLocale();
  const illustrations = useIllustrations();
  const [first, ...rest] = GUIDES;
  const featured = rest.filter((guide) => GUIDE_DISH[guide.slug]).slice(0, 2);
  const listed = rest.filter((guide) => !featured.includes(guide));
  const art = (slug: string) => {
    const dish = GUIDE_DISH[slug];
    return dish ? <DishImage photo={null} dish={dish} name={standardDish(dish)?.[locale] ?? dish} illustrations={illustrations.data} size="full" /> : null;
  };
  if (!first) return null;
  return (
    <section className="front-section">
      <div className="section-head">
        <h2>{copy.guides.title}</h2>
        <Link className="section-more" href={paths.guides(locale)}>
          {copy.guides.all(GUIDES.length)} <Icon name="right" size={15} />
        </Link>
      </div>
      <div className="guide-grid">
        <Link className="guide-cover" href={paths.guide(locale, first.slug)} style={lineVars(first.line)}>
          <span className="guide-tag">
            {first.tag[locale]} · {copy.guides.issue(first.issue)}
          </span>
          <b>{first.title[locale]}</b>
          <span className="guide-dek">{first.dek[locale]}</span>
          <span className="guide-plate">{art(first.slug)}</span>
        </Link>
        {featured.map((guide) => (
          <Link key={guide.slug} className="guide-card" href={paths.guide(locale, guide.slug)} style={lineVars(guide.line)}>
            <span className="guide-card-pic">{art(guide.slug)}</span>
            <span className="guide-card-text">
              <b>{guide.title[locale]}</b>
              <span>{copy.guides.places(guideSize(guide, entries))}</span>
            </span>
          </Link>
        ))}
        <ul className="guide-list">
          {listed.map((guide) => (
            <li key={guide.slug} style={{ '--c': lineColor(guide.line) } as CSSProperties}>
              <Link href={paths.guide(locale, guide.slug)}>
                <i />
                <b>{guide.title[locale]}</b>
                <span>{guide.routes ? copy.guides.campuses(Object.keys(guide.routes).length) : copy.guides.places(guideSize(guide, entries))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LightUp({ entries, page = false }: { entries: readonly IndexEntry[]; page?: boolean }) {
  const copy = useCopy();
  const locale = useLocale();
  const open = entries.filter((entry) => entry.t === 'open');
  const lit = open.filter((entry) => entry.p > 0).length;
  const share = open.length ? Math.max(0.6, (lit / open.length) * 100) : 0;
  return (
    <section className={`light-up${page ? ' page' : ''}`}>
      <div className="light-up-text">
        <p className="board-kicker">{copy.lightUp.kicker}</p>
        <h2 className="light-up-title">{copy.lightUp.title(open.length, lit)}</h2>
        <p>{copy.lightUp.text}</p>
        <div className="light-up-progress">
          <span>{copy.lightUp.progress(lit, open.length)}</span>
        </div>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={open.length} aria-valuenow={lit}>
          <i style={{ width: `${share}%` }} />
        </div>
        {page ? null : (
          <div className="light-up-acts">
            <Link className="button-red" href={paths.lightUp(locale)}>
              <Icon name="camera" size={18} /> {copy.lightUp.upload}
            </Link>
          </div>
        )}
        <p className="fine">{copy.lightUp.fine}</p>
      </div>
      <CityMap entries={entries} tone="mono" bounds={LONDON} lit dark label={copy.nav.lightUp} className="light-up-map" />
    </section>
  );
}

function Crew() {
  const copy = useCopy();
  const locale = useLocale();
  const crew = useCrew();
  const members = (crew.data?.crew ?? []).slice(0, 6);
  if (members.length === 0) return null;
  return (
    <section className="front-section">
      <div className="section-head">
        <h2>{copy.crew.title}</h2>
        <span className="section-tag">{copy.crew.tag}</span>
        <p className="section-lead">{copy.crew.lead}</p>
      </div>
      <div className="crew">
        {members.map((member) => (
          <div key={member.label} className="agent">
            <span className={`agent-face ${member.role}`} aria-hidden="true">
              {member.role === 'collector' ? '采' : '核'}
            </span>
            <span>
              <b className="agent-name">{member.label}</b>
              <span className="agent-role">
                {copy.crew.roles[member.role]} · {copy.crew.count(member.role, member.count)}
              </span>
            </span>
          </div>
        ))}
        <Link className="crew-join" href={paths.page(locale, 'contribute')}>
          <b>{copy.crew.join}</b>
          <code>{copy.crew.joinSub}</code>
        </Link>
      </div>
    </section>
  );
}
