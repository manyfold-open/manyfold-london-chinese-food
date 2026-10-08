import { Fragment, useState } from 'react';
import { KIND_CONFIGS } from '../../../kinds/index';
import { KINDS, type Kind } from '../../shared/kinds';
import type { AdminToken, IssuedToken, RevertReport } from '../../shared/types';
import { appUrl } from '../base';
import { Link } from '../router';
import { Button, CheckRow, Select, TextField, useToast } from '../ui';
import { send, useAdmin } from './adminApi';
import { Action, activityHref, Badge, Field, formatCount, formatTime, Labelled, Loading, Notice, parseUtc, plural, share, When, wholeNumber } from './ui';

/** Where agents keep their token (src/worker/tokens.ts, TOKEN_ENV). */
const TOKEN_ENV = 'LONDON_CHINESE_FOOD_TOKEN';
/** The tasks a maintainer may take a day unless the admin says otherwise (src/worker/tokens.ts). */
const DAILY_TASK_LIMIT = 300;

const kindsText = (kinds: readonly string[]): string =>
  kinds.includes('*') ? 'All kinds' : kinds.map((kind) => (kind in KIND_CONFIGS ? KIND_CONFIGS[kind as Kind].title.en : kind)).join(', ');

/** The token's name, with an inline rename: the new name shows in every history at once. */
function Name({ token, onDone }: { token: AdminToken; onDone: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(token.label);
  if (!editing) {
    return (
      <span className="name-cell">
        {token.label}{' '}
        <button type="button" className="link-button small" onClick={() => setEditing(true)} aria-label={`Rename ${token.label}`}>
          Rename
        </button>
      </span>
    );
  }
  return (
    <form className="rename" onSubmit={(event) => event.preventDefault()}>
      <TextField value={label} onChange={(event) => setLabel(event.target.value)} onFocus={(event) => event.target.select()} maxLength={80} aria-label="New name" autoFocus />
      <Action
        label="Save"
        check={() => (label.trim() ? null : 'A name is needed.')}
        run={() => send('PATCH', `/tokens/${token.id}`, { label: label.trim() })}
        onDone={() => {
          setEditing(false);
          onDone(`Renamed ${token.label} to ${label.trim()}.`);
        }}
      />
      <Button
        onClick={() => {
          setLabel(token.label);
          setEditing(false);
        }}
      >
        Cancel
      </Button>
    </form>
  );
}

const UNDO_WINDOWS = [
  { value: '1', label: 'Last hour' },
  { value: '24', label: 'Last 24 hours' },
  { value: '168', label: 'Last 7 days' },
  { value: '720', label: 'Last 30 days' },
] as const;

/** Undo a token's changes over a window the admin picks (default: the last 24 hours). */
function Undo({ token, onDone }: { token: AdminToken; onDone: (message: string) => void }) {
  const [hours, setHours] = useState<(typeof UNDO_WINDOWS)[number]['value']>('24');
  const since = () => new Date(Date.now() - Number(hours) * 3_600_000).toISOString();
  return (
    <span className="undo">
      <Select label={`Undo ${token.label}'s changes from`} value={hours} options={UNDO_WINDOWS} onChange={setHours} />
      <Action
        label="Undo"
        tone="danger"
        confirm={`Undo every change ${token.label} made since ${formatTime(since())}? Records it created are rejected, records it changed go back to how they were, and what the site did because of them is undone too.`}
        run={() => send<RevertReport>('POST', `/tokens/${token.id}/revert`, { since: since() })}
        onDone={(result) => {
          const report = result as RevertReport;
          onDone(
            `Undid changes to ${plural(report.reverted, 'record')} by ${token.label}.` +
              (report.skipped.length
                ? ` Left ${plural(report.skipped.length, 'record')} for you to settle: ${report.skipped.map((skip) => `${skip.record_id} (${skip.reason})`).join('; ')}.`
                : ''),
          );
        }}
      />
    </span>
  );
}

function StatusActions({ token, onDone }: { token: AdminToken; onDone: (message: string) => void }) {
  const set = (status: string) => send('PATCH', `/tokens/${token.id}`, { status });
  if (token.status === 'revoked') return null;
  return (
    <>
      {token.status === 'active' ? (
        <Action label="Suspend" run={() => set('suspended')} onDone={() => onDone(`Suspended ${token.label}; its tasks and work items went back to the queue.`)} />
      ) : (
        <Action label="Activate" run={() => set('active')} onDone={() => onDone(`Activated ${token.label}.`)} />
      )}
      {token.role === 'collector' ? (
        <Action
          label="Ban"
          tone="danger"
          confirm={`Ban ${token.label}? Its token is revoked and its records waiting for review are rejected.`}
          run={() => send<{ rejected: number }>('POST', `/tokens/${token.id}/ban`)}
          onDone={(result) => onDone(`Banned ${token.label}; rejected ${plural((result as { rejected: number }).rejected, 'waiting record')}.`)}
        />
      ) : (
        <Action
          label="Revoke"
          tone="danger"
          confirm={`Revoke ${token.label}? It stops working at once, for good.`}
          run={() => set('revoked')}
          onDone={() => onDone(`Revoked ${token.label}.`)}
        />
      )}
      <Action
        label="Recheck its records"
        confirm={`Queue a recheck of every verified place, brand and menu ${token.label} sent?`}
        run={() => send<{ queued: number }>('POST', `/tokens/${token.id}/recheck`)}
        onDone={(result) => onDone(`Queued ${plural((result as { queued: number }).queued, 'recheck')}.`)}
      />
    </>
  );
}

/**
 * How many records of each kind a collector may have waiting for review: the base it starts from
 * (src/worker/tokens.ts, pendingCap). It still grows with the token's verified records, up to the
 * kind's ceiling; a base set here stands even above that ceiling.
 */
function Cap({ token, onDone }: { token: AdminToken; onDone: (message: string) => void }) {
  const [cap, setCap] = useState(String(token.pending_cap ?? ''));
  return (
    <span className="undo">
      <input
        type="number"
        min={0}
        max={1000}
        value={cap}
        placeholder="default"
        onChange={(event) => setCap(event.target.value)}
        aria-label={`Base number of records of each kind ${token.label} may have waiting`}
        className="narrow"
      />
      <Action
        label="Set cap"
        run={() => send('PATCH', `/tokens/${token.id}`, { pending_cap: wholeNumber(cap, 1000) })}
        onDone={() => onDone(`${token.label} may now have at least ${plural(Number(cap), 'record')} of each kind waiting, more as its records are verified.`)}
      />
      {token.pending_cap !== null ? (
        <Action
          label="Use the default"
          run={() => send('PATCH', `/tokens/${token.id}`, { pending_cap: null })}
          onDone={() => onDone(`${token.label} starts from each kind's own base again.`)}
        />
      ) : null}
    </span>
  );
}

/** How many tasks a maintainer may take a day (UTC). It applies from its next lease. */
function DailyLimit({ token, onDone }: { token: AdminToken; onDone: (message: string) => void }) {
  const [limit, setLimit] = useState(String(token.daily_task_limit ?? DAILY_TASK_LIMIT));
  return (
    <span className="undo">
      <input
        type="number"
        min={0}
        max={10000}
        value={limit}
        onChange={(event) => setLimit(event.target.value)}
        aria-label={`Tasks a day for ${token.label}`}
        className="narrow"
      />
      <Action
        label="Set daily limit"
        run={() => send('PATCH', `/tokens/${token.id}`, { daily_task_limit: wholeNumber(limit, 10000) })}
        onDone={() => onDone(`${token.label} may now take ${plural(Number(limit), 'task')} a day.`)}
      />
    </span>
  );
}

/** When a maintainer's token stops working: a date (end of that day, UTC), or never. */
function Expiry({ token, onDone }: { token: AdminToken; onDone: (message: string) => void }) {
  const [date, setDate] = useState(token.expires_at ? token.expires_at.slice(0, 10) : '');
  return (
    <span className="undo">
      <TextField value={date} onChange={(event) => setDate(event.target.value)} placeholder="YYYY-MM-DD" aria-label={`Expiry date for ${token.label}`} className="narrow-date" />
      <Action
        label="Set expiry"
        check={() => (/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) && parseUtc(date) ? null : 'Enter a date such as 2027-01-31.')}
        run={() => send('PATCH', `/tokens/${token.id}`, { expires_at: `${date.trim()}T23:59:59Z` })}
        onDone={() => onDone(`${token.label} now expires at the end of ${date.trim()} (UTC).`)}
      />
      {token.expires_at ? (
        <Action label="Never expire" run={() => send('PATCH', `/tokens/${token.id}`, { expires_at: null })} onDone={() => onDone(`${token.label} no longer expires.`)} />
      ) : null}
    </span>
  );
}

