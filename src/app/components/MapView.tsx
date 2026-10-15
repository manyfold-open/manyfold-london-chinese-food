/**
 * Places on a map: MapLibre with OpenFreeMap's tiles (basemap.ts), light or dark with the page.
 * Loaded only when a reader opens the map, as its own chunk. A place is a dot in its line's colour;
 * places that crowd gather into an interchange, a ring with how many are inside.
 * The map reports where it was left (`onCamera`) and opens there again (`camera`), so going back
 * from a place finds it as it was; with `fit`, a map opened afresh frames the places it shows.
 *
 * Where the reader is, once they have asked (`near`), shows as MapLibre's own blue dot, in a
 * circle as wide as the browser says the position may be off. The button under the zoom asks for
 * it (`onLocate`), as "Near me" does, and comes back to it.
 */

import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { type GeoJSONSource, type IControl, type LngLatBoundsLike, type Map as MapLibre, type Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { IndexEntry } from '../../shared/place-doc';
import { COPY, type Locale } from '../../shared/i18n';
import { LINES, lineFor } from '../../shared/lines';
import type { Camera, Near } from '../geo';
import { placeNames } from '../labels';
import { navigate } from '../router';
import { paths } from '../routes';
import { useTheme } from '../theme';
import { basemap, blankMissingImages, mapLocale, token } from './basemap';

const LONDON: [number, number] = [-0.1276, 51.5072];
/** How close a map opened on the reader, or framing its places, comes: a few streets, not one. */
const NEAR_ZOOM = 13;
const FIT_ZOOM = 14;
/** The Earth's circumference at the equator, in metres, over the pixels MapLibre draws it in at zoom 0. */
const METRES_PER_PIXEL_AT_ZERO = 40_075_016.686 / 512;
const NO_LINES: readonly string[] = [];

/** Each place's dot colour: its line's (the first of `lines` it is on, else its first), as the page's tokens are now. */
function features(entries: readonly IndexEntry[], locale: Locale, lines: readonly string[]) {
  const colors = Object.fromEntries(LINES.map((line) => [line.id, token(line.color)])) as Record<string, string>;
  const plain = token('--muted');
  return {
    type: 'FeatureCollection' as const,
    features: entries
      .filter((entry) => entry.la !== null && entry.lo !== null)
      .map((entry) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [entry.lo!, entry.la!] },
        properties: { id: entry.id, slug: entry.s, name: placeNames({ en: entry.n, zh: entry.z }, locale).main, color: colors[lineFor(entry, lines) ?? ''] ?? plain },
      })),
  };
}

