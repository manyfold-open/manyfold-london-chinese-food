/**
 * Worker-side types. `Env` mirrors the bindings in wrangler.jsonc — add a binding
 * there, add it here too.
 */

export interface Env {
  /** Static build output in dist/client. Pages and files not answered by the API come from here. */
  ASSETS: Fetcher;
  DB: D1Database;
  /** Visitors' photos and agents' illustrations: re-encoded WebP only (src/worker/media.ts). */
  MEDIA: R2Bucket;
  /** Re-encodes uploads. WebP output drops every bit of metadata, GPS included. */
  IMAGES: ImagesBinding;
  /** Opens /api/admin/*. A secret: `npx wrangler secret put ADMIN_PASSWORD`. Unset = closed. */
  ADMIN_PASSWORD?: string;
  /** The site's public address with its mount, e.g. https://app.manyfold.ai/london-chinese-food. */
  PUBLIC_URL?: string;
  /** Where the site is mounted on a shared host, e.g. /london-chinese-food. Empty: at the root. */
  BASE_PATH?: string;
  /** Turnstile's public site key, sent to the upload form. */
  TURNSTILE_SITE_KEY?: string;
  /** Turnstile's secret, for checking an upload form's answer. A secret. */
  TURNSTILE_SECRET?: string;
}

/** Errors that already know their HTTP shape. Thrown anywhere, mapped in index.ts. */
export class HttpError extends Error {
  // Plain fields rather than constructor parameter properties: keeps the class
  // friendly to toolchains that only strip types.
  readonly status: number;
  readonly code: string;
  /** Extra response headers, such as Retry-After on a 429. */
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}
