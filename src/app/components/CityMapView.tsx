/**
 * The map CityMap loads: MapLibre on OpenFreeMap's tiles, light or dark with the page. It opens on
 * its bounds and can be moved and zoomed; on a page that scrolls, a wheel or one finger scrolls
 * the page and the map says how to move it instead (cooperative gestures). A dot names its place
 * on hover and opens it on a click; pins are the page's own HTML, rendered into MapLibre's markers.
 */

import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { type Map as MapLibre } from 'maplibre-gl';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Locale } from '../../shared/i18n';
import { LINES, linesOf } from '../../shared/lines';
import { useLocale } from '../i18n';
import { placeNames } from '../labels';
import { Link, navigate } from '../router';
import { paths } from '../routes';
import { useTheme } from '../theme';
import { basemap, blankMissingImages, foldCredits, mapLocale, quietTitles, token } from './basemap';
import { LONDON, type Bounds, type CityMapProps, type Marker } from './CityMap';

const LAYERS = ['cm-ring-fill', 'cm-ring-line', 'cm-route-casing', 'cm-route', 'cm-glow', 'cm-dots', 'cm-hl', 'cm-names'];
const SOURCES = ['cm-places', 'cm-ring', 'cm-route'];
/** The layers a reader can point at and open. */
const DOTS = ['cm-dots', 'cm-hl'];
/** No pins: one array for every render, so the pins' effect does not run again for nothing. */
const NO_MARKERS: readonly Marker[] = [];

/** The centre and zoom that show a box in a frame of this size: all of it (contain), or filling the frame (cover). */
function frame(bounds: Bounds, width: number, height: number, fit: 'contain' | 'cover') {
  const [south, north, west, east] = bounds;
  const y = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  // The box's size in pixels at zoom 0, where the world is 512 pixels wide.
  const dx = ((east - west) / 360) * 512;
  const dy = (y(south) - y(north)) * 512;
  const sx = (width || 600) / dx;
  const sy = (height || 400) / dy;
  return { center: [(west + east) / 2, (south + north) / 2] as [number, number], zoom: Math.log2(fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)) };
}

/** The colours to paint with, read from the page's tokens as they are now. */
function palette(props: CityMapProps) {
  const resolve = (value: string) => (value.startsWith('var(') ? token(value.slice(4, -1)) : value);
  return {
    lines: Object.fromEntries(LINES.map((line) => [line.id, token(line.color)])) as Record<string, string>,
    muted: props.dark ? '#a0aabe' : token('--muted'),
    amber: token('--amber'),
    card: props.dark ? '#10131c' : token('--card'),
    ink: props.dark ? '#f6efe2' : token('--ink'),
    route: token('--line-noodle'),
    highlight: resolve(props.highlightColor ?? 'var(--line-dimsum)'),
    ring: resolve(props.ring?.color ?? props.highlightColor ?? 'var(--accent)'),
  };
}

function places(props: CityMapProps, locale: Locale, colors: ReturnType<typeof palette>) {
  return {
    type: 'FeatureCollection' as const,
    features: props.entries.flatMap((entry) => {
      if (entry.la === null || entry.lo === null || entry.t === 'closed') return [];
      const lit = Boolean(props.lit && entry.p > 0);
      const color = lit ? colors.amber : props.tone === 'line' ? (colors.lines[linesOf(entry)[0] ?? 'north'] ?? colors.muted) : colors.muted;
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [entry.lo, entry.la] },
          properties: { id: entry.id, slug: entry.s, name: placeNames({ en: entry.n, zh: entry.z }, locale).main, color, hl: props.highlight?.has(entry.id) ?? false, lit },
        },
      ];
    }),
  };
}

/** A circle of `km` around a point, as a polygon of 64 sides. */
function circle({ lat, lng, km }: { lat: number; lng: number; km: number }) {
  const ring: [number, number][] = [];
  for (let i = 0; i <= 64; i += 1) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([lng + ((km / 111.32) * Math.sin(a)) / Math.cos((lat * Math.PI) / 180), lat + (km / 111.32) * Math.cos(a)]);
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } };
}

