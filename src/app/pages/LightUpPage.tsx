/**
 * Light up London: the campaign for real photos. The map shows every open place, lit where a
 * visitor's photo has passed review; the list finds the nearest places still without one, where
 * the upload is. Photos are anonymous, re-encoded and seen by no one until approved (invariants 19
 * and 20); this page only points at the upload every place page already has.
 */

import { useMemo, useState } from 'react';
import { distanceKm } from '../../shared/places-query';
import { useIndex } from '../data';
import type { Near } from '../geo';
import { useLocate } from '../geo';
import { useCopy } from '../i18n';
import { PlaceRow } from '../components/PlaceRow';
import { Button } from '../ui';
import { LightUp } from './HomePage';

export function LightUpPage() {
  const copy = useCopy();
  const index = useIndex();
  const places = useMemo(() => index.data?.places ?? [], [index.data]);
  const [near, setNear] = useState<Near | null>(null);
  const { locating, locate } = useLocate(setNear);
  const dark = useMemo(() => {
    if (!near) return [];
    return places
      .filter((entry) => entry.t === 'open' && entry.p === 0 && entry.la !== null && entry.lo !== null)
      .map((entry) => ({ entry, km: distanceKm(near, { lat: entry.la!, lng: entry.lo! }) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 12);
  }, [places, near]);

  return (
    <div className="light-up-page screen">
      <LightUp entries={places} page />
      <div className="light-up-how">
        <section>
          <h2>{copy.lightUp.how}</h2>
          <ol>
            {copy.lightUp.howText.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>
        <section>
          <h2>{copy.lightUp.nearest}</h2>
          {near ? (
            dark.length ? (
              <div className="place-list">
                {dark.map(({ entry, km }) => (
                  <PlaceRow key={entry.id} entry={entry} km={km} />
                ))}
              </div>
            ) : (
              <p className="empty">{copy.lightUp.noneNear}</p>
            )
          ) : (
            <Button variant="primary" icon="locate" disabled={locating} onClick={locate}>
              {copy.lightUp.locate}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
