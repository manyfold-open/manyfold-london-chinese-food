#!/usr/bin/env python3
"""London Chinese Food lookups for the guide agent.

Read-only: every call is a GET to the site's public API (and postcodes.io to
place a postcode or area on the map). Prints short plain text meant to be read
by the agent, with each place's page link.

  python3 lcf.py near <postcode | outcode | area | lat,lng> [--category C] [--cuisine T] [--limit N]
  python3 lcf.py find <name, English or Chinese>
  python3 lcf.py place <id | slug>
  python3 lcf.py dish <dish, English or Chinese> [--near <where>] [--limit N]
  python3 lcf.py filter [--cuisine T] [--category C] [--borough B] [--outcode O] [--limit N]
  python3 lcf.py vocab
  python3 lcf.py updates [--lang en|zh] [--mark] [--limit N]

Every command takes --lang zh|en (default en) for links and labels, and
--all to include places that are closed or temporarily closed.
"""

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://app.manyfold.ai/london-chinese-food'
POSTCODES = 'https://api.postcodes.io'
CACHE = os.path.expanduser('~/.cache/lcf')
UA = 'lcf-guide-agent (Manyfold)'
HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = 'media'
# Manyfold sends a workspace file after the reply text when the reply links to
# it (apps/api/src/modules/channels/workspace-file-refs.ts). Narra shows a fenced
# block's opening line as nothing (chat-markdown.tsx splitFencedCode), so the
# references ride there unseen.
IMAGE_REF = '![]({})'


def image_line(paths):
    return '```' + ' '.join(IMAGE_REF.format(p) for p in paths) + '```'


def get(url, timeout=20):
    req = urllib.request.Request(
        url, headers={'User-Agent': UA, 'Accept': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)


# The site rebuilds its index every five minutes; an hour is fresh enough for
# a guide and keeps the 500 KB download off most turns.
def cached(name, url, ttl):
    path = os.path.join(CACHE, name)
    try:
        if time.time() - os.path.getmtime(path) < ttl:
            with open(path) as f:
                return json.load(f)
    except (OSError, ValueError):
        pass
    data = get(url)
    os.makedirs(CACHE, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f)
    os.replace(tmp, path)
    return data


# Pictures are kept in the workspace a week, by their id on the site, so a
# dish asked about again is not downloaded again.
def media(url, name):
    folder = os.path.join(HERE, MEDIA)
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        try:
            if time.time() - os.path.getmtime(os.path.join(folder, old)) > 7 * 86400:
                os.remove(os.path.join(folder, old))
        except OSError:
            pass
    path = os.path.join(folder, name)
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=20) as res:
            body = res.read()
        with open(path + '.tmp', 'wb') as f:
            f.write(body)
        os.replace(path + '.tmp', path)
    return f'{MEDIA}/{name}'


def illustration(key):
    d = cached('illustrations.json', f'{BASE}/api/illustrations', 3600)
    if not d.get('shown'):
        return None
    rid = (d.get('dishes') or {}).get(key)
    if not rid:
        return None
    try:
        return media(f'{BASE}/media/i/{rid}/full.webp', f'dish-{rid}.webp')
    except urllib.error.URLError:
        return None


def places():
    return cached('index.json', f'{BASE}/api/index', 3600)['places']


def schema():
    return cached('schema.json', f'{BASE}/api/schema', 86400)


def dish_catalog():
    return cached('dishes.json', f'{BASE}/api/dishes', 3600)['dishes']


def link(lang, pid, slug):
    return f'{BASE}/{lang}/place/{pid}/{slug}'


def label(values, key, lang):
    entry = (values or {}).get(key)
    return entry.get(lang) or entry.get('en') if entry else key


def borough_name(code, lang):
    return label(schema().get('boroughs'), code, lang) if code else ''


def km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def geo():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'places-geo.json')) as f:
        return json.load(f)


def plain(text):
    return ''.join(ch for ch in text.lower() if ch.isalnum())


def campus_or_station(text):
    g, q = geo(), plain(text.replace('station', '').replace('站', ''))
    if not q:
        return None
    for c in g['campuses']:
        names = [c['short'], c['en'], c['zh'], c['id']]
        if any(q == plain(n) for n in names) or (len(q) >= 3 and any(q in plain(n) for n in names[1:3])):
            return c['lat'], c['lng'], f"{c['short']} ({c['en']} / {c['zh']}, {c['area']})", c['id']
    exact = [s for s in g['stations'] if plain(s[0]) == q]
    loose = exact or [s for s in g['stations'] if len(q) >= 4 and plain(s[0]).startswith(q)]
    if loose:
        s = loose[0]
        return s[1], s[2], f'{s[0]} station', None
    return None


