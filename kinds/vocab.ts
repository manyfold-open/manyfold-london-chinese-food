/**
 * Closed lists the kinds share, each value with its label in both languages. Values are what
 * agents send and URLs carry; labels are what readers see.
 */

import type { Bilingual } from '../src/shared/kinds.ts';

type Labels = Readonly<Record<string, Bilingual>>;

const valuesOf = (labels: Labels): readonly string[] => Object.keys(labels);

export const CATEGORY_LABELS: Labels = {
  restaurant: { en: 'Restaurant', zh: '餐厅' },
  takeaway: { en: 'Takeaway', zh: '外卖店' },
  'bakery-dessert': { en: 'Bakery & desserts', zh: '烘焙甜品' },
  'tea-drinks': { en: 'Bubble tea & drinks', zh: '奶茶茶饮' },
  grocery: { en: 'Supermarket & deli', zh: '华人超市' },
};
export const CATEGORIES = valuesOf(CATEGORY_LABELS);

export const CUISINE_LABELS: Labels = {
  cantonese: { en: 'Cantonese', zh: '粤菜' },
  'dim-sum': { en: 'Dim sum', zh: '点心早茶' },
  'roast-meats': { en: 'Roast meats', zh: '烧腊' },
  'hong-kong-cafe': { en: 'Hong Kong café', zh: '港式茶餐厅' },
  chaoshan: { en: 'Chaoshan', zh: '潮汕菜' },
  hakka: { en: 'Hakka', zh: '客家菜' },
  fujian: { en: 'Fujian', zh: '闽菜' },
  sichuan: { en: 'Sichuan', zh: '川菜' },
  chongqing: { en: 'Chongqing', zh: '重庆菜' },
  hunan: { en: 'Hunan', zh: '湘菜' },
  guizhou: { en: 'Guizhou', zh: '贵州菜' },
  yunnan: { en: 'Yunnan', zh: '云南菜' },
  dongbei: { en: 'Dongbei (Northeastern)', zh: '东北菜' },
  beijing: { en: 'Beijing', zh: '京菜' },
  shandong: { en: 'Shandong', zh: '鲁菜' },
  shaanxi: { en: "Shaanxi (Xi'an)", zh: '陕西菜' },
  lanzhou: { en: 'Lanzhou noodles', zh: '兰州拉面' },
  xinjiang: { en: 'Xinjiang (Uyghur)', zh: '新疆菜' },
  shanghai: { en: 'Shanghai', zh: '上海菜' },
  jiangzhe: { en: 'Jiangsu & Zhejiang', zh: '江浙菜' },
  taiwanese: { en: 'Taiwanese', zh: '台湾菜' },
  hotpot: { en: 'Hotpot', zh: '火锅' },
  malatang: { en: 'Malatang & dry pot', zh: '麻辣烫冒菜' },
  bbq: { en: 'Chinese BBQ skewers', zh: '烧烤串串' },
  noodles: { en: 'Noodles', zh: '面馆' },
  dumplings: { en: 'Dumplings & buns', zh: '饺子包子' },
  'street-food': { en: 'Street food & snacks', zh: '小吃' },
  'british-chinese': { en: 'British-Chinese', zh: '英式中餐' },
  'malaysian-chinese': { en: 'Malaysian & Singaporean Chinese', zh: '南洋中餐' },
  vegetarian: { en: 'Chinese vegetarian', zh: '中式素食' },
  'modern-chinese': { en: 'Modern Chinese', zh: '新派中餐' },
  desserts: { en: 'Desserts (tong sui)', zh: '糖水甜品' },
  bakery: { en: 'Chinese bakery', zh: '中式烘焙' },
  'bubble-tea': { en: 'Bubble tea', zh: '奶茶' },
  tea: { en: 'Chinese tea', zh: '中国茶' },
  groceries: { en: 'Chinese groceries', zh: '中国食材' },
};
export const CUISINES = valuesOf(CUISINE_LABELS);

export const STATUS_LABELS: Labels = {
  open: { en: 'Open', zh: '营业中' },
  'temporarily-closed': { en: 'Temporarily closed', zh: '暂停营业' },
  closed: { en: 'Closed for good', zh: '已关闭' },
};
export const PLACE_STATUSES = valuesOf(STATUS_LABELS);

export const MENU_LABELS: Labels = {
  main: { en: 'Menu', zh: '菜单' },
  'dim-sum': { en: 'Dim sum', zh: '点心' },
  lunch: { en: 'Lunch', zh: '午市' },
  set: { en: 'Set menus', zh: '套餐' },
  drinks: { en: 'Drinks', zh: '饮品' },
  dessert: { en: 'Desserts', zh: '甜品' },
  takeaway: { en: 'Takeaway', zh: '外卖菜单' },
  other: { en: 'Other', zh: '其他' },
};
export const MENU_TYPES = valuesOf(MENU_LABELS);

export const MENU_SOURCE_LABELS: Labels = {
  website: { en: 'Website', zh: '官网' },
  pdf: { en: 'PDF menu', zh: 'PDF 菜单' },
  image: { en: 'Menu image', zh: '菜单图片' },
  'visitor-photo': { en: "A visitor's photo", zh: '访客上传的照片' },
  'delivery-app': { en: 'Delivery app (delivery prices)', zh: '外卖平台（外卖价）' },
};
export const MENU_SOURCES = valuesOf(MENU_SOURCE_LABELS);

