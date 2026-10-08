/**
 * Cloudflare Turnstile, the check that a visitor's upload comes from a person using this site's
 * form. app.manyfold.ai is shared with other apps, so an Origin check cannot tell this site's
 * form from theirs: the Turnstile answer, checked here on the server, is the real gate. The form's
 * action names this site's upload, and the answer must have been issued for an allowed host.
 */

export const TURNSTILE_ACTION = 'photo-upload';

interface SiteverifyResponse {
  success: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

/** Hosts whose pages may carry the form: the public site's, and any other the Worker answers on. */
export async function verifyTurnstile(
  secret: string | undefined,
  answer: string,
  options: { ip: string; hosts: readonly string[]; idempotencyKey?: string },
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!secret) return { ok: false, reason: 'Uploads are not open yet on this site.' };
  if (!answer) return { ok: false, reason: 'The check that you are a person did not run; reload the page and try again.' };
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', answer);
  form.set('remoteip', options.ip);
  if (options.idempotencyKey) form.set('idempotency_key', options.idempotencyKey);
  let result: SiteverifyResponse;
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    result = (await response.json()) as SiteverifyResponse;
  } catch {
    return { ok: false, reason: 'The check that you are a person could not be confirmed; try again in a minute.' };
  }
  if (!result.success) return { ok: false, reason: 'The check that you are a person failed; reload the page and try again.' };
  // Cloudflare's test keys answer with hostname "example.com" and no action: allowed only with the test secret.
  const testing = secret.startsWith('1x0000000000000000000000000000000');
  if (!testing && result.hostname && !options.hosts.includes(result.hostname)) return { ok: false, reason: 'The form was not this site’s.' };
  if (!testing && result.action !== TURNSTILE_ACTION) return { ok: false, reason: 'The form was not this site’s photo upload.' };
  return { ok: true };
}
