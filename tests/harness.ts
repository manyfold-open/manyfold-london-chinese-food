/**
 * What the API tests share: a Worker environment on the node:sqlite D1 double, outside services
 * stubbed (DNS, source pages, postcodes.io), and helpers to join, issue tokens and call routes.
 */

import { vi } from 'vitest';
import { app } from '../src/worker/index';
import type { Env } from '../src/worker/types';
import { createD1 } from './d1';

export const ADMIN = 'correct horse battery staple';
export const SITE = 'https://lcf.test';

/** London postcodes the stub knows, with their borough codes; any other "E" postcode is outside London. */
const LONDON: Record<string, { district: string; code: string; lat: number; lng: number }> = {
  'W1D 6JW': { district: 'Westminster', code: 'E09000033', lat: 51.5115, lng: -0.1316 },
  'W1D 5PG': { district: 'Westminster', code: 'E09000033', lat: 51.5118, lng: -0.1309 },
  'N7 8AB': { district: 'Islington', code: 'E09000019', lat: 51.5555, lng: -0.1155 },
  'E14 5AB': { district: 'Tower Hamlets', code: 'E09000030', lat: 51.5049, lng: -0.0195 },
};
const ELSEWHERE: Record<string, { district: string; code: string }> = {
  'M1 1AA': { district: 'Manchester', code: 'E08000003' },
};

/**
 * A fake image: the bytes "IMG <format> <width> <height>". The fake Images binding reads that
 * header for info(), and its output is "WEBP <width> <height>" scaled down, so a test can tell
 * stored renditions from what was sent.
 */
export const fakeImage = (format: string, width: number, height: number, padding = 0): Blob =>
  new Blob([`IMG ${format} ${width} ${height} `, 'x'.repeat(padding)], { type: format });

const readHeader = async (stream: ReadableStream<Uint8Array>) => (await new Response(stream).text()).split(' ');

export function fakeImages(): ImagesBinding {
  return {
    async info(stream: ReadableStream<Uint8Array>) {
      const [tag, format, width, height] = await readHeader(stream);
      if (tag === 'WEBP') return { format: 'image/webp', fileSize: 10, width: Number(format), height: Number(width) };
      if (tag !== 'IMG') throw new Error('9412: not an image');
      return { format: format!, fileSize: 10, width: Number(width), height: Number(height) };
    },
    input(stream: ReadableStream<Uint8Array>) {
      let box: { width?: number; height?: number } = {};
      const transformer = {
        transform(transform: { width?: number; height?: number }) {
          box = transform;
          return transformer;
        },
        async output(options: { format: string }) {
          const [tag, a, b, c] = await readHeader(stream);
          const [width, height] = tag === 'WEBP' ? [Number(a), Number(b)] : [Number(b), Number(c)];
          const scale = Math.min(1, (box.width ?? width) / Math.max(width, height));
          const body = `${options.format === 'image/jpeg' ? 'JPEG' : 'WEBP'} ${Math.round(width * scale)} ${Math.round(height * scale)}`;
          return {
            image: () => new Blob([body]).stream(),
            response: () => new Response(body, { headers: { 'content-type': options.format } }),
            contentType: () => options.format,
          };
        },
      };
      return transformer;
    },
  } as unknown as ImagesBinding;
}

/** A fake R2 bucket: a map of keys to bytes. */
export function fakeBucket(): R2Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key: string, value: Uint8Array | ArrayBuffer) {
      objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
      return {} as R2Object;
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? ({ body: new Blob([value]).stream() } as unknown as R2ObjectBody) : null;
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  } as unknown as R2Bucket & { objects: Map<string, Uint8Array> };
}

export interface Pages {
  /** Text a source page serves, by URL. Unlisted pages serve "page"; URLs containing /gone are 404. */
  [url: string]: string;
}

export interface World {
  env: Env;
  media: Map<string, Uint8Array>;
  pages: Pages;
  /** When true, postcodes.io does not answer. */
  postcodesDown: boolean;
  call: (path: string, init?: RequestInit & { json?: unknown; token?: string; admin?: boolean }) => Promise<Response>;
  json: <T = Record<string, unknown>>(path: string, init?: RequestInit & { json?: unknown; token?: string; admin?: boolean }) => Promise<{ status: number; body: T }>;
}

