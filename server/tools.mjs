import { catalogProvider } from './catalog.mjs';
const categories = ['outdoors', 'culture', 'transit', 'cafe', 'event'];
const boundsSchema = { type: 'object', properties: { south: { type: 'number' }, west: { type: 'number' }, north: { type: 'number' }, east: { type: 'number' } }, required: ['south', 'west', 'north', 'east'], additionalProperties: false };
function definition(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
export const toolDefinitions = [
  definition('search_places', 'Wyszukaj miejsca, wydarzenia lub transport. Zwraca identyfikatory i źródła. Obecnie tylko dane demonstracyjne, bez informacji na żywo.', { query: { type: 'string' }, category: { type: 'string', enum: categories }, district: { type: 'string' }, bounds: boundsSchema, limit: { type: 'integer', minimum: 1, maximum: 20 } }),
  definition('filter_results', 'Filtruj ostatnie wyniki wyszukiwania według kategorii, dzielnicy lub granic mapy.', { category: { type: 'string', enum: categories }, district: { type: 'string' }, bounds: boundsSchema }),
  definition('display_results', 'Pokaż wybrane wyniki jako pinezki na mapie i karty w aplikacji. Używaj wyłącznie identyfikatorów otrzymanych z wyszukiwania lub filtrowania.', { ids: { type: 'array', items: { type: 'string' }, maxItems: 20 }, title: { type: 'string', maxLength: 100 } }, ['ids', 'title']),
  definition('focus_map', 'Ustaw obszar mapy. Nie dodaje miejsc ani danych.', { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, zoom: { type: 'integer', minimum: 10, maximum: 18 } }, ['latitude', 'longitude', 'zoom']),
];
function validate(name, args) {
  const schema = toolDefinitions.find(t => t.function.name === name)?.function.parameters;
  if (!schema) throw new Error('Nieznane narzędzie.');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Nieprawidłowe argumenty.');
  function check(value, rule) {
    if (rule.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Oczekiwano obiektu.');
      if (Object.keys(value).some(k => !Object.hasOwn(rule.properties, k))) throw new Error('Nieznany parametr.');
      for (const key of rule.required || []) if (!Object.hasOwn(value, key)) throw new Error('Brak wymaganego parametru.');
      for (const [key, item] of Object.entries(value)) check(item, rule.properties[key]);
    } else if (rule.type === 'array') {
      if (!Array.isArray(value) || value.length > rule.maxItems) throw new Error('Nieprawidłowa lista.');
      value.forEach(v => check(v, rule.items));
    } else if (rule.type === 'string') {
      if (typeof value !== 'string' || value.length > (rule.maxLength || 500) || (rule.enum && !rule.enum.includes(value))) throw new Error('Nieprawidłowy tekst.');
    } else if (typeof value !== 'number' || !Number.isFinite(value) || (rule.type === 'integer' && !Number.isInteger(value)) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity)) throw new Error('Nieprawidłowa liczba.');
  }
  check(args, schema);
  if (args.bounds) { const b = args.bounds; if (b.south < -90 || b.north > 90 || b.west < -180 || b.east > 180 || b.south > b.north || b.west > b.east) throw new Error('Nieprawidłowe granice mapy.'); }
}
export async function executeTool(name, args, state, provider = catalogProvider) {
  validate(name, args);
  if (name === 'search_places') {
    const results = await provider.search(args);
    state.results = results;
    return { results, live: false, notice: 'Dane demonstracyjne. Brak dostępu do bieżących wydarzeń, godzin otwarcia i opóźnień.' };
  }
  if (name === 'filter_results') {
    const { normalize } = await import('./catalog.mjs');
    state.results = state.results.filter(p => (!args.category || p.category === args.category) && (!args.district || normalize(p.district).includes(normalize(args.district))) && (!args.bounds || (p.lat >= args.bounds.south && p.lat <= args.bounds.north && p.lng >= args.bounds.west && p.lng <= args.bounds.east)));
    return { results: state.results };
  }
  if (name === 'display_results') {
    if (args.ids.some(id => !state.results.some(p => p.id === id))) throw new Error('Najpierw wyszukaj wskazane miejsca.');
    const results = [...new Set(args.ids)].map(id => state.results.find(p => p.id === id));
    state.actions.push({ type: 'display_results', title: args.title, results });
    return { displayed: results.length };
  }
  state.actions.push({ type: 'focus_map', ...args });
  return { focused: true };
}
