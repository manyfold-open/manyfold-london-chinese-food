import { describe, expect, it } from 'vitest';
import { normalizeQuote, quoteOnPage } from '../src/shared/quote';

describe('finding a quote on its page', () => {
  it('reads entities, named and numbered, as the text they stand for', () => {
    const page = '<p>Tom&rsquo;s char siu &ndash; &pound;12.80 a plate &hellip; caf&eacute; &amp; bakery, &#8220;worth it&#8221;, &#x4E2D;&#x9910;</p>';
    expect(quoteOnPage(page, "Tom's char siu - £12.80 a plate... café & bakery, \"worth it\", 中餐")).toBe(true);
    expect(quoteOnPage(page, 'Tom’s char siu – £12.80 a plate … café & bakery')).toBe(true);
  });

  it('ignores characters a page cannot show: zero-width spaces, soft hyphens', () => {
    const page = '<p>The xiao long bao are made to or\u200Bder, the broth scal\u00ADding.</p>';
    expect(quoteOnPage(page, 'The xiao long bao are made to order, the broth scalding.')).toBe(true);
  });

  it('ignores markup, spacing and line breaks, and the spaces pages put between Chinese characters', () => {
    const page = '<div><p>Hand-pulled\n   <b>noodles</b>,\n<i>wide</i> as a belt.</p><p>油泼面 很 香，\n辣子 味道 正宗。</p></div>';
    expect(quoteOnPage(page, 'Hand-pulled noodles, wide as a belt.')).toBe(true);
    expect(quoteOnPage(page, '油泼面很香，辣子味道正宗。')).toBe(true);
  });

  it('finds text a page ships inside its JSON, but not text in its scripts alone when it differs', () => {
    expect(quoteOnPage('<script>window.__DATA__ = {"body":"The duck skin shatters\\u2014then melts."}</script>', 'The duck skin shatters—then melts.')).toBe(true);
    expect(quoteOnPage('<p>The duck skin shatters.</p>', 'The duck skin shatters, then melts.')).toBe(false);
  });

  it('never matches an empty quote', () => {
    expect(quoteOnPage('<p>anything</p>', '   ')).toBe(false);
    expect(normalizeQuote('&unknown; stays')).toBe('&unknown; stays');
  });
});
