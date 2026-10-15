/**
 * A page as an image to share: a 3:4 card (the shape Xiaohongshu and WeChat Moments show whole)
 * drawn on a canvas in the browser, with the page's address and a QR code to it. Only public facts
 * go on it, the same ones the page shows. Phones that can share files get the share sheet; others
 * download the image.
 */

import { appUrl } from './base';

export interface ShareCard {
  kicker: string;
  title: string;
  lead: string;
  /** Lines of the body: a label and, on the right, a value such as a price. */
  rows: { label: string; value?: string }[];
  /** The line whose colour the cover wears (kinds/vocab.ts, LINES). */
  line: string;
  site: string;
  /** The page's own path in the app, e.g. /zh/guide/full-for-a-tenner/ucl. */
  path: string;
}

const W = 1080;
const H = 1440;
const PAD = 84;
const DISPLAY = "'Fredoka', 'ZCOOL QingKe HuangYou', 'PingFang SC', sans-serif";
const BODY = "'Inter', 'PingFang SC', 'Noto Sans SC', sans-serif";

/**
 * The light theme's colours, whatever the page's, so a card is the same image from every phone.
 * Read from an element the stylesheet gives the light tokens (.theme-light): they stay in one place.
 */
function lightColors(line: string) {
  const probe = document.createElement('div');
  probe.className = 'theme-light';
  probe.hidden = true;
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const colors = {
    paper: read('--bg'),
    ink: read('--ink'),
    muted: read('--muted'),
    value: read('--accent-ink'),
    rule: read('--line'),
    cover: read(`--line-${line}`),
    onCover: read(`--on-line-${line}`),
  };
  probe.remove();
  return colors;
}

/** Lines of `text` no wider than `width`, broken between words or, in Chinese, between characters. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const tokens = text.match(/[⺀-鿿＀-￯]|[^\s⺀-鿿＀-￯]+|\s+/g) ?? [];
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const next = line + token;
    if (ctx.measureText(next.trimEnd()).width > width && line.trim()) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else line = next;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

async function qrPath(url: string): Promise<{ size: number; dark: (row: number, col: number) => boolean }> {
  const qrcode = (await import('qrcode-generator')).default;
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  return { size: code.getModuleCount(), dark: (row, col) => code.isDark(row, col) };
}

export async function drawShareCard(card: ShareCard): Promise<Blob> {
  const url = new URL(appUrl(card.path), location.href).href;
  await Promise.all([document.fonts.load(`600 72px ${DISPLAY}`, card.title), document.fonts.load(`400 30px ${BODY}`, card.lead)]).catch(() => undefined);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  const { paper, ink, muted, value, rule, cover, onCover } = lightColors(card.line);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);

  // The cover: the kicker, the title, the lead.
  ctx.font = `600 84px ${DISPLAY}`;
  ctx.fontStretch = 'condensed';
  const titleLines = wrap(ctx, card.title, W - PAD * 2);
  ctx.font = `400 30px ${BODY}`;
  const leadLines = wrap(ctx, card.lead, W - PAD * 2).slice(0, 4);
  const coverH = 120 + titleLines.length * 92 + 24 + leadLines.length * 44 + 56;
  ctx.fillStyle = cover;
  ctx.fillRect(0, 0, W, coverH);
  ctx.fillStyle = onCover;
  ctx.font = `700 26px ${BODY}`;
  ctx.fillText(card.kicker.toUpperCase(), PAD, 96);
  ctx.font = `600 84px ${DISPLAY}`;
  titleLines.forEach((line, i) => ctx.fillText(line, PAD, 200 + i * 92));
  ctx.font = `400 30px ${BODY}`;
  let y = 200 + (titleLines.length - 1) * 92 + 64;
  leadLines.forEach((line, i) => ctx.fillText(line, PAD, y + i * 44));

  // The rows, as long as there is room above the foot.
  y = coverH + 70;
  const foot = H - 230;
  for (const row of card.rows) {
    if (y > foot - 60) break;
    ctx.fillStyle = ink;
    ctx.font = `500 34px ${BODY}`;
    const valueWidth = row.value ? (ctx.font = `700 36px ${BODY}`, ctx.measureText(row.value).width) : 0;
    ctx.font = `500 34px ${BODY}`;
    const label = wrap(ctx, row.label, W - PAD * 2 - valueWidth - 30)[0] ?? '';
    ctx.fillText(label, PAD, y);
    if (row.value) {
      ctx.font = `700 36px ${BODY}`;
      ctx.fillStyle = value;
      ctx.fillText(row.value, W - PAD - valueWidth, y);
    }
    ctx.strokeStyle = rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y + 26);
    ctx.lineTo(W - PAD, y + 26);
    ctx.stroke();
    y += 76;
  }

  // The foot: the site, the address, a QR code to the page.
  ctx.fillStyle = ink;
  ctx.fillRect(PAD, H - 200, W - PAD * 2, 3);
  ctx.font = `600 44px ${DISPLAY}`;
  ctx.fillText(card.site, PAD, H - 128);
  ctx.font = `400 24px ${BODY}`;
  ctx.fillStyle = muted;
  const shown = url.replace(/^https?:\/\//, '');
  wrap(ctx, shown, W - PAD * 2 - 200).slice(0, 2).forEach((line, i) => ctx.fillText(line, PAD, H - 84 + i * 32));
  const qr = await qrPath(url);
  const cell = Math.floor(150 / qr.size);
  const qrSize = cell * qr.size;
  const qx = W - PAD - qrSize;
  const qy = H - 176;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qx - 8, qy - 8, qrSize + 16, qrSize + 16);
  ctx.fillStyle = ink;
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) if (qr.dark(row, col)) ctx.fillRect(qx + col * cell, qy + row * cell, cell, cell);
  }

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no image'))), 'image/png'));
}

/** Shares the card where the phone can share files; downloads it everywhere else. */
export async function shareCard(card: ShareCard, filename: string): Promise<'shared' | 'saved'> {
  const blob = await drawShareCard(card);
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: card.title });
      return 'shared';
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'shared';
    }
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return 'saved';
}
