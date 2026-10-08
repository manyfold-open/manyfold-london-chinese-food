/**
 * What the site holds, one config per kind of record (kinds/): a place, a brand, a menu, a
 * review excerpt, a photo, an illustration. Validation, identity, the skills agents read and
 * the console's forms all derive from these configs, so they cannot drift apart.
 *
 * This module runs in the browser, the Worker and Node scripts. It imports nothing but its
 * siblings, with explicit extensions, and sticks to syntax Node can strip.
 */

import { findRating } from './rating-guard.ts';

/* ───────── config ───────── */

export type Kind = 'place' | 'brand' | 'menu' | 'review' | 'photo' | 'illustration';
export const KINDS: readonly Kind[] = ['place', 'brand', 'menu', 'review', 'photo', 'illustration'];

/** A label in both of the site's languages. A missing one is a type error. */
export interface Bilingual {
  en: string;
  zh: string;
}

interface FieldBase {
  label: Bilingual;
  required?: boolean;
  /** One line, for agents (English), on what belongs in the field. */
  help?: string;
  /** Set by the server; agents may not send it. */
  server?: boolean;
}

export interface TextField extends FieldBase {
  type: 'text';
  max: number;
  /** A regular expression (its source) the cleaned text must match, and what it means. */
  pattern?: { source: string; means: string };
}

export interface EnumField extends FieldBase {
  type: 'enum';
  values: readonly string[];
  valueLabels: Readonly<Record<string, Bilingual>>;
}

/** Several values from a closed list. */
export interface TagsField extends FieldBase {
  type: 'tags';
  max: number;
  values: readonly string[];
  valueLabels: Readonly<Record<string, Bilingual>>;
}

/** A date, YYYY-MM-DD, or with `partial` also YYYY-MM or YYYY when that is all a page says. */
export interface DateField extends FieldBase {
  type: 'date';
  partial?: boolean;
}

export interface NumberField extends FieldBase {
  type: 'number';
  min?: number;
  max?: number;
  integer?: boolean;
  /** How pages print it: pence as pounds (1280 → £12.80), or as written. */
  display?: 'pence' | 'plain';
}

export interface UrlField extends FieldBase {
  type: 'url';
  /** Keep only the site's home page, so one site is one value. */
  homePage?: boolean;
  /** Hosts the URL must be on, e.g. web archives. */
  hosts?: readonly string[];
}

/** A UK postcode, stored as "W1D 6PQ". Whether it is in London is the Worker's question. */
export interface PostcodeField extends FieldBase {
  type: 'postcode';
}

/**
 * Another record, by id (rec_...). In a submitted batch it may also be "#n", the record at
 * index n of the same batch, so a new place and its reviews can arrive together.
 */
export interface RefField extends FieldBase {
  type: 'ref';
  to: readonly Kind[];
}

export type ScalarField = TextField | EnumField | TagsField | DateField | NumberField | UrlField;

/** A list of objects, such as a menu's items. Each item's fields are scalars. */
export interface ListField extends FieldBase {
  type: 'list';
  max: number;
  item: Readonly<Record<string, ScalarField>>;
  /** At least one of these item fields must be given in each item. */
  oneOf?: readonly string[];
}

export type FieldDef = ScalarField | PostcodeField | RefField | ListField;
export type FieldType = FieldDef['type'];

/** Rules between fields, declared so the skill can say them in words and validateConfig can check them. */
export type Rule =
  /** These fields (or '$evidence', or 'list.subfield') may not hold a reviewer's rating. */
  | { rule: 'noRating'; fields: readonly string[] }
  /** At least one of these fields is required. */
  | { rule: 'oneOf'; fields: readonly string[] }
  /** `field` is required when every field in `when` has the value given. */
  | { rule: 'requiredWhen'; field: string; when: Readonly<Record<string, string>> }
  /** `field` may only be given when `by` has one of `values`. */
  | { rule: 'onlyWhen'; field: string; by: string; values: readonly string[] }
  /** `field` is a translation of the evidence: written in the other script than `language` says. */
  | { rule: 'translation'; field: string; language: string };

/** A part of a record's identity: a field, the first present of several, or its provenance. */
export type IdentityPart = string | { firstOf: readonly string[] } | '$source_url' | '$evidence';

