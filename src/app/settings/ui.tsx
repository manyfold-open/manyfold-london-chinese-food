/** Small pieces the /settings sections share. */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { KIND_CONFIGS } from '../../../kinds/index';
import { KINDS, type Kind } from '../../shared/kinds';
import type { AdminRecord, RecordStatus } from '../../shared/types';
import { ApiError } from '../api';
import { appUrl } from '../base';
import { Link } from '../router';
import { Button, Sheet, Skeleton, usePending } from '../ui';
import { useAdminImage, type ImageSize } from './adminApi';

/* ───────── words and numbers ───────── */

export const isKind = (value: string | null | undefined): value is Kind => (KINDS as readonly string[]).includes(value ?? '');

export const kindLabel = (kind: string): string => (isKind(kind) ? KIND_CONFIGS[kind].title.en : kind);

export const STATUS_LABEL: Record<RecordStatus, string> = {
  pending: 'Waiting for review',
  verified: 'Verified',
  stale: 'Out of date',
  rejected: 'Rejected',
  merged: 'Merged',
  withdrawn: 'Withdrawn',
  applied: 'Applied (proposal)',
};

const COUNT = new Intl.NumberFormat('en-GB');
export const formatCount = (value: number): string => COUNT.format(value);

/** "1 record", "3 records". */
export const plural = (count: number, one: string, other = `${one}s`): string => `${formatCount(count)} ${count === 1 ? one : other}`;

/** "75%" of a part of a whole, or a dash when there is no whole yet. */
export const share = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

const TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** "8 Oct 2026, 14:05 UTC" */
export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${TIME.format(date)} UTC`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A time as the console's time fields take it: "2026-10-08 14:05", in UTC. */
export const utcInput = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

/**
 * A time typed into a field: "2026-10-08", "2026-10-08 14:00", or any ISO 8601 time. One that
 * names no zone is read as UTC. Null when it is not a time.
 */
export function parseUtc(text: string): Date | null {
  const value = text.trim();
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (match) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    const same = date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hour);
    return same ? date : null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/** A whole number typed into a field, or an error the Action shows. */
export function wholeNumber(text: string, max: number): number {
  const value = Number(text);
  if (text.trim() === '' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`Enter a whole number from 0 to ${formatCount(max)}.`);
  }
  return value;
}

export const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

/** A URL's host as the block list compares it (src/worker/settings.ts): lowercase, without "www.". */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/* ───────── where things are ───────── */

/** Changes to a section's query: a value sets a parameter, null or '' removes it. */
export type Patch = Record<string, string | null>;

/** A section's query, and how to change it. */
export interface Nav {
  params: URLSearchParams;
  /** The section's path with the query changed. */
  href: (patch: Patch) => string;
  go: (patch: Patch) => void;
}

export const pageOf = (params: URLSearchParams): number => Math.max(1, Math.floor(Number(params.get('page'))) || 1);

/** One record in the Records section. */
export const recordHref = (id: string, kind?: string): string =>
  `/settings/records?${new URLSearchParams({ ...(kind && isKind(kind) ? { kind } : {}), record: id })}`;

/** One actor's changes in the Activity section. */
export const activityHref = (actor: string): string => `/settings/activity?${new URLSearchParams({ actor })}`;

export function RecordLink({ id, kind, children }: { id: string; kind?: string; children?: ReactNode }) {
  return <Link href={recordHref(id, kind)}>{children ?? <code>{id}</code>}</Link>;
}

/* ───────── labels ───────── */

/** A status word with its colour; the word itself always carries the meaning. */
export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`badge badge-${value}`}>{label ?? value}</span>;
}

export const When = ({ at }: { at: string | null | undefined }) =>
  at ? (
    <time dateTime={at} title={at}>
      {formatTime(at)}
    </time>
  ) : (
    <span className="empty">never</span>
  );

export function Notice({ error, message }: { error?: ApiError | null; message?: string | null }) {
  if (error) {
    return (
      <p className="notice" role="alert">
        {error.message}
      </p>
    );
  }
  if (message) {
    return (
      <p className="notice good" role="status">
        {message}
      </p>
    );
  }
  return null;
}

/** A label above a native input or a textarea. */
export const Field = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {hint ? <small>{hint}</small> : null}
  </label>
);

/** The same for the kit's own controls (Select, CheckRow), which name themselves. */
export const Labelled = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="field">
    <span aria-hidden="true">{label}</span>
    {children}
  </div>
);

/* ───────── actions ───────── */

/**
 * A button that runs an action, shows that it is working, and reports what went wrong.
 * `confirm` asks first, in a sheet, for actions that are hard to undo; `check` returns what is
 * missing from the form, if anything, before anything is asked or sent.
 */
export function Action({
  label,
  run,
  confirm,
  check,
  tone,
  primary,
  disabled,
  onDone,
}: {
  label: string;
  run: () => Promise<unknown>;
  confirm?: string;
  check?: () => string | null;
  tone?: 'danger';
  primary?: boolean;
  disabled?: boolean;
  onDone?: (result: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);

  const go = async () => {
    setAsking(false);
    setBusy(true);
    setError('');
    try {
      onDone?.(await run());
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const click = () => {
    const missing = check?.() ?? null;
    if (missing) {
      setError(missing);
      return;
    }
    if (confirm) {
      setError('');
      setAsking(true);
    } else void go();
  };

  return (
    <span className="action">
      <Button
        variant={primary ? 'primary' : 'secondary'}
        className={tone === 'danger' ? 'danger' : undefined}
        disabled={busy || disabled}
        onClick={click}
      >
        {busy ? 'Working…' : label}
      </Button>
      {error ? (
        <span className="action-error" role="alert">
          {error}
        </span>
      ) : null}
      {confirm ? (
        <Sheet
          open={asking}
          title={label}
          onClose={() => setAsking(false)}
          action={
            <button type="button" className="link-button" onClick={() => setAsking(false)}>
              Cancel
            </button>
          }
          footer={
            <Button variant="primary" onClick={() => void go()}>
              {label}
            </Button>
          }
        >
          <p className="confirm-text">{confirm}</p>
        </Sheet>
      ) : null}
    </span>
  );
}

/* ───────── lists ───────── */

/** Placeholder rows while a list's first answer is out. */
export function Loading({ rows = 3, height = 48 }: { rows?: number; height?: number }) {
  const { visible } = usePending(true);
  return (
    <div className={visible ? 'loading-rows sk-on' : 'loading-rows'} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} style={{ borderRadius: 8 }} />
      ))}
    </div>
  );
}

/** Previous and next under a list the API pages. */
export function Pager({ page, total, size = 50, onPage }: { page: number; total: number; size?: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pages">
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {formatCount(page)} of {formatCount(pages)}
      </span>
      <Button disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

/**
 * Gives every cell of the console's tables its column's name as data-label, so on a phone
 * (settings.css) each row can stack into a card that still says what every number is.
 */
export function useCellLabels(root: RefObject<HTMLElement | null>, mounted: boolean): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const label = () => {
      for (const table of element.querySelectorAll('table.records')) {
        const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
        for (const row of table.querySelectorAll('tbody tr')) {
          const cells = [...row.children] as HTMLElement[];
          if (cells.length !== heads.length) continue; // e.g. a row of actions spanning the table
          cells.forEach((cell, index) => {
            if (cell.dataset.label !== heads[index]) cell.dataset.label = heads[index];
          });
        }
      }
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root, mounted]);
}

/* ───────── images ───────── */

const isPublic = (status: RecordStatus) => status === 'verified' || status === 'stale';

/**
 * A photo's or an illustration's image. A public one (verified or stale) comes from its public,
 * edge-cached URL; any other, or a public one that is not served (a photo of a place that is not
 * public), through the admin media route with the password, as a blob URL. Nothing loads until
 * the image is near the screen, so a long grid fetches only what is seen.
 */
export function RecordImage({ record, size, alt }: { record: Pick<AdminRecord, 'id' | 'kind' | 'status'>; size: ImageSize; alt: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [direct, setDirect] = useState(() => isPublic(record.status));
  const image = useAdminImage(record.id, size, near && !direct);

  useEffect(() => setDirect(isPublic(record.status)), [record.status]);

  useEffect(() => {
    const element = box.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  const folder = record.kind === 'photo' ? 'p' : 'i';
  let body: ReactNode;
  if (direct) {
    body = near ? <img src={appUrl(`/media/${folder}/${record.id}/${size}.webp`)} alt={alt} decoding="async" onError={() => setDirect(false)} /> : null;
  } else if (image.status === 'ready' && image.url) {
    body = <img src={image.url} alt={alt} decoding="async" />;
  } else if (image.status === 'failed') {
    body = (
      <span className="image-note">
        {image.error}{' '}
        <button type="button" className="link-button" onClick={image.retry}>
          Retry
        </button>
      </span>
    );
  } else {
    body = <span className="image-note">{image.status === 'loading' ? 'Loading…' : near ? 'Waiting for its turn…' : ''}</span>;
  }
  return (
    <div ref={box} className={`admin-image ${size}`}>
      {body}
    </div>
  );
}