/** Puts the page's places, walk and circle on the map, in place of what was there. */
function decorate(map: MapLibre, props: CityMapProps, locale: Locale) {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  const colors = palette(props);
  const faint = props.tone === 'faint';
  map.addSource('cm-places', { type: 'geojson', data: places(props, locale, colors) });
  if (props.ring) {
    map.addSource('cm-ring', { type: 'geojson', data: circle(props.ring) });
    map.addLayer({ id: 'cm-ring-fill', type: 'fill', source: 'cm-ring', paint: { 'fill-color': colors.ring, 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'cm-ring-line', type: 'line', source: 'cm-ring', paint: { 'line-color': colors.ring, 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
  }
  if (props.route && props.route.length > 1) {
    map.addSource('cm-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: props.route.map((point) => [point.lng, point.lat]) } } });
    const layout = { 'line-join': 'round', 'line-cap': 'round' } as const;
    map.addLayer({ id: 'cm-route-casing', type: 'line', source: 'cm-route', layout, paint: { 'line-color': colors.ink, 'line-width': 9 } });
    map.addLayer({ id: 'cm-route', type: 'line', source: 'cm-route', layout, paint: { 'line-color': colors.route, 'line-width': 5 } });
  }
  if (props.lit) {
    map.addLayer({ id: 'cm-glow', type: 'circle', source: 'cm-places', filter: ['==', ['get', 'lit'], true], paint: { 'circle-color': colors.amber, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 18], 'circle-opacity': 0.3, 'circle-blur': 0.8 } });
  }
  map.addLayer({
    id: 'cm-dots',
    type: 'circle',
    source: 'cm-places',
    filter: ['==', ['get', 'hl'], false],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': faint ? ['interpolate', ['linear'], ['zoom'], 10, 1.6, 13, 2.8, 16, 5] : ['interpolate', ['linear'], ['zoom'], 10, 2.2, 13, 3.8, 16, 6.5],
      'circle-opacity': faint ? 0.45 : props.tone === 'mono' ? 0.6 : 0.9,
      'circle-stroke-color': colors.card,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0, 15, 1.5],
    },
  });
  map.addLayer({
    id: 'cm-hl',
    type: 'circle',
    source: 'cm-places',
    filter: ['==', ['get', 'hl'], true],
    paint: { 'circle-color': colors.highlight, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.6, 13, 5.5, 16, 8], 'circle-stroke-color': colors.card, 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: 'cm-names',
    type: 'symbol',
    source: 'cm-places',
    minzoom: 14.5,
    filter: faint ? ['==', ['get', 'hl'], true] : ['boolean', true],
    layout: { 'text-field': ['get', 'name'], 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'], 'text-optional': true },
    paint: { 'text-color': colors.ink, 'text-halo-color': colors.card, 'text-halo-width': 1.5 },
  });
}

/** What the dots do: a name on hover, the place on a click. Wired once; the layers come and go. */
function wire(map: MapLibre, locale: () => Locale) {
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'city-map-tip' });
  for (const layer of DOTS) {
    map.on('click', layer, (event) => {
      const place = event.features?.[0]?.properties as { id: string; slug: string } | undefined;
      if (place) navigate(paths.place(locale(), place.id, place.slug));
    });
    map.on('mousemove', layer, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = 'pointer';
      tip
        .setLngLat((feature.geometry as unknown as { coordinates: [number, number] }).coordinates)
        .setText(String(feature.properties.name ?? ''))
        .addTo(map);
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
      tip.remove();
    });
  }
}

/** A pin's words for a screen reader, when they are plain text. */
const spoken = (marker: Marker) => [marker.label, marker.sub].filter((part) => typeof part === 'string' || typeof part === 'number').join(' ');

