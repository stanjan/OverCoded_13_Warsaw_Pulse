import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createCatalog, normalizeRecord, matches } from '../mcp/catalog.mjs';
import { createDispatcher } from '../mcp/protocol.mjs';
import { createMcpClient } from '../mcp/client.mjs';
import { executeTool } from '../server/tools.mjs';
import { SYSTEM_PROMPT } from '../server/assistant.mjs';
import { fitResultBudget, boundDisplayAction } from '../server/result-budget.mjs';

// Published scb_lokalizacja_defibrylatorow example and real 2026-10-18 response.
const at = '2026-10-17T23:20:17Z';
const feature = (properties = {}, geometry = { type: 'Point', coordinates: [[21.0148748892902, 52.2086170695684]] }) => ({
  geometry, properties: {
    defibrillator_id: '622', device_access_description: 'Poniedziałek: godz. 8:00-18:00; Wtorek-Piątek: godz. 8:00-16:00',
    device_availability: 'Ograniczona', device_location: 'Wewnątrz budynku', device_manufacturer: 'Medtronic', device_public_access: 'Publiczny',
    location_building: '25/27', location_city: 'Warszawa', location_description: 'Przy wejściu na półpiętrze.',
    location_object_name: 'Urząd Dzielnicy Mokotów m.st. Warszawy', location_postcode: '02-517', location_street: 'Rakowiecka', ...properties,
  },
});
const provider = rows => createCatalog({ token: () => 'test-city-token', now: () => at, fetchImpl: async () => Response.json(rows) });

test('AED uses the published nested longitude/latitude point and preserves access evidence without live claims', () => {
  const record = normalizeRecord(feature(), 'aed', at);
  assert.equal(record.lat, 52.2086170695684); assert.equal(record.lng, 21.0148748892902);
  assert.equal(record.name, 'Defibrylator AED · Urząd Dzielnicy Mokotów m.st. Warszawy');
  assert.equal(record.aedId, '622'); assert.equal(record.address, 'Rakowiecka 25/27');
  assert.equal(record.city, 'Warszawa'); assert.equal(record.postcode, '02-517'); assert.equal(record.manufacturer, 'Medtronic');
  assert.equal(record.availability, 'Ograniczona'); assert.equal(record.publicAccess, 'Publiczny');
  assert.equal(record.deviceLocation, 'Wewnątrz budynku'); assert.equal(record.locationDescription, 'Przy wejściu na półpiętrze.');
  assert.match(record.openingHours, /Wtorek-Piątek/); assert.match(record.description, /Dostęp według źródła: Publiczny/);
  assert.deepEqual(record.districts, []); assert.equal(record.district, ''); // Object name is not a district field.
  assert.equal(record.live, false); assert.equal(record.provenance.datasetId, '7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8');
  assert.equal(record.provenance.fetchedAt, at); assert.equal(record.provenance.sourceUpdatedAt, null);
  assert.deepEqual(record.provenance.observedAt, []); assert.equal(record.provenance.freshness, 'unknown');
  for (const key of ['openNow', 'operational', 'accessible', 'available24h']) assert.equal(Object.hasOwn(record, key), false);
  for (const value of ['Tak', 'Nie', 'Nie (dostęp: pon. - piątek 8:00 - 16:00)', 'dostęp w godz. 8:00 - 17:00']) {
    assert.equal(normalizeRecord(feature({ device_availability: value }), 'aed', at).availability, value);
  }
});

test('AED missing fields remain unknown and malformed geometry is never guessed or flattened', () => {
  const flat = normalizeRecord(feature({}, { type: 'Point', coordinates: [21.1, 52.2] }), 'aed', at);
  assert.equal(flat.lat, 52.2); assert.equal(flat.lng, 21.1);
  for (const geometry of [null, { type: 'LineString', coordinates: [[21, 52]] }, { type: 'Point', coordinates: [[21, 52], [22, 53]] }, { type: 'Point', coordinates: [[null, 52]] }, { type: 'Point', coordinates: [[21, 999]] }, { type: 'Point', coordinates: [[[[21, 52]]]] }]) {
    const record = normalizeRecord(feature({ device_availability: null, device_public_access: null, device_access_description: null }, geometry), 'aed', at);
    assert.equal(record.lat, undefined); assert.equal(record.lng, undefined);
    assert.equal(record.availability, ''); assert.equal(record.publicAccess, ''); assert.equal(record.openingHours, '');
    assert.match(record.description, /Dostęp całodobowy według źródła: brak danych/);
    assert.equal(matches(record, { bounds: { south: 50, north: 53, west: 20, east: 22 } }), false);
  }
  const fallback = normalizeRecord(feature({ location_object_name: '' }), 'aed', at);
  assert.equal(fallback.name, 'Defibrylator AED · Rakowiecka 25/27');
  const safe = normalizeRecord(feature({ location_object_name: '<b>Urząd</b>', location_description: '<img src=x>Wejście' }), 'aed', at);
  assert.equal(safe.name, 'Defibrylator AED · Urząd'); assert.equal(safe.locationDescription, 'Wejście');
});

