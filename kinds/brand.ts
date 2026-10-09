import { defineKind } from '../src/shared/kinds.ts';
import { CATEGORIES, CATEGORY_LABELS, CUISINES, CUISINE_LABELS } from './vocab.ts';

/** A chain whose places share a menu: one menu for the brand serves every branch. */
export default defineKind({
  kind: 'brand',
  title: { en: 'Brand', zh: '品牌' },
  noun: { en: { one: 'brand', other: 'brands' }, zh: '个品牌' },
  fields: {
    name_en: { type: 'text', max: 120, label: { en: 'English name', zh: '英文名' }, help: 'The brand name in Latin letters as it writes it.' },
    name_zh: { type: 'text', max: 60, label: { en: 'Chinese name', zh: '中文名' }, help: 'The brand name in Chinese characters, if it has one.' },
    website: {
      type: 'url', homePage: true, required: true, label: { en: 'Website', zh: '网站' },
      help: "The brand's own website; only its home page is kept.",
    },
    category: { type: 'enum', required: true, label: { en: 'Kind of place', zh: '类别' }, values: CATEGORIES, valueLabels: CATEGORY_LABELS },
    cuisines: { type: 'tags', max: 6, label: { en: 'Cuisines', zh: '菜系' }, values: CUISINES, valueLabels: CUISINE_LABELS },
  },
  identity: ['website'],
  provenance: 'quote',
  submit: 'agents',
  rules: [
    { rule: 'oneOf', fields: ['name_en', 'name_zh'] },
    { rule: 'noRating', fields: ['$evidence'] },
  ],
  updatable: true,
  recheckAfterDays: 180,
  pendingCap: { start: 5, max: 20 },
  example: {
    data: { name_en: 'Example Tea', name_zh: '示例茶饮', website: 'https://example.com/', category: 'tea-drinks', cuisines: ['bubble-tea'] },
    source_url: 'https://example.com/about',
    evidence: 'Example Tea has twelve shops across London, all pouring the same menu of fresh fruit teas and milk teas.',
  },
  scope: {
    in: 'Chains with a place in London whose places share one menu, such as bubble tea and dessert franchises, noodle chains and supermarket chains (for a supermarket, one range of goods). A chain with one London place counts. Send a brand once, then each of its London places as a place with brand set.',
    out: 'A single restaurant (send it as a place only); a group of restaurants whose branches publish different menus (send each branch as a place); a chain with no place trading in London.',
  },
  sourceHints: ["the brand's own website", 'its store finder or locations page'],
  maintainerChecks: [
    'The brand exists, has a place trading in London, and its website is its own (only the home page is kept).',
    'Its places share one menu. A franchise that supplies every shop (bubble tea, desserts) or a supermarket chain with one range counts even when a branch page shows no menu. A restaurant group whose branches publish different menus does not: reject it, saying its branches go in as places.',
    'Names are as the brand writes them.',
  ],
  display: ['name_en', 'name_zh'],
});