function Pin({ marker }: { marker: Marker }) {
  const style = { ...(marker.shift ? { translate: marker.shift } : {}), ...(marker.color ? { '--c': marker.color } : {}) } as CSSProperties;
  const body = (
    <>
      {marker.kind === 'stop' ? <b>{marker.label}</b> : marker.label}
      {marker.sub ? marker.kind === 'stop' ? <span>{marker.sub}</span> : <small>{marker.sub}</small> : null}
    </>
  );
  return marker.href ? (
    <Link href={marker.href} className={`mk ${marker.kind}`} style={style}>
      {body}
    </Link>
  ) : (
    <span className={`mk ${marker.kind}`} style={style}>
      {body}
    </span>
  );
}

export default function CityMapView(props: CityMapProps) {
  const { bounds = LONDON, fit = 'contain', markers = NO_MARKERS, dark = false, className, label } = props;
  const locale = useLocale();
  const [theme] = useTheme();
  const shade = dark ? 'dark' : theme;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const ready = useRef(false);
  const latest = useRef({ props, locale });
  latest.current = { props, locale };
  const view = `${bounds.join()}|${fit}`;
  const shown = useRef({ shade, view });
  const [slots, setSlots] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const instance = new maplibregl.Map({
      container: element,
      style: basemap(shade),
      ...frame(bounds, width, height, fit),
      minZoom: 8,
      maxZoom: 18,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
      locale: mapLocale(locale),
    });
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    blankMissingImages(instance);
    foldCredits(instance);
    quietTitles(instance);
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.current = instance;
    let wired = false;
    // Every style that loads, the first and each one a theme change brings, gets the page's layers.
    instance.on('style.load', () => {
      ready.current = true;
      decorate(instance, latest.current.props, latest.current.locale);
      if (!wired) {
        wired = true;
        wire(instance, () => latest.current.locale);
      }
    });
    return () => {
      instance.remove();
      map.current = null;
      ready.current = false;
    };
    // The map is made once; changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A theme change loads the other tiles; the style's load puts the layers back in the new colours.
  useEffect(() => {
    const instance = map.current;
    if (!instance || shown.current.shade === shade) return;
    shown.current.shade = shade;
    ready.current = false;
    instance.setStyle(basemap(shade), { diff: false });
  }, [shade]);

  // New bounds (another campus on a guide) move the map there.
  useEffect(() => {
    const instance = map.current;
    if (!instance || shown.current.view === view) return;
    shown.current.view = view;
    const { width, height } = instance.getContainer().getBoundingClientRect();
    instance.easeTo({ ...frame(bounds, width, height, fit), duration: 600 });
    // `view` stands for bounds and fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const ring = props.ring ? `${props.ring.lat},${props.ring.lng},${props.ring.km},${props.ring.color ?? ''}` : '';
  useEffect(() => {
    const instance = map.current;
    if (instance && ready.current) decorate(instance, props, locale);
    // The props that change what is drawn; `ring` stands for props.ring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entries, props.tone, props.highlight, props.highlightColor, props.lit, props.route, ring, locale, dark]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const pins = markers.map((marker) => {
      const element = document.createElement('div');
      element.className = 'city-map-pin';
      // The pin holds the page's own link or label; MapLibre would otherwise call it a button.
      element.setAttribute('role', 'group');
      const words = spoken(marker);
      if (words) element.setAttribute('aria-label', words);
      return new maplibregl.Marker({ element, anchor: 'top-left' }).setLngLat([marker.lng, marker.lat]).addTo(instance);
    });
    setSlots(pins.map((pin) => pin.getElement()));
    return () => {
      for (const pin of pins) pin.remove();
    };
  }, [markers]);

  return (
    <>
      <div className={`city-map${className ? ` ${className}` : ''}`} ref={container} role="region" aria-label={label} />
      {slots.map((slot, i) => (markers[i] ? createPortal(<Pin marker={markers[i]} />, slot, String(i)) : null))}
    </>
  );
}
