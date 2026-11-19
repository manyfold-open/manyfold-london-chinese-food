/**
 * Narra Messenger Gateway configuration for London Chinese Food (`lcf-guide`).
 *
 * Uses `@manyfold/narra-agent-kit/worker` for decentralized Matrix sync + per-room
 * Durable Object coordination, D1 3-layer memory, trilingual `zh-Hant`/`zh-Hans`/`en`
 * formatting with bare URLs, and Manyfold A2A fallback.
 *
 * Invariants:
 * - NO ratings, stars, scores, or quality rankings anywhere in replies or updates.
 * - Bare `https://...` URLs only (never Markdown links or punctuation touching URLs).
 * - Strict `zh-Hant` / `zh-Hans` / `en` script purity matching `decision.detectedLang`.
 * - Zero external calls when `NARRA_GATEWAY_ENABLED` is not `'on'`.
 */

import {
  stripAgentMentions,
  toZhHant,
  type AgentSpec,
  type AgentUpdateItem,
  type InboundEvent,
  type LangCode,
  type RecallTurnResult,
  type TriageDecision,
} from '@manyfold/narra-agent-kit';
import {
  isNarraGatewayEnabled,
  type NarraA2ACredentialResult,
  type NarraGatewayConfig,
} from '@manyfold/narra-agent-kit/worker';
import { DISH_VOCAB, type DishEntry } from '../../../kinds/dish-vocab.ts';
import { CAMPUSES, placesNear, walkMinutes, type Campus } from '../../shared/campuses.ts';
import { dishKeyOf, normDish } from '../../shared/dish.ts';
import { findPostcode, type RecordData } from '../../shared/kinds.ts';
import { buildPlace, slugify, type DocRecord, type IndexEntry, type PlaceDoc } from '../../shared/place-doc.ts';
import { distanceKm, matchesText, queryPlaces } from '../../shared/places-query.ts';
import { findRating } from '../../shared/rating-guard.ts';
import { STATIONS } from '../../shared/stations-data.ts';
import { ensureSchema } from '../db';
import { datasetJson, dishPlaces, placeDoc } from '../docs';
import type { Env } from '../types';

export const LCF_AGENT_ID = 'lcf-guide';
export const LCF_MANYFOLD_AGENT_ID = 'agt_agq657lc2b6qhffpaymugpmzsy';
export const LCF_MATRIX_ID = '@agent-b2b526f3:matrix.netmind.chat';
const DEFAULT_PUBLIC_URL = 'https://app.manyfold.ai/london-chinese-food';
const DEFAULT_NARRA_API = 'https://api.netmind.chat';

export const LCF_AGENT_SPEC: AgentSpec = {
  id: LCF_AGENT_ID,
  matrixId: LCF_MATRIX_ID,
  name: 'London Chinese Food',
  aliases: [
    'lcf-guide',
    'LCF',
    'lcf',
    '倫敦中餐',
    '伦敦中餐',
    '倫敦中餐地圖',
    '伦敦中餐地图',
    '中餐小幫手',
    '中餐小助手',
  ],
  domainDescription:
    'London Chinese food guide: Chinese restaurants, takeaways, dim sum, hotpot, bubble tea, Chinese bakeries and Chinese groceries in London with menus, prices, and reviewer excerpts (no star ratings or quality rankings).',
  domainKeywords: [
    'chinese food',
    'chinese restaurant',
    'chinese restaurants',
    'chinese takeaway',
    'chinese bakery',
    'chinese grocery',
    'chinese supermarket',
    'dim sum',
    'hotpot',
    'hot pot',
    'bubble tea',
    'boba',
    'chinatown',
    'sichuan',
    'cantonese',
    'dongbei',
    'shaanxi',
    'lanzhou',
    'hunan',
    'malatang',
    'roast duck',
    'char siu',
    'ho fun',
    'wonton',
    'xiao long bao',
    'har gow',
    'siu mai',
    'mapo tofu',
    'kung pao',
    'peking duck',
    'biangbiang',
    'biang biang',
    '中餐',
    '中國菜',
    '中国菜',
    '中菜',
    '餐廳',
    '餐厅',
    '餐館',
    '餐馆',
    '火鍋',
    '火锅',
    '奶茶',
    '川菜',
    '點心',
    '点心',
    '早茶',
    '飲茶',
    '饮茶',
    '中國城',
    '中国城',
    '唐人街',
    '粵菜',
    '粤菜',
    '燒臘',
    '烧腊',
    '叉燒',
    '叉烧',
    '烤鴨',
    '烤鸭',
    '拉麵',
    '拉面',
    '牛肉麵',
    '牛肉面',
    '麻辣燙',
    '麻辣烫',
    '冒菜',
    '中超',
    '中國超市',
    '中国超市',
    '華人超市',
    '华人超市',
    '小籠包',
    '小笼包',
    '蝦餃',
    '虾饺',
    '燒賣',
    '烧卖',
    '水煮魚',
    '水煮鱼',
    '酸菜魚',
    '酸菜鱼',
    '油潑麵',
    '油泼面',
    '餃子',
    '饺子',
    '茶餐廳',
    '茶餐厅',
    '東北菜',
    '东北菜',
    '湘菜',
    '陝西菜',
    '陕西菜',
    '台灣菜',
    '台湾菜',
    '糖水',
    'lcf',
    /london.{0,24}(?:chinese|dim\s*sum|hot\s*pot|bubble\s*tea|sichuan|cantonese)/i,
    /(?:chinese|dim\s*sum|hot\s*pot|bubble\s*tea|sichuan|cantonese).{0,24}(?:london|soho|chinatown|ucl|lse|kcl|soas|imperial)/i,
    /倫敦.{0,12}(?:吃|餐廳|中餐|麵|飯|茶|點心|火鍋|燒烤|奶茶)/,
    /伦敦.{0,12}(?:吃|餐厅|中餐|面|饭|茶|点心|火锅|烧烤|奶茶)/,
  ],
  antiKeywords: [
    'tarot',
    '塔羅',
    '塔罗',
    '占卜',
    '抽牌',
    '算命',
    'fortune stick',
    '求籤',
    '求签',
    '問一籤',
    '问一签',
    '抽籤',
    '抽签',
    '籤詩',
    '签诗',
    '解籤',
    '解签',
    'voucher',
    'vouchers',
    'coupon',
    'coupons',
    'promo code',
    'discount code',
    '優惠碼',
    '优惠码',
    '折扣碼',
    '折扣码',
    'rebate',
    'ai news',
    'ai in 5',
    'ai5',
    'ai新聞',
    'ai新闻',
    '今日ai',
    'pop-up',
    'popup',
    'pop up',
    '快閃',
    '快闪',
    'split bill',
    'split the bill',
    '分帳',
    '分账',
    'aa制',
    'hackathon',
    '黑客松',
    'visa',
    '簽證',
    '签证',
    'recall',
    '召回',
    'scholarship',
    '獎學金',
    '奖学金',
    'fundraising',
    '融資',
    '融资',
    'robotaxi',
    'marathon',
    '馬拉松',
    '马拉松',
  ],
  silenceThreshold: 0.55,
  sessionWindowMs: 180_000,
  politeYieldDelayMs: 1_800,
  capabilities: {
    supportsVoice: true,
  },
};

/* ───────── trilingual labels (strict script separation) ───────── */

type ScriptLabels = Record<string, { en: string; 'zh-Hant': string; 'zh-Hans': string }>;