export const DIETARY_LABELS: Labels = {
  vegetarian: { en: 'Vegetarian', zh: '素' },
  vegan: { en: 'Vegan', zh: '纯素' },
  halal: { en: 'Halal', zh: '清真' },
  'gluten-free': { en: 'Gluten-free', zh: '无麸质' },
  'contains-nuts': { en: 'Contains nuts', zh: '含坚果' },
};
export const DIETARY = valuesOf(DIETARY_LABELS);

export const SOURCE_TYPE_LABELS: Labels = {
  critic: { en: 'Critic', zh: '美食评论家' },
  publication: { en: 'Publication', zh: '媒体' },
  blog: { en: 'Blog', zh: '博客' },
  forum: { en: 'Forum', zh: '论坛' },
  social: { en: 'Social media', zh: '社交媒体' },
  video: { en: 'Video', zh: '视频' },
  platform: { en: 'Review platform', zh: '点评平台' },
};
export const SOURCE_TYPES = valuesOf(SOURCE_TYPE_LABELS);
/** Source types whose writers are public, and may be named. */
export const NAMED_SOURCE_TYPES: readonly string[] = ['critic', 'publication', 'blog', 'video'];

export const LANGUAGE_LABELS: Labels = {
  zh: { en: 'Chinese', zh: '中文' },
  en: { en: 'English', zh: '英文' },
  other: { en: 'Other', zh: '其他语言' },
};
export const LANGUAGES = valuesOf(LANGUAGE_LABELS);

export const PHOTO_SUBJECT_LABELS: Labels = {
  dish: { en: 'A dish', zh: '菜品' },
  menu: { en: 'The menu', zh: '菜单' },
  storefront: { en: 'Outside', zh: '门面' },
  interior: { en: 'Inside', zh: '店内' },
  other: { en: 'Other', zh: '其他' },
};
export const PHOTO_SUBJECTS = valuesOf(PHOTO_SUBJECT_LABELS);

/**
 * London's 33 local authorities by their ONS code, which postcodes.io gives for every postcode
 * (codes.admin_district). A postcode is in London when its district code is one of these.
 */
export const BOROUGHS: Readonly<Record<string, Bilingual>> = {
  E09000001: { en: 'City of London', zh: '伦敦金融城' },
  E09000002: { en: 'Barking and Dagenham', zh: '巴金-达格南' },
  E09000003: { en: 'Barnet', zh: '巴尼特' },
  E09000004: { en: 'Bexley', zh: '贝克斯利' },
  E09000005: { en: 'Brent', zh: '布伦特' },
  E09000006: { en: 'Bromley', zh: '布罗姆利' },
  E09000007: { en: 'Camden', zh: '卡姆登' },
  E09000008: { en: 'Croydon', zh: '克罗伊登' },
  E09000009: { en: 'Ealing', zh: '伊灵' },
  E09000010: { en: 'Enfield', zh: '恩菲尔德' },
  E09000011: { en: 'Greenwich', zh: '格林威治' },
  E09000012: { en: 'Hackney', zh: '哈克尼' },
  E09000013: { en: 'Hammersmith and Fulham', zh: '哈默史密斯-富勒姆' },
  E09000014: { en: 'Haringey', zh: '哈林盖' },
  E09000015: { en: 'Harrow', zh: '哈罗' },
  E09000016: { en: 'Havering', zh: '黑弗灵' },
  E09000017: { en: 'Hillingdon', zh: '希灵登' },
  E09000018: { en: 'Hounslow', zh: '豪恩斯洛' },
  E09000019: { en: 'Islington', zh: '伊斯灵顿' },
  E09000020: { en: 'Kensington and Chelsea', zh: '肯辛顿-切尔西' },
  E09000021: { en: 'Kingston upon Thames', zh: '泰晤士河畔金斯顿' },
  E09000022: { en: 'Lambeth', zh: '兰贝斯' },
  E09000023: { en: 'Lewisham', zh: '刘易舍姆' },
  E09000024: { en: 'Merton', zh: '默顿' },
  E09000025: { en: 'Newham', zh: '纽汉' },
  E09000026: { en: 'Redbridge', zh: '雷德布里奇' },
  E09000027: { en: 'Richmond upon Thames', zh: '泰晤士河畔里士满' },
  E09000028: { en: 'Southwark', zh: '南华克' },
  E09000029: { en: 'Sutton', zh: '萨顿' },
  E09000030: { en: 'Tower Hamlets', zh: '塔村' },
  E09000031: { en: 'Waltham Forest', zh: '沃尔瑟姆福里斯特' },
  E09000032: { en: 'Wandsworth', zh: '旺兹沃思' },
  E09000033: { en: 'Westminster', zh: '威斯敏斯特' },
};

/** Web archives a review's snapshot may be on. */
export const ARCHIVE_HOSTS: readonly string[] = ['web.archive.org', 'archive.org', 'archive.ph', 'archive.today', 'archive.is'];
