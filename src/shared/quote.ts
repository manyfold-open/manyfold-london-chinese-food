/**
 * Is a quote on a page? Used when an agent submits (a hint for the maintainer, never a refusal:
 * many pages need a browser) and by scripts/verify-quotes.ts before seed records are loaded.
 * Copying text across tools changes entities, quotes, dashes and spacing; all of those are made
 * uniform on both sides before comparing. CJK text is compared without its spaces, which pages
 * break unpredictably.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Lowercase text with entities decoded and quotes, dashes, widths and whitespace made uniform. */
export function normalizeQuote(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?)])/g, '$1')
    .replace(/(?<=[\p{Script=Han}，。！？、；：]) (?=[\p{Script=Han}，。！？、；：])/gu, '')
    .trim()
    .toLowerCase();
}

/** Visible text of a page: scripts and styles dropped, tags turned into spaces. */
export const visibleText = (html: string): string =>
  html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');

/** The raw page with JSON string escapes undone, for pages that ship their text inside JSON. */
export const unescapedHtml = (html: string): string =>
  html
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/<[^>]+>/g, ' ');

/** Whether `quote` appears on the page `html`, in its visible text or inside its embedded JSON. */
export function quoteOnPage(html: string, quote: string): boolean {
  const wanted = normalizeQuote(quote);
  if (!wanted) return false;
  return normalizeQuote(visibleText(html)).includes(wanted) || normalizeQuote(unescapedHtml(html)).includes(wanted);
}
