/**
 * Where things are on the reader's maps: the reader's own position, and where a map was left.
 * The position is asked of the browser only when the reader presses "Near me" or the map's locate
 * button, and stays in the browser: it sorts places by distance and marks the reader on the map,
 * and is never sent anywhere. Kept apart from the map itself, which loads as its own chunk.
 */

import { useState } from 'react';
import { useCopy } from './i18n';
import { useToast } from './ui';

/** Where the reader is, and how far off the browser says that may be, in metres. */
export interface Near {
  lat: number;
  lng: number;
  accuracy?: number;
}

/** Where a map looks. */
export interface Camera {
  lng: number;
  lat: number;
  zoom: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A position kept in a history entry, checked: a reload brings it back from storage. */
export function readNear(stored: unknown): Near | null {
  const value = stored as Partial<Record<keyof Near, unknown>> | null | undefined;
  if (!value || !finite(value.lat) || !finite(value.lng)) return null;
  return { lat: value.lat, lng: value.lng, ...(finite(value.accuracy) ? { accuracy: value.accuracy } : {}) };
}

/** A map's camera kept in a history entry, checked. */
export function readCamera(stored: unknown): Camera | null {
  const value = stored as Partial<Record<keyof Camera, unknown>> | null | undefined;
  return value && finite(value.lng) && finite(value.lat) && finite(value.zoom) ? { lng: value.lng, lat: value.lat, zoom: value.zoom } : null;
}

/** Asks the browser where the reader is: `found` gets the answer, and a toast says when there is none. */
export function useLocate(found: (near: Near) => void): { locating: boolean; locate: () => void } {
  const copy = useCopy();
  const toast = useToast();
  const [locating, setLocating] = useState(false);
  const locate = () => {
    if (!navigator.geolocation) {
      toast(copy.home.nearDenied);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        found({ lat: coords.latitude, lng: coords.longitude, ...(finite(coords.accuracy) ? { accuracy: coords.accuracy } : {}) });
      },
      () => {
        setLocating(false);
        toast(copy.home.nearDenied);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };
  return { locating, locate };
}
