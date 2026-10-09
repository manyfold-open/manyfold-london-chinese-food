/**
 * A small router over the History API. Paths here are the app's own (/zh/place/...): the mount
 * the site is served under (app.manyfold.ai/london-chinese-food) is added by appUrl on the way to
 * the address bar and taken off by appPath on the way back (src/app/base.ts).
 *
 * Coming back to a page finds it as the reader left it. Every history entry carries a key; when
 * the reader leaves an entry, where the page was scrolled to is kept under its key, next to any
 * state the page keeps there (useEntryState), for the tab's session (sessionStorage, so a reload
 * keeps them too). Back and Forward restore both. A link to the page the reader came from goes
 * back to it the same way; any other link opens a page fresh, at the top.
 */

import { useCallback, useEffect, useLayoutEffect, useState, type AnchorHTMLAttributes, type Dispatch, type MouseEvent, type SetStateAction } from 'react';
import { appPath, appUrl } from './base';

const CHANGE = 'lcf:navigate';
const ENTRIES = 'lcf.entries';
/** Browsers keep about 50 entries of a tab's history: older ones cannot be gone back to. */
const KEEP = 50;
/** How long a restore waits for the page to grow tall enough, e.g. for its data after a reload. */
const WAIT_MS = 3000;

/** What history.state holds for every entry this router makes. */
interface Mark {
  key: string;
  /** The address of the entry this one was opened from. */
  from?: string;
}

interface Kept {
  y?: number;
  state?: Record<string, unknown>;
}

const kept: Record<string, Kept> = (() => {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(ENTRIES) ?? '{}');
    return stored && typeof stored === 'object' ? (stored as Record<string, Kept>) : {};
  } catch {
    return {};
  }
})();

const newKey = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const address = () => location.pathname + location.search;
const mark = (): Mark | null => {
  const state = history.state as Partial<Mark> | null;
  return state && typeof state.key === 'string' ? (state as Mark) : null;
};

// The browser would restore a position before the page under it is drawn again: this file does it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
let key = mark()?.key ?? newKey();
if (!mark()) history.replaceState({ key } satisfies Mark, '');

/** Where to scroll once the page is drawn: set by Back and Forward and by a reload, cleared by a link. */
let restoreTo: number | null = (() => {
  const timing = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return timing?.type === 'reload' || timing?.type === 'back_forward' ? (kept[key]?.y ?? null) : null;
})();

const leave = () => {
  const entry = kept[key] ?? {};
  // Kept again last, so trimming drops the entries left longest ago.
  delete kept[key];
  kept[key] = { ...entry, y: Math.round(window.scrollY) };
};

function persist(): void {
  leave();
  const keys = Object.keys(kept);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) delete kept[old];
  try {
    sessionStorage.setItem(ENTRIES, JSON.stringify(kept));
  } catch {
    // storage full or blocked: coming back still works until the page is reloaded
  }
}

// Registered before any component listens, so the page being left is measured before it changes.
window.addEventListener('popstate', () => {
  leave();
  key = mark()?.key ?? newKey();
  if (!mark()) history.replaceState({ key } satisfies Mark, '');
  restoreTo = kept[key]?.y ?? 0;
});
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});

const current = () => ({ pathname: appPath(location.pathname), search: location.search, key });

/** The app's path and query, and the key of the history entry, updated on every navigation. */
export function useLocation(): { pathname: string; search: string; key: string } {
  const [state, setState] = useState(current);
  useEffect(() => {
    const update = () => setState(current());
    window.addEventListener('popstate', update);
    window.addEventListener(CHANGE, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(CHANGE, update);
    };
  }, []);
  return state;
}

/** Go to an app path. A new path scrolls to the top; a new query alone does not. */
export function navigate(href: string, options: { replace?: boolean } = {}): void {
  const target = new URL(appUrl(href), location.href);
  const to = target.pathname + target.search;
  if (to === address()) return;
  const samePath = target.pathname === location.pathname;
  if (options.replace) {
    history.replaceState({ ...mark(), key } satisfies Mark, '', to);
  } else if (!samePath && mark()?.from === to) {
    // Back to the page the reader came from, so it is as they left it.
    history.back();
    return;
  } else {
    leave();
    const from = address();
    key = newKey();
    history.pushState({ key, from } satisfies Mark, '', to);
  }
  restoreTo = null;
  window.dispatchEvent(new Event(CHANGE));
  if (!samePath) window.scrollTo(0, 0);
}

/**
 * After Back, Forward or a reload, scrolls to where the reader left the page, as soon as it is
 * drawn tall enough: at once when its data is at hand, else when the data arrives, for a few
 * seconds. The reader scrolling first wins. App calls it once, with the entry's key.
 */
export function useScrollRestoration(entry: string): void {
  useLayoutEffect(() => {
    const y = restoreTo;
    if (y === null) return;
    const reached = () => document.documentElement.scrollHeight - window.innerHeight >= y;
    const done = () => {
      restoreTo = null;
      stop();
    };
    const observer = new ResizeObserver(() => {
      if (!reached()) return;
      window.scrollTo(0, y);
      done();
    });
    const timer = window.setTimeout(done, WAIT_MS);
    const inputs = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    function stop() {
      observer.disconnect();
      window.clearTimeout(timer);
      for (const type of inputs) window.removeEventListener(type, done);
    }
    if (reached()) {
      window.scrollTo(0, y);
      done();
      return;
    }
    observer.observe(document.body);
    for (const type of inputs) window.addEventListener(type, done, { passive: true });
    // Left unfinished, e.g. by React mounting twice in development: the next run picks it up.
    return stop;
  }, [entry]);
}

/**
 * State a page keeps in its history entry, so Back and Forward return to it as it was left.
 * `read` gets what the entry kept, if anything, and returns the state to start from: it must
 * check it, since a reload brings it back from storage. A page that stays on screen while the
 * entry changes (the same page in the other language) keeps its state into the new entry.
 */
export function useEntryState<T>(name: string, read: (stored: unknown) => T): [T, Dispatch<SetStateAction<T>>] {
  const { key: entry } = useLocation();
  const [held, setHeld] = useState(() => ({ entry, value: read(kept[entry]?.state?.[name]) }));
  let current = held;
  if (held.entry !== entry) {
    const stored = kept[entry]?.state?.[name];
    current = { entry, value: stored === undefined ? held.value : read(stored) };
    setHeld(current);
  }
  useEffect(() => {
    ((kept[current.entry] ??= {}).state ??= {})[name] = current.value;
  }, [current.entry, current.value, name]);
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setHeld((previous) => ({ entry: previous.entry, value: typeof next === 'function' ? (next as (value: T) => T)(previous.value) : next })),
    [],
  );
  return [current.value, set];
}

/** An <a> to an app path that navigates in place, unless the reader asked for a new tab or window. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={appUrl(href)} onClick={handle} {...rest} />;
}
