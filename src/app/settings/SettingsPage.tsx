/**
 * /settings: the admin console, in English, outside the reader's frame. One password (the
 * ADMIN_PASSWORD secret) opens it, and a session cookie keeps it open in this browser for 14 days
 * (adminApi.ts): reloads stay signed in; Lock, or a new password, signs out. Sections live at
 * /settings/<section>; the kind a section shows is ?kind=<kind>, and an open record is
 * ?record=<id>.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import './settings.css';
import { KIND_CONFIGS } from '../../../kinds/index';
import { COPY } from '../../shared/i18n';
import { KINDS, type Kind } from '../../shared/kinds';
import { ApiError } from '../api';
import { Link, navigate, useLocation } from '../router';
import { paths } from '../routes';
import { useTheme } from '../theme';
import { Button, IconButton, Logo, Select } from '../ui';
import ActivitySection from './ActivitySection';
import { hasSession, lock, signIn, whenLocked } from './adminApi';
import BlockedHostsSection from './BlockedHostsSection';
import IllustrationsSection from './IllustrationsSection';
import OverviewSection from './OverviewSection';
import PhotosSection from './PhotosSection';
import RecordsSection from './RecordsSection';
import ReviewSection from './ReviewSection';
import SpotCheckSection from './SpotCheckSection';
import TokensSection from './TokensSection';
import { Field, isKind, messageOf, useCellLabels, type Nav, type Patch } from './ui';
import WorkSection from './WorkSection';

const SITE = COPY.en.siteShort;

/**
 * `kinds`: 'any' sections show one kind or all of them, 'one' sections always one kind, 'none'
 * sections are not about a kind.
 */
const SECTIONS = [
  { id: 'overview', label: 'Overview', kinds: 'none' },
  { id: 'review', label: 'Review', kinds: 'any' },
  { id: 'records', label: 'Records', kinds: 'any' },
  { id: 'photos', label: 'Photos', kinds: 'none' },
  { id: 'illustrations', label: 'Illustrations', kinds: 'none' },
  { id: 'work', label: 'Work', kinds: 'none' },
  { id: 'tokens', label: 'Tokens', kinds: 'none' },
  { id: 'activity', label: 'Activity', kinds: 'any' },
  { id: 'spot-check', label: 'Spot-check', kinds: 'one' },
  { id: 'blocked-hosts', label: 'Blocked hosts', kinds: 'none' },
] as const;

type Section = (typeof SECTIONS)[number];

const ALL = 'all';
const KIND_OPTIONS = KINDS.map((kind) => ({ value: kind, label: KIND_CONFIGS[kind].title.en }));
const ANY_KIND_OPTIONS = [{ value: ALL, label: 'All kinds' }, ...KIND_OPTIONS];

function Gate({ onOpen, problem }: { onOpen: () => void; problem: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(problem);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(password);
      setPassword('');
      onOpen();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 401 ? 'That is not the admin password.' : messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel gate" onSubmit={(event) => void submit(event)}>
      <h1>Settings</h1>
      <p className="muted">
        For the admin of {SITE}. This browser stays signed in for 14 days, until you press Lock or the password changes; the password itself is not stored.
      </p>
      <Field label="Admin password">
        <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
      </Field>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={busy || !password}>
        {busy ? 'Checking…' : 'Open settings'}
      </Button>
    </form>
  );
}

function NotFound() {
  return (
    <section className="panel gate">
      <h1>No such section</h1>
      <p className="muted">There is no settings section by that name.</p>
      <p>
        <Link href="/settings/overview">Go to the overview</Link>
      </p>
    </section>
  );
}

