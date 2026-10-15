/**
 * What every map draws on: OpenFreeMap's tiles (free, no key; MapLibre adds their attribution),
 * light or dark as the page is, and MapLibre's own words in the reader's language. Only MapLibre's
 * types are imported here, so the pages that only place a map do not load it.
 */

import type { Map as MapLibre } from 'maplibre-gl';
import { COPY, type Locale } from '../../shared/i18n';
import type { Theme } from '../theme';

export const basemap = (theme: Theme): string => `https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'positron'}`;

/** MapLibre's interface text (its `locale` option), in the reader's language. */
export function mapLocale(locale: Locale): Record<string, string> {
  const words = COPY[locale].map;
  return {
    'NavigationControl.ZoomIn': words.zoomIn,
    'NavigationControl.ZoomOut': words.zoomOut,
    'AttributionControl.ToggleAttribution': words.credits,
    'Popup.Close': words.close,
    'CooperativeGesturesHandler.WindowsHelpText': words.ctrlScroll,
    'CooperativeGesturesHandler.MacHelpText': words.cmdScroll,
    'CooperativeGesturesHandler.MobileHelpText': words.twoFingers,
  };
}

/** OpenFreeMap's styles name a few icons their sprite does not have: a blank one each, instead of a warning. */
export function blankMissingImages(map: MapLibre): void {
  map.on('styleimagemissing', ({ id }) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}

/**
 * On a narrow map MapLibre shows its credits in full until the map is dragged: on a phone they
 * cover a quarter of a small map, and a map that leaves one finger to the page is never dragged by
 * one. Shown in full first, they fold into the (i) button after five seconds or the reader's first
 * touch, click or wheel, as the OSMF's attribution guidelines allow. A wide map keeps them open.
 */
export function foldCredits(map: MapLibre): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fold = () => {
    clearTimeout(timer);
    map.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
  };
  map.once('load', () => {
    timer = setTimeout(fold, 5000);
  });
  for (const type of ['touchstart', 'mousedown', 'wheel'] as const) map.once(type, fold);
  map.once('remove', () => clearTimeout(timer));
}

/** A colour token of the page as it is now: MapLibre paints with values, not CSS variables. */
export const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