def locate(where):
    """A point for a campus, a station, a full postcode, an outcode, an area name or "lat,lng"."""
    text = where.strip()
    parts = text.split(',')
    if len(parts) == 2:
        try:
            return float(parts[0]), float(parts[1]), text
        except ValueError:
            pass
    known = campus_or_station(text)
    if known:
        lat, lng, name, campus = known
        return lat, lng, name + (f'; the site lists it at {BASE}/{{lang}}/near/{campus}' if campus else '')
    compact = text.replace(' ', '').upper()
    tries = []
    if compact.isalnum() and 5 <= len(compact) <= 7:
        tries.append(f'{POSTCODES}/postcodes/{urllib.parse.quote(compact)}')
    if compact.isalnum() and 2 <= len(compact) <= 4:
        tries.append(f'{POSTCODES}/outcodes/{urllib.parse.quote(compact)}')
    for url in tries:
        try:
            r = get(url)['result']
            return r['latitude'], r['longitude'], text.upper()
        except (urllib.error.HTTPError, KeyError, TypeError):
            continue
    try:
        found = get(f'{POSTCODES}/places?q={urllib.parse.quote(text)}&limit=5')['result']
    except urllib.error.HTTPError:
        found = []
    london = [p for p in found or [] if p.get('region') == 'London'] or found or []
    if london:
        p = london[0]
        return p['latitude'], p['longitude'], f"{p['name_1']} ({p.get('outcode')})"
    sys.exit(f'could not place "{where}" on the map: ask for a postcode or a nearby station')


def summary(p, lang, dist=None):
    name = p['n'] + (f" / {p['z']}" if p.get('z') else '')
    bits = [p['c'], ','.join(p.get('k') or []), p.get('pc') or '']
    if p.get('t') != 'open':
        bits.append(p['t'].upper())
    # The site's own rule (campuses.ts): a straight-line km is about 15 minutes on foot.
    if dist is not None:
        bits.append(f'{dist:.1f} km, ~{max(1, round(dist * 15))} min walk')
    counts = f"{p.get('r', 0)} review excerpts, {p.get('m', 0)} menu items"
    return f"- {name} [{' | '.join(b for b in bits if b)}] {counts}\n  id={p['id']} {link(lang, p['id'], p['s'])}"


# As the site's own lists do (campuses.ts placesNear), only open places are
# offered; a temporary closure is a reason not to send someone there.
def keep(p, args):
    if not args.all and p.get('t') != 'open':
        return False
    if args.category and p.get('c') != args.category:
        return False
    if getattr(args, 'cuisine', None) and args.cuisine not in (p.get('k') or []):
        return False
    return True


def cmd_near(args):
    lat, lng, where = locate(' '.join(args.where))
    rows = [(km(lat, lng, p['la'], p['lo']), p) for p in places() if p.get('la') is not None and keep(p, args)]
    rows.sort(key=lambda r: r[0])
    print(f"Nearest to {where.replace('{lang}', args.lang)}:")
    for d, p in rows[: args.limit]:
        print(summary(p, args.lang, d))


def cmd_find(args):
    q = ' '.join(args.query).strip().lower()
    hits = [p for p in places() if q in (p.get('n') or '').lower() or q in (p.get('z') or '') or q in p['s']]
    if not hits:
        found = get(f'{BASE}/api/search?q={urllib.parse.quote(q)}').get('places') or []
        ids = {f['id'] for f in found}
        hits = [p for p in places() if p['id'] in ids]
    # A name search answers "is it still there?" too, so closed places stay in
    # with their status shown.
    if not hits:
        print(f'No place matches "{q}".')
    for p in hits[: args.limit]:
        print(summary(p, args.lang))


def pence(v):
    return f'£{v / 100:.2f}' if isinstance(v, int) else ''


