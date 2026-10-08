/**
 * Calls to /api/admin/* for the /settings console. The admin password is sent once, to
 * POST /api/admin/session, which answers with a session cookie the browser keeps for the console:
 * HttpOnly, so no script here (nor in the other apps on app.manyfold.ai) can read it, and limited
 * to this site's path. The password itself is never stored. A 401 shows the password gate again;
 * Lock ends the session.
 *
 * Images that need the session load through a small queue: a few at a time, only once on screen,
 * kept as blob URLs until the console locks.
 */

import { useCallback, useEffect, useReducer, useState } from 'react';
import type { ApiErrorBody } from '../../shared/types';
import { ApiError } from '../api';
import { appUrl } from '../base';

let onLock: (() => void) | null = null;

/** The console registers once, to show the password gate whenever a call is refused. */
export const whenLocked = (handler: (() => void) | null): void => {
  onLock = handler;
};

/** Trades the password for the console's session cookie. A wrong one throws ApiError 401. */
export async function signIn(password: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(appUrl('/api/admin/session'), { method: 'POST', cache: 'no-store', headers: { accept: 'application/json', 'x-admin-password': password } });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }
  if (!response.ok) throw await failure(response);
}

/** Whether this browser's session still opens the console. */
export async function hasSession(): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(appUrl('/api/admin/session'), { cache: 'no-store', headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }
  if (response.status === 401) return false;
  if (!response.ok) throw await failure(response);
  return true;
}

/** Ends the session, forgets every image fetched with it, and shows the gate. */
export function lock(): void {
  void fetch(appUrl('/api/admin/session'), { method: 'DELETE', cache: 'no-store' }).catch(() => undefined);
  forgetImages();
  onLock?.();
}

/* ───────── requests ───────── */

/** After a 429: when the Worker takes requests again. */
let pausedUntil = 0;

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(appUrl(`/api/admin${path}`), {
      ...init,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.');
  }
  if (response.status === 429) {
    const wait = Number(response.headers.get('retry-after'));
    pausedUntil = Math.max(pausedUntil, Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 30) * 1000);
  }
  if (response.status === 401) lock();
  return response;
}

async function failure(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(
    response.status,
    body?.error?.code ?? 'request_failed',
    body?.error?.message ?? `Request failed with HTTP ${response.status}.`,
  );
}

export async function admin<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** POST, PUT or PATCH with a JSON body. */
export const send = <T>(method: 'POST' | 'PUT' | 'PATCH', path: string, payload?: unknown): Promise<T> =>
  admin<T>(path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

export interface AdminState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Fetch again, keeping the current data on screen meanwhile. */
  reload: () => void;
}

export function useAdmin<T>(path: string | null): AdminState<T> {
  const [state, setState] = useState<Omit<AdminState<T>, 'reload'>>({ data: null, error: null, loading: path !== null });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((previous) => ({ ...previous, loading: true }));
    admin<T>(path)
      .then((data) => {
        if (live) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const failed = error instanceof ApiError ? error : new ApiError(0, 'network', 'Could not reach the server.');
        setState((previous) => ({ data: previous.data, error: failed, loading: false }));
      });
    return () => {
      live = false;
    };
  }, [path, round]);

  const reload = useCallback(() => setRound((value) => value + 1), []);
  return { ...state, reload };
}

/* ───────── images ───────── */

export type ImageSize = 'thumb' | 'full';

export interface ImageState {
  status: 'idle' | 'waiting' | 'loading' | 'ready' | 'failed';
  url: string | null;
  error: string | null;
}

interface Entry extends ImageState {
  key: string;
  path: string;
  listeners: Set<() => void>;
}

/** Fetches at once. */
const IMAGE_SLOTS = 4;

const entries = new Map<string, Entry>();
const queue: Entry[] = [];
let active = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function update(entry: Entry, patch: Partial<ImageState>): void {
  Object.assign(entry, patch);
  for (const listener of entry.listeners) listener();
}

function pump(): void {
  clearTimeout(timer);
  timer = undefined;
  while (queue.length > 0 && active < IMAGE_SLOTS) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) {
      timer = setTimeout(pump, wait + 100);
      return;
    }
    void load(queue.shift()!);
  }
}

async function load(entry: Entry): Promise<void> {
  active += 1;
  update(entry, { status: 'loading' });
  try {
    const response = await request(entry.path);
    if (entries.get(entry.key) !== entry) return; // locked meanwhile
    if (response.status === 429) {
      update(entry, { status: 'waiting' });
      queue.unshift(entry);
      return;
    }
    if (!response.ok) {
      update(entry, { status: 'failed', error: (await failure(response)).message });
      return;
    }
    const blob = await response.blob();
    if (entries.get(entry.key) !== entry) return;
    update(entry, { status: 'ready', url: URL.createObjectURL(blob), error: null });
  } catch (error) {
    if (entries.get(entry.key) === entry) update(entry, { status: 'failed', error: error instanceof Error ? error.message : 'Could not load the image.' });
  } finally {
    active -= 1;
    pump();
  }
}

function forgetImages(): void {
  for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  entries.clear();
  queue.length = 0;
  clearTimeout(timer);
  timer = undefined;
}

const IDLE: ImageState = { status: 'idle', url: null, error: null };

/**
 * A record's image through the admin media route, as a blob URL kept until the console locks.
 * Nothing is fetched until `wanted` (the image is on screen); one that leaves before its turn
 * gives its place in the queue up.
 */
export function useAdminImage(id: string, size: ImageSize, wanted: boolean): ImageState & { retry: () => void } {
  const key = `${id}:${size}`;
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!wanted) return;
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, path: `/records/${encodeURIComponent(id)}/media?size=${size}`, status: 'waiting', url: null, error: null, listeners: new Set() };
      entries.set(key, entry);
      queue.push(entry);
    }
    const mine = entry;
    mine.listeners.add(rerender);
    pump();
    rerender();
    return () => {
      mine.listeners.delete(rerender);
      if (mine.listeners.size > 0 || mine.status !== 'waiting' || entries.get(key) !== mine) return;
      entries.delete(key);
      const index = queue.indexOf(mine);
      if (index >= 0) queue.splice(index, 1);
    };
  }, [key, id, size, wanted]);

  const retry = useCallback(() => {
    const entry = entries.get(key);
    if (!entry || entry.status !== 'failed') return;
    update(entry, { status: 'waiting', error: null });
    queue.push(entry);
    pump();
  }, [key]);

  const entry = wanted ? entries.get(key) : undefined;
  return { ...(entry ? { status: entry.status, url: entry.url, error: entry.error } : IDLE), retry };
}
