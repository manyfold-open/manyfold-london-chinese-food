/**
 * Public reads, cached at the edge for a short while, so a busy page costs D1 one read a
 * window per data center rather than one per view.
 *
 * app.manyfold.ai is shared with other apps, and inside the Worker every path has its mount
 * taken off (src/worker/mount.ts): /api/index here could be another app's /api/index. So the
 * cache is this site's own named cache, and each entry is keyed by the address the visitor
 * actually used, mount and query included.
 *
 * Only public, token-free GETs go through here, and only 200 answers are kept. The admin
 * console, agents' routes and anything that reads a token are never cached.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { publicUrl } from './mount';
import type { Env } from './types';

const CACHE_NAME = 'london-chinese-food';

/** This site's cache, or null where there is none (tests, some local runtimes). */
async function edgeCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** The key a request is cached under: its public address, mount included. */
export function cacheKeyOf(c: Context): string {
  const url = new URL(c.req.url);
  return publicUrl(c, `${url.pathname}${url.search}`);
}

function keep(c: Context, put: Promise<void>): Promise<void> | void {
  try {
    c.executionCtx.waitUntil(put);
  } catch {
    return put; // no execution context (tests): finish the write before answering
  }
}

export function cachedFor(seconds: number): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();
    const cache = await edgeCache();
    if (!cache) return next();

    const key = new Request(cacheKeyOf(c), { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) {
      const answer = new Response(hit.body, hit);
      // A copy served from the cache comes back with the zone's Browser Cache TTL in place of
      // ours; browsers must keep it no longer than the edge does.
      answer.headers.set('cache-control', `public, max-age=${seconds}`);
      answer.headers.set('x-cache', 'hit');
      return answer;
    }

    await next();
    if (c.res.status !== 200) return;
    c.res.headers.set('cache-control', `public, max-age=${seconds}`);
    const copy = c.res.clone();
    const stored = new Response(copy.body, copy);
    stored.headers.delete('vary');
    stored.headers.delete('set-cookie');
    await keep(c, cache.put(key, stored));
  };
}

/**
 * A JSON value cached under `key` (a public URL) for `seconds`: this data center's copy when it
 * has one, else `load()` once and keep it.
 */
export async function cachedJson<T>(c: Context, key: string, seconds: number, load: () => Promise<T>): Promise<T> {
  const cache = await edgeCache();
  const request = new Request(key, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return (await hit.json()) as T;
  }
  const value = await load();
  if (cache) {
    const response = new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${seconds}` },
    });
    await keep(c, cache.put(request, response));
  }
  return value;
}

/** Drops cached copies of public URLs at once, e.g. a photo taken down. Other data centers age out. */
export async function forget(urls: readonly string[]): Promise<void> {
  const cache = await edgeCache();
  if (!cache) return;
  await Promise.all(urls.map((url) => cache.delete(new Request(url, { method: 'GET' }))));
}

/**
 * Whether an error is D1 refusing work for the day (the free tier's daily limits, for forks that
 * run on it). Reads come back at midnight UTC, so the caller can say so.
 */
export const isDailyLimit = (error: unknown): boolean =>
  /D1_ERROR/.test(String(error)) && /daily .*limit/i.test(String(error));
