/**
 * Housekeeping, run by the cron trigger every five minutes (and by POST /api/admin/maintenance on
 * demand). Every step is idempotent, so a missed or doubled run does no harm:
 *
 *   - leases that ran out go back to the queue (work items' handouts simply expire);
 *   - a verified place, brand or menu last checked longer ago than its kind's recheckAfterDays
 *     gets a recheck task, unless it already has a task waiting; review excerpts, photos and
 *     illustrations are never rechecked: they are history;
 *   - rate-limit windows, Idempotency-Key answers and daily handout counts past their use go.
 *
 * The read models (place pages, the index, dishes) are refreshed by src/worker/docs.ts.
 */

import { ALL_KINDS } from '../../kinds/index';
import { DAY } from './ratelimit';

export interface MaintenanceReport {
  released: number;
  rechecks: number;
}

/**
 * Each run looks for rechecks among the records that came due in the last hour. The first run of
 * each UTC day (and the admin's) reads every due record, which catches any that were missed.
 */
const RECHECK_WINDOW_MS = 60 * 60 * 1000;

const changes = (result: D1Result | undefined): number => Number(result?.meta?.changes ?? 0);

export async function maintain(db: D1Database, now: Date, options: { everyDueRecord?: boolean } = {}): Promise<MaintenanceReport> {
  const at = now.toISOString();
  const rechecked = ALL_KINDS.filter((config) => config.recheckAfterDays !== null);
  const [released, ...rest] = await db.batch([
    db
      .prepare(`UPDATE tasks SET status = 'open', leased_to = NULL, lease_expires_at = NULL WHERE status = 'leased' AND lease_expires_at <= ?`)
      .bind(at),
    ...rechecked.map((config) => {
      const due = now.getTime() - config.recheckAfterDays! * DAY;
      return db
        .prepare(
          `INSERT INTO tasks (id, record_id, record_kind, type, status, created_at)
           SELECT 'tsk_' || lower(hex(randomblob(13))), r.id, r.kind, 'recheck', 'open', ?
           FROM records r INDEXED BY records_due
           WHERE r.kind = ? AND r.status = 'verified' AND r.verified_at > ? AND r.verified_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM tasks t WHERE t.record_id = r.id AND t.status IN ('open', 'leased', 'review', 'blocked'))`,
        )
        .bind(at, config.kind, options.everyDueRecord ? '' : new Date(due - RECHECK_WINDOW_MS).toISOString(), new Date(due).toISOString());
    }),
    db.prepare('DELETE FROM rate_counters WHERE window_start < ?').bind(now.getTime() - 2 * DAY),
    db.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(new Date(now.getTime() - DAY).toISOString()),
    db.prepare(`DELETE FROM settings WHERE scope = 'illustrate-day' AND key < ?`).bind(new Date(now.getTime() - 2 * DAY).toISOString().slice(0, 10)),
  ]);
  return {
    released: changes(released),
    rechecks: rest.slice(0, rechecked.length).reduce((sum, result) => sum + changes(result), 0),
  };
}
