import { defineKind } from '../src/shared/kinds.ts';
import { DIETARY, DIETARY_LABELS, MENU_LABELS, MENU_SOURCES, MENU_SOURCE_LABELS, MENU_TYPES } from './vocab.ts';

/**
 * One menu of a place or of a brand, as printed: its sections, dishes and prices. A newer
 * version of the same menu is sent as an update to it, so its history keeps every price.
 */
export default defineKind({
  kind: 'menu',
  title: { en: 'Menu', zh: '菜单' },
  noun: { en: { one: 'menu', other: 'menus' }, zh: '份菜单' },
  fields: {
    owner: {
      type: 'ref', to: ['place', 'brand'], required: true, label: { en: 'Belongs to', zh: '所属' },
      help: 'The place this menu is for (rec_... or "#n"), or the brand, for a menu every branch of a chain shares.',
    },
    menu: {
      type: 'enum', required: true, label: { en: 'Which menu', zh: '哪份菜单' }, values: MENU_TYPES, valueLabels: MENU_LABELS,
      help: 'main for the main menu; dim-sum, lunch, set, drinks, dessert or takeaway when the place keeps that menu apart; other with a title.',
    },
    title: { type: 'text', max: 60, label: { en: 'Title', zh: '标题' }, help: 'The menu title as printed, e.g. "Weekend brunch". Required when menu is other.' },
    source_kind: {
      type: 'enum', required: true, label: { en: 'Read from', zh: '来源' }, values: MENU_SOURCES, valueLabels: MENU_SOURCE_LABELS,
      help: 'Where you read it. delivery-app when it comes from Deliveroo, Uber Eats, Just Eat or similar: prices there are often higher than in the place.',
    },
    photo: {
      type: 'ref', to: ['photo'], label: { en: 'Menu photo', zh: '菜单照片' },
      help: 'When you transcribed a menu photo a visitor uploaded here: that photo record id. Required when source_kind is visitor-photo.',
    },
    items: {
      type: 'list', max: 600, required: true, label: { en: 'Items', zh: '菜品' },
      help: 'Every item the menu lists, in its order. Copy names, prices and notes as printed; leave out anything it does not print.',
      oneOf: ['name_zh', 'name_en'],
      item: {
        section: { type: 'text', max: 60, label: { en: 'Section', zh: '分类' }, help: 'The heading the item is under, as printed, e.g. "点心 Dim sum".' },
        name_zh: { type: 'text', max: 60, label: { en: 'Chinese name', zh: '中文名' }, help: 'As printed.' },
        name_en: { type: 'text', max: 120, label: { en: 'English name', zh: '英文名' }, help: 'As printed.' },
        price_pence: {
          type: 'number', integer: true, min: 0, max: 100000, display: 'pence', label: { en: 'Price', zh: '价格' },
          help: 'In pence: £12.80 is 1280. The first price when there are several sizes; put the rest in price_note.',
        },
        price_note: { type: 'text', max: 40, label: { en: 'Price note', zh: '价格备注' }, help: 'As printed, e.g. "per piece", "large £14.50", "market price".' },
        description: { type: 'text', max: 200, label: { en: 'Description', zh: '描述' }, help: 'The description the menu prints, if any.' },
        dietary: {
          type: 'tags', max: 4, label: { en: 'Dietary', zh: '饮食标注' }, values: DIETARY, valueLabels: DIETARY_LABELS,
          help: 'Only marks the menu prints (a V, a vegan leaf, halal).',
        },
        spicy: { type: 'number', integer: true, min: 0, max: 3, label: { en: 'Spicy', zh: '辣度' }, help: 'The number of chillies the menu prints, 0 to 3.' },
        canonical: {
          type: 'text', max: 40, label: { en: 'Standard dish', zh: '标准菜名' },
          help: 'The standard Chinese name of the dish when you know it (see the dish list in your instructions), e.g. 小笼包 for "Xiao Long Bao (6)".',
        },
      },
    },
  },
  parent: 'owner',
  identity: ['owner', 'menu', 'title'],
  provenance: 'quote',
  submit: 'agents',
  rules: [
    { rule: 'requiredWhen', field: 'title', when: { menu: 'other' } },
    { rule: 'requiredWhen', field: 'photo', when: { source_kind: 'visitor-photo' } },
    { rule: 'noRating', fields: ['$evidence', 'items.description', 'items.price_note'] },
  ],
  updatable: true,
  recheckAfterDays: 120,
  pendingCap: { start: 5, max: 50 },
  example: {
    data: {
      owner: 'rec_01k70q4mgw8b1r7f3s5t9v2x4y',
      menu: 'dim-sum',
      source_kind: 'website',
      items: [
        { section: '点心 Dim sum', name_zh: '虾饺', name_en: 'Har gow', price_pence: 650, canonical: '虾饺' },
        { section: '点心 Dim sum', name_zh: '烧卖', name_en: 'Siu mai', price_pence: 620, canonical: '烧卖' },
      ],
    },
    source_url: 'https://example.com/menu',
    evidence: '虾饺 Har Gow £6.50 烧卖 Siu Mai £6.20',
  },
  scope: {
    in: "Menus of places (and brands) in this dataset, item by item as printed: from the place's website, a PDF or image of its menu, a delivery app's menu (source_kind delivery-app), or a menu photo a visitor uploaded here.",
    out: 'Dishes you only read about in a review (send those with the review, in its dishes field); prices you were not shown; menus a source dates more than two years back.',
  },
  sourceHints: ["the place's website and its menu PDFs or images", 'its menu on Deliveroo, Uber Eats or Just Eat', 'menu photos visitors uploaded here (GET /api/work?type=transcribe)'],
  maintainerChecks: [
    'Every item, name and price matches the source; nothing the source lists is missing, nothing is added.',
    'The menu belongs to this place (or every branch of this brand).',
    'source_kind says where it was read; a delivery app is marked so.',
    'Standard dish names, where given, are the right dish.',
  ],
  display: ['title', 'menu'],
});
