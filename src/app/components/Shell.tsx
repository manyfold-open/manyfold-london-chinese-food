/** The frame of every reader page: the top bar, the page, the footer. */

import type { ReactNode } from 'react';
import { useLocale, useCopy, otherLocalePath, rememberLocale } from '../i18n';
import { Link, navigate, useLocation } from '../router';
import { paths } from '../routes';
import { useTheme } from '../theme';
import { Icon, IconButton, Logo, ManyfoldMark } from '../ui';

export function Shell({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const copy = useCopy();
  const { pathname, search } = useLocation();
  const [theme, toggleTheme] = useTheme();
  const other = locale === 'zh' ? 'en' : 'zh';
  const switchHref = `${otherLocalePath(pathname, other)}${search}`;

  return (
    <div className="site">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href={paths.home(locale)} aria-label={copy.siteName}>
            <Logo name={copy.siteShort} />
          </Link>
          <span className="grow" />
          <nav className="topnav" aria-label={copy.siteShort}>
            <Link href={paths.page(locale, 'contribute')}>{copy.nav.contribute}</Link>
            <Link href={paths.page(locale, 'about')}>{copy.nav.about}</Link>
          </nav>
          <a
            className="lang-switch"
            href={switchHref}
            lang={other === 'zh' ? 'zh-Hans' : 'en'}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              rememberLocale(other);
              navigate(switchHref);
            }}
          >
            {copy.switchTo}
          </a>
          <IconButton
            label={theme === 'dark' ? copy.theme.light : copy.theme.dark}
            icon={theme === 'dark' ? 'sun' : 'moon'}
            onClick={toggleTheme}
          />
        </div>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-foot">
        <div className="site-foot-inner">
          <p>{copy.attribution}</p>
          <p className="foot-links">
            <Link href={paths.page(locale, 'about')}>{copy.nav.about}</Link>
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
    </div>
  );
}
