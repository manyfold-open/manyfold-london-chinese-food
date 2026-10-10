/**
 * A place in the map apps people use. Google Maps and Apple Maps search its name and address, so
 * they open the business itself where they know it (Apple's links in the form every version of
 * Maps reads); OpenStreetMap marks the place's coordinates, which are its postcode's.
 */

export type MapApp = 'google' | 'apple' | 'osm';

export interface MapPlace {
  name: string | null;
  address: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
}

export function mapLinks(place: MapPlace): { app: MapApp; href: string }[] {
  const where = [place.address, place.postcode ? `London ${place.postcode}` : null].filter(Boolean).join(', ');
  const query = encodeURIComponent([place.name, where].filter(Boolean).join(', '));
  const at = place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null;
  const links: { app: MapApp; href: string }[] = [];
  if (where) {
    links.push({ app: 'google', href: `https://www.google.com/maps/search/?api=1&query=${query}` });
    links.push({ app: 'apple', href: `https://maps.apple.com/?q=${query}${at ? `&sll=${at.lat},${at.lng}` : ''}` });
  }
  if (at) links.push({ app: 'osm', href: `https://www.openstreetmap.org/?mlat=${at.lat}&mlon=${at.lng}#map=18/${at.lat}/${at.lng}` });
  return links;
}