export default function SettingsPage({ section }: { section: string | null }) {
  const { search } = useLocation();
  // null while the session cookie is being checked.
  const [open, setOpen] = useState<boolean | null>(null);
  const [problem, setProblem] = useState('');
  const [theme, toggleTheme] = useTheme();
  const root = useRef<HTMLElement>(null);
  const current: Section | undefined = SECTIONS.find((entry) => entry.id === (section ?? 'overview'));

  useEffect(() => {
    whenLocked(() => setOpen(false));
    let live = true;
    hasSession()
      .then((signedIn) => {
        if (live) setOpen(signedIn);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setProblem(messageOf(failure));
        setOpen(false);
      });
    return () => {
      live = false;
      whenLocked(null);
    };
  }, []);

  useEffect(() => {
    document.title = `${current ? `${current.label} · ` : ''}Settings · ${SITE}`;
  }, [current]);

  useCellLabels(root, open === true);

  // On a phone the section tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    const nav = root.current?.querySelector<HTMLElement>('.settings-nav');
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && tab) nav.scrollLeft = tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2;
  }, [open, section]);

  const params = new URLSearchParams(search);
  const named = params.get('kind');
  const kind: Kind | null = isKind(named) ? named : null;

  let content;
  if (!current) content = <NotFound />;
  else if (open === null) content = <p className="muted">Checking your session…</p>;
  else if (!open) content = <Gate problem={problem} onOpen={() => setOpen(true)} />;
  else {
    const at = (id: Section['id'], query: URLSearchParams) => {
      const text = query.toString();
      return `/settings/${id}${text ? `?${text}` : ''}`;
    };
    const href = (patch: Patch) => {
      const next = new URLSearchParams(search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      return at(current.id, next);
    };
    const nav: Nav = { params, href, go: (patch) => navigate(href(patch)) };
    // A kind chosen in one section stays chosen in the others that show kinds.
    const tabHref = (entry: Section) => at(entry.id, new URLSearchParams(entry.kinds !== 'none' && kind ? { kind } : {}));

    let body;
    switch (current.id) {
      case 'overview':
        body = <OverviewSection />;
        break;
      case 'review':
        body = <ReviewSection key={kind ?? ALL} kind={kind} />;
        break;
      case 'records':
        body = <RecordsSection key={kind ?? ALL} kind={kind} nav={nav} />;
        break;
      case 'photos':
        body = <PhotosSection nav={nav} />;
        break;
      case 'illustrations':
        body = <IllustrationsSection nav={nav} />;
        break;
      case 'work':
        body = <WorkSection nav={nav} />;
        break;
      case 'tokens':
        body = <TokensSection />;
        break;
      case 'activity':
        body = <ActivitySection key={kind ?? ALL} kind={kind} nav={nav} />;
        break;
      case 'spot-check':
        body = <SpotCheckSection key={kind ?? 'place'} kind={kind ?? 'place'} />;
        break;
      case 'blocked-hosts':
        body = <BlockedHostsSection />;
        break;
    }

    content = (
      <>
        <div className="settings-bar">
          <nav className="settings-nav" aria-label="Settings">
            {SECTIONS.map((entry) => (
              <Link key={entry.id} href={tabHref(entry)} aria-current={entry.id === current.id ? 'page' : undefined}>
                {entry.label}
              </Link>
            ))}
          </nav>
          <div className="settings-tools">
            {current.kinds === 'any' ? (
              <Select
                label="Kind of record"
                value={kind ?? ALL}
                options={ANY_KIND_OPTIONS}
                onChange={(next) => navigate(at(current.id, new URLSearchParams(next === ALL ? {} : { kind: next })))}
              />
            ) : current.kinds === 'one' ? (
              <Select
                label="Kind of record"
                value={kind ?? 'place'}
                options={KIND_OPTIONS}
                onChange={(next) => navigate(at(current.id, new URLSearchParams({ kind: next })))}
              />
            ) : null}
            <Button onClick={lock}>Lock</Button>
          </div>
        </div>
        {body}
      </>
    );
  }

  return (
    <div className="site settings-site">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href={paths.home('en')} aria-label={COPY.en.siteName}>
            <Logo name={SITE} />
          </Link>
          <span className="topbar-app">Settings</span>
          <span className="grow" />
          <IconButton label={theme === 'dark' ? 'Light theme' : 'Dark theme'} icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggleTheme} end />
        </div>
      </header>
      <main ref={root} className="site-main settings">
        {content}
      </main>
    </div>
  );
}