export function world(extra: Partial<Env> = {}): World {
  const pages: Pages = {};
  const state = { postcodesDown: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://cloudflare-dns.com/')) return Response.json({ Status: url.includes('missing.invalid') ? 3 : 0 });
      if (url === 'https://api.postcodes.io/postcodes') {
        if (state.postcodesDown) return new Response('down', { status: 503 });
        const { postcodes } = JSON.parse(String(init?.body)) as { postcodes: string[] };
        return Response.json({
          status: 200,
          result: postcodes.map((query) => {
            const london = LONDON[query];
            const other = ELSEWHERE[query];
            const found = london ?? other;
            return {
              query,
              result: found
                ? {
                    postcode: query,
                    outcode: query.split(' ')[0],
                    latitude: london?.lat ?? 53.48,
                    longitude: london?.lng ?? -2.24,
                    admin_district: found.district,
                    codes: { admin_district: found.code },
                  }
                : null,
            };
          }),
        });
      }
      if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        const answer = (init?.body as FormData).get('response');
        return Response.json(answer === 'human' ? { success: true, hostname: 'lcf.test', action: 'photo-upload' } : { success: false });
      }
      if (url.includes('/gone')) return new Response('gone', { status: 404 });
      if (url.includes('/blocked')) return new Response('forbidden', { status: 403 });
      return new Response(pages[url] ?? 'page', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }),
  );
  const bucket = fakeBucket();
  const env = {
    DB: createD1(),
    MEDIA: bucket,
    IMAGES: fakeImages(),
    TURNSTILE_SECRET: 'turnstile-secret',
    ASSETS: { fetch: async () => new Response('asset', { headers: { 'content-type': 'text/plain' } }) } as unknown as Fetcher,
    ADMIN_PASSWORD: ADMIN,
    PUBLIC_URL: SITE,
    BASE_PATH: '',
    ...extra,
  } as Env;
  const call: World['call'] = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    if (init.admin) headers.set('x-admin-password', ADMIN);
    headers.set('cf-connecting-ip', headers.get('cf-connecting-ip') ?? '203.0.113.7');
    return app.request(`${SITE}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body }, env);
  };
  return {
    env,
    media: bucket.objects,
    pages,
    get postcodesDown() {
      return state.postcodesDown;
    },
    set postcodesDown(value: boolean) {
      state.postcodesDown = value;
    },
    call,
    json: async (path, init) => {
      const response = await call(path, init);
      return { status: response.status, body: (await response.json()) as never };
    },
  };
}

/** A collector token, from /join. */
export async function join(w: World, name = 'test-scout', ip = '198.51.100.1'): Promise<string> {
  const { body } = await w.json<{ token: string }>('/api/join', { method: 'POST', json: { agent_name: name }, headers: { 'cf-connecting-ip': ip } });
  return body.token;
}

/** A maintainer token, issued by the admin. */
export async function maintainer(w: World, label = 'house maintainer', extra: Record<string, unknown> = {}): Promise<string> {
  const { body } = await w.json<{ token: string }>('/api/admin/tokens', { method: 'POST', admin: true, json: { label, ...extra } });
  return body.token;
}

export const NOW_ISO = () => new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A place record as an agent sends it. */
export const place = (overrides: Record<string, unknown> = {}, provenance: Record<string, unknown> = {}) => ({
  kind: 'place',
  data: { name_en: 'Example Noodle House', name_zh: '示例面馆', category: 'restaurant', cuisines: ['shaanxi'], address: '12 Example Street', postcode: 'W1D 6JW', trading: 'open', ...overrides },
  source_url: 'https://example.com/contact',
  evidence: 'Example Noodle House, 12 Example Street, London W1D 6JW.',
  observed_at: NOW_ISO(),
  ...provenance,
});

/** A review excerpt as an agent sends it. */
export const review = (placeRef: string, overrides: Record<string, unknown> = {}, provenance: Record<string, unknown> = {}) => ({
  kind: 'review',
  data: { place: placeRef, published_on: '2026-05', publication: 'Example Food Blog', source_type: 'blog', language: 'en', ...overrides },
  source_url: 'https://example.com/2026/05/noodles',
  evidence: 'The biang biang noodles were wide as a belt and slick with chilli oil; we came back the next week.',
  observed_at: NOW_ISO(),
  ...provenance,
});

/** A menu as an agent sends it. */
export const menu = (ownerRef: string, items: Record<string, unknown>[] = [{ name_zh: '油泼面', name_en: 'Biang biang noodles', price_pence: 1280 }], overrides: Record<string, unknown> = {}) => ({
  kind: 'menu',
  data: { owner: ownerRef, menu: 'main', source_kind: 'website', items, ...overrides },
  source_url: 'https://example.com/menu',
  evidence: '油泼面 Biang Biang Noodles £12.80',
  observed_at: NOW_ISO(),
});

export interface SubmitBody {
  results: { index: number; status: string; id?: string; existing_id?: string; errors?: { field: string; message: string }[]; waits_for?: string; hint?: string; message?: string }[];
}

export async function submit(w: World, token: string, records: unknown[], headers: Record<string, string> = {}): Promise<SubmitBody> {
  const { status, body } = await w.json<SubmitBody>('/api/records', { method: 'POST', token, json: { records }, headers });
  if (status !== 200) throw new Error(`submit answered ${status}: ${JSON.stringify(body)}`);
  return body;
}

export interface Leased {
  tasks: { id: string; type: string; kind: string; note: string | null; record: { id: string; hash: string; data: Record<string, unknown>; evidence: string; source_url: string }; parent: { id: string } | null; target: { id: string } | null; media_url: string | null }[];
}

export async function lease(w: World, token: string, query = ''): Promise<Leased> {
  const { status, body } = await w.json<Leased>(`/api/tasks${query}`, { token });
  if (status !== 200) throw new Error(`lease answered ${status}: ${JSON.stringify(body)}`);
  return body;
}

export async function verdicts(w: World, token: string, items: unknown[]): Promise<{ results: { status: string; record_status?: string; errors?: { field: string; message: string }[] }[] }> {
  const { status, body } = await w.json<{ results: { status: string; record_status?: string; errors?: { field: string; message: string }[] }[] }>('/api/verdicts', {
    method: 'POST',
    token,
    json: { verdicts: items },
  });
  if (status !== 200) throw new Error(`verdicts answered ${status}: ${JSON.stringify(body)}`);
  return body;
}

/** A verified verdict with a passage of the maintainer's own. */
export const verifyQuote = (taskId: string, extra: Record<string, unknown> = {}) => ({
  task_id: taskId,
  verdict: 'verified',
  source_url: 'https://example.com/contact',
  evidence: 'Example Noodle House, 12 Example Street, London W1D 6JW.',
  observed_at: NOW_ISO(),
  ...extra,
});

/** A record's row, straight from the database. */
export const row = <T = Record<string, unknown>>(w: World, id: string) =>
  w.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first<T & { status: string; data_json: string }>();

export const tasksOf = (w: World, id: string) =>
  w.env.DB.prepare('SELECT * FROM tasks WHERE record_id = ? ORDER BY created_at').bind(id).all<{ id: string; type: string; status: string; note: string | null }>().then((result) => result.results);
