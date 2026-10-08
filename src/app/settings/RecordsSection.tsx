import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KIND_CONFIGS } from '../../../kinds/index';
import type { Kind, RecordData } from '../../shared/kinds';
import { RECORD_STATUSES, type AdminRecord, type AdminRecordDetail, type AdminRevision, type RecordStatus } from '../../shared/types';
import { Link } from '../router';
import { Button, CheckRow, Chip, SearchField, Select, Textarea, TextField } from '../ui';
import { send, useAdmin } from './adminApi';
import { fieldsOf, FieldValueView, SourceLink } from './fields';
import {
  Action,
  activityHref,
  Badge,
  Field,
  formatTime,
  hostOf,
  kindLabel,
  Labelled,
  Loading,
  messageOf,
  Notice,
  pageOf,
  Pager,
  plural,
  RecordImage,
  RecordLink,
  STATUS_LABEL,
  When,
  type Nav,
} from './ui';

type RecordList = { total: number; page: number; records: AdminRecord[] };

/* ───────── deciding, editing, taking down ───────── */

type Decision = 'verified' | 'rejected' | 'stale' | 'merged' | 'pending';

const DECISION: Record<Decision, string> = {
  verified: 'verified',
  rejected: 'rejected',
  stale: 'stale (out of date)',
  merged: 'merged (a duplicate)',
  pending: 'pending (back to the maintainers)',
};

function DecideForm({ record, onDone }: { record: AdminRecord; onDone: (message: string) => void }) {
  // A proposal is applied by a maintainer's verdict; the admin only rejects it or sends it back.
  const choices: Decision[] = record.target_id ? ['rejected', 'pending'] : ['verified', 'rejected', 'stale', 'merged', 'pending'];
  const [status, setStatus] = useState<Decision>(choices[0]!);
  const [reason, setReason] = useState('');
  const [duplicateOf, setDuplicateOf] = useState('');
  const needsReason = status === 'rejected' || status === 'stale';

  return (
    <div className="inline-form">
      <Labelled label="New status">
        <Select label="New status" value={status} options={choices.map((value) => ({ value, label: DECISION[value] }))} onChange={setStatus} />
      </Labelled>
      {status === 'merged' ? (
        <Field label="Duplicate of (a verified record's id)">
          <TextField value={duplicateOf} onChange={(event) => setDuplicateOf(event.target.value)} placeholder="rec_…" spellCheck={false} />
        </Field>
      ) : null}
      <Field label={needsReason ? 'Reason' : 'Reason (optional)'}>
        <TextField value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </Field>
      <Action
        label="Apply"
        primary
        check={() =>
          needsReason && !reason.trim()
            ? 'Say why: this status needs a reason.'
            : status === 'merged' && !duplicateOf.trim()
              ? 'Name the record this one duplicates.'
              : null
        }
        run={() =>
          send('POST', `/records/${record.id}/decide`, {
            status,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(status === 'merged' ? { duplicate_of: duplicateOf.trim() } : {}),
          })
        }
        onDone={() => {
          setReason('');
          onDone(`Set to ${status}.`);
        }}
      />
    </div>
  );
}

/** Corrections that turn `before` into `after`: changed fields, and null for removed ones. */
function corrections(before: RecordData, after: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(after)) {
    if (JSON.stringify(value) !== JSON.stringify(before[field])) changes[field] = value;
  }
  for (const field of Object.keys(before)) if (!(field in after)) changes[field] = null;
  return changes;
}

function EditForm({ record, onDone }: { record: AdminRecord; onDone: (message: string) => void }) {
  const original = JSON.stringify(record.data, null, 2);
  const [draft, setDraft] = useState(original);
  const [reason, setReason] = useState('');
  useEffect(() => setDraft(original), [original]);

  return (
    <>
      <p className="muted small">
        Change values, or delete a line to remove a field. The record keeps its status; fields the server sets (coordinates, sizes) and the record it
        belongs to cannot change here.
      </p>
      <Textarea className="json-editor" rows={14} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="Fields as JSON" />
      <div className="inline-form">
        <Field label="Reason (optional)">
          <TextField value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
        </Field>
        <Action
          label="Save fields"
          run={async () => {
            let next: unknown;
            try {
              next = JSON.parse(draft);
            } catch (failure) {
              throw new Error(`That is not valid JSON: ${messageOf(failure)}`);
            }
            if (typeof next !== 'object' || next === null || Array.isArray(next)) throw new Error('The fields must be one JSON object.');
            const changes = corrections(record.data, next as Record<string, unknown>);
            if (Object.keys(changes).length === 0) throw new Error('Nothing changed.');
            return send('PATCH', `/records/${record.id}`, { corrections: changes, ...(reason.trim() ? { reason: reason.trim() } : {}) });
          }}
          onDone={() => {
            setReason('');
            onDone('Fields saved.');
          }}
        />
        <Button disabled={draft === original} onClick={() => setDraft(original)}>
          Undo my edits
        </Button>
      </div>
    </>
  );
}