const CATEGORY_TEXT: ScriptLabels = {
  restaurant: { en: 'Restaurant', 'zh-Hant': '餐廳', 'zh-Hans': '餐厅' },
  takeaway: { en: 'Takeaway', 'zh-Hant': '外賣店', 'zh-Hans': '外卖店' },
  'bakery-dessert': { en: 'Bakery & desserts', 'zh-Hant': '烘焙甜品', 'zh-Hans': '烘焙甜品' },
  'tea-drinks': { en: 'Bubble tea & drinks', 'zh-Hant': '奶茶茶飲', 'zh-Hans': '奶茶茶饮' },
  grocery: { en: 'Supermarket & deli', 'zh-Hant': '華人超市', 'zh-Hans': '华人超市' },
};

const CUISINE_TEXT: ScriptLabels = {
  cantonese: { en: 'Cantonese', 'zh-Hant': '粵菜', 'zh-Hans': '粤菜' },
  'dim-sum': { en: 'Dim sum', 'zh-Hant': '點心早茶', 'zh-Hans': '点心早茶' },
  'roast-meats': { en: 'Roast meats', 'zh-Hant': '燒臘', 'zh-Hans': '烧腊' },
  'hong-kong-cafe': { en: 'Hong Kong café', 'zh-Hant': '港式茶餐廳', 'zh-Hans': '港式茶餐厅' },
  chaoshan: { en: 'Chaoshan', 'zh-Hant': '潮汕菜', 'zh-Hans': '潮汕菜' },
  hakka: { en: 'Hakka', 'zh-Hant': '客家菜', 'zh-Hans': '客家菜' },
  fujian: { en: 'Fujian', 'zh-Hant': '閩菜', 'zh-Hans': '闽菜' },
  sichuan: { en: 'Sichuan', 'zh-Hant': '川菜', 'zh-Hans': '川菜' },
  chongqing: { en: 'Chongqing', 'zh-Hant': '重慶菜', 'zh-Hans': '重庆菜' },
  hunan: { en: 'Hunan', 'zh-Hant': '湘菜', 'zh-Hans': '湘菜' },
  guizhou: { en: 'Guizhou', 'zh-Hant': '貴州菜', 'zh-Hans': '贵州菜' },
  yunnan: { en: 'Yunnan', 'zh-Hant': '雲南菜', 'zh-Hans': '云南菜' },
  dongbei: { en: 'Dongbei', 'zh-Hant': '東北菜', 'zh-Hans': '东北菜' },
  beijing: { en: 'Beijing', 'zh-Hant': '京菜', 'zh-Hans': '京菜' },
  shandong: { en: 'Shandong', 'zh-Hant': '魯菜', 'zh-Hans': '鲁菜' },
  shaanxi: { en: "Shaanxi (Xi'an)", 'zh-Hant': '陝西菜', 'zh-Hans': '陕西菜' },
  lanzhou: { en: 'Lanzhou noodles', 'zh-Hant': '蘭州拉麵', 'zh-Hans': '兰州拉面' },
  xinjiang: { en: 'Xinjiang', 'zh-Hant': '新疆菜', 'zh-Hans': '新疆菜' },
  shanghai: { en: 'Shanghai', 'zh-Hant': '上海菜', 'zh-Hans': '上海菜' },
  jiangzhe: { en: 'Jiangsu & Zhejiang', 'zh-Hant': '江浙菜', 'zh-Hans': '江浙菜' },
  taiwanese: { en: 'Taiwanese', 'zh-Hant': '台灣菜', 'zh-Hans': '台湾菜' },
  hotpot: { en: 'Hotpot', 'zh-Hant': '火鍋', 'zh-Hans': '火锅' },
  malatang: { en: 'Malatang & dry pot', 'zh-Hant': '麻辣燙冒菜', 'zh-Hans': '麻辣烫冒菜' },
  bbq: { en: 'Chinese BBQ skewers', 'zh-Hant': '燒烤串串', 'zh-Hans': '烧烤串串' },
  noodles: { en: 'Noodles', 'zh-Hant': '麵館', 'zh-Hans': '面馆' },
  dumplings: { en: 'Dumplings & buns', 'zh-Hant': '餃子包子', 'zh-Hans': '饺子包子' },
  'street-food': { en: 'Street food', 'zh-Hant': '小吃', 'zh-Hans': '小吃' },
  'british-chinese': { en: 'British-Chinese', 'zh-Hant': '英式中餐', 'zh-Hans': '英式中餐' },
  'malaysian-chinese': { en: 'Malaysian & Singaporean Chinese', 'zh-Hant': '南洋中餐', 'zh-Hans': '南洋中餐' },
  vegetarian: { en: 'Chinese vegetarian', 'zh-Hant': '中式素食', 'zh-Hans': '中式素食' },
  'modern-chinese': { en: 'Modern Chinese', 'zh-Hant': '新派中餐', 'zh-Hans': '新派中餐' },
  desserts: { en: 'Desserts (tong sui)', 'zh-Hant': '糖水甜品', 'zh-Hans': '糖水甜品' },
  bakery: { en: 'Chinese bakery', 'zh-Hant': '中式烘焙', 'zh-Hans': '中式烘焙' },
  'bubble-tea': { en: 'Bubble tea', 'zh-Hant': '奶茶', 'zh-Hans': '奶茶' },
  tea: { en: 'Chinese tea', 'zh-Hant': '中國茶', 'zh-Hans': '中国茶' },
  groceries: { en: 'Chinese groceries', 'zh-Hant': '中國食材', 'zh-Hans': '中国食材' },
};

const labelFor = (map: ScriptLabels, key: string, lang: LangCode): string =>
  map[key]?.[lang] ?? map[key]?.en ?? key;

const publicBaseOf = (env: Pick<Env, 'PUBLIC_URL'>): string =>
  (env.PUBLIC_URL ?? DEFAULT_PUBLIC_URL).replace(/\/+$/, '');

const siteLangOf = (lang: LangCode): 'en' | 'zh' => (lang === 'en' ? 'en' : 'zh');

export const placeUrl = (env: Pick<Env, 'PUBLIC_URL'>, lang: LangCode, id: string, slug?: string): string =>
  `${publicBaseOf(env)}/${siteLangOf(lang)}/place/${id}${slug ? `/${slug}` : ''}`;

export const contributeUrl = (env: Pick<Env, 'PUBLIC_URL'>, lang: LangCode): string =>
  `${publicBaseOf(env)}/${siteLangOf(lang)}/contribute`;

const MENTION_NAMES: readonly string[] = [
  LCF_AGENT_SPEC.name,
  ...(LCF_AGENT_SPEC.aliases ?? []),
  '倫敦中餐地圖',
  '伦敦中餐地图',
  '問一籤',
  '問一簽',
  '问一签',
  'AI Fortune Stick',
  '塔羅大師',
  '塔罗大师',
  'AI Tarot',
  'AI in 5',
  'Spotted London',
  'Manyfold Data',
  'Penny',
  'Quidpaw',
];

const stripMentions = (text: string): string => stripAgentMentions(text, MENTION_NAMES);

const localizeZh = (text: string, lang: LangCode): string => (lang === 'zh-Hant' ? toZhHant(text) : text);

const GREETING_RE =
  /^(?:你好|妳好|您好|嗨|哈囉|哈喽|早安|早|午安|晚安|你是誰|你是谁|謝謝|谢谢|感謝|感谢|hi|hello|hey|good\s*(?:morning|afternoon|evening)|thanks|thank\s+you|who\s+are\s+you)[!！。.?？~～\s]*$/i;

