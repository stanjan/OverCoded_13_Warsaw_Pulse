# Warsaw city-data MCP

Node.js 24+, no additional dependencies. From the repository root run:

```powershell
node --env-file-if-exists=.env mcp/stdio.mjs
```

Set `DATA_API_KEY` in the server environment or ignored `.env`. It is a token for **the new city portal**, sent as raw `Authorization` (not Bearer). Never place it in browser code or MCP arguments. Missing/invalid credentials produce explicit source errors. There is no fixture fallback.

The stdio entry point implements newline-delimited UTF-8 JSON-RPC, MCP initialization / initialized notification, ping, tools/list and tools/call. Supported protocol versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05. Unknown requested versions negotiate the latest implemented version. Stdout contains protocol JSON only. Independent clients can launch the entry point with a standard MCP stdio configuration:

```json
{"mcpServers":{"warsaw":{"command":"node","args":["--env-file-if-exists=.env","mcp/stdio.mjs"],"cwd":"C:/warsaw-ai"}}}
```

Use your client's supported working-directory setting, or absolute entry-point/environment-file paths if it lacks `cwd`. Credentials are supplied by the local environment, never this configuration example.

The app's `server/tools.mjs` uses `createMcpClient` with a paired in-process transport. Every search, filter, display and focus request passes through serialized JSON-RPC and the same protocol dispatcher/lifecycle as stdio. The in-process transport avoids per-conversation child processes. Replace the client transport to connect another host; the default app does not launch a separate stdio process. Tool state belongs to the conversation. The app sends full display actions to its UI, but returns only display counts/highlight IDs to the model to avoid duplicating selected records in its prompt. Standalone MCP display responses include the full action.

## Tools and matching

- `list_data_sources`: configured categories, supported filters and limitations without fetching records or changing the current selection. Inventory questions do not search the full catalogue; this metadata does not assert live source availability or freshness.
- `search_places`: all matching records. Categories: `event`, `sports`, `weather`, `pitch`, `route`, `air_quality`. Optional query, district, activity, audience, weekday, dateFrom/dateTo (YYYY-MM-DD), bounds and maxLengthKm.
- `filter_results`: identical filters on the previous result set.
- `display_results`: every context-selected ID, title and 1–3 unique highlightIds drawn from those IDs. Empty selection requires empty highlights. Unknown IDs and unsupported/invalid filters fail.
- `focus_map`: validated latitude/longitude/zoom.

Dates match inclusive source occurrence dates. Undated recurring sports do not satisfy a date filter: use their explicitly provided weekday; the response preserves unknown dates. Audience/activity matching uses source labels. Pitch weekday matching requires reported hours and excludes closed/unknown placeholders; it is **not** an open-now check. A source day/range is not a promise of current availability. Events preserve all source point locations; a district/bounds filter uses a matching location for the pin. Missing/invalid coordinates yield cards without pins; coordinates are never geocoded or invented.

Each result includes source/dataset URL, dataset ID, fetchedAt, sourceUpdatedAt if supplied, source observation times and Europe/Warsaw provenance. Observation times without an explicit offset remain verbatim and freshness is `unverified_source_time`. Download time is not observation time. Weather records are station observations, not forecasts; air records retain pollutant values/units and source recommendations without adding independent health guidance.

A search response includes `total`, `complete`, per-source fetched/matched counts and explicit `errors`. Partial sources retain known-good records but `complete:false` is carried to later display actions and shown in the UI. HTTP/auth/timeouts, unknown envelopes or malformed records cannot become a successful empty search. Redirects are rejected so authorization cannot be forwarded to another host.

## Official source evidence

