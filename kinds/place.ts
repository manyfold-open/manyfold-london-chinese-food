import { defineKind } from '../src/shared/kinds.ts';
import { CATEGORIES, CATEGORY_LABELS, CUISINES, CUISINE_LABELS, PLACE_STATUSES, STATUS_LABELS } from './vocab.ts';

/** A place to eat or buy Chinese food, at one address in Greater London. */
export default defineKind({
  kind: 'place',
  title: { en: 'Place', zh: '店铺' },
  noun: { en: { one: 'place', other: 'places' }, zh: '家店' },
  fields: {
    name_en: {
      type: 'text', max: 120, label: { en: 'English name', zh: '英文名' },
      help: 'The name in Latin letters as the place writes it on its shopfront, website or listings.',
    },
    name_zh: {
      type: 'text', max: 60, label: { en: 'Chinese name', zh: '中文名' },
      help: 'The name in Chinese characters as the place writes it, simplified or traditional as written. Leave out when it has none.',
    },
    category: {
      type: 'enum', required: true, label: { en: 'Kind of place', zh: '类别' }, values: CATEGORIES, valueLabels: CATEGORY_LABELS,
      help: 'restaurant if most people eat in; takeaway if it mainly sells food to take away; bakery-dessert, tea-drinks or grocery for those.',
    },
    cuisines: {
      type: 'tags', max: 6, label: { en: 'Cuisines', zh: '菜系' }, values: CUISINES, valueLabels: CUISINE_LABELS,
      help: 'What it serves, most important first, only as its menu or a source shows.',
    },
    address: {
      type: 'text', max: 200, required: true, label: { en: 'Address', zh: '地址' },
      help: 'The street address without the postcode, e.g. "28 Gerrard Street"; add a unit or floor when the page gives one.',
    },
    postcode: {
      type: 'postcode', required: true, label: { en: 'Postcode', zh: '邮编' },
      help: 'The full postcode, e.g. W1D 6JW. It must be in Greater London.',
    },
    website: {
      type: 'url', label: { en: 'Website', zh: '网站' },
      help: "The place's own website or its own page on social media; not a listing site.",
    },
    phone: {
      type: 'text', max: 20, label: { en: 'Phone', zh: '电话' },
      pattern: { source: '^\\+?[0-9][0-9 ()-]{5,19}$', means: 'a phone number: digits, spaces, brackets and hyphens, with an optional leading +' },
    },
    brand: {
      type: 'ref', to: ['brand'], label: { en: 'Brand', zh: '品牌' },
      help: 'For a branch of a chain: the brand record id (rec_...), or "#n" for a brand sent earlier in the same batch.',
    },
    trading: {
      type: 'enum', required: true, label: { en: 'Trading', zh: '营业状态' }, values: PLACE_STATUSES, valueLabels: STATUS_LABELS,
      help: 'open, temporarily-closed or closed, as the most recent source says.',
    },
    opened_on: { type: 'date', partial: true, label: { en: 'Opened', zh: '开业时间' }, help: 'When it opened, if a page says.' },
    closed_on: { type: 'date', partial: true, label: { en: 'Closed', zh: '关闭时间' }, help: 'When it closed, if a page says.' },
    lat: { type: 'number', server: true, label: { en: 'Latitude', zh: '纬度' } },
    lng: { type: 'number', server: true, label: { en: 'Longitude', zh: '经度' } },
    borough: { type: 'text', max: 60, server: true, label: { en: 'Borough', zh: '行政区' } },
    borough_code: { type: 'text', max: 12, server: true, label: { en: 'Borough code', zh: '行政区代码' } },
    outcode: { type: 'text', max: 4, server: true, label: { en: 'Postcode district', zh: '邮区' } },
  },
  identity: ['postcode', { firstOf: ['name_en', 'name_zh'] }],
  provenance: 'quote',
  submit: 'agents',
  rules: [
    { rule: 'oneOf', fields: ['name_en', 'name_zh'] },
    { rule: 'onlyWhen', field: 'closed_on', by: 'trading', values: ['closed', 'temporarily-closed'] },
    { rule: 'noRating', fields: ['$evidence'] },
  ],
  accept: { opened_on: { to: 'today' }, closed_on: { to: 'today' } },
  updatable: true,
  recheckAfterDays: 60,
  pendingCap: { start: 10, max: 100 },
  example: {
    data: {
      name_en: 'Example Noodle House',
      name_zh: '示例面馆',
      category: 'restaurant',
      cuisines: ['shaanxi', 'noodles'],
      address: '12 Example Street',
      postcode: 'W1D 6JW',
      website: 'https://example.com/',
      trading: 'open',
    },
    source_url: 'https://example.com/contact',
    evidence: 'Example Noodle House, 12 Example Street, London W1D 6JW. Hand-pulled noodles from Xi’an, open seven days a week.',
  },
  scope: {
    in: 'Places in Greater London where you can eat or buy Chinese food: restaurants, takeaways, Chinese bakeries and dessert shops, bubble tea and Chinese tea shops, Chinese supermarkets and delis. Every regional cuisine counts, as do Hong Kong, Taiwan and Macau, and Chinese diaspora cooking such as British-Chinese and Malaysian-Chinese.',
    out: 'Places outside Greater London; chains whose menu is mostly not Chinese (sushi, Thai, Korean, Japanese ramen); market stalls and pop-ups without a fixed address; kitchens that only deliver and have no address of their own; places that closed before 2020.',
  },
  sourceHints: [
    "the place's own website or social media page",
    'its listing on Google Maps, Deliveroo, Uber Eats or Just Eat',
    "the Food Standards Agency's listing (ratings.food.gov.uk) for the exact name and address, never its hygiene score",
    'articles and reviews about it',
  ],
  maintainerChecks: [
    'The place exists at that address and serves or sells Chinese food.',
    'The names are exactly as the place writes them.',
    'The category and cuisines fit what it serves.',
    'Whether it is trading (open, temporarily closed, closed) is what the most recent source says.',
    'It is not another record of a place at the same postcode under a different spelling.',
  ],
  display: ['name_en', 'name_zh'],
});
