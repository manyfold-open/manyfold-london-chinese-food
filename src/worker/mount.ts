/**
 * One deployment, two addresses.
 *
 * The site answers at the root of its own host (tarot.manyfold.ai, or a fork's
 * workers.dev URL) and, when BASE_PATH is set, under that prefix on a host it
 * shares with other apps (app.manyfold.ai/tarot). Everything inside — the Hono
 * app, the router, the assets binding — only ever sees root paths. This file is
 * the one place that knows about the prefix:
 *
 *   - on the way in it takes the prefix off, and records it in a header that
 *     only this wrapper is allowed to set;
 *   - on the way out it puts the prefix back wherever a root path is about to
 *     reach the browser: a redirect's Location, and the src/href attributes of
 *     the HTML document;
 *   - and it tells the page where it is mounted, in a <meta> the browser reads
 *     before its first request (src/app/base.ts).
 *
 * At the root none of this runs, so the root is served byte for byte as it was
 * before there was a mount at all.
 */

/**
 * Where the wrapper records the prefix a request arrived under. The
 * conventional reverse-proxy name, and — like a proxy — the wrapper drops any
 * copy a client sent before it writes its own.
 */
export const PREFIX_HEADER = 'x-forwarded-prefix';

/** Path segments only: the value ends up inside an HTML attribute. */
const SAFE_MOUNT = /^(\/[A-Za-z0-9._~-]+)+$/;

/** BASE_PATH as '' (not mounted) or '/tarot' — never a trailing slash, never anything odd. */
export const mountPath = (env: { BASE_PATH?: string }): string => {
  const raw = (env.BASE_PATH ?? '').trim().replace(/\/+$/, '');
  return SAFE_MOUNT.test(raw) ? raw : '';
};

/** `/tarot` and `/tarot/…` — but never `/tarotology`. */
export const isUnder = (pathname: string, mount: string): boolean =>
  mount !== '' && (pathname === mount || pathname.startsWith(`${mount}/`));

interface RequestContext {
  req: { url: string; header: (name: string) => string | undefined };
}

/** The prefix this request came in under: '' at the root. */
export const mountOf = (c: RequestContext): string => c.req.header(PREFIX_HEADER) ?? '';

/**
 * An in-app path as a full URL on the address the visitor is actually using —
 * so a share link made on app.manyfold.ai/tarot points back there, and one made
 * on tarot.manyfold.ai points there.
 */
export const publicUrl = (c: RequestContext, path: string): string =>
  `${new URL(c.req.url).origin}${mountOf(c)}${path}`;

/** A root-relative URL moved under the mount. Protocol-relative, absolute and relative URLs are left alone. */
export const prefixed = (value: string, mount: string): string =>
  value.startsWith('/') && !value.startsWith('//') ? mount + value : value;

/** Only a 200 HTML document has attributes to rewrite. Card images and bundles pass untouched. */
export const shouldRewrite = (response: Response): boolean =>
  response.status === 200 &&
  (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');

function rewriteDocument(response: Response, mount: string): Response {
  const attribute = (name: string): HTMLRewriterElementContentHandlers => ({
    element(element) {
      const value = element.getAttribute(name);
      if (value !== null) element.setAttribute(name, prefixed(value, mount));
    },
  });
  return new HTMLRewriter()
    .on('head', {
      element(element) {
        element.prepend(`<meta name="app-base" content="${mount}">`, { html: true });
      },
    })
    .on('[href^="/"]', attribute('href'))
    .on('[src^="/"]', attribute('src'))
    .transform(response);
}

type Fetch<E> = (request: Request, env: E, ctx: ExecutionContext) => Response | Promise<Response>;

/** Wraps a fetch handler so it can also be served under BASE_PATH. */
export function withMount<E extends { BASE_PATH?: string }>(inner: Fetch<E>): Fetch<E> {
  return async (request, env, ctx) => {
    const mount = mountPath(env);
    const url = new URL(request.url);

    if (!isUnder(url.pathname, mount)) {
      if (!request.headers.has(PREFIX_HEADER)) return inner(request, env, ctx);
      // Only the wrapper says where a request came in; a client's claim is dropped.
      const cleaned = new Request(request);
      cleaned.headers.delete(PREFIX_HEADER);
      return inner(cleaned, env, ctx);
    }

    // The mount root always carries its slash, so there is one address for the
    // front page and not two. The query string comes along (a ?ref= link).
    if (url.pathname === mount) {
      url.pathname = `${mount}/`;
      return Response.redirect(url.toString(), 308);
    }

    url.pathname = url.pathname.slice(mount.length);
    const forwarded = new Request(url.toString(), request);
    forwarded.headers.set(PREFIX_HEADER, mount);
    let response = await inner(forwarded, env, ctx);

    const location = response.headers.get('location');
    if (location && prefixed(location, mount) !== location) {
      response = new Response(response.body, response);
      response.headers.set('location', prefixed(location, mount));
    }
    return shouldRewrite(response) ? rewriteDocument(response, mount) : response;
  };
}