test('AED full-data adapter verifies endpoint and fails explicitly on source/schema changes', async () => {
  const catalog = createCatalog({ token: () => 'test-city-token', now: () => at, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://dane.um.warszawa.pl/api/action/get_scb_lokalizacja_defibrylatorow');
    assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, 'test-city-token'); assert.equal(init.redirect, 'error');
    assert.equal(init.body, undefined); // No per-ID photo payload or truncating page request.
    return Response.json(Array.from({ length: 710 }, (_, i) => feature({ defibrillator_id: String(i) })));
  } });
  const result = await catalog.search({ category: 'aed' });
  assert.equal(result.total, 710); assert.equal(result.complete, true); assert.equal(result.sources[0].fetched, 710);
  for (const payload of [{ result: [feature()] }, { features: [feature()] }, [feature({ defibrillator_id: '' })], [{ properties: [] }], [feature({ location_object_name: '', location_street: '', location_building: '' })]]) {
    const failed = await provider(payload).search({ category: 'aed' });
    assert.equal(failed.complete, false); assert.deepEqual(failed.results, []); assert.equal(failed.errors[0].category, 'aed');
  }
  for (const status of [401, 503]) {
    const failed = await createCatalog({ token: () => 'test', fetchImpl: async () => ({ ok: false, status }) }).search({ category: 'aed' });
    assert.equal(failed.complete, false); assert.equal(failed.errors[0].code, status === 401 ? 'SOURCE_AUTH' : 'SOURCE_HTTP_503');
  }
});

test('AED MCP discovery, query/geography, filtering, details/display and sourced destination use existing flow', async () => {
  const state = { results: [], actions: [] }, catalog = provider([feature(), feature({ defibrillator_id: '900', location_object_name: 'Biuro', device_public_access: 'Prywatny' })]);
  const client = createMcpClient(createDispatcher({ state, provider: catalog }));
  const inventory = await client.callTool('list_data_sources', {});
  assert.equal(inventory.sources.find(s => s.category === 'aed').title, 'Lokalizacja defibrylatorów (AED)');
  assert.match(inventory.limitations.join(' '), /nie potwierdzają stanu urządzenia/);
  const found = await client.callTool('search_places', { category: 'aed', query: 'Rakowiecka', bounds: { south: 52.20, north: 52.22, west: 21, east: 21.03 } });
  assert.equal(found.total, 2); // Private access is retained and labelled, never hidden or relabelled public.
  const selected = await client.callTool('filter_results', { query: 'Publiczny' }); assert.equal(selected.total, 1);
  const id = selected.results[0].id;
  const shown = await client.callTool('display_results', { ids: [id], highlightIds: [id], title: 'Defibrylatory AED' });
  assert.equal(shown.action.results[0].openingHours, selected.results[0].openingHours);
  assert.equal(shown.action.highlights[0].aedId, '622');
  const route = await client.callTool('plan_transit', { destinationId: id });
  assert.equal(route.action.destination.latitude, 52.2086170695684);
  assert.equal(matches(selected.results[0], { district: 'Mokotów' }), false);
  for (const filter of [{ accessible: true }, { paid: false }, { changingTable: false }, { dateFrom: '2026-10-18' }]) assert.equal(matches(selected.results[0], filter), false);
  const appState = { results: [], actions: [] };
  assert.equal((await executeTool('search_places', { category: 'aed', query: 'Prywatny' }, appState, catalog)).total, 1);
  assert.match(SYSTEM_PROMPT, /category aed/); assert.match(SYSTEM_PROMPT, /Nie odczytuj availability „Tak” jako potwierdzenia sprawności/);
});

test('oversized AED projections retain access evidence and provenance in model and browser copies', () => {
  const record = normalizeRecord(feature({ location_description: 'Wejście '.repeat(30000) }), 'aed', at);
  const fitted = fitResultBudget({ results: [record], total: 1, complete: true, sources: [], errors: [], dataMode: 'official' });
  assert.equal(fitted.response.narrowing.fieldsProjected, true);
  assert.equal(fitted.response.results[0].availability, 'Ograniczona'); assert.equal(fitted.response.results[0].publicAccess, 'Publiczny');
  assert.equal(fitted.response.results[0].aedId, '622'); assert.equal(fitted.records[0], record);
  assert.equal(fitted.response.suggestedRefinements.categories[0].label, 'defibrylatory AED');
  const action = boundDisplayAction({ type: 'display_results', results: [record], highlightIds: [record.id], highlights: [record] });
  assert.equal(action.results[0].deviceLocation, 'Wewnątrz budynku'); assert.equal(action.results[0].availability, 'Ograniczona');
  assert.equal(action.results[0].provenance.sourceUpdatedAt, null); assert.equal(action.highlights[0], action.results[0]);
});

test('real stdio exposes AED category and emits verified source/access display records', { timeout: 5000 }, async () => {
  const boot = `globalThis.fetch=async()=>Response.json(${JSON.stringify([feature()])});await import('./mcp/stdio.mjs');`;
  const proc = spawn(process.execPath, ['--input-type=module', '--eval', boot], { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DATA_API_KEY: 'test-city-token' } });
  const lines = createInterface({ input: proc.stdout }), pending = new Map(); let stderr = '';
  proc.stderr.on('data', data => stderr += data);
  lines.on('line', line => { const msg = JSON.parse(line); pending.get(msg.id)?.(msg); pending.delete(msg.id); });
  const request = (id, method, params) => new Promise(resolve => { pending.set(id, resolve); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (id, name, args) => JSON.parse((await request(id, 'tools/call', { name, arguments: args })).result.content[0].text);
  try {
    await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'aed-test', version: '1' } });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const found = await call(2, 'search_places', { category: 'aed' }); assert.equal(found.total, 1); assert.equal(found.complete, true);
    const id = found.results[0].id;
    const shown = await call(3, 'display_results', { ids: [id], highlightIds: [id], title: 'AED' });
    assert.equal(shown.action.results[0].publicAccess, 'Publiczny'); assert.match(shown.action.results[0].sourceUrl, /7bc32ffc/); assert.equal(stderr, '');
  } finally { proc.stdin.end(); proc.kill(); }
});
