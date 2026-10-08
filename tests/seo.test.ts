import { describe, expect, it } from 'vitest';
import type { PlaceDoc } from '../src/shared/place-doc';
import { pathMeta, placeMeta, preferredLocale, sitemap } from '../src/worker/seo';

const doc = {
  id: 'rec_01k70q4mgw8b1r7f3s5t9v2x4y',
  slug: 'example-noodle-house',
  status: 'verified',
  place: { name_en: 'Example Noodle House', name_zh: '示例面馆', category: 'restaurant', cuisines: ['shaanxi'], address: '12 Example Street', postcode: 'W1D 6JW', borough_code: 'E09000033', lat: 51.51, lng: -0.13, trading: 'open' },
  brand: null,
  source: { url: 'https://example.com', quote: 'q', observed_at: '2026-10-01T00:00:00Z', verified_at: null },
  menus: [{ id: 'm', owner: 'place', menu: 'main', title: null, source_kind: 'website', source_url: 'https://example.com/menu', quote: 'q', observed_at: '2026-10-01T00:00:00Z', verified_at: null, stale: false, sections: [{ name: null, items: [{ key: 'k', dish: '油泼面', name_zh: '油泼面', name_en: 'Biang biang noodles', photo: null, mentions: [] }] }] }],
  reviews: [],
  mentioned: [],
  photos: [],
  pending: {},
  history: [],
  updated_at: '2026-10-01T00:00:00Z',
} as unknown as PlaceDoc;

describe('page meta', () => {
  it('describes a place in the page language, with its address, cuisine and dishes, and no rating', () => {
    const meta = placeMeta(doc, 'zh', '/place/x/example-noodle-house', 'https://site/zh/place/x');
    expect(meta.title).toBe('示例面馆 Example Noodle House · 餐厅 · 威斯敏斯特 · 伦敦中餐');
    expect(meta.description).toContain('12 Example Street, W1D 6JW.');
    expect(meta.description).toContain('菜单有油泼面');
    expect(meta.description).toContain('没有评分');
    const english = placeMeta(doc, 'en', '/place/x', 'https://site/en/place/x');
    expect(english.title).toBe('Example Noodle House (示例面馆) — Restaurant in Westminster · London Chinese Food');
  });

  it('gives a place structured data with no rating at all', () => {
    const meta = placeMeta(doc, 'en', '/place/x', 'https://site/en/place/x');
    expect(meta.jsonLd).toMatchObject({ '@type': 'Restaurant', name: 'Example Noodle House', alternateName: '示例面馆', servesCuisine: ["Shaanxi (Xi'an)"], hasMenu: 'https://site/en/place/x' });
    expect(JSON.stringify(meta.jsonLd)).not.toMatch(/rating|review/i);
  });

  it('answers 404 for a place that is not public and a page that does not exist', () => {
    expect(placeMeta(null, 'en', '/place/x', '').status).toBe(404);
    expect(pathMeta('en', '/nowhere').status).toBe(404);
    expect(pathMeta('zh', '/dish/%E6%B2%B9%E6%B3%BC%E9%9D%A2').title).toBe('伦敦哪里吃得到油泼面 · 伦敦中餐');
  });

  it('picks the language: an earlier choice, then the browser, then Chinese', () => {
    expect(preferredLocale('a=1; lcf_locale=en', 'zh-CN')).toBe('en');
    expect(preferredLocale(null, 'en-GB,en;q=0.9')).toBe('en');
    expect(preferredLocale(null, 'fr-FR')).toBe('zh');
  });

  it('lists both languages of every place and dish in the sitemap', () => {
    const xml = sitemap('https://site', [{ id: 'rec_x', s: 'slug', u: '2026-10-01T00:00:00Z' } as never], [['油泼面', '油泼面', null, 3]]);
    expect(xml).toContain('<loc>https://site/zh/place/rec_x/slug</loc><lastmod>2026-10-01</lastmod>');
    expect(xml).toContain('<loc>https://site/en/dish/%E6%B2%B9%E6%B3%BC%E9%9D%A2</loc>');
  });
});
