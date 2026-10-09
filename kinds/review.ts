import { defineKind } from '../src/shared/kinds.ts';
import { ARCHIVE_HOSTS, LANGUAGES, LANGUAGE_LABELS, NAMED_SOURCE_TYPES, SOURCE_TYPES, SOURCE_TYPE_LABELS } from './vocab.ts';

/**
 * One excerpt of what someone wrote about a place, word for word, with a link to the whole of
 * it. Never a score: readers judge a place by reading what people said over the years.
 */
export default defineKind({
  kind: 'review',
  title: { en: 'Review excerpt', zh: '评价摘录' },
  noun: { en: { one: 'review excerpt', other: 'review excerpts' }, zh: '条评价' },
  fields: {
    place: { type: 'ref', to: ['place'], required: true, label: { en: 'Place', zh: '店铺' }, help: 'The place reviewed: its record id (rec_...) or "#n" for a place sent earlier in the same batch.' },
    published_on: {
      type: 'date', partial: true, required: true, label: { en: 'Published', zh: '发布时间' },
      help: 'When the review was published, as the page dates it: YYYY-MM-DD, or YYYY-MM or YYYY when that is all it gives. A relative date ("3 months ago") counts back from today: give the month it points to, or just the year for "a year ago" and older.',
    },
    publication: {
      type: 'text', max: 80, required: true, label: { en: 'Published in', zh: '来源' },
      help: 'Where it appeared: the publication, blog, forum or platform, named as this site already names it so one source keeps one history: "The Guardian", "The Infatuation", "Time Out" (not "Time Out London"), "MICHELIN Guide", "红领巾 Red Scarf", "Google Maps", "大众点评", "小红书", "r/london". A blog goes by its own title.',
    },
    source_type: { type: 'enum', required: true, label: { en: 'Source type', zh: '来源类型' }, values: SOURCE_TYPES, valueLabels: SOURCE_TYPE_LABELS },
    author: {
      type: 'text', max: 80, label: { en: 'Author', zh: '作者' },
      help: 'The writer, only for critics, journalists, bloggers and video makers publishing under their own name. Never for people reviewing on platforms or forums.',
    },
    language: { type: 'enum', required: true, label: { en: 'Language', zh: '语言' }, values: LANGUAGES, valueLabels: LANGUAGE_LABELS, help: 'The language of the excerpt.' },
    dishes: {
      type: 'list', max: 15, label: { en: 'Dishes mentioned', zh: '提到的菜' },
      help: 'Dishes the excerpt names, as it names them.',
      item: {
        name: { type: 'text', max: 60, required: true, label: { en: 'Name', zh: '菜名' }, help: 'As the excerpt writes it.' },
        canonical: { type: 'text', max: 40, label: { en: 'Standard dish', zh: '标准菜名' }, help: 'Its standard Chinese name, when you know it.' },
      },
    },
    translation: {
      type: 'text', max: 600, label: { en: 'Translation', zh: '翻译' },
      help: 'Your faithful translation of the excerpt into the other language: English for a Chinese excerpt, Chinese for an English one. Pages show it as a machine translation.',
    },
    archive_url: {
      type: 'url', hosts: ARCHIVE_HOSTS, label: { en: 'Archived copy', zh: '存档' },
      help: 'A snapshot of the page on web.archive.org or archive.ph, when one exists. It lets a maintainer check a page that is hard to open, and keeps the source when the page goes.',
    },
  },
  parent: 'place',
  identity: ['place', '$source_url', '$evidence'],
  provenance: 'excerpt',
  excerptMax: { latin: 300, cjk: 150 },
  submit: 'agents',
  rules: [
    { rule: 'noRating', fields: ['$evidence', 'translation'] },
    { rule: 'onlyWhen', field: 'author', by: 'source_type', values: NAMED_SOURCE_TYPES },
    { rule: 'translation', field: 'translation', language: 'language' },
  ],
  accept: { published_on: { to: 'today' } },
  updatable: false,
  recheckAfterDays: null,
  pendingCap: { start: 30, max: 300 },
  perParent: { field: 'publication', max: 10 },
  example: {
    data: {
      place: 'rec_01k70q4mgw8b1r7f3s5t9v2x4y',
      published_on: '2026-05',
      publication: 'Example Food Blog',
      source_type: 'blog',
      author: 'A. Writer',
      language: 'en',
      dishes: [{ name: 'har gow', canonical: '虾饺' }],
      translation: '虾饺皮薄得几乎透明，里面是一整只虾；我们又点了一笼。',
    },
    source_url: 'https://example.com/2026/05/dim-sum-in-chinatown',
    evidence: 'The har gow had thin, almost translucent skins with a whole prawn inside; we ordered a second basket.',
  },
  scope: {
    in: 'What people wrote about places in this dataset, from any page you can read without logging in: food critics and writers, publications, blogs, forums such as Reddit, social posts, video descriptions, and review platforms such as Google Maps, TripAdvisor, Yelp, 大众点评 and 小红书. One excerpt per review: the passage that says most about the food or the visit. Prefer reviews from different years and sources over many from one.',
    out: 'Ratings and scores of any kind, which must stay out of the excerpt; passages that name or describe private people such as staff or other diners; promotional text by the place itself; reviews of another branch, or of the restaurant at an earlier address; passages about a whole chain that do not name this branch; round-ups that restate what other outlets said, and venue blurbs a directory writes by machine; anything you had to log in, pay or solve a captcha to read.',
  },
  sourceHints: [
    'critics and food writers (The Guardian, the Evening Standard, The Infatuation, Time Out, Hot Dinners, Eater London, Londonist)',
    'food blogs, Reddit (r/london, r/LondonFood) and other forums',
    'review platforms you can read without logging in: Google Maps, TripAdvisor, Yelp, 大众点评, 小红书',
    '公众号 articles, 知乎 and 豆瓣 for reviews in Chinese',
  ],
  maintainerChecks: [
    'The excerpt is on the page word for word (or on its archived copy), and is about this place, this branch. A passage about a whole chain fits a branch only when its entry names that branch or its address; a review of the restaurant at an earlier address is about another branch.',
    'Someone wrote it as a review: not a round-up that restates what other outlets said (it cites them as its sources), not a venue blurb a directory writes by machine, not promotional text by the place.',
    'One excerpt per review: a second excerpt from the same review of the same place is rejected.',
    'The date is when the page says the review was published; a guide that dates only the visit gives that month (YYYY-MM).',
    'The publication, source type and language are right.',
    'There is no score in it, and it names no private person.',
    "The author is given only when the page shows the writer's own name as its byline: not a pen name or handle, and not a name found only in the page's metadata.",
    'The translation, if any, says what the excerpt says: all of it, and nothing from the sentences after it.',
  ],
  display: ['publication'],
});
