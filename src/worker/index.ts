/**
 * The Worker: the API under /api, the media, the generated files, and the single-page app
 * for everything else. It is served at app.manyfold.ai/london-chinese-food (BASE_PATH) and at
 * the root of its workers.dev host; src/worker/mount.ts is the one place that knows the
 * prefix, so every route below is written as if the site were at the root.
 *
 * A cron trigger runs the housekeeping every five minutes.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isDailyLimit } from './cache';
import { ensureSchema } from './db';
import { withMount } from './mount';
import { HttpError, type Env } from './types';

const SERVICE = 'manyfold-london-chinese-food';

const app = new Hono<{ Bindings: Env }>();

const openCors = cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] });
app.use('/api/*', (c, next) => (c.req.path.startsWith('/api/admin/') ? next() : openCors(c, next)));

app.use('/api/*', async (c, next) => {
  if (c.req.path !== '/api/health') await ensureSchema(c.env.DB);
  await next();
});

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400, error.headers);
  }
  if (isDailyLimit(error)) {
    console.error('d1 daily limit', error);
    return c.json({ error: { code: 'over_daily_limit', message: 'The database has used its reads for today.' } }, 503);
  }
  console.error('unhandled', error);
  return c.json({ error: { code: 'internal', message: 'Something went wrong.' } }, 500);
});

/** The site's public address, or null when it is not configured (local development). */
const publicUrlOf = (env: Env): URL | null => {
  try {
    return env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : null;
  } catch {
    return null;
  }
};

/** Whether this request came to the host whose pages may be indexed. */
export const onPublicHost = (env: Env, url: URL): boolean => publicUrlOf(env)?.host === url.host;

app.get('/api/health', (c) => c.json({ status: 'ok', service: SERVICE, time: new Date().toISOString() }));

/**
 * The robots.txt of the whole public host. app.manyfold.ai has no origin of its own at its root,
 * and a robots.txt that fails tells search engines to crawl nothing there, so this Worker owns the
 * exact route. Any other host (workers.dev, local) is kept out of search results.
 */
app.get('/robots.txt', (c) => {
  const url = new URL(c.req.url);
  const site = publicUrlOf(c.env);
  const body = onPublicHost(c.env, url) && site
    ? `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}${site.pathname.replace(/\/+$/, '')}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
  return c.text(body, 200, { 'cache-control': 'public, max-age=3600' });
});

app.all('/api/*', () => {
  throw new HttpError(404, 'not_found', 'No such API route.');
});

// Anything else is a page of the single-page app, or a static file.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { app };

export default {
  fetch: withMount<Env>(app.fetch),
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB));
  },
} satisfies ExportedHandler<Env>;
