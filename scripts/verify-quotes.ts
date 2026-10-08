/**
 * Checks a batch of records before it is sent (AGENTS.md, invariant 9): each against its kind's
 * rules, as the submit API would, and each passage against its source page. Reads the network,
 * changes nothing. Exits 1 when a record is invalid or a quote is not on its page; pages that
 * cannot be read are listed for a person.
 *
 *   node scripts/verify-quotes.ts batch.json [more.json ...]
 *
 * A batch is the body of POST /api/records: {"records": [...]} or the array itself.
 */

import { readFileSync } from 'node:fs';
import { checkEntries, type Entry } from './lib/check.ts';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/verify-quotes.ts batch.json [more.json ...]');
  process.exit(2);
}
let failed = 0;
for (const file of files) {
  const parsed = JSON.parse(readFileSync(new URL(file, `file://${process.cwd()}/`), 'utf8')) as Entry[] | { records: Entry[] };
  const entries = Array.isArray(parsed) ? parsed : parsed.records;
  const report = await checkEntries(entries);
  console.log(`\n${file}: ${entries.length} records\n${report.lines.join('\n')}`);
  console.log(`${report.invalid} invalid, ${report.missing} quote(s) missing, ${report.unreadable} page(s) unreadable`);
  failed += report.invalid + report.missing;
}
process.exit(failed > 0 ? 1 : 0);
