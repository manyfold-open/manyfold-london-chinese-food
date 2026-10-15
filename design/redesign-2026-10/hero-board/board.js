// The mock's two modes, in one file: ?frame=desktop|phone draws the site's hero (the frames), and
// without it the page shows both frames with the state switcher and the notes.

const params = new URLSearchParams(location.search);
const FRAME = params.get('frame');
const THEME = params.get('theme') === 'dark' ? 'dark' : 'light';
const ROW = 38;
const MIN = 60_000;

const TYPES = {
  place: ['新店', 'var(--board-new)'],
  menu: ['菜单', 'var(--amber)'],
  quote: ['原话', 'var(--line-boba)'],
  photo: ['实拍', 'var(--board-photo)'],
};
const WHAT = {
  place: () => '收录',
  menu: (e) => (e.items ? `${e.items} 道菜价已核对` : '菜单已核对'),
  quote: (e) => `${e.publication} 新摘录`,
  photo: () => '新实拍通过审核',
};

const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => n.toLocaleString('en-US');
const minutes = (ms) => Math.max(0, Math.round(ms / MIN));
/** As the board says it: now, 4 min, 3 hr, 2 d. */
const ago = (ms) => {
  const m = minutes(ms);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} hr`;
  return `${Math.round(m / 1440)} d`;
};
/** As a sentence says it: 12 分钟前, 9 小时前. */
const agoZh = (ms) => {
  const m = minutes(ms);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 48 * 60) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
};
const londonDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(t));
/** The moment it is `hour:minute` in London on a day (YYYY-MM-DD). */
function londonAt(day, hour, minute) {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, hour, minute);
  const shown = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
  return t - (shown - hour) * 3600_000;
}
const nextDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * Checks of one place, of one kind, within a quarter of an hour of each other, as one row: four
 * menus checked together are one line on the board, not four of the same name.
 */
function merged(events) {
  const out = [];
  for (const event of events) {
    const last = out.at(-1);
    if (last && last.name === event.name && last.type === event.type && Date.parse(last.oldest) - Date.parse(event.at) <= 15 * MIN) {
      last.count += 1;
      last.items = (last.items ?? 0) + (event.items ?? 0);
      last.oldest = event.at;
    } else out.push({ ...event, count: 1, oldest: event.at });
  }
  return out;
}

const WHAT_MANY = {
  place: () => '收录',
  menu: (e) => (e.items ? `${e.count} 份菜单 · ${e.items} 道菜价已核对` : `${e.count} 份菜单已核对`),
  quote: (e) => `${e.count} 段原话 · ${e.publication} 等`,
  photo: (e) => `${e.count} 张实拍通过审核`,
};

const newestCheck = Date.parse(DATA.events[0].at);
const STATES = {
  before: { label: '现在（空屏）', now: () => Date.now() },
  live: { label: '白天 · 有核实', now: () => newestCheck + 4 * MIN },
  quiet: { label: '清晨 · 今天 0 条', now: () => londonAt(nextDay(londonDay(newestCheck)), 6, 30) },
  recent: { label: '没有核实记录', now: () => Date.now() },
  loading: { label: '加载中', now: () => Date.now() },
};

/* ───────── the frame: the site's hero ───────── */

let roll = null;
let current = 'live';

function rowHtml(row, now) {
  if (row.skel) return '<div class="live-row skel"><span></span><span></span><span></span><span></span></div>';
  return (
    `<a class="live-row" href="#"><time>${ago(now - Date.parse(row.at))}</time>` +
    `<em class="live-kind${row.kind === 'update' ? ' update' : ''}"${row.color ? ` style="--c: ${row.color}"` : ''}>${esc(row.label)}</em>` +
    `<span class="live-text">${esc(row.text)} <small>${esc(row.sub)}</small></span>` +
    `<span class="live-where">${esc(row.o ?? '··')}</span></a>`
  );
}

/** Draws the board in a state; the desktop frame tells the page how many rows it shows. */
function showState(state) {
  const shown = draw(state);
  if (FRAME === 'desktop' && parent !== window) for (const span of parent.document.querySelectorAll('[data-rows]')) span.textContent = String(shown || '…');
  return shown;
}

/** Draws the board in a state; returns how many rows it shows. */
function draw(state) {
  current = state;
  const hero = document.querySelector('.front-hero');
  const el = document.getElementById('board');
  const now = STATES[state].now();
  window.clearInterval(roll);
  const head = (title, still, dimOnly = false) =>
    `<header><span class="live-dot${still ? ' still' : ''}" aria-hidden="true"></span><b>${title}</b><span class="live-only${dimOnly ? ' dim' : ''}">ONLY VERIFIED</span></header>`;

  if (state === 'before') {
    hero.classList.remove('fill');
    el.innerHTML = `${head('实时到站', false)}<p class="live-empty">这会儿还没有新的核实。</p><footer>今天已核实 0 条 · 0 位采集员在岗</footer>`;
    return 0;
  }
  hero.classList.add('fill');

  let title = '实时到站';
  let still = false;
  let rows = [];
  let foot = '';
  if (state === 'loading') {
    still = true;
    rows = Array.from({ length: 8 }, () => ({ skel: true }));
    foot = '<span class="skel"></span>';
  } else if (state === 'recent') {
    title = '最近上新';
    still = true;
    rows = DATA.updated.map((u) => ({ at: u.at, kind: 'update', label: '更新', text: u.name, sub: '页面有更新', o: u.o }));
    const today = DATA.updatedAt.filter((t) => londonDay(t) === londonDay(now)).length;
    foot = today
      ? `<span>今天 <b>${fmt(today)}</b> 家店有更新</span><span>共 ${fmt(DATA.open)} 家在营业</span>`
      : `<span>最近一次更新在 ${agoZh(now - Date.parse(DATA.updatedAt[0]))}</span><span>共 ${fmt(DATA.open)} 家在营业</span>`;
  } else {
    const seen = DATA.events.filter((e) => Date.parse(e.at) <= now);
    rows = merged(seen).map((e) => ({ at: e.at, label: TYPES[e.type][0], color: TYPES[e.type][1], text: e.name, sub: (e.count > 1 ? WHAT_MANY : WHAT)[e.type](e), o: e.o }));
    const today = seen.filter((e) => londonDay(e.at) === londonDay(now)).length;
    still = now - Date.parse(seen[0].at) > 60 * MIN;
    foot = today
      ? `<span>今天已核实 <b>${today}</b> 条 · <b>3</b> 位采集员在岗</span>`
      : `<span>今天还没有新的核实 · 最近一次在 ${agoZh(now - Date.parse(seen[0].at))}</span>`;
  }

  el.innerHTML = `${head(title, still)}<div class="live-rows"><div class="live-track"></div></div><footer>${foot}</footer>`;
  const box = el.querySelector('.live-rows');
  const track = el.querySelector('.live-track');
  // Beside the map the rows fill the board (C); elsewhere four, as now.
  const fills = matchMedia('(min-width: 1081px)').matches;
  const room = fills ? box.clientHeight : 4 * ROW;
  const shown = Math.max(4, Math.min(8, Math.floor(room / ROW)));
  const height = fills ? room / shown : ROW;
  if (!fills) box.style.height = `${Math.min(shown, rows.length) * ROW}px`;
  el.style.setProperty('--row', `${height}px`);
  const rolls = rows.length > shown && !rows[0].skel && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const list = rolls ? [...rows, ...rows.slice(0, shown)] : rows.slice(0, shown);
  track.innerHTML = list.map((row) => rowHtml(row, now)).join('');
  if (!rolls) return Math.min(shown, rows.length);
  let pos = 0;
  roll = window.setInterval(() => {
    pos += 1;
    track.style.transition = '';
    track.style.transform = `translateY(-${pos * height}px)`;
    if (pos >= rows.length) {
      window.setTimeout(() => {
        track.style.transition = 'none';
        track.style.transform = 'translateY(0)';
        pos = 0;
      }, 750);
    }
  }, 3200);
  return shown;
}

/** The centre and zoom that fill a frame with a box, as CityMapView frames it. */
function frame(bounds, width, height) {
  const [south, north, west, east] = bounds;
  const y = (lat) => {
    const r = (lat * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  const dx = ((east - west) / 360) * 512;
  const dy = (y(south) - y(north)) * 512;
  return { center: [(west + east) / 2, (south + north) / 2], zoom: Math.log2(Math.max(width / dx, height / dy)) };
}

function drawMap() {
  const el = document.getElementById('map');
  if (!el || !el.offsetParent || !window.maplibregl) return;
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colors = DATA.lines.map(token);
  const muted = token('--muted');
  const { width, height } = el.getBoundingClientRect();
  const map = new maplibregl.Map({
    container: el,
    style: `https://tiles.openfreemap.org/styles/${THEME === 'dark' ? 'dark' : 'positron'}`,
    ...frame([51.43, 51.585, -0.33, 0.07], width, height),
    cooperativeGestures: true,
    dragRotate: false,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('styleimagemissing', ({ id }) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  map.on('style.load', () => {
    map.addSource('places', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: DATA.dots.map(([lat, lng, line]) => ({ type: 'Feature', properties: { color: colors[line] ?? muted }, geometry: { type: 'Point', coordinates: [lng, lat] } })) },
    });
    map.addLayer({
      id: 'dots',
      type: 'circle',
      source: 'places',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 13, 3.8, 16, 6.5],
        'circle-opacity': 0.9,
        'circle-stroke-color': token('--card'),
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0, 15, 1.5],
      },
    });
  });
  for (const pin of DATA.pins) {
    const element = document.createElement('div');
    element.className = 'city-map-pin';
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', `${pin.label} ${pin.sub}`);
    element.innerHTML = `<a href="#" class="mk ${pin.kind}"${pin.shift ? ` style="translate: ${pin.shift}"` : ''}>${esc(pin.label)}<small>${pin.sub}</small></a>`;
    new maplibregl.Marker({ element, anchor: 'top-left' }).setLngLat([pin.lng, pin.lat]).addTo(map);
  }
}