/** The box around the places that have coordinates, or null when none has. */
function boundsOf(entries: readonly IndexEntry[]): LngLatBoundsLike | null {
  const points = entries.filter((entry) => entry.la !== null && entry.lo !== null);
  if (points.length === 0) return null;
  const lngs = points.map((entry) => entry.lo!);
  const lats = points.map((entry) => entry.la!);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/** The button that finds the reader, drawn as MapLibre draws its own: its states are MapLibre's classes too. */
class LocateControl implements IControl {
  readonly button = document.createElement('button');
  private readonly box = document.createElement('div');

  constructor(onClick: () => void) {
    this.box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button.type = 'button';
    this.button.className = 'maplibregl-ctrl-geolocate';
    const icon = document.createElement('span');
    icon.className = 'maplibregl-ctrl-icon';
    icon.setAttribute('aria-hidden', 'true');
    this.button.append(icon);
    this.button.addEventListener('click', onClick);
    this.box.append(this.button);
  }

  onAdd(): HTMLElement {
    return this.box;
  }

  onRemove(): void {
    this.box.remove();
  }
}

export default function MapView({
  entries,
  locale,
  near,
  camera,
  onCamera,
  onLocate,
  locating = false,
  fit = false,
  lines = NO_LINES,
}: {
  entries: readonly IndexEntry[];
  locale: Locale;
  near: Near | null;
  camera?: Camera | null;
  onCamera?: (camera: Camera) => void;
  /** Asks where the reader is; without it the map has no locate button. */
  onLocate?: () => void;
  locating?: boolean;
  /** Open on the places shown rather than on all of London, unless a camera or the reader says where. */
  fit?: boolean;
  /** The lines the reader filtered by: a place's dot wears the one it was found on. */
  lines?: readonly string[];
}) {
  const [theme] = useTheme();
  const shownTheme = useRef(theme);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const locator = useRef<LocateControl | null>(null);
  const you = useRef<{ dot: Marker; circle: Marker } | null>(null);
  // The position the map last went to: the one it opened with is already in its camera.
  const shown = useRef(near);
  const handlers = useRef({ onCamera, onLocate });
  handlers.current = { onCamera, onLocate };
  // What to draw when the style has loaded: the reader may have changed a filter while it loaded.
  const latest = useRef({ entries, locale, near, lines });
  latest.current = { entries, locale, near, lines };

  /** The accuracy circle's size in pixels at the map's zoom; hidden while the position has no accuracy. */
  const sizeCircle = () => {
    const instance = map.current;
    const at = latest.current.near;
    const circle = you.current?.circle.getElement();
    if (!instance || !at || !circle) return;
    const metresPerPixel = (METRES_PER_PIXEL_AT_ZERO * Math.cos((at.lat * Math.PI) / 180)) / 2 ** instance.getZoom();
    const diameter = at.accuracy ? Math.ceil((2 * at.accuracy) / metresPerPixel) : 0;
    circle.style.width = circle.style.height = `${diameter}px`;
  };

  useEffect(() => {
    if (!container.current) return;
    const box = fit && !camera && !near ? boundsOf(entries) : null;
    const start = camera
      ? { center: [camera.lng, camera.lat] as [number, number], zoom: camera.zoom }
      : box
        ? { bounds: box, fitBoundsOptions: { padding: 48, maxZoom: FIT_ZOOM } }
        : { center: near ? ([near.lng, near.lat] as [number, number]) : LONDON, zoom: near ? NEAR_ZOOM : 10.5 };
    const instance = new maplibregl.Map({ container: container.current, style: basemap(theme), ...start, locale: mapLocale(locale) });
    map.current = instance;
    blankMissingImages(instance);
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    if (handlers.current.onLocate) {
      locator.current = new LocateControl(() => handlers.current.onLocate?.());
      instance.addControl(locator.current, 'top-right');
    }
    instance.on('moveend', () => {
      const center = instance.getCenter();
      handlers.current.onCamera?.({ lng: center.lng, lat: center.lat, zoom: instance.getZoom() });
    });
    instance.on('zoom', sizeCircle);
    let wired = false;
    // Every style that loads, the first and each one a theme change brings, gets the places again,
    // in the theme's colours: an interchange is the page's card ringed in ink, with its count in ink.
    instance.on('style.load', () => {
      instance.addSource('places', { type: 'geojson', data: features(latest.current.entries, latest.current.locale, latest.current.lines), cluster: true, clusterRadius: 32, clusterMinPoints: 5, clusterMaxZoom: 14 });
      instance.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'], paint: { 'circle-color': token('--card'), 'circle-stroke-color': token('--ink'), 'circle-stroke-width': 3, 'circle-radius': ['step', ['get', 'point_count'], 13, 20, 16, 100, 21] } });
      instance.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12.5, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': token('--ink') } });
      instance.addLayer({ id: 'place', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['get', 'color'], 'circle-radius': 6.5, 'circle-stroke-width': 2, 'circle-stroke-color': token('--card') } });
      instance.addLayer({ id: 'place-name', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']], minzoom: 14, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': token('--ink'), 'text-halo-color': token('--card'), 'text-halo-width': 1.5 } });
      if (wired) return;
      wired = true;
      instance.on('click', 'clusters', async (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const zoom = await (instance.getSource('places') as GeoJSONSource).getClusterExpansionZoom(feature.properties.cluster_id as number);
        instance.easeTo({ center: (feature.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom });
      });
      instance.on('click', 'place', (event) => {
        const properties = event.features?.[0]?.properties as { id: string; slug: string } | undefined;
        if (properties) navigate(paths.place(latest.current.locale, properties.id, properties.slug));
      });
      for (const layer of ['clusters', 'place']) {
        instance.on('mouseenter', layer, () => (instance.getCanvas().style.cursor = 'pointer'));
        instance.on('mouseleave', layer, () => (instance.getCanvas().style.cursor = ''));
      }
      // A place names itself on hover, as on the other maps (CityMapView).
      const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'city-map-tip' });
      instance.on('mousemove', 'place', (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        tip
          .setLngLat((feature.geometry as unknown as { coordinates: [number, number] }).coordinates)
          .setText(String(feature.properties.name ?? ''))
          .addTo(instance);
      });
      instance.on('mouseleave', 'place', () => tip.remove());
    });
    return () => {
      instance.remove();
      map.current = null;
      locator.current = null;
      you.current = null;
    };
    // The map is made once; data changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const source = map.current?.getSource('places') as GeoJSONSource | undefined;
    source?.setData(features(entries, locale, lines));
  }, [entries, locale, lines]);

  // A theme change loads the other tiles; the style's load puts the places back in the new colours.
  useEffect(() => {
    if (!map.current || shownTheme.current === theme) return;
    shownTheme.current = theme;
    map.current.setStyle(basemap(theme), { diff: false });
  }, [theme]);

  // The reader's dot, over its circle, wherever they were found; gone when they turn "Near me" off.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!near) {
      you.current?.dot.remove();
      you.current?.circle.remove();
      you.current = null;
      return;
    }
    if (!you.current) {
      // Roles of their own, so MapLibre does not announce them as buttons.
      const circle = document.createElement('div');
      circle.className = 'maplibregl-user-location-accuracy-circle you-circle';
      circle.setAttribute('role', 'presentation');
      circle.setAttribute('aria-hidden', 'true');
      const dot = document.createElement('div');
      dot.className = 'maplibregl-user-location-dot you-dot';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', COPY[locale].map.you);
      you.current = {
        circle: new maplibregl.Marker({ element: circle }).setLngLat([near.lng, near.lat]).addTo(instance),
        dot: new maplibregl.Marker({ element: dot }).setLngLat([near.lng, near.lat]).addTo(instance),
      };
    }
    you.current.circle.setLngLat([near.lng, near.lat]);
    you.current.dot.setLngLat([near.lng, near.lat]);
    you.current.dot.getElement().setAttribute('aria-label', COPY[locale].map.you);
    sizeCircle();
    // A position found again goes to the reader even when it has not changed: the locate button comes back to them.
    if (near !== shown.current) {
      shown.current = near;
      instance.easeTo({ center: [near.lng, near.lat], zoom: Math.max(instance.getZoom(), NEAR_ZOOM) });
    }
    // sizeCircle reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, locale]);

  useEffect(() => {
    const button = locator.current?.button;
    if (!button) return;
    const label = COPY[locale].map.locate;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(near !== null));
    button.classList.toggle('maplibregl-ctrl-geolocate-waiting', locating);
    button.classList.toggle('maplibregl-ctrl-geolocate-active', near !== null && !locating);
  }, [locale, locating, near]);

  return <div className="map" ref={container} />;
}
