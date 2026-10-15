/**
 * The guides: an editor's few lines over a choice of places, issue by issue. A guide is never a
 * ranking. Most are a saved filter over the index (a cuisine, a kind of place, an area), shown in
 * the reader's own order; a route guide is a walk from a campus, its stops nearest first, each
 * with the dishes on its menu that answer the guide's question. A route names menu items by key,
 * and the page reads their price from the place's current menu, so a guide never prints an old one.
 * Every line of text here passes the rating guard (tests/guides.test.ts).
 */

import type { Bilingual } from './kinds.ts';
import { distanceKm } from './places-query.ts';

export interface GuideFilter {
  /** A place matches with any of these categories or cuisines... */
  categories?: readonly string[];
  cuisines?: readonly string[];
  /** ...and, when given, one of these postcode districts... */
  outcodes?: readonly string[];
  /** ...and, when given, within this distance of a point. */
  near?: { lat: number; lng: number; km: number };
}

export interface GuideStop {
  place: string;
  /** Menu items by key (src/shared/place-doc.ts, DocItem.key). */
  items: readonly string[];
}

export interface Guide {
  slug: string;
  issue: number;
  /** The line whose colour the cover wears. */
  line: string;
  published: string;
  tag: Bilingual;
  title: Bilingual;
  dek: Bilingual;
  /** How the places were chosen, said plainly. */
  rule: Bilingual;
  filter?: GuideFilter;
  /** A route guide's stops, by campus id (src/shared/campuses.ts). */
  routes?: Readonly<Record<string, readonly GuideStop[]>>;
}