Verified 2026-10-17 against the public [catalogue API](https://dane.um.warszawa.pl/api/datasets?lang=pl&page=1&size=1000), the repository's catalogue snapshot, each official parameter/example file below, and authenticated POST responses. The example files document the exact endpoints and raw authorization header. All six document a complete dataset response with **no page, limit or cursor parameters**. Accordingly adapters read every record from the full response, including 1,227 pitches; they do not fabricate pagination or silently cap records. A future paginated/unknown envelope fails explicitly until a verified pagination contract is implemented.

| Category | POST endpoint under https://dane.um.warszawa.pl/api/action/ | Official parameters / examples |
| --- | --- | --- |
| event | get_bmm_kalendarz_wydarzen | [parameters](https://dane.um.warszawa.pl/files/bmm_kalendarz_wydarzen_pa.json), [examples](https://dane.um.warszawa.pl/files/bmm_kalendarz_wydarzen_pw.json) |
| sports | get_bmm_zajecia_sportowe | [parameters](https://dane.um.warszawa.pl/files/bmm_zajecia_sportowe_pa.json), [examples](https://dane.um.warszawa.pl/files/bmm_zajecia_sportowe_pw.json) |
| weather | get_zom_pogoda | [parameters](https://dane.um.warszawa.pl/files/zom_pogoda_pa.json), [examples](https://dane.um.warszawa.pl/files/zom_pogoda_pw.json) |
| pitch | get_be_otwarte_boiska | [parameters](https://dane.um.warszawa.pl/files/be_otwarte_boiska_pa.json), [examples](https://dane.um.warszawa.pl/files/be_otwarte_boiska_pw.json) |
| route | get_sbt_trasy_turystyczne | [parameters](https://dane.um.warszawa.pl/files/sbt_trasy_turystyczne_pa.json), [examples](https://dane.um.warszawa.pl/files/sbt_trasy_turystyczne_pw.json) |
| air_quality | get_bopipk_monitoring_jakosci_powietrza | [parameters](https://dane.um.warszawa.pl/files/bopipk_monitoring_jakosci_powietrza_pa.json), [examples](https://dane.um.warszawa.pl/files/bopipk_monitoring_jakosci_powietrza_pw.json) |

Observed response details take precedence over typos in parameter prose: events use `occurrence`; air uses `address` and `data`; weather uses lowercase `lokalizacja`. Routes wrap the complete array in `{result:[...]}`; the other five return bare arrays. Pitches have addresses/districts/schedules but no coordinates. Sports often supply recurring weekdays without dates or map points.

Live adapter smoke on 2026-10-17: 649 events, 592 sports records, 16 weather stations, 1,227 pitches, 9 routes and 141 air stations; **2,634 normalized records, complete=true, no errors**, 1,697 without spatial coordinates. Counts are observations, not fixed assertions about future data.

## Capacity and validation

The MCP/provider returns complete results without top-N limits. Complete broad results can exceed the local bridge's capacity. Measured normalized JSON: all sources 3,891,859 characters / 3,977,615 UTF-8 bytes; event records 1,388,797 characters; sports 991,910; pitches 1,244,968; weather 13,050; routes 18,803; air 232,392. Conversation/tool overhead adds to these sizes. The app retains the full result set on the server. If a model-facing result exceeds 120,000 characters or would take history above 700,000 characters / 1,400,000 UTF-8 bytes, it returns an explicit `refinement_required` summary with exact total/category counts, source errors and zero records provided, instead of a truncated list. The assistant can apply known preferences with `filter_results` or ask for clarification; subsequent turns can refine the same full set without refetching. External MCP responses remain complete. The local adapter also retains its final guard against requests above 2 MiB body bytes or 1,000,000 serialized-message characters **before sending**. Nothing is sliced. Failed turns do not commit conversation history or undisplayed searches. If a streamed display already reached the UI, its exact search-result snapshot and source warnings remain available together for follow-ups; a later undisplayed search or a map-focus action cannot replace that snapshot on failure. Nonstream failures retain the previous successful state. Prefer conversation-derived filters before fetching.

Run `node --test tests/*.test.mjs` and `node scripts/build.mjs` (equivalent package scripts: `npm test`, `npm run build`). Focused tests cover full datasets, partial failures, source/schema/auth errors, date/weekday/unknown metadata, invalid/multiple coordinates, ID/highlight selection, completeness across turns, capacity errors, app/client JSON-RPC routing and a real stdio subprocess.

Protocol reference: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). This implementation exposes tools only; it does not claim HTTP transport, resources, prompts or arbitrary command execution.
