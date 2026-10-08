import { useState } from 'react';
import { KIND_CONFIGS } from '../../../kinds/index';
import { valueLabel } from '../../shared/kinds';
import type { AdminRecord } from '../../shared/types';
import { Link } from '../router';
import { Pill, TextField, useToast } from '../ui';
import { send, useAdmin } from './adminApi';
import { textOf } from './fields';
import { Action, Field, formatTime, Loading, Notice, pageOf, Pager, parseUtc, plural, RecordImage, RecordLink, recordHref, utcInput, When, type Nav } from './ui';

type RecordList = { total: number; page: number; records: AdminRecord[] };

const HOUR = 3_600_000;
const PHOTO = KIND_CONFIGS.photo;

function PhotoCard({ record, onDone }: { record: AdminRecord; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const subject = textOf(record.data, 'subject');
  const dish = textOf(record.data, 'dish_name');
  const caption = textOf(record.data, 'caption');
  const credit = textOf(record.data, 'attribution');
  const place = textOf(record.data, 'place');
  const title = `${subject ? valueLabel(PHOTO.fields.subject, subject, 'en') : 'Photo'}${dish ? `: ${dish}` : ''}`;
  const decide = (status: 'verified' | 'rejected') => send('POST', `/records/${record.id}/decide`, { status, ...(reason.trim() ? { reason: reason.trim() } : {}) });

  return (
    <li className="media-card">
      <RecordImage record={record} size="thumb" alt={caption || title} />
      <div className="media-meta">
        <Link href={recordHref(record.id, 'photo')}>
          <strong>{title}</strong>
        </Link>
        {caption ? <p className="small">{caption}</p> : null}
        <p className="muted small">
          {credit ? `Taken by ${credit} · ` : ''}
          <When at={record.created_at} />
        </p>
        {place ? (
          <p className="small">
            Place: <RecordLink id={place} kind="place" />
          </p>
        ) : null}
      </div>
      <div className="media-actions">
        <TextField placeholder="Reason (needed to reject)" aria-label={`Reason to reject ${title}`} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        <Action
          label="Verify"
          run={() => decide('verified')}
          onDone={() => {
            toast('Verified');
            onDone();
          }}
        />
        <Action
          label="Reject"
          tone="danger"
          check={() => (reason.trim() ? null : 'Write the reason first.')}
          run={() => decide('rejected')}
          onDone={() => {
            toast('Rejected');
            onDone();
          }}
        />
      </div>
    </li>
  );
}

const PRESETS = [
  { hours: 1, label: 'Last hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
] as const;

/** Visitors have no token to undo: a burst of uploads is rejected by the time it came in. */
function Burst({ onDone }: { onDone: (message: string) => void }) {
  const [since, setSince] = useState(() => utcInput(new Date(Date.now() - HOUR)));
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const from = parseUtc(since);
  const to = until.trim() ? parseUtc(until) : null;

  return (
    <details className="panel burst">
      <summary>Reject a burst of uploads</summary>
      <p className="muted small">
        Rejects every visitor photo still waiting for review that came in between the two times, with one reason. Times are UTC; leave the end empty for
        now.
      </p>
      <div className="pills">
        {PRESETS.map((preset) => (
          <Pill
            key={preset.hours}
            onClick={() => {
              setSince(utcInput(new Date(Date.now() - preset.hours * HOUR)));
              setUntil('');
            }}
          >
            {preset.label}
          </Pill>
        ))}
      </div>
      <div className="inline-form">
        <Field label="From (UTC)">
          <TextField value={since} onChange={(event) => setSince(event.target.value)} placeholder="2026-10-08 13:00" aria-invalid={since.trim() !== '' && !from} />
        </Field>
        <Field label="To (UTC, optional)">
          <TextField value={until} onChange={(event) => setUntil(event.target.value)} placeholder="now" aria-invalid={until.trim() !== '' && !to} />
        </Field>
        <Field label="Reason">
          <TextField value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Spam burst" maxLength={300} />
        </Field>
        <Action
          label="Reject photos"
          tone="danger"
          check={() =>
            !from
              ? 'Enter when the burst began, such as 2026-10-08 13:00.'
              : until.trim() && !to
                ? 'Enter when it ended, such as 2026-10-08 14:00, or leave it empty for now.'
                : to && to.getTime() <= from.getTime()
                  ? 'The end must come after the start.'
                  : !reason.trim()
                    ? 'Say why.'
                    : null
          }
          confirm={`Reject every visitor photo waiting for review that came in from ${from ? formatTime(from.toISOString()) : '…'} to ${to ? formatTime(to.toISOString()) : 'now'}?`}
          run={() =>
            send<{ rejected: number }>('POST', '/photos/reject', {
              since: from!.toISOString(),
              ...(to ? { until: to.toISOString() } : {}),
              reason: reason.trim(),
            })
          }
          onDone={(result) => onDone(`Rejected ${plural((result as { rejected: number }).rejected, 'photo')}.`)}
        />
      </div>
    </details>
  );
}

/** Visitors' photos waiting for review, as pictures, to decide by eye. */
export default function PhotosSection({ nav }: { nav: Nav }) {
  const page = pageOf(nav.params);
  const { data, error, loading, reload } = useAdmin<RecordList>(`/records?kind=photo&status=pending&page=${page}`);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <div className="section-head">
        <h2>Photos waiting for review</h2>
        <span className="muted">{data ? plural(data.total, 'photo') : ''}</span>
      </div>
      <p className="muted small">
        Maintainers check visitors' photos like any record; here you can decide one yourself. Photos load as you scroll.
      </p>
      <Burst
        onDone={(text) => {
          setMessage(text);
          reload();
        }}
      />
      <Notice error={error} message={message} />
      {!data && loading ? <Loading rows={2} height={160} /> : null}
      {data && data.records.length === 0 ? <p className="muted">No photos wait for review.</p> : null}
      <ul className="media-grid">
        {(data?.records ?? []).map((record) => (
          <PhotoCard key={record.id} record={record} onDone={reload} />
        ))}
      </ul>
      {data ? <Pager page={page} total={data.total} onPage={(next) => nav.go({ page: next > 1 ? String(next) : null })} /> : null}
    </>
  );
}
