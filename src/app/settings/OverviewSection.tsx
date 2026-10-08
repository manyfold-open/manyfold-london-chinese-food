import { useState } from 'react';
import type { KindOverview, RecordStatus } from '../../shared/types';
import { Link } from '../router';
import { send, useAdmin } from './adminApi';
import { Action, formatCount, kindLabel, Loading, Notice, plural } from './ui';

const COLUMNS: [RecordStatus, string][] = [
  ['pending', 'Waiting'],
  ['verified', 'Verified'],
  ['stale', 'Out of date'],
  ['rejected', 'Rejected'],
  ['merged', 'Merged'],
  ['withdrawn', 'Withdrawn'],
  ['applied', 'Applied'],
];

/** What POST /api/admin/maintenance answers: the cron's housekeeping, then the read models. */
interface CronReport {
  released: number;
  rechecks: number;
  docs: { rebuilt: number; indexed: number | null; dishes: number | null };
  illustrate: number;
  purged: number;
}

const describe = (report: CronReport): string =>
  [
    `Released ${plural(report.released, 'expired lease')}`,
    `queued ${plural(report.rechecks, 'recheck')}`,
    `rebuilt ${plural(report.docs.rebuilt, 'place page')}`,
    report.docs.indexed === null ? null : `the index lists ${plural(report.docs.indexed, 'place')}`,
    report.docs.dishes === null ? null : `the dish catalog ${plural(report.docs.dishes, 'dish', 'dishes')}`,
    `opened or re-ranked ${plural(report.illustrate, 'illustrate item')}`,
    `deleted the files of ${plural(report.purged, 'old image')}`,
  ]
    .filter(Boolean)
    .join(', ') + '.';

/** A count that opens what it counts, or a quiet zero. */
const Count = ({ n, href }: { n: number; href: string }) => (n > 0 ? <Link href={href}>{formatCount(n)}</Link> : <span className="empty">0</span>);

/** Each kind at a glance: records by status, maintainers' tasks, and what waits for the admin. */
export default function OverviewSection() {
  const { data, error, loading, reload } = useAdmin<{ kinds: KindOverview[] }>('/overview');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <div className="section-head">
        <h2>Overview</h2>
        <Action
          label="Run the cron now"
          run={() => send<CronReport>('POST', '/maintenance')}
          onDone={(report) => {
            setMessage(describe(report as CronReport));
            reload();
          }}
        />
      </div>
      <p className="muted small">
        The cron runs every five minutes on its own; running it here also looks at every record due a recheck and rebuilds the whole index.
      </p>
      <Notice error={error} message={message} />
      {!data && loading ? <Loading rows={6} height={44} /> : null}
      {data ? (
        <div className="table-wrap">
          <table className="records overview-table">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                {COLUMNS.map(([status, label]) => (
                  <th key={status} scope="col" className="num">
                    {label}
                  </th>
                ))}
                <th scope="col" className="num">
                  Tasks open or held
                </th>
                <th scope="col" className="num">
                  Tasks blocked
                </th>
                <th scope="col" className="num">
                  For you
                </th>
              </tr>
            </thead>
            <tbody>
              {data.kinds.map((row) => (
                <tr key={row.kind}>
                  <td>
                    <Link href={`/settings/records?kind=${row.kind}`}>{kindLabel(row.kind)}</Link>
                  </td>
                  {COLUMNS.map(([status]) => (
                    <td key={status} className="num">
                      <Count n={row.counts[status] ?? 0} href={`/settings/records?kind=${row.kind}&status=${status}`} />
                    </td>
                  ))}
                  <td className="num">{row.open_tasks > 0 ? formatCount(row.open_tasks) : <span className="empty">0</span>}</td>
                  <td className="num">{row.blocked_tasks > 0 ? formatCount(row.blocked_tasks) : <span className="empty">0</span>}</td>
                  <td className="num">
                    <Count n={row.review} href={`/settings/review?kind=${row.kind}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted small">
        Tasks are maintainers' work: blocked ones wait for their place to be checked first. "For you" counts what the review queue holds: verdicts a
        maintainer was unsure of, records flagged when they were sent, and readers' open reports.
      </p>
    </>
  );
}
