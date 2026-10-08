import type { Kind } from '../../shared/kinds';
import type { ActivityItem } from '../../shared/types';
import { Link } from '../router';
import { Button } from '../ui';
import { useAdmin } from './adminApi';
import { kindLabel, Loading, Notice, recordHref, When, type Nav } from './ui';

/** The latest changes to any record, newest first; filter to one actor by clicking it. */
export default function ActivitySection({ kind, nav }: { kind: Kind | null; nav: Nav }) {
  const actor = nav.params.get('actor');
  const query = new URLSearchParams({ ...(kind ? { kind } : {}), ...(actor ? { actor } : {}) }).toString();
  const { data, error, loading } = useAdmin<{ items: ActivityItem[] }>(`/activity${query ? `?${query}` : ''}`);
  const actorLabel = actor ? (data?.items.find((item) => item.actor.id === actor)?.actor.label ?? actor) : null;

  return (
    <>
      <div className="section-head">
        <h2>Activity{kind ? ` · ${kindLabel(kind)}` : ''}</h2>
        {actor ? (
          <Button onClick={() => nav.go({ actor: null })}>Showing {actorLabel} only · show everyone</Button>
        ) : (
          <span className="muted">The latest 100 changes</span>
        )}
      </div>
      <Notice error={error} />
      {!data && loading ? <Loading rows={8} height={40} /> : null}
      {data && data.items.length === 0 ? <p className="muted">No changes yet.</p> : null}
      {data && data.items.length > 0 ? (
        <div className="table-wrap">
          <table className="records">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Change</th>
                <th scope="col">By</th>
                {kind ? null : <th scope="col">Kind</th>}
                <th scope="col">Record</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <When at={item.created_at} />
                  </td>
                  <td>{item.action}</td>
                  <td>
                    {item.actor.id === actor ? (
                      item.actor.label
                    ) : (
                      <Link href={nav.href({ actor: item.actor.id })} title={item.actor.id}>
                        {item.actor.label}
                      </Link>
                    )}
                  </td>
                  {kind ? null : <td>{kindLabel(item.kind)}</td>}
                  <td className="wrap">
                    <Link href={recordHref(item.record_id, item.kind)}>{item.record_name}</Link>
                  </td>
                  <td className="wrap">{item.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
