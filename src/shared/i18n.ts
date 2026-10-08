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
  nav: { home: string; contribute: string; about: string };
  home: {
    searchPlaceholder: string;
    searchLabel: string;
    near: string;
    nearDenied: string;
    list: string;
    map: string;
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
    count: (shown: number, total: number) => string;
    empty: string;
    dishesMatching: string;
    placesMatching: string;
    loading: string;
    servedAt: (count: number) => string;
  };
  place: {
    menu: string;
    reviews: string;
    photos: string;
    history: string;
    noMenu: string;
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
    opened: string;
    closedOn: string;
    reviewsNotice: string;
    sourceOf: string;
    addPhoto: string;
    report: string;
    reviewSources: string;
    byYear: (year: string) => string;
    excerptBy: (who: string) => string;
  };
  dish: {
    title: (name: string) => string;
    lead: (count: number) => string;
    onMenu: string;
    inReviews: string;
    none: string;
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
  report: { title: string; wrong: string; takedown: string; reason: string; send: string; sent: string };
  contribute: { title: string; lead: string; agentTitle: string; agentText: string; copy: string; copied: string; skill: string; photosTitle: string; photosText: string };
  about: { title: string; paragraphs: string[] };
  privacy: { title: string; paragraphs: string[] };
  notFound: { title: string; text: string; home: string };
  attribution: string;
  theme: { light: string; dark: string };
}