/** The secret, shown once, with the message to send its owner. */
function Reveal({ issued, onHide }: { issued: IssuedToken; onHide: () => void }) {
  const toast = useToast();
  const skill = new URL(appUrl('/SKILL.md'), location.href).toString();
  const message = `Your maintainer token for London Chinese Food: ${issued.token}. Save it as ${TOKEN_ENV} in your agent workspace .env, then have your agent read ${skill}`;
  const copy = (text: string, what: string) => {
    if (!navigator.clipboard) {
      toast('Copying is blocked here: select the text instead');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast(`${what} copied`),
      () => toast('Could not copy: select the text instead'),
    );
  };

  return (
    <section className="panel token-reveal" aria-label={`Token for ${issued.label}`}>
      <h3>Token for {issued.label}</h3>
      <p>{issued.note} The site keeps only its hash, so it cannot be shown again.</p>
      <div className="secret-row">
        <code className="secret">{issued.token}</code>
        <Button onClick={() => copy(issued.token, 'Token')}>Copy token</Button>
      </div>
      <p className="small muted">A message to send with it:</p>
      <pre className="secret-message">{message}</pre>
      <div className="inline-form">
        <Button variant="primary" onClick={() => copy(message, 'Message')}>
          Copy message
        </Button>
        <Button onClick={onHide}>Done, hide it</Button>
      </div>
    </section>
  );
}

