/**
 * Checking records before they are sent: against their kind's rules, as the submit API would, and
 * each passage against its source page (src/shared/quote.ts). Used by scripts/verify-quotes.ts and
 * scripts/seed.ts.
 */

import { kindConfig } from '../../kinds/index.ts';
import { checkAccept, validateProvenance, validateRecordData } from '../../src/shared/kinds.ts';
import { quoteOnPage } from '../../src/shared/quote.ts';

export interface Entry {
  kind?: string;
  data?: Record<string, unknown>;
  source_url?: string;
  evidence?: string;
  observed_at?: string;
}

export interface CheckReport {
  lines: string[];
  invalid: number;
  missing: number;
  unreadable: number;
}

const pages = new Map<string, Promise<string | null>>();

export function fetchPage(url: string): Promise<string | null> {
  if (!pages.has(url)) {
    pages.set(
      url,
      fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; LondonChineseFood quote check; +https://app.manyfold.ai/london-chinese-food/)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      })
        .then(async (response) => (response.ok ? await response.text() : null))
        .catch(() => null),
    );
  }
  return pages.get(url)!;
}

export async function checkEntries(entries: readonly Entry[], now = new Date()): Promise<CheckReport> {
  const report: CheckReport = { lines: [], invalid: 0, missing: 0, unreadable: 0 };
  const outcomes = await Promise.all(
    entries.map(async (entry, index) => {
      const config = entry.kind ? kindConfig(entry.kind) : undefined;
      const name = String(entry.data?.name_en ?? entry.data?.name_zh ?? entry.data?.publication ?? entry.data?.menu ?? '');
      if (!config) {
        report.invalid += 1;
        return `#${index} ${entry.kind}: unknown kind`;
      }
      const data = validateRecordData(config, entry.data);
      const provenance = validateProvenance(config, { ...entry, observed_at: entry.observed_at ?? now.toISOString() }, now);
      const problems = [
        ...(data.ok ? checkAccept(config, data.value, now.toISOString().slice(0, 10)) : data.errors),
        ...(provenance.ok ? [] : provenance.errors),
      ].map((error) => `${error.field} ${error.message}`);
      if (problems.length) {
        report.invalid += 1;
        return `#${index} ${entry.kind} ${name}: INVALID\n    ${problems.join('\n    ')}`;
      }
      const html = await fetchPage(entry.source_url!);
      if (html === null) {
        report.unreadable += 1;
        return `#${index} ${entry.kind} ${name}: unreadable ${entry.source_url}`;
      }
      if (!quoteOnPage(html, entry.evidence!)) {
        report.missing += 1;
        return `#${index} ${entry.kind} ${name}: QUOTE MISSING on ${entry.source_url}\n    "${entry.evidence}"`;
      }
      return `#${index} ${entry.kind} ${name}: ok`;
    }),
  );
  report.lines.push(...outcomes);
  return report;
}