function TakedownForm({ record, onDone }: { record: AdminRecord; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const [block, setBlock] = useState(false);
  const host = hostOf(record.source_url);
  const media = record.kind === 'photo' || record.kind === 'illustration';

  return (
    <>
      <p className="muted small">
        For a rights holder's request: the record is rejected at once{media ? ', its image files are deleted' : ''} and its open reports are closed.
      </p>
      <div className="inline-form">
        <Field label="Reason">
          <TextField value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Who asked, and why" maxLength={480} />
        </Field>
        {host ? (
          <div className="check-field">
            <CheckRow checked={block} label={`Also block ${host}`} sub="New records quoting it are refused." onToggle={() => setBlock(!block)} />
          </div>
        ) : null}
        <Action
          label="Take down"
          tone="danger"
          check={() => (reason.trim() ? null : 'Say who asked, and why.')}
          confirm={`Take down ${record.name}? It is rejected at once${media ? ' and its image files deleted' : ''}${block && host ? `, and ${host} is blocked` : ''}.`}
          run={() => send('POST', `/records/${record.id}/takedown`, { reason: reason.trim(), ...(block ? { block_host: true } : {}) })}
          onDone={() => {
            setReason('');
            onDone(`Taken down${block && host ? `; ${host} is blocked` : ''}.`);
          }}
        />
      </div>
    </>
  );
}

/* ───────── history ───────── */

interface Snapshot {
  status?: unknown;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

const snapshot = (value: unknown): Snapshot | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Snapshot) : null);

