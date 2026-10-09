import { useState, type ReactNode } from 'react';
import { WORK_TYPES, type AdminWorkItem, type WorkType } from '../../shared/types';
import { Link } from '../router';
import { Select, Textarea } from '../ui';
import { send, useAdmin } from './adminApi';
import { SourceLink } from './fields';
import { Action, Badge, formatCount, Labelled, Loading, messageOf, Notice, plural, RecordLink, When, type Nav } from './ui';

const TYPE: Record<WorkType, string> = {
  lead: 'Leads',
  menu: 'Menus wanted',
  'menu-link': 'Menu links from visitors',
  reviews: 'Reviews wanted',
  transcribe: 'Menu photos to type up',
  illustrate: 'Illustrations wanted',
};

/**
 * Work items' statuses (src/worker/work.ts): handed out while open, submitted with a record, then
 * done. Leads and menu links may be dismissed, and illustrate items for dishes that are not standard
 * are closed as dismissed (src/worker/illustrations.ts).
 */
const STATUSES = ['open', 'submitted', 'done', 'dismissed'] as const;

const isWorkType = (value: string | null): value is WorkType => (WORK_TYPES as readonly (string | null)[]).includes(value);

const LEADS_EXAMPLE = `[
  { "subject": "osm:node/123", "name": "Example Noodle House", "address": "12 Example Street",
    "postcode": "W1D 6JW", "hint": "OSM cuisine=chinese", "sources": ["https://www.openstreetmap.org/node/123"] }
]`;

/** What an item is about, from its payload: a lead's name and hints, the place or dish it is for. */
function Subject({ item }: { item: AdminWorkItem }) {
  const payload = item.payload ?? {};
  const text = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : '');
  const lines: ReactNode[] = [];
  if (item.type === 'lead') {
    lines.push(<strong key="name">{text('name') || item.subject}</strong>);
    const where = [text('address'), text('postcode')].filter(Boolean).join(', ');
    if (where) lines.push(<span key="where">{where}</span>);
    if (text('hint')) lines.push(<span key="hint" className="muted">{text('hint')}</span>);
    const sources = Array.isArray(payload.sources) ? payload.sources.filter((source): source is string => typeof source === 'string') : [];
    sources.forEach((source) => lines.push(<SourceLink key={source} url={source} />));
    lines.push(<code key="subject" className="muted">{item.subject}</code>);
  } else if (item.type === 'menu' || item.type === 'reviews' || item.type === 'menu-link') {
    lines.push(<strong key="name">{text('name') || 'A place'}</strong>);
    if (text('postcode')) lines.push(<span key="postcode">{text('postcode')}</span>);
    if (text('menu_url')) lines.push(<SourceLink key="menu_url" url={text('menu_url')} />);
    const links = Array.isArray(payload.links) ? payload.links.filter((link): link is string => typeof link === 'string') : [];
    links.forEach((link) => lines.push(<SourceLink key={link} url={link} />));
    if (item.type === 'reviews' && typeof payload.en === 'number' && typeof payload.zh === 'number') {
      lines.push(<span key="has" className="muted">{`Has ${plural(payload.en, 'English excerpt')} and ${plural(payload.zh, 'Chinese excerpt')}`}</span>);
    }
    lines.push(<RecordLink key="place" id={item.subject} kind="place" />);
  } else if (item.type === 'transcribe') {
    lines.push(<strong key="name">The photos of a menu</strong>);
    lines.push(<RecordLink key="photo" id={item.subject} kind="photo" />);
    if (text('place')) lines.push(<span key="place">at <RecordLink id={text('place')} kind="place" /></span>);
  } else {
    lines.push(<strong key="name">{[text('name_zh'), text('name_en')].filter(Boolean).join(' · ') || item.subject}</strong>);
    if (text('prompt')) {
      lines.push(
        <details key="prompt" className="small">
          <summary>Prompt</summary>
          <p className="prompt">{text('prompt')}</p>
        </details>,
      );
    }
  }
  if (item.record_id) lines.push(<span key="record">answered by <RecordLink id={item.record_id} /></span>);
  return <div className="work-subject">{lines}</div>;
}

function LeadsImport({ onDone }: { onDone: (message: string) => void }) {
  const [text, setText] = useState('');
  return (
    <details className="panel leads">
      <summary>Import leads</summary>
      <p className="muted small">
        Paste a JSON array of up to 500 leads, as <code>npm run leads</code> writes them: <code>subject</code> (where the lead comes from and its id
        there, such as osm:node/123) and <code>name</code>, then optionally <code>address</code>, <code>postcode</code>, <code>hint</code>,{' '}
        <code>sources</code> and <code>priority</code>. A lead already known is left as it is. Leads are never published: they only tell collectors
        where to look.
      </p>
      <Textarea className="json-editor" rows={8} value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} placeholder={LEADS_EXAMPLE} aria-label="Leads as JSON" />
      <Action
        label="Import leads"
        primary
        run={async () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch (failure) {
            throw new Error(`That is not valid JSON: ${messageOf(failure)}`);
          }
          const wrapped = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as { leads?: unknown }).leads : parsed;
          if (!Array.isArray(wrapped)) throw new Error('Paste a JSON array of leads, or {"leads": [...]}.');
          if (wrapped.length === 0 || wrapped.length > 500) throw new Error(`Send 1 to 500 leads at a time; this holds ${formatCount(wrapped.length)}.`);
          return send<{ added: number; known: number }>('POST', '/leads', { leads: wrapped });
        }}
        onDone={(result) => {
          const { added, known } = result as { added: number; known: number };
          setText('');
          onDone(`Added ${plural(added, 'new lead')}${known ? `; ${formatCount(known)} ${known === 1 ? 'was' : 'were'} known already` : ''}.`);
        }}
      />
    </details>
  );
}

