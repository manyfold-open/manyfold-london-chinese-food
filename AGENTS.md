# Working on this repository

Rules for anyone — human or AI agent — changing 伦敦中餐 · London Chinese Food. These are the
load-bearing walls. Most come from [manyfold-data](https://github.com/manyfold-open/manyfold-data),
whose collector and maintainer mechanism this site reuses.

## Invariants

1. **Only verified records are public.** A record is public when its status is `verified` (or
   `stale`, shown with a notice) and the place whose page shows it is public. Pending, rejected,
   merged, withdrawn and applied records never appear in a public response, and neither do photos
   or illustrations waiting for review.
2. **A kind is its config.** What a place, brand, menu, review, photo or illustration holds, how it
   is validated, identified and described to agents derive from `kinds/<kind>.ts`. Do not
   special-case a kind's fields in code; extend the format in `src/shared/kinds.ts` and teach
   `validateConfig()` the new rule. `src/shared/place-doc.ts` is the one place that knows how a
   place's page is assembled from its records.
3. **No field name reaches SQL text.** Every value is a bound parameter; lists go in as one JSON
   parameter through `json_each`. Read models are computed in code, never by SQL over `data_json`.
4. **Evolve the database only through `SCHEMA` in `src/worker/schema.ts`**, with
   `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. No semicolons inside statement
   bodies or comments. There is no migration step.
5. **Every change to a record is a revision**, including the ones the server makes because another
   record changed (a place rejected withdraws its reviews): those name the cause in `caused_by`,
   in the same batch, so undoing a token's work undoes their effects too.
6. **Respect the runtime split.** `src/worker/` runs in workerd, `src/app/` in the browser,
   `src/shared/` and `kinds/` in both and in plain `node` (the scripts). Files under `src/shared/`
   and `kinds/` import each other with explicit `.ts` extensions and use only type syntax Node can
   strip (no enums, namespaces or parameter properties).
7. **Keep `GET /api/health` returning 200 JSON.** The deploy workflow checks it.
8. **Never commit secrets.** Tokens, the admin password and the Turnstile secret belong in
   `wrangler secret` or the reader's own `.env`, never in the repo.
9. **Seeds are checked facts; leads are hints.** A seed record needs a source page and a quote
   copied word for word from it (`npm run quotes:verify`). Leads (OpenStreetMap, the Food Standards
   Agency) only tell collectors where to look: they are never published, and no hygiene score is
   ever stored.
10. **`/join` only ever creates collector tokens.** No public route may create or promote a
    maintainer token. Token secrets are shown once and stored only as SHA-256.
11. **Only maintainers' verdicts, the admin, and the effects of those two change a record's
    status** (and the seed, for new records). A verdict counts only for a task leased to the token
    sending it, while the lease lasts, never for a record that token submitted. A page or image a
    maintainer could not open is `unsure`, never grounds to reject or mark stale. The upload routes
    only ever create pending records.
12. **The admin API stays closed by default.** `/api/admin/*` refuses everything until
    `ADMIN_PASSWORD` is set, compares it in constant time, sends no CORS headers, and never returns
    a token secret except once, at issue.
13. **Agent-facing text comes from the configs.** `src/worker/skill.ts` builds every skill from
    them. When the API's rules change, change the skill text in the same commit, and keep every
    error message specific enough for an agent to fix its request.
14. **Exports are spreadsheet-safe and carry facts only.** The CSV writer prefixes cells that start
    with `=`, `+`, `-` or `@`. Exports hold places and menus (CC BY 4.0), never review excerpts,
    which remain their authors'.
15. **Readers cost the database a row or two, not a scan.** A place's page is one stored document;
    the index, the dish catalog and the illustration list are stored datasets read as their parts.
    Only `src/worker/docs.ts` builds them, from records that changed. A new public view is computed
    from these, never from new SQL over `records`. `tests/budget.test.ts` holds the busiest
    statements to a budget on real D1; a new hot path goes there too.
16. **A token's standing is one row per kind, moved with every status change** (`moveStanding`,
    src/worker/tokens.ts), with the same status guard as the change. Withdrawn records count for
    no one.
17. **No score anywhere.** The site collects what reviewers wrote, never their ratings: every
    public text passes `src/shared/rating-guard.ts`; there is no aggregate, no sentiment, no sort
    by review count, and no `aggregateRating` or `Review` rating in the page data. Readers judge a
    place, and a source, by reading their history.
18. **Illustrations are labeled, reviewed and second.** They come only from agents' uploads of
    images they generated, pass a maintainer like any record, always carry the "AI 示意图 / AI
    illustration" label, are never shown in place of a verified photo of the same dish at that
    place, and each standard dish name has at most one at a time. The Worker calls no image model.
19. **Media is re-encoded, never kept as sent.** Every upload goes through the Images binding to
    WebP, which drops all metadata, before it is stored; the original bytes are never written.
    Media waiting for review is served only to the maintainer holding its task and to the admin.
20. **Visitor uploads are gated cheapest first:** same origin, per-IP limits, size, the place,
    Turnstile on the server, then the site-wide daily count, last, so one address cannot close the
    form for everyone.
21. **Mountable under BASE_PATH.** The site lives at app.manyfold.ai/london-chinese-food and at the
    root of its workers.dev host. Only `src/worker/mount.ts` knows the prefix; links handed to
    browsers and agents go through `publicUrl`, the app's fetches through `appUrl`, and cache keys
    are public URLs. Built scripts hold no root paths (`tests/dist-urls.test.ts`).
22. **Shared-origin hygiene.** app.manyfold.ai hosts other apps: browser storage keys start with
    `lcf.`, the admin password is never stored in a browser (the console holds an HttpOnly,
    SameSite=Strict session cookie limited to the site's path, signed with a key derived from the
    password, and admin changes made with it must come from the site's own origin), and pages send
    a content security policy.
23. **Author names only for public writers** (critics, publications, blogs, video), never for
    people reviewing on platforms or forums, and no excerpt that names a private person.

## Tests

`tests/d1.ts` is a D1 double on Node's built-in SQLite, so API tests run the Worker's real SQL.
Use it (with `app.request`) for any route that touches the database, and stub `fetch` for outside
calls. `tests/budget.test.ts` runs the busiest statements on workerd's own D1
(`tests/workerd.mjs`), which reports rows read the way production bills them.

## Checks

```bash
npm run check   # typecheck + build + wrangler deploy --dry-run
npm test        # vitest
```
