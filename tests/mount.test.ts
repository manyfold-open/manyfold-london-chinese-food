/**
 * The site under a prefix: app.manyfold.ai/london-chinese-food as well as the root of its
 * workers.dev host. Driven through the real Worker entry with BASE_PATH set the way
 * wrangler.jsonc sets it. What matters: the prefix comes off on the way in, goes back on
 * wherever a root path would reach the browser, and the root is untouched, including by a
 * client that claims a prefix it did not come in under.
 *
 * The HTML rewrite needs HTMLRewriter, which only exists in workerd; its decisions are tested
 * here as plain functions.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/worker/index';
import { isUnder, mountPath, prefixed, shouldRewrite, PREFIX_HEADER } from '../src/worker/mount';
import type { Env } from '../src/worker/types';
import { createD1 } from './d1';

const PUBLIC = 'https://app.manyfold.ai';
const assetPaths: string[] = [];
const seenPrefix: (string | null)[] = [];
let env: Env;

beforeAll(() => {
  env = {
    DB: createD1(),
    ASSETS: {
      fetch: async (request: Request) => {
        assetPaths.push(new URL(request.url).pathname);
        seenPrefix.push(request.headers.get(PREFIX_HEADER));
        return new Response('asset', { status: 200, headers: { 'content-type': 'text/plain' } });
      },
    } as unknown as Fetcher,
    BASE_PATH: '/london-chinese-food',
    PUBLIC_URL: `${PUBLIC}/london-chinese-food`,
  } as Env;
});

afterAll(() => undefined);

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const call = (url: string, headers: Record<string, string> = {}) => worker.fetch(new Request(url, { headers }), env, ctx);

describe('the mount, as plain functions', () => {
  it('reads BASE_PATH as a clean prefix, or none', () => {
    expect(mountPath({ BASE_PATH: '/london-chinese-food/' })).toBe('/london-chinese-food');
    expect(mountPath({ BASE_PATH: '' })).toBe('');
    expect(mountPath({ BASE_PATH: '/bad path"' })).toBe('');
  });

  it('is under the mount only at its own path segments', () => {
    expect(isUnder('/london-chinese-food', '/london-chinese-food')).toBe(true);
    expect(isUnder('/london-chinese-food/api/health', '/london-chinese-food')).toBe(true);
    expect(isUnder('/london-chinese-foodie', '/london-chinese-food')).toBe(false);
    expect(isUnder('/robots.txt', '/london-chinese-food')).toBe(false);
  });

  it('prefixes root paths only', () => {
    expect(prefixed('/assets/a.js', '/london-chinese-food')).toBe('/london-chinese-food/assets/a.js');
    expect(prefixed('//cdn.example/a.js', '/london-chinese-food')).toBe('//cdn.example/a.js');
    expect(prefixed('https://x.example/', '/london-chinese-food')).toBe('https://x.example/');
    expect(prefixed('assets/a.js', '/london-chinese-food')).toBe('assets/a.js');
  });

  it('rewrites HTML pages, the 404 page included, and nothing else', () => {
    expect(shouldRewrite(new Response('', { headers: { 'content-type': 'text/html; charset=utf-8' } }))).toBe(true);
    expect(shouldRewrite(new Response('', { status: 404, headers: { 'content-type': 'text/html' } }))).toBe(true);
    expect(shouldRewrite(new Response('', { status: 500, headers: { 'content-type': 'text/html' } }))).toBe(false);
    expect(shouldRewrite(new Response('', { headers: { 'content-type': 'image/webp' } }))).toBe(false);
  });
});

describe('the Worker under the mount', () => {
  it('answers the health check under the prefix and at the root', async () => {
    const mounted = await call(`${PUBLIC}/london-chinese-food/api/health`);
    expect(mounted.status).toBe(200);
    expect(((await mounted.json()) as { status: string }).status).toBe('ok');
    const root = await call('https://manyfold-london-chinese-food.example.workers.dev/api/health');
    expect(root.status).toBe(200);
  });

  it('sends the bare mount to its slash, keeping the query', async () => {
    const response = await call(`${PUBLIC}/london-chinese-food?ref=x`);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`${PUBLIC}/london-chinese-food/?ref=x`);
  });

  it('serves files from the assets with the prefix taken off, and pages from the app', async () => {
    assetPaths.length = 0;
    seenPrefix.length = 0;
    await call(`${PUBLIC}/london-chinese-food/favicon.svg`);
    expect(assetPaths).toEqual(['/favicon.svg']);
    expect(seenPrefix).toEqual(['/london-chinese-food']);
    assetPaths.length = 0;
    const page = await call(`${PUBLIC}/london-chinese-food/zh/about`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(assetPaths).toEqual(['/']);
  });

  it('sends the root to a language: the cookie first, then the browser', async () => {
    const english = await call(`${PUBLIC}/london-chinese-food/`, { 'accept-language': 'en-GB,en;q=0.9' });
    expect(english.headers.get('location')).toBe(`${PUBLIC}/london-chinese-food/en/`);
    const chosen = await call(`${PUBLIC}/london-chinese-food/`, { 'accept-language': 'en-GB', cookie: 'lcf_locale=zh' });
    expect(chosen.headers.get('location')).toBe(`${PUBLIC}/london-chinese-food/zh/`);
  });

  it('answers 404 for a place that is not public', async () => {
    const response = await call(`${PUBLIC}/london-chinese-food/en/place/rec_00000000000000000000000000/x`);
    expect(response.status).toBe(404);
  });

  it('drops a prefix header a client sends itself', async () => {
    seenPrefix.length = 0;
    await call('https://manyfold-london-chinese-food.example.workers.dev/favicon.svg', { [PREFIX_HEADER]: '/evil' });
    expect(seenPrefix).toEqual([null]);
  });

  it('answers 404 JSON for an unknown API route', async () => {
    const response = await call(`${PUBLIC}/london-chinese-food/api/nothing-here`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });
});

describe('robots.txt', () => {
  it('lets search engines into the public host and points them at the sitemap', async () => {
    const response = await call(`${PUBLIC}/robots.txt`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('Allow: /');
    expect(text).toContain(`Sitemap: ${PUBLIC}/london-chinese-food/sitemap.xml`);
  });

  it('keeps every other host out of search results', async () => {
    const text = await (await call('https://manyfold-london-chinese-food.example.workers.dev/robots.txt')).text();
    expect(text).toContain('Disallow: /');
    expect(text).not.toContain('Sitemap');
  });
});
