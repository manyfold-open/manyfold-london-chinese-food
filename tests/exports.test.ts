import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvCell } from '../src/worker/exports';
import { join, menu, place, review, submit, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const decide = (w: World, id: string, status: string) => w.call(`/api/admin/records/${id}/decide`, { method: 'POST', admin: true, json: { status } });
const cron = (w: World) => w.json('/api/admin/maintenance', { method: 'POST', admin: true });

const EXCERPT = 'The biang biang noodles were wide as a belt and slick with chilli oil; we came back the next week.';

/** A brand with a menu and two branches, and a place of its own with a menu and a review, all public. */
async function publicData(w: World) {
  const token = await join(w);
  const { results } = await submit(w, token, [
    { kind: 'brand', data: { name_en: 'Example Tea', name_zh: '示例茶饮', website: 'https://example.com/', category: 'tea-drinks' }, source_url: 'https://example.com/about', evidence: 'Example Tea has shops all over London.', observed_at: new Date(Date.now() - 60_000).toISOString() },
    place({ name_en: 'Example Tea Soho', name_zh: null, category: 'tea-drinks', cuisines: ['bubble-tea'], brand: '#0', postcode: 'W1D 5PG', address: '3 Example Street' }),
    place({ name_en: 'Example Tea Islington', name_zh: null, category: 'tea-drinks', cuisines: ['bubble-tea'], brand: '#0', postcode: 'N7 8AB', address: '9 Example Road' }),
    menu('#0', [{ name_en: 'Brown sugar boba milk', price_pence: 550 }], { menu: 'drinks' }),
    place({ phone: '+44 20 7946 0000', website: 'https://example.com/' }),
    review('#4'),
    menu('#4', [
      { section: '面 Noodles', name_zh: '油泼面', name_en: 'Biang biang noodles', price_pence: 1280, canonical: '油泼面', spicy: 2 },
      { section: '小吃 Snacks', name_en: 'Cucumber salad', price_pence: 500, dietary: ['vegan'] },
    ]),
  ]);
  for (const result of results) expect(result.status).toBe('accepted');
  for (const result of results) await decide(w, result.id!, 'verified');
  await cron(w);
  const [brand, soho, islington, brandMenu, own, , ownMenu] = results.map((result) => result.id!);
  return { brand: brand!, soho: soho!, islington: islington!, brandMenu: brandMenu!, own: own!, ownMenu: ownMenu! };
}

const gunzipLines = async (response: Response) =>
  (await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('the open data', () => {
  it('lists every public place as CSV a spreadsheet opens, without review excerpts', async () => {
    const w = world();
    const ids = await publicData(w);
    const response = await w.call('/export/places.csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="london-chinese-food-places.csv"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // a byte-order mark
    const text = new TextDecoder().decode(bytes);
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,name_en,name_zh,category,cuisines,address,postcode,borough,borough_code,outcode,lat,lng,website,phone,trading,opened_on,closed_on,brand_id,brand_name_en,brand_name_zh,status,source_url,observed_at,verified_at,page_url',
    );
    expect(lines).toHaveLength(4);
    const own = lines.find((line) => line.startsWith(ids.own))!;
    expect(own).toContain(',Example Noodle House,示例面馆,restaurant,shaanxi,12 Example Street,W1D 6JW,Westminster,E09000033,W1D,');
    expect(own).toContain(`,'+44 20 7946 0000,open,`);
    expect(own).toContain(`,https://lcf.test/en/place/${ids.own}/example-noodle-house`);
    expect(lines.find((line) => line.startsWith(ids.soho))).toContain(`,${ids.brand},Example Tea,示例茶饮,verified,`);
    expect(text).not.toContain('biang biang noodles were wide');
  });

  it('lists the same places as JSON, with the license and the attribution', async () => {
    const w = world();
    const ids = await publicData(w);
    const response = await w.call('/export/places.json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const text = await response.text();
    const body = JSON.parse(text) as { license: string; attribution: string; source: string; places: Record<string, unknown>[] };
    expect(body.license).toMatch(/^CC BY 4\.0/);
    expect(body.attribution).toContain('Open Government Licence');
    expect(body.source).toBe('https://lcf.test');
    expect(body.places.map((entry) => entry.id).sort()).toEqual([ids.soho, ids.islington, ids.own].sort());
    expect(body.places.find((entry) => entry.id === ids.own)).toMatchObject({ cuisines: ['shaanxi'], lat: 51.5115, lng: -0.1316, brand_id: null, trading: 'open' });
    expect(text).not.toContain(EXCERPT.slice(0, 30));
    expect(text).not.toMatch(/"(rating|score|stars|excerpt|evidence)"/);
  });

  it("writes each menu once, a brand's for all its branches, gzipped", async () => {
    const w = world();
    const ids = await publicData(w);
    const response = await w.call('/export/menus.jsonl.gz');
    expect(response.headers.get('content-type')).toBe('application/gzip');
    const [head, ...menus] = await gunzipLines(response);
    expect(head).toMatchObject({ name: 'London Chinese Food: menus', license: expect.stringMatching(/^CC BY 4\.0/) });
    expect(menus.map((entry) => entry.id).sort()).toEqual([ids.brandMenu, ids.ownMenu].sort());
    expect(menus.find((entry) => entry.id === ids.brandMenu)).toMatchObject({ owner: { kind: 'brand', id: ids.brand }, menu: 'drinks' });
    expect(menus.find((entry) => entry.id === ids.ownMenu)).toMatchObject({
      owner: { kind: 'place', id: ids.own },
      items: [
        { section: '面 Noodles', name_zh: '油泼面', name_en: 'Biang biang noodles', price_pence: 1280, dish: '油泼面', spicy: 2, dietary: [] },
        { section: '小吃 Snacks', name_zh: null, name_en: 'Cucumber salad', price_pence: 500, dietary: ['vegan'] },
      ],
    });
  });

  it('reads the stored pages a hundred at a time, every one once', async () => {
    const w = world();
    const statements = Array.from({ length: 230 }, (_, index) => {
      const id = `rec_${String(index).padStart(26, '0')}`;
      const doc = { id, slug: `place-${index}`, status: 'verified', place: { name_en: `Place ${index}`, category: 'takeaway' }, brand: null, source: { url: 'https://example.com/', quote: 'q', observed_at: '2026-10-01T00:00:00Z', verified_at: null }, menus: [] };
      return w.env.DB.prepare('INSERT INTO place_docs (place_id, doc_json, entry_json, etag, built_at) VALUES (?, ?, NULL, ?, ?)').bind(id, JSON.stringify(doc), 'e', '2026-10-01T00:00:00Z');
    });
    await w.call('/api/health');
    await w.json('/api/index');
    await w.env.DB.batch(statements);
    const body = (await (await w.call('/export/places.json')).json()) as { places: { id: string }[] };
    expect(body.places).toHaveLength(230);
    expect(new Set(body.places.map((entry) => entry.id)).size).toBe(230);
  });
});

describe('a CSV cell', () => {
  it('never starts a formula, and quotes what needs quoting', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+44 20 7946 0000')).toBe(`'+44 20 7946 0000`);
    expect(csvCell('-1')).toBe(`'-1`);
    expect(csvCell('@home')).toBe(`'@home`);
    expect(csvCell('12 Example Street, London')).toBe('"12 Example Street, London"');
    expect(csvCell(['sichuan', 'hunan'])).toBe('sichuan; hunan');
    expect(csvCell(null)).toBe('');
    expect(csvCell(51.5)).toBe('51.5');
  });
});
