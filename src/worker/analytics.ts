/**
 * Google Analytics 4, on the public host only. The Worker writes into a reader page what the app
 * needs to measure it (src/app/analytics.ts): the property, and whether this reader must be asked
 * first. Nothing of Google's is in the page itself: the app loads Google's tag, and only once it
 * may (AGENTS.md, invariant 28).
 *
 * Asked first: readers in the UK, the EEA and Switzerland, where analytics cookies need consent.
 * There the tag loads only after "Accept", so a reader who never answers sends Google nothing.
 * Elsewhere it loads at once, and /privacy turns it off. A reader whose country Cloudflare does
 * not know is asked.
 */

/** Where a reader is asked before anything is measured: the EU 27, Iceland, Liechtenstein, Norway, the UK and Switzerland. */
export const CONSENT_REGIONS: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
]);

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,24}$/;

/** The property this deployment reports to; null when unset or not a GA4 id, and nothing is measured. */
export const measurementIdFor = (env: { GA_MEASUREMENT_ID?: string }): string | null => {
  const id = env.GA_MEASUREMENT_ID?.trim().toUpperCase() ?? '';
  return MEASUREMENT_ID.test(id) ? id : null;
};

/** Whether a reader from this country (Cloudflare's code; XX unknown, T1 Tor) is asked first. */
export const consentRequiredFor = (country: unknown): boolean =>
  typeof country !== 'string' || !/^[A-Z]{2}$/.test(country) || country === 'XX' || CONSENT_REGIONS.has(country);

/** What the app reads: the property, and data-ask="1" where the reader is asked first. */
export const analyticsMeta = (id: string, ask: boolean): string => `<meta name="lcf-analytics" content="${id}" data-ask="${ask ? '1' : '0'}">`;

/** A reader page with its analytics meta, when the page is measured (`id` set). */
export function withAnalytics(response: Response, id: string | null, ask: boolean): Response {
  // HTMLRewriter exists only in workerd; under Node (tests) the decisions above are tested alone.
  if (!id || typeof HTMLRewriter === 'undefined') return response;
  return new HTMLRewriter().on('head', { element: (element) => void element.append(analyticsMeta(id, ask), { html: true }) }).transform(response);
}
