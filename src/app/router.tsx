/**
 * A small router over the History API. Paths here are the app's own (/zh/place/...): the mount
 * the site is served under (app.manyfold.ai/london-chinese-food) is added by appUrl on the way to
 * the address bar and taken off by appPath on the way back (src/app/base.ts).
 */

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { appPath, appUrl } from './base';

const CHANGE = 'lcf:navigate';

const current = () => ({ pathname: appPath(location.pathname), search: location.search });

/** The app's path and query, updated on every navigation and on back/forward. */
export function useLocation(): { pathname: string; search: string } {
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
  if (target.pathname === location.pathname && target.search === location.search) return;
  const samePath = target.pathname === location.pathname;
  history[options.replace ? 'replaceState' : 'pushState'](null, '', target.pathname + target.search);
  window.dispatchEvent(new Event(CHANGE));
  if (!samePath) window.scrollTo(0, 0);
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