export const GUIDES: readonly Guide[] = [
  {
    slug: 'full-for-a-tenner',
    issue: 1,
    line: 'noodle',
    published: '2026-10-14',
    tag: { zh: '开学季特辑', en: 'Back to uni' },
    title: { zh: '伦敦 £10 吃饱指南', en: 'Full for a tenner' },
    dek: {
      zh: '从学校门口出发，步行 20 分钟以内，每一站告诉你 £10 能吃到什么。价格全部来自菜单原件。',
      en: 'Within a 20-minute walk of campus: at each stop, what £10 gets you. Every price comes from the menu itself.',
    },
    rule: {
      zh: '选店规则：离学校步行约 20 分钟以内、菜单上有 £5 到 £10 的主食或小吃的店，按离学校由近到远排列，不是名次。价格以店内为准。',
      en: 'How the stops were chosen: places within about a 20-minute walk whose menus list a main or a snack for £5 to £10, nearest first, not a ranking. Prices as the menu gives them; check in store.',
    },
    routes: {
    ucl: [
      // China City
      { place: "rec_01m4fc98epc5fkgpz83w426dzk", items: ["rec_01m4fc98epc5fkgpz83w426dzk:siu mai", "rec_01m4fc98epc5fkgpz83w426dzk:special fried rice"] },
      // Murger Han 西安韩记凉皮肉夹馍
      { place: "rec_01m4ecyb1wxfxjfz8y61tt5rph", items: ["rec_01m4f8s75dgb0zr4k0xv3s8zpb:腊汁肉夹馍", "rec_01m4f8s75dgb0zr4k0xv3s8zpb:盐酥鸡"] },
      // Oriental Dragon
      { place: "rec_01m4gggajx86j0dx70f9gz61sn", items: ["rec_01m4gggajx86j0dx70f9gz61sn:chicken satay"] },
      // Sanxia Renjia 三峽人家
      { place: "rec_01m4faw3vzg9hqk879rd61jnym", items: ["rec_01m4faw3vzg9hqk879rd61jnym:椒盐鱿鱼"] },
      // Tofu Vegan Charlotte Street
      { place: "rec_01m4esz8v5q7dvqs07g3s7vq31", items: ["rec_01m4esz8v5q7dvqs07g3s7vq2v:小笼包", "rec_01m4esz8v5q7dvqs07g3s7vq2v:韭菜饺"] },
    ],
    lse: [
      // HUS London
      { place: "rec_01m4gavpwssc5v49jp0skmmzgh", items: ["rec_01m4gavpwssc5v49jp0skmmzgh:四喜 烤麸", "rec_01m4gavpwssc5v49jp0skmmzgh:唇齿间 糖醋小排"] },
      // Xian BiangBiang Noodles Covent Garden 西安小吃
      { place: "rec_01m4g3a66tgjt6c4k2wf82fhnh", items: ["rec_01m4g3a66tgjt6c4k2wf82fhnh:腊汁肉夹馍", "rec_01m4g3a66tgjt6c4k2wf82fhnh:凉皮"] },
      // Happy Lamb Hot Pot Holborn 快乐小羊火锅
      { place: "rec_01m4f2kjt70hvzyrnn6k9wqde5", items: ["rec_01m4f2kjt70hvzyrnn6k9wqde5:葱油饼", "rec_01m4f2kjt70hvzyrnn6k9wqde5:羊肉串"] },
      // Canton Element
      { place: "rec_01m4h29xjfkma140xntbxp58s7", items: ["rec_01m4h29xjfkma140xntbxp58s7:流沙包", "rec_01m4h29xjfkma140xntbxp58s7:皮蛋瘦肉粥"] },
      // HOKO Wonton Noodles
      { place: "rec_01m4g84j5jkmgerw2gvm63g45z", items: ["rec_01m4g84j5jkmgerw2gvm63g45z:炸雲吞", "rec_01m4g84j5jkmgerw2gvm63g45z:辣油雲吞"] },
    ],
    kcl: [
      // Xian BiangBiang Noodles Covent Garden 西安小吃
      { place: "rec_01m4g3a66tgjt6c4k2wf82fhnh", items: ["rec_01m4g3a66tgjt6c4k2wf82fhnh:腊汁肉夹馍", "rec_01m4g3a66tgjt6c4k2wf82fhnh:凉皮"] },
      // HUS London
      { place: "rec_01m4gavpwssc5v49jp0skmmzgh", items: ["rec_01m4gavpwssc5v49jp0skmmzgh:四喜 烤麸", "rec_01m4gavpwssc5v49jp0skmmzgh:唇齿间 糖醋小排"] },
      // HOKO Wonton Noodles
      { place: "rec_01m4g84j5jkmgerw2gvm63g45z", items: ["rec_01m4g84j5jkmgerw2gvm63g45z:炸雲吞", "rec_01m4g84j5jkmgerw2gvm63g45z:辣油雲吞"] },
      // Chi Noodle
      { place: "rec_01m4h4884dq4nz4kxtr5ftkm4x", items: ["rec_01m4h4884dq4nz4kxtr5ftkm4x:prawn har kau", "rec_01m4h4884dq4nz4kxtr5ftkm4x:prawn pork siu mai"] },
      // Happy Lamb Hot Pot Holborn 快乐小羊火锅
      { place: "rec_01m4f2kjt70hvzyrnn6k9wqde5", items: ["rec_01m4f2kjt70hvzyrnn6k9wqde5:葱油饼", "rec_01m4f2kjt70hvzyrnn6k9wqde5:羊肉串"] },
    ],
    soas: [
      // China City
      { place: "rec_01m4fc98epc5fkgpz83w426dzk", items: ["rec_01m4fc98epc5fkgpz83w426dzk:siu mai", "rec_01m4fc98epc5fkgpz83w426dzk:special fried rice"] },
      // Master Wei 西安小吃
      { place: "rec_01m4ectdkwc6e5bm6gvtcw5ywq", items: ["rec_01m4ectdkwc6e5bm6gvtcw5ywq:孜然牛肉夹馍", "rec_01m4ectdkwc6e5bm6gvtcw5ywq:红油云吞"] },
      // DaGe Claypot Noodles & Skewers 大哥
      { place: "rec_01m4h29xjfkma140xntbxp58sb", items: ["rec_01m4h29xjfkma140xntbxp58sb:deep fried pork and prawn wontons", "rec_01m4h29xjfkma140xntbxp58sb:curry fish balls crackling"] },
      // Sanxia Renjia 三峽人家
      { place: "rec_01m4faw3vzg9hqk879rd61jnym", items: ["rec_01m4faw3vzg9hqk879rd61jnym:椒盐鱿鱼"] },
      // Tofu Vegan Charlotte Street
      { place: "rec_01m4esz8v5q7dvqs07g3s7vq31", items: ["rec_01m4esz8v5q7dvqs07g3s7vq2v:小笼包", "rec_01m4esz8v5q7dvqs07g3s7vq2v:韭菜饺"] },
    ],
    imperial: [
      // Tofu Vegan Gloucester Road
      { place: "rec_01m4esz8v5q7dvqs07g3s7vq33", items: ["rec_01m4esz8v5q7dvqs07g3s7vq2v:小笼包", "rec_01m4esz8v5q7dvqs07g3s7vq2v:韭菜饺"] },
      // Xian BiangBiang Noodles Gloucester Road 西安小吃
      { place: "rec_01m4g3a66tgjt6c4k2wf82fhnk", items: ["rec_01m4g3a66tgjt6c4k2wf82fhnk:腊汁肉夹馍", "rec_01m4g3a66tgjt6c4k2wf82fhnk:凉皮"] },
    ],
    qmul: [
      // Kar Woo Stepney
      { place: "rec_01m4gx03nvnvrxap1xmncnkbhy", items: ["rec_01m4gx03nvnvrxap1xmncnkbhy:chicken curry", "rec_01m4gx03nvnvrxap1xmncnkbhy:chicken balls"] },
      // Sing Way
      { place: "rec_01m4gv095rg69fs7zf1ax6ejv3", items: ["rec_01m4gv095rg69fs7zf1ax6ejv3:special fried rice", "rec_01m4gv095rg69fs7zf1ax6ejv3:sweet and sour chicken balls"] },
      // Lotus House
      { place: "rec_01m4etac6pwk33s37t87ef929y", items: ["rec_01m4etac6pwk33s37t87ef929y:chicken chow mein", "rec_01m4etac6pwk33s37t87ef929y:special fried rice"] },
      // Jasmine House
      { place: "rec_01m4he1g361yp6289d2datf2vb", items: ["rec_01m4he1g361yp6289d2datf2vb:chicken curry", "rec_01m4he1g361yp6289d2datf2vb:chicken chow mein"] },
      // Michael's Halal Chinese
      { place: "rec_01m4em1jnp8qbd3j13bg03rh6s", items: ["rec_01m4em1jnp8qbd3j13bg03rh6s:beef chop suey", "rec_01m4em1jnp8qbd3j13bg03rh6s:chicken chow mein"] },
    ],
    ual: [
      // BAO Kings Cross
      { place: "rec_01m4ecz6n2qhbxqz783jzx8s1s", items: ["rec_01m4ecz6n2qhbxqz783jzx8s1s:classic braised pork bao", "rec_01m4ecz6n2qhbxqz783jzx8s1s:taiwanese fried chicken 5pc"] },
      // Xin Kai 鑫锴
      { place: "rec_01m4ecyzba52442x5jrg4bzbh5", items: ["rec_01m4ecyzba52442x5jrg4bzbh5:扬州炒饭"] },
      // Bamboo Inn
      { place: "rec_01m4h20t62tybh20xgjmfzhe9y", items: ["rec_01m4h20t62tybh20xgjmfzhe9y:5 蜜汁叉烧包", "rec_01m4h20t62tybh20xgjmfzhe9y:6 奶黄包"] },
      // New Woks Cooking
      { place: "rec_01m4h9pw3bqk5bmsv6w5v6fq3g", items: ["rec_01m4h9pw3bqk5bmsv6w5v6fq3g:虾饺", "rec_01m4h9pw3bqk5bmsv6w5v6fq3g:招牌炒面"] },
      // Dim Sum Duck
      { place: "rec_01m4ect2a8ww6en88nr281xmgj", items: ["rec_01m4ect2a8ww6en88nr281xmgj:萝卜糕", "rec_01m4ect2a8ww6en88nr281xmgj:鲜虾韭菜饺"] },
    ],
    city: [
      // Magic Wok And Box
      { place: "rec_01m4hd08arnw8jxvhgfxpvdaps", items: ["rec_01m4hd08arnw8jxvhgfxpvdaps:prawn dumplings", "rec_01m4hd08arnw8jxvhgfxpvdaps:chicken chow mein"] },
      // Panda's Kitchen
      { place: "rec_01m4ek74z3bjdwgsbm4z75jfxp", items: ["rec_01m4ek74z3bjdwgsbm4z75jfxp:担担面", "rec_01m4ek74z3bjdwgsbm4z75jfxp:酸辣粉"] },
      // LANTERN
      { place: "rec_01m4ete7dwdef67p0aaddrvhmy", items: ["rec_01m4ete7dwdef67p0aaddrvhmy:红油抄手", "rec_01m4ete7dwdef67p0aaddrvhmy:沙爹鸡串"] },
      // Atush Uyghur Cuisine
      { place: "rec_01m4ectpg0g49w8tbn8dhj2rgm", items: ["rec_01m4ectpg0g49w8tbn8dhj2rgm:atush kabab two lamb skewers 10 minute wait time", "rec_01m4ectpg0g49w8tbn8dhj2rgm:uyghur pilaf with broccoli"] },
      // Lucky Skewers Chinese Restaurant 上上签 烧烤
      { place: "rec_01m4rhk5xx3mryeqg1hgjwhrsb", items: ["rec_01m4rhk5xx3mryeqg1hgjwhrsb:烤生蚝", "rec_01m4rhk5xx3mryeqg1hgjwhrsb:烤茄子"] },
    ],
    westminster: [
      // Loong Express
      { place: "rec_01m4ggg9kg2vqvsvsaxe6f9a81", items: ["rec_01m4ggg9kg2vqvsvsaxe6f9a81:叉烧包", "rec_01m4ggg9kg2vqvsvsaxe6f9a81:榴莲酥"] },
      // Tofu Vegan Charlotte Street
      { place: "rec_01m4esz8v5q7dvqs07g3s7vq31", items: ["rec_01m4esz8v5q7dvqs07g3s7vq2v:小笼包", "rec_01m4esz8v5q7dvqs07g3s7vq2v:韭菜饺"] },
      // BAO
      { place: "rec_01m4gda4fa1td6dhr99ah1hdna", items: ["rec_01m4gda4fa1td6dhr99ah1hdna:braised pork lu rou fan rice"] },
      // Liu Xiaomian Carnaby 刘小面
      { place: "rec_01m4j5t2bghchwj1nt80yermw5", items: ["rec_01m4j5t2bghchwj1nt80yermw5:老麻抄手"] },
      // Sanxia Renjia 三峽人家
      { place: "rec_01m4faw3vzg9hqk879rd61jnym", items: ["rec_01m4faw3vzg9hqk879rd61jnym:椒盐鱿鱼"] },
    ],
    goldsmiths: [
      // Ji The Chicken Shop
      { place: "rec_01m4f28wa1r37kwa48z4re8mzs", items: ["rec_01m4f28wa1r37kwa48z4re8mzs:棒棒雞"] },
      // Good Friends
      { place: "rec_01m4namd4rc42tpmky7ztsze81", items: ["rec_01m4namd4rc42tpmky7ztsze81:special chow mein", "rec_01m4namd4rc42tpmky7ztsze81:special fried rice"] },
      // JinJiang 锦江
      { place: "rec_01m4g313rx6gz2fvbh6zg0jkm3", items: ["rec_01m4g313rx6gz2fvbh6zg0jkm3:沙爹鸡串", "rec_01m4g313rx6gz2fvbh6zg0jkm3:椒盐豆腐"] },
      // Chinese Noodle Bar 面团团
      { place: "rec_01m4gz2d5aadqdgs0kk3z2vpb6", items: ["rec_01m4gz2d5aadqdgs0kk3z2vpb6:油泼面", "rec_01m4gz2d5aadqdgs0kk3z2vpb6:炸酱面"] },
      // Happy Inn New Cross Chinese
      { place: "rec_01m4g3z59pfsj7m1z3hdwh97vz", items: ["rec_01m4g3z59pfsj7m1z3hdwh97vz:ma po tofu", "rec_01m4g3z59pfsj7m1z3hdwh97vz:siu mai"] },
    ],
    },
  },
  {
    slug: 'taste-of-home-north',
    issue: 2,
    line: 'north',
    published: '2026-10-14',
    tag: { zh: '一秒回国', en: 'Taste of home' },
    title: { zh: '北方面食和小吃地图', en: 'Northern noodles and buns' },
    dek: {
      zh: '肉夹馍、凉皮、油泼面、兰州拉面、东北菜和新疆烤串：伦敦的北方味道都在这条线上。',
      en: 'Roujiamo, liang pi, biang biang noodles, Lanzhou lamian, Dongbei dishes and Xinjiang skewers: London’s northern flavours, on one line.',
    },
    rule: {
      zh: '收录规则：菜系为陕西、兰州、新疆、东北、北京、山东或饺子包子的店。',
      en: 'Which places: those whose cuisines include Shaanxi, Lanzhou, Xinjiang, Dongbei, Beijing, Shandong, or dumplings and buns.',
    },
    filter: { cuisines: ['shaanxi', 'lanzhou', 'xinjiang', 'dongbei', 'beijing', 'shandong', 'dumplings'] },
  },
  {
    slug: 'hotpot-night',
    issue: 3,
    line: 'spicy',
    published: '2026-10-14',
    tag: { zh: '组局', en: 'Get a table together' },
    title: { zh: '火锅局：从海底捞到潮汕牛肉', en: 'Hotpot night: Haidilao to Chaoshan beef' },
    dek: {
      zh: '天冷了，约上朋友围一锅。伦敦所有标为火锅的店，读原话看看各家锅底和菜品。',
      en: 'When it turns cold, gather round a pot. Every place in London listed for hotpot; read what people wrote about the broths and the dishes.',
    },
    rule: { zh: '收录规则：菜系包含火锅的店。', en: 'Which places: those whose cuisines include hotpot.' },
    filter: { cuisines: ['hotpot'] },
  },
  {
    slug: 'mid-autumn-grocers',
    issue: 4,
    line: 'grocery',
    published: '2026-10-14',
    tag: { zh: '中秋', en: 'Mid-Autumn' },
    title: { zh: '月饼去哪买：中超清单', en: 'Where to buy mooncakes: the grocers' },
    dek: {
      zh: '月饼、调料、冻饺子和家乡零食：伦敦的华人超市和食材店都在这里，找离你最近的一家。',
      en: 'Mooncakes, sauces, frozen dumplings and snacks from home: London’s Chinese supermarkets and grocers, so you can find the nearest.',
    },
    rule: { zh: '收录规则：类别为华人超市，或卖中国食材的店。', en: 'Which places: Chinese supermarkets, and places listed for Chinese groceries.' },
    filter: { categories: ['grocery'], cuisines: ['groceries'] },
  },
  {
    slug: 'bubble-tea-run',
    issue: 5,
    line: 'boba',
    published: '2026-10-14',
    tag: { zh: '奶茶续命', en: 'Afternoon fix' },
    title: { zh: '奶茶续命地图', en: 'Bubble tea run' },
    dek: {
      zh: '下课路上、考试周深夜，总要一杯。伦敦的奶茶店和茶饮店，按离你多远找。',
      en: 'On the way home from class, or late in exam week: London’s bubble tea and tea shops, by how far they are from you.',
    },
    rule: { zh: '收录规则：类别为奶茶茶饮，或菜系包含奶茶的店。', en: 'Which places: bubble tea and drinks shops, and places listed for bubble tea.' },
    filter: { categories: ['tea-drinks'], cuisines: ['bubble-tea'] },
  },
  {
    slug: 'chinatown-by-dish',
    issue: 6,
    line: 'dimsum',
    published: '2026-10-14',
    tag: { zh: '第一次来', en: 'First time in London' },
    title: { zh: '唐人街按菜找店', en: 'Chinatown, dish by dish' },
    dek: {
      zh: '唐人街一百多家店挤在几条街上。先想好吃什么，再看哪几家有：烧腊、点心、小笼包、麻辣烫。',
      en: 'Over a hundred places on a few streets. Decide what you want first, then see who serves it: roast meats, dim sum, xiaolongbao, malatang.',
    },
    rule: { zh: '收录规则：邮编在 W1D 和 WC2H（唐人街和苏豪一带）的店。', en: 'Which places: those in the W1D and WC2H postcode districts (Chinatown and Soho).' },
    filter: { outcodes: ['W1D', 'WC2H'] },
  },
  {
    slug: 'canary-wharf-lunch',
    issue: 7,
    line: 'modern',
    published: '2026-10-14',
    tag: { zh: '打工人', en: 'Office lunch' },
    title: { zh: '金丝雀码头打工人午餐', en: 'Desk lunch in Canary Wharf' },
    dek: {
      zh: '午休一小时，走得到的中餐都在这里：离金丝雀码头站一公里以内。',
      en: 'An hour for lunch: the Chinese food you can walk to, within a kilometre of Canary Wharf station.',
    },
    rule: { zh: '收录规则：离金丝雀码头站直线一公里以内的店。', en: 'Which places: those within a straight-line kilometre of Canary Wharf station.' },
    filter: { near: { lat: 51.5062, lng: -0.01883, km: 1 } },
  },
];

export const guideBySlug = (slug: string): Guide | undefined => GUIDES.find((guide) => guide.slug === slug);

/** Whether a place belongs in a filter guide. Closed places never do. */
export function inGuide(filter: GuideFilter, entry: { c: string; k: readonly string[]; o: string | null; la: number | null; lo: number | null; t: string }): boolean {
  if (entry.t === 'closed') return false;
  const kinds = [...(filter.categories ?? []), ...(filter.cuisines ?? [])];
  if (kinds.length > 0 && !(filter.categories ?? []).includes(entry.c) && !entry.k.some((cuisine) => (filter.cuisines ?? []).includes(cuisine))) return false;
  if (filter.outcodes && !(entry.o !== null && filter.outcodes.includes(entry.o))) return false;
  if (filter.near) {
    if (entry.la === null || entry.lo === null) return false;
    if (distanceKm(filter.near, { lat: entry.la, lng: entry.lo }) > filter.near.km) return false;
  }
  return true;
}