/** The collectors' work feed: how much of each sort waits, the latest items, and leads to add. */
export default function WorkSection({ nav }: { nav: Nav }) {
  const typeParam = nav.params.get('type');
  const type = isWorkType(typeParam) ? typeParam : null;
  const status = nav.params.get('status') || null;
  const query = new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}) }).toString();
  const { data, error, loading, reload } = useAdmin<{ counts: { type: string; status: string; n: number }[]; items: AdminWorkItem[] }>(
    `/work${query ? `?${query}` : ''}`,
  );
  const [message, setMessage] = useState<string | null>(null);
  const done = (text: string) => {
    setMessage(text);
    reload();
  };

  const counts = data?.counts ?? [];
  const statuses = [...STATUSES, ...new Set(counts.map((row) => row.status).filter((value) => !(STATUSES as readonly string[]).includes(value)))];
  const count = (rowType: string, rowStatus?: string) =>
    counts.filter((row) => row.type === rowType && (rowStatus === undefined || row.status === rowStatus)).reduce((sum, row) => sum + row.n, 0);
  const now = new Date().toISOString();

  return (
    <>
      <div className="section-head">
        <h2>Work</h2>
        <span className="muted">Things the site wants collectors to do, one agent at a time</span>
      </div>
      <Notice error={error} message={message} />
      {!data && loading ? <Loading rows={5} height={40} /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="records work-counts">
            <thead>
              <tr>
                <th scope="col">Sort</th>
                {statuses.map((value) => (
                  <th key={value} scope="col" className="num">
                    {value[0]!.toUpperCase() + value.slice(1)}
                  </th>
                ))}
                <th scope="col" className="num">
                  All
                </th>
              </tr>
            </thead>
            <tbody>
              {WORK_TYPES.map((rowType) => (
                <tr key={rowType}>
                  <td>
                    <Link href={nav.href({ type: rowType, status: null })}>{TYPE[rowType]}</Link>
                  </td>
                  {statuses.map((value) => {
                    const n = count(rowType, value);
                    return (
                      <td key={value} className="num">
                        {n > 0 ? <Link href={nav.href({ type: rowType, status: value })}>{formatCount(n)}</Link> : <span className="empty">0</span>}
                      </td>
                    );
                  })}
                  <td className="num">{formatCount(count(rowType))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <LeadsImport onDone={done} />

      <div className="section-head">
        <h2>Latest items</h2>
        <span className="muted">{data ? `${plural(data.items.length, 'item')}${data.items.length === 100 ? ' (the latest 100)' : ''}` : ''}</span>
      </div>
      <div className="inline-form">
        <Labelled label="Sort">
          <Select
            label="Sort of work"
            value={type ?? 'all'}
            options={[{ value: 'all', label: 'Every sort' }, ...WORK_TYPES.map((value) => ({ value, label: TYPE[value] }))]}
            onChange={(next) => nav.go({ type: next === 'all' ? null : next })}
          />
        </Labelled>
        <Labelled label="Status">
          <Select
            label="Status"
            value={status ?? 'any'}
            options={[{ value: 'any', label: 'Any status' }, ...statuses.map((value) => ({ value, label: value }))]}
            onChange={(next) => nav.go({ status: next === 'any' ? null : next })}
          />
        </Labelled>
      </div>
      {data && data.items.length === 0 ? <p className="muted">No work items match.</p> : null}
      {data && data.items.length > 0 ? (
        <div className="table-wrap">
          <table className="records work-items">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Sort</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Priority
                </th>
                <th scope="col">Handed out until</th>
                <th scope="col">Note</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const handed = item.status === 'open' && item.handed_until !== null && item.handed_until > now;
                return (
                  <tr key={item.id}>
                    <td>
                      <Subject item={item} />
                    </td>
                    <td>{TYPE[item.type] ?? item.type}</td>
                    <td>
                      <Badge value={item.status} />
                    </td>
                    <td className="num">{formatCount(item.priority)}</td>
                    <td>
                      {handed ? (
                        <>
                          <When at={item.handed_until} />
                          {item.handed_to ? <div className="muted small">{item.handed_to.label}</div> : null}
                        </>
                      ) : (
                        <span className="empty">—</span>
                      )}
                    </td>
                    <td className="wrap">{item.note ?? ''}</td>
                    <td>
                      {item.status !== 'open' ? (
                        <Action
                          label="Reopen"
                          confirm={
                            item.status === 'submitted'
                              ? `Reopen ${item.subject}? The record sent for it stays waiting for review but no longer answers this item, so another agent may do the same work.`
                              : undefined
                          }
                          run={() => send('POST', `/work/${item.id}/reopen`)}
                          onDone={() => done(`Reopened ${item.subject}.`)}
                        />
                      ) : handed ? (
                        <Action label="Take back" run={() => send('POST', `/work/${item.id}/reopen`)} onDone={() => done(`${item.subject} is free for any agent again.`)} />
                      ) : (
                        <span className="empty">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