def cmd_place(args):
    key = args.id.strip()
    if not key.startswith('rec_'):
        match = next((p for p in places() if p['s'] == key), None)
        if not match:
            sys.exit(f'no place with slug "{key}": use find first')
        key = match['id']
    d = get(f'{BASE}/api/places/{urllib.parse.quote(key)}')
    pl, lang = d['place'], args.lang
    tags = schema()['kinds']['place']['fields']
    name = pl.get('name_en') or ''
    if pl.get('name_zh'):
        name += f" / {pl['name_zh']}"
    print(name)
    print(f"Kind: {label(tags['category'].get('valueLabels'), pl.get('category'), lang)}")
    print(f"Cuisines: {', '.join(pl.get('cuisines') or [])}")
    print(f"Trading: {pl.get('trading')}" + (f" (closed on {pl['closed_on']})" if pl.get('closed_on') else ''))
    print(f"Address: {pl.get('address') or ''}, {pl.get('postcode') or ''} ({pl.get('borough') or ''})")
    for field in ('phone', 'website', 'menu_url'):
        if pl.get(field):
            print(f'{field}: {pl[field]}')
    if d.get('brand'):
        print(f"Brand: {d['brand'].get('name_en') or d['brand'].get('name') or ''}")
    print(f"Page: {link(lang, d['id'], d['slug'])}")
    menus = d.get('menus') or []
    shown = 0
    for m in menus:
        stale = ' (may be out of date)' if m.get('stale') else ''
        print(f"\nMenu{stale}, checked {(m.get('verified_at') or '')[:10]}, source {m.get('source_url') or ''}")
        for sec in m.get('sections') or []:
            for it in sec.get('items') or []:
                if shown >= args.items:
                    break
                n = it.get('name_en') or it.get('dish') or ''
                if it.get('name_zh'):
                    n += f" / {it['name_zh']}"
                print(f"  {sec.get('name') or ''}: {n} {pence(it.get('price_pence'))} {it.get('price_note') or ''}".rstrip())
                shown += 1
    total = sum(len(s.get('items') or []) for m in menus for s in m.get('sections') or [])
    if total > shown:
        print(f'  … {total - shown} more items on the page')
    mentioned = d.get('mentioned') or []
    if mentioned:
        top = sorted(mentioned, key=lambda x: -len(x.get('reviews') or []))[:8]
        print('\nDishes reviewers mention: ' + ', '.join(f"{x.get('name')} / {x.get('dish')} ({len(x.get('reviews') or [])})" for x in top))
    reviews = sorted(d.get('reviews') or [], key=lambda r: r.get('published_on') or '', reverse=True)
    if reviews:
        print(f'\nReview excerpts ({len(reviews)}, newest first; quote them, never score them):')
    for r in reviews[: args.reviews]:
        text = r.get('excerpt') or ''
        if lang == 'zh' and r.get('translation') and r.get('language') != 'zh':
            text += f"\n    译文: {r['translation']}"
        print(f"- {r.get('publication') or r.get('author') or ''}, {r.get('published_on') or ''}: \"{text}\"\n    {r.get('source_url') or ''}")
    print(f"\nPhotos: {len(d.get('photos') or [])}")


def resolve_dish(q):
    q = plain(q)
    cat = dish_catalog()
    exact = [d for d in cat if q in (plain(d[0] or ''), plain(d[1] or ''), plain(d[2] or ''))]
    loose = [d for d in cat if d not in exact and any(q in plain(x or '') for x in d[:3])]
    return sorted(exact, key=lambda d: -(d[3] or 0)) + sorted(loose, key=lambda d: -(d[3] or 0))


def cmd_dish(args):
    matches = resolve_dish(' '.join(args.dish))
    if not matches:
        sys.exit('no dish by that name: try the Chinese or English name another way')
    key, zh, en, count = matches[0][:4]
    others = ', '.join(f'{m[2]} / {m[1] or m[0]}' for m in matches[1:6])
    data = get(f'{BASE}/api/dishes/{urllib.parse.quote(key)}')
    by_id = {p['id']: p for p in places()}
    rows = []
    for e in data.get('places') or []:
        p = by_id.get(e.get('place_id'))
        if p and keep(p, args):
            rows.append((p, e.get('via'), e.get('entry') or {}))
    origin = locate(args.near) if args.near else None
    if origin:
        rows.sort(key=lambda r: km(origin[0], origin[1], r[0]['la'], r[0]['lo']))
    print(f"{en} / {zh or key}: {len(rows)} places" + (f", nearest to {origin[2].replace('{lang}', args.lang)} first" if origin else ''))
    if others:
        print(f'(other dishes matching: {others})')
    for p, via, entry in rows[: args.limit]:
        dist = km(origin[0], origin[1], p['la'], p['lo']) if origin else None
        price = pence(entry.get('price_pence'))
        how = f"on the menu as {entry.get('name_en') or entry.get('name_zh') or ''} {price}".strip() if via == 'menu' else 'mentioned by reviewers'
        print(summary(p, args.lang, dist) + f'\n  {how}')
    ref = illustration(key)
    if ref:
        print('Image: an AI illustration of this dish, as the site labels it, not a photo of any of these places.')
        print('If you show it, say it is an AI illustration and end your reply with the next line, exactly as it is.')
        print(image_line([ref]))


def cmd_filter(args):
    bmatch = None
    if args.borough:
        q = args.borough.lower()
        bmatch = {c for c, v in (schema().get('boroughs') or {}).items() if q in v.get('en', '').lower() or q in v.get('zh', '')}
    rows = [
        p for p in places()
        if keep(p, args)
        and (not bmatch or p.get('b') in bmatch)
        and (not args.outcode or (p.get('o') or '').upper() == args.outcode.upper())
    ]
    rows.sort(key=lambda p: -(p.get('r') or 0) - (p.get('m') or 0) / 50)
    print(f'{len(rows)} places match (most documented first, which is not a ranking of quality):')
    for p in rows[: args.limit]:
        print(summary(p, args.lang))


