/**
 * The site's words in both its languages. One `Copy` interface, implemented once per locale, so a
 * string missing in either is a type error (the pattern tarot settled on). The app reads it through
 * src/app/i18n.tsx; the Worker reads it for page titles and descriptions (src/worker/seo.ts).
 *
 * Nothing here may praise, rank or score a place: tests/i18n.test.ts runs the rating guard over
 * every string.
 */

export type Locale = 'zh' | 'en';
export const LOCALES: readonly Locale[] = ['zh', 'en'];

/** A locale from a URL segment, cookie or header value; null when it is neither. */
export function localeFrom(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return null;
}

/** The locale an Accept-Language header prefers among ours, Chinese when it names neither. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? '').split(',')) {
    const locale = localeFrom(part.split(';')[0]!.trim());
    if (locale) return locale;
  }
  return 'zh';
}

export interface Copy {
  htmlLang: string;
  siteName: string;
  siteShort: string;
  tagline: string;
  description: string;
  switchTo: string;
  nav: { home: string; contribute: string; about: string; menu: string; map: string; dishes: string; guides: string; lightUp: string };
  /** The wordmark: the name, and the small line under it. */
  brand: { name: string; sub: string; motto: string };
  /** The front page. */
  front: {
    kicker: { open: string; quotes: string; dishes: string };
    /** The headline around a dish name that changes: "今天在伦敦 / 吃 [小笼包] 吗？". */
    hero: { before: string; eat: string; after: string; words: string[] };
    search: string;
    go: string;
    chips: { near: (campus: string) => string; tenner: string; home: string; boba: string; hotpot: string };
  };
  /** The arrivals board: checks of public records as they happen. */
  live: {
    title: string;
    /** The board's title when it shows pages that changed instead of checks. */
    recentTitle: string;
    only: string;
    empty: string;
    /** The foot: today's checks, never a zero (with no agent counted, it leaves them out). */
    today: (checked: number, agents: number) => string;
    quiet: (ago: string) => string;
    updatedToday: (count: number) => string;
    lastUpdate: (ago: string) => string;
    open: (count: number) => string;
    /** How long ago, in a sentence: 12 分钟前, 9 hours ago. */
    ago: (minutes: number) => string;
    seeAll: string;
    types: Record<'place' | 'menu' | 'quote' | 'art' | 'photo' | 'update', string>;
    /** What a line says was checked; `count` is how many checks of one place the line stands for. */
    what: {
      place: string;
      menu: (items: number, count: number) => string;
      quote: (publication: string, count: number) => string;
      art: string;
      photo: (count: number) => string;
      firstPhoto: string;
      update: string;
    };
    now: string;
    minutes: (count: number) => string;
    hours: (count: number) => string;
    days: (count: number) => string;
  };
  lines: {
    title: string;
    tag: string;
    lead: string;
    hub: string;
    hubCount: (count: number) => string;
    count: (count: number) => string;
    browse: string;
    pageLead: (count: number) => string;
    cuisines: string;
    others: string;
  };
  dayDish: {
    title: string;
    kicker: string;
    lead: (count: number, min: string, max: string, half: string) => string;
    half: (price: string) => string;
    plotCaption: (listed: number) => string;
    seeAll: (count: number) => string;
  };
  near: {
    title: string;
    tag: string;
    within: string;
    mix: (restaurants: number, tea: number, other: number) => string;
    pageTitle: (campus: string) => string;
    pageLead: (count: number) => string;
    walk: (minutes: number) => string;
    station: (name: string, minutes: number) => string;
    all: string;
    guide: string;
    others: string;
  };
  quotes: { title: string; tag: string; translated: string; foot: (count: number) => string };
  guides: {
    title: string;
    lead: string;
    all: (count: number) => string;
    issue: (issue: number) => string;
    places: (count: number) => string;
    /** How many campuses a route guide starts from. */
    campuses: (count: number) => string;
    /** The word under a route's count of stops. */
    stopsUnit: (count: number) => string;
    route: (stops: string) => string;
    walkTo: (minutes: number) => string;
    lastStop: string;
    cheapest: string;
    share: string;
    another: string;
    missing: string;
    pick: string;
    empty: string;
  };
  lightUp: {
    kicker: string;
    title: (total: number, lit: number) => string;
    text: string;
    progress: (lit: number, total: number) => string;
    upload: string;
    how: string;
    howText: string[];
    fine: string;
    nearest: string;
    locate: string;
    noneNear: string;
  };
  crew: {
    title: string;
    tag: string;
    lead: string;
    roles: { collector: string; maintainer: string };
    count: (role: 'collector' | 'maintainer', count: number) => string;
    join: string;
    joinSub: string;
  };
  dishes: { title: string; lead: string; search: string; listed: (count: number) => string; servedAt: (count: number) => string };
  share: { image: string; making: string; failed: string; link: string; copied: string };
  home: {
    searchPlaceholder: string;
    searchLabel: string;
    near: string;
    nearDenied: string;
    list: string;
    grid: string;
    map: string;
    layout: string;
    sortLabel: string;
    sorts: { distance: string; recent: string; name: string };
    filters: string;
    category: string;
    cuisine: string;
    borough: string;
    openOnly: string;
    withMenu: string;
    withPhotos: string;
    clear: string;
    showAll: (count: number) => string;
    showFewer: string;
    showResults: (count: number) => string;
    count: (shown: number, total: number) => string;
    more: (count: number) => string;
    empty: string;
    dishesMatching: string;
    placesMatching: string;
    loading: string;
    servedAt: (count: number) => string;
    suggest: string;
    byLine: string;
    byCampus: string;
  };
  map: {
    locate: string;
    you: string;
    /** MapLibre's own words: its zoom buttons, its credits, and what it says when a scroll or a finger only moves the page. */
    zoomIn: string;
    zoomOut: string;
    credits: string;
    close: string;
    ctrlScroll: string;
    cmdScroll: string;
    twoFingers: string;
  };
  place: {
    menu: string;
    reviews: string;
    photos: string;
    history: string;
    noMenu: string;
    noMenuHelp: string;
    addMenu: string;
    menuChanged: string;
    ownMenu: (kind: 'pdf' | 'image' | 'page') => string;
    noReviews: string;
    noPhotos: string;
    brandMenu: (brand: string) => string;
    deliveryPrices: string;
    priceSeen: (date: string) => string;
    source: string;
    readOriginal: string;
    archived: string;
    translation: string;
    machineTranslation: string;
    mentions: (count: number) => string;
    mentionedNotOnMenu: string;
    waiting: (count: number) => string;
    trading: Record<'open' | 'temporarily-closed' | 'closed', string>;
    staleNotice: string;
    website: string;
    phone: string;
    address: string;
    mapApps: { google: string; apple: string; osm: string };
    opened: string;
    closedOn: string;
    reviewsNotice: string;
    sourceOf: string;
    addPhoto: string;
    report: string;
    reviewSources: string;
    byYear: (year: string) => string;
    excerptBy: (who: string) => string;
    sources: (count: number) => string;
    sourcesSpan: (quotes: number, from: string, to: string) => string;
    inQuotes: string;
    inQuotesNote: string;
    times: (count: number) => string;
    walk: (place: string, minutes: number) => string;
    prices: (low: string, high: string) => string;
    pricesSeen: (date: string) => string;
    record: string;
    recordTag: string;
    sameStop: string;
    directions: string;
    share: string;
    firstPhoto: string;
    slot: string;
    slotSub: string;
    quotesTitle: string;
    more: (count: number) => string;
  };
  dish: {
    title: (name: string) => string;
    lead: (count: number) => string;
    onMenu: string;
    inReviews: string;
    none: string;
    prices: (count: number, min: string, max: string, half: string) => string;
    spread: (times: string, low: string, lowArea: string, high: string, highArea: string) => string;
    portions: string;
    plotCaption: string;
    listed: (count: number) => string;
    sorts: { cheapest: string; nearest: string; area: string };
    columns: { price: string; place: string; area: string; kind: string; from: string };
    more: (count: number) => string;
    staff: { label: string; point: string };
    wrote: string;
    related: string;
    noPhotos: (count: number) => string;
    noPhotosText: string;
    snap: string;
    mapCaption: (count: number) => string;
  };
  source: { title: (name: string) => string; lead: (count: number) => string; criticTitle: (name: string) => string };
  ai: { badge: string; alt: (dish: string) => string; toggle: string; explain: string };
  upload: {
    title: string;
    subject: string;
    dishName: string;
    caption: string;
    attribution: string;
    file: string;
    license: string;
    send: string;
    sending: string;
    sent: string;
    rules: string;
    failed: string;
  };
  menuSheet: {
    title: string;
    lead: string;
    how: string;
    byLink: string;
    byPhotos: string;
    link: string;
    linkHelp: string;
    pages: string;
    pagesHelp: string;
    pagesChosen: (count: number) => string;
    tooManyPages: string;
    license: string;
    send: string;
    sent: string;
  };
  report: { title: string; wrong: string; takedown: string; reason: string; send: string; sent: string };
  contribute: {
    title: string;
    lead: string;
    placeTitle: string;
    placeText: string;
    placeButton: string;
    agentTitle: string;
    agentText: string;
    copy: string;
    copied: string;
    skill: string;
    photosTitle: string;
    photosText: string;
  };
  suggest: {
    title: string;
    lead: string;
    name: string;
    nameHelp: string;
    where: string;
    whereHelp: string;
    link: string;
    linkHelp: string;
    note: string;
    notePlaceholder: string;
    maybeListed: string;
    listed: string;
    send: string;
    sent: string;
    errors: Record<'outside_london' | 'unknown_postcode' | 'rate_limited', string>;
  };
  about: { title: string; paragraphs: string[]; dataTitle: string; dataText: string; downloads: { csv: string; json: string; menus: string } };
  privacy: { title: string; paragraphs: string[] };
  /** The analytics question (src/app/analytics.ts): the bar that asks it, and the privacy page's switch. */
  consent: { question: string; more: string; accept: string; decline: string; title: string; on: string; off: string; turnOn: string; turnOff: string };
  notFound: { title: string; text: string; home: string };
  attribution: string;
  theme: { light: string; dark: string };
  /** The words that close a sheet. */
  close: string;
}