/* ───────── the page: both frames, the switcher, the notes ───────── */

const NOTES = {
  before: [
    '现在上线的样子：没有核实记录时，到站屏只有一句话。',
    '页脚把零写出来：「今天已核实 0 条 · 0 位采集员在岗」。',
    '左栏比地图短，桌面 1440×900 下留白约 160px。',
  ],
  live: [
    '<b>A 第 1 层</b>：有核实记录就滚动显示，不限今天。行是线上真实的核实：最近更新的 40 家店的菜单、原话、照片和收录时间。',
    '<b>C</b>：到站屏撑满左栏，按高度显示 4 到 8 行（这里是 <span data-rows></span> 行），底边和地图对齐。手机不撑，保持 4 行。',
    '<b>A 补充</b>：同一家店、同一类、15 分钟内的多条核实合并成一行，比如「4 份菜单 · 25 道菜价已核对」，屏上不会连着出现同一个店名。',
    '<b>B</b>：今天有核实时，页脚照旧（条数按核实算，不按合并后的行算）。',
    '模拟时间：最新一条核实后 4 分钟。在岗人数是示意。',
  ],
  quiet: [
    '<b>B</b>：伦敦今天还没有核实时，页脚不写 0，改说最近一次是多久前。',
    '红点停止闪烁、变成琥珀色：超过 1 小时没有新核实就不再显示「正在发生」。',
    '行照常显示之前的核实，时间写成几小时或几天前（「21 hr」「2 d」）。',
    '模拟时间：最新一条核实后的第二天，伦敦早上 6:30。',
  ],
  recent: [
    '<b>A 第 2 层</b>：完全没有核实记录时（首次部署、数据出错），标题换成「最近上新」，列出页面最近有更新的店。',
    '数据来自首页已经加载的店铺索引里的更新时间：只在店铺本身或它已公开的菜单、原话、照片变化时才变，只含已公开的店。不说是谁核实的。',
    '页脚用今天有更新的店数；今天还没有就说最近一次更新是多久前。',
    '全部是线上真实数据，时间是现在。',
  ],
  loading: [
    '<b>A 第 3 层</b>：数据还在加载时，显示同样高度的灰色占位行，页脚也占位，加载完不跳。',
    '不再显示一个「…」。',
  ],
};

