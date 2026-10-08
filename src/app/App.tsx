/**
 * The reader app: which page the path names, in which language. The admin console (/settings) is
 * its own chunk, loaded only there.
 */

import { lazy, Suspense, useEffect } from 'react';
import { COPY, type Locale } from '../shared/i18n';
import { Shell } from './components/Shell';
import { LocaleContext, rememberLocale, storedLocale } from './i18n';
import { HomePage } from './pages/HomePage';
import { DishPage } from './pages/DishPage';
import { PlacePage } from './pages/PlacePage';
import { SourcePage } from './pages/SourcePage';
import { ContributePage, NotFoundPage, WordsPage } from './pages/TextPages';
import { navigate, useLocation } from './router';
import { matchRoute, paths } from './routes';
import { ToastProvider } from './ui';

const SettingsPage = lazy(() => import('./settings/SettingsPage'));

const browserLocale = (): Locale => storedLocale() ?? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');

export default function App() {
  const { pathname } = useLocation();
  const route = matchRoute(pathname, browserLocale());
  const locale: Locale = route.page === 'settings' ? 'en' : route.locale;

  useEffect(() => {
    if (route.page === 'home' && pathname === '/') navigate(paths.home(locale), { replace: true });
  }, [route.page, pathname, locale]);

  useEffect(() => {
    document.documentElement.lang = COPY[locale].htmlLang;
    if (route.page !== 'settings' && route.page !== 'not-found' && storedLocale() !== locale) rememberLocale(locale);
  }, [locale, route.page]);

  if (route.page === 'settings') {
    return (
      <ToastProvider>
        <Suspense fallback={null}>
          <SettingsPage section={route.section} />
        </Suspense>
      </ToastProvider>
    );
  }

  return (
    <LocaleContext.Provider value={locale}>
      <ToastProvider>
        <Shell>
          {route.page === 'home' ? <HomePage /> : null}
          {route.page === 'place' ? <PlacePage key={route.id} id={route.id} /> : null}
          {route.page === 'dish' ? <DishPage key={route.key} dishKey={route.key} /> : null}
          {route.page === 'source' ? <SourcePage key={`${route.by}:${route.key}`} by={route.by} sourceKey={route.key} /> : null}
          {route.page === 'contribute' ? <ContributePage /> : null}
          {route.page === 'about' || route.page === 'privacy' ? <WordsPage which={route.page} /> : null}
          {route.page === 'not-found' ? <NotFoundPage /> : null}
        </Shell>
      </ToastProvider>
    </LocaleContext.Provider>
  );
}
