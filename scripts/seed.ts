/**
 * The launch seed: places checked by hand (with research agents) before the site opens, each with
 * the excerpts and menu that came with it. A seed file is a list of groups:
 *
 *   [{ "place": {data, source_url, evidence}, "reviews": [{data, source_url, evidence}], "menu": {data, source_url, evidence} }]
 *
 * where reviews and menu leave out their place (owner): it is filled in as "#0". The seed goes
 * through the same API as every agent's work, so it is validated, identified and recorded the same
 * way: each group is one batch from a collector token, and what it accepts is verified by the admin.
 *
 *   node scripts/seed.ts --check seed/*.json                        validate, and find every quote on its page
 *   node scripts/seed.ts --post <site URL> seed/*.json              send it (LCF_SEED_TOKEN, ADMIN_PASSWORD)
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkEntries, type Entry } from './lib/check.ts';

interface Part {
  data: Record<string, unknown>;
  source_url: string;
  evidence: string;
  observed_at?: string;
}

interface Group {
  place: Part;
  reviews?: Part[];
  menu?: Part | Part[];
}

const args = process.argv.slice(2);
const site = args.includes('--post') ? args[args.indexOf('--post') + 1] : undefined;
const files = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--post');

/** A group as one batch: the place first, its children referring to it as "#0". */
function batchOf(group: Group, observedAt: string): Entry[] {
  const at = (part: Part) => part.observed_at ?? observedAt;
  const menus = group.menu === undefined ? [] : Array.isArray(group.menu) ? group.menu : [group.menu];
  return [
    { kind: 'place', ...group.place, observed_at: at(group.place) },
    ...(group.reviews ?? []).map((review) => ({ kind: 'review', ...review, data: { ...review.data, place: '#0' }, observed_at: at(review) })),
    ...menus.map((menu) => ({ kind: 'menu', ...menu, data: { ...menu.data, owner: '#0' }, observed_at: at(menu) })),
  ];
}

const observedAt = new Date(Date.now() - 60_000).toISOString();
const groups = files.flatMap((file) => JSON.parse(readFileSync(new URL(file, `file://${process.cwd()}/`), 'utf8')) as Group[]);
const batches = groups.map((group) => batchOf(group, observedAt));
console.log(`${files.length} files, ${groups.length} places, ${batches.flat().length} records`);

if (!site) {
  const report = await checkEntries(batches.flat());
  console.log(report.lines.join('\n'));
  console.log(`${report.invalid} invalid, ${report.missing} quote(s) missing, ${report.unreadable} page(s) unreadable`);
  process.exit(report.invalid + report.missing > 0 ? 1 : 0);
}

const token = process.env.LCF_SEED_TOKEN;
const password = process.env.ADMIN_PASSWORD;
if (!token || !password) {
  console.error('Set LCF_SEED_TOKEN (a collector token) and ADMIN_PASSWORD to post the seed.');
  process.exit(2);
}
const api = `${site!.replace(/\/+$/, '')}/api`;
const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
interface Result {
  index: number;
  status: string;
  id?: string;
  errors?: unknown;
  message?: string;
}

/** Sends one batch, waiting out the token's rate limit. The key makes a resent request safe. */
async function send(batch: Entry[], key: string): Promise<Result[]> {
  for (;;) {
    const response = await fetch(`${api}/records`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ records: batch }),
    });
    if (response.status === 429) {
      await sleep(Number(response.headers.get('retry-after') ?? 30) + 1);
      continue;
    }
    if (!response.ok) throw new Error(`POST /api/records answered ${response.status}: ${await response.text()}`);
    return ((await response.json()) as { results: Result[] }).results;
  }
}

const tally = new Map<string, number>();
for (const batch of batches) {
  const key = createHash('sha256').update(JSON.stringify(batch.map(({ observed_at: _, ...rest }) => rest))).digest('hex').slice(0, 40);
  // A record the postcode service could not place yet is sent again (with the rest of its batch,
  // whose accepted records then come back as duplicates) after a pause, up to three times.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const results = await send(batch, `seed-${key}-${attempt}`);
    for (const result of results) {
      const entry = batch[result.index];
      const name = String(entry?.data?.name_en ?? entry?.data?.name_zh ?? entry?.data?.publication ?? entry?.kind);
      tally.set(result.status, (tally.get(result.status) ?? 0) + 1);
      if (result.status !== 'accepted') {
        console.log(`  ${result.status} ${entry?.kind} ${name} ${result.message ?? ''}${result.errors ? JSON.stringify(result.errors) : ''}`);
        continue;
      }
      const decided = await fetch(`${api}/admin/records/${result.id}/decide`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'verified', reason: 'Launch seed: checked against its source page before the site opened.' }),
      });
      if (!decided.ok) console.log(`  could not verify ${result.id}: ${decided.status} ${await decided.text()}`);
    }
    if (!results.some((result) => result.status === 'retry_later')) break;
    await sleep(30);
  }
}
console.log([...tally].map(([status, count]) => `${count} ${status}`).join(', '));