/** A value in a line of the history: lists counted, long text cut. */
function brief(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (Array.isArray(value) && value.some((item) => typeof item === 'object' && item !== null)) return plural(value.length, 'item');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** What one revision changed, field by field. */
function changesOf(before: unknown, after: unknown): { label: string; from: string | null; to: string }[] {
  const was = snapshot(before);
  const now = snapshot(after);
  if (!now) return [];
  const lines: { label: string; from: string | null; to: string }[] = [];
  if (now.status !== undefined && now.status !== was?.status) lines.push({ label: 'status', from: was ? brief(was.status) : null, to: brief(now.status) });
  if (now.data && was?.data) {
    for (const field of new Set([...Object.keys(was.data), ...Object.keys(now.data)])) {
      if (JSON.stringify(was.data[field]) !== JSON.stringify(now.data[field])) lines.push({ label: field, from: brief(was.data[field]), to: brief(now.data[field]) });
    }
  } else if (now.data && !was) {
    lines.push({ label: 'fields', from: null, to: Object.keys(now.data).join(', ') });
  }
  for (const [key, value] of Object.entries(now)) {
    if (key !== 'status' && key !== 'data') lines.push({ label: key, from: null, to: brief(value) });
  }
  return lines;
}

function Revision({ revision }: { revision: AdminRevision }) {
  const lines = changesOf(revision.before, revision.after);
  return (
    <li>
      <div className="history-line">
        <span>
          <strong>{revision.action}</strong> by <Link href={activityHref(revision.actor.id)}>{revision.actor.label}</Link>
        </span>
        <When at={revision.created_at} />
      </div>
      {revision.reason ? <p className="muted small">{revision.reason}</p> : null}
      {revision.caused_by ? (
        <p className="small">
          Because of <RecordLink id={revision.caused_by} />
        </p>
      ) : null}
      {lines.length > 0 ? (
        <ul className="diff">
          {lines.map((line) => (
            <li key={line.label}>
              <code>{line.label}</code>
              {line.from === null ? (
                ': '
              ) : (
                <>
                  {' '}
                  <span className="was">{line.from}</span>
                  {' → '}
                </>
              )}
              <span className="now">{line.to}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {revision.source_url ? (
        <p className="small">
          Checked against <SourceLink url={revision.source_url} />
        </p>
      ) : null}
      {revision.evidence ? <blockquote className="small">{revision.evidence}</blockquote> : null}
      <details className="json-fold small">
        <summary>Before and after</summary>
        <div className="before-after">
          <pre className="json">{revision.before === null ? '(new record)' : JSON.stringify(revision.before, null, 2)}</pre>
          <pre className="json">{JSON.stringify(revision.after, null, 2)}</pre>
        </div>
      </details>
    </li>
  );
}

/* ───────── one record ───────── */

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="fact">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useAdmin<AdminRecordDetail>(`/records/${encodeURIComponent(id)}`);
  const [message, setMessage] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  // The record opens above the list: bring it into view, under the top bar.
  const loaded = data !== null;
  useEffect(() => {
    const element = panel.current;
    if (loaded && element) window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 72 });
  }, [id, loaded]);

  if (!data) {
    return (
      <section ref={panel} className="panel detail">
        {error ? <Notice error={error} /> : <Loading rows={3} height={56} />}
        <Button onClick={onClose}>Close</Button>
      </section>
    );
  }

  const { record, revisions, tasks, reports, children } = data;
  const config = KIND_CONFIGS[record.kind];
  const media = record.kind === 'photo' || record.kind === 'illustration';
  const done = (text: string) => {
    setMessage(text);
    reload();
    onChanged();
  };

  return (
    <section ref={panel} className="panel detail" aria-label={record.name}>
      <div className="section-head">
        <h3>
          {record.name} <Badge value={record.status} />
          {record.flagged ? <Badge value="flagged" /> : null}
          {record.target_id ? <Badge value="proposal" /> : null}
        </h3>
        <Button onClick={onClose}>Close</Button>
      </div>
      <p className="muted small">
        {kindLabel(record.kind)} · <code>{record.id}</code>
      </p>
      <Notice error={error} message={message} />
      <div className="detail-grid">
        <div>
          {media ? <RecordImage key={`${record.id}-${record.status}`} record={record} size="full" alt={record.name} /> : null}
          <dl className="facts compact">
            {fieldsOf(record.kind, record.data).map((field) => (
              <Fact key={field.name} label={field.label}>
                <FieldValueView def={field.def} value={field.value} />
              </Fact>
            ))}
          </dl>
          <dl className="facts compact record-meta">
            <Fact label="Sent by">
              <Link href={activityHref(record.submitted_by.id)}>{record.submitted_by.label}</Link> <span className="muted small">({record.submitted_by.id})</span>
            </Fact>
            <Fact label="Sent">
              <When at={record.created_at} />
            </Fact>
            <Fact label="Changed">
              <When at={record.updated_at} />
            </Fact>
            <Fact label="Verified">
              <When at={record.verified_at} />
            </Fact>
            {record.observed_at ? <Fact label="Source read">{formatTime(record.observed_at)}</Fact> : null}
            {record.parent_id ? (
              <Fact label="Belongs to">
                <RecordLink id={record.parent_id} />
              </Fact>
            ) : null}
            {record.root_id && record.root_id !== record.parent_id ? (
              <Fact label="Under">
                <RecordLink id={record.root_id} />
              </Fact>
            ) : null}
            {record.target_id ? (
              <Fact label="Proposes a change to">
                <RecordLink id={record.target_id} kind={record.kind} />
              </Fact>
            ) : null}
            {record.merged_into ? (
              <Fact label={record.status === 'applied' ? 'Applied to' : 'Merged into'}>
                <RecordLink id={record.merged_into} kind={record.kind} />
              </Fact>
            ) : null}
          </dl>
        </div>
        <div>
          <h4>Source</h4>
          {config.provenance === 'upload' ? (
            <p className="muted small">Uploaded to the site; it has no source page.</p>
          ) : (
            <>
              <SourceLink url={record.source_url} />
              {record.evidence ? <blockquote>{record.evidence}</blockquote> : <p className="muted small">No quote.</p>}
            </>
          )}
          {children.length > 0 ? (
            <>
              <h4>Belonging to it</h4>
              <ul className="plain small">
                {children.map((child) => {
                  const noun = KIND_CONFIGS[child.kind].noun.en;
                  return (
                    <li key={`${child.kind}-${child.status}`}>
                      <Link href={`/settings/records?${new URLSearchParams({ kind: child.kind, status: child.status, parent: record.id })}`}>
                        {plural(child.count, noun.one, noun.other)}
                      </Link>{' '}
                      <Badge value={child.status} />
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <h4>Tasks</h4>
          {tasks.length === 0 ? <p className="muted small">None.</p> : null}
          <ul className="plain small">
            {tasks.map((task) => (
              <li key={task.id}>
                {task.type} <Badge value={task.status} /> <When at={task.created_at} />
                {task.leased_to ? (
                  <>
                    {' '}
                    · held by <Link href={activityHref(task.leased_to)}>{task.leased_to}</Link>
                  </>
                ) : null}
                {task.note ? <div className="muted">{task.note}</div> : null}
              </li>
            ))}
          </ul>
          {reports.length > 0 ? (
            <>
              <h4>Reports</h4>
              <ul className="plain small">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Badge value={report.status} /> {report.type === 'takedown' ? 'Takedown request: ' : ''}
                    {report.reason} <When at={report.created_at} />
                    {report.status === 'open' ? (
                      <div>
                        <Action label="Close report" run={() => send('POST', `/reports/${report.id}/resolve`)} onDone={() => done('Report closed.')} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <h4>Decide</h4>
      <DecideForm key={`${record.id}-${record.status}`} record={record} onDone={done} />

      <h4>Edit fields</h4>
      <EditForm record={record} onDone={done} />

      <h4>Take down</h4>
      <TakedownForm record={record} onDone={done} />

      <h4>History</h4>
      <ol className="history-list">
        {revisions.map((revision) => (
          <Revision key={revision.id} revision={revision} />
        ))}
      </ol>
    </section>
  );
}

/* ───────── the list ───────── */

const isStatus = (value: string | null): value is RecordStatus => (RECORD_STATUSES as readonly (string | null)[]).includes(value);

/** Every record in every status, with a detail view to decide, correct or take one down. */
export default function RecordsSection({ kind, nav }: { kind: Kind | null; nav: Nav }) {
  const { params } = nav;
  const named = params.get('status');
  const status = isStatus(named) ? named : null;
  const q = params.get('q') ?? '';
  const parent = params.get('parent') ?? '';
  const by = params.get('by') ?? '';
  const page = pageOf(params);
  const openId = params.get('record');
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);

  const query = new URLSearchParams({
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    ...(parent ? { parent } : {}),
    ...(by ? { by } : {}),
    page: String(page),
  });
  const { data, error, loading, reload } = useAdmin<RecordList>(`/records?${query}`);

  return (
    <>
      {openId ? <Detail key={openId} id={openId} onClose={() => nav.go({ record: null })} onChanged={reload} /> : null}
      <div className="section-head">
        <h2>Records{kind ? ` · ${kindLabel(kind)}` : ''}</h2>
        <span className="muted">{data ? plural(data.total, 'record') : ''}</span>
      </div>
      <form
        className="inline-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          nav.go({ q: text.trim(), page: null });
        }}
      >
        <Labelled label="Status">
          <Select
            label="Status"
            value={status ?? 'any'}
            options={[{ value: 'any', label: 'Any status' }, ...RECORD_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }))]}
            onChange={(next) => nav.go({ status: next === 'any' ? null : next, page: null })}
          />
        </Labelled>
        <Labelled label="Search">
          <SearchField value={text} label="Name, text in any field, or a record id" onChange={setText} shortcut={false} />
        </Labelled>
        <Button type="submit">Search</Button>
        {parent ? <Chip label={`Belonging to ${parent}`} onRemove={() => nav.go({ parent: null, page: null })} /> : null}
        {by ? <Chip label={`Sent by ${by}`} onRemove={() => nav.go({ by: null, page: null })} /> : null}
      </form>
      <Notice error={error} />
      {!data && loading ? <Loading rows={6} height={44} /> : null}
      {data && data.records.length === 0 ? <p className="muted">No record matches.</p> : null}
      {data && data.records.length > 0 ? (
        <div className="table-wrap">
          <table className="records">
            <thead>
              <tr>
                <th scope="col">Name</th>
                {kind ? null : <th scope="col">Kind</th>}
                <th scope="col">Status</th>
                <th scope="col">Sent by</th>
                <th scope="col">Changed</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((record) => (
                <tr key={record.id} className={record.id === openId ? 'current' : undefined}>
                  <td>
                    <Link href={nav.href({ record: record.id })} aria-current={record.id === openId ? 'true' : undefined}>
                      {record.name}
                    </Link>
                    {record.flagged ? <Badge value="flagged" /> : null}
                    {record.target_id ? <Badge value="proposal" /> : null}
                  </td>
                  {kind ? null : <td>{kindLabel(record.kind)}</td>}
                  <td>
                    <Badge value={record.status} />
                  </td>
                  <td className="wrap">{record.submitted_by.label}</td>
                  <td>
                    <When at={record.updated_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data ? <Pager page={page} total={data.total} onPage={(next) => nav.go({ page: next > 1 ? String(next) : null })} /> : null}
    </>
  );
}