/**
 * How a record shows where it came from:
 *   quote    a page and a short passage from it that states the facts (a place, a menu)
 *   excerpt  a page and the passage that is itself the content (a review excerpt)
 *   upload   an image sent to the site (a visitor's photo, an agent's illustration)
 */
export type ProvenanceMode = 'quote' | 'excerpt' | 'upload';

export interface KindConfig {
  kind: Kind;
  title: Bilingual;
  noun: { en: { one: string; other: string }; zh: string };
  fields: Readonly<Record<string, FieldDef>>;
  /** The ref field naming the record this one belongs to. Its tasks wait while that is pending. */
  parent?: string;
  /** What makes two records the same. Empty: every record is its own (photos). */
  identity: readonly IdentityPart[];
  provenance: ProvenanceMode;
  /** Who sends records of this kind, and through which route. */
  submit: 'agents' | 'agent-uploads' | 'visitor-uploads';
  /** Longest excerpt, by script: CJK text says more per character. */
  excerptMax?: { latin: number; cjk: number };
  rules?: readonly Rule[];
  /** Submissions must fall inside these ranges, read at submit time ('today' included). */
  accept?: Readonly<Record<string, { from?: string; to?: string }>>;
  /** Whether a newer version may be proposed for a live record of this kind. */
  updatable: boolean;
  /** Days after which a verified record is checked again; null: never (reviews are history). */
  recheckAfterDays: number | null;
  /** Records a new collector may have waiting for review, and the most it can grow to. */
  pendingCap: { start: number; max: number };
  /** Most live records with the same parent and the same value of a field (reviews: per source). */
  perParent?: { field: string; max: number };
  /** One realistic record, shown to agents. Must itself validate. */
  example: { data: Readonly<Record<string, unknown>>; source_url: string; evidence: string };
  scope: { in: string; out: string };
  sourceHints: readonly string[];
  /** What a maintainer checks, item by item. */
  maintainerChecks: readonly string[];
  /** The fields that name a record, in order of preference. */
  display: readonly string[];
}

/** Returns the config unchanged, with its literal types kept. validateConfig() checks it. */
export function defineKind<const T extends KindConfig>(config: T): T {
  return config;
}

const FIELD = /^[a-z][a-z0-9_]{0,31}$/;
const RESERVED_FIELDS: readonly string[] = ['id', 'status', 'kind', 'q', 'sort', 'page', 'limit'];

