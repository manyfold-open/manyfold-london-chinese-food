/* The mocks' drawings: tube maps, price plots, walk strips and London dot maps, in either language.
   Everything is drawn from data-* hooks in the page, and drawn again when the language changes. */

/* each view carries its own data-lang; drawing follows the language of the element being drawn */
let drawing = 'zh';
const lang = () => drawing;
const langOf = (node) => (node.closest('[data-lang]')?.dataset.lang === 'en' ? 'en' : 'zh');
const tr = (zh, en) => (lang() === 'en' ? en : zh);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

/* the eight lines; counts are open places in the index on 2026-10-14 */
const LINES = [
  { id: 'dimsum', zh: '点心线', en: 'Dim Sum Line', c: '--l-dimsum', n: 658, L: ['贝斯沃特', 'Bayswater'], R: ['克罗伊登', 'Croydon'] },
  { id: 'takeaway', zh: '外卖线', en: 'Takeaway Line', c: '--l-takeaway', n: 685, L: ['恩菲尔德', 'Enfield'], R: ['埃尔瑟姆', 'Eltham'] },
  { id: 'noodle', zh: '粉面线', en: 'Noodle Line', c: '--l-noodle', n: 420, L: ['白教堂', 'Whitechapel'], R: ['贝斯沃特', 'Bayswater'] },
  { id: 'boba', zh: '奶茶线', en: 'Bubble Tea Line', c: '--l-boba', n: 253, L: ['苏豪', 'Soho'], R: ['金丝雀码头', 'Canary Wharf'] },
  { id: 'north', zh: '北方线', en: 'North Line', c: '--l-north', n: 228, L: ['伊斯灵顿', 'Islington'], R: ['白教堂', 'Whitechapel'] },
  { id: 'spicy', zh: '麻辣线', en: 'Spicy Line', c: '--l-spicy', n: 164, L: ['伦敦桥', 'London Bridge'], R: ['伊斯灵顿', 'Islington'] },
  { id: 'modern', zh: '新派线', en: 'New Wave Line', c: '--l-modern', n: 123, L: ['图廷', 'Tooting'], R: ['贝斯沃特', 'Bayswater'] },
  { id: 'grocery', zh: '中超线', en: 'Grocery Line', c: '--l-grocery', n: 78, L: ['霍洛威', 'Holloway'], R: ['金丝雀码头', 'Canary Wharf'] },
];
const pick = (pair) => (lang() === 'en' ? pair[1] : pair[0]);
const lineName = (line) => (lang() === 'en' ? line.en : line.zh);
/* the order of the line field in DOTS: dimsum, spicy, north, boba, grocery, modern, noodle, takeaway */
const DOT_LINE = ['--l-dimsum', '--l-spicy', '--l-north', '--l-boba', '--l-grocery', '--l-modern', '--l-noodle', '--l-takeaway'];

/* xiaolongbao: every listed menu price, in pence (52 of the 79 places list one) */
const XLB = [480, 500, 550, 559, 570, 580, 600, 600, 620, 620, 625, 630, 640, 650, 650, 650, 650, 650, 650, 650, 660, 660, 670, 680, 680, 680, 680, 680, 690, 695, 695, 699, 710, 720, 720, 730, 750, 750, 760, 780, 800, 850, 850, 875, 890, 999, 1000, 1080, 1299, 1390, 1500, 1600];