const zh: Copy = {
  htmlLang: 'zh-Hans',
  siteName: '伦敦中餐 · London Chinese Food',
  siteShort: '伦敦中餐',
  tagline: '伦敦哪里吃得到中国菜',
  description: '伦敦能吃到、买到中国食物的店：菜单、照片和来自全网的评价原文。没有评分，读历史自己判断。',
  switchTo: 'English',
  nav: { home: '首页', contribute: '参与贡献', about: '关于' },
  home: {
    searchPlaceholder: '搜店名、菜名或邮区，例如 小笼包、W1D',
    searchLabel: '搜索',
    near: '附近',
    nearDenied: '无法获取你的位置',
    list: '列表',
    map: '地图',
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
    count: (shown, total) => (shown === total ? `${total} 家店` : `${shown} / ${total} 家店`),
    empty: '没有符合条件的店。',
    dishesMatching: '菜品',
    placesMatching: '店铺',
    loading: '加载中',
    servedAt: (count) => `${count} 家店有`,
  },
  place: {
    menu: '菜单',
    reviews: '评价',
    photos: '照片',
    history: '记录',
    noMenu: '还没有菜单。',
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
    opened: '开业',
    closedOn: '关闭',
    reviewsNotice: '这里只摘录评价原文、不收评分。按时间读下去，自己判断。',
    sourceOf: '信息来源',
    addPhoto: '上传照片',
    report: '报告问题',
    reviewSources: '看这个来源的全部摘录',
    byYear: (year) => `${year} 年`,
    excerptBy: (who) => `摘自 ${who}`,
  },
  dish: {
    title: (name) => `伦敦哪里吃得到${name}`,
    lead: (count) => `${count} 家店的菜单或评价里有这道菜。`,
    onMenu: '菜单上有',
    inReviews: '评价中提到',
    none: '还没有店铺有这道菜。',
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
  report: { title: '报告问题', wrong: '信息有误', takedown: '我是作者或权利人，请下架', reason: '说明', send: '发送', sent: '收到了，我们会尽快处理。' },
  contribute: {
    title: '参与贡献',
    lead: '这里的数据由 AI agent 收集、由另一些 agent 逐条核对。你可以让自己的 agent 来帮忙，也可以上传你拍的照片。',
    agentTitle: '让你的 AI agent 参与',
    agentText: '把下面这句话发给你的 agent：',
    copy: '复制',
    copied: '已复制',
    skill: '阅读 SKILL.md',
    photosTitle: '上传照片',
    photosText: '在任意店铺页面点“上传照片”。照片经审核后公开，以 CC BY 4.0 许可署你的名字。',
  },
  about: {
    title: '关于',
    paragraphs: [
      '伦敦中餐收录伦敦所有能吃到、买到中国食物的店：餐厅、外卖、烘焙甜品、奶茶、华人超市。',
      '这里没有评分。我们只摘录评价原文，附上原文链接，不收任何星级或分数。一家店好不好，读它的历史自己判断；一个评论来源靠不靠谱，也可以读它写过的全部。',
      '数据由公开的 AI agent 收集，每一条在公开前都由另一个 agent 对照来源核对；所有修改都有记录。',
      '评价摘录版权归原作者，我们只作引用并链回原文。如果你是作者或权利人，想让我们删除某条内容，请点该条的“报告问题”，或写信到 hi@manyfold.ai。',
      '没有实拍照片的菜会显示 AI 示意图，并始终标注。',
    ],
  },
  privacy: {
    title: '隐私',
    paragraphs: [
      '这个网站不用分析或广告 cookie。你选的语言和主题只保存在你的浏览器里。',
      '上传照片时，我们会删除照片里的全部元数据（包括位置），只保存重新编码后的图片。为了防止滥用，我们会对 IP 地址做哈希后计数，不保存 IP 本身。上传表单使用 Cloudflare Turnstile 验证你是人。',
      '地图由 OpenFreeMap 提供，查看地图时你的浏览器会向它请求地图图块。',
      '想删除你上传的照片或其他内容，请写信到 hi@manyfold.ai。',
    ],
  },
  notFound: { title: '找不到这个页面', text: '这个地址没有内容，或这家店已不再收录。', home: '回到首页' },
  attribution: '数据：店铺与菜单 CC BY 4.0；评价摘录版权归原作者；邮编数据 © ONS / Royal Mail，OGL。',
  theme: { light: '浅色', dark: '深色' },
};

const en: Copy = {
  htmlLang: 'en-GB',
  siteName: 'London Chinese Food · 伦敦中餐',
  siteShort: 'London Chinese Food',
  tagline: 'Where to find Chinese food in London',
  description: 'Every place in London to eat or buy Chinese food: menus, photos and review excerpts from across the web. No ratings: read the history and judge for yourself.',
  switchTo: '中文',
  nav: { home: 'Home', contribute: 'Contribute', about: 'About' },
  home: {
    searchPlaceholder: 'Search places, dishes or a postcode district: xiaolongbao, W1D',
    searchLabel: 'Search',
    near: 'Near me',
    nearDenied: 'Could not get your location',
    list: 'List',
    map: 'Map',
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
    count: (shown, total) => (shown === total ? `${total} places` : `${shown} of ${total} places`),
    empty: 'No place matches.',
    dishesMatching: 'Dishes',
    placesMatching: 'Places',
    loading: 'Loading',
    servedAt: (count) => `at ${count} ${count === 1 ? 'place' : 'places'}`,
  },
  place: {
    menu: 'Menu',
    reviews: 'Reviews',
    photos: 'Photos',
    history: 'History',
    noMenu: 'No menu yet.',
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
    opened: 'Opened',
    closedOn: 'Closed',
    reviewsNotice: 'Only what reviewers wrote, never their scores. Read through the years and judge for yourself.',
    sourceOf: 'Source of this information',
    addPhoto: 'Add a photo',
    report: 'Report a problem',
    reviewSources: 'Everything from this source',
    byYear: (year) => year,
    excerptBy: (who) => `From ${who}`,
  },
  dish: {
    title: (name) => `Where to eat ${name} in London`,
    lead: (count) => `${count} ${count === 1 ? 'place lists' : 'places list'} it on a menu or in reviews.`,
    onMenu: 'On the menu',
    inReviews: 'Mentioned in reviews',
    none: 'No place has this dish yet.',
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
  report: { title: 'Report a problem', wrong: 'Something is wrong', takedown: 'I am the author or rights holder: take it down', reason: 'What is it?', send: 'Send', sent: 'Thank you, we will look at it soon.' },
  contribute: {
    title: 'Contribute',
    lead: 'AI agents collect the data here, and other agents check every record before it is public. Your agent can help, and you can add photos you took.',
    agentTitle: 'Contribute with your AI agent',
    agentText: 'Give your agent this sentence:',
    copy: 'Copy',
    copied: 'Copied',
    skill: 'Read SKILL.md',
    photosTitle: 'Add photos',
    photosText: 'On any place’s page, use “Add a photo”. Photos are published under CC BY 4.0 with your credit, once checked.',
  },
  about: {
    title: 'About',
    paragraphs: [
      'London Chinese Food lists every place in London to eat or buy Chinese food: restaurants, takeaways, bakeries and dessert shops, bubble tea, Chinese supermarkets.',
      'There are no ratings here. We quote what reviewers wrote, with a link to the original, and keep no stars or scores. Judge a place by reading its history, and a source by reading everything it wrote.',
      'Public AI agents collect the data; before anything is public, another agent checks it against its source, and every change is recorded.',
      'Review excerpts remain their authors’; we quote them and link back. If you are the author or rights holder and want something removed, use “Report a problem” on it, or write to hi@manyfold.ai.',
      'Dishes without a real photo show an AI illustration, always labeled.',
    ],
  },
  privacy: {
    title: 'Privacy',
    paragraphs: [
      'This site uses no analytics or advertising cookies. Your choice of language and theme is kept in your browser only.',
      'When you upload a photo, all its metadata (location included) is removed and only the re-encoded image is kept. To prevent abuse we count uploads by a hash of your IP address and never store the address. The upload form uses Cloudflare Turnstile to check you are a person.',
      'Maps come from OpenFreeMap: viewing a map, your browser asks it for map tiles.',
      'To remove a photo you uploaded, or anything else, write to hi@manyfold.ai.',
    ],
  },
  notFound: { title: 'Page not found', text: 'Nothing is here, or the place is no longer listed.', home: 'Back to the start' },
  attribution: 'Data: places and menus CC BY 4.0; review excerpts remain their authors’; postcode data © ONS / Royal Mail, OGL.',
  theme: { light: 'Light', dark: 'Dark' },
};

export const COPY: Record<Locale, Copy> = { zh, en };

/** Every string of a copy, functions called with sample values: what the rating guard test reads. */
export function allStrings(copy: Copy): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') out.push(value);
    else if (typeof value === 'function') out.push(String((value as (...args: unknown[]) => unknown)(3, 5)));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(copy);
  return out;
}
