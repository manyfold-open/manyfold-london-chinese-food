import { useState } from 'react';
import type { Kind } from '../../shared/kinds';
import type { PlaceFacts, Precedent, ReviewItem, UnsureType } from '../../shared/types';
import { Link } from '../router';
import { CheckRow, TextField, useToast } from '../ui';
import { send, useAdmin } from './adminApi';
import { SourceLink } from './fields';
import { Action, activityHref, Badge, hostOf, kindLabel, Loading, Notice, plural, RecordImage, recordHref, When } from './ui';

const TYPE: Record<ReviewItem['type'], string> = {
  unsure: 'Maintainer unsure',
  flagged: 'Flagged at submit',
  report: 'Reader report',
};

/** Why a maintainer could not decide, as the site team reads it. */
const UNSURE: Record<UnsureType, string> = {
  cannot_open: 'Could not open its pages',
  duplicate_pending: 'Duplicate of a waiting record',
  conflict: 'Sources disagree',
  policy: 'Rules do not say',
};

/** What the server looked up about a place: the FSA's business and delivery listings, as leads to open. */
function Facts({ facts }: { facts: PlaceFacts }) {
  return (
    <div className="review-facts small">
      <p className="muted">Looked up <When at={facts.checked_at} /></p>
      <ul>
        {facts.fsa ? (
          <li>
            FSA ({facts.fsa.match === 'exact' ? 'same name' : 'name alike'}):{' '}
            <a href={`https://ratings.food.gov.uk/business/${facts.fsa.id}`} target="_blank" rel="noreferrer">
              {facts.fsa.name}
            </a>
            , {facts.fsa.address} · {facts.fsa.business_type} · {facts.fsa.last_inspection ? `inspected ${facts.fsa.last_inspection}` : 'awaiting inspection'}
          </li>
        ) : null}
        {facts.listings.map((listing) => (
          <li key={listing.url}>
            Just Eat:{' '}
            <a href={listing.url} target="_blank" rel="noreferrer">
              {listing.name}
            </a>
            , {listing.address} · {listing.cuisines.join(', ') || 'no cuisine'} · {listing.offline ? 'offline' : listing.open_now ? 'taking orders now' : 'closed now'}
          </li>
        ))}
        {facts.missing.map((line) => (
          <li key={line} className="muted">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Item({ item, showKind, onChange }: { item: ReviewItem; showKind: boolean; onChange: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(false);
  const [more, setMore] = useState(false);
  const [source, setSource] = useState('');
  const [quote, setQuote] = useState('');
  const [precedent, setPrecedent] = useState('');
  const { record } = item;
  const proposal = record.target_id !== null;
  const media = record.kind === 'photo' || record.kind === 'illustration';
  const host = hostOf(record.source_url);
  const reason = note.trim();
  const needReason = () => (reason ? null : 'Write the reason first.');
  const passage = source.trim() || quote.trim() ? { source_url: source.trim(), evidence: quote.trim() } : {};
  const decide = (status: string) =>
    send('POST', `/records/${record.id}/decide`, {
      status,
      ...(reason ? { reason } : {}),
      ...passage,
      ...(precedent.trim() ? { precedent: precedent.trim() } : {}),
    });
  const done = (text: string) => () => {
    toast(text);
    onChange();
  };

  return (
    <li className="review-item">
      <div className="review-head">
        <span className="badge badge-kind">{TYPE[item.type]}</span>
        {item.unsure_type ? <span className="badge">{UNSURE[item.unsure_type]}</span> : null}
        {showKind ? <span className="muted small">{kindLabel(record.kind)}</span> : null}
        <Link href={recordHref(record.id, record.kind)}>{record.name}</Link>
        <Badge value={record.status} />
        {proposal ? <Badge value="proposal" /> : null}
        <span className="muted small">
          <When at={item.at} />
        </span>
      </div>
      <div className={media ? 'review-body has-image' : 'review-body'}>
        {media ? <RecordImage record={record} size="thumb" alt={record.name} /> : null}
        <div>
          <p className="review-reason">
            {item.reason || <span className="empty">No reason given.</span>}
            {item.type === 'unsure' && item.by ? (
              <span className="muted small">
                {' '}
                — <Link href={activityHref(item.by)}>{item.by_label ?? item.by}</Link>
              </span>
            ) : null}
            {item.type === 'flagged' ? <span className="muted small"> — sent by {record.submitted_by.label}</span> : null}
          </p>
          {media ? null : (
            <>
              <p className="small">
                Source: <SourceLink url={record.source_url} />
              </p>
              {record.evidence ? <blockquote className="small">{record.evidence}</blockquote> : null}
            </>
          )}
          {item.facts ? <Facts facts={item.facts} /> : null}
        </div>
      </div>
      <div className="review-actions">
        <TextField
          placeholder="Reason or note (needed to reject or take down)"
          aria-label={`Reason for ${record.name}`}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
        {proposal ? null : <Action label="Verify" run={() => decide('verified')} onDone={done(`Verified ${record.name}.`)} />}
        <Action label="Reject" tone="danger" check={needReason} run={() => decide('rejected')} onDone={done(`Rejected ${record.name}.`)} />
        <Action label="Back to maintainers" run={() => decide('pending')} onDone={done(`Sent ${record.name} back to the maintainers.`)} />
        {item.report_id !== null ? (
          <Action label="Close report" run={() => send('POST', `/reports/${item.report_id}/resolve`)} onDone={done('Report closed.')} />
        ) : null}
        <button type="button" className="link-button small" onClick={() => setMore(!more)}>
          {more ? 'Fewer fields' : 'Your passage, precedent'}
        </button>
      </div>
      {more ? (
        <div className="review-actions review-more">
          <TextField placeholder="Page your decision rests on (https://…)" aria-label={`Source for ${record.name}`} value={source} onChange={(event) => setSource(event.target.value)} />
          <TextField placeholder="Passage copied from it, word for word" aria-label={`Passage for ${record.name}`} value={quote} maxLength={300} onChange={(event) => setQuote(event.target.value)} />
          <TextField
            placeholder="Precedent: the rule this decision follows, for the rules to learn"
            aria-label={`Precedent for ${record.name}`}
            value={precedent}
            maxLength={300}
            onChange={(event) => setPrecedent(event.target.value)}
          />
        </div>
      ) : null}
      {item.type === 'report' ? (
        <div className="review-actions takedown-row">
          {host ? <CheckRow checked={block} label={`Also block ${host}`} sub="New records quoting it are refused." onToggle={() => setBlock(!block)} /> : null}
          <Action
            label="Take down"
            tone="danger"
            check={needReason}
            confirm={`Take down ${record.name}? It is rejected at once${media ? ' and its image files deleted' : ''}${block && host ? `, and ${host} is blocked` : ''}.`}
            run={() => send('POST', `/records/${record.id}/takedown`, { reason, ...(block ? { block_host: true } : {}) })}
            onDone={done(`Took down ${record.name}.`)}
          />
        </div>
      ) : null}
    </li>
  );
}

/** Decisions that state a rule, until the rule is written into a kind's checks; then they are marked adopted. */
function Precedents() {
  const toast = useToast();
  const { data, reload } = useAdmin<{ precedents: Precedent[] }>('/precedents');
  if (!data || data.precedents.length === 0) return null;
  return (
    <>
      <div className="section-head">
        <h3>Precedents not yet in the rules</h3>
        <span className="muted">{plural(data.precedents.length, 'precedent')}</span>
      </div>
      <ul className="review-list">
        {data.precedents.map((precedent) => (
          <li key={precedent.id} className="review-item">
            <p className="review-reason">{precedent.rule}</p>
            <p className="muted small">
              {kindLabel(precedent.kind)} · {precedent.decision} · <Link href={recordHref(precedent.record_id, precedent.kind)}>{precedent.record_id}</Link> ·{' '}
              <When at={precedent.created_at} />
            </p>
            <Action
              label="Written into the rules"
              run={() => send('POST', `/precedents/${precedent.id}/adopt`)}
              onDone={() => {
                toast('Marked as adopted.');
                reload();
              }}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/** Whether places are looked up on Just Eat for maintainers (the FSA always is). */
function JustEatSwitch() {
  const toast = useToast();
  const { data, reload } = useAdmin<{ just_eat: boolean }>('/facts/settings');
  if (!data) return null;
  return (
    <CheckRow
      checked={data.just_eat}
      label="Look places up on Just Eat for maintainers"
      sub="Hints shown with each place: its listing, cuisines, whether it takes orders. Never proof, never a score."
      onToggle={() =>
        void send('PATCH', '/facts/settings', { just_eat: !data.just_eat }).then(() => {
          toast(data.just_eat ? 'Just Eat lookups off.' : 'Just Eat lookups on.');
          reload();
        })
      }
    />
  );
}

/** Everything that waits for a person: unsure verdicts, flagged records, reader reports. */
export default function ReviewSection({ kind }: { kind: Kind | null }) {
  const { data, error, loading, reload } = useAdmin<{ items: ReviewItem[] }>(`/review${kind ? `?kind=${kind}` : ''}`);
  return (
    <>
      <div className="section-head">
        <h2>Review queue{kind ? ` · ${kindLabel(kind)}` : ''}</h2>
        <span className="muted">{data ? `${plural(data.items.length, 'item')} waiting` : ''}</span>
      </div>
      <p className="muted small">
        Only what maintainers could not settle comes here: a page no maintainer with a browser could open, sources two maintainers found in conflict, or a
        question the rules do not answer. When a decision states a rule, add it as a precedent, so the rules learn it.
      </p>
      <Notice error={error} />
      {!data && loading ? <Loading rows={3} height={120} /> : null}
      {data && data.items.length === 0 ? <p className="muted">Nothing waits for review.</p> : null}
      <ul className="review-list">
        {(data?.items ?? []).map((item) => (
          <Item key={`${item.type}-${item.task_id ?? item.report_id ?? item.record.id}`} item={item} showKind={kind === null} onChange={reload} />
        ))}
      </ul>
      {kind === null ? (
        <>
          <Precedents />
          <JustEatSwitch />
        </>
      ) : null}
    </>
  );
}
