/**
 * Qualifies the open leads from the Food Standards Agency before collectors get them, so a lead
 * handed out can be finished (AGENTS.md, invariant 24). For each:
 *
 *   the FSA no longer lists it                  dismissed: it closed or was registered again
 *   Just Eat lists it at that postcode, Chinese  food_evidence (the listing) and priority 3
 *   Just Eat lists it there, plainly not Chinese dismissed, with the cuisines it lists
 *   nothing found                                priority 0: it waits at the back
 *
 * Reads only public APIs (the FSA's, Just Eat's listings by postcode), never a hygiene score or a
 * rating, and writes through the admin API. Run it after importing leads, and now and then.
 *
 *   ADMIN_PASSWORD=… node scripts/qualify-leads.ts --site https://app.manyfold.ai/london-chinese-food [--dry-run] [--limit 100]
 */

import { canonicalPostcode } from '../src/shared/kinds.ts';
import { namesAlike } from '../src/shared/names.ts';

interface Lead {
  subject: string;
  payload: { name?: string; postcode?: string; address?: string };
}

interface Update {
  subject: string;
  priority?: number;
  food_evidence?: { url: string; site: string; name: string; cuisines: string[] };
  dismiss?: string;
}

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const site = option('--site');
const password = process.env.ADMIN_PASSWORD;
const dryRun = args.includes('--dry-run');
const limit = Number(option('--limit') ?? Infinity);
if (!site || !password) {
  console.error('Usage: ADMIN_PASSWORD=… node scripts/qualify-leads.ts --site <site URL> [--dry-run] [--limit N]');
  process.exit(2);
}

const UA = 'manyfold-london-chinese-food qualify-leads (hi@manyfold.ai)';
/** Cuisines Just Eat gives Chinese places, bubble tea and Chinese supermarkets. */
const CHINESE = /chinese|cantonese|szechuan|sichuan|dim sum|oriental|noodle|dumpling|bubble tea|hong kong|taiwan|hot ?pot|asian/i;
/** Cuisines that, alone, say a place serves no Chinese food. */
const OTHER = /pizza|kebab|burger|chicken|fish & chips|indian|curry|turkish|italian|caribbean|african|mexican|thai|japanese|sushi|korean|vietnamese|breakfast|caf[eé]|sandwich|dessert|ice cream|alcohol|grill|peri peri|halal|british|lebanese|greek/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function admin<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${site}/api/admin${path}`, {
    ...init,
    headers: { 'x-admin-password': password!, 'content-type': 'application/json', 'user-agent': UA, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | 'gone' | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 404) return 'gone';
      if (response.status === 429 || response.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

async function openLeads(): Promise<Lead[]> {
  const leads: Lead[] = [];
  let after = '';
  for (;;) {
    const { leads: page } = await admin<{ leads: Lead[] }>(`/leads?prefix=fsa:&after=${encodeURIComponent(after)}&limit=500`);
    leads.push(...page);
    if (page.length < 500) return leads;
    after = page.at(-1)!.subject;
  }
}

interface JustEatRestaurant {
  name?: string;
  uniqueName?: string;
  address?: { postalCode?: string };
  cuisines?: { name?: string }[];
}

const justEatByPostcode = new Map<string, JustEatRestaurant[] | null>();

async function justEatAt(postcode: string): Promise<JustEatRestaurant[] | null> {
  if (!justEatByPostcode.has(postcode)) {
    const found = await getJson<{ restaurants?: JustEatRestaurant[] }>(`https://uk.api.just-eat.io/discovery/uk/restaurants/enriched/bypostcode/${postcode.replace(' ', '')}`);
    justEatByPostcode.set(
      postcode,
      found && found !== 'gone' ? (found.restaurants ?? []).filter((row) => canonicalPostcode(row.address?.postalCode ?? '') === postcode) : null,
    );
    await sleep(250);
  }
  return justEatByPostcode.get(postcode)!;
}

async function qualify(lead: Lead, today: string): Promise<Update> {
  const id = lead.subject.slice('fsa:'.length);
  const fsa = await getJson<{ BusinessName?: string }>(`https://api.ratings.food.gov.uk/Establishments/${encodeURIComponent(id)}`, { 'x-api-version': '2' });
  await sleep(150);
  if (fsa === 'gone') return { subject: lead.subject, dismiss: `The FSA no longer lists business ${id} (checked ${today}): it closed, or was registered again under another id.` };
  const postcode = canonicalPostcode(lead.payload.postcode ?? '');
  const name = lead.payload.name ?? '';
  if (!postcode || !name) return { subject: lead.subject, priority: 0 };
  const listings = await justEatAt(postcode);
  const match = listings?.find((row) => row.name && namesAlike({ name_en: row.name }, { name_en: name }));
  if (!match) return { subject: lead.subject, priority: 0 };
  const cuisines = (match.cuisines ?? []).map((cuisine) => cuisine.name ?? '').filter(Boolean);
  if (cuisines.some((cuisine) => CHINESE.test(cuisine))) {
    return {
      subject: lead.subject,
      priority: 3,
      food_evidence: { url: `https://www.just-eat.co.uk/restaurants-${match.uniqueName}/menu`, site: 'just-eat', name: match.name!, cuisines },
    };
  }
  if (cuisines.length > 0 && cuisines.every((cuisine) => OTHER.test(cuisine))) {
    return { subject: lead.subject, dismiss: `Just Eat lists "${match.name}" at ${postcode} as ${cuisines.join(', ')}: no Chinese food (checked ${today}).` };
  }
  return { subject: lead.subject, priority: 0 };
}

const today = new Date().toISOString().slice(0, 10);
const leads = (await openLeads()).slice(0, limit);
console.error(`${leads.length} open FSA leads`);
const updates: Update[] = [];
for (const [index, lead] of leads.entries()) {
  updates.push(await qualify(lead, today));
  if ((index + 1) % 50 === 0) console.error(`checked ${index + 1}`);
}
const summary = {
  evidence: updates.filter((update) => update.food_evidence).length,
  dismissed: updates.filter((update) => update.dismiss).length,
  waiting: updates.filter((update) => !update.food_evidence && !update.dismiss).length,
};
console.log(JSON.stringify(summary));
for (const update of updates.filter((item) => item.dismiss || item.food_evidence).slice(0, 15)) console.log(JSON.stringify(update));
if (!dryRun) {
  for (let start = 0; start < updates.length; start += 200) {
    const result = await admin<{ updated: number; dismissed: number }>('/leads', { method: 'PATCH', body: JSON.stringify({ leads: updates.slice(start, start + 200) }) });
    console.error(`sent ${Math.min(start + 200, updates.length)}: ${JSON.stringify(result)}`);
  }
}
