# Warsaw city-data MCP

Node.js 24+, no additional dependencies. From the repository root run:

```powershell
node --env-file-if-exists=.env mcp/stdio.mjs
```

Set `DATA_API_KEY` in the server environment or ignored `.env` for city data. It is a token for **the new city portal**, sent as raw `Authorization` (not Bearer). Never place it in browser code or MCP arguments. Missing/invalid credentials produce explicit source errors. There is no fixture fallback. The independent GUGiK address lookup is public and needs no key.

The stdio entry point implements newline-delimited UTF-8 JSON-RPC, MCP initialization / initialized notification, ping, tools/list and tools/call. Supported protocol versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05. Unknown requested versions negotiate the latest implemented version. Stdout contains protocol JSON only. Independent clients can launch the entry point with a standard MCP stdio configuration:

```json
{"mcpServers":{"warsaw":{"command":"node","args":["--env-file-if-exists=.env","mcp/stdio.mjs"],"cwd":"C:/warsaw-ai"}}}
```

Use your client's supported working-directory setting, or absolute entry-point/environment-file paths if it lacks `cwd`. Credentials are supplied by the local environment, never this configuration example.

The app's `server/tools.mjs` uses `createMcpClient` with a paired in-process transport. Every search, filter, display and focus request passes through serialized JSON-RPC and the same protocol dispatcher/lifecycle as stdio. The in-process transport avoids per-conversation child processes. Replace the client transport to connect another host; the default app does not launch a separate stdio process. Tool state belongs to the conversation. The app sends full display actions to its UI, but returns only display counts/highlight IDs to the model to avoid duplicating selected records in its prompt. Standalone MCP display responses include the full action.

## Tools and matching

