// Development fixtures only. Replace this provider with external-data MCP calls.
export const places = [
  { id: 'demo-wisla', name: 'Bulwary Wiślane', category: 'outdoors', district: 'Śródmieście', lat: 52.245, lng: 21.028, description: 'Spacer nad Wisłą.', source: 'Dane demonstracyjne', live: false },
  { id: 'demo-kopernik', name: 'Centrum Nauki Kopernik', category: 'culture', district: 'Śródmieście', lat: 52.2418, lng: 21.0287, description: 'Nauka i wystawy. Sprawdź godziny u organizatora.', source: 'Dane demonstracyjne', live: false },
  { id: 'demo-lazienki', name: 'Łazienki Królewskie', category: 'outdoors', district: 'Śródmieście', lat: 52.215, lng: 21.035, description: 'Park i ogrody.', source: 'Dane demonstracyjne', live: false },
  { id: 'demo-zacheta', name: 'Zachęta', category: 'culture', district: 'Śródmieście', lat: 52.239, lng: 21.011, description: 'Galeria sztuki. Program i godziny wymagają weryfikacji.', source: 'Dane demonstracyjne', live: false },
  { id: 'demo-metro', name: 'Metro Centrum', category: 'transit', district: 'Śródmieście', lat: 52.230, lng: 21.010, description: 'Stacja M1. Brak rozkładów na żywo.', source: 'Dane demonstracyjne', live: false },
];
export function normalize(text) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase(); }
export const catalogProvider = {
  async search({ query = '', category, district, bounds, limit = 10 } = {}) {
    return places.filter(p => (!query || normalize(`${p.name} ${p.description} ${p.district} ${p.category}`).includes(normalize(query))) &&
      (!category || p.category === category) && (!district || normalize(p.district).includes(normalize(district))) &&
      (!bounds || (p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east))).slice(0, limit);
  },
};