function control() {
  const desktop = document.getElementById('f-desktop');
  const phone = document.getElementById('f-phone');
  const frames = [desktop, phone];
  const note = document.getElementById('note');
  let state = 'live';
  let theme = 'light';

  const src = (kind) => `${location.pathname}?frame=${kind}&theme=${theme}&state=${state}`;
  const apply = () => {
    for (const button of document.querySelectorAll('[data-state]')) button.setAttribute('aria-pressed', String(button.dataset.state === state));
    for (const button of document.querySelectorAll('[data-theme-pick]')) button.setAttribute('aria-pressed', String(button.dataset.themePick === theme));
    note.innerHTML = `<ul>${NOTES[state].map((line) => `<li>${line}</li>`).join('')}</ul>`;
    for (const f of frames) f.contentWindow?.showState?.(state);
  };

  const nav = document.getElementById('states');
  nav.innerHTML = Object.entries(STATES)
    .map(([key, { label }]) => `<button type="button" data-state="${key}">${label}</button>`)
    .join('');
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-state]');
    if (!button) return;
    state = button.dataset.state;
    apply();
  });
  document.getElementById('themes').addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-pick]');
    if (!button || button.dataset.themePick === theme) return;
    theme = button.dataset.themePick;
    document.documentElement.dataset.theme = theme;
    desktop.src = src('desktop');
    phone.src = src('phone');
    apply();
  });
  for (const f of frames) f.addEventListener('load', apply);
  desktop.src = src('desktop');
  phone.src = src('phone');

  // The desktop frame is 1440 wide, scaled to the stage.
  const viewport = desktop.parentElement;
  new ResizeObserver(() => {
    desktop.style.transform = `scale(${viewport.clientWidth / 1440})`;
  }).observe(viewport);

  document.getElementById('built').textContent = new Date(DATA.built).toLocaleString('zh-CN', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  apply();
}

if (FRAME) {
  window.showState = showState;
  window.addEventListener('load', () => {
    drawMap();
    showState(params.get('state') ?? 'live');
    // The title's font changes the column's height: count the rows again once it is in.
    document.fonts.ready.then(() => showState(current));
    window.addEventListener('resize', () => showState(current));
  });
} else {
  window.addEventListener('load', control);
}
