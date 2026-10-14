import { describe, expect, it } from 'vitest';
import { analyticsMeta, consentRequiredFor, measurementIdFor, withAnalytics } from '../src/worker/analytics';
import { PAGE_CSP } from '../src/worker/seo';

describe('analytics', () => {
  it('measures only with a GA4 measurement id', () => {
    expect(measurementIdFor({ GA_MEASUREMENT_ID: ' g-k4my5b6brx ' })).toBe('G-K4MY5B6BRX');
    expect(measurementIdFor({})).toBeNull();
    expect(measurementIdFor({ GA_MEASUREMENT_ID: 'UA-1234-1' })).toBeNull();
    expect(measurementIdFor({ GA_MEASUREMENT_ID: 'G-X"><script>' })).toBeNull();
  });

  it('asks readers in the UK, the EEA and Switzerland first, and any reader whose country is unknown', () => {
    for (const country of ['GB', 'FR', 'NO', 'CH']) expect(consentRequiredFor(country), country).toBe(true);
    for (const country of [undefined, null, '', 'XX', 'T1', 'gb']) expect(consentRequiredFor(country), String(country)).toBe(true);
    for (const country of ['US', 'CN', 'HK']) expect(consentRequiredFor(country), country).toBe(false);
  });

  it('tells the app the property and whether to ask, and leaves an unmeasured page alone', () => {
    expect(analyticsMeta('G-K4MY5B6BRX', true)).toBe('<meta name="lcf-analytics" content="G-K4MY5B6BRX" data-ask="1">');
    expect(analyticsMeta('G-K4MY5B6BRX', false)).toContain('data-ask="0"');
    const page = new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } });
    expect(withAnalytics(page, null, true)).toBe(page);
  });

  it('lets the pages load Google’s tag and send it hits, and nothing inline', () => {
    const directives = Object.fromEntries(PAGE_CSP.split('; ').map((directive) => [directive.split(' ')[0], directive]));
    expect(directives['script-src']).toContain('https://*.googletagmanager.com');
    expect(directives['script-src']).not.toContain('unsafe-inline');
    expect(directives['connect-src']).toContain('https://*.google-analytics.com');
    expect(directives['connect-src']).toContain('https://*.analytics.google.com');
  });
});
