/**
 * The front page's filters: open now, a menu, photos, and the kind of place, the cuisine and the
 * borough, each choice with how many places the list would show with it. The same panel is the
 * left column on a wide screen and a sheet on a phone. Long lists start with the choices most
 * places have, a few at a time; a choice made always shows. Nothing here ranks a place.
 */

import { useId, useState } from 'react';
import type { FacetCounts } from '../../shared/places-query';
import { useCopy, useLocale } from '../i18n';
import { BOROUGH_CODES, boroughLabel, CATEGORIES, categoryLabel, CUISINES, cuisineLabel } from '../labels';
import { CheckRow, ShowAll } from '../ui';

export interface Filters {
  categories: string[];
  cuisines: string[];
  boroughs: string[];
  openOnly: boolean;
  withMenu: boolean;
  withPhotos: boolean;
}

export const NO_FILTERS: Filters = { categories: [], cuisines: [], boroughs: [], openOnly: true, withMenu: false, withPhotos: false };

/** How many filters are set beyond none: the Filters button on a phone shows it. */
export const filterCount = (filters: Filters): number =>
  filters.categories.length + filters.cuisines.length + filters.boroughs.length + (filters.withMenu ? 1 : 0) + (filters.withPhotos ? 1 : 0) + (filters.openOnly ? 0 : 1);

/** Filters as stored (this browser, a history entry), with every value checked against the lists. */
export function readFilters(stored: unknown): Filters {
  const value = (stored ?? {}) as Partial<Record<keyof Filters, unknown>>;
  const list = (items: unknown, known: readonly string[]) => (Array.isArray(items) ? [...new Set(items)].filter((item): item is string => known.includes(item as string)) : []);
  const flag = (item: unknown, fallback: boolean) => (typeof item === 'boolean' ? item : fallback);
  return {
    categories: list(value.categories, CATEGORIES),
    cuisines: list(value.cuisines, CUISINES),
    boroughs: list(value.boroughs, BOROUGH_CODES),
    openOnly: flag(value.openOnly, NO_FILTERS.openOnly),
    withMenu: flag(value.withMenu, NO_FILTERS.withMenu),
    withPhotos: flag(value.withPhotos, NO_FILTERS.withPhotos),
  };
}

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

/** The choices a long list shows before "Show all". */
const SHORT = 6;

/** Choices with the most places first, in the lists' own order between equals. */
const byPlaces = (values: readonly string[], totals: Record<string, number> | undefined) =>
  totals ? [...values].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0)) : values;

export function FilterPanel({
  filters,
  counts,
  totals,
  onChange,
}: {
  filters: Filters;
  /** Places each choice would show; null while the index loads. */
  counts: FacetCounts | null;
  /** Places with each value in the whole index: the order of the long lists. */
  totals: FacetCounts | null;
  onChange: (filters: Filters) => void;
}) {
  const copy = useCopy();
  const locale = useLocale();
  return (
    <div className="filter-panel">
      <div className="filter-group">
        <CheckRow checked={filters.openOnly} label={copy.home.openOnly} count={counts?.openOnly ?? null} onToggle={() => onChange({ ...filters, openOnly: !filters.openOnly })} />
        <CheckRow checked={filters.withMenu} label={copy.home.withMenu} count={counts?.withMenu ?? null} onToggle={() => onChange({ ...filters, withMenu: !filters.withMenu })} />
        <CheckRow checked={filters.withPhotos} label={copy.home.withPhotos} count={counts?.withPhotos ?? null} onToggle={() => onChange({ ...filters, withPhotos: !filters.withPhotos })} />
      </div>
      <Choices
        title={copy.home.category}
        values={CATEGORIES}
        label={(value) => categoryLabel(value, locale)}
        chosen={filters.categories}
        counts={counts?.categories ?? null}
        onToggle={(value) => onChange({ ...filters, categories: toggle(filters.categories, value) })}
      />
      <Choices
        title={copy.home.cuisine}
        values={byPlaces(CUISINES, totals?.cuisines)}
        label={(value) => cuisineLabel(value, locale)}
        chosen={filters.cuisines}
        counts={counts?.cuisines ?? null}
        short
        onToggle={(value) => onChange({ ...filters, cuisines: toggle(filters.cuisines, value) })}
      />
      <Choices
        title={copy.home.borough}
        values={byPlaces(BOROUGH_CODES, totals?.boroughs)}
        label={(value) => boroughLabel(value, locale)}
        chosen={filters.boroughs}
        counts={counts?.boroughs ?? null}
        short
        onToggle={(value) => onChange({ ...filters, boroughs: toggle(filters.boroughs, value) })}
      />
    </div>
  );
}

function Choices({
  title,
  values,
  label,
  chosen,
  counts,
  short,
  onToggle,
}: {
  title: string;
  values: readonly string[];
  label: (value: string) => string;
  chosen: string[];
  counts: Record<string, number> | null;
  /** Show the first few until the reader asks for all. */
  short?: boolean;
  onToggle: (value: string) => void;
}) {
  const copy = useCopy();
  const id = useId();
  const [all, setAll] = useState(false);
  const shown = !short || all ? values : values.filter((value, index) => index < SHORT || chosen.includes(value));
  return (
    <div className="filter-group" role="group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {shown.map((value) => (
        <CheckRow key={value} checked={chosen.includes(value)} label={label(value)} count={counts ? (counts[value] ?? 0) : null} onToggle={() => onToggle(value)} />
      ))}
      {short && values.length > SHORT ? (
        <ShowAll expanded={all} total={values.length} more={copy.home.showAll(values.length)} less={copy.home.showFewer} onToggle={() => setAll(!all)} />
      ) : null}
    </div>
  );
}
