/**
 * Places on a map: MapLibre with OpenFreeMap's tiles (free, no key; attribution added by MapLibre).
 * Loaded only when a reader opens the map, as its own chunk. Points cluster when they crowd.
 * The map reports where it was left (`onCamera`) and opens there again (`camera`), so going back
 * from a place finds it as it was.
 */

import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { type GeoJSONSource, type Map as MapLibre } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { IndexEntry } from '../../shared/place-doc';
import type { Locale } from '../../shared/i18n';
import { placeNames } from '../labels';
import { navigate } from '../router';
import { paths } from '../routes';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const LONDON: [number, number] = [-0.1276, 51.5072];

/** Where the map looks. */
export interface Camera {
  lng: number;
  lat: number;
  zoom: number;
}

function features(entries: readonly IndexEntry[], locale: Locale) {
  return {
    type: 'FeatureCollection' as const,
    features: entries
      .filter((entry) => entry.la !== null && entry.lo !== null)
      .map((entry) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [entry.lo!, entry.la!] },
        properties: { id: entry.id, slug: entry.s, name: placeNames({ en: entry.n, zh: entry.z }, locale).main },
      })),
  };
}

export default function MapView({
  entries,
  locale,
  near,
  camera,
  onCamera,
}: {
  entries: readonly IndexEntry[];
  locale: Locale;
  near: { lat: number; lng: number } | null;
  camera?: Camera | null;
  onCamera?: (camera: Camera) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const opened = useRef({ near, onCamera });
  opened.current.onCamera = onCamera;
  // What to draw when the style has loaded: the reader may have changed a filter while it loaded.
  const latest = useRef({ entries, locale });
  latest.current = { entries, locale };

  useEffect(() => {
    if (!container.current) return;
    const start = camera
      ? { center: [camera.lng, camera.lat] as [number, number], zoom: camera.zoom }
      : { center: near ? ([near.lng, near.lat] as [number, number]) : LONDON, zoom: near ? 13 : 10.5 };
    const instance = new maplibregl.Map({ container: container.current, style: STYLE, ...start });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('moveend', () => {
      const center = instance.getCenter();
      opened.current.onCamera?.({ lng: center.lng, lat: center.lat, zoom: instance.getZoom() });
    });
    instance.on('load', () => {
      instance.addSource('places', { type: 'geojson', data: features(latest.current.entries, latest.current.locale), cluster: true, clusterRadius: 40, clusterMaxZoom: 15 });
      instance.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'], paint: { 'circle-color': '#c8102e', 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 100, 24] } });
      instance.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#ffffff' } });
      instance.addLayer({ id: 'place', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#c8102e', 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      instance.addLayer({ id: 'place-name', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']], minzoom: 14, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#0f0f0f', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
      instance.on('click', 'clusters', async (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const zoom = await (instance.getSource('places') as GeoJSONSource).getClusterExpansionZoom(feature.properties.cluster_id as number);
        instance.easeTo({ center: (feature.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom });
      });
      instance.on('click', 'place', (event) => {
        const properties = event.features?.[0]?.properties as { id: string; slug: string } | undefined;
        if (properties) navigate(paths.place(locale, properties.id, properties.slug));
      });
      for (const layer of ['clusters', 'place']) {
        instance.on('mouseenter', layer, () => (instance.getCanvas().style.cursor = 'pointer'));
        instance.on('mouseleave', layer, () => (instance.getCanvas().style.cursor = ''));
      }
    });
    return () => instance.remove();
    // The map is made once; data changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const source = map.current?.getSource('places') as GeoJSONSource | undefined;
    source?.setData(features(entries, locale));
  }, [entries, locale]);

  useEffect(() => {
    // Only a new position moves the map: the one it opened with is already in its camera.
    if (near && near !== opened.current.near) map.current?.easeTo({ center: [near.lng, near.lat], zoom: 13 });
  }, [near]);

  return <div className="map" ref={container} />;
}
