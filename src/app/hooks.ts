/** Small browser hooks the pages share. */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pageView } from './analytics';
import { useLocation } from './router';

/** Whether a media query matches now, kept current. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** The phone layout: the width styles.css switches at. */
export const PHONE = '(max-width: 767px)';
export const useIsPhone = (): boolean => useMediaQuery(PHONE);

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The tab's title, once the page knows it: the one the Worker wrote into the page first opened
 * (src/shared/titles.ts), kept current as the reader moves between pages in place. Naming the
 * page is also when it counts as viewed (src/app/analytics.ts).
 */
export function useTitle(title: string | null): void {
  const { key } = useLocation();
  useEffect(() => {
    if (!title) return;
    document.title = title;
    pageView(key, title);
  }, [title, key]);
}
