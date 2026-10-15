/**
 * Light or dark. The page follows the system until the reader picks one with the toggle;
 * the pick is kept in this browser only (see /privacy). index.html applies a stored pick
 * before the first paint, so the page never flashes the other theme.
 */

import { useCallback, useSyncExternalStore } from 'react';

export const THEME_KEY = 'lcf.theme';

export type Theme = 'light' | 'dark';

/** The theme this browser picked, if it picked one. */
export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // storage blocked: follow the system
  }
}

const DARK = '(prefers-color-scheme: dark)';
const CHANGE = 'manyfold:theme';

const current = (): Theme => {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia(DARK).matches ? 'dark' : 'light';
};

const subscribe = (onChange: () => void) => {
  const list = window.matchMedia(DARK);
  list.addEventListener('change', onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    list.removeEventListener('change', onChange);
    window.removeEventListener(CHANGE, onChange);
  };
};

/** The browser's own bars (Safari's, Chrome on Android) in the page's background. */
const BARS: Record<Theme, string> = { light: '#faf7f0', dark: '#11141c' };

/** Shows a theme now and keeps it for next time, even if the browser refuses to store it. */
export function setTheme(theme: Theme): void {
  const apply = () => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('meta[name="theme-color"]').forEach((bar) => bar.setAttribute('content', BARS[theme]));
  };
  // The page crossfades from one theme to the other where the browser can, rather than cutting.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !still) document.startViewTransition(apply);
  else apply();
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* see storedTheme */
  }
  window.dispatchEvent(new Event(CHANGE));
}

/** The theme on screen and a function that switches to the other one. */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme);
  const toggle = useCallback(() => setTheme(current() === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle];
}
