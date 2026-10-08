import { useState } from 'react';
import { KIND_CONFIGS } from '../../../kinds/index';
import type { Kind } from '../../shared/kinds';
import type { SpotCheck } from '../../shared/types';
import { Link } from '../router';
import { TextField } from '../ui';
import { send, useAdmin } from './adminApi';
import { FieldSummary, SourceLink } from './fields';
import { Action, kindLabel, Loading, Notice, RecordImage, recordHref, share, When } from './ui';

type Item = SpotCheck['items'][number];

function Sample({ kind, item, onMarked }: { kind: Kind; item: Item; onMarked: () => void }) {
  const { record, mark: given } = item;
  const [note, setNote] = useState(given?.note ?? '');
  const mark = (correct: boolean) => send('POST', `/spot-check/${kind}/${record.id}`, { correct, ...(note.trim() ? { note: note.trim() } : {}) });
  const media = kind === 'photo' || kind === 'illustration';

  return (
    <li className={given ? `spot-item ${given.correct ? 'right' : 'wrong'}` : 'spot-item'}>
      <div className="spot-head">
        <Link href={recordHref(record.id, record.kind)}>
          <strong>{record.name}</strong>
        </Link>
        {given ? (
          <span className="muted small">
            {given.correct ? '✓ correct' : '✗ wrong'} · <When at={given.checked_at} />
          </span>
        ) : null}
      </div>
      <div className={media ? 'review-body has-image' : 'review-body'}>
        {media ? <RecordImage record={record} size="thumb" alt={record.name} /> : null}
        <div>
          <FieldSummary kind={record.kind} data={record.data} />
          {KIND_CONFIGS[record.kind].provenance === 'upload' ? null : (
            <>
              <p className="small">
                Source: <SourceLink url={record.source_url} />
              </p>
              {record.evidence ? <blockquote className="small">{record.evidence}</blockquote> : null}
            </>
          )}
        </div>
      </div>
      <div className="inline-form">
        <TextField placeholder="Note (what was wrong)" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} aria-label={`Note on ${record.name}`} />
        <Action label="Correct" run={() => mark(true)} onDone={onMarked} />
        <Action label="Wrong" tone="danger" run={() => mark(false)} onDone={onMarked} />
      </div>
    </li>
  );
}

/**
 * The weekly accuracy check: open each sampled record's source and say whether the record is
 * right. The sample (50 verified records of a kind) is the same all week; the share correct is
 * the figure the site's accuracy is measured by.
 */
export default function SpotCheckSection({ kind }: { kind: Kind }) {
  const { data, error, loading, reload } = useAdmin<SpotCheck>(`/spot-check/${kind}`);
  return (
    <>
      <div className="section-head">
        <h2>
          Spot-check · {kindLabel(kind)}
          {data ? ` · ${data.week}` : ''}
        </h2>
        {data ? (
          <span className="muted">
            {data.marked} of {data.items.length} checked · {share(data.correct, data.marked)} correct
          </span>
        ) : null}
      </div>
      <Notice error={error} />
      {!data && loading ? <Loading rows={3} height={120} /> : null}
      {data && data.items.length === 0 ? <p className="muted">No verified {KIND_CONFIGS[kind].noun.en.other} to check yet.</p> : null}
      <ol className="spot-list">
        {(data?.items ?? []).map((item) => (
          <Sample key={item.record.id} kind={kind} item={item} onMarked={reload} />
        ))}
      </ol>
    </>
  );
}