/** Everything wrong with a config, as readable lines. Empty means valid. */
export function validateConfig(config: KindConfig, all: readonly KindConfig[] = []): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(`${config.kind}: ${message}`);
  const kinds = new Set(all.map((other) => other.kind));

  const checkScalar = (where: string, def: ScalarField) => {
    if ((def.type === 'enum' || def.type === 'tags') && def.values.length === 0) fail(`${where} needs values`);
    if (def.type === 'enum' || def.type === 'tags') {
      for (const value of def.values) {
        if (!def.valueLabels[value]) fail(`${where}: value "${value}" has no label`);
      }
    }
    if (def.type === 'text' && def.pattern) {
      try {
        new RegExp(def.pattern.source, 'u');
      } catch {
        fail(`${where}: pattern does not compile`);
      }
    }
  };

  for (const [name, def] of Object.entries(config.fields)) {
    if (!FIELD.test(name)) fail(`field "${name}" must start with a letter and use a-z, 0-9 and _`);
    if (RESERVED_FIELDS.includes(name)) fail(`field "${name}" is a reserved name`);
    if (def.server && def.required) fail(`field "${name}" cannot be both server-set and required`);
    if (def.type === 'ref') {
      for (const target of def.to) if (kinds.size > 0 && !kinds.has(target)) fail(`field "${name}" refers to unknown kind ${target}`);
    } else if (def.type === 'list') {
      for (const [sub, subDef] of Object.entries(def.item)) {
        if (!FIELD.test(sub)) fail(`field "${name}.${sub}" must start with a letter and use a-z, 0-9 and _`);
        checkScalar(`field "${name}.${sub}"`, subDef);
      }
      for (const sub of def.oneOf ?? []) if (!(sub in def.item)) fail(`field "${name}": oneOf names unknown item field "${sub}"`);
    } else if (def.type !== 'postcode') {
      checkScalar(`field "${name}"`, def);
    }
  }

  const need = (name: string, where: string, types?: readonly FieldType[]) => {
    if (name === '$evidence' || name === '$source_url') return;
    const [top, sub] = name.split('.');
    const def = config.fields[top!];
    if (!def) return fail(`${where} names unknown field "${name}"`);
    if (sub !== undefined) {
      if (def.type !== 'list' || !(sub in def.item)) fail(`${where} names unknown item field "${name}"`);
      return;
    }
    if (types && !types.includes(def.type)) fail(`${where} needs a ${types.join(' or ')} field, but "${name}" is ${def.type}`);
  };

  if (config.parent !== undefined) need(config.parent, 'parent', ['ref']);
  for (const part of config.identity) {
    if (typeof part === 'string') need(part, 'identity');
    else part.firstOf.forEach((name) => need(name, 'identity'));
  }
  for (const rule of config.rules ?? []) {
    if (rule.rule === 'noRating' || rule.rule === 'oneOf') rule.fields.forEach((name) => need(name, rule.rule));
    else if (rule.rule === 'requiredWhen') {
      need(rule.field, 'requiredWhen');
      Object.keys(rule.when).forEach((name) => need(name, 'requiredWhen', ['enum']));
    } else if (rule.rule === 'onlyWhen') {
      need(rule.field, 'onlyWhen');
      need(rule.by, 'onlyWhen', ['enum']);
    } else {
      need(rule.field, 'translation', ['text']);
      need(rule.language, 'translation', ['enum']);
    }
  }
  for (const name of Object.keys(config.accept ?? {})) need(name, 'accept', ['date']);
  if (config.perParent) need(config.perParent.field, 'perParent');
  config.display.forEach((name) => need(name, 'display'));
  if (config.provenance === 'excerpt' && !config.excerptMax) fail('an excerpt kind needs excerptMax');
  if (config.provenance === 'upload' && config.submit === 'agents') fail('an upload kind is submitted through an upload route');

  if (config.submit === 'agents') {
    const example = validateRecordData(config, config.example.data);
    if (!example.ok) fail(`example: ${example.errors.map((error) => `${error.field} ${error.message}`).join('; ')}`);
    else {
      const provenance = validateProvenance(config, config.example);
      if (!provenance.ok) fail(`example: ${provenance.errors.map((error) => `${error.field} ${error.message}`).join('; ')}`);
    }
  }
  return problems;
}

/* ───────── values ───────── */

export type ScalarValue = string | number | string[];
export type ListItem = Record<string, ScalarValue>;
export type FieldValue = ScalarValue | ListItem[];
export type RecordData = Record<string, FieldValue>;

