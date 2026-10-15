/**
 * The arrivals board: the newest checks of public records (GET /api/activity), drawn like a
 * station's departure board. It rolls one line at a time, unless the reader asks for less motion.
 * Every line is a record that is public now; nothing pending ever reaches it (src/shared/activity.ts),
 * and checks of one place made together share a line. Beside the map it fills the column with as
 * many lines as fit.
 *
 * It is never an empty panel or a count of zero. With no checks to show it lists the places whose
 * public page changed last (the index's own times, never who checked them); while the data loads,
 * grey lines of the same height; and when nothing has been checked yet today its foot says how long
 * ago the last check was.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { boardRows, checkedToday, londonDay, recentlyUpdated, type Activity, type BoardRow } from '../../shared/activity';
import { standardDish } from '../../shared/dish';
import type { Copy, Locale } from '../../shared/i18n';
import type { IndexEntry } from '../../shared/place-doc';
import { prefersReducedMotion, useMediaQuery } from '../hooks';
import { useCopy, useLocale } from '../i18n';
import { placeNames } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';

const ROW = 38;
/** Lines the board shows on its own (a phone, a narrow window), and at most beside the map. */
const SHOWN = 4;
const MOST = 8;
/** The dot blinks while the newest check is younger than this. */
const LIVE_MS = 60 * 60_000;
/** Where the hero stands beside the map (styles.css, .front-hero). */
const BESIDE_MAP = '(min-width: 1081px)';

const TYPE_COLOR: Record<BoardRow['type'], string> = {
  place: 'var(--board-new)',
  menu: 'var(--amber)',
  quote: 'var(--line-boba)',
  art: 'var(--board-art)',
  photo: 'var(--board-photo)',
};

/** A line as the board draws it, whether it is a check or a page that changed. */
interface Line {
  key: string;
  at: string;
  label: string;
  /** The label's colour; none for a page that changed, which wears the board's plainest. */
  color: string | null;
  main: string;
  sub: string;
  where: string | null;
  href: string | null;
}

const minutesSince = (at: string, now: number) => Math.max(0, Math.round((now - Date.parse(at)) / 60_000));

/** How long ago, as a board says it: now, 4 min, 1 hr, 2 d. */
function ago(at: string, now: number, copy: Copy): string {
  const minutes = minutesSince(at, now);
  if (minutes < 1) return copy.live.now;
  if (minutes < 60) return copy.live.minutes(minutes);
  if (minutes < 48 * 60) return copy.live.hours(Math.round(minutes / 60));
  return copy.live.days(Math.round(minutes / 1440));
}

function checkLine(row: BoardRow, copy: Copy, locale: Locale): Line {
  const base = { key: row.id, at: row.at, label: copy.live.types[row.type], color: TYPE_COLOR[row.type] };
  if (row.type === 'art') {
    const dish = row.dish ? standardDish(row.dish) : undefined;
    return { ...base, main: (locale === 'zh' ? dish?.zh : dish?.en) ?? row.dish ?? '', sub: copy.live.what.art, where: null, href: row.dish ? paths.dish(locale, row.dish) : null };
  }
  const what = copy.live.what;
  const sub =
    row.type === 'menu'
      ? what.menu(row.items ?? 0, row.count)
      : row.type === 'quote'
        ? what.quote(row.quote?.publication ?? '', row.count)
        : row.type === 'photo'
          ? row.first && row.count === 1
            ? what.firstPhoto
            : what.photo(row.count)
          : what.place;
  const names = row.place ? placeNames({ en: row.place.n, zh: row.place.z }, locale) : { main: '' };
  return { ...base, main: names.main, sub, where: row.place?.o ?? null, href: row.place ? paths.place(locale, row.place.id, row.place.s) : null };
}

const updateLine = (entry: IndexEntry, copy: Copy, locale: Locale): Line => ({
  key: entry.id,
  at: entry.u,
  label: copy.live.types.update,
  color: null,
  main: placeNames({ en: entry.n, zh: entry.z }, locale).main,
  sub: copy.live.what.update,
  where: entry.o,
  href: paths.place(locale, entry.id, entry.s),
});

