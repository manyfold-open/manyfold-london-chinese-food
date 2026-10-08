/**
 * Leads for collectors: places in London that may serve Chinese food, from two open sources.
 *
 *   OpenStreetMap (ODbL)            nodes and ways tagged with a Chinese cuisine, bubble tea, or a
 *                                   Chinese supermarket's name, in the Greater London box
 *   Food Standards Agency (OGL)     every food business London's 33 authorities inspect, kept when
 *                                   its name looks Chinese
 *
 * A lead is a hint, never published (AGENTS.md, invariant 9): a collector finds the place's own
 * page, checks it, and sends it as a place, or dismisses the lead. No hygiene rating is ever read
 * into a lead, and OpenStreetMap's coordinates are not kept.
 *
 *   node scripts/leads.ts --out leads.json                      fetch and write the leads
 *   node scripts/leads.ts --in leads.json --post <site URL>     send them to /api/admin/leads
 *                                                               (ADMIN_PASSWORD from the environment)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalPostcode, normName } from '../src/shared/kinds.ts';

interface Lead {
  subject: string;
  name: string;
  address?: string;
  postcode?: string;
  hint?: string;
  sources?: string[];
  priority?: number;
}

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const UA = 'manyfold-london-chinese-food leads (hi@manyfold.ai)';

/* ───────── OpenStreetMap ───────── */

const CUISINES = 'chinese|cantonese|sichuan|szechuan|hunan|dim_sum|taiwanese|hong_kong|hot_pot|hotpot|dumpling|uyghur|xinjiang|dongbei|shanghai|yunnan|hakka|bubble_tea|lanzhou';
const GROCERS = 'Wing Yip|Loon Fung|See Woo|Hoo Hing|Tian Tian|Longdan|New Loon Moon|Oriental|Chinese|Asia';

async function osmLeads(): Promise<Lead[]> {
  const query = `[out:json][timeout:180];
(
  nwr["cuisine"~"${CUISINES}"](51.28,-0.51,51.69,0.33);
  nwr["shop"~"supermarket|convenience|deli"]["name"~"${GROCERS}",i](51.28,-0.51,51.69,0.33);
);
out center tags;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
  const { elements } = (await response.json()) as { elements: { type: string; id: number; tags?: Record<string, string> }[] };
  return elements
    .filter((element) => element.tags?.name || element.tags?.['name:zh'])
    .map((element) => {
      const tags = element.tags!;
      const address = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
      return {
        subject: `osm:${element.type}/${element.id}`,
        name: tags.name ?? tags['name:zh']!,
        ...(address ? { address } : {}),
        ...(tags['addr:postcode'] ? { postcode: canonicalPostcode(tags['addr:postcode']) ?? tags['addr:postcode'] } : {}),
        hint: [tags.cuisine && `cuisine=${tags.cuisine}`, tags.shop && `shop=${tags.shop}`, tags.amenity && `amenity=${tags.amenity}`, tags['name:zh'] && `name:zh=${tags['name:zh']}`]
          .filter(Boolean)
          .join('; '),
        sources: [`https://www.openstreetmap.org/${element.type}/${element.id}`, ...(tags.website ? [tags.website] : [])],
        priority: tags.cuisine ? 2 : 1,
      };
    });
}

/* ───────── Food Standards Agency ───────── */

/** Words a Chinese food business's name often holds. A hint only: collectors check every lead. */
const CHINESE_NAME = new RegExp(
  [
    'chinese', 'china', 'wok', 'dragon', 'panda', 'jade', 'lotus', 'bamboo', 'dim ?sum', 'dumpling', 'noodle', 'sichuan', 'szechuan',
    'hunan', 'canton', 'hong ?kong', 'peking', 'beijing', 'shanghai', 'xi.?an', 'taiwan', 'bubble ?tea', 'boba', 'mandarin', 'dynasty',
    'golden (?:dragon|palace|city|house|wok|bowl|china)', 'oriental', 'chopstick', 'hot ?pot', 'mala', 'bao', 'lanzhou', 'dongbei',
    'yunnan', 'hakka', 'wing yip', 'loon fung', 'see woo', 'tian tian', 'longdan', 'chuan', 'xiao long',
  ].join('|'),
  'i',
);
/** Businesses whose names match a word above but serve no food. */
const NOT_FOOD = /pharmacy|chemist|slimming|post office|barber|nails?\b|hair|beauty|salon|launderette|clinic|school|nursery|dental|optician|massage|tattoo|gym|fitness|hotel/i;
const HAN = /\p{Script=Han}/u;

