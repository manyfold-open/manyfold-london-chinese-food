/** The pages that are mostly words: contribute, about, privacy, and not found. */

import { useState } from 'react';
import { appUrl } from '../base';
import { useCopy, useLocale } from '../i18n';
import { Link } from '../router';
import { paths } from '../routes';
import { Button, Icon, useToast } from '../ui';

export function ContributePage() {
  const copy = useCopy();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const skill = new URL(appUrl('/SKILL.md'), location.href).toString();
  const instruction = `Read ${skill} and contribute to London Chinese Food as a collector.`;
  return (
    <div className="text-page screen">
      <header className="page-head">
        <h1>{copy.contribute.title}</h1>
        <p className="desc">{copy.contribute.lead}</p>
      </header>
      <section className="section contribute">
        <h2>
          <Icon name="bot" /> {copy.contribute.agentTitle}
        </h2>
        <p>{copy.contribute.agentText}</p>
        <div className="instruction">
          <code>{instruction}</code>
          <Button
            variant="primary"
            className={copied ? 'done' : undefined}
            icon={copied ? 'check' : undefined}
            onClick={() => {
              void navigator.clipboard?.writeText(instruction);
              setCopied(true);
              toast(copy.contribute.copied);
            }}
          >
            {copied ? copy.contribute.copied : copy.contribute.copy}
          </Button>
        </div>
        <p>
          <a href={skill} target="_blank" rel="noopener">
            {copy.contribute.skill} <Icon name="external" size={12} />
          </a>
        </p>
      </section>
      <section className="section">
        <h2>
          <Icon name="camera" /> {copy.contribute.photosTitle}
        </h2>
        <p>{copy.contribute.photosText}</p>
      </section>
    </div>
  );
}

export function WordsPage({ which }: { which: 'about' | 'privacy' }) {
  const copy = useCopy();
  const words = copy[which];
  return (
    <div className="text-page screen">
      <header className="page-head">
        <h1>{words.title}</h1>
      </header>
      {words.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {which === 'about' ? (
        <section className="section">
          <h2>
            <Icon name="download" /> {copy.about.dataTitle}
          </h2>
          <p>{copy.about.dataText}</p>
          <ul className="downloads">
            <li>
              <a href={appUrl('/export/places.csv')} download>
                {copy.about.downloads.csv}
              </a>
            </li>
            <li>
              <a href={appUrl('/export/places.json')} download>
                {copy.about.downloads.json}
              </a>
            </li>
            <li>
              <a href={appUrl('/export/menus.jsonl.gz')} download>
                {copy.about.downloads.menus}
              </a>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function NotFoundPage() {
  const copy = useCopy();
  const locale = useLocale();
  return (
    <div className="text-page screen">
      <header className="page-head">
        <h1>{copy.notFound.title}</h1>
        <p className="desc">{copy.notFound.text}</p>
      </header>
      <p>
        <Link href={paths.home(locale)}>{copy.notFound.home}</Link>
      </p>
    </div>
  );
}