export interface FieldError {
  field: string;
  message: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

// Control characters (tab and newline excepted, then collapsed) and invisible format
// characters that can hide text from a reader. Removed from every text value.
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** One line of plain text: invisible characters removed, whitespace collapsed. */
export const cleanText = (value: string): string => value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** True for YYYY-MM-DD, YYYY-MM or YYYY. */
export function isPartialDate(value: string): boolean {
  if (/^\d{4}$/.test(value)) return Number(value) >= 1900;
  if (/^\d{4}-\d{2}$/.test(value)) return isIsoDate(`${value}-01`);
  return isIsoDate(value);
}

const RELATIVE = /^today([+-])(\d{1,4})$/;

/** The date a bound stands for, read against `today` (YYYY-MM-DD, UTC). */
export function resolveDateBound(bound: string, today: string): string {
  if (bound === 'today') return today;
  const match = RELATIVE.exec(bound);
  if (!match) return bound;
  const days = Number(match[2]) * (match[1] === '-' ? -1 : 1);
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A value quoted back in an error message, kept short. */
const show = (value: unknown): string => {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(JSON.stringify(value) ?? value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/** An https URL with a dotted host and no credentials, or null. */
export function parseHttpsUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null;
  return url.toString();
}

const POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

/** A UK postcode in its written form ("W1D 6PQ"), or null. */
export function canonicalPostcode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const match = POSTCODE.exec(compact);
  return match ? `${match[1]} ${match[2]}` : null;
}

/** A record id, as the server makes them. */
export const RECORD_ID = /^rec_[0-9a-z]{26}$/;
/** A reference to an earlier record of the same batch. */
export const BATCH_REF = /^#(\d{1,2})$/;

type Checked = { value: ScalarValue } | string;

function checkScalar(def: ScalarField, raw: unknown): Checked {
  switch (def.type) {
    case 'text': {
      if (typeof raw !== 'string') return `must be text; got ${show(raw)}`;
      const text = cleanText(raw);
      if (!text) return 'is empty once invisible characters are removed';
      if (text.length > def.max) return `must be at most ${def.max} characters; got ${text.length}`;
      if (def.pattern && !new RegExp(def.pattern.source, 'u').test(text)) return `must be ${def.pattern.means}; got ${show(text)}`;
      return { value: text };
    }
    case 'enum':
      if (typeof raw !== 'string' || !def.values.includes(raw)) return `must be one of ${def.values.join(', ')}; got ${show(raw)}`;
      return { value: raw };
    case 'tags': {
      if (!Array.isArray(raw)) return `must be a list of values from: ${def.values.join(', ')}; got ${show(raw)}`;
      const tags: string[] = [];
      for (const tag of raw) {
        if (typeof tag !== 'string' || !def.values.includes(tag)) return `each value must be one of ${def.values.join(', ')}; got ${show(tag)}`;
        if (!tags.includes(tag)) tags.push(tag);
      }
      if (tags.length === 0) return 'is an empty list';
      if (tags.length > def.max) return `must have at most ${def.max} values; got ${tags.length}`;
      return { value: tags };
    }
    case 'date':
      if (typeof raw !== 'string' || !(def.partial ? isPartialDate(raw) : isIsoDate(raw))) {
        return def.partial
          ? `must be a date written YYYY-MM-DD, or YYYY-MM or YYYY when the page gives no day; got ${show(raw)}`
          : `must be a date written YYYY-MM-DD; got ${show(raw)}`;
      }
      return { value: raw };
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return `must be a number; got ${show(raw)}`;
      if (def.integer && !Number.isInteger(raw)) {
        return def.display === 'pence' ? `must be a whole number of pence (£12.80 is 1280); got ${raw}` : `must be a whole number; got ${raw}`;
      }
      if (def.min !== undefined && raw < def.min) return `must be at least ${def.min}; got ${raw}`;
      if (def.max !== undefined && raw > def.max) return `must be at most ${def.max}; got ${raw}`;
      return { value: raw };
    case 'url': {
      const url = typeof raw === 'string' ? parseHttpsUrl(raw) : null;
      if (!url) return `must be a full https:// URL; got ${show(raw)}`;
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      if (def.hosts && !def.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
        return `must be on ${def.hosts.join(', ')}; got ${show(raw)}`;
      }
      return { value: def.homePage ? `${new URL(url).origin}/` : url };
    }
  }
}

/** Most item errors reported for one list, so a broken menu does not flood the answer. */
const LIST_ERRORS_MAX = 20;

function checkField(name: string, def: FieldDef, raw: unknown, errors: FieldError[]): FieldValue | undefined {
  if (def.type === 'postcode') {
    const postcode = typeof raw === 'string' ? canonicalPostcode(raw) : null;
    if (!postcode) {
      errors.push({ field: name, message: `must be a UK postcode such as "W1D 6PQ"; got ${show(raw)}` });
      return undefined;
    }
    return postcode;
  }
  if (def.type === 'ref') {
    if (typeof raw !== 'string' || !(RECORD_ID.test(raw) || BATCH_REF.test(raw))) {
      errors.push({
        field: name,
        message: `must be the id of a ${def.to.join(' or ')} record (rec_...), or "#n" for record n of this batch; got ${show(raw)}`,
      });
      return undefined;
    }
    return raw;
  }
  if (def.type === 'list') {
    if (!Array.isArray(raw)) {
      errors.push({ field: name, message: `must be a list of objects; got ${show(raw)}` });
      return undefined;
    }
    if (raw.length === 0) {
      errors.push({ field: name, message: 'is an empty list' });
      return undefined;
    }
    if (raw.length > def.max) {
      errors.push({ field: name, message: `must have at most ${def.max} items; got ${raw.length}` });
      return undefined;
    }
    const itemErrors: FieldError[] = [];
    const items: ListItem[] = raw.map((entry, index) => {
      const path = `${name}[${index}]`;
      const item: ListItem = {};
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        itemErrors.push({ field: path, message: 'must be an object' });
        return item;
      }
      const source = entry as Record<string, unknown>;
      for (const key of Object.keys(source)) {
        if (!(key in def.item)) {
          itemErrors.push({ field: `${path}.${key}`, message: `is not an item field; item fields are ${Object.keys(def.item).join(', ')}` });
        }
      }
      for (const [sub, subDef] of Object.entries(def.item)) {
        const value = source[sub];
        if (value === undefined || value === null || value === '') {
          if (subDef.required) itemErrors.push({ field: `${path}.${sub}`, message: 'is required' });
          continue;
        }
        const checked = checkScalar(subDef, value);
        if (typeof checked === 'string') itemErrors.push({ field: `${path}.${sub}`, message: checked });
        else item[sub] = checked.value;
      }
      if (def.oneOf && !def.oneOf.some((sub) => item[sub] !== undefined)) {
        itemErrors.push({ field: path, message: `needs at least one of ${def.oneOf.join(', ')}` });
      }
      return item;
    });
    if (itemErrors.length > 0) {
      errors.push(...itemErrors.slice(0, LIST_ERRORS_MAX));
      if (itemErrors.length > LIST_ERRORS_MAX) {
        errors.push({ field: name, message: `and ${itemErrors.length - LIST_ERRORS_MAX} more item errors like these` });
      }
      return undefined;
    }
    return items;
  }
  const checked = checkScalar(def, raw);
  if (typeof checked === 'string') {
    errors.push({ field: name, message: checked });
    return undefined;
  }
  return checked.value;
}

/** The texts a field holds, list items included: what the rating guard and the flag check read. */
function textsOfField(value: FieldValue | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [];
  return (value as unknown[]).flatMap((entry) =>
    typeof entry === 'string' ? [entry] : Object.values(entry as ListItem).flatMap((inner) => (typeof inner === 'string' ? [inner] : Array.isArray(inner) ? inner : [])),
  );
}

/** Every text in a record, for the check that looks for text aimed at agents. */
export const textsOf = (data: RecordData): string[] => Object.values(data).flatMap((value) => textsOfField(value));

/** Whether CJK characters make up a good part of a text: it then says more per character. */
export function isMostlyCjk(text: string): boolean {
  const letters = text.replace(/[\s\p{P}\p{S}\d]/gu, '');
  if (!letters) return false;
  const cjk = letters.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  return cjk / letters.length >= 0.3;
}

/** The value of `field`, or of an item field 'list.sub' across every item. */
const valuesAt = (data: RecordData, field: string): { path: string; text: string }[] => {
  const [top, sub] = field.split('.');
  const value = data[top!];
  if (sub === undefined) return textsOfField(value).map((text) => ({ path: field, text }));
  if (!Array.isArray(value)) return [];
  return (value as ListItem[]).flatMap((item, index) => {
    const inner = item[sub];
    return typeof inner === 'string' ? [{ path: `${top}[${index}].${sub}`, text: inner }] : [];
  });
};

export interface ValidateOptions {
  /** Accept server-set fields (the server re-validating what it stored). */
  allowServer?: boolean;
}

/**
 * Checks a record's field values against its kind and returns the cleaned values. Messages are
 * written for agents: each names the field, the rule and what it got. Rules that involve the
 * evidence are checked by validateProvenance.
 */
export function validateRecordData(config: KindConfig, input: unknown, options: ValidateOptions = {}): Validated<RecordData> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ field: 'data', message: 'must be a JSON object of field values' }] };
  }
  const source = input as Record<string, unknown>;
  const errors: FieldError[] = [];
  const value: RecordData = {};

  for (const name of Object.keys(source)) {
    const def = config.fields[name];
    if (!def) {
      errors.push({ field: name, message: `is not a field of a ${config.noun.en.one}; fields are ${agentFields(config).join(', ')}` });
    } else if (def.server && !options.allowServer && source[name] !== undefined) {
      errors.push({ field: name, message: 'is set by the server; leave it out' });
    }
  }
  for (const [name, def] of Object.entries(config.fields)) {
    if (def.server && !options.allowServer) continue;
    const raw = source[name];
    if (raw === undefined || raw === null || raw === '') {
      if (def.required) errors.push({ field: name, message: 'is required' });
      continue;
    }
    const checked = checkField(name, def, raw, errors);
    if (checked !== undefined) value[name] = checked;
  }

  for (const rule of config.rules ?? []) {
    switch (rule.rule) {
      case 'oneOf':
        if (!rule.fields.some((name) => value[name] !== undefined) && errors.length === 0) {
          errors.push({ field: rule.fields[0]!, message: `give at least one of ${rule.fields.join(', ')}` });
        }
        break;
      case 'requiredWhen':
        if (value[rule.field] === undefined && Object.entries(rule.when).every(([name, wanted]) => value[name] === wanted)) {
          const when = Object.entries(rule.when).map(([name, wanted]) => `${name} is ${wanted}`).join(' and ');
          errors.push({ field: rule.field, message: `is required when ${when}` });
        }
        break;
      case 'onlyWhen':
        if (value[rule.field] !== undefined && !rule.values.includes(String(value[rule.by]))) {
          errors.push({ field: rule.field, message: `may only be given when ${rule.by} is ${rule.values.join(', ')}; leave it out` });
        }
        break;
      case 'noRating':
        for (const field of rule.fields) {
          if (field === '$evidence') continue;
          for (const { path, text } of valuesAt(value, field)) {
            const rating = findRating(text);
            if (rating) errors.push({ field: path, message: ratingMessage(rating) });
          }
        }
        break;
      case 'translation': {
        const translation = value[rule.field];
        const language = value[rule.language];
        if (typeof translation === 'string' && (language === 'zh' || language === 'en')) {
          const cjk = isMostlyCjk(translation);
          if (language === 'zh' ? cjk : !cjk) {
            errors.push({
              field: rule.field,
              message: `must be the excerpt in the other language: ${language === 'zh' ? 'English' : 'Chinese'}`,
            });
          }
        }
        break;
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** The fields an agent may send, in config order. */
export const agentFields = (config: KindConfig): string[] =>
  Object.entries(config.fields).filter(([, def]) => !def.server).map(([name]) => name);

export const ratingMessage = (rating: string): string =>
  `holds a rating (${JSON.stringify(rating)}); this site keeps what reviewers wrote, never their scores. Quote a passage about the food or the visit without it`;

/** Errors for values outside the config's `accept` ranges. `today` is the UTC date of the submit. */
export function checkAccept(config: KindConfig, data: RecordData, today: string): FieldError[] {
  const errors: FieldError[] = [];
  for (const [field, range] of Object.entries(config.accept ?? {})) {
    const value = data[field];
    if (typeof value !== 'string') continue;
    if (range.from !== undefined && value < resolveDateBound(range.from, today).slice(0, value.length)) {
      errors.push({ field, message: `must be ${resolveDateBound(range.from, today)} or later; got ${show(value)}` });
    }
    if (range.to !== undefined && value > resolveDateBound(range.to, today).slice(0, value.length)) {
      errors.push({ field, message: `must not be after ${resolveDateBound(range.to, today)}; got ${show(value)}` });
    }
  }
  return errors;
}

/* ───────── provenance ───────── */

export interface Provenance {
  source_url: string;
  evidence: string;
  observed_at: string;
}

/** Longest quote of a page that states facts. */
export const EVIDENCE_MAX = 300;

/**
 * Quotes a maintainer cannot find on the page. "..." joins pieces from different places, so the
 * quote is no longer word for word; a tag means it was copied from the HTML, across elements.
 */
const ELIDED = /\.\.\.|…/;
const MARKUP = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>|<[a-z][a-z0-9-]*\s+[a-z-]+=|\/>/i;

/** How far ahead of the server clock an observed_at may be before it counts as the future. */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

/** The most an excerpt of this kind may hold, given its script. */
export const excerptLimit = (config: KindConfig, text: string): number =>
  config.excerptMax ? (isMostlyCjk(text) ? config.excerptMax.cjk : config.excerptMax.latin) : EVIDENCE_MAX;

/**
 * Checks where a record came from: a page, a passage from it, and when it was read. For an
 * excerpt kind the passage is the content itself, held to the kind's limit by script. Given
 * `now`, an observed_at in the future is refused. No passage may carry a rating.
 */
export function validateProvenance(
  config: KindConfig,
  input: { source_url?: unknown; evidence?: unknown; observed_at?: unknown },
  now?: Date,
): Validated<Provenance> {
  const errors: FieldError[] = [];
  const source = typeof input.source_url === 'string' ? parseHttpsUrl(input.source_url) : null;
  if (!source) {
    errors.push({
      field: 'source_url',
      message:
        config.provenance === 'excerpt'
          ? `must be the full https:// URL of the page the excerpt comes from; got ${show(input.source_url)}`
          : `must be the full https:// URL of the page that states the facts; got ${show(input.source_url)}`,
    });
  }

  const evidence = typeof input.evidence === 'string' ? cleanText(input.evidence) : '';
  const max = excerptLimit(config, evidence);
  const what = config.provenance === 'excerpt' ? 'the excerpt' : 'the quote';
  if (!evidence) {
    errors.push({ field: 'evidence', message: `must be ${what}, copied from the page word for word` });
  } else if (evidence.length > max) {
    errors.push({
      field: 'evidence',
      message: `must be at most ${max} characters${config.excerptMax ? ` (${config.excerptMax.cjk} for Chinese text, ${config.excerptMax.latin} otherwise)` : ''}; got ${evidence.length}. Quote a shorter passage`,
    });
  } else if (ELIDED.test(evidence)) {
    errors.push({ field: 'evidence', message: 'must be one passage copied as it stands, without "..." to skip words; quote a shorter passage instead' });
  } else if (MARKUP.test(evidence)) {
    errors.push({ field: 'evidence', message: "must be the page's text, not its HTML: leave out tags" });
  } else if ((config.rules ?? []).some((rule) => rule.rule === 'noRating' && rule.fields.includes('$evidence'))) {
    const rating = findRating(evidence);
    if (rating) errors.push({ field: 'evidence', message: ratingMessage(rating) });
  }

  const observed =
    typeof input.observed_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(input.observed_at) ? Date.parse(input.observed_at) : Number.NaN;
  if (input.observed_at !== undefined || now) {
    if (!Number.isFinite(observed)) {
      errors.push({ field: 'observed_at', message: `must be an ISO 8601 time such as 2026-10-08T08:55:00Z; got ${show(input.observed_at)}` });
    } else if (now && observed > now.getTime() + CLOCK_SKEW_MS) {
      errors.push({ field: 'observed_at', message: `must not be in the future; it is ${now.toISOString()} now; got ${show(input.observed_at)}` });
    }
  }

  if (errors.length > 0 || !source) return { ok: false, errors };
  return {
    ok: true,
    value: { source_url: source, evidence, observed_at: Number.isFinite(observed) ? new Date(observed).toISOString() : '' },
  };
}

/* ───────── identity ───────── */

const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|si|xsec_token|xsec_source|share_id|spm|from)$/i;

/** Hosts that serve the same pages under another name. */
const HOST_ALIASES: Readonly<Record<string, string>> = {
  'm.youtube.com': 'youtube.com',
  'old.reddit.com': 'reddit.com',
  'm.dianping.com': 'dianping.com',
  'm.tripadvisor.co.uk': 'tripadvisor.co.uk',
  'm.yelp.co.uk': 'yelp.co.uk',
};

/**
 * The form two URLs are compared in: https, lowercase host without "www." (and under its
 * canonical name), no port, credentials, fragment or tracking parameters, sorted query, no
 * trailing slash. youtu.be/<id> becomes youtube.com/watch?v=<id>.
 */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.protocol = 'https:';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return `https://youtube.com/watch?v=${id}`;
  }
  url.hostname = HOST_ALIASES[host] ?? host;
  url.port = '';
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key) || (url.hostname === 'youtube.com' && key === 't')) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}${url.search}`;
}

/**
 * A name as two records compare it: compatibility forms folded, lowercase, "&" read as "and",
 * punctuation (Latin and CJK) dropped, a leading "the" dropped, spaces collapsed.
 */
export function normName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/^\s*the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The value two records share when they describe the same thing. */
export function identityKey(config: KindConfig, data: RecordData, provenance?: { source_url?: string; evidence?: string }): string {
  const part = (name: string): string => {
    if (name === '$source_url') return provenance?.source_url ? normalizeUrl(provenance.source_url) : '';
    if (name === '$evidence') return provenance?.evidence ? normName(provenance.evidence) : '';
    const value = data[name];
    if (value === undefined) return '';
    const def = config.fields[name];
    if (def?.type === 'url') return normalizeUrl(String(value));
    if (def?.type === 'postcode' || def?.type === 'ref' || def?.type === 'enum') return String(value);
    if (typeof value === 'string') return normName(value);
    return JSON.stringify(value);
  };
  return config.identity
    .map((entry) => {
      if (typeof entry === 'string') return part(entry);
      const name = entry.firstOf.find((candidate) => data[candidate] !== undefined);
      return name ? part(name) : '';
    })
    .join('|');
}

/* ───────── corrections ───────── */

/** A record's data with corrections applied: a value replaces, null removes. */
export function corrected(data: RecordData, corrections: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...data };
  for (const [field, value] of Object.entries(corrections)) {
    if (value === null) delete merged[field];
    else merged[field] = value;
  }
  return merged;
}

/** One change to a list field, by index into the list as it was leased. */
export type ListPatch = { index: number; set: Record<string, unknown> } | { index: number; remove: true } | { add: Record<string, unknown>; after?: number };

/**
 * A list with patches applied: sets first, then removals (highest index first), then additions,
 * each `after` an index of the original list (or at the start when left out). Errors name the
 * patch to fix.
 */
export function patchList(list: readonly ListItem[], patches: unknown, field: string): Validated<Record<string, unknown>[]> {
  if (!Array.isArray(patches)) return { ok: false, errors: [{ field: `patches.${field}`, message: 'must be a list of {index, set}, {index, remove: true} or {add, after}' }] };
  const errors: FieldError[] = [];
  const items: (Record<string, unknown> | null)[] = list.map((item) => ({ ...item }));
  const additions: { after: number; item: Record<string, unknown> }[] = [];
  const inRange = (index: unknown): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < list.length;
  patches.forEach((patch: unknown, position) => {
    const where = `patches.${field}[${position}]`;
    const entry = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
    if ('add' in entry) {
      if (typeof entry.add !== 'object' || entry.add === null) errors.push({ field: where, message: 'add must be an item object' });
      else if (entry.after !== undefined && !inRange(entry.after)) errors.push({ field: where, message: `after must be an index from 0 to ${list.length - 1}` });
      else additions.push({ after: entry.after === undefined ? -1 : (entry.after as number), item: entry.add as Record<string, unknown> });
    } else if (!inRange(entry.index)) {
      errors.push({ field: where, message: `index must be from 0 to ${list.length - 1}` });
    } else if (entry.remove === true) {
      items[entry.index] = null;
    } else if (typeof entry.set === 'object' && entry.set !== null) {
      const current = items[entry.index];
      if (current) {
        for (const [key, value] of Object.entries(entry.set as Record<string, unknown>)) {
          if (value === null) delete current[key];
          else current[key] = value;
        }
      }
    } else {
      errors.push({ field: where, message: 'needs set (an object of item fields), remove: true, or add' });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  const out: Record<string, unknown>[] = [];
  for (const addition of additions.filter((entry) => entry.after === -1)) out.push(addition.item);
  items.forEach((item, index) => {
    if (item) out.push(item);
    for (const addition of additions.filter((entry) => entry.after === index)) out.push(addition.item);
  });
  return { ok: true, value: out };
}

/* ───────── display ───────── */

/** A record's name, from its display fields, in a preferred language. */
export function recordName(config: KindConfig, data: RecordData, locale: 'zh' | 'en' = 'en'): string {
  const fields = locale === 'zh' ? [...config.display].sort((a) => (a.endsWith('_zh') ? -1 : 0)) : config.display;
  for (const name of fields) {
    const value = data[name];
    if (typeof value === 'string' && value) return value;
  }
  return config.noun.en.one;
}

/** An enum or tag value's label in a language, or the value itself. */
export function valueLabel(def: FieldDef | undefined, value: string, locale: 'zh' | 'en'): string {
  if (def && (def.type === 'enum' || def.type === 'tags')) return def.valueLabels[value]?.[locale] ?? value;
  return value;
}

/** Today's date in UTC, the clock every 'today' in configs is read against. */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);