function drawTube(svg, { lit = null, labels = true, hub = true, names = false } = {}) {
  const vb = svg.viewBox.baseVal;
  const W = vb.width, H = vb.height, cx = W / 2;
  const half = W > 600 ? 70 : 30, gap = 8.4, sw = W > 600 ? 7 : 6;
  const padT = 26, padB = 22, step = (H - padT - padB) / 7;
  const off = 'oklch(88% 0.012 84)';
  LINES.forEach((line, i) => {
    const on = !lit || lit.includes(line.id);
    const color = on ? `var(${line.c})` : off;
    const yb = H / 2 - 3.5 * gap + i * gap;
    const yt = padT + i * step;
    const top = i < 4;
    const stagger = (top ? 3 - i : i - 4) * 3.6;
    const xsL = cx - half + stagger, xsR = cx + half - stagger;
    const d = Math.abs(yt - yb);
    const xL = xsL - d, xR = xsR + d;
    el('path', { d: `M 8 ${yt} H ${xL} L ${xsL} ${yb} H ${xsR} L ${xR} ${yt} H ${W - 8}`, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    const ticks = W > 600 ? [0.3, 0.62] : [0.45];
    ticks.forEach((f) => {
      [8 + (xL - 8) * f, W - 8 - (W - 8 - xR) * f].forEach((x) => el('rect', { x: x - 1.6, y: top ? yt - 7 : yt + 1, width: 3.2, height: 6, fill: color }, svg));
    });
    [8, W - 8].forEach((x) => el('circle', { cx: x, cy: yt, r: 5.2, fill: 'var(--card)', stroke: on ? 'var(--ink)' : off, 'stroke-width': 2.6 }, svg));
    if (labels) {
      const ty = top ? yt - 9 : yt + 17;
      const fill = on ? 'var(--ink-2)' : 'oklch(70% 0.01 266)';
      el('text', { x: 4, y: ty, 'font-size': 10, 'font-weight': 700, fill }, svg).textContent = pick(line.L);
      el('text', { x: W - 4, y: ty, 'font-size': 10, 'font-weight': 700, 'text-anchor': 'end', fill }, svg).textContent = pick(line.R);
    }
    if (names) {
      const g = el('g', {}, svg);
      const x = 8 + (xL - 8) * 0.55;
      const t = el('text', { x, y: yt + 4, 'font-size': 11.5, 'font-weight': 800, 'text-anchor': 'middle', fill: 'var(--ink)' }, g);
      t.textContent = `${lineName(line)}  ${line.n}`;
      const w = t.getComputedTextLength() + 18;
      g.insertBefore(el('rect', { x: x - w / 2, y: yt - 10, width: w, height: 20, rx: 10, fill: 'var(--card)', stroke: color, 'stroke-width': 2.4 }), t);
    }
  });
  if (hub) {
    const top = H / 2 - 3.5 * gap;
    el('rect', { x: cx - 8, y: top - 9, width: 16, height: 7 * gap + 18, rx: 8, fill: 'var(--card)', stroke: 'var(--ink)', 'stroke-width': 3.2 }, svg);
    const t1 = el('text', { x: cx, y: top - 30, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': css('--w-display'), 'font-stretch': '75%', fill: 'var(--ink)', 'font-family': "Fredoka, 'ZCOOL QingKe HuangYou', sans-serif" }, svg);
    t1.textContent = tr('唐人街', 'Chinatown');
    el('text', { x: cx, y: top - 16, 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: 'var(--muted)' }, svg).textContent = tr('换乘 · 130 家', 'hub · 130');
  }
}

function legend(ul) {
  const map = ul.dataset.legend === 'map';
  LINES.slice().sort((a, b) => b.n - a.n).forEach((line) => {
    const item = document.createElement(map ? 'span' : 'li');
    item.style.setProperty('--c', `var(${line.c})`);
    item.innerHTML = map ? `<i></i>${lineName(line)}<em>${line.n}</em>` : `<i></i>${lineName(line)}<span>${line.n}${tr(' 家', '')}</span>`;
    ul.appendChild(item);
  });
}

function plot(svg, prices, { dark }) {
  const vb = svg.viewBox.baseVal;
  const W = vb.width, H = vb.height;
  const min = 400, max = 1650, r = 3.4, base = H - 18;
  const x = (p) => 8 + ((p - min) / (max - min)) * (W - 16);
  const axis = dark ? 'oklch(42% 0.02 266)' : 'var(--rule)';
  const lab = dark ? 'oklch(70% 0.02 266)' : 'var(--muted)';
  el('line', { x1: 4, x2: W - 4, y1: base + 6, y2: base + 6, stroke: axis, 'stroke-width': 1.5 }, svg);
  [500, 1000, 1500].forEach((p) => {
    el('line', { x1: x(p), x2: x(p), y1: base + 3, y2: base + 9, stroke: axis, 'stroke-width': 1.5 }, svg);
    el('text', { x: x(p), y: H - 1, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600, fill: lab, 'font-family': 'Archivo' }, svg).textContent = `£${p / 100}`;
  });
  const med = 680;
  el('line', { x1: x(med), x2: x(med), y1: 4, y2: base + 6, stroke: dark ? 'var(--amber)' : 'var(--ink)', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, svg);
  el('text', { x: x(med) + 5, y: 10, 'font-size': 9.5, 'font-weight': 700, fill: dark ? 'var(--amber)' : 'var(--ink)' }, svg).textContent = tr('一半的店 ≤ £6.80', 'half ≤ £6.80');
  const cols = {};
  const pitch = r * 2 + 0.6;
  prices.forEach((p, i) => {
    const k = Math.round(x(p) / pitch);
    cols[k] = (cols[k] || 0) + 1;
    const cy = base - (cols[k] - 1) * pitch;
    const lowest = i === 0;
    el('circle', { cx: k * pitch, cy, r, fill: lowest ? (dark ? 'var(--amber)' : 'var(--l-dimsum)') : dark ? 'var(--warm)' : 'var(--ink)', opacity: lowest ? 1 : 0.9 }, svg);
  });
}

/* the guide's walk, as a stretch of line */
function strip(svg) {
  const vb = svg.viewBox.baseVal;
  const W = vb.width, y = 18;
  el('path', { d: `M 12 ${y} H ${W - 12}`, stroke: 'var(--l-noodle)', 'stroke-width': 7, 'stroke-linecap': 'round' }, svg);
  const stops = [['UCL', 'UCL'], ['Euston', 'Euston'], ['Russell Sq', 'Russell Sq'], ['唐人街', 'Chinatown']];
  stops.forEach((name, i) => {
    const sx = 12 + ((W - 24) * [0, 0.28, 0.57, 1][i]);
    const end = i === 0 || i === stops.length - 1;
    el('circle', { cx: sx, cy: y, r: end ? 7.5 : 5.5, fill: 'var(--card)', stroke: 'var(--ink)', 'stroke-width': end ? 3.4 : 2.6 }, svg);
    el('text', { x: sx, y: y + 26, 'text-anchor': i === 0 ? 'start' : end ? 'end' : 'middle', 'font-size': 11, 'font-weight': 700, fill: 'var(--ink)' }, svg).textContent = pick(name);
  });
}

/* ───── London ───── */

const THAMES = [[51.46, -0.42], [51.455, -0.33], [51.487, -0.287], [51.471, -0.266], [51.472, -0.243], [51.488, -0.229], [51.467, -0.212], [51.459, -0.19], [51.479, -0.17], [51.484, -0.15], [51.487, -0.127], [51.501, -0.122], [51.508, -0.117], [51.509, -0.103], [51.507, -0.087], [51.505, -0.075], [51.502, -0.05], [51.508, -0.035], [51.502, -0.025], [51.49, -0.02], [51.485, -0.005], [51.495, 0.005], [51.505, 0.004], [51.507, 0.01], [51.5, 0.03], [51.497, 0.06], [51.505, 0.09], [51.5, 0.12], [51.49, 0.2]];
/* a few streets of the West End and Bloomsbury, drawn schematically for the close-up maps */
const STREETS = [
  [[51.5233, -0.147], [51.5246, -0.1384], [51.5262, -0.134], [51.5283, -0.129], [51.5302, -0.124]],
  [[51.5246, -0.1384], [51.5165, -0.131]],
  [[51.515, -0.155], [51.5152, -0.1419], [51.5165, -0.131], [51.517, -0.127], [51.5175, -0.12], [51.518, -0.11]],
  [[51.5165, -0.131], [51.51, -0.1275], [51.508, -0.1265]],
  [[51.51, -0.1342], [51.5133, -0.129], [51.5165, -0.1255]],
  [[51.5174, -0.12], [51.5215, -0.1235], [51.5265, -0.129]],
  [[51.51, -0.1342], [51.5152, -0.1419], [51.5185, -0.144]],
  [[51.508, -0.1265], [51.511, -0.118], [51.513, -0.11]],
  [[51.5175, -0.12], [51.5125, -0.118]],
  [[51.5255, -0.135], [51.519, -0.131]],
  [[51.5294, -0.1395], [51.5294, -0.1265]],
];
const PARKS = [[51.5215, -0.1262, 110], [51.5153, -0.1323, 55], [51.5188, -0.1302, 50], [51.5225, -0.1305, 45]];

const MAPS = {
  light: { bbox: [51.34, 51.66, -0.42, 0.2], fit: 'contain', dark: true, dots: 'mono', lit: true },
  desk: { bbox: [51.43, 51.585, -0.33, 0.07], fit: 'cover', dots: 'line', markers: 'campus' },
  dish: { bbox: [51.4, 51.62, -0.36, 0.12], fit: 'contain', dots: 'faint', highlight: 'xlb', markers: 'xlb' },
  place: { bbox: [51.5165, 51.5265, -0.1365, -0.1125], fit: 'cover', dots: 'line', streets: true, markers: 'mw', big: true },
  route: { bbox: [51.5095, 51.5315, -0.143, -0.115], fit: 'contain', dots: 'faint', streets: true, route: true, markers: 'route', big: true },
};

const ROUTE = [[51.5246, -0.134], [51.529378, -0.13278], [51.521186, -0.122694], [51.51287, -0.131251], [51.511919, -0.129748], [51.511965, -0.12976]];

const MARKERS = {
  campus: [
    { la: 51.5246, lo: -0.134, cls: 'uni', t: ['UCL', 'UCL'], s: ['38 家', '38'], tx: '-20% -150%' },
    { la: 51.4988, lo: -0.1749, cls: 'uni', t: ['Imperial', 'Imperial'], s: ['15 家', '15'], tx: '-90% 40%' },
    { la: 51.5241, lo: -0.0404, cls: 'uni', t: ['QMUL', 'QMUL'], s: ['14 家', '14'] },
    { la: 51.5115, lo: -0.131, cls: 'uni hub', t: ['唐人街', 'Chinatown'], s: ['130 家', '130'], tx: '-108% 30%' },
  ],
  xlb: [
    { la: 51.511919, lo: -0.129748, cls: 'price', t: ['£4.80', '£4.80'], s: ['最便宜 · 唐人街', 'cheapest · Chinatown'], tx: '-60% -125%' },
    { la: 51.505, lo: -0.088229, cls: 'price', t: ['£16.00', '£16.00'], s: ['最贵 · 伦敦桥', 'priciest · London Bridge'], tx: '6% 10%' },
    { la: 51.519135, lo: -0.179728, cls: 'price', t: ['£5.50', '£5.50'], s: ['Bayswater', 'Bayswater'], tx: '-100% 25%' },
    { la: 51.450413, lo: 0.053243, cls: 'price', t: ['£5.00', '£5.00'], s: ['Eltham', 'Eltham'], tx: '-50% 30%' },
  ],
  mw: [
    { la: 51.521186, lo: -0.122694, cls: 'here', t: ['Master Wei', 'Master Wei'], s: ['西安小吃', '西安小吃'] },
    { la: 51.523, lo: -0.1244, cls: 'station', t: ['Russell Square 站', 'Russell Square'], tx: '-50% -170%' },
    { la: 51.5222, lo: -0.129, cls: 'uni', t: ['SOAS', 'SOAS'], s: ['7 分钟', '7 min'] },
    { la: 51.5246, lo: -0.134, cls: 'uni', t: ['UCL', 'UCL'], s: ['11 分钟', '11 min'] },
    { la: 51.519668, lo: -0.121646, cls: 'near', t: ['川扬楼', 'Chuan Young'], c: '--l-spicy', tx: '-10% 30%' },
    { la: 51.524152, lo: -0.123148, cls: 'near', t: ['珍煮丹', 'Truedan'], c: '--l-boba', tx: '-50% -150%' },
    { la: 51.518666, lo: -0.124801, cls: 'near', t: ['包记', 'Bao Spot'], c: '--l-dimsum', tx: '-100% 20%' },
  ],
  route: [
    { la: 51.5246, lo: -0.134, cls: 'uni', t: ['UCL', 'UCL'], s: ['出发', 'start'] },
    { la: 51.529378, lo: -0.13278, cls: 'stop', t: ['1', '1'], n: ['韩记', 'Murger Han'] },
    { la: 51.521186, lo: -0.122694, cls: 'stop', t: ['2', '2'], n: ['Master Wei', 'Master Wei'] },
    { la: 51.51287, lo: -0.131251, cls: 'stop', t: ['3', '3'], n: ['Q Beef', 'Q Beef'], tx: '-50% -90%' },
    { la: 51.511919, lo: -0.129748, cls: 'stop', t: ['4', '4'], n: ['A Bowl of Noodles', 'A Bowl of Noodles'], tx: '-20% -10%' },
    { la: 51.511965, lo: -0.12976, cls: 'stop', t: ['5', '5'], n: ['Chinatown Bakery', 'Chinatown Bakery'], tx: '-20% 90%' },
  ],
};

function london(canvas, opt) {
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.round(box.width * 2);
  canvas.height = Math.round(box.height * 2);
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const [minLa, maxLa, minLo, maxLo] = opt.bbox;
  const k = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180);
  const sx = W / ((maxLo - minLo) * k), sy = H / (maxLa - minLa);
  const s = opt.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const ox = (W - (maxLo - minLo) * k * s) / 2, oy = (H - (maxLa - minLa) * s) / 2;
  const P = (la, lo) => [ox + (lo - minLo) * k * s, oy + (maxLa - la) * s];
  const metres = s / 111320;
  const line = (pts) => { ctx.beginPath(); pts.forEach(([la, lo], i) => { const [x, y] = P(la, lo); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  if (opt.streets) {
    ctx.fillStyle = 'oklch(92% 0.05 145)';
    PARKS.forEach(([la, lo, m]) => { const [x, y] = P(la, lo); const r = m * metres; ctx.beginPath(); ctx.roundRect(x - r, y - r * 0.8, r * 2, r * 1.6, 8); ctx.fill(); });
    ctx.strokeStyle = 'oklch(89% 0.012 84)'; ctx.lineWidth = 22; STREETS.forEach(line);
    ctx.strokeStyle = 'oklch(99% 0.004 85)'; ctx.lineWidth = 15; STREETS.forEach(line);
  }
  ctx.lineWidth = opt.dark ? 10 : opt.big ? 60 : 14;
  ctx.strokeStyle = opt.dark ? 'oklch(24% 0.025 250)' : 'oklch(92% 0.03 230)';
  line(THAMES);

  if (opt.route) {
    ctx.strokeStyle = css('--ink'); ctx.lineWidth = 20; line(ROUTE);
    ctx.strokeStyle = css('--l-noodle'); ctx.lineWidth = 12; line(ROUTE);
  }

  const colors = DOT_LINE.map(css);
  DOTS.forEach(([la, lo, li]) => {
    const [x, y] = P(la, lo);
    if (x < -10 || y < -10 || x > W + 10 || y > H + 10) return;
    if (opt.dots === 'mono') { ctx.fillStyle = 'oklch(58% 0.03 266)'; ctx.globalAlpha = 0.9; }
    else if (opt.dots === 'faint') { ctx.fillStyle = 'oklch(80% 0.012 266)'; ctx.globalAlpha = 1; }
    else { ctx.fillStyle = colors[li]; ctx.globalAlpha = 0.85; }
    const r = opt.big ? (opt.dots === 'faint' ? 4 : 9) : opt.dots === 'mono' ? 2.9 : opt.dots === 'faint' ? 2.6 : 4.2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (opt.big && opt.dots === 'line') { ctx.globalAlpha = 1; ctx.strokeStyle = css('--card'); ctx.lineWidth = 3; ctx.stroke(); }
  });
  ctx.globalAlpha = 1;
  if (opt.highlight === 'xlb') {
    XLB_PTS.forEach(([la, lo]) => {
      const [x, y] = P(la, lo);
      ctx.fillStyle = css('--l-dimsum'); ctx.strokeStyle = css('--card'); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }
  if (opt.lit) {
    DOTS.filter((d) => d[3]).forEach(([la, lo]) => {
      const [x, y] = P(la, lo);
      [22, 14].forEach((r, i) => { ctx.fillStyle = i ? 'oklch(83% 0.155 78 / 0.35)' : 'oklch(83% 0.155 78 / 0.16)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = css('--amber'); ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    });
  }

  // markers are HTML, laid over the canvas
  const host = canvas.parentElement;
  host.querySelectorAll('.mk').forEach((m) => m.remove());
  (MARKERS[opt.markers] || []).forEach((m) => {
    const [x, y] = P(m.la, m.lo);
    const tag = document.createElement('span');
    tag.className = `mk ${m.cls}`;
    if (m.c) tag.style.setProperty('--c', `var(${m.c})`);
    if (m.cls === 'stop') tag.innerHTML = `<b>${pick(m.t)}</b><span>${pick(m.n)}</span>`;
    else tag.innerHTML = `${pick(m.t)}${m.s ? `<small>${pick(m.s)}</small>` : ''}`;
    tag.style.left = `${canvas.offsetLeft + x / 2}px`;
    tag.style.top = `${canvas.offsetTop + y / 2}px`;
    if (m.tx) tag.style.translate = m.tx;
    host.appendChild(tag);
  });
}

function placePins() {
  document.querySelectorAll('.phone-wrap, .frame-wrap').forEach((wrap) => {
    wrap.querySelectorAll(':scope > .pin').forEach((p) => p.remove());
    const top0 = wrap.getBoundingClientRect().top;
    const pins = [...wrap.querySelectorAll('[data-pin]')]
      .filter((node) => node.getClientRects().length)
      .map((node) => ({ n: node.dataset.pin, top: node.getBoundingClientRect().top - top0 + 6 }))
      .sort((a, b) => a.top - b.top || a.n - b.n);
    // pins whose targets share a line stack downwards instead of covering each other
    pins.forEach((p, i) => { if (i && p.top < pins[i - 1].top + 30) p.top = pins[i - 1].top + 30; });
    pins.forEach(({ n, top }) => {
      const pin = document.createElement('span');
      pin.className = 'pin';
      pin.textContent = n;
      pin.style.top = `${top}px`;
      wrap.appendChild(pin);
    });
  });
}

function render() {
  const each = (selector, draw) => document.querySelectorAll(selector).forEach((node) => { drawing = langOf(node); draw(node); });
  each('svg[data-tube]', (svg) => {
    svg.replaceChildren();
    drawTube(svg, { lit: svg.dataset.lit ? svg.dataset.lit.split(',') : null, labels: svg.dataset.labels !== 'off', names: 'names' in svg.dataset });
  });
  each('[data-legend]', (ul) => { ul.replaceChildren(); legend(ul); });
  each('svg[data-plot]', (svg) => { svg.replaceChildren(); plot(svg, XLB, { dark: 'dark' in svg.dataset }); });
  each('svg[data-strip]', (svg) => { svg.replaceChildren(); strip(svg); });
  // a canvas in a hidden view has no size yet: it is drawn when its view is shown
  each('canvas[data-london]', (c) => { if (c.getClientRects().length) london(c, MAPS[c.dataset.london]); });
  placePins();
}

/* the desktop view's language switch: every [data-en] keeps its Chinese and swaps to English */
function setLang(next) {
  const scope = document.querySelector('[data-view="desktop"]');
  if (!scope) return;
  scope.dataset.lang = next;
  scope.querySelectorAll('[data-en]').forEach((node) => {
    if (!('zh' in node.dataset)) node.dataset.zh = node.innerHTML;
    node.innerHTML = next === 'en' ? node.dataset.en : node.dataset.zh;
  });
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.classList.toggle('on', b.dataset.setLang === next));
  render();
}

/* the three views live in one file, so switching never leaves the page */
function showView(name) {
  const views = [...document.querySelectorAll('.view')];
  if (!views.some((v) => v.dataset.view === name)) return;
  views.forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('[data-show-view]').forEach((b) => b.classList.toggle('on', b.dataset.showView === name));
  document.querySelector('.switcher')?.classList.toggle('desk', name === 'desktop');
  window.scrollTo(0, 0);
  render();
}

document.querySelectorAll('[data-show-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.showView)));
document.querySelectorAll('[data-set-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.setLang)));
document.querySelectorAll('[data-toggle-lang]').forEach((b) => b.addEventListener('click', () => setLang(langOf(b) === 'en' ? 'zh' : 'en')));

document.fonts.ready.then(() => { showView(location.hash.slice(1) || 'mobile-zh'); setTimeout(placePins, 600); });
window.addEventListener('load', placePins);
window.addEventListener('resize', render);