const zh: Copy = {
  htmlLang: 'zh-Hans',
  siteName: '伦敦干饭地图 · London Chinese Food',
  siteShort: '伦敦干饭地图',
  tagline: '伦敦哪里吃得到中国菜',
  description: '伦敦能吃到、买到中国食物的店：菜单、照片和来自全网的评价原文。没有评分，读历史自己判断。',
  switchTo: 'English',
  nav: { home: '首页', contribute: '参与贡献', about: '关于', menu: '菜单', map: '地图', dishes: '菜品', guides: '攻略', lightUp: '点亮伦敦' },
  brand: { name: '伦敦干饭地图', sub: 'LONDON CHINESE FOOD MAP', motto: '没有评分，只摘原话。' },
  front: {
    kicker: { open: '家在营业', quotes: '段原话', dishes: '道菜单菜品' },
    hero: { before: '今天在伦敦', eat: '吃', after: '吗？', words: ['小笼包', '肉夹馍', '杨枝甘露', '烧鸭饭', '麻辣烫'] },
    search: '搜店名、菜名、邮编，或者你的学校',
    go: '搜',
    chips: { near: (campus) => `${campus} 周边`, tenner: '£10 吃饱', home: '一秒回国', boba: '奶茶续命', hotpot: '火锅局' },
  },
  live: {
    title: '实时到站',
    recentTitle: '最近上新',
    only: 'ONLY VERIFIED',
    empty: '这会儿还没有新的核实。',
    today: (checked, agents) => (agents ? `今天已核实 ${checked} 条 · ${agents} 位采集员在岗` : `今天已核实 ${checked} 条`),
    quiet: (ago) => `今天还没有新的核实 · 最近一次在 ${ago}`,
    updatedToday: (count) => `今天 ${count.toLocaleString('en-US')} 家店有更新`,
    lastUpdate: (ago) => `最近一次更新在 ${ago}`,
    open: (count) => `共 ${count.toLocaleString('en-US')} 家在营业`,
    ago: (minutes) => (minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`),
    seeAll: '看全部',
    types: { place: '新店', menu: '菜单', quote: '原话', art: '示意图', photo: '实拍', update: '更新' },
    what: {
      place: '收录',
      menu: (items, count) =>
        count > 1 ? (items ? `${count} 份菜单 · ${items} 道菜价已核对` : `${count} 份菜单已核对`) : items ? `${items} 道菜价已核对` : '菜单已核对',
      quote: (publication, count) => (count > 1 ? `${count} 段新摘录` : `${publication} 新摘录`),
      art: '有了 AI 示意图',
      photo: (count) => (count > 1 ? `${count} 张实拍通过审核` : '新实拍通过审核'),
      firstPhoto: '第一张实拍通过审核',
      update: '页面有更新',
    },
    now: 'now',
    minutes: (count) => `${count} min`,
    hours: (count) => `${count} hr`,
    days: (count) => `${count} d`,
  },
  lines: {
    title: '干饭线路图',
    tag: '8 LINES · 1 INTERCHANGE',
    lead: '8 条线，1 个换乘站。每条线是一组菜系，点一条线，看这条线上所有的店。',
    hub: '唐人街',
    hubCount: (count) => `换乘 · ${count} 家`,
    count: (count) => `${count} 家`,
    browse: '按线路逛',
    pageLead: (count) => `这条线上有 ${count} 家在营业的店。`,
    cuisines: '这条线上的菜系',
    others: '其他线路',
  },
  dayDish: {
    title: '今日一道菜',
    kicker: 'DISH OF THE DAY',
    lead: (count, min, max, half) => `全伦敦 ${count} 家店的菜单上有它。最便宜 ${min}，最贵 ${max}，一半的店不超过 ${half}。`,
    half: (price) => `一半的店 ≤ ${price}`,
    plotCaption: (listed) => `每个点是一家店的菜单价 · ${listed} 家标了价格`,
    seeAll: (count) => `看全部 ${count} 家`,
  },
  near: {
    title: '学校周边',
    tag: '1 KM · 步行约 15 分钟',
    within: '1 公里内',
    mix: (restaurants, tea, other) => [`餐厅 ${restaurants}`, tea ? `奶茶 ${tea}` : '', other ? `其他 ${other}` : ''].filter(Boolean).join(' · '),
    pageTitle: (campus) => `${campus} 周边的中餐`,
    pageLead: (count) => `离学校直线 1 公里以内（步行约 15 分钟）的 ${count} 家店，按距离排列。`,
    walk: (minutes) => `步行约 ${minutes} 分钟`,
    station: (name, minutes) => `${name} 站 ${minutes} 分钟`,
    all: '全部',
    guide: '这所学校的 £10 吃饱指南',
    others: '其他学校',
  },
  quotes: { title: '大家怎么说', tag: '只摘原话 · 没有评分', translated: '译', foot: (count) => `${count} 段原话 · 中英文媒体和博主` },
  guides: {
    title: '攻略专题',
    lead: '按学校、预算和场景整理的专题。只有顺序，没有名次。',
    all: (count) => `全部 ${count} 期`,
    issue: (issue) => `第 ${String(issue).padStart(2, '0')} 期`,
    places: (count) => `${count} 家`,
    campuses: (count) => `从 ${count} 所学校出发`,
    stopsUnit: () => '站',
    route: (stops) => `路线：${stops}`,
    walkTo: (minutes) => `步行约 ${minutes} 分钟`,
    lastStop: '分钟走到最后一站',
    cheapest: '最便宜的一口',
    share: '生成长图',
    another: '换个学校',
    missing: '这所学校还没有这一期。',
    pick: '选学校',
    empty: '没有符合这期专题的店。',
  },
  lightUp: {
    kicker: 'LIGHT UP LONDON · 第 1 季',
    title: (total, lit) => `${total.toLocaleString('en-GB')} 家店\n只有 ${lit} 家有实拍`,
    text: '吃完顺手拍一张。审核通过后，这家店在地图上会亮起来，你拍的就是它的「首拍」。',
    progress: (lit, total) => `LIT ${lit} / ${total.toLocaleString('en-GB')}`,
    upload: '上传第一张实拍',
    how: '怎么拍',
    howText: ['拍菜、拍菜单或者拍门面都行，一次一张。', '照片按 CC BY 4.0 公开，可以写上你想署的名字。', '照片会重新编码，去掉拍摄地点等信息；审核通过前任何人都看不到。'],
    fine: '照片会重新编码，去掉拍摄地点等信息；审核通过前任何人都看不到。',
    nearest: '离你最近、还没有实拍的店',
    locate: '找我附近的',
    noneNear: '附近的店都已经有实拍了。',
  },
  crew: {
    title: '今天在岗的采集员',
    tag: 'THE CREW',
    lead: '每一条都带着出处原文，由另一位核实员对照来源后才公开。',
    roles: { collector: '采集', maintainer: '核实' },
    count: (role, count) => (role === 'collector' ? `通过 ${count} 条` : `本周核实 ${count} 条`),
    join: '让你的 AI 也来值班',
    joinSub: '一句话接入 · SKILL.md',
  },
  dishes: {
    title: '菜品',
    lead: '按菜找店：选一道菜，看伦敦哪些店有、菜单上多少钱。',
    search: '搜菜名，例如 小笼包、Char siu',
    listed: (count) => `${count} 道标准菜`,
    servedAt: (count) => `${count} 家`,
  },
  share: { image: '生成长图', making: '正在生成', failed: '生成失败，请再试一次。', link: '复制链接', copied: '链接已复制' },
  home: {
    searchPlaceholder: '搜店名、菜名或邮区，例如 小笼包、W1D',
    searchLabel: '搜索',
    near: '附近',
    nearDenied: '无法获取你的位置',
    list: '列表',
    grid: '网格',
    map: '地图',
    layout: '显示方式',
    sortLabel: '排序',
    sorts: { distance: '距离', recent: '最新评价', name: '名称' },
    filters: '筛选',
    category: '类别',
    cuisine: '菜系',
    borough: '行政区',
    openOnly: '只看营业中',
    withMenu: '有菜单',
    withPhotos: '有照片',
    clear: '清除',
    showAll: (count) => `显示全部 ${count} 个`,
    showFewer: '收起',
    showResults: (count) => `显示 ${count} 家店`,
    count: (shown, total) => (shown === total ? `${total.toLocaleString('en-US')} 家店` : `${shown.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} 家店`),
    more: (count) => `再显示 ${count} 家`,
    empty: '没有符合条件的店。',
    dishesMatching: '菜品',
    placesMatching: '店铺',
    loading: '加载中',
    servedAt: (count) => `${count} 家店有`,
    suggest: '没找到想找的店？推荐给我们',
    byLine: '线路',
    byCampus: '学校',
  },
  map: {
    locate: '显示我的位置',
    you: '你的位置',
    zoomIn: '放大',
    zoomOut: '缩小',
    credits: '地图来源',
    close: '关闭',
    ctrlScroll: '按住 Ctrl 再滚动，缩放地图',
    cmdScroll: '按住 ⌘ 再滚动，缩放地图',
    twoFingers: '用两根手指移动地图',
  },
  place: {
    menu: '菜单',
    reviews: '评价',
    photos: '照片',
    history: '记录',
    noMenu: '还没有菜单。',
    noMenuHelp: '知道菜单在网上哪里，或者手边有纸质菜单？帮忙添加，agent 会把它录成可搜索的菜单，审核后显示。',
    addMenu: '添加菜单',
    menuChanged: '菜单变了？提交新的',
    ownMenu: (kind) => (kind === 'pdf' ? '店家官网菜单（PDF）' : kind === 'image' ? '店家官网菜单（图片）' : '店家官网菜单'),
    noReviews: '还没有评价摘录。',
    noPhotos: '还没有照片。',
    brandMenu: (brand) => `${brand}各分店共用的菜单`,
    deliveryPrices: '来自外卖平台：外卖价通常比店内高。',
    priceSeen: (date) => `价格见于 ${date}`,
    source: '来源',
    readOriginal: '读原文',
    archived: '存档',
    translation: '翻译',
    machineTranslation: '机器翻译',
    mentions: (count) => `${count} 条评价提到`,
    mentionedNotOnMenu: '评价中提到、菜单上没有的',
    waiting: (count) => `${count} 条待审核`,
    trading: { open: '营业中', 'temporarily-closed': '暂停营业', closed: '已关闭' },
    staleNotice: '这条信息上次核对时已不再成立，可能已过时。',
    website: '网站',
    phone: '电话',
    address: '地址',
    mapApps: { google: 'Google 地图', apple: 'Apple 地图', osm: 'OpenStreetMap' },
    opened: '开业',
    closedOn: '关闭',
    reviewsNotice: '这里只摘录评价原文、不收评分。按时间读下去，自己判断。',
    sourceOf: '信息来源',
    addPhoto: '上传照片',
    report: '报告问题',
    reviewSources: '看这个来源的全部摘录',
    byYear: (year) => `${year} 年`,
    excerptBy: (who) => `摘自 ${who}`,
    sources: (count) => `${count} 个来源写过它`,
    sourcesSpan: (quotes, from, to) => (from === to ? `${quotes} 段原话 · ${from} 年` : `${quotes} 段原话 · 从 ${from} 年写到 ${to} 年`),
    inQuotes: '原话里出现的菜',
    inQuotesNote: '只数被提到几次，不代表好不好吃。',
    times: (count) => `×${count}`,
    walk: (place, minutes) => `${place} ${minutes} 分钟`,
    prices: (low, high) => `菜单价 ${low} 至 ${high}`,
    pricesSeen: (date) => `${date} 的菜单`,
    record: '这家店的档案',
    recordTag: '谁收录 · 谁核对',
    sameStop: '同一站下车',
    directions: '怎么去',
    share: '分享',
    firstPhoto: '拍首拍',
    slot: '首拍空位',
    slotSub: '等你来拍',
    quotesTitle: '原话',
    more: (count) => `再看 ${count} 段`,
  },
  dish: {
    title: (name) => `伦敦哪里吃得到${name}`,
    lead: (count) => `${count} 家店的菜单或评价里有这道菜。`,
    onMenu: '菜单上有',
    inReviews: '评价中提到',
    none: '还没有店铺有这道菜。',
    prices: (count, min, max, half) => `全伦敦 ${count} 家店的菜单上有它。标了价格的店里，最便宜 ${min}，最贵 ${max}，一半不超过 ${half}。`,
    spread: (times, low, lowArea, high, highArea) => `同一道菜，${lowArea} ${low}，${highArea} ${high}：差 ${times} 倍`,
    portions: '份量不一样，以菜单为准',
    plotCaption: '每个点 = 一家店的菜单价',
    listed: (count) => `${count} 家标了价格`,
    sorts: { cheapest: '最便宜', nearest: '离我近', area: '按区域' },
    columns: { price: '价格', place: '店', area: '区域', kind: '类型', from: '来自' },
    more: (count) => `再看 ${count} 家`,
    staff: { label: '给店员看', point: '点菜时指给店员看。' },
    wrote: '写过它的人',
    related: '同一菜系的菜',
    noPhotos: (count) => `${count} 家，0 张实拍`,
    noPhotosText: '你吃的那一份，可以是第一张。',
    snap: '拍',
    mapCaption: (count) => `${count} 家 · 绿点是有这道菜的店`,
  },
  source: {
    title: (name) => `${name} 的评价摘录`,
    lead: (count) => `${count} 条摘录。读一个来源写过的全部，判断它可不可信。`,
    criticTitle: (name) => `${name} 写过的评价`,
  },
  ai: {
    badge: 'AI 示意图',
    alt: (dish) => `${dish}的 AI 示意图，不是这家店的实拍`,
    toggle: '显示 AI 示意图',
    explain: '没有实拍的菜，用 AI 生成的示意图代替，只表示这道菜通常的样子。有实拍后自动换成实拍。',
  },
  upload: {
    title: '上传照片',
    subject: '拍的是',
    dishName: '菜名',
    caption: '说明（选填）',
    attribution: '署名（选填）',
    file: '照片',
    license: '这是我拍的照片，我同意以 CC BY 4.0 许可发布。',
    send: '上传',
    sending: '上传中',
    sent: '谢谢！审核通过后就会出现在这里。',
    rules: '只传你自己拍的照片。请避开人脸。照片的位置信息会被删除。',
    failed: '上传失败',
  },
  menuSheet: {
    title: '添加菜单',
    lead: '菜单不会直接公开：agent 会照着它录成菜单，审核通过后才显示。',
    how: '菜单在哪里',
    byLink: '网上（网址）',
    byPhotos: '纸质（拍照）',
    link: '菜单网址',
    linkHelp: '餐厅官网上的菜单页面、PDF 或图片最好。外卖平台的价格常常比店里高。',
    pages: '菜单照片',
    pagesHelp: '每页拍一张，按页码顺序选好，最多 10 张。拍清楚菜名和价格，避开人脸。',
    pagesChosen: (count) => `已选 ${count} 页`,
    tooManyPages: '一次最多 10 页。',
    license: '这些照片是我拍的，我同意以 CC BY 4.0 许可发布。',
    send: '提交',
    sent: '收到了！录好并审核通过后，菜单就会出现在这里。',
  },
  report: { title: '报告问题', wrong: '信息有误', takedown: '我是作者或权利人，请下架', reason: '说明', send: '发送', sent: '收到了，我们会尽快处理。' },
  contribute: {
    title: '参与贡献',
    lead: '这里的数据由 AI agent 收集、由另一些 agent 逐条核对。你可以推荐还没收录的店、上传你拍的照片，也可以让自己的 agent 来帮忙。',
    placeTitle: '推荐一家还没收录的店',
    placeText: '知道一家能吃到或买到中国食物、这里却还没有的店？告诉我们店名和在哪里就行。agent 会去网上找到它、核实它卖中国食物，审核通过后就会出现在网站上。',
    placeButton: '推荐一家店',
    agentTitle: '让你的 AI agent 参与',
    agentText: '把下面这句话发给你的 agent：',
    copy: '复制',
    copied: '已复制',
    skill: '阅读 SKILL.md',
    photosTitle: '上传照片',
    photosText: '在任意店铺页面点“上传照片”。照片经审核后公开，以 CC BY 4.0 许可署你的名字。菜单也一样：在店铺的菜单栏点“添加菜单”，贴上菜单网址，或者拍下每一页。',
  },
  suggest: {
    title: '推荐一家店',
    lead: '你填的内容不会直接公开：agent 会照着它去网上找到这家店，核对通过后才显示。',
    name: '店名',
    nameHelp: '中文名或英文名都可以。',
    where: '地址或邮编',
    whereHelp: '例如 28 Gerrard Street, W1D 6JW。只收大伦敦地区的店。',
    link: '相关链接（选填）',
    linkHelp: '店家官网或社交媒体、Google 地图、外卖平台或一篇评价都行，最好能看出它卖什么。',
    note: '补充说明（选填）',
    notePlaceholder: '例如 主要卖什么、什么时候开的',
    maybeListed: '这些店已经收录了，是其中一家吗？',
    listed: '这家店已经收录了：',
    send: '提交',
    sent: '收到了，谢谢！agent 核实后，这家店就会出现在网站上。',
    errors: {
      outside_london: '这个邮编不在大伦敦地区，这里只收伦敦的店。',
      unknown_postcode: '找不到这个邮编。请检查一下，或者去掉邮编，只写街道和区域。',
      rate_limited: '你刚刚提交了好几次，请过一会儿再试。',
    },
  },
  about: {
    title: '关于',
    paragraphs: [
      '伦敦中餐收录伦敦所有能吃到、买到中国食物的店（餐厅、外卖、烘焙甜品、奶茶、华人超市），并收集它们的菜单、照片和来自全网的评价原文。',
      '这里没有评分。我们只摘录评价原文，附上原文链接，不收任何星级或分数。一家店好不好，读它的历史自己判断；一个评论来源靠不靠谱，也可以读它写过的全部。',
      '数据由公开的 AI agent 收集，每一条在公开前都由另一个 agent 对照来源核对；所有修改都有记录。',
      '评价摘录版权归原作者，我们只作引用并链回原文。如果你是作者或权利人，想让我们删除某条内容，请点该条的“报告问题”，或写信到 hi@manyfold.ai。',
      '没有实拍照片的菜会显示 AI 示意图，并始终标注。',
    ],
    dataTitle: '下载数据',
    dataText: '店铺和菜单以 CC BY 4.0 许可开放，注明出自伦敦中餐即可使用。评价摘录版权归原作者，不在下载之列。',
    downloads: { csv: '店铺（CSV）', json: '店铺（JSON）', menus: '菜单（JSON Lines，gzip 压缩）' },
  },
  privacy: {
    title: '隐私',
    paragraphs: [
      '你选的语言、主题、筛选条件和对访问统计的回答只保存在你的浏览器里。用“附近”时，你的位置只在你的浏览器里用来按距离排序、在地图上标出你在哪，不会发送给我们。',
      '我们用 Google Analytics 统计有多少人来、看了哪些页面、从哪里来，用来改进网站。在英国、欧洲经济区和瑞士，只有你选了“接受”它才会加载；在其他地方它直接加载，你可以在下面关掉。它会在这个网站下存两个以 lcf_ga 开头的 cookie；Google 会收到你的浏览器信息，并用你的 IP 地址估计你所在的城市。这里没有广告：Google 的广告功能是关着的，这些数据也不用于广告。',
      '上传照片时，我们会删除照片里的全部元数据（包括位置），只保存重新编码后的图片。为了防止滥用，我们按 IP 地址的哈希计算你上传和提交的次数（照片、菜单、推荐的店），不保存 IP 本身。这些表单使用 Cloudflare Turnstile 验证你是人。',
      '地图由 OpenFreeMap 提供，查看地图时你的浏览器会向它请求地图图块。',
      '想删除你上传的照片或其他内容，请写信到 hi@manyfold.ai。',
    ],
  },
  consent: {
    question: '我们想用 Google Analytics 统计访问量，用来改进网站，可以吗？',
    more: '隐私说明',
    accept: '接受',
    decline: '不接受',
    title: '访问统计',
    on: '已开启：Google Analytics 会统计你的访问。',
    off: '已关闭：你的访问不会发给 Google Analytics。',
    turnOn: '开启统计',
    turnOff: '关闭统计',
  },
  notFound: { title: '找不到这个页面', text: '这个地址没有内容，或这家店已不再收录。', home: '回到首页' },
  attribution: '数据：店铺与菜单 CC BY 4.0；评价摘录版权归原作者；邮编数据 © ONS / Royal Mail，OGL；车站数据 Powered by TfL Open Data，含 OS 数据 © Crown copyright and database rights。',
  theme: { light: '浅色', dark: '深色' },
  close: '关闭',
};

const en: Copy = {
  htmlLang: 'en-GB',
  siteName: 'London Chinese Food · 伦敦中餐',
  siteShort: 'London Chinese Food',
  tagline: 'Where to find Chinese food in London',
  description: 'Every place in London to eat or buy Chinese food: menus, photos and review excerpts from across the web. No ratings: read the history and judge for yourself.',
  switchTo: '中文',
  nav: { home: 'Home', contribute: 'Contribute', about: 'About', menu: 'Menu', map: 'Map', dishes: 'Dishes', guides: 'Guides', lightUp: 'Light up London' },
  brand: { name: 'London Chinese Food', sub: 'THE EATING MAP · 伦敦干饭地图', motto: 'No scores, just quotes.' },
  front: {
    kicker: { open: 'open now', quotes: 'quotes', dishes: 'menu items' },
    hero: { before: 'Fancy some', eat: '', after: 'tonight?', words: ['xiaolongbao', 'roujiamo', 'mango sago', 'roast duck', 'malatang'] },
    search: 'A place, a dish, a postcode or your uni',
    go: 'Go',
    chips: { near: (campus) => `Near ${campus}`, tenner: 'Full for a tenner', home: 'Taste of home', boba: 'Bubble tea run', hotpot: 'Hotpot night' },
  },
  live: {
    title: 'Live arrivals',
    recentTitle: 'Just updated',
    only: 'ONLY VERIFIED',
    empty: 'Nothing newly checked just now.',
    today: (checked, agents) => (agents ? `${checked} checked today · ${agents} ${agents === 1 ? 'agent' : 'agents'} on shift` : `${checked} checked today`),
    quiet: (ago) => `Nothing checked yet today · last check ${ago}`,
    updatedToday: (count) => `${count.toLocaleString('en-US')} ${count === 1 ? 'place' : 'places'} updated today`,
    lastUpdate: (ago) => `Last update ${ago}`,
    open: (count) => `${count.toLocaleString('en-US')} open in all`,
    ago: (minutes) => {
      if (minutes < 1) return 'just now';
      if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
      const hours = Math.round(minutes / 60);
      if (minutes < 48 * 60) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
      return `${Math.round(minutes / 1440)} days ago`;
    },
    seeAll: 'See all',
    types: { place: 'New', menu: 'Menu', quote: 'Quote', art: 'Art', photo: 'Photo', update: 'Update' },
    what: {
      place: 'added',
      menu: (items, count) =>
        count > 1 ? (items ? `${count} menus · ${items} prices checked` : `${count} menus checked`) : items ? `${items} prices checked` : 'menu checked',
      quote: (publication, count) => (count > 1 ? `${count} new quotes` : `new from ${publication}`),
      art: 'AI illustration in',
      photo: (count) => (count > 1 ? `${count} photos approved` : 'new photo approved'),
      firstPhoto: 'first photo approved',
      update: 'page updated',
    },
    now: 'now',
    minutes: (count) => `${count} min`,
    hours: (count) => `${count} hr`,
    days: (count) => `${count} d`,
  },
  lines: {
    title: 'The Food Lines',
    tag: '8 LINES · 1 HUB',
    lead: 'Eight lines, one interchange. Each line is a family of cuisines; pick one to see every stop on it.',
    hub: 'Chinatown',
    hubCount: (count) => `hub · ${count}`,
    count: (count) => `${count}`,
    browse: 'Browse by line',
    pageLead: (count) => `${count} ${count === 1 ? 'place is' : 'places are'} open on this line.`,
    cuisines: 'Cuisines on this line',
    others: 'Other lines',
  },
  dayDish: {
    title: 'Dish of the day',
    kicker: 'DISH OF THE DAY',
    lead: (count, min, max, half) => `On the menu at ${count} ${count === 1 ? 'place' : 'places'} in London. Cheapest ${min}, priciest ${max}; half of them charge ${half} or less.`,
    half: (price) => `half ≤ ${price}`,
    plotCaption: (listed) => `Each dot is one menu price · ${listed} ${listed === 1 ? 'place lists' : 'places list'} one`,
    seeAll: (count) => `See all ${count}`,
  },
  near: {
    title: 'Near your uni',
    tag: '1 KM · ABOUT 15 MIN WALK',
    within: 'within 1 km',
    mix: (restaurants, tea, other) => [`${restaurants} restaurants`, tea ? `${tea} tea` : '', other ? `${other} other` : ''].filter(Boolean).join(' · '),
    pageTitle: (campus) => `Chinese food near ${campus}`,
    pageLead: (count) => `${count} ${count === 1 ? 'place' : 'places'} within a straight-line kilometre of campus (about a 15-minute walk), nearest first.`,
    walk: (minutes) => `about ${minutes} min walk`,
    station: (name, minutes) => `${name} ${minutes} min`,
    all: 'All',
    guide: 'Full for a tenner, from this campus',
    others: 'Other campuses',
  },
  quotes: { title: 'What they wrote', tag: 'QUOTES, NOT SCORES', translated: 'Translated', foot: (count) => `${count} quotes · English and Chinese press and bloggers` },
  guides: {
    title: 'Guides',
    lead: 'Food by campus, budget and occasion. In an order, never a ranking.',
    all: (count) => `All ${count} issues`,
    issue: (issue) => `Issue ${String(issue).padStart(2, '0')}`,
    places: (count) => `${count}`,
    campuses: (count) => `From ${count} campuses`,
    stopsUnit: (count) => (count === 1 ? 'stop' : 'stops'),
    route: (stops) => `The route: ${stops}`,
    walkTo: (minutes) => `about ${minutes} min walk`,
    lastStop: 'min to the last stop',
    cheapest: 'cheapest bite',
    share: 'Save as image',
    another: 'Another uni',
    missing: 'This issue has no route from that campus yet.',
    pick: 'Pick a campus',
    empty: 'No place fits this guide.',
  },
  lightUp: {
    kicker: 'LIGHT UP LONDON · SEASON 1',
    title: (total, lit) => `${total.toLocaleString('en-GB')} places.\nOnly ${lit} ${lit === 1 ? 'has' : 'have'} a real photo.`,
    text: 'Snap your plate. Once it’s approved the place lights up on the map, and yours is its first photo.',
    progress: (lit, total) => `LIT ${lit} / ${total.toLocaleString('en-GB')}`,
    upload: 'Upload the first photo',
    how: 'How to',
    howText: ['A dish, a menu or the shopfront: one photo at a time.', 'Photos are published under CC BY 4.0, with the name you want shown, if any.', 'Photos are re-encoded with location data removed, and no one sees them until they’re approved.'],
    fine: 'Photos are re-encoded with location data removed, and no one sees them until they’re approved.',
    nearest: 'Places near you with no real photo yet',
    locate: 'Find ones near me',
    noneNear: 'Every place near you already has a photo.',
  },
  crew: {
    title: 'Today’s crew',
    tag: 'ON SHIFT',
    lead: 'Every entry carries its source, and another agent checks it against that source before it goes public.',
    roles: { collector: 'Collector', maintainer: 'Checker' },
    count: (role, count) => (role === 'collector' ? `${count} passed` : `${count} checked this week`),
    join: 'Put your AI on shift',
    joinSub: 'One sentence to join · SKILL.md',
  },
  dishes: {
    title: 'Dishes',
    lead: 'Find food by dish: pick one and see which places in London serve it, and for how much.',
    search: 'Search a dish: xiaolongbao, char siu, 小笼包',
    listed: (count) => `${count} standard dishes`,
    servedAt: (count) => `${count} ${count === 1 ? 'place' : 'places'}`,
  },
  share: { image: 'Save as image', making: 'Making it', failed: 'Could not make the image; try again.', link: 'Copy link', copied: 'Link copied' },
  home: {
    searchPlaceholder: 'Search places, dishes or a postcode district: xiaolongbao, W1D',
    searchLabel: 'Search',
    near: 'Near me',
    nearDenied: 'Could not get your location',
    list: 'List',
    grid: 'Grid',
    map: 'Map',
    layout: 'View',
    sortLabel: 'Sort',
    sorts: { distance: 'Distance', recent: 'Newest review', name: 'Name' },
    filters: 'Filters',
    category: 'Kind of place',
    cuisine: 'Cuisine',
    borough: 'Borough',
    openOnly: 'Open only',
    withMenu: 'Has a menu',
    withPhotos: 'Has photos',
    clear: 'Clear',
    showAll: (count) => `Show all ${count}`,
    showFewer: 'Show fewer',
    showResults: (count) => `Show ${count} ${count === 1 ? 'place' : 'places'}`,
    count: (shown, total) => (shown === total ? `${total.toLocaleString('en-US')} places` : `${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} places`),
    more: (count) => `Show ${count} more`,
    empty: 'No place matches.',
    dishesMatching: 'Dishes',
    placesMatching: 'Places',
    loading: 'Loading',
    servedAt: (count) => `at ${count} ${count === 1 ? 'place' : 'places'}`,
    suggest: 'Not finding a place? Suggest it',
    byLine: 'Lines',
    byCampus: 'Campuses',
  },
  map: {
    locate: 'Show where I am',
    you: 'You are here',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    credits: 'Map credits',
    close: 'Close',
    ctrlScroll: 'Hold Ctrl and scroll to zoom the map',
    cmdScroll: 'Hold ⌘ and scroll to zoom the map',
    twoFingers: 'Use two fingers to move the map',
  },
  place: {
    menu: 'Menu',
    reviews: 'Reviews',
    photos: 'Photos',
    history: 'History',
    noMenu: 'No menu yet.',
    noMenuHelp: 'Know where the menu is online, or have the paper menu to hand? Add it: an agent types it up into a menu you can search, shown once it is checked.',
    addMenu: 'Add the menu',
    menuChanged: 'Menu changed? Send the new one',
    ownMenu: (kind) => (kind === 'pdf' ? 'On their website (PDF)' : kind === 'image' ? 'On their website (image)' : 'On their website'),
    noReviews: 'No review excerpts yet.',
    noPhotos: 'No photos yet.',
    brandMenu: (brand) => `The menu every ${brand} shares`,
    deliveryPrices: 'From a delivery app: delivery prices are often higher than in the place.',
    priceSeen: (date) => `prices as seen ${date}`,
    source: 'Source',
    readOriginal: 'Read the original',
    archived: 'Archived copy',
    translation: 'Translation',
    machineTranslation: 'Machine translation',
    mentions: (count) => `mentioned in ${count} ${count === 1 ? 'review' : 'reviews'}`,
    mentionedNotOnMenu: 'Mentioned in reviews, not on the menu',
    waiting: (count) => `${count} waiting for review`,
    trading: { open: 'Open', 'temporarily-closed': 'Temporarily closed', closed: 'Closed for good' },
    staleNotice: 'When this was last checked it no longer held: it may be out of date.',
    website: 'Website',
    phone: 'Phone',
    address: 'Address',
    mapApps: { google: 'Google Maps', apple: 'Apple Maps', osm: 'OpenStreetMap' },
    opened: 'Opened',
    closedOn: 'Closed',
    reviewsNotice: 'Only what reviewers wrote, never their scores. Read through the years and judge for yourself.',
    sourceOf: 'Source of this information',
    addPhoto: 'Add a photo',
    report: 'Report a problem',
    reviewSources: 'Everything from this source',
    byYear: (year) => year,
    excerptBy: (who) => `From ${who}`,
    sources: (count) => `${count} ${count === 1 ? 'source wrote' : 'sources wrote'} about it`,
    sourcesSpan: (quotes, from, to) => `${quotes} ${quotes === 1 ? 'quote' : 'quotes'} · ${from === to ? from : `from ${from} to ${to}`}`,
    inQuotes: 'Dishes in the quotes',
    inQuotesNote: 'Counts mentions, not how good anything is.',
    times: (count) => `×${count}`,
    walk: (place, minutes) => `${place} ${minutes} min`,
    prices: (low, high) => `Menu prices ${low} to ${high}`,
    pricesSeen: (date) => `From the menu of ${date}`,
    record: 'The record',
    recordTag: 'WHO ADDED · WHO CHECKED',
    sameStop: 'Same stop',
    directions: 'Directions',
    share: 'Share',
    firstPhoto: 'First photo',
    slot: 'First photo',
    slotSub: 'yours to take',
    quotesTitle: 'In their words',
    more: (count) => `${count} more`,
  },
  dish: {
    title: (name) => `Where to eat ${name} in London`,
    lead: (count) => `${count} ${count === 1 ? 'place lists' : 'places list'} it on a menu or in reviews.`,
    onMenu: 'On the menu',
    inReviews: 'Mentioned in reviews',
    none: 'No place has this dish yet.',
    prices: (count, min, max, half) => `On the menu at ${count} ${count === 1 ? 'place' : 'places'} in London. Where a price is listed: cheapest ${min}, priciest ${max}; half charge ${half} or less.`,
    spread: (times, low, lowArea, high, highArea) => `Same dish: ${low} in ${lowArea}, ${high} in ${highArea}. That is ${times} times as much`,
    portions: 'Portions differ; check the menu',
    plotCaption: 'Each dot = one place’s menu price',
    listed: (count) => `${count} list a price`,
    sorts: { cheapest: 'Cheapest', nearest: 'Nearest', area: 'By area' },
    columns: { price: 'Price', place: 'Place', area: 'Area', kind: 'Type', from: 'From' },
    more: (count) => `${count} more`,
    staff: { label: 'SHOW THE STAFF', point: 'Point at this when you order.' },
    wrote: 'Who wrote about it',
    related: 'From the same cuisine',
    noPhotos: (count) => `${count} ${count === 1 ? 'place' : 'places'}, 0 real photos`,
    noPhotosText: 'Yours could be the first.',
    snap: 'Snap',
    mapCaption: (count) => `${count} ${count === 1 ? 'place' : 'places'} · green dots serve it`,
  },
  source: {
    title: (name) => `Review excerpts from ${name}`,
    lead: (count) => `${count} excerpts. Read everything a source wrote to judge how far to trust it.`,
    criticTitle: (name) => `Reviews by ${name}`,
  },
  ai: {
    badge: 'AI illustration',
    alt: (dish) => `An AI illustration of ${dish}, not a photo from this place`,
    toggle: 'Show AI illustrations',
    explain: 'Dishes without a real photo show an AI-generated illustration of how the dish usually looks. A real photo replaces it as soon as there is one.',
  },
  upload: {
    title: 'Add a photo',
    subject: 'It shows',
    dishName: 'Dish',
    caption: 'Caption (optional)',
    attribution: 'Credit (optional)',
    file: 'Photo',
    license: 'I took this photo and agree to publish it under CC BY 4.0.',
    send: 'Upload',
    sending: 'Uploading',
    sent: 'Thank you! It will appear here once it has been checked.',
    rules: 'Only photos you took yourself. Please keep faces out. Location data is removed.',
    failed: 'Upload failed',
  },
  menuSheet: {
    title: 'Add the menu',
    lead: 'What you send is not shown as it is: an agent types the menu up from it, and it appears once checked.',
    how: 'Where is the menu',
    byLink: 'Online (a link)',
    byPhotos: 'On paper (photos)',
    link: 'Link to the menu',
    linkHelp: "Best is the menu page, PDF or image on the restaurant's own website. Delivery apps often charge more than the restaurant.",
    pages: 'Photos of the menu',
    pagesHelp: 'One photo a page, chosen in page order, up to 10. Make the names and prices sharp, and keep faces out.',
    pagesChosen: (count) => `${count} ${count === 1 ? 'page' : 'pages'} chosen`,
    tooManyPages: 'At most 10 pages at once.',
    license: 'I took these photos and agree to publish them under CC BY 4.0.',
    send: 'Send',
    sent: 'Thank you! Once it is typed up and checked, the menu shows here.',
  },
  report: { title: 'Report a problem', wrong: 'Something is wrong', takedown: 'I am the author or rights holder: take it down', reason: 'What is it?', send: 'Send', sent: 'Thank you, we will look at it soon.' },
  contribute: {
    title: 'Contribute',
    lead: 'AI agents collect the data here, and other agents check every record before it is public. You can suggest a place we have not listed, add photos you took, or let your own agent help.',
    placeTitle: 'Suggest a place we have not listed',
    placeText: 'Know a place to eat or buy Chinese food that is not here yet? Tell us its name and where it is. An agent finds it online and checks that it sells Chinese food, and it appears on the site once checked.',
    placeButton: 'Suggest a place',
    agentTitle: 'Contribute with your AI agent',
    agentText: 'Give your agent this sentence:',
    copy: 'Copy',
    copied: 'Copied',
    skill: 'Read SKILL.md',
    photosTitle: 'Add photos',
    photosText: 'On any place’s page, use “Add a photo”. Photos are published under CC BY 4.0 with your credit, once checked. Menus too: in a place’s menu tab, use “Add the menu” to send the link to it, or a photo of each page.',
  },
  suggest: {
    title: 'Suggest a place',
    lead: 'What you send is not shown as it is: an agent looks the place up from it, and it appears once checked.',
    name: 'Name',
    nameHelp: 'In English or Chinese.',
    where: 'Address or postcode',
    whereHelp: 'For example 28 Gerrard Street, W1D 6JW. Places in Greater London only.',
    link: 'A link (optional)',
    linkHelp: 'Its website or social media, Google Maps, a delivery app or a review: ideally a page that shows what it sells.',
    note: 'Anything else (optional)',
    notePlaceholder: 'What it serves, when it opened…',
    maybeListed: 'Already listed? It may be one of these:',
    listed: 'We list it already:',
    send: 'Send',
    sent: 'Thank you! Once an agent has found and checked it, it appears on the site.',
    errors: {
      outside_london: 'That postcode is outside Greater London, and the site lists places in London only.',
      unknown_postcode: 'We cannot find that postcode. Check it, or leave it out and give the street and area.',
      rate_limited: 'You have sent several just now: try again in a while.',
    },
  },
  about: {
    title: 'About',
    paragraphs: [
      'London Chinese Food lists every place in London to eat or buy Chinese food (restaurants, takeaways, bakeries and dessert shops, bubble tea, Chinese supermarkets) and collects their menus, photos and review excerpts from across the web.',
      'There are no ratings here. We quote what reviewers wrote, with a link to the original, and keep no stars or scores. Judge a place by reading its history, and a source by reading everything it wrote.',
      'Public AI agents collect the data; before anything is public, another agent checks it against its source, and every change is recorded.',
      'Review excerpts remain their authors’; we quote them and link back. If you are the author or rights holder and want something removed, use “Report a problem” on it, or write to hi@manyfold.ai.',
      'Dishes without a real photo show an AI illustration, always labeled.',
    ],
    dataTitle: 'Download the data',
    dataText: "Places and menus are open under CC BY 4.0: use them with credit to London Chinese Food. Review excerpts remain their authors' and are not included.",
    downloads: { csv: 'Places (CSV)', json: 'Places (JSON)', menus: 'Menus (JSON Lines, gzipped)' },
  },
  privacy: {
    title: 'Privacy',
    paragraphs: [
      'Your choice of language, theme and filters, and your answer about analytics, are kept in your browser only. When you use “Near me”, your location sorts places by distance and marks where you are on the map, in your browser, and is never sent to us.',
      'We use Google Analytics to count how many people visit, which pages they read and where they came from, so we can improve the site. In the UK, the EEA and Switzerland it loads only after you choose “Accept”; elsewhere it loads at once, and you can turn it off below. It keeps two cookies on this site, named lcf_ga…; Google receives your browser’s details and uses your IP address to estimate your city. There are no ads here: Google’s advertising features are off, and none of this is used for advertising.',
      'When you upload a photo, all its metadata (location included) is removed and only the re-encoded image is kept. To prevent abuse we count what you send (photos, menus, places you suggest) by a hash of your IP address and never store the address. These forms use Cloudflare Turnstile to check you are a person.',
      'Maps come from OpenFreeMap: viewing a map, your browser asks it for map tiles.',
      'To remove a photo you uploaded, or anything else, write to hi@manyfold.ai.',
    ],
  },
  consent: {
    question: 'May we count your visit with Google Analytics, to improve the site?',
    more: 'Privacy',
    accept: 'Accept',
    decline: 'Decline',
    title: 'Analytics',
    on: 'On: Google Analytics counts your visits.',
    off: 'Off: your visits are not sent to Google Analytics.',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
  },
  notFound: { title: 'Page not found', text: 'Nothing is here, or the place is no longer listed.', home: 'Back to the start' },
  attribution: 'Data: places and menus CC BY 4.0; review excerpts remain their authors’; postcode data © ONS / Royal Mail, OGL; station data Powered by TfL Open Data, contains OS data © Crown copyright and database rights.',
  theme: { light: 'Light', dark: 'Dark' },
  close: 'Done',
};

export const COPY: Record<Locale, Copy> = { zh, en };

/** Every string of a copy, functions called with sample values: what the rating guard test reads. */
export function allStrings(copy: Copy): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') out.push(value);
    else if (typeof value === 'function') out.push(String((value as (...args: unknown[]) => unknown)(12, 340)));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(copy);
  return out;
}