const COMPOUND_RE = /^\[internal hint\]\s*process compound\b/i;

const WHATS_NEW_RE =
  /(?:最近有什麼新|最近有什么新|新開|新开|新增|新店|what(?:'s| is)\s+new|new\s+places|newly\s+(?:added|verified))/i;

/* ───────── area, campus, station, cuisine, dish matching ───────── */

const CAMPUS_ALIASES: Record<string, string[]> = {
  ucl: ['ucl', 'university college london', '倫敦大學學院', '伦敦大学学院', 'bloomsbury'],
  lse: ['lse', 'london school of economics', '倫敦政經', '伦敦政经', '倫敦政治經濟學院', '伦敦政治经济学院'],
  kcl: ['kcl', "king's college", 'kings college', '國王學院', '国王学院', '倫敦國王學院', '伦敦国王学院'],
  soas: ['soas', '亞非學院', '亚非学院'],
  imperial: ['imperial', 'ic', 'imperial college', '帝國理工', '帝国理工', '帝國理工學院', '帝国理工学院', 'south kensington'],
  qmul: ['qmul', 'queen mary', '瑪麗女王', '玛丽女王', 'mile end'],
  ual: ['ual', 'central saint martins', 'csm', '聖馬丁', '圣马丁', '中央聖馬丁', '中央圣马丁'],
  city: ['city university', "city st george's", '倫敦城市大學', '伦敦城市大学'],
  westminster: ['university of westminster', 'westminster uni', '威斯敏斯特大學', '威斯敏斯特大学'],
  goldsmiths: ['goldsmiths', '金史密斯'],
};

const AREAS: ReadonlyArray<{
  label: { en: string; 'zh-Hant': string; 'zh-Hans': string };
  aliases: string[];
  lat: number;
  lng: number;
  km?: number;
}> = [
  {
    label: { en: 'Chinatown', 'zh-Hant': '中國城', 'zh-Hans': '中国城' },
    aliases: ['chinatown', '中國城', '中国城', '唐人街', 'gerrard street', 'leicester square'],
    lat: 51.5113,
    lng: -0.1309,
    km: 0.7,
  },
  {
    label: { en: 'Soho', 'zh-Hant': 'Soho', 'zh-Hans': 'Soho' },
    aliases: ['soho', '蘇豪', '苏豪'],
    lat: 51.5136,
    lng: -0.1365,
    km: 1.0,
  },
  {
    label: { en: 'Canary Wharf', 'zh-Hant': 'Canary Wharf', 'zh-Hans': 'Canary Wharf' },
    aliases: ['canary wharf', '金絲雀碼頭', '金丝雀码头'],
    lat: 51.5054,
    lng: -0.0235,
    km: 1.5,
  },
  {
    label: { en: 'Holborn', 'zh-Hant': 'Holborn', 'zh-Hans': 'Holborn' },
    aliases: ['holborn'],
    lat: 51.5174,
    lng: -0.12,
    km: 1.0,
  },
  {
    label: { en: 'Camden', 'zh-Hant': 'Camden', 'zh-Hans': 'Camden' },
    aliases: ['camden', 'camden town'],
    lat: 51.539,
    lng: -0.1426,
    km: 1.4,
  },
  {
    label: { en: 'Bayswater / Queensway', 'zh-Hant': 'Bayswater', 'zh-Hans': 'Bayswater' },
    aliases: ['bayswater', 'queensway'],
    lat: 51.5122,
    lng: -0.1879,
    km: 1.2,
  },
  {
    label: { en: 'Stratford', 'zh-Hant': 'Stratford', 'zh-Hans': 'Stratford' },
    aliases: ['stratford'],
    lat: 51.5416,
    lng: -0.0033,
    km: 1.5,
  },
  {
    label: { en: 'Whitechapel', 'zh-Hant': 'Whitechapel', 'zh-Hans': 'Whitechapel' },
    aliases: ['whitechapel', '白教堂'],
    lat: 51.5194,
    lng: -0.0595,
    km: 1.3,
  },
  {
    label: { en: "King's Cross", 'zh-Hant': "King's Cross", 'zh-Hans': "King's Cross" },
    aliases: ["king's cross", 'kings cross', '國王十字', '国王十字'],
    lat: 51.5308,
    lng: -0.1238,
    km: 1.2,
  },
];

const CUISINE_KEYWORDS: ReadonlyArray<{ cuisine: string; patterns: string[] }> = [
  { cuisine: 'dim-sum', patterns: ['dim sum', 'dimsum', 'yum cha', '點心', '点心', '早茶', '飲茶', '饮茶'] },
  { cuisine: 'cantonese', patterns: ['cantonese', '粵菜', '粤菜', '廣東菜', '广东菜'] },
  { cuisine: 'roast-meats', patterns: ['roast duck', 'char siu', 'roast meat', '燒臘', '烧腊', '燒味', '烧味', '叉燒', '叉烧', '燒鴨', '烧鸭'] },
  { cuisine: 'hong-kong-cafe', patterns: ['cha chaan teng', 'hong kong cafe', 'hong kong café', '茶餐廳', '茶餐厅', '港式'] },
  { cuisine: 'sichuan', patterns: ['sichuan', 'szechuan', 'spicy', '川菜', '四川'] },
  { cuisine: 'chongqing', patterns: ['chongqing', '重慶', '重庆'] },
  { cuisine: 'hunan', patterns: ['hunan', '湘菜', '湖南'] },
  { cuisine: 'hotpot', patterns: ['hotpot', 'hot pot', '火鍋', '火锅', '打邊爐', '打边炉'] },
  { cuisine: 'malatang', patterns: ['malatang', 'mala tang', 'dry pot', '麻辣燙', '麻辣烫', '冒菜', '麻辣香鍋', '麻辣香锅'] },
  { cuisine: 'bbq', patterns: ['bbq', 'skewers', '燒烤', '烧烤', '串串', '烤串'] },
  { cuisine: 'dongbei', patterns: ['dongbei', 'northeastern', '東北菜', '东北菜', '東北', '东北'] },
  { cuisine: 'shaanxi', patterns: ['shaanxi', "xi'an", 'xian', 'biang', '陝西', '陕西', '西安', '肉夾饃', '肉夹馍'] },
  { cuisine: 'lanzhou', patterns: ['lanzhou', '蘭州', '兰州'] },
  { cuisine: 'xinjiang', patterns: ['xinjiang', 'uyghur', '新疆'] },
  { cuisine: 'shanghai', patterns: ['shanghai', 'shanghainese', '上海菜', '本幫菜', '本帮菜'] },
  { cuisine: 'taiwanese', patterns: ['taiwanese', 'taiwan', '台灣菜', '台湾菜', '台式', '台灣', '台湾'] },
  { cuisine: 'noodles', patterns: ['noodle', 'noodles', 'ramen', '麵館', '面馆', '拉麵', '拉面', '牛肉麵', '牛肉面', '粉麵', '粉面'] },
  { cuisine: 'dumplings', patterns: ['dumpling', 'dumplings', '餃子', '饺子', '水餃', '水饺', '鍋貼', '锅贴', '包子'] },
  { cuisine: 'bubble-tea', patterns: ['bubble tea', 'boba', 'milk tea', '奶茶', '波霸', '珍珠奶茶'] },
  { cuisine: 'desserts', patterns: ['tong sui', 'dessert', 'desserts', '糖水', '甜品'] },
  { cuisine: 'bakery', patterns: ['bakery', 'pastry', '烘焙', '中式麵包', '中式面包', '蛋撻', '蛋挞'] },
  { cuisine: 'vegetarian', patterns: ['vegetarian', 'vegan', '素食', '素菜'] },
  { cuisine: 'groceries', patterns: ['grocery', 'supermarket', 'groceries', '中超', '中國超市', '中国超市', '華人超市', '华人超市'] },
];

const CATEGORY_KEYWORDS: ReadonlyArray<{ category: string; patterns: string[] }> = [
  { category: 'grocery', patterns: ['grocery', 'supermarket', '中超', '中國超市', '中国超市', '華人超市', '华人超市'] },
  { category: 'tea-drinks', patterns: ['bubble tea', 'boba', 'milk tea', '奶茶', '茶飲', '茶饮'] },
  { category: 'bakery-dessert', patterns: ['bakery', 'dessert', 'desserts', '烘焙', '甜品', '糖水', '蛋糕'] },
  { category: 'takeaway', patterns: ['takeaway', '外賣', '外卖'] },
];

interface ResolvedLocation {
  label: string;
  point?: { lat: number; lng: number };
  km?: number;
  postcode?: string;
  campus?: Campus;
}

function matchKeywordToken(lowerText: string, needle: string): boolean {
  const clean = needle.trim().toLowerCase();
  if (!clean) return false;
  if (/[\u3400-\u9FFF]/.test(clean)) return lowerText.includes(clean);
  if (clean.includes(' ')) return lowerText.includes(clean);
  return new RegExp(`(?<![a-z0-9])${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(
    lowerText,
  );
}

function extractLocation(text: string, lang: LangCode, entries: readonly IndexEntry[]): ResolvedLocation | null {
  const lower = text.toLowerCase();

  // 1. Full UK postcode ("W1D 6JW")
  const fullPc = findPostcode(text);
  if (fullPc) {
    const outcode = fullPc.split(' ')[0]!;
    const hit = entries.find((e) => e.pc?.toUpperCase() === fullPc || e.o?.toUpperCase() === outcode);
    return {
      label: fullPc,
      postcode: fullPc,
      ...(hit && hit.la !== null && hit.lo !== null ? { point: { lat: hit.la, lng: hit.lo }, km: 1.5 } : {}),
    };
  }

  // 2. Known London university campus
  for (const campus of CAMPUSES) {
    const aliases = CAMPUS_ALIASES[campus.id] ?? [campus.short.toLowerCase()];
    if (aliases.some((alias) => matchKeywordToken(lower, alias))) {
      const campusLabel = lang === 'en' ? campus.short : `${campus.short}`;
      return {
        label: campusLabel,
        point: { lat: campus.lat, lng: campus.lng },
        km: 1.5,
        campus,
      };
    }
  }

  // 3. Well-known London areas (Chinatown, Soho, Canary Wharf, etc.)
  for (const area of AREAS) {
    if (area.aliases.some((alias) => matchKeywordToken(lower, alias))) {
      return {
        label: area.label[lang],
        point: { lat: area.lat, lng: area.lng },
        km: area.km ?? 1.2,
      };
    }
  }

  // 4. London Tube/rail stations (longest match first to avoid short collisions like "Bank")
  const stationsSorted = [...STATIONS].sort((a, b) => b[0].length - a[0].length);
  for (const [stationName, lat, lng] of stationsSorted) {
    if (stationName.length < 5) continue;
    if (matchKeywordToken(lower, stationName)) {
      return {
        label: stationName,
        point: { lat, lng },
        km: 1.2,
      };
    }
  }

  // 5. Outcode ("W1D", "WC1E", "E14", "NW1", "SE1") present in index entries
  const knownOutcodes = new Set(entries.map((e) => e.o?.toUpperCase()).filter((v): v is string => Boolean(v)));
  const outcodeTokens = text.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\b/g) ?? [];
  for (const tok of outcodeTokens) {
    if (knownOutcodes.has(tok)) {
      const hit = entries.find((e) => e.o?.toUpperCase() === tok && e.la !== null && e.lo !== null);
      return {
        label: tok,
        postcode: tok,
        ...(hit ? { point: { lat: hit.la!, lng: hit.lo! }, km: 1.8 } : {}),
      };
    }
  }

  return null;
}

function extractCuisines(text: string): string[] {
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  for (const item of CUISINE_KEYWORDS) {
    if (item.patterns.some((p) => matchKeywordToken(lower, p))) {
      matched.add(item.cuisine);
    }
  }
  return [...matched];
}

function extractCategories(text: string): string[] {
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  for (const item of CATEGORY_KEYWORDS) {
    if (item.patterns.some((p) => matchKeywordToken(lower, p))) {
      matched.add(item.category);
    }
  }
  return [...matched];
}

function extractDishes(text: string): DishEntry[] {
  const lower = text.toLowerCase();
  const norm = normDish(text);
  const hits: DishEntry[] = [];
  for (const entry of DISH_VOCAB) {
    const names = [entry.zh, entry.en, ...entry.aliases];
    const hit = names.some((name) => {
      const clean = name.trim();
      if (!clean) return false;
      if (/[\u3400-\u9FFF]/.test(clean)) {
        return text.includes(clean) || norm.includes(normDish(clean));
      }
      return clean.length >= 4 && matchKeywordToken(lower, clean);
    });
    if (hit) hits.push(entry);
  }
  return hits;
}

/* ───────── D1 index & place loading ───────── */

function rowToIndexEntry(id: string, data: RecordData, updatedAt: string): IndexEntry {
  const nameEn = typeof data.name_en === 'string' ? data.name_en : null;
  const postcode = typeof data.postcode === 'string' ? data.postcode : null;
  return {
    id,
    s: slugify(nameEn),
    n: nameEn,
    z: typeof data.name_zh === 'string' ? data.name_zh : null,
    c: typeof data.category === 'string' ? data.category : 'restaurant',
    k: Array.isArray(data.cuisines) ? (data.cuisines as string[]) : [],
    b: typeof data.borough_code === 'string' ? data.borough_code : null,
    pc: postcode,
    o: postcode ? postcode.split(' ')[0] ?? null : null,
    la: typeof data.lat === 'number' ? data.lat : null,
    lo: typeof data.lng === 'number' ? data.lng : null,
    t: typeof data.trading === 'string' ? data.trading : 'open',
    br: typeof data.brand === 'string' ? data.brand : null,
    r: 0,
    m: 0,
    p: 0,
    l: null,
    u: updatedAt,
  };
}

async function loadPublicEntries(db: D1Database): Promise<IndexEntry[]> {
  await ensureSchema(db);
  const indexRaw = await datasetJson(db, 'index');
  if (indexRaw) {
    try {
      const parsed = JSON.parse(indexRaw) as IndexEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Fall through to place_docs / records.
    }
  }

  const docs = await db
    .prepare('SELECT entry_json FROM place_docs WHERE entry_json IS NOT NULL LIMIT 500')
    .all<{ entry_json: string }>();
  if (docs.results.length > 0) {
    return docs.results.map((r) => JSON.parse(r.entry_json) as IndexEntry);
  }

  const records = await db
    .prepare(
      `SELECT id, data_json, updated_at FROM records
       WHERE kind = 'place' AND status IN ('verified', 'stale')
       ORDER BY verified_at DESC, updated_at DESC LIMIT 500`,
    )
    .all<{ id: string; data_json: string; updated_at: string }>();
  return records.results.map((r) => rowToIndexEntry(r.id, JSON.parse(r.data_json) as RecordData, r.updated_at));
}

async function loadPlaceDocOrSynthesize(db: D1Database, placeId: string): Promise<PlaceDoc | null> {
  const rawDoc = await placeDoc(db, placeId);
  if (rawDoc) {
    try {
      return JSON.parse(rawDoc) as PlaceDoc;
    } catch {
      // Fall through.
    }
  }

  const placeRow = await db
    .prepare(
      `SELECT id, kind, status, data_json, source_url, evidence, observed_at, verified_at, updated_at, parent_id
       FROM records WHERE id = ? AND kind = 'place' AND status IN ('verified', 'stale')`,
    )
    .bind(placeId)
    .first<{
      id: string;
      kind: string;
      status: 'verified' | 'stale';
      data_json: string;
      source_url: string;
      evidence: string;
      observed_at: string;
      verified_at: string | null;
      updated_at: string;
      parent_id: string | null;
    }>();
  if (!placeRow) return null;

  const childRows = await db
    .prepare(
      `SELECT id, kind, status, data_json, source_url, evidence, observed_at, verified_at, updated_at, parent_id
       FROM records WHERE root_id = ? AND id != ? AND status IN ('verified', 'stale')`,
    )
    .bind(placeId, placeId)
    .all<{
      id: string;
      kind: string;
      status: 'verified' | 'stale';
      data_json: string;
      source_url: string;
      evidence: string;
      observed_at: string;
      verified_at: string | null;
      updated_at: string;
      parent_id: string | null;
    }>();

  const toDocRecord = (r: typeof placeRow): DocRecord => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    data: JSON.parse(r.data_json) as RecordData,
    source_url: r.source_url,
    evidence: r.evidence,
    observed_at: r.observed_at,
    verified_at: r.verified_at,
    updated_at: r.updated_at,
    parent_id: r.parent_id,
  });

  return buildPlace({
    place: toDocRecord(placeRow),
    brand: null,
    children: childRows.results.map(toDocRecord),
    brandMenus: [],
    history: [],
  }).doc;
}

async function findPlacesServingDish(
  db: D1Database,
  dish: DishEntry,
  openEntries: readonly IndexEntry[],
): Promise<Array<{ entry: IndexEntry; via: string; pricePence: number | null; itemName: string | null }>> {
  const dishKey = normDish(dish.zh);
  const byId = new Map(openEntries.map((e) => [e.id, e]));
  const hits = await dishPlaces(db, dishKey);

  const out: Array<{ entry: IndexEntry; via: string; pricePence: number | null; itemName: string | null }> = [];
  for (const row of hits.places) {
    const entry = byId.get(row.place_id);
    if (!entry) continue;
    const info = (row.entry ?? {}) as { name_zh?: string | null; name_en?: string | null; price_pence?: number | null };
    out.push({
      entry,
      via: row.via,
      pricePence: typeof info.price_pence === 'number' ? info.price_pence : null,
      itemName: info.name_en ?? info.name_zh ?? null,
    });
  }

  if (out.length > 0) return out;

  // Fallback for D1 databases where refreshDocs hasn't populated dish_places yet.
  const menuRows = await db
    .prepare(
      `SELECT parent_id, data_json FROM records
       WHERE kind = 'menu' AND status IN ('verified', 'stale') AND parent_id IS NOT NULL LIMIT 200`,
    )
    .all<{ parent_id: string; data_json: string }>();

  const seenPlaceIds = new Set<string>();
  for (const mr of menuRows.results) {
    const entry = byId.get(mr.parent_id);
    if (!entry || seenPlaceIds.has(entry.id)) continue;
    const data = JSON.parse(mr.data_json) as { items?: Array<Record<string, unknown>> };
    for (const item of data.items ?? []) {
      if (dishKeyOf(item) === dishKey) {
        seenPlaceIds.add(entry.id);
        out.push({
          entry,
          via: 'menu',
          pricePence: typeof item.price_pence === 'number' ? item.price_pence : null,
          itemName: (typeof item.name_en === 'string' && item.name_en) || (typeof item.name_zh === 'string' && item.name_zh) || null,
        });
        break;
      }
    }
  }
  return out;
}

/* ───────── updates & broadcast helpers ───────── */

export interface RecentOpenPlaceUpdate {
  id: string;
  slug: string;
  nameEn: string | null;
  nameZh: string | null;
  category: string;
  cuisines: string[];
  postcode: string | null;
  verifiedAt: string;
}

/**
 * Queries newly verified open places from D1 after `sinceIso`, strictly preserving
 * the no-ratings invariant (no stars, scores, or quality rankings).
 */
export async function queryRecentOpenPlaceUpdates(
  env: Pick<Env, 'DB'>,
  sinceIso: string,
  limit = 3,
): Promise<RecentOpenPlaceUpdate[]> {
  if (!env.DB) return [];
  await ensureSchema(env.DB);
  const cutoff = (sinceIso ?? '').trim();
  const sql = cutoff
    ? `SELECT id, data_json, verified_at FROM records
       WHERE kind = 'place' AND status = 'verified' AND verified_at IS NOT NULL AND verified_at > ?
       ORDER BY verified_at DESC, id DESC LIMIT 12`
    : `SELECT id, data_json, verified_at FROM records
       WHERE kind = 'place' AND status = 'verified' AND verified_at IS NOT NULL
       ORDER BY verified_at DESC, id DESC LIMIT 12`;

  const { results } = cutoff
    ? await env.DB.prepare(sql).bind(cutoff).all<{ id: string; data_json: string; verified_at: string }>()
    : await env.DB.prepare(sql).all<{ id: string; data_json: string; verified_at: string }>();

  const out: RecentOpenPlaceUpdate[] = [];
  for (const row of results) {
    const data = JSON.parse(row.data_json) as RecordData;
    const trading = typeof data.trading === 'string' ? data.trading : 'open';
    if (trading !== 'open') continue;
    const nameEn = typeof data.name_en === 'string' && !findRating(data.name_en) ? data.name_en : null;
    const nameZh = typeof data.name_zh === 'string' && !findRating(data.name_zh) ? data.name_zh : null;
    if (!nameEn && !nameZh) continue;
    out.push({
      id: row.id,
      slug: slugify(nameEn),
      nameEn,
      nameZh,
      category: typeof data.category === 'string' ? data.category : 'restaurant',
      cuisines: Array.isArray(data.cuisines) ? (data.cuisines as string[]) : [],
      postcode: typeof data.postcode === 'string' ? data.postcode : null,
      verifiedAt: row.verified_at,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function discoverBroadcastRooms(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ roomId: string; lang: LangCode }>> {
  const roomIds = new Set<string>();

  if (env.NARRA_SYNC_DO) {
    try {
      const stub = env.NARRA_SYNC_DO.get(env.NARRA_SYNC_DO.idFromName('narra'));
      const res = await stub.fetch('https://narra-sync/status');
      if (res.ok) {
        const status = (await res.json()) as { roomIds?: unknown };
        if (Array.isArray(status.roomIds)) {
          for (const id of status.roomIds) {
            if (typeof id === 'string' && id.startsWith('!')) roomIds.add(id);
          }
        }
      }
    } catch {
      // Ignore unreachable sync DO.
    }
  }

  const roomLangs = new Map<string, LangCode>();
  if (env.DB) {
    try {
      const rows = await env.DB
        .prepare(
          `SELECT room_id, memory_key, memory_value FROM narra_room_memory
           WHERE agent_id = ?`,
        )
        .bind(LCF_AGENT_ID)
        .all<{ room_id: string; memory_key: string; memory_value: string }>();
      for (const r of rows.results) {
        if (r.room_id.startsWith('!')) roomIds.add(r.room_id);
        if (
          (r.memory_key === 'language' || r.memory_key === 'lang') &&
          (r.memory_value === 'zh-Hant' || r.memory_value === 'zh-Hans' || r.memory_value === 'en')
        ) {
          roomLangs.set(r.room_id, r.memory_value);
        }
      }
    } catch {
      // narra_room_memory may not be initialized yet.
    }
  }

  // Only hit Narra rooms endpoint when enabled, rooms still empty, and sync DO had none.
  if (roomIds.size === 0 && isNarraGatewayEnabled(env)) {
    const endpoint = (env.NARRA_API_ENDPOINT ?? DEFAULT_NARRA_API).replace(/\/+$/, '');
    try {
      const res = await fetchImpl(
        `${endpoint}/api/agent-runtime/chat/rooms?conversation_type=group`,
        {
          headers: { authorization: `Bearer ${env.NARRA_AGENT_TOKEN!.trim()}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const data = (body && typeof body.data === 'object' && body.data ? body.data : body) as Record<
          string,
          unknown
        > | null;
        const rooms = Array.isArray(data?.rooms) ? (data!.rooms as Array<Record<string, unknown>>) : [];
        for (const r of rooms) {
          if (typeof r.room_id === 'string' && r.room_id.startsWith('!') && r.conversation_type !== 'dm') {
            roomIds.add(r.room_id);
          }
        }
      }
    } catch {
      // Non-fatal fallback.
    }
  }

  const out: Array<{ roomId: string; lang: LangCode }> = [];
  for (const roomId of roomIds) {
    if (env.NARRA_ROOM_DO) {
      try {
        const roomStub = env.NARRA_ROOM_DO.get(env.NARRA_ROOM_DO.idFromName(roomId));
        const res = await roomStub.fetch('https://narra-room/status');
        if (res.ok) {
          const st = (await res.json()) as { chatType?: string | null };
          if (st.chatType === 'dm') continue;
        }
      } catch {
        // Keep room if status check fails.
      }
    }
    out.push({ roomId, lang: roomLangs.get(roomId) ?? 'en' });
  }
  return out;
}

