import { useEffect, useState } from 'react';
import { standardDish } from '../../shared/dish';
import type { AdminRecord } from '../../shared/types';
import { Link } from '../router';
import { CheckRow, Textarea, TextField, useToast } from '../ui';
import { send, useAdmin } from './adminApi';
import { textOf } from './fields';
import { Action, Field, Loading, Notice, pageOf, Pager, plural, RecordImage, recordHref, When, wholeNumber, type Nav } from './ui';

type RecordList = { total: number; page: number; records: AdminRecord[] };

/** How the site handles illustrations (src/worker/settings.ts). */
interface IllustrationSettings {
  shown: boolean;
  requested: boolean;
  daily: number;
  template: string;
}

const TEMPLATE_MAX = 1000;

function SettingsForm() {
  const toast = useToast();
  const { data, error, loading, reload } = useAdmin<IllustrationSettings>('/illustrations/settings');
  const [shown, setShown] = useState(true);
  const [requested, setRequested] = useState(true);
  const [daily, setDaily] = useState('');
  const [template, setTemplate] = useState('');

  useEffect(() => {
    if (!data) return;
    setShown(data.shown);
    setRequested(data.requested);
    setDaily(String(data.daily));
    setTemplate(data.template);
  }, [data]);

  if (!data) return error ? <Notice error={error} /> : loading ? <Loading rows={2} height={64} /> : null;

  const changes = (): Partial<IllustrationSettings> => ({
    ...(shown !== data.shown ? { shown } : {}),
    ...(requested !== data.requested ? { requested } : {}),
    ...(daily.trim() !== String(data.daily) ? { daily: wholeNumber(daily, 5000) } : {}),
    ...(template !== data.template ? { template } : {}),
  });

  return (
    <section className="panel" aria-label="Illustration settings">
      <h3>Settings</h3>
      <Notice error={error} />
      <div className="check-list wide">
        <CheckRow
          checked={shown}
          label="Show illustrations to readers"
          sub="Approved AI illustrations appear, labeled, on dishes with no photo of their own at that place."
          onToggle={() => setShown(!shown)}
        />
        <CheckRow
          checked={requested}
          label="Ask agents for illustrations"
          sub="Keeps an illustrate work item open for every dish places serve that has none."
          onToggle={() => setRequested(!requested)}
        />
      </div>
      <div className="inline-form">
        <Field label="Illustrate items handed out a day (0 to 5,000)">
          <input type="number" min={0} max={5000} value={daily} onChange={(event) => setDaily(event.target.value)} className="narrow" />
        </Field>
      </div>
      <Field
        label="Prompt template"
        hint={
          <>
            Must include {'{en}'}; {'{zh}'}, {'{cuisine}'} and {'{description}'} are filled in too. At most {TEMPLATE_MAX.toLocaleString('en-GB')} characters (
            {template.length.toLocaleString('en-GB')} now). Agents get the prompt filled in from the template as it is when an item is handed to them.
          </>
        }
      >
        <Textarea className="template-editor" rows={5} value={template} maxLength={TEMPLATE_MAX} onChange={(event) => setTemplate(event.target.value)} />
      </Field>
      <div className="inline-form">
        <Action
          label="Save settings"
          primary
          check={() => (template.includes('{en}') ? null : 'The template must include {en}, the dish name in English.')}
          run={() => {
            const patch = changes();
            if (Object.keys(patch).length === 0) throw new Error('Nothing changed.');
            return send<IllustrationSettings>('PATCH', '/illustrations/settings', patch);
          }}
          onDone={() => {
            toast('Settings saved');
            reload();
          }}
        />
      </div>
    </section>
  );
}

function IllustrationCard({ record, onDone }: { record: AdminRecord; onDone: (message: string) => void }) {
  const [note, setNote] = useState('');
  const dish = textOf(record.data, 'dish') || record.name;
  // Agents are asked again only for a standard dish; another dish's illustration only comes down.
  const standard = standardDish(dish) !== null;
  const model = textOf(record.data, 'model');
  const prompt = textOf(record.data, 'prompt');

  return (
    <li className="media-card">
      <RecordImage record={record} size="thumb" alt={`AI illustration of ${dish}`} />
      <div className="media-meta">
        <Link href={recordHref(record.id, 'illustration')}>
          <strong>{dish}</strong>
        </Link>
        <p className="muted small">
          {model || 'Model not stated'} · verified <When at={record.verified_at} />
        </p>
        {prompt ? (
          <details className="small">
            <summary>Prompt</summary>
            <p className="prompt">{prompt}</p>
          </details>
        ) : null}
      </div>
      <div className="media-actions">
        <TextField
          placeholder={standard ? 'What the next one should do better' : 'Why it comes down'}
          aria-label={standard ? `Note for the next illustration of ${dish}` : `Why the illustration of ${dish} comes down`}
          value={note}
          maxLength={300}
          onChange={(event) => setNote(event.target.value)}
        />
        <Action
          label={standard ? 'Replace' : 'Take down'}
          tone="danger"
          confirm={
            standard
              ? `Replace the illustration of ${dish}? It comes off the site at once, and the dish's work item opens again${note.trim() ? ' with your note in its prompt' : ''}, for the next agent.`
              : `Take the illustration of ${dish} down? It comes off the site at once. ${dish} is not a standard dish, so agents are not asked for another.`
          }
          run={() => send<{ reopened: boolean; standard: boolean }>('POST', `/illustrations/${record.id}/replace`, { note: note.trim() })}
          onDone={(result) => {
            const outcome = result as { reopened: boolean; standard: boolean };
            onDone(
              outcome.reopened
                ? `Took the illustration of ${dish} down; its work item is open again.`
                : outcome.standard
                  ? `Took the illustration of ${dish} down. No work item was there to open again: one opens at the next cron run if places still serve it.`
                  : `Took the illustration of ${dish} down. It is not a standard dish, so agents are not asked for another.`,
            );
          }}
        />
      </div>
    </li>
  );
}

/** AI illustrations: whether readers see them and agents are asked for them, and the ones on the site. */
export default function IllustrationsSection({ nav }: { nav: Nav }) {
  const page = pageOf(nav.params);
  const { data, error, loading, reload } = useAdmin<RecordList>(`/records?kind=illustration&status=verified&page=${page}`);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <div className="section-head">
        <h2>Illustrations</h2>
        <span className="muted">
          <Link href="/settings/records?kind=illustration&status=pending">Waiting for review</Link> ·{' '}
          <Link href="/settings/work?type=illustrate">Work items</Link>
        </span>
      </div>
      <SettingsForm />
      <div className="section-head">
        <h2>On the site</h2>
        <span className="muted">{data ? plural(data.total, 'illustration') : ''}</span>
      </div>
      <Notice error={error} message={message} />
      {!data && loading ? <Loading rows={2} height={160} /> : null}
      {data && data.records.length === 0 ? <p className="muted">No illustration has been approved yet.</p> : null}
      <ul className="media-grid">
        {(data?.records ?? []).map((record) => (
          <IllustrationCard
            key={record.id}
            record={record}
            onDone={(text) => {
              setMessage(text);
              reload();
            }}
          />
        ))}
      </ul>
      {data ? <Pager page={page} total={data.total} onPage={(next) => nav.go({ page: next > 1 ? String(next) : null })} /> : null}
    </>
  );
}
