import { describe, expect, it } from 'vitest';
import { mapLinks } from '../src/app/model/maps';

describe('a place in the map apps', () => {
  const place = { name: 'Golden Dragon', address: '28 Gerrard Street', postcode: 'W1D 6JW', lat: 51.5115, lng: -0.1316 };

  it('asks Google and Apple for the place by name and address, and marks it on OpenStreetMap', () => {
    const query = encodeURIComponent('Golden Dragon, 28 Gerrard Street, London W1D 6JW');
    expect(mapLinks(place)).toEqual([
      { app: 'google', href: `https://www.google.com/maps/search/?api=1&query=${query}` },
      { app: 'apple', href: `https://maps.apple.com/?q=${query}&sll=51.5115,-0.1316` },
      { app: 'osm', href: 'https://www.openstreetmap.org/?mlat=51.5115&mlon=-0.1316#map=18/51.5115/-0.1316' },
    ]);
  });

  it('leaves out OpenStreetMap without coordinates, and the searches without an address', () => {
    expect(mapLinks({ ...place, lat: null, lng: null }).map((link) => link.app)).toEqual(['google', 'apple']);
    expect(mapLinks({ ...place, address: null, postcode: null }).map((link) => link.app)).toEqual(['osm']);
  });

  it('keeps every character of the name inside the query', () => {
    const [google] = mapLinks({ ...place, name: '金龍 & Co #1' });
    expect(new URL(google!.href).searchParams.get('query')).toBe('金龍 & Co #1, 28 Gerrard Street, London W1D 6JW');
  });
});