- `list_data_sources`: configured categories, separate GUGiK address-search capability, supported filters and limitations without fetching records or changing the current selection. Inventory questions do not search the full catalogue; this metadata does not assert live source availability or freshness.
- `search_addresses`: building lookup with `street`, `number` and optional `city` (Warszawa only). Uses the official [GUGiK UUG GetAddress](https://services.gugik.gov.pl/uug/opis.html), fixed HTTPS endpoint, `exact_number=1`, `srid=4326` (x longitude, y latitude), no key, rejected redirects, ten-second timeout and 256 KiB response bound. Local case/diacritic/street-prefix normalization verifies the exact city, street and house number; provider confidence is never enough to substitute a similarly named street or house. Result includes source provenance, candidate IDs and `exact_match`, `clarification_required` or `not_found`. The source's `found objects` counts index candidates and is not a count of actual address matches. Null results with zero returned objects are valid; street centroids, malformed data, HTTP failures and timeouts are explicit errors.
- `plan_transit`: exactly one destination from `destinationAddressId`, `destinationId` (event/place), `destinationQuery` (selected stop/platform) or `destinationCoordinates`; optional `originAddressId`, `originQuery` or `originCoordinates`, and `departureTime`. Address IDs must be locally exact results from this conversation; approximate results cannot route. Ask for clarification on ambiguous results. After a user confirms a similar street/house, search that address again before planning. Omitting origin preserves last-known-GPS/start-selection behavior. Emits `planning_requested` and an action to the existing chat itinerary UI; it does not itself calculate a route/ETA. Municipal/ZTM data continues to supply routes and live-delay estimates, without Google routing.
- `search_places`: all matching records. Categories: `event`, `sports`, `pitch`, `route`, `toilet`, `aed`. Optional query, district, activity, audience, weekday, dateFrom/dateTo (YYYY-MM-DD), bounds and maxLengthKm. Toilet-only boolean filters `paid`, `accessible` and `changingTable` require an explicit source value; unknown values and other categories do not match. Weather and air-quality searches are rejected; production chat receives that data automatically from the server environment service, together with location, source times and GPS-versus-central-Warsaw basis.
- `filter_results`: identical filters on the previous result set.
- `display_results`: every context-selected ID, title and 1–3 unique highlightIds drawn from those IDs. Empty selection requires empty highlights. Unknown IDs and unsupported/invalid filters fail.
- `focus_map`: validated latitude/longitude/zoom.

Dates match inclusive source occurrence dates. Undated recurring sports do not satisfy a date filter: use their explicitly provided weekday; the response preserves unknown dates. Audience/activity matching uses source labels. Pitch weekday matching requires reported hours and excludes closed/unknown placeholders; it is **not** an open-now check. A source day/range is not a promise of current availability. Events preserve all source point locations; a district/bounds filter uses a matching location for the pin. Missing/invalid place coordinates yield cards without pins; address geocoding is an explicit separate operation, never invented coordinates or a silent change to catalogue records.

Address candidate sets are independent of event/search/display state and survive clarification across assistant turns. Only the latest four sets (at most 60 candidates), valid for ten minutes, remain in RAM; there is no disk cache or GPS history. Start and destination searches therefore coexist. Requery replaces that query's prior IDs, including on failure; other address queries remain available. Verification/invalidation persists even if generating the subsequent assistant reply fails, so a failed refresh never resurrects an old address ID. Expired or unknown IDs fail instead of silently picking a point. Standalone stdio and the app use the same seven MCP tools and dispatcher.

Each result includes source/dataset URL, dataset ID, fetchedAt, sourceUpdatedAt if supplied, source observation times and Europe/Warsaw provenance. Observation times without an explicit offset remain verbatim and freshness is `unverified_source_time`. Download time is not observation time. Weather records are station observations, not forecasts; air records retain pollutant values/units and source recommendations without adding independent health guidance.

A search response includes `total`, `complete`, per-source fetched/matched counts and explicit `errors`. Partial sources retain known-good records but `complete:false` is carried to later display actions and shown in the UI. HTTP/auth/timeouts, unknown envelopes or malformed records cannot become a successful empty search. Redirects are rejected so authorization cannot be forwarded to another host.

## Official source evidence

Current MCP search uses four activity sources, the toilet catalogue and municipal AED locations. Weather/air adapters and the six-source measurements below are historical verification evidence; those categories are no longer exposed by MCP schemas, inventory or default searches. Environment context uses the separate location-based service documented in `docs/environment.md`.

Verified 2026-10-17 against the public [catalogue API](https://dane.um.warszawa.pl/api/datasets?lang=pl&page=1&size=1000), the repository's catalogue snapshot, each official parameter/example file below, and authenticated POST responses. The example files document the exact endpoints and raw authorization header. All seven document a complete dataset response with **no page, limit or cursor parameters**. Accordingly adapters read every record from the full response, including 1,227 pitches; they do not fabricate pagination or silently cap records. A future paginated/unknown envelope fails explicitly until a verified pagination contract is implemented.

| Category | POST endpoint under https://dane.um.warszawa.pl/api/action/ | Official parameters / examples |
| --- | --- | --- |
| event | get_bmm_kalendarz_wydarzen | [parameters](https://dane.um.warszawa.pl/files/bmm_kalendarz_wydarzen_pa.json), [examples](https://dane.um.warszawa.pl/files/bmm_kalendarz_wydarzen_pw.json) |
| sports | get_bmm_zajecia_sportowe | [parameters](https://dane.um.warszawa.pl/files/bmm_zajecia_sportowe_pa.json), [examples](https://dane.um.warszawa.pl/files/bmm_zajecia_sportowe_pw.json) |
| weather | get_zom_pogoda | [parameters](https://dane.um.warszawa.pl/files/zom_pogoda_pa.json), [examples](https://dane.um.warszawa.pl/files/zom_pogoda_pw.json) |
| pitch | get_be_otwarte_boiska | [parameters](https://dane.um.warszawa.pl/files/be_otwarte_boiska_pa.json), [examples](https://dane.um.warszawa.pl/files/be_otwarte_boiska_pw.json) |
| route | get_sbt_trasy_turystyczne | [parameters](https://dane.um.warszawa.pl/files/sbt_trasy_turystyczne_pa.json), [examples](https://dane.um.warszawa.pl/files/sbt_trasy_turystyczne_pw.json) |
| toilet | get_m_toalety | [parameters](https://dane.um.warszawa.pl/files/m_toalety_pa.json), [examples](https://dane.um.warszawa.pl/files/m_toalety_pw.json) |
| aed | get_scb_lokalizacja_defibrylatorow | [parameters](https://dane.um.warszawa.pl/files/scb_lokalizacja_defibrylatorow_pa.json), [examples](https://dane.um.warszawa.pl/files/scb_lokalizacja_defibrylatorow_pw.json) |
| air_quality | get_bopipk_monitoring_jakosci_powietrza | [parameters](https://dane.um.warszawa.pl/files/bopipk_monitoring_jakosci_powietrza_pa.json), [examples](https://dane.um.warszawa.pl/files/bopipk_monitoring_jakosci_powietrza_pw.json) |

Tourist routes preserve the city's ordered `[latitude, longitude]` traces as
`traceSegments`, with `geometryStatus` and `traceVertexCount`. Invalid vertices
split segments instead of connecting across a gap; missing geometry remains a
marker/list result. Traces above 10,000 source vertices explicitly report
`too_large` rather than drawing a truncated path. Google and Leaflet display
muted returned traces, highlight the selected route, frame its whole geometry
around the weather/sheet overlays, and show numbered, named published tourist
points. A new question clears these layers. Selection survives map fallback.
Tourist results allow one recommended route (event highlights still allow three),
enforced by both MCP display and the browser-action boundary. The assistant uses
expressed length, theme and location needs and published route facts to explain
its suggestion; unknown suitability/accessibility is not inferred. The map uses
a cream-cased antique brass dashed trail, compass markers and numbered medallions
for tourism rather than transit styling. The recommended trace is emphasized
immediately. Tourist detail clouds have a compact ornamental header and bounded
scrolling content; measured cloud space is reserved above the whole route, and
native popup auto-pan is disabled so it cannot undo the route framing.
Model-facing app responses omit trace vertices while retained server records and
browser display actions keep them; external MCP results remain complete. Under
exceptional browser payload pressure, geometry is explicitly unavailable with
`browser_capacity`, never silently simplified or replaced by a straight line.

Observed response details take precedence over typos in parameter prose: events use `occurrence`; air uses `address` and `data`; weather uses lowercase `lokalizacja`. Routes wrap the complete array in `{result:[...]}`; the other six return bare arrays. Pitches have addresses/districts/schedules but no coordinates. Sports often supply recurring weekdays without dates or map points.

Live adapter smoke on 2026-10-17: 649 events, 592 sports records, 16 weather stations, 1,227 pitches, 9 routes and 141 air stations; **2,634 normalized records, complete=true, no errors**, 1,697 without spatial coordinates. Counts are observations, not fixed assertions about future data.
The [Toalety dataset](https://dane.um.warszawa.pl/pl/catalogue/59485767-5566-4cb6-9545-a9053efca4ff) was verified separately on 2026-10-17: 695 GeoJSON Features with Point coordinates in `[longitude, latitude]` order, returned as a complete bare array. This public-access catalogue includes toilets in public/private buildings; it does not establish municipal ownership or current opening status. Records retain location, district, type, operator, hours, notes, source origin and verbatim update month (for example `Kwiecień 2026`). Numeric `platnosc`, `dostepnosc` and `przewijak` flags map strictly from 0/1 to `paid`, `accessible` and `changingTable`; missing or unrecognized values become null. `accessible=true` means the source says available to everyone; false means architectural barriers. No fee amount, wheelchair certification or open-now status is inferred. Invalid/missing point coordinates remain unlocated; malformed records and changed envelopes report an incomplete source. No new disk cache is added.

## Capacity and validation

The MCP/provider returns complete results without top-N limits. The app budgets the actual serialized model request, including escaped tool contents, schemas, history, model/session fields and UTF-8 bytes. A complete small response stays unchanged. Model-facing tool content has a 120,000-character budget; serialized messages and request bodies have conservative limits of 700,000 characters / 1,400,000 bytes, leaving headroom below the bridge's final 1,000,000-character / 2 MiB guard.

When a result set cannot fit, the server first reclaims large historical tool payloads if that can preserve a small new response. Otherwise it tries event date windows of 3 days, 2 days and 1 day, using the Europe/Warsaw calendar. An explicit dateFrom anchors that sequence (including future trips); dateTo caps it. Without requested dates the sequence starts today. Non-event records remain in the set during event-date narrowing; undated events are excluded explicitly, never claimed to match a date. If dates still do not fit, the server tries radii of 25, 10, 5, 2, 1, 0.5 and 0.25 km around the last known normalized browser GPS point regardless of measurement age or accuracy. It uses Haversine distance and an allowed source location, preserves every match inside the radius, and discloses records excluded for missing coordinates. Old or undated GPS remains usable, with its real timestamp/freshness disclosed as a last known point. Central-Warsaw environment coordinates never substitute for the user's location.

An accepted narrowed response has status automatically_narrowed and narrowing metadata: original/effective counts, requested and effective filters, attempted windows/radii, exclusions and the GPS measurement basis/accuracy where applicable. Source warnings and provenance remain present; per-source matched counts are accompanied by matchedBeforeNarrowing. The assistant must tell the user the effective date/distance scope and that it was narrowed. Display actions carry the same metadata and validate IDs only against this effective set.

The full requested result set remains separately on the server, so a subsequent filter_results can refine it without inheriting the automatic scope or refetching. Explicit successive manual filters remain cumulative. External MCP responses remain complete. If no honest set fits (including a single enormous record), the model gets an explicit bounded refinement_required response with zero records provided, original counts and source warnings. It asks for a district/topic/date or a fresh location rather than recommending unseen records. A pathological uncompactable conversation returns a normal clarification before any oversized bridge request. Large historical tool data is summarized only under capacity pressure; normal prior conversation prefixes remain unchanged.

Failed turns do not commit conversation history or undisplayed searches. If a streamed display already reached the UI, its effective records, full requested set, applied filters and source warnings are retained together for follow-ups; a later undisplayed search cannot replace that snapshot on failure. Nonstream failures retain the previous successful state.

Run `node --test tests/*.test.mjs` and `node scripts/build.mjs` (equivalent package scripts: `npm test`, `npm run build`). Focused tests cover full datasets, partial failures, source/schema/auth errors, date/weekday/unknown metadata, invalid/multiple coordinates, ID/highlight selection, completeness across turns, capacity errors, app/client JSON-RPC routing and a real stdio subprocess.

Protocol reference: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). This implementation exposes tools only; it does not claim HTTP transport, resources, prompts or arbitrary command execution.


### Defibrillators (AED)

The official [AED dataset](https://dane.um.warszawa.pl/pl/catalogue/7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8), provided by Stołeczne Centrum Bezpieczeństwa, was verified on 2026-10-18 (Warsaw time): the authenticated full-data action returned a bare array of 710 records, all with valid coordinates. The catalogue declares daily refresh; its metadata modification date does not establish a per-device observation time.

Use `category: "aed"` for Polish defibrylator/defibrylatory or AED requests. The source uses `geometry.type: "Point"` with `coordinates: [[longitude, latitude]]`; the adapter also accepts an ordinary Point pair, never arbitrary nesting or multiple points. Normalized records retain `aedId`, address/city/postcode, manufacturer, `openingHours` (the literal access description), `availability` (the literal source statement about 24-hour access), `publicAccess`, `deviceLocation` and `locationDescription`. Availability values include `Ograniczona`, `Tak`, `Nie` and free text. They are never interpreted as a working-device or current-open guarantee. The catalogue includes records marked `Prywatny`; do not relabel them public. Missing source metadata remains empty, and provenance freshness stays unknown. No district field is published: do not infer one from an object name. Use a known geographic bounds filter or address/object query; a district filter cannot match unknown districts. Toilet accessibility/fee/changing-table filters do not apply to AEDs.

The existing search/filter/display and destination-ID flow exposes these sourced fields; bounded model/browser projections retain access evidence. Invalid points remain list-only and cannot become a routing destination. Unknown record shapes/envelopes report incomplete source availability. The optional per-device API photo request is not made, no base64 attachments are retained, and no new disk cache is added. Icon design belongs to the separate UI task.
