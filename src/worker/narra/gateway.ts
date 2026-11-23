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
  createWorkersAiTriageModel,
  stripAgentMentions,
  toZhHant,
  type AgentSpec,
  type AgentUpdateItem,
  type InboundEvent,
  type LangCode,
  type RecallTurnResult,
  type RoomContext,
  type TriageDecision,
} from '@manyfold/narra-agent-kit';
import {
  isNarraGatewayEnabled,
  type NarraA2ACredentialResult,
  type NarraGatewayConfig,
} from '@manyfold/narra-agent-kit/worker';
import { DISH_VOCAB, type DishEntry } from '../../../kinds/dish-vocab.ts';
import { CAMPUSES, nearestStation, placesNear, walkMinutes, type Campus } from '../../shared/campuses.ts';
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

const CASUAL_MEAL_QUESTION_RE = /^(?:今天|今晚|中午|午餐|晚上|晚餐)?[ \t]*(?:能|可以|要|該|该)?吃(?:啥|什麼|什么)[呀啊呢嗎吗]?[？?！!。]*$/;

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
    'London Chinese food & dining guide: everyday London eating recommendations (near Soho, Chinatown, UCL, LSE, etc.), Chinese restaurants, takeaways, dim sum, hotpot, Chinese BBQ skewers, desserts, tong sui, ice cream, bubble tea, Chinese bakeries and Chinese groceries in London with menus, prices, and reviewer excerpts (no star ratings or quality rankings) — NOT weekend markets, pop-ups, exhibitions, or general sightseeing.',
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
    '麵館',
    '面馆',
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
    '冰淇淋',
    '冰激凌',
    '雪糕',
    '甜品',
    '甜點',
    '甜点',
    '刨冰',
    '蛋撻',
    '蛋挞',
    '芋圓',
    '芋圆',
    '雞蛋仔',
    '鸡蛋仔',
    '雙皮奶',
    '双皮奶',
    '楊枝甘露',
    '杨枝甘露',
    '中式甜品',
    '中式烘焙',
    '麵包店',
    '面包店',
    '冰沙',
    '燒烤',
    '烧烤',
    '烤串',
    '串串',
    '擼串',
    '撸串',
    '烤肉',
    '烤魚',
    '烤鱼',
    '鐵板燒',
    '铁板烧',
    '麻辣香鍋',
    '麻辣香锅',
    '乾鍋',
    '干锅',
    '米線',
    '米线',
    '螺螄粉',
    '螺蛳粉',
    '煲仔飯',
    '煲仔饭',
    '生煎',
    '鍋貼',
    '锅贴',
    '煎餅',
    '煎饼',
    '雲南菜',
    '云南菜',
    '新疆菜',
    '京菜',
    '本幫菜',
    '本帮菜',
    '港式',
    '滷味',
    '卤味',
    '大盤雞',
    '大盘鸡',
    'chinese bbq',
    'bbq skewers',
    'skewers',
    CASUAL_MEAL_QUESTION_RE,
    '中午吃什麼',
    '中午吃什么',
    '午餐吃什麼',
    '午餐吃什么',
    '晚餐吃什麼',
    '晚餐吃什么',
    '晚上吃什麼',
    '晚上吃什么',
    '今天吃什麼',
    '今天吃什么',
    'lcf',
    /london.{0,24}(?:chinese|dim\s*sum|hot\s*pot|bubble\s*tea|sichuan|cantonese)/i,
    /(?:chinese|dim\s*sum|hot\s*pot|bubble\s*tea|sichuan|cantonese).{0,24}(?:london|soho|chinatown|ucl|lse|kcl|soas|imperial)/i,
    /倫敦.{0,12}(?:吃|餐廳|中餐|麵|飯|茶|點心|火鍋|燒烤|奶茶)/,
    /伦敦.{0,12}(?:吃|餐厅|中餐|面|饭|茶|点心|火锅|烧烤|奶茶)/,
    /(?:soho|chinatown|ucl|lse|kcl|imperial|canary\s*wharf|shoreditch|king'?s\s*cross|euston|holborn|covent\s*garden|camden|angel|stratford|paddington|waterloo|london\s*bridge|borough|bank|old\s*street|brixton|south\s*kensington|kensington|greenwich|hammersmith|notting\s*hill|wembley|london|倫敦|伦敦|中國城|中国城).{0,24}(?:吃的|好吃|推薦吃|推荐吃|吃什麼|吃什么|餐廳|餐厅|吃飯|吃饭|拉麵|拉面|麵館|面馆|火鍋|火锅|點心|点心|奶茶|川菜|粵菜|粤菜|燒臘|烧腊|燒烤|烧烤|烤串|烤魚|烤鱼|米線|米线|中餐|where\s+to\s+eat|food|lunch|dinner)/i,
    /(?:吃的|好吃|推薦吃|推荐吃|吃什麼|吃什么|餐廳|餐厅|吃飯|吃饭|拉麵|拉面|麵館|面馆|火鍋|火锅|點心|点心|奶茶|川菜|粵菜|粤菜|燒臘|烧腊|燒烤|烧烤|烤串|烤魚|烤鱼|米線|米线|中餐|where\s+to\s+eat|good\s+food).{0,24}(?:soho|chinatown|ucl|lse|kcl|imperial|canary\s*wharf|shoreditch|king'?s\s*cross|euston|holborn|covent\s*garden|camden|angel|stratford|paddington|waterloo|london\s*bridge|borough|bank|old\s*street|brixton|south\s*kensington|kensington|greenwich|hammersmith|notting\s*hill|wembley|london|倫敦|伦敦|中國城|中国城)/i,
    /(?:好餓|好饿|餓了|饿了|推薦吃的|推荐吃的|吃什麼|吃什么|吃飯|吃饭|燒烤|烧烤|烤串|烤魚|烤鱼|米線|米线|where\s+to\s+eat).{0,28}(?:soho|chinatown|ucl|lse|kcl|imperial|canary\s*wharf|shoreditch|king'?s\s*cross|euston|holborn|covent\s*garden|camden|angel|stratford|paddington|waterloo|london\s*bridge|borough|bank|old\s*street|brixton|south\s*kensington|kensington|greenwich|hammersmith|notting\s*hill|wembley|london|倫敦|伦敦|附近)/i,
    /(?:soho|chinatown|ucl|lse|kcl|imperial|canary\s*wharf|shoreditch|king'?s\s*cross|euston|holborn|covent\s*garden|camden|angel|stratford|paddington|waterloo|london\s*bridge|borough|bank|old\s*street|brixton|south\s*kensington|kensington|greenwich|hammersmith|notting\s*hill|wembley|london|倫敦|伦敦).{0,16}(?:附近)?(?:有沒有|有没有)?(?:推薦|推荐)?(?:吃的|好吃|餐廳|餐厅|吃飯|吃饭|燒烤|烧烤|烤串|烤魚|烤鱼|米線|米线)/i,
    /(?:好想|我想|想)吃.{0,4}(?:冰淇淋|冰激凌|雪糕|燒烤|烧烤|火鍋|火锅|點心|点心|甜品|糖水|拉麵|拉面|川菜|烤鴨|烤鸭|小籠包|小笼包|螺螄粉|螺蛳粉)/,
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
    'openai',
    'anthropic',
    'claude',
    'gemini',
    'deepseek',
    'llm',
    '大模型',
    '新模型',
    'pop-up',
    'popup',
    'pop up',
    '快閃',
    '快闪',
    '展覽',
    '展览',
    'exhibition',
    'sample sale',
    '逛逛',
    '逛街',
    '好去處',
    '好去处',
    '哪裡好玩',
    '哪里好玩',
    '市集',
    'split bill',
    'split the bill',
    '分帳',
    '分账',
    'aa制',
    'hackathon',
    'hackathons',
    '黑客松',
    '駭客松',
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
  /^(?:你好|妳好|您好|嗨|哈囉|哈喽|早安|早|午安|晚安|你是誰|你是谁|(?:請問|请问)?你(?:能|可以)(?:幫我|帮我)?(?:查|做)(?:什麼|什么|哪些)(?:呢|嗎|吗)?|hi|hello|hey|good\s*(?:morning|afternoon|evening)|who\s+are\s+you|what\s+can\s+you\s+(?:do|help(?:\s+(?:me\s+)?with)?|recommend|find))[!！。.?？~～\s]*$/i;

const THANKS_RE =
  /^(?:(?:好的|ok|okay)[,，!！.\s]*)?(?:(?:非常|真的|太|很)?(?:謝謝|谢谢|謝啦|谢啦|感謝|感谢|多謝|多谢)(?:你|您)?(?:啦|喔|哦|呀)?|thanks?(?:\s+(?:a\s+lot|so\s+much))?|thank\s+you(?:\s+(?:so\s+much|very\s+much))?|thx|tysm|cheers)[!！。.?？~～\s]*$/i;

const COMPOUND_RE = /^\[internal hint\]\s*process compound\b/i;

const WHATS_NEW_RE =
  /(?:最近有什麼新|最近有什么新|新開|新开|新增|新店|what(?:'s| is)\s+new|new\s+places|newly\s+(?:added|verified))/i;

const FOOD_FOLLOWUP_RE =
  /(?:哪一?[間间家個个]|[這这][幾几]?[間间家個个]|地址|菜單|菜单|價格|价格|人均|(?:開到|开到|營業到|营业到)\s*(?:幾點|几点)|幾點(?:開門|开门|關門|关门|營業|营业|打烊)|几点(?:开门|关门|营业|打烊)|開門|开门|怎麼去|怎么去|怎麼走|怎么走|還有|还有|別[間家]|别[间家]|附近|推薦|推荐|辣|素|預算|预算|地鐵|地铁|站近|近一點|近一点|步行|走路|最近|離.{0,5}站|离.{0,5}站|\b(?:which|menu|address|hours|closer|cheaper|another|more|recommend|tube|stations?|walk(?:ing)?|nearest|nearby)\b)/i;

const TUBE_NEAREST_RE = /地鐵|地铁|站近|近一點|近一点|\b(?:tube|stations?|closer|nearest)\b/i;

const QUICK_MEAL_PICK_RE =
  /(?:(?:今天|今晚|今早|中午|午餐|午飯|午饭|晚上|晚餐|晚飯|晚饭|宵夜|夜宵|等下|待會|待会|不知道|要).{0,6}(?:吃什麼|吃什么|吃啥|吃哪[間家個]|吃哪[间家个])|(?:隨便|随便|幫我|帮我|隨機|随机).{0,4}(?:推薦|推荐|挑|選|选)(?:一|兩|两|幾|几)?(?:間|家|個|个)?|\b(?:what\s+(?:should\s+(?:we|i)|to)\s+eat(?:\s+for\s+(?:lunch|dinner|supper|tonight))?|what'?s\s+for\s+(?:lunch|dinner)|pick\s+(?:me\s+|us\s+)?(?:a\s+)?(?:place|spot|somewhere)(?:\s+for\s+(?:lunch|dinner))?|surprise\s+me(?:\s+for\s+(?:lunch|dinner))?)\b)/i;

const MILD_FOOD_REQUEST_RE =
  /(?:不(?:太|要)?辣|不吃辣|怕辣|少辣|清淡|免辣|無辣|无辣|\b(?:not spicy|non[- ]spicy|no (?:chili|chilli|spice)|mild food|mild dishes?)\b)/i;

function unverifiedSpiceNote(lang: LangCode): string {
  if (lang === 'zh-Hant') return '這幾間符合地點或菜系，但我還沒核實哪些菜能做不辣。點餐前可以先問店家。';
  if (lang === 'zh-Hans') return '这几家符合地点或菜系，但我还没核实哪些菜能做不辣。点餐前可以先问店家。';
  return 'These match the location or cuisine. I haven’t verified which dishes can be made mild, so check with the restaurant before ordering.';
}

const COMPARATIVE_ADVICE_RE =
  /(?:最適合|最适合|比較適合|比较适合|哪一?[間家個个].{0,8}(?:適合|适合|比較好|比较好|推薦|推荐|不辣)|帶.{0,8}(?:朋友|小孩|孩子|長輩|长辈|父母|客戶|客户|同事)|包廂|包厢|約會|约会|適不適合|适不适合|\b(?:which\s+one\s+is\s+(?:best|better|most\s+suitable)|compare\s+(?:them|these)|kid[- ]?friendly|private\s+room|date\s+night|best\s+for)\b)/i;

const REQUESTED_LIMIT_ZH_RE = /(?:各)?(?:推|推薦|推荐|給|给|挑|找|來|来)\s*([1-5一二兩两三四五])\s*[間家個个]/;
const REQUESTED_LIMIT_EN_RE = /\b(?:just|only|pick|top)\s+([1-5]|one|two|three|four|five)\b/i;

const REQUESTED_LIMIT_MAP: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

export function parseRequestedLimit(text: string): number | null {
  const input = (text ?? '').trim();
  if (!input) return null;
  const zhMatch = input.match(REQUESTED_LIMIT_ZH_RE);
  if (zhMatch?.[1]) {
    const val = REQUESTED_LIMIT_MAP[zhMatch[1]];
    if (val) return Math.max(1, Math.min(5, val));
  }
  const enMatch = input.match(REQUESTED_LIMIT_EN_RE);
  if (enMatch?.[1]) {
    const val = REQUESTED_LIMIT_MAP[enMatch[1].toLowerCase()];
    if (val) return Math.max(1, Math.min(5, val));
  }
  return null;
}

const PLACE_ID_RE = /\brec_[a-z0-9_]{4,}\b/gi;
const MAX_PREFETCH_CHARS = 1_400;

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
  { cuisine: 'bbq', patterns: ['bbq', 'skewers', '燒烤', '烧烤', '串串', '烤串', '擼串', '撸串', '烤肉'] },
  { cuisine: 'dongbei', patterns: ['dongbei', 'northeastern', '東北菜', '东北菜', '東北', '东北'] },
  { cuisine: 'shaanxi', patterns: ['shaanxi', "xi'an", 'xian', 'biang', '陝西', '陕西', '西安', '肉夾饃', '肉夹馍'] },
  { cuisine: 'lanzhou', patterns: ['lanzhou', '蘭州', '兰州'] },
  { cuisine: 'xinjiang', patterns: ['xinjiang', 'uyghur', '新疆'] },
  { cuisine: 'shanghai', patterns: ['shanghai', 'shanghainese', '上海菜', '本幫菜', '本帮菜'] },
  { cuisine: 'taiwanese', patterns: ['taiwanese', 'taiwan', '台灣菜', '台湾菜', '台式', '台灣', '台湾'] },
  { cuisine: 'noodles', patterns: ['noodle', 'noodles', 'ramen', '麵館', '面馆', '拉麵', '拉面', '牛肉麵', '牛肉面', '粉麵', '粉面'] },
  { cuisine: 'dumplings', patterns: ['dumpling', 'dumplings', '餃子', '饺子', '水餃', '水饺', '鍋貼', '锅贴', '包子'] },
  { cuisine: 'bubble-tea', patterns: ['bubble tea', 'boba', 'milk tea', '奶茶', '波霸', '珍珠奶茶'] },
  {
    cuisine: 'desserts',
    patterns: [
      'tong sui',
      'dessert',
      'desserts',
      '糖水',
      '甜品',
      '甜點',
      '甜点',
      '冰淇淋',
      '冰激凌',
      '雪糕',
      '刨冰',
      '雙皮奶',
      '双皮奶',
      '楊枝甘露',
      '杨枝甘露',
      '芋圓',
      '芋圆',
      '雞蛋仔',
      '鸡蛋仔',
      '冰沙',
    ],
  },
  { cuisine: 'bakery', patterns: ['bakery', 'pastry', '烘焙', '中式烘焙', '中式麵包', '中式面包', '麵包店', '面包店', '蛋撻', '蛋挞'] },
  { cuisine: 'vegetarian', patterns: ['vegetarian', 'vegan', '素食', '素菜'] },
  { cuisine: 'groceries', patterns: ['grocery', 'supermarket', 'groceries', '中超', '中國超市', '中国超市', '華人超市', '华人超市'] },
];

const CATEGORY_KEYWORDS: ReadonlyArray<{ category: string; patterns: string[] }> = [
  { category: 'grocery', patterns: ['grocery', 'supermarket', '中超', '中國超市', '中国超市', '華人超市', '华人超市'] },
  { category: 'tea-drinks', patterns: ['bubble tea', 'boba', 'milk tea', '奶茶', '茶飲', '茶饮'] },
  { category: 'bakery-dessert', patterns: ['bakery', 'dessert', 'desserts', '烘焙', '甜品', '糖水', '蛋糕'] },
  { category: 'takeaway', patterns: ['takeaway', '外賣', '外卖'] },
];

export interface ResolvedLocation {
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

export function extractLocation(text: string, lang: LangCode, entries: readonly IndexEntry[]): ResolvedLocation | null {
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
  extra?: { distKm?: number; note?: string; requestedCuisines?: readonly string[] },
): string[] {
  const nameZh = entry.z ? localizeZh(entry.z, lang) : entry.z;
  const name = [entry.n, nameZh].filter(Boolean).join(' / ') || entry.id;
  const requestedCuisines = extra?.requestedCuisines ?? [];
  const matchingCuisines = requestedCuisines.filter((cuisine) => entry.k.includes(cuisine));
  const cuisineBits = [...new Set([...matchingCuisines, ...entry.k])]
    .slice(0, 2)
    .map((cuisine) => labelFor(CUISINE_TEXT, cuisine, lang));
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

export function greetingReply(lang: LangCode): string {
  if (lang === 'zh-Hant') {
    return '嗨！我是倫敦中餐地圖小幫手，想在倫敦哪一帶吃什麼或找哪種菜系，直接問我就好 🍜';
  }
  if (lang === 'zh-Hans') {
    return '嗨！我是伦敦中餐地图小助手，想在伦敦哪一带吃什么或找哪种菜系，直接问我就行 🍜';
  }
  return "Hi! I'm the London Chinese Food guide — tell me an area, station, or dish you're craving and I'll look it up 🍜";
}

export function thanksReply(lang: LangCode): string {
  if (lang === 'zh-Hant') {
    return '不客氣！祝你用餐愉快 🍜 之後想在倫敦哪一區找中餐或特定菜色，隨時跟我說！';
  }
  if (lang === 'zh-Hans') {
    return '不客气！祝你用餐愉快 🍜 之后想在伦敦哪一区找中餐或特定菜色，随时跟我说！';
  }
  return "You're welcome! Enjoy your meal 🍜 Ask anytime if you want more Chinese food picks around London.";
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

export function resolveMemoryLocationHint(
  memories: RecallTurnResult,
  lang: LangCode,
  entries: readonly IndexEntry[],
): ResolvedLocation | null {
  const all = [...memories.userMemories, ...memories.roomMemories];
  for (const m of all) {
    if (
      m.key === 'campus' ||
      m.key === 'default_area' ||
      m.key === 'area' ||
      m.key === 'postcode' ||
      m.key === 'note' ||
      m.key.startsWith('note_')
    ) {
      const resolved = extractLocation(m.value, lang, entries);
      if (resolved) return resolved;
    }
  }
  return null;
}

function hasAntiKeywordHit(text: string): boolean {
  const lower = text.toLowerCase();
  return (LCF_AGENT_SPEC.antiKeywords ?? []).some((kw) => {
    if (kw instanceof RegExp) return kw.test(text);
    return matchKeywordToken(lower, kw);
  });
}

function nearestStationForEntry(entry: IndexEntry): { name: string; km: number } | null {
  if (entry.la === null || entry.lo === null) return null;
  const hit = nearestStation({ lat: entry.la, lng: entry.lo });
  return hit ? { name: hit.name, km: hit.km } : null;
}

function formatNearestStationNote(
  station: { name: string; km: number } | null,
  lang: LangCode,
): string | undefined {
  if (!station) return undefined;
  const mins = walkMinutes(station.km);
  if (lang === 'zh-Hant') return `近 ${station.name} 站約 ${mins} min`;
  if (lang === 'zh-Hans') return `近 ${station.name} 站约 ${mins} min`;
  return `near ${station.name} (~${mins} min walk)`;
}

function resolveActiveSessionHints(
  event: InboundEvent,
  context: RoomContext | undefined,
  lang: LangCode,
  entries: readonly IndexEntry[],
  needLocation: boolean,
  needTopic: boolean,
): {
  location: ResolvedLocation | null;
  dishes: DishEntry[];
  cuisines: string[];
  categories: string[];
} {
  const empty = { location: null, dishes: [], cuisines: [], categories: [] };
  if (!context?.recentHistory?.length || (!needLocation && !needTopic)) {
    return empty;
  }

  const recentHumanTurns = context.recentHistory
    .filter((t) => t.eventId !== event.eventId && !t.isAgent && t.text.trim())
    .slice(-8)
    .reverse();
  const orderedTurns = event.senderId
    ? [
        ...recentHumanTurns.filter((t) => t.senderId === event.senderId),
        ...recentHumanTurns.filter((t) => t.senderId !== event.senderId),
      ]
    : recentHumanTurns;

  let location: ResolvedLocation | null = null;
  let dishes: DishEntry[] = [];
  let cuisines: string[] = [];
  let categories: string[] = [];

  for (const turn of orderedTurns) {
    const turnText = stripMentions(turn.text);
    if (!turnText) continue;

    const turnDishes = extractDishes(turnText);
    const turnCuisines = extractCuisines(turnText);
    const turnCategories = extractCategories(turnText);
    const hasTopic = turnDishes.length > 0 || turnCuisines.length > 0 || turnCategories.length > 0;

    // Ignore purely off-topic turns (markets/exhibitions/tarot) when inheriting active food context.
    if (!hasTopic && hasAntiKeywordHit(turnText)) continue;

    if (needLocation && !location) {
      location = extractLocation(turnText, lang, entries);
    }
    if (needTopic && dishes.length === 0 && cuisines.length === 0 && categories.length === 0 && hasTopic) {
      dishes = turnDishes;
      cuisines = turnCuisines;
      categories = turnCategories;
    }
    if ((!needLocation || location) && (!needTopic || dishes.length > 0 || cuisines.length > 0 || categories.length > 0)) {
      break;
    }
  }

  return { location, dishes, cuisines, categories };
}

async function respondForDishQuery(
  env: Env,
  db: D1Database,
  primaryDish: DishEntry,
  openEntries: readonly IndexEntry[],
  location: ResolvedLocation | null,
  lang: LangCode,
  limit: number,
  wantsNearestTube: boolean,
): Promise<string | null> {
  const servedAt = await findPlacesServingDish(db, primaryDish, openEntries);
  if (servedAt.length === 0) return null;

  let ranked = servedAt.map((item) => ({
    ...item,
    distKm:
      location?.point && item.entry.la !== null && item.entry.lo !== null
        ? distanceKm(location.point, { lat: item.entry.la, lng: item.entry.lo })
        : undefined,
    station: wantsNearestTube ? nearestStationForEntry(item.entry) : null,
  }));

  if (wantsNearestTube) {
    if (location?.point) {
      const localRadius = Math.max(location.km ?? 1.5, 3.5);
      const local = ranked.filter((item) => item.distKm !== undefined && item.distKm <= localRadius);
      if (local.length > 0) ranked = local;
    }
    ranked.sort(
      (a, b) =>
        (a.station?.km ?? Number.POSITIVE_INFINITY) - (b.station?.km ?? Number.POSITIVE_INFINITY) ||
        (a.distKm ?? Number.POSITIVE_INFINITY) - (b.distKm ?? Number.POSITIVE_INFINITY),
    );
  } else if (location?.point) {
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
    const dishNote =
      item.via === 'menu' && item.pricePence !== null
        ? `${item.itemName ?? ''} ${formatPricePence(item.pricePence)}`.trim()
        : undefined;
    const stationNote = wantsNearestTube ? formatNearestStationNote(item.station, lang) : undefined;
    const note = [dishNote, stationNote].filter(Boolean).join(' · ') || undefined;
    lines.push(...formatPlaceLine(env, item.entry, lang, { distKm: item.distKm, note }));
  }
  return lines.join('\n');
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
  context?: RoomContext,
): Promise<string | null> {
  const lang = decision.detectedLang;
  const cleanedText = stripMentions(event.text);
  const isUnmentionedGroup =
    event.chatType === 'group' && decision.reason !== 'explicit_mention' && decision.reason !== 'reply_to_self';

  if (event.kind === 'image' || event.kind === 'compound' || COMPOUND_RE.test(event.text)) {
    return compoundReply(lang);
  }
  if (!cleanedText || GREETING_RE.test(cleanedText)) {
    if (isUnmentionedGroup && decision.reason === 'active_session') {
      return '[NO_REPLY]';
    }
    return greetingReply(lang);
  }
  if (THANKS_RE.test(cleanedText)) {
    if (isUnmentionedGroup && decision.reason === 'active_session') {
      return '[NO_REPLY]';
    }
    return thanksReply(lang);
  }

  const isMultiMention = decision.reason === 'multi_mention_domain_match';
  const hasAntiHit = hasAntiKeywordHit(cleanedText);

  const baseLimit = event.isVoice ? 2 : event.chatType === 'group' ? 3 : 5;
  const requestedLimit = parseRequestedLimit(cleanedText);
  const limit = requestedLimit !== null ? Math.min(baseLimit, requestedLimit) : baseLimit;

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
  let dishes = extractDishes(cleanedText);
  let cuisines = extractCuisines(cleanedText);
  let categories = extractCategories(cleanedText);
  const explicitLocation = extractLocation(cleanedText, lang, allEntries);
  const wantsNearestTube = TUBE_NEAREST_RE.test(cleanedText);
  const isDmFollowup =
    (decision.reason === 'dm' || event.chatType === 'dm') &&
    (FOOD_FOLLOWUP_RE.test(cleanedText) || wantsNearestTube);

  const activeHints =
    decision.reason === 'active_session' || isDmFollowup
      ? resolveActiveSessionHints(
          event,
          context,
          lang,
          allEntries,
          !explicitLocation,
          dishes.length === 0 && cuisines.length === 0 && categories.length === 0,
        )
      : { location: null, dishes: [], cuisines: [], categories: [] };
  const location = explicitLocation ?? activeHints.location ?? resolveMemoryLocationHint(memories, lang, allEntries);

  if (isUnmentionedGroup && !location && CASUAL_MEAL_QUESTION_RE.test(cleanedText)) {
    return lang === 'zh-Hans' ? '你在哪一带？我帮你找附近的中餐。' : '你在哪一帶？我幫你找附近的中餐。';
  }

  // Off-topic guard on explicit mentions / DMs / unmentioned group turns
  if (hasAntiHit && dishes.length === 0 && cuisines.length === 0 && categories.length === 0 && !explicitLocation) {
    return isMultiMention || isUnmentionedGroup ? '[NO_REPLY]' : offTopicRedirect(lang);
  }

  // 2. Dish query ("where can I eat 小籠包 / har gow / biang biang noodles near UCL?")
  if (dishes.length > 0) {
    const dishReply = await respondForDishQuery(
      env,
      env.DB,
      dishes[0]!,
      openEntries,
      location,
      lang,
      limit,
      wantsNearestTube,
    );
    if (dishReply) return dishReply;
  }

  // 3. Direct place name lookup (if user named a specific restaurant/shop in D1)
  let hasNameMatches = false;
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
    hasNameMatches = nameMatches.length > 0;
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

  // Unmentioned active-session office/meeting chatter stays silent even if generic cues overlap.
  if (
    isUnmentionedGroup &&
    decision.reason === 'active_session' &&
    dishes.length === 0 &&
    cuisines.length === 0 &&
    categories.length === 0 &&
    !explicitLocation &&
    /(?:會議室|会议室|開會|开会|meeting\s+room|late\s+to\s+the\s+office|對了\s*大家|对了\s*大家)/i.test(cleanedText)
  ) {
    return '[NO_REPLY]';
  }

  // Comparative / situational advice follow-ups (e.g. "這幾間裡面哪一間最適合帶不吃辣的英國朋友去？")
  // delegate to Manyfold A2A (with d1_prefetched_records) instead of re-dumping the exact same D1 list.
  const isDirectOrDmTurn =
    !isUnmentionedGroup || event.chatType === 'dm' || decision.reason === 'dm';
  const isActiveFoodFollowup =
    decision.reason === 'active_session' &&
    !hasAntiHit &&
    (extractRecentPlaceIds(context, 1).length > 0 ||
      Boolean(activeHints.location) ||
      activeHints.dishes.length > 0 ||
      activeHints.cuisines.length > 0 ||
      activeHints.categories.length > 0);
  if (
    hasA2ACredential(env) &&
    (isDirectOrDmTurn || isActiveFoodFollowup) &&
    dishes.length === 0 &&
    cuisines.length === 0 &&
    categories.length === 0 &&
    !explicitLocation &&
    !hasNameMatches &&
    COMPARATIVE_ADVICE_RE.test(cleanedText)
  ) {
    return null;
  }

  // Quick meal-picker fast-path for spontaneous "what should we eat?" prompts with no dish/cuisine/place specified.
  if (
    dishes.length === 0 &&
    cuisines.length === 0 &&
    categories.length === 0 &&
    !hasNameMatches &&
    (!isUnmentionedGroup || !hasAntiHit) &&
    QUICK_MEAL_PICK_RE.test(cleanedText) &&
    openEntries.length > 0
  ) {
    let pool: Array<{ entry: IndexEntry; distKm?: number }> = [];
    let usedLocationLabel = '';
    if (location?.point) {
      const nearby = placesNear(openEntries, location.point, location.km ?? 1.5);
      const nearbyMeals = nearby.filter((n) => !isNonMealEntry(n.entry));
      const broadened =
        nearbyMeals.length >= 2 ? nearbyMeals : placesNear(openEntries, location.point, 3.5);
      if (broadened.length > 0) {
        const mealBroadened = broadened.filter((n) => !isNonMealEntry(n.entry));
        const source = mealBroadened.length > 0 ? mealBroadened : broadened;
        pool = source.slice(0, 12).map((n) => ({ entry: n.entry, distKm: n.km }));
        usedLocationLabel = localizeZh(location.label, lang);
      }
    } else if (location?.postcode) {
      const filtered = queryPlaces(openEntries, {
        postcode: location.postcode,
        openOnly: true,
        sort: 'recent',
      });
      if (filtered.length > 0) {
        const mealFiltered = filtered.filter((entry) => !isNonMealEntry(entry));
        const source = mealFiltered.length > 0 ? mealFiltered : filtered;
        pool = source.slice(0, 12).map((entry) => ({ entry }));
        usedLocationLabel = localizeZh(location.label, lang);
      }
    }
    if (pool.length === 0) {
      pool = [...openEntries]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => ({ entry }));
    }

    const picked = pickQuickMealSpots(pool, event.eventId || cleanedText, Math.min(limit, 2));
    if (picked.length > 0) {
      const header =
        lang === 'zh-Hant'
          ? `🍜 幫你挑 ${picked.length} 間營業中倫敦中餐${usedLocationLabel ? `（${usedLocationLabel} 一帶）` : ''}：`
          : lang === 'zh-Hans'
            ? `🍜 帮你挑 ${picked.length} 家营业中伦敦中餐${usedLocationLabel ? `（${usedLocationLabel} 一带）` : ''}：`
            : `🍜 Here ${picked.length === 1 ? 'is 1 quick open London Chinese food pick' : `are ${picked.length} quick open London Chinese food picks`}${usedLocationLabel ? ` near ${usedLocationLabel}` : ''}:`;
      const lines = [header];
      for (const item of picked) {
        lines.push(...formatPlaceLine(env, item.entry, lang, { distKm: item.distKm }));
      }
      return lines.join('\n');
    }
  }

  // Unmentioned active-session turns with zero food signals and no food follow-up cue stay silent.
  if (
    isUnmentionedGroup &&
    decision.reason === 'active_session' &&
    dishes.length === 0 &&
    cuisines.length === 0 &&
    categories.length === 0 &&
    !explicitLocation &&
    !WHATS_NEW_RE.test(cleanedText) &&
    !hasNameMatches &&
    !FOOD_FOLLOWUP_RE.test(cleanedText)
  ) {
    return '[NO_REPLY]';
  }

  // Inherit prior turn's dish/cuisine/category for active-session or DM follow-ups (e.g. "有沒有離地鐵站近一點的？").
  if (
    (decision.reason === 'active_session' || (isDmFollowup && (!explicitLocation || wantsNearestTube))) &&
    dishes.length === 0 &&
    cuisines.length === 0 &&
    categories.length === 0
  ) {
    dishes = activeHints.dishes;
    cuisines = activeHints.cuisines;
    categories = activeHints.categories;
    if (dishes.length > 0) {
      const dishReply = await respondForDishQuery(
        env,
        env.DB,
        dishes[0]!,
        openEntries,
        location,
        lang,
        limit,
        wantsNearestTube,
      );
      if (dishReply) return dishReply;
    }
  }

  // 4. Location + optional cuisine/category query
  if (location || cuisines.length > 0 || categories.length > 0) {
    let matches: Array<{ entry: IndexEntry; distKm?: number; station?: { name: string; km: number } | null }> = [];

    if (location?.point) {
      const radius = location.km ?? 1.5;
      const filterNearby = (list: ReturnType<typeof placesNear>, useCategories: boolean) =>
        list.filter(
          (n) =>
            (!cuisines.length || cuisines.some((c) => n.entry.k.includes(c))) &&
            (!useCategories || !categories.length || categories.includes(n.entry.c)),
        );
      const nearby = filterNearby(placesNear(openEntries, location.point, radius), true);
      let broadened =
        nearby.length > 0 ? nearby : filterNearby(placesNear(openEntries, location.point, 3.5), true);
      if (broadened.length === 0 && cuisines.length > 0 && categories.length > 0) {
        broadened = filterNearby(placesNear(openEntries, location.point, 3.5), false);
      }
      matches = broadened.map((n) => ({ entry: n.entry, distKm: n.km }));
    } else {
      let filtered = queryPlaces(openEntries, {
        ...(location?.postcode ? { postcode: location.postcode } : {}),
        ...(cuisines.length ? { cuisines } : {}),
        ...(categories.length ? { categories } : {}),
        openOnly: true,
        sort: 'recent',
      });
      if (filtered.length === 0 && cuisines.length > 0 && categories.length > 0) {
        filtered = queryPlaces(openEntries, {
          ...(location?.postcode ? { postcode: location.postcode } : {}),
          cuisines,
          openOnly: true,
          sort: 'recent',
        });
      }
      matches = filtered.map((entry) => ({ entry }));
    }

    if (matches.length > 0) {
      if (
        dishes.length === 0 &&
        cuisines.length === 0 &&
        categories.length === 0 &&
        !NON_MEAL_QUERY_RE.test(cleanedText)
      ) {
        const mealMatches = matches.filter((m) => !isNonMealEntry(m.entry));
        if (mealMatches.length > 0) {
          matches = mealMatches;
        }
      }
      if (wantsNearestTube) {
        matches = matches
          .map((m) => ({ ...m, station: nearestStationForEntry(m.entry) }))
          .sort(
            (a, b) =>
              (a.station?.km ?? Number.POSITIVE_INFINITY) - (b.station?.km ?? Number.POSITIVE_INFINITY) ||
              (a.distKm ?? Number.POSITIVE_INFINITY) - (b.distKm ?? Number.POSITIVE_INFINITY),
          );
      }
      const picked = matches.slice(0, limit);
      const locationLabel = location ? localizeZh(location.label, lang) : '';
      const header =
        lang === 'zh-Hant'
          ? `🍜 為你查到 ${picked.length} 間營業中選擇${location ? `（${locationLabel} 一帶）` : ''}：`
          : lang === 'zh-Hans'
            ? `🍜 为你查到 ${picked.length} 家营业中选择${location ? `（${locationLabel} 一带）` : ''}：`
            : `🍜 Found ${picked.length} open place${picked.length === 1 ? '' : 's'}${location ? ` near ${locationLabel}` : ''}:`;

      const lines = [header];
      if (MILD_FOOD_REQUEST_RE.test(cleanedText)) lines.push(unverifiedSpiceNote(lang));
      for (const m of picked) {
        const note = wantsNearestTube ? formatNearestStationNote(m.station ?? null, lang) : undefined;
        lines.push(...formatPlaceLine(env, m.entry, lang, { distKm: m.distKm, note, requestedCuisines: cuisines }));
      }
      return lines.join('\n');
    }
  }

  // Unmentioned group turns with zero matching places stay silent instead of triggering A2A or generic prompts.
  if (isUnmentionedGroup) {
    return '[NO_REPLY]';
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

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NON_MEAL_TOKEN_RE =
  /(?:^|[-_\s/])(?:bubble[-_\s]?tea|boba|tea[-_\s]?drinks?|tea|drinks?|grocery|groceries|supermarket|bakery|desserts?|pastry|tong[-_\s]?sui)(?:$|[-_\s/])|奶茶|茶飲|茶饮|甜品|糖水|超市|中超|烘焙/i;

const NON_MEAL_QUERY_RE =
  /\b(?:grocery|groceries|supermarket|bubble\s*tea|boba|milk\s*tea|bakery|pastry|desserts?|tong\s*sui|ice\s*cream|gelato|shaved\s*ice)\b|中超|超市|食材|奶茶|波霸|茶飲|茶饮|烘焙|麵包|面包|甜品|甜點|甜点|糖水|蛋糕|蛋撻|蛋挞|冰淇淋|冰激凌|雪糕|刨冰|雙皮奶|双皮奶|楊枝甘露|杨枝甘露|芋圓|芋圆|雞蛋仔|鸡蛋仔|冰沙/i;

function isNonMealEntry(entry: Pick<IndexEntry, 'c' | 'k'>): boolean {
  const category = (entry.c ?? '').trim();
  if (category && NON_MEAL_TOKEN_RE.test(category)) return true;
  const cuisines = Array.isArray(entry.k) ? entry.k.map((k) => k.trim()).filter(Boolean) : [];
  if (cuisines.length > 0 && cuisines.every((k) => NON_MEAL_TOKEN_RE.test(k))) return true;
  return false;
}

export function pickQuickMealSpots<T extends { entry: Pick<IndexEntry, 'c' | 'k'> }>(
  pool: readonly T[],
  seedInput: string,
  count = 2,
): T[] {
  const mealPool = pool.filter((item) => !isNonMealEntry(item.entry));
  const candidates = mealPool.length > 0 ? mealPool : pool;
  if (candidates.length <= count) return [...candidates];
  const seed = hashSeed(seedInput);
  const first = seed % candidates.length;
  if (count <= 1) return [candidates[first]!];
  const step = 1 + ((seed >>> 8) % (candidates.length - 1));
  const second = (first + step) % candidates.length;
  return [candidates[first]!, candidates[second]!];
}

function extractRecentPlaceIds(context?: RoomContext, limit = 4): string[] {
  if (!context) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  const collect = (text?: string) => {
    if (!text) return;
    for (const match of text.matchAll(PLACE_ID_RE)) {
      const id = match[0];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= limit) return;
    }
  };

  if (context.replyToTarget?.text) {
    collect(context.replyToTarget.text);
    if (ids.length > 0) return ids;
  }
  if (context.recentHistory?.length) {
    const selfTurns = [...context.recentHistory]
      .reverse()
      .filter((t) => t.isSelf || t.senderId === LCF_MATRIX_ID);
    for (const turn of selfTurns.slice(0, 4)) {
      collect(turn.text);
      if (ids.length > 0) break;
    }
  }
  return ids;
}

function formatPrefetchedPlaceDoc(env: Pick<Env, 'PUBLIC_URL'>, doc: PlaceDoc, lang: LangCode): string {
  const nameEn =
    typeof doc.place.name_en === 'string' && !findRating(doc.place.name_en) ? doc.place.name_en : null;
  const rawNameZh =
    typeof doc.place.name_zh === 'string' && !findRating(doc.place.name_zh) ? doc.place.name_zh : null;
  const nameZh = rawNameZh ? localizeZh(rawNameZh, lang) : null;
  const name = [nameEn, nameZh].filter(Boolean).join(' / ') || doc.id;
  const cuisines =
    Array.isArray(doc.place.cuisines) && doc.place.cuisines.length > 0
      ? (doc.place.cuisines as string[]).slice(0, 3).map((c) => labelFor(CUISINE_TEXT, c, lang)).join(', ')
      : labelFor(CATEGORY_TEXT, String(doc.place.category ?? 'restaurant'), lang);
  const address = [doc.place.address, doc.place.postcode]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(', ');
  const trading = typeof doc.place.trading === 'string' ? doc.place.trading : 'open';
  const rawHours =
    typeof doc.place.hours === 'string'
      ? doc.place.hours.trim()
      : typeof doc.place.opening_hours === 'string'
        ? doc.place.opening_hours.trim()
        : '';

  const parts: string[] = [`[${doc.id}] ${name} (${cuisines}; ${trading})`];
  if (address) parts.push(`Address: ${address}`);
  if (rawHours) parts.push(`Hours: ${rawHours}`);

  const highlights: string[] = [];
  const firstMenu = doc.menus[0];
  if (firstMenu) {
    const items = firstMenu.sections
      .flatMap((s) => s.items)
      .filter((i) => i.name_en || i.name_zh)
      .slice(0, 3)
      .map((i) => {
        const itemZh = i.name_zh ? localizeZh(i.name_zh, lang) : i.name_zh;
        return `${[itemZh, i.name_en].filter(Boolean).join(' ')} ${formatPricePence(i.price_pence ?? null)}`.trim();
      });
    if (items.length > 0) highlights.push(`Menu: ${items.join(', ')}`);
  }
  const safeReview = doc.reviews.find((r) => r.excerpt && !findRating(r.excerpt));
  if (safeReview) {
    const snippet = localizeZh(safeReview.excerpt.replace(/\s+/g, ' ').trim().slice(0, 100), lang);
    highlights.push(`Note: "${snippet}"`);
  }
  if (highlights.length > 0) parts.push(highlights.join(' | '));
  parts.push(placeUrl(env, lang, doc.id, doc.slug));
  return parts.join(' · ');
}

export async function buildLcfExtraEnvelopeFields(
  env: Env,
  _event: InboundEvent,
  decision: TriageDecision,
  _memories: RecallTurnResult,
  context: RoomContext,
): Promise<Record<string, string> | null> {
  if (!env.DB) return null;
  const ids = extractRecentPlaceIds(context, 4);
  if (ids.length === 0) return null;

  await ensureSchema(env.DB);
  const docs = await Promise.all(ids.map((id) => loadPlaceDocOrSynthesize(env.DB, id).catch(() => null)));
  const lines = docs
    .filter((d): d is PlaceDoc => d !== null)
    .map((d) => formatPrefetchedPlaceDoc(env, d, decision.detectedLang));
  if (lines.length === 0) return null;

  const combined = lines.join('\n');
  const trimmed =
    combined.length <= MAX_PREFETCH_CHARS
      ? combined
      : `${combined.slice(0, MAX_PREFETCH_CHARS - 1).trimEnd()}…`;
  return { d1_prefetched_records: trimmed };
}

export const lcfThinkingMessage = (lang: LangCode): string =>
  lang === 'zh-Hant'
    ? '🍜 正在幫你查倫敦中餐與最新資訊，稍等一下…'
    : lang === 'zh-Hans'
      ? '🍜 正在帮你查伦敦中餐与最新信息，稍等一下…'
      : '🍜 Looking up London Chinese food details for you, one moment…';

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
    triageModel: (env) => {
      if (!env.AI || (env.NARRA_AI_TRIAGE ?? '').trim() === 'off') return undefined;
      const model = createWorkersAiTriageModel(env.AI, { model: env.AI_TRIAGE_MODEL });
      return {
        ...model,
        score: (input) =>
          CASUAL_MEAL_QUESTION_RE.test(input.event.text.trim())
            ? Promise.resolve({ score: 0.7, reason: 'domain_match' })
            : model.score(input),
      };
    },
    fetchUpdates: (env, sinceIso) => fetchLcfUpdates(env, sinceIso, overrides.fetchImpl),
    fastRespond: fastRespondLcf,
    resolveA2ACredential: resolveLcfA2ACredential,
    buildExtraEnvelopeFields: buildLcfExtraEnvelopeFields,
    thinkingMessage: lcfThinkingMessage,
    enableA2AFailureReply: true,
    ...overrides,
  };
}

export const lcfGatewayConfig: NarraGatewayConfig<Env> = createLcfGatewayConfig();