def cmd_vocab(args):
    f = schema()['kinds']['place']['fields']
    print('categories: ' + ', '.join(f['category']['values']))
    print('cuisines: ' + ', '.join(f['cuisines'].get('values') or f['cuisines'].get('items', {}).get('values') or []))
    print('trading: ' + ', '.join(f['trading']['values']))
    print('boroughs: ' + ', '.join(f"{v['en']}/{v['zh']}" for v in (schema().get('boroughs') or {}).values()))


def _load_announced(path):
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _save_announced(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(payload, f)
    os.replace(tmp, path)


def find_new_places(all_places, state, include_all=False, limit=3):
    """Select newly added or updated open places relative to saved announcement state."""
    candidates = [p for p in all_places if (include_all or p.get('t') == 'open')]
    last_u = (state or {}).get('last_u') or ''
    at_last_u_ids = set((state or {}).get('at_last_u_ids') or [])
    seen_ids = set((state or {}).get('seen_ids') or [])

    if state is None:
        fresh = [p for p in candidates if p['id'] not in seen_ids]
    else:
        fresh = []
        for p in candidates:
            u = p.get('u') or ''
            pid = p['id']
            if pid in seen_ids:
                continue
            if u > last_u or (u == last_u and last_u and pid not in at_last_u_ids):
                fresh.append(p)

    fresh.sort(key=lambda p: (p.get('u') or '', p['id']), reverse=True)
    max_u = max([(p.get('u') or '') for p in candidates] + [last_u])
    at_max = [p['id'] for p in candidates if (p.get('u') or '') == max_u] if max_u else []
    return fresh[:limit], max_u, at_max


def cmd_updates(args):
    state_path = os.path.join(CACHE, 'last-announced.json')
    state = _load_announced(state_path)
    all_places = get(f'{BASE}/api/index').get('places') or []
    shown, max_u, at_max = find_new_places(
        all_places, state, include_all=args.all, limit=args.limit
    )
    if not shown:
        print('NO_UPDATES')
    else:
        print(f'Latest open places ({len(shown)} shown, newest first):')
        for p in shown:
            updated = (p.get('u') or '')[:10]
            print(summary(p, args.lang) + (f'\n  updated {updated}' if updated else ''))
    if args.mark:
        prev_seen = list((state or {}).get('seen_ids') or [])
        seen = list(dict.fromkeys([p['id'] for p in shown] + prev_seen))[:500]
        _save_announced(
            state_path,
            {
                'last_u': max_u,
                'at_last_u_ids': at_max,
                'seen_ids': seen,
                'marked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            },
        )


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('--lang', choices=['en', 'zh'], default='en')
    common.add_argument('--all', action='store_true', help='include closed places')
    ap = argparse.ArgumentParser(description='London Chinese Food lookups')
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser = (lambda add: lambda name, **kw: add(name, parents=[common], **kw))(sub.add_parser)

    s = sub.add_parser('near')
    s.add_argument('where', nargs='+')
    s.add_argument('--category')
    s.add_argument('--cuisine')
    s.add_argument('--limit', type=int, default=8)
    s.set_defaults(fn=cmd_near)

    s = sub.add_parser('find')
    s.add_argument('query', nargs='+')
    s.add_argument('--category')
    s.add_argument('--limit', type=int, default=8)
    s.set_defaults(fn=cmd_find)

    s = sub.add_parser('place')
    s.add_argument('id')
    s.add_argument('--items', type=int, default=25)
    s.add_argument('--reviews', type=int, default=5)
    s.set_defaults(fn=cmd_place)

    s = sub.add_parser('dish')
    s.add_argument('dish', nargs='+')
    s.add_argument('--near')
    s.add_argument('--category')
    s.add_argument('--limit', type=int, default=8)
    s.set_defaults(fn=cmd_dish)

    s = sub.add_parser('filter')
    s.add_argument('--cuisine')
    s.add_argument('--category')
    s.add_argument('--borough')
    s.add_argument('--outcode')
    s.add_argument('--limit', type=int, default=10)
    s.set_defaults(fn=cmd_filter)

    s = sub.add_parser('vocab')
    s.set_defaults(fn=cmd_vocab)

    s = sub.add_parser('updates')
    s.add_argument('--mark', action='store_true', help='record announced watermark')
    s.add_argument('--limit', type=int, default=3)
    s.set_defaults(fn=cmd_updates)

    args = ap.parse_args()
    if not hasattr(args, 'category'):
        args.category = None
    try:
        args.fn(args)
    except urllib.error.URLError as err:
        sys.exit(f'the site did not answer ({err}); say the guide is unreachable right now')


if __name__ == '__main__':
    main()