/** Issue a maintainer token, for every kind or some. Collectors get theirs from /join. */
function Issue({ onIssued }: { onIssued: () => void }) {
  const [label, setLabel] = useState('');
  const [all, setAll] = useState(true);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [limit, setLimit] = useState(String(DAILY_TASK_LIMIT));
  const [expires, setExpires] = useState('');
  const [issued, setIssued] = useState<IssuedToken | null>(null);

  if (issued) return <Reveal issued={issued} onHide={() => setIssued(null)} />;

  const toggle = (kind: Kind) => setKinds((current) => (current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]));

  return (
    <form className="panel issue-form" onSubmit={(event) => event.preventDefault()} aria-label="Issue a maintainer token">
      <h3>Issue a maintainer token</h3>
      <div className="inline-form">
        <Field label="Who it is for">
          <TextField value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ada (house maintainer)" maxLength={80} />
        </Field>
        <Field label="Tasks a day">
          <input type="number" min={0} max={10000} value={limit} onChange={(event) => setLimit(event.target.value)} className="narrow" />
        </Field>
        <Field label="Expires (optional, UTC)">
          <TextField value={expires} onChange={(event) => setExpires(event.target.value)} placeholder="YYYY-MM-DD" className="narrow-date" />
        </Field>
      </div>
      <Labelled label="Kinds it reviews">
        <div className="check-list">
          <CheckRow checked={all} label="All kinds" sub="Including kinds added later." onToggle={() => setAll(!all)} />
          {all
            ? null
            : KINDS.map((kind) => <CheckRow key={kind} checked={kinds.includes(kind)} label={KIND_CONFIGS[kind].title.en} onToggle={() => toggle(kind)} />)}
        </div>
      </Labelled>
      <Action
        label="Issue token"
        primary
        check={() =>
          !label.trim()
            ? 'Say who the token is for.'
            : !all && kinds.length === 0
              ? 'Pick at least one kind, or all of them.'
              : expires.trim() && !(/^\d{4}-\d{2}-\d{2}$/.test(expires.trim()) && parseUtc(expires))
                ? 'Enter the expiry as a date such as 2027-01-31, or leave it empty.'
                : null
        }
        run={() =>
          send<IssuedToken>('POST', '/tokens', {
            label: label.trim(),
            kinds: all ? ['*'] : KINDS.filter((kind) => kinds.includes(kind)),
            daily_task_limit: wholeNumber(limit, 10000),
            ...(expires.trim() ? { expires_at: `${expires.trim()}T23:59:59Z` } : {}),
          })
        }
        onDone={(result) => {
          setIssued(result as IssuedToken);
          setLabel('');
          setExpires('');
          onIssued();
        }}
      />
    </form>
  );
}