const FOOD_TYPES = new Set(['Restaurant/Cafe/Canteen', 'Takeaway/sandwich shop', 'Retailers - other', 'Retailers - supermarkets/hypermarkets', 'Other catering premises']);

interface Authority {
  LocalAuthorityId: number;
  Name: string;
  RegionName: string;
  FileName: string;
}

const tag = (xml: string, name: string): string | undefined => {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match?.[1]?.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').trim() || undefined;
};

async function fsaLeads(): Promise<Lead[]> {
  const response = await fetch('https://api.ratings.food.gov.uk/Authorities', { headers: { 'x-api-version': '2', accept: 'application/json', 'user-agent': UA } });
  if (!response.ok) throw new Error(`FSA answered ${response.status}`);
  const { authorities } = (await response.json()) as { authorities: Authority[] };
  const london = authorities.filter((authority) => authority.RegionName === 'London');
  const leads: Lead[] = [];
  for (const authority of london) {
    const file = await fetch(authority.FileName, { headers: { 'user-agent': UA } });
    if (!file.ok) {
      console.error(`skipped ${authority.Name}: HTTP ${file.status}`);
      continue;
    }
    const xml = await file.text();
    for (const block of xml.split('<EstablishmentDetail>').slice(1)) {
      const name = tag(block, 'BusinessName');
      const type = tag(block, 'BusinessType');
      if (!name || !type || !FOOD_TYPES.has(type) || !(CHINESE_NAME.test(name) || HAN.test(name)) || NOT_FOOD.test(name)) continue;
      const id = tag(block, 'FHRSID');
      const address = [tag(block, 'AddressLine1'), tag(block, 'AddressLine2'), tag(block, 'AddressLine3')].filter(Boolean).join(', ');
      const postcode = tag(block, 'PostCode');
      // Never read the hygiene rating (RatingValue) into a lead.
      leads.push({
        subject: `fsa:${id}`,
        name,
        ...(address ? { address } : {}),
        ...(postcode ? { postcode: canonicalPostcode(postcode) ?? postcode } : {}),
        hint: `FSA: ${type}, ${authority.Name}`,
        sources: [`https://ratings.food.gov.uk/business/${id}`],
        priority: 1,
      });
    }
    console.error(`${authority.Name}: ${leads.length} leads so far`);
  }
  return leads;
}

/* ───────── together ───────── */

/** One lead per place: an OSM lead and an FSA lead at the same postcode with the same name are one. */
function merge(leads: Lead[]): Lead[] {
  const byKey = new Map<string, Lead>();
  for (const lead of leads) {
    const key = lead.postcode ? `${lead.postcode.replace(/\s+/g, '')}|${normName(lead.name)}` : lead.subject;
    const known = byKey.get(key);
    if (!known) byKey.set(key, lead);
    else {
      known.sources = [...new Set([...(known.sources ?? []), ...(lead.sources ?? [])])];
      known.hint = [known.hint, lead.hint].filter(Boolean).join(' | ');
      known.priority = Math.max(known.priority ?? 0, lead.priority ?? 0) + 1;
      known.address ??= lead.address;
    }
  }
  return [...byKey.values()];
}

async function post(site: string, leads: Lead[]): Promise<void> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('Set ADMIN_PASSWORD in the environment to post leads.');
  for (let start = 0; start < leads.length; start += 500) {
    const chunk = leads.slice(start, start + 500);
    const response = await fetch(`${site.replace(/\/+$/, '')}/api/admin/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-password': password },
      body: JSON.stringify({ leads: chunk }),
    });
    console.error(`leads ${start}–${start + chunk.length - 1}: ${response.status} ${await response.text()}`);
    if (!response.ok) process.exit(1);
  }
}

const input = option('--in');
const leads = input ? (JSON.parse(readFileSync(new URL(input, `file://${process.cwd()}/`), 'utf8')) as Lead[]) : merge([...(await osmLeads()), ...(await fsaLeads())]);
console.error(`${leads.length} leads`);
const out = option('--out');
if (out) writeFileSync(new URL(out, `file://${process.cwd()}/`), `${JSON.stringify(leads, null, 1)}\n`);
const site = option('--post');
if (site) await post(site, leads);
