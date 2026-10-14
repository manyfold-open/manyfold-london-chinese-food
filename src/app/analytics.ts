/**
 * Google Analytics in the reader's browser. The Worker names the property in a <meta> on the
 * public host's reader pages only (src/worker/analytics.ts); without one, as in local dev, on
 * workers.dev and in the console, everything here does nothing.
 *
 * Google's tag is loaded only once it may: at once where no one has to be asked, else after the
 * reader accepts, and never while they decline (the privacy page changes the answer). Nothing goes
 * to ads: ad storage is denied and Google signals are off. Its cookies stay with this site: named
 * lcf__ga…, on this host and under the site's path (AGENTS.md, invariant 22).
 *
 * Page views are sent from here, not by the tag: the app moves between pages in place, and a
 * page's title is known only once it is drawn (a place's, once its record is in). useTitle
 * reports each page as it names it.
 */

import { BASE } from './base';

export type Consent = 'granted' | 'denied';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const KEY = 'lcf.consent';
const meta = document.querySelector<HTMLMetaElement>('meta[name="lcf-analytics"]');
const ID = meta && /^G-[A-Z0-9]{4,24}$/.test(meta.content) ? meta.content : null;
/** Whether this reader is asked before anything is measured. */
const ASK = meta?.dataset.ask !== '0';

/** Whether this page is measured at all. */
export const measured = ID !== null;

const stored = (): Consent | null => {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
};

let answer = stored();
const listeners = new Set<() => void>();

/** The reader's answer; null while they have not given one. */
export const consentAnswer = (): Consent | null => answer;

/** Whether Google's tag may run: the reader accepted, or was not asked and did not decline. */
export const measuring = (): boolean => measured && (answer ?? (ASK ? 'denied' : 'granted')) === 'granted';

/** Whether the reader is owed the question: measured, asked here, and not answered. */
export const consentOwed = (): boolean => measured && ASK && answer === null;

export function onConsentChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let loaded = false;
let shown: { entry: string; title: string } | null = null;
let counted: string | null = null;

function gtag(...args: unknown[]): void {
  window.gtag?.(...args);
}

function start(): void {
  if (!ID) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${ID}`] = false;
  if (!loaded) {
    loaded = true;
    window.dataLayer = window.dataLayer ?? [];
    // The tag reads its commands as `arguments` objects, not arrays.
    window.gtag = function () {
      window.dataLayer!.push(arguments);
    };
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('config', ID, {
      send_page_view: false,
      cookie_prefix: 'lcf',
      cookie_domain: location.hostname,
      cookie_path: BASE || '/',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
    document.head.append(script);
  } else gtag('consent', 'update', { analytics_storage: 'granted' });
  counted = null;
  if (shown) pageView(shown.entry, shown.title);
}

/** Stops measuring on this page at once, and forgets the cookies the tag set. */
function stop(): void {
  if (!ID || !loaded) return;
  gtag('consent', 'update', { analytics_storage: 'denied' });
  (window as unknown as Record<string, unknown>)[`ga-disable-${ID}`] = true;
  for (const name of document.cookie.split(';').map((pair) => pair.split('=')[0]!.trim())) {
    if (name.startsWith('lcf__ga')) document.cookie = `${name}=; max-age=0; path=${BASE || '/'}; domain=${location.hostname}`;
  }
}

/** Keeps the reader's answer in this browser and acts on it. */
export function setConsent(choice: Consent): void {
  answer = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked: the answer holds until the page is closed
  }
  if (measuring()) start();
  else stop();
  for (const listener of listeners) listener();
}

/**
 * A page view for the history entry on screen, under the title its page gave it. Each visit to an
 * entry counts once: a title that changes on the same entry (a place's record arriving) does not
 * count it again; going back to it does.
 */
export function pageView(entry: string, title: string): void {
  shown = { entry, title };
  if (!measuring() || entry === counted) return;
  counted = entry;
  gtag('event', 'page_view', { page_title: title, page_location: location.href });
}

if (measuring()) start();