/** Maintainer and collector tokens: issue, rename, suspend, revoke or ban, limit, undo, recheck. */
export default function TokensSection() {
  const { data, error, loading, reload } = useAdmin<{ tokens: AdminToken[] }>('/tokens');
  const [message, setMessage] = useState<string | null>(null);
  const done = (text: string) => {
    setMessage(text);
    reload();
  };
  const maintainers = (data?.tokens ?? []).filter((token) => token.role === 'maintainer');
  const collectors = (data?.tokens ?? []).filter((token) => token.role === 'collector');

  return (
    <>
      <div className="section-head">
        <h2>Maintainers</h2>
        <span className="muted">{data ? plural(maintainers.length, 'token') : ''}</span>
      </div>
      <Notice error={error} message={message} />
      <Issue onIssued={reload} />
      {!data && loading ? <Loading rows={3} height={56} /> : null}
      {data && maintainers.length === 0 ? <p className="muted">No maintainer tokens yet.</p> : null}
      {maintainers.length > 0 ? (
        <div className="table-wrap">
          <table className="records token-table">
            <thead>
              <tr>
                <th scope="col">Who</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Verdicts today
                </th>
                <th scope="col" className="num">
                  All verdicts
                </th>
                <th scope="col">Last used</th>
                <th scope="col">Expires</th>
              </tr>
            </thead>
            <tbody>
              {maintainers.map((token) => (
                <Fragment key={token.id}>
                  <tr className="has-actions">
                    <td className="wrap">
                      <Name token={token} onDone={done} />
                      <div className="muted small">
                        {kindsText(token.kinds)} · <code>{token.id}</code>
                      </div>
                    </td>
                    <td>
                      <Badge value={token.status} />
                    </td>
                    <td className="num">
                      {formatCount(token.verdicts.today)} / {formatCount(token.daily_task_limit ?? DAILY_TASK_LIMIT)}
                    </td>
                    <td className="num">{formatCount(token.verdicts.total)}</td>
                    <td>
                      <When at={token.last_used_at} />
                    </td>
                    <td>{token.expires_at ? <When at={token.expires_at} /> : <span className="empty">never</span>}</td>
                  </tr>
                  <tr className="actions-row">
                    <td colSpan={6}>
                      <div className="row-actions">
                        <StatusActions token={token} onDone={done} />
                        {token.status === 'revoked' ? null : <DailyLimit token={token} onDone={done} />}
                        {token.status === 'revoked' ? null : <Expiry token={token} onDone={done} />}
                        <Undo token={token} onDone={done} />
                        <Link href={activityHref(token.id)}>Activity</Link>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="section-head">
        <h2>Collectors</h2>
        <span className="muted">{data ? plural(collectors.length, 'token') : ''}</span>
      </div>
      <p className="muted small">
        Agents get collector tokens from /join on their own. How many records of a kind one may have waiting starts at the kind's base and grows with
        its verified records, up to a ceiling. A base you set here replaces the kinds' own, and stands even above the ceiling.
      </p>
      {data && collectors.length === 0 ? <p className="muted">No collectors yet.</p> : null}
      {collectors.length > 0 ? (
        <div className="table-wrap">
          <table className="records token-table">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Waiting
                </th>
                <th scope="col" className="num">
                  Verified
                </th>
                <th scope="col" className="num">
                  Rejected
                </th>
                <th scope="col" className="num">
                  Accepted
                </th>
                <th scope="col">Last used</th>
              </tr>
            </thead>
            <tbody>
              {collectors.map((token) => (
                <Fragment key={token.id}>
                  <tr className="has-actions">
                    <td className="wrap">
                      <Name token={token} onDone={done} />
                      <div className="muted small">
                        <code>{token.id}</code>
                        {token.pending_cap !== null ? ` · base cap ${formatCount(token.pending_cap)}` : ''}
                      </div>
                    </td>
                    <td>
                      <Badge value={token.status} />
                    </td>
                    <td className="num">
                      {token.records.pending > 0 ? (
                        <Link href={`/settings/records?${new URLSearchParams({ by: token.id, status: 'pending' })}`}>{formatCount(token.records.pending)}</Link>
                      ) : (
                        formatCount(token.records.pending)
                      )}
                    </td>
                    <td className="num">{formatCount(token.records.verified)}</td>
                    <td className="num">{formatCount(token.records.rejected)}</td>
                    <td className="num">{share(token.records.verified, token.records.verified + token.records.rejected)}</td>
                    <td>
                      <When at={token.last_used_at} />
                    </td>
                  </tr>
                  <tr className="actions-row">
                    <td colSpan={7}>
                      <div className="row-actions">
                        <StatusActions token={token} onDone={done} />
                        {token.status === 'revoked' ? null : <Cap token={token} onDone={done} />}
                        <Undo token={token} onDone={done} />
                        <Link href={activityHref(token.id)}>Activity</Link>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
