/**
 * Where the site is mounted, without a trailing slash: '' at the root of its own
 * host (tarot.manyfold.ai, local dev), '/tarot' under app.manyfold.ai/tarot.
 *
 * The Worker says so in a <meta name="app-base"> it writes into the page when —
 * and only when — the page was asked for under the prefix (src/worker/mount.ts).
 * It is read rather than guessed from the URL because the URL cannot say where
 * the mount ends: /tarot/s/abc and /tarot/anything both have to come out as
 * '/tarot'. Pages never pushState to another page, so reading it once is enough.
 */

export const baseFrom = (doc: Document): string =>
  doc.querySelector<HTMLMetaElement>('meta[name="app-base"]')?.content ?? '';

export const BASE = baseFrom(document);

/** An in-app absolute path ('/api/state', '/privacy') as the browser must ask for it. */
export const appUrl = (path: string): string => BASE + path;

/** The page's own path with the mount taken off: what the router matches on. */
export const appPath = (pathname = location.pathname): string =>
  (pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname) || '/';