export function LiveBoard({ activity, failed, places }: { activity: Activity | null; failed: boolean; places: readonly IndexEntry[] | null }) {
  const copy = useCopy();
  const locale = useLocale();
  const beside = useMediaQuery(BESIDE_MAP);
  const [now, setNow] = useState(() => Date.now());
  const checks = useMemo(() => boardRows(activity?.events ?? []), [activity]);
  const updated = useMemo(() => (places ? recentlyUpdated(places) : []), [places]);
  // Checks when there are any; once there are known to be none (or they could not be had), the
  // pages that changed last; grey lines until then.
  const mode = checks.length > 0 ? 'checks' : (activity || failed) && places ? 'updates' : 'waiting';
  const lines = useMemo(
    () => (mode === 'checks' ? checks.map((row) => checkLine(row, copy, locale)) : mode === 'updates' ? updated.map((entry) => updateLine(entry, copy, locale)) : []),
    [mode, checks, updated, copy, locale],
  );
  const today = londonDay(new Date(now).toISOString());
  const counts = useMemo(
    () => ({
      open: places?.filter((entry) => entry.t === 'open').length ?? 0,
      updatedToday: places?.filter((entry) => entry.t !== 'closed' && londonDay(entry.u) === today).length ?? 0,
    }),
    [places, today],
  );

  // Beside the map, the lines fill the board: as many as its height holds, each a little taller so
  // none is cut. Elsewhere, four.
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!beside || !element) return;
    const observer = new ResizeObserver(() => setRoom(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [beside, mode]);
  const filling = beside && room > 0;
  const fit = filling ? Math.max(SHOWN, Math.min(MOST, Math.floor(room / ROW))) : SHOWN;
  const height = filling ? room / fit : ROW;

  const rolls = lines.length > fit && !prefersReducedMotion();
  const [pos, setPos] = useState(0);
  const [snap, setSnap] = useState(false);
  useEffect(() => {
    setSnap(true);
    setPos(0);
  }, [lines, fit]);
  useEffect(() => {
    if (!rolls) return;
    const timer = window.setInterval(() => {
      setSnap(false);
      setPos((previous) => previous + 1);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [rolls]);
  // The times move on while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const still = mode !== 'checks' || now - Date.parse(checks[0]!.at) > LIVE_MS;
  const title = mode === 'updates' ? copy.live.recentTitle : copy.live.title;
  // The first lines come again after the last, so the roll back to the top is a jump nobody sees.
  const shown = rolls ? [...lines, ...lines.slice(0, fit)] : lines.slice(0, fit);

  let foot: ReactNode = null;
  if (mode === 'waiting') foot = <span className="skel" />;
  else if (mode === 'checks') {
    const day = activity ? checkedToday(activity, new Date(now)) : null;
    foot = <span>{day ? copy.live.today(day.checked, day.agents) : copy.live.quiet(copy.live.ago(minutesSince(checks[0]!.at, now)))}</span>;
  } else if (updated.length > 0) {
    foot = (
      <>
        <span>{counts.updatedToday ? copy.live.updatedToday(counts.updatedToday) : copy.live.lastUpdate(copy.live.ago(minutesSince(updated[0]!.u, now)))}</span>
        <span>{copy.live.open(counts.open)}</span>
      </>
    );
  }

  const style = { '--row': `${height}px` } as CSSProperties;
  return (
    <section className="live-board" aria-label={title} aria-busy={mode === 'waiting'} style={style}>
      <header>
        <span className={`live-dot${still ? ' still' : ''}`} aria-hidden="true" />
        <b>{title}</b>
        <span className="live-only">{copy.live.only}</span>
      </header>
      {mode === 'updates' && lines.length === 0 ? (
        <p className="live-empty">{copy.live.empty}</p>
      ) : (
        <div className="live-rows" ref={box} style={beside ? undefined : { height: (mode === 'waiting' ? fit : Math.min(fit, lines.length)) * ROW }}>
          <div
            className="live-track"
            style={{ transform: `translateY(-${pos * height}px)`, transition: snap ? 'none' : undefined }}
            onTransitionEnd={() => {
              if (pos >= lines.length) {
                setSnap(true);
                setPos(0);
              }
            }}
          >
            {mode === 'waiting'
              ? Array.from({ length: fit }, (_, i) => (
                  <div key={i} className="live-row skel" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                ))
              : shown.map((line, i) => {
                  const body = (
                    <>
                      <time dateTime={line.at}>{ago(line.at, now, copy)}</time>
                      <em className={`live-kind${line.color ? '' : ' update'}`} style={line.color ? ({ '--c': line.color } as CSSProperties) : undefined}>
                        {line.label}
                      </em>
                      <span className="live-text">
                        {line.main} <small>{line.sub}</small>
                      </span>
                      <span className="live-where">{line.where ?? '··'}</span>
                    </>
                  );
                  return line.href ? (
                    <Link key={`${line.key}-${i}`} className="live-row" href={line.href} tabIndex={i >= lines.length ? -1 : undefined}>
                      {body}
                    </Link>
                  ) : (
                    <div key={`${line.key}-${i}`} className="live-row">
                      {body}
                    </div>
                  );
                })}
          </div>
        </div>
      )}
      {foot ? <footer>{foot}</footer> : null}
    </section>
  );
}
