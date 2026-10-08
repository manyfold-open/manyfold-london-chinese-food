/**
 * How a record's values read in the console, by the type its kind's config gives each field
 * (kinds/): names and labels for closed lists, links for references and URLs, pounds for pence,
 * and lists (a menu's items) as JSON, folded.
 */

import type { ReactNode } from 'react';
import { KIND_CONFIGS } from '../../../kinds/index';
import { valueLabel, type FieldDef, type FieldValue, type Kind, type RecordData } from '../../shared/kinds';
import { displayUrl, price, safeHref } from '../format';
import { Icon } from '../ui';
import { plural, RecordLink } from './ui';

const json = (value: unknown) => <code className="json-inline">{JSON.stringify(value)}</code>;

/** An outside link, opened in a new tab without a referrer. */
export function SourceLink({ url }: { url: string }) {
  const href = safeHref(url);
  if (!href) return <span>{url || <span className="empty">None</span>}</span>;
  return (
    <a href={href} target="_blank" rel="nofollow ugc noopener noreferrer">
      {displayUrl(url)} <Icon name="external" size={12} />
    </a>
  );
}

const missing = (value: FieldValue | undefined): boolean => value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

export function FieldValueView({ def, value }: { def: FieldDef | undefined; value: FieldValue | undefined }): ReactNode {
  if (missing(value)) return <span className="empty">Not stated</span>;
  if (!def) return json(value);
  switch (def.type) {
    case 'ref':
      return typeof value === 'string' ? <RecordLink id={value} kind={def.to.length === 1 ? def.to[0] : undefined} /> : json(value);
    case 'url':
      return typeof value === 'string' ? <SourceLink url={value} /> : json(value);
    case 'enum': {
      if (typeof value !== 'string') return json(value);
      const label = valueLabel(def, value, 'en');
      return label === value ? value : (
        <>
          {label} <span className="muted">({value})</span>
        </>
      );
    }
    case 'tags':
      return Array.isArray(value) ? value.map((item) => valueLabel(def, String(item), 'en')).join(', ') : json(value);
    case 'number':
      return typeof value === 'number' && def.display === 'pence' ? `${price(value)} (${value})` : String(value);
    case 'list':
      return Array.isArray(value) ? (
        <details className="json-fold">
          <summary>{plural(value.length, 'item')}</summary>
          <pre className="json">{JSON.stringify(value, null, 2)}</pre>
        </details>
      ) : (
        json(value)
      );
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : json(value);
  }
}

/** Every field a kind declares, in order, then any the record holds that the config does not name. */
export function fieldsOf(kind: Kind, data: RecordData): { name: string; label: string; def: FieldDef | undefined; value: FieldValue | undefined }[] {
  const config = KIND_CONFIGS[kind];
  const declared = Object.entries(config.fields).map(([name, def]) => ({ name, label: def.label.en, def, value: data[name] }));
  const extra = Object.keys(data)
    .filter((name) => !(name in config.fields))
    .map((name) => ({ name, label: name, def: undefined, value: data[name] }));
  return [...declared, ...extra];
}

/** A few lines that say what a record holds: the fields agents set that have a value, lists counted. */
export function FieldSummary({ kind, data, max = 5 }: { kind: Kind; data: RecordData; max?: number }) {
  const shown = fieldsOf(kind, data)
    .filter((field) => !field.def?.server && !missing(field.value))
    .slice(0, max);
  if (shown.length === 0) return null;
  return (
    <dl className="summary">
      {shown.map((field) => (
        <div key={field.name}>
          <dt>{field.label}</dt>
          <dd>
            {field.def?.type === 'list' && Array.isArray(field.value) ? plural(field.value.length, 'item') : <FieldValueView def={field.def} value={field.value} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A record's text value, or ''. */
export const textOf = (data: RecordData, field: string): string => {
  const value = data[field];
  return typeof value === 'string' ? value : '';
};
