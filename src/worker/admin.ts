/**
 * The admin gate for /api/admin/*. One secret, ADMIN_PASSWORD, opens it. With no secret
 * set nothing does: a fresh deployment is closed rather than open, the rule tarot
 * settled on. The compare is constant-time, and wrong passwords are counted per address, so
 * the password cannot be guessed at speed while the console itself (its image grids included)
 * is never slowed down.
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