export function formatPlaceUpdatesMessage(
  env: Pick<Env, 'PUBLIC_URL'>,
  updates: readonly RecentOpenPlaceUpdate[],
  lang: LangCode,
): string {
  if (updates.length === 0) return '';
  const header =
    lang === 'zh-Hant'
      ? '🍜 倫敦中餐地圖新收錄營業中店家：'
      : lang === 'zh-Hans'
        ? '🍜 伦敦中餐地图新收录营业中店家：'
        : '🍜 Newly verified open Chinese food spots in London:';

  const lines = [header];
  for (const p of updates.slice(0, 3)) {
    const nameZh = p.nameZh ? localizeZh(p.nameZh, lang) : p.nameZh;
    const title = [p.nameEn, nameZh].filter(Boolean).join(' / ');
    const tags = [
      ...p.cuisines.slice(0, 2).map((c) => labelFor(CUISINE_TEXT, c, lang)),
      p.postcode ?? '',
    ].filter(Boolean);
    lines.push(`- ${title}${tags.length ? ` (${tags.join(' · ')})` : ''}`);
    lines.push(placeUrl(env, lang, p.id, p.slug));
  }
  return lines.join('\n');
}

export async function fetchLcfUpdates(
  env: Env,
  sinceIso: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentUpdateItem[]> {
  const updates = await queryRecentOpenPlaceUpdates(env, sinceIso, 3);
  if (updates.length === 0) return [];
  const rooms = await discoverBroadcastRooms(env, fetchImpl);
  if (rooms.length === 0) return [];

  const updateKey = `lcf-places:${updates.map((u) => u.id).sort().join(',')}`;
  return rooms.map((room) => ({
    updateKey,
    roomId: room.roomId,
    chatType: 'group' as const,
    title: 'London Chinese Food updates',
    text: formatPlaceUpdatesMessage(env, updates, room.lang),
    lang: room.lang,
    priority: 'normal' as const,
  }));
}

/* ───────── fastRespond formatting helpers ───────── */

function formatPlaceLine(
  env: Pick<Env, 'PUBLIC_URL'>,
  entry: IndexEntry,
  lang: LangCode,
  extra?: { distKm?: number; note?: string },
): string[] {
  const nameZh = entry.z ? localizeZh(entry.z, lang) : entry.z;
  const name = [entry.n, nameZh].filter(Boolean).join(' / ') || entry.id;
  const cuisineBits = entry.k.slice(0, 2).map((c) => labelFor(CUISINE_TEXT, c, lang));
  const categoryLabel = labelFor(CATEGORY_TEXT, entry.c, lang);
  const metaParts: string[] = [
    cuisineBits.length > 0 ? cuisineBits.join(' / ') : categoryLabel,
    entry.pc ?? entry.o ?? '',
  ];
  if (extra?.distKm !== undefined) {
    const mins = walkMinutes(extra.distKm);
    metaParts.push(
      lang === 'zh-Hant'
        ? `約 ${extra.distKm.toFixed(1)} km（步行約 ${mins} min）`
        : lang === 'zh-Hans'
          ? `约 ${extra.distKm.toFixed(1)} km（步行约 ${mins} 分钟）`
          : `${extra.distKm.toFixed(1)} km (~${mins} min walk)`,
    );
  }
  if (entry.t !== 'open') {
    metaParts.push(
      lang === 'zh-Hant'
        ? '暫停營業/已關閉'
        : lang === 'zh-Hans'
          ? '暂停营业/已关闭'
          : entry.t,
    );
  }
  const note = extra?.note ? localizeZh(extra.note, lang) : '';
  const suffix = note ? ` · ${note}` : '';
  return [
    `- ${name} (${metaParts.filter(Boolean).join(' · ')})${suffix}`,
    placeUrl(env, lang, entry.id, entry.s),
  ];
}

function formatPricePence(pence: number | null): string {
  return typeof pence === 'number' && Number.isFinite(pence) ? `£${(pence / 100).toFixed(2)}` : '';
}

function formatPlaceDetail(env: Pick<Env, 'PUBLIC_URL'>, doc: PlaceDoc, lang: LangCode): string {
  const nameEn = typeof doc.place.name_en === 'string' ? doc.place.name_en : null;
  const rawNameZh = typeof doc.place.name_zh === 'string' ? doc.place.name_zh : null;
  const nameZh = rawNameZh ? localizeZh(rawNameZh, lang) : null;
  const title = [nameEn, nameZh].filter(Boolean).join(' / ') || doc.id;
  const cuisines = Array.isArray(doc.place.cuisines)
    ? (doc.place.cuisines as string[]).map((c) => labelFor(CUISINE_TEXT, c, lang)).join(' / ')
    : labelFor(CATEGORY_TEXT, String(doc.place.category ?? 'restaurant'), lang);
  const rawAddress = [doc.place.address, doc.place.postcode].filter((v) => typeof v === 'string' && v).join(', ');
  const address = localizeZh(rawAddress, lang);
  const lines = [`🍜 ${title} (${cuisines})`];
  if (address) {
    lines.push(
      lang === 'zh-Hant' ? `地址：${address}` : lang === 'zh-Hans' ? `地址：${address}` : `Address: ${address}`,
    );
  }

  const firstMenu = doc.menus[0];
  if (firstMenu) {
    const items = firstMenu.sections
      .flatMap((s) => s.items)
      .filter((i) => i.name_en || i.name_zh)
      .slice(0, 3);
    if (items.length > 0) {
      const checkedDate = (firstMenu.verified_at ?? firstMenu.observed_at ?? '').slice(0, 10);
      const itemStr = items
        .map((i) => {
          const itemZh = i.name_zh ? localizeZh(i.name_zh, lang) : i.name_zh;
          return `${[itemZh, i.name_en].filter(Boolean).join(' ')} ${formatPricePence(i.price_pence ?? null)}`.trim();
        })
        .join('；');
      if (lang === 'zh-Hant') {
        lines.push(`菜單記錄於 ${checkedDate}：${itemStr}`);
      } else if (lang === 'zh-Hans') {
        lines.push(`菜单记录于 ${checkedDate}：${itemStr}`);
      } else {
        lines.push(`On the menu at ${checkedDate}: ${itemStr}`);
      }
    }
  }

  // Strictly enforce no-ratings invariant on any review excerpt!
  const safeReview = doc.reviews.find((r) => r.excerpt && !findRating(r.excerpt));
  if (safeReview) {
    const snippet = localizeZh(safeReview.excerpt.slice(0, 120).trim(), lang);
    const who = localizeZh(safeReview.author || safeReview.publication || '', lang);
    if (who) {
      lines.push(`"${snippet}" — ${who}`);
    }
  }

  lines.push(placeUrl(env, lang, doc.id, doc.slug));
  return lines.join('\n');
}

function greetingReply(lang: LangCode): string {
  if (lang === 'zh-Hant') {
    return '嗨！我是倫敦中餐地圖小幫手，想在倫敦哪一帶吃什麼或找哪種菜系，直接問我就好 🍜';
  }
  if (lang === 'zh-Hans') {
    return '嗨！我是伦敦中餐地图小助手，想在伦敦哪一带吃什么或找哪种菜系，直接问我就行 🍜';
  }
  return "Hi! I'm the London Chinese Food guide — tell me an area, station, or dish you're craving and I'll look it up 🍜";
}

function compoundReply(lang: LangCode): string {
  if (lang === 'zh-Hant') {
    return '這則訊息是圖片或檔案我暫時看不到喔，直接用文字告訴我想找哪一帶或哪道中餐菜色就可以！';
  }
  if (lang === 'zh-Hans') {
    return '这条消息是图片或文件我暂时看不到哦，直接用文字告诉我想找哪一带或哪道中餐菜色就可以！';
  }
  return "I can't view images or files here — just type the area, station, or Chinese dish you're looking for!";
}

function offTopicRedirect(lang: LangCode): string {
  if (lang === 'zh-Hant') {
    return '這題超出我的範圍啦，我只熟倫敦的中餐。想在倫敦哪一帶找吃的隨時問我！';
  }
  if (lang === 'zh-Hans') {
    return '这题我帮不上，我只熟伦敦的中餐。想吃什么、在哪一带，告诉我就行！';
  }
  return "That's outside my patch — I only cover Chinese food in London. Let me know an area or dish if you're looking to eat!";
}

function hasA2ACredential(env: Env): boolean {
  return Boolean((env.MANYFOLD_A2A_URL ?? '').trim() && (env.MANYFOLD_A2A_TOKEN ?? '').trim());
}

function resolveMemoryLocationHint(memories: RecallTurnResult, lang: LangCode, entries: readonly IndexEntry[]): ResolvedLocation | null {
  const all = [...memories.userMemories, ...memories.roomMemories];
  for (const m of all) {
    if (m.key === 'campus' || m.key === 'default_area' || m.key === 'area' || m.key === 'postcode') {
      const resolved = extractLocation(m.value, lang, entries);
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * Fast D1-backed responder for London Chinese Food (`lcf-guide`).
 * Returns `null` when Manyfold A2A should handle the turn.
 */
export async function fastRespondLcf(
  env: Env,
  event: InboundEvent,
  decision: TriageDecision,
  memories: RecallTurnResult,
): Promise<string | null> {
  const lang = decision.detectedLang;
  const cleanedText = stripMentions(event.text);

  if (event.kind === 'image' || event.kind === 'compound' || COMPOUND_RE.test(event.text)) {
    return compoundReply(lang);
  }
  if (!cleanedText || GREETING_RE.test(cleanedText)) {
    return greetingReply(lang);
  }

  const isMultiMention = decision.reason === 'multi_mention_domain_match';
  const hasAntiHit = (LCF_AGENT_SPEC.antiKeywords ?? []).some((kw) => {
    if (kw instanceof RegExp) return kw.test(cleanedText);
    return matchKeywordToken(cleanedText.toLowerCase(), kw);
  });

  const limit = event.isVoice ? 2 : event.chatType === 'group' ? 3 : 5;

  // 1. "What's new" queries -> recent verified open places (without marking broadcast watermark)
  if (WHATS_NEW_RE.test(cleanedText) && env.DB) {
    const recent = await queryRecentOpenPlaceUpdates(env, '', Math.min(limit, 3));
    if (recent.length > 0) {
      return formatPlaceUpdatesMessage(env, recent, lang);
    }
  }

  if (!env.DB) {
    return hasA2ACredential(env) ? null : offTopicRedirect(lang);
  }

  const allEntries = await loadPublicEntries(env.DB);
  const openEntries = allEntries.filter((e) => e.t === 'open');
  const dishes = extractDishes(cleanedText);
  const cuisines = extractCuisines(cleanedText);
  const categories = extractCategories(cleanedText);
  const explicitLocation = extractLocation(cleanedText, lang, allEntries);
  const location = explicitLocation ?? resolveMemoryLocationHint(memories, lang, allEntries);

  // Off-topic guard on explicit mentions / DMs
  if (hasAntiHit && dishes.length === 0 && cuisines.length === 0 && categories.length === 0 && !explicitLocation) {
    return isMultiMention ? '[NO_REPLY]' : offTopicRedirect(lang);
  }

  // 2. Dish query ("where can I eat 小籠包 / har gow / biang biang noodles near UCL?")
  if (dishes.length > 0) {
    const primaryDish = dishes[0]!;
    const servedAt = await findPlacesServingDish(env.DB, primaryDish, openEntries);
    if (servedAt.length > 0) {
      let ranked = servedAt.map((item) => ({
        ...item,
        distKm:
          location?.point && item.entry.la !== null && item.entry.lo !== null
            ? distanceKm(location.point, { lat: item.entry.la, lng: item.entry.lo })
            : undefined,
      }));
      if (location?.point) {
        ranked.sort((a, b) => (a.distKm ?? 999) - (b.distKm ?? 999));
      } else {
        ranked.sort((a, b) => b.entry.r + b.entry.m - (a.entry.r + a.entry.m));
      }
      ranked = ranked.slice(0, limit);

      const dishLabel =
        lang === 'en' ? primaryDish.en : `${localizeZh(primaryDish.zh, lang)} (${primaryDish.en})`;
      const locationLabel = location ? localizeZh(location.label, lang) : '';
      const header =
        lang === 'zh-Hant'
          ? `🍜 倫敦可以吃到「${dishLabel}」的營業中店家${location ? `（依距離 ${locationLabel} 排序）` : ''}：`
          : lang === 'zh-Hans'
            ? `🍜 伦敦可以吃到「${dishLabel}」的营业中店家${location ? `（按距离 ${locationLabel} 排序）` : ''}：`
            : `🍜 Open places serving ${dishLabel}${location ? ` (nearest to ${locationLabel})` : ''}:`;

      const lines = [header];
      for (const item of ranked) {
        const note =
          item.via === 'menu' && item.pricePence !== null
            ? `${item.itemName ?? ''} ${formatPricePence(item.pricePence)}`.trim()
            : undefined;
        lines.push(...formatPlaceLine(env, item.entry, lang, { distKm: item.distKm, note }));
      }
      return lines.join('\n');
    }
  }

  // 3. Direct place name lookup (if user named a specific restaurant/shop in D1)
  const nameQuery = cleanedText
    .replace(/^(?:請問|请问|幫我查|帮我查|想問|想问)\s*/u, '')
    .replace(/(?:where is|tell me about|menu of|address of|在哪里|在哪裡|怎麼去|怎么去|菜單|菜单|地址)/gi, '')
    .replace(/(?:^[的\s?？!！。.,，、:：]+|[的\s?？!！。.,，、:：]+$)/g, '')
    .trim();
  if (nameQuery.length >= 2) {
    const normalizedQuery = toZhHant(nameQuery);
    const nameMatches = allEntries.filter(
      (e) =>
        (e.n && e.n.toLowerCase().includes(nameQuery.toLowerCase())) ||
        (e.z &&
          (e.z.includes(nameQuery) ||
            toZhHant(e.z).includes(nameQuery) ||
            e.z.includes(normalizedQuery) ||
            toZhHant(e.z).includes(normalizedQuery))) ||
        (nameQuery.length >= 4 && matchesText(e, nameQuery)),
    );
    if (nameMatches.length === 1) {
      const doc = await loadPlaceDocOrSynthesize(env.DB, nameMatches[0]!.id);
      if (doc) return formatPlaceDetail(env, doc, lang);
    }
    if (nameMatches.length > 1 && dishes.length === 0 && cuisines.length === 0 && categories.length === 0 && !explicitLocation) {
      const header =
        lang === 'zh-Hant'
          ? `🍜 找到 ${nameMatches.length} 間符合的店家：`
          : lang === 'zh-Hans'
            ? `🍜 找到 ${nameMatches.length} 家符合的店家：`
            : `🍜 Found ${nameMatches.length} matching places:`;
      const lines = [header];
      for (const entry of nameMatches.slice(0, limit)) {
        lines.push(...formatPlaceLine(env, entry, lang));
      }
      return lines.join('\n');
    }
  }

  // 4. Location + optional cuisine/category query
  if (location || cuisines.length > 0 || categories.length > 0) {
    let matches: Array<{ entry: IndexEntry; distKm?: number }> = [];

    if (location?.point) {
      const radius = location.km ?? 1.5;
      const nearby = placesNear(openEntries, location.point, radius).filter(
        (n) =>
          (!cuisines.length || cuisines.some((c) => n.entry.k.includes(c))) &&
          (!categories.length || categories.includes(n.entry.c)),
      );
      const broadened =
        nearby.length > 0
          ? nearby
          : placesNear(openEntries, location.point, 3.5).filter(
              (n) =>
                (!cuisines.length || cuisines.some((c) => n.entry.k.includes(c))) &&
                (!categories.length || categories.includes(n.entry.c)),
            );
      matches = broadened.map((n) => ({ entry: n.entry, distKm: n.km }));
    } else {
      const filtered = queryPlaces(openEntries, {
        ...(location?.postcode ? { postcode: location.postcode } : {}),
        ...(cuisines.length ? { cuisines } : {}),
        ...(categories.length ? { categories } : {}),
        openOnly: true,
        sort: 'recent',
      });
      matches = filtered.map((entry) => ({ entry }));
    }

    if (matches.length > 0) {
      const picked = matches.slice(0, limit);
      const locationLabel = location ? localizeZh(location.label, lang) : '';
      const header =
        lang === 'zh-Hant'
          ? `🍜 為你查到 ${picked.length} 間營業中選擇${location ? `（${locationLabel} 一帶）` : ''}：`
          : lang === 'zh-Hans'
            ? `🍜 为你查到 ${picked.length} 家营业中选择${location ? `（${locationLabel} 一带）` : ''}：`
            : `🍜 Found ${picked.length} open place${picked.length === 1 ? '' : 's'}${location ? ` near ${locationLabel}` : ''}:`;

      const lines = [header];
      for (const m of picked) {
        lines.push(...formatPlaceLine(env, m.entry, lang, { distKm: m.distKm }));
      }
      return lines.join('\n');
    }
  }

  // 5. Fallback: if Manyfold A2A is configured, delegate conversational / unindexed queries to A2A.
  if (hasA2ACredential(env)) {
    return null;
  }

  // Graceful response when A2A is not configured.
  const contrib = contributeUrl(env, lang);
  if (dishes.length > 0 || cuisines.length > 0 || categories.length > 0 || location) {
    if (lang === 'zh-Hant') {
      return `倫敦中餐地圖目前還沒有找到符合條件的營業中店家。歡迎幫忙補充新店：\n${contrib}`;
    }
    if (lang === 'zh-Hans') {
      return `伦敦中餐地图目前还没有找到符合条件的营业中店家。欢迎帮忙补充新店：\n${contrib}`;
    }
    return `I couldn't find an open place matching that in the London Chinese Food directory yet. You can suggest a missing spot here:\n${contrib}`;
  }

  if (lang === 'zh-Hant') {
    return '想在倫敦找哪一帶（郵編、地鐵站或大學如 UCL / LSE / 中國城）或哪道中餐呢？告訴我就能幫你查！';
  }
  if (lang === 'zh-Hans') {
    return '想在伦敦找哪一带（邮编、地铁站或大学如 UCL / LSE / 中国城）或哪道中餐呢？告诉我就帮你查！';
  }
  return 'Which London area (postcode, Tube station, university like UCL/LSE, or Chinatown) or Chinese dish are you looking for?';
}

export async function resolveLcfA2ACredential(env: Env): Promise<NarraA2ACredentialResult | null> {
  const url = (env.MANYFOLD_A2A_URL ?? '').trim();
  const token = (env.MANYFOLD_A2A_TOKEN ?? '').trim();
  if (url && token) {
    return { url, token, label: LCF_AGENT_SPEC.name };
  }
  return null;
}

export function createLcfGatewayConfig(
  overrides: Partial<NarraGatewayConfig<Env>> = {},
): NarraGatewayConfig<Env> {
  return {
    spec: LCF_AGENT_SPEC,
    fetchUpdates: (env, sinceIso) => fetchLcfUpdates(env, sinceIso, overrides.fetchImpl),
    fastRespond: fastRespondLcf,
    resolveA2ACredential: resolveLcfA2ACredential,
    ...overrides,
  };
}

export const lcfGatewayConfig: NarraGatewayConfig<Env> = createLcfGatewayConfig();
