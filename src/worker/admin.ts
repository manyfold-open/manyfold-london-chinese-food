/**
 * The admin gate for /api/admin/*. One secret, ADMIN_PASSWORD, opens it. With no secret
 * set nothing does: a fresh deployment is closed rather than open, the rule tarot
 * settled on. The compare is constant-time, and wrong passwords are counted per address, so
 * the password cannot be guessed at speed while the console itself (its image grids included)
 * is never slowed down.
 *
 * Scripts send the password in x-admin-password. The /settings console sends it once, and gets a
 * session cookie instead: HttpOnly (no script on the shared app.manyfold.ai origin can read it),
 * SameSite=Strict, limited to the site's path, and signed with a key derived from the password,
 * so changing ADMIN_PASSWORD ends every session. The password itself is never kept in a browser.
 */

import { sha256Hex } from './ids';
import { consume, HOUR, peek } from './ratelimit';
import { HttpError, type Env } from './types';

/** Wrong passwords one address may send in an hour before the gate stops answering it. */
const WRONG_PER_HOUR = { limit: 20, windowMs: HOUR };

/** Constant-time: both sides are hashed first, so neither length nor content leaks. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function requireAdmin(env: Env, supplied: string | undefined, ip: string): Promise<void> {
  const secret = (env.ADMIN_PASSWORD ?? '').trim();
  if (!secret) {
    throw new HttpError(
      503,
      'admin_closed',
      'The admin API stays closed until the ADMIN_PASSWORD secret is set: npx wrangler secret put ADMIN_PASSWORD',
    );
  }
  const gate = await peek(env.DB, 'admin-wrong', ip, WRONG_PER_HOUR);
  if (!gate.allowed) {
    throw new HttpError(429, 'rate_limited', `Too many wrong passwords from this address. Try again in ${gate.retryAfterSeconds} seconds.`, {
      'retry-after': String(gate.retryAfterSeconds),
    });
  }
  if (!supplied || !(await safeEqual(supplied, secret))) {
    await consume(env.DB, 'admin-wrong', ip, WRONG_PER_HOUR);
    throw new HttpError(401, 'admin_password_invalid', 'Send the admin password in the x-admin-password header.');
  }
}

/* ───────── the console's session ───────── */

export const SESSION_COOKIE = 'lcf_admin';
export const SESSION_DAYS = 14;

/** A signing key only this password gives. */
async function sessionKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`london-chinese-food admin session\n${secret}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

const base64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** `<expiry ms>.<signature>`: the session until `expiresAt`, for whoever knows the password now. */
export async function sessionToken(secret: string, expiresAt: number): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(secret), new TextEncoder().encode(`session:${expiresAt}`));
  return `${expiresAt}.${base64url(signature)}`;
}

/** Whether a session cookie is one this password signed, and not yet expired. */
export async function validSession(env: Env, value: string | undefined, nowMs: number = Date.now()): Promise<boolean> {
  const secret = (env.ADMIN_PASSWORD ?? '').trim();
  const match = /^(\d{13})\.[A-Za-z0-9_-]{43}$/.exec(value ?? '');
  if (!secret || !match || Number(match[1]) <= nowMs) return false;
  return safeEqual(await sessionToken(secret, Number(match[1])), value!);
}
