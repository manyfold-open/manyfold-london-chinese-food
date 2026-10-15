/**
 * The frame of every reader page: the top bar with the site's sections, the page, the footer, and
 * on a phone a tab bar along the bottom, the way the app's main sections are reached by thumb.
 */

import type { ReactNode } from 'react';
import { useLocale, useCopy, otherLocalePath, rememberLocale } from '../i18n';
import { Link, useLocation } from '../router';
import { paths } from '../routes';
import { useTheme } from '../theme';
import { Icon, IconButton, Logo, ManyfoldMark, Menu, type IconName } from '../ui';
import { ConsentBar } from './Consent';

interface Section {
  key: string;
  href: string;
  label: string;
  icon: IconName;
  /** Paths under this section, so a place reached from the map keeps no tab lit but a dish keeps Dishes. */
  under: readonly string[];
}

export function Shell({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const copy = useCopy();
  const { pathname, search } = useLocation();
  const [theme, toggleTheme] = useTheme();
  const other = locale === 'zh' ? 'en' : 'zh';
  const switchHref = `${otherLocalePath(pathname, other)}${search}`;
  const tabs: Section[] = [
    { key: 'home', href: paths.home(locale), label: copy.nav.home, icon: 'home', under: [] },
    { key: 'map', href: paths.map(locale), label: copy.nav.map, icon: 'map', under: [`/${locale}/line/`, `/${locale}/near/`] },
    { key: 'dishes', href: paths.dishes(locale), label: copy.nav.dishes, icon: 'bowl', under: [`/${locale}/dish/`] },
    { key: 'guides', href: paths.guides(locale), label: copy.nav.guides, icon: 'book', under: [`/${locale}/guide/`] },
  ];
  const more = [
    { key: 'light-up', href: paths.lightUp(locale), label: copy.nav.lightUp },
    { key: 'contribute', href: paths.page(locale, 'contribute'), label: copy.nav.contribute },
    { key: 'about', href: paths.page(locale, 'about'), label: copy.nav.about },
  ];
  const current = (section: Section) => pathname === section.href || section.under.some((prefix) => pathname.startsWith(prefix));

  return (
    <div className="site">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href={paths.home(locale)} aria-label={copy.siteName}>
            <Logo name={copy.brand.name} sub={copy.brand.sub} />
          </Link>
          <nav className="topnav" aria-label={copy.siteShort}>
            {tabs.map((section) => (
              <Link key={section.key} href={section.href} aria-current={current(section) ? 'page' : undefined}>
                {section.label}
              </Link>
            ))}
            {more.slice(0, 2).map(({ key, href, label }) => (
              <Link key={key} href={href} aria-current={pathname === href ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
          <span className="grow" />
          <Link className="lang-switch" href={switchHref} lang={other === 'zh' ? 'zh-Hans' : 'en'} onClick={() => rememberLocale(other)}>
            <span className="lang-long">{copy.switchTo}</span>
            <span className="lang-short">{other === 'zh' ? '中' : 'EN'}</span>
          </Link>
          <IconButton label={theme === 'dark' ? copy.theme.light : copy.theme.dark} icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggleTheme} />
          {/* A phone's top bar has no room for the sections the tab bar leaves out: they fold into this menu. */}
          <nav className="topnav-phone" aria-label={copy.siteShort}>
            <Menu
              label={copy.nav.menu}
              icon="more"
              iconOnly
              end
              items={more.map(({ key, href, label }) => ({ key, label, href, app: true, current: pathname === href }))}
            />
          </nav>
        </div>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-foot">
        <div className="site-foot-inner">
          <p>
            <b>{copy.brand.motto}</b> {copy.attribution}
          </p>
          <p className="foot-links">
            <Link href={paths.page(locale, 'about')}>{copy.nav.about}</Link>
            <Link href={paths.page(locale, 'contribute')}>{copy.nav.contribute}</Link>
            <Link href={paths.page(locale, 'privacy')}>{copy.privacy.title}</Link>
            <a href="https://github.com/manyfold-open/manyfold-london-chinese-food" rel="noopener">
              GitHub <Icon name="external" size={12} />
            </a>
            <a className="powered" href="https://manyfold.ai" rel="noopener">
              <ManyfoldMark size={12} /> Manyfold
            </a>
          </p>
        </div>
      </footer>
      <nav className="tabbar" aria-label={copy.siteShort}>
        {tabs.map((section) => (
          <Link key={section.key} href={section.href} aria-current={current(section) ? 'page' : undefined}>
            <Icon name={section.icon} size={22} />
            {section.label}
          </Link>
        ))}
      </nav>
      <ConsentBar />
    </div>
  );
}
