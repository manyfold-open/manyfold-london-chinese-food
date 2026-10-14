/**
 * The analytics question (src/app/analytics.ts): a bar at the foot of every reader page until a
 * reader who must be asked answers, and a switch on the privacy page for everyone measured. The
 * two answers are the same size and weight; declining is not the quiet one.
 */

import { useSyncExternalStore } from 'react';
import { consentAnswer, consentOwed, measured, measuring, onConsentChange, setConsent } from '../analytics';
import { useCopy, useLocale } from '../i18n';
import { Link } from '../router';
import { paths } from '../routes';
import { Button, Icon } from '../ui';

const useAnswer = () => useSyncExternalStore(onConsentChange, consentAnswer, () => null);

export function ConsentBar() {
  const copy = useCopy();
  const locale = useLocale();
  useAnswer();
  if (!consentOwed()) return null;
  return (
    <aside className="consent" aria-label={copy.consent.title}>
      <p>
        {copy.consent.question} <Link href={paths.page(locale, 'privacy')}>{copy.consent.more}</Link>
      </p>
      <div className="consent-answers">
        <Button onClick={() => setConsent('denied')}>{copy.consent.decline}</Button>
        <Button onClick={() => setConsent('granted')}>{copy.consent.accept}</Button>
      </div>
    </aside>
  );
}

/** On the privacy page: whether this browser is measured, and the button that changes it. */
export function AnalyticsSwitch() {
  const copy = useCopy();
  useAnswer();
  if (!measured) return null;
  const on = measuring();
  return (
    <section className="section analytics-switch">
      <h2>
        <Icon name="chart" /> {copy.consent.title}
      </h2>
      <p>{on ? copy.consent.on : copy.consent.off}</p>
      <Button onClick={() => setConsent(on ? 'denied' : 'granted')}>{on ? copy.consent.turnOff : copy.consent.turnOn}</Button>
    </section>
  );
}
