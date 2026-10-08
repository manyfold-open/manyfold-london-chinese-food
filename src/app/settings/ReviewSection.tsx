import { useState } from 'react';
import type { Kind } from '../../shared/kinds';
import type { ReviewItem } from '../../shared/types';
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

function Item({ item, showKind, onChange }: { item: ReviewItem; showKind: boolean; onChange: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(false);
  const { record } = item;
  const proposal = record.target_id !== null;
  const media = record.kind === 'photo' || record.kind === 'illustration';
  const host = hostOf(record.source_url);
  const reason = note.trim();
  const needReason = () => (reason ? null : 'Write the reason first.');
  const decide = (status: string) => send('POST', `/records/${record.id}/decide`, { status, ...(reason ? { reason } : {}) });
  const done = (text: string) => () => {
    toast(text);
    onChange();
  };

  return (
    <li className="review-item">
      <div className="review-head">
        <span className="badge badge-kind">{TYPE[item.type]}</span>
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
      </div>
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

/** Everything that waits for a person: unsure verdicts, flagged records, reader reports. */
export default function ReviewSection({ kind }: { kind: Kind | null }) {
  const { data, error, loading, reload } = useAdmin<{ items: ReviewItem[] }>(`/review${kind ? `?kind=${kind}` : ''}`);
  return (
    <>
      <div className="section-head">
        <h2>Review queue{kind ? ` · ${kindLabel(kind)}` : ''}</h2>
        <span className="muted">{data ? `${plural(data.items.length, 'item')} waiting` : ''}</span>
      </div>
      <Notice error={error} />
      {!data && loading ? <Loading rows={3} height={120} /> : null}
      {data && data.items.length === 0 ? <p className="muted">Nothing waits for review.</p> : null}
      <ul className="review-list">
        {(data?.items ?? []).map((item) => (
          <Item key={`${item.type}-${item.task_id ?? item.report_id ?? item.record.id}`} item={item} showKind={kind === null} onChange={reload} />
        ))}
      </ul>
    </>
  );
}
