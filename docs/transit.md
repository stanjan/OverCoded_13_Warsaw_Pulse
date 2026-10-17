# Municipal transit planning and current delay estimates

The Transit panel calculates journeys from official Warsaw/ZTM data. Google is an optional base-map renderer only: no Google routing, Directions, Routes or Places call is made. The same municipal geometry and vehicle markers render on Leaflet/OpenStreetMap.

## Sources and source contracts

- Official ZTM download page: https://www.ztm.waw.pl/pliki-do-pobrania/dane-rozkladowe/ . Its section on data sources links the current complete GTFS at https://gtfs.ztm.waw.pl/last . The verified download is a ZIP containing agency, feed_info, calendar, calendar_dates, routes, trips, stops, stop_times and shapes CSV files. Actual feed verified 17 October 2026: version schedule_ZTM_2026.10.16_1253869430_0735, valid 16–25 October, 6,940 stops. Validity is checked from every imported feed; these dates are not hard-coded.
- Municipal stop catalogue: dataset009fce84-0024-431a-aa5e-9515c539899e, POST get_ztm_przystanki_komunikacji_miejskiej. Bare array; each values array carries zespol, slupek, nazwa_zespolu, szer_geo and dlug_geo.
- Stop lines: dataset8eb065b6-f3a0-41d4-a842-732c6c1c3063, POST get_ztm_lista_linii_na_przystanku, JSON busstopId/busstopNr; values array has linia.
- Departures: datasetdedad7b7-85f4-4be9-b73e-8395cefb434c, POST get_ztm_odjazdy_linii_z_przystanku, JSON busstopId/busstopNr/line. Rows of key/value pairs: czas, brygada, kierunek, trasa. This endpoint has no verified service-date or unique-trip field. It never supplies a standalone invented itinerary. It is used as bounded brigade evidence or as explicitly undated fallback observations when GTFS is unavailable.
- Bus/tram positions: datasetf319f602-7292-4e8c-b3d1-f5898aa9a638, POST get_ztm_lokalizacja_pojazdow, JSON type1bus/type2tram. Actual fields: Brigade, Lines, Lat, Lon, Time, VehicleNumber. Time is interpreted as Warsaw local wall-clock time; ambiguous DST times remain unknown. The API includes old last-known records: HTTP200/download time does not make a position live. Older than90seconds, excessively future and unparseable observations do not train the model.

Municipal action URLs are https://dane.um.warszawa.pl/api/action/{action}; Authorization contains the existing DATA_API_KEY value directly, without Bearer. Credentials stay on the server and never reach the browser, repository, logs or source links.

## Runtime and retained data

Use the existing local server command. With DATA_API_KEY configured, one background tracker starts at server startup and polls both fleets every15seconds; it does not wait for a journey query. It shares the current-day GTFS import/cache with journey planning. Source failures are retried; estimates expire rather than becoming invented live times.

The sole persisted bulk cache is .local/transit/gtfs.zip, ignored by Git. Download streams to an atomic temporary file, with a100MB compressed limit, and replaces the single current ZIP; failed temporary downloads are removed. The large stop_times CSV is streamed without extraction. Only relevant dated trip instances are retained: selected day, prior-day overnight trips and next-day trips within the four-hour overnight search horizon. The current-day graph remains cached for prediction; future-day query graphs are ephemeral and do not replace/reset the continuous current-day model. Calendar-day changes load the new day and clear incompatible matches. Download/import cache TTL is six hours; unavailable/expired calendar days produce an explicit planning limitation. Do not commit, archive or duplicate GPS/vehicle history files.

RAM-only model state: at most 5,000 vehicles, one current route-progress/next-stop state and at most one first pending crossing per vehicle, plus current signed trip deltas. State and delta TTL are three minutes. Invalid/stale/line-or-brigade-changed observations invalidate corresponding estimates. Evidence is bounded to 512 queued/platform entries, 32,768 shared trip bindings, ten-minute TTL and 12 lookups per cycle with four concurrent requests. No GPS history or completed-journey archive is written to disk. See [continuous ETA](live-eta.md).

## Routing and limits

Resolve a named stop by selecting its platform suggestion, use explicit coordinates, choose Dojedź przy an existing map result, or ask the assistant for a street and building number in Warsaw. The MCP search_addresses tool verifies the address through official GUGiK UUG, then passes a verified address ID to plan_transit; ambiguous results require clarification, and similar streets/numbers cannot silently replace the requested building. Address candidates use bounded ten-minute conversation RAM only. GPS uses valid last-known browser coordinates, including older or imprecise measurements; age and accuracy remain explicit metadata. No city-centre origin substitution.

The round-based search retains GTFS trip identity and order, calendar/exception service membership, pickup/drop-off restrictions, and actual dated instants. GTFS service clocks follow the specification's local-noon-minus12hours plus elapsed seconds, including25-hour services and DST. User wall-clock departure input rejects nonexistent/ambiguous DST clocks rather than guessing an offset.

Search bounds: eight nearest stops within900m at each end; up to three boardings/two transfers; four-hour horizon; up to three distinct alternatives sorted by arrival. These are best among checked journeys, not a global optimality claim. Walking candidates are verified with OpenStreetMap/Valhalla geometry and duration before boarding/transfer checks; see [walking](walking.md). Transfers include two additional minutes. Transit uses official shape segments when endpoint matching is reliable, otherwise explicitly schematic stop connections. Fare, capacity, disruptions, road closures and guaranteed transfers are outside the verified contract.

The ordinary valid-GTFS journey makes at most three municipal calls (stops plus both vehicle types, usually cached), avoiding thousands of stop-departure requests. If GTFS is unavailable, fallback observations check at most one line on one stop at each end (maximum seven city calls). Separate continuous prediction uses both vehicle snapshots and at most 12 pending departure-evidence calls per cycle, with four concurrent.

## Live delta confidence

A line number alone never proves a trip. Unique dated trip identity requires municipal brigade/clock/direction evidence and an unambiguous projection onto its directed GTFS shape. The first point registers the next stop; the first newer record crossing that progress point publishes the current delta, even when sampling misses the stop itself or passes several stops. There is no speed, stationary dwell, stop-radius or two-stop gate. Ambiguous loops or competing trips remain unconfirmed.

The observation is normalized by scheduled travel time for its distance after the latest crossed stop. Between stops this interpolates from departure_i to arrival_j, with scheduled dwell explicitly included in the correction; the terminal uses arrival with zero extrapolation. Actual observedAt stays separate from the estimated stop passage. Full formulas, geometry limits and pending-evidence behavior are in [continuous ETA](live-eta.md).

A fresh accepted delta adjusts only later stops of that exact dated trip before boarding and transfer checks. Negative deltas adjust arrivals but never advance departures ahead of the published timetable. UI reports signed minutes, source observation age and the model basis. Missing/stale/uncertain deltas use schedule times. Tracking starts globally with the server; a cold model needs a unique binding and one next-stop crossing. The refresh button recomputes the existing itinerary with new deltas.

## Local API and assistant seam

- GET /api/transit/stops?q=... returns up to12suggestions plus total/provided counts and source; no credential.
- POST /api/transit/plan accepts origin/destination strings (selected stop/platform) or latitude/longitude objects, and departureTime ISO with explicit offset. It returns bounded alternatives, geometry, source/calendar provenance, observations, live-model coverage and explicit limitations.
- POST /api/transit/live accepts coordinate origin/destination and returns current nearby vehicle observations/model coverage for map refresh.
- MCP search_addresses accepts street, number and optional city=Warszawa; see [MCP address lookup](../mcp/README.md#tools-and-matching). MCP plan_transit accepts exactly one destinationAddressId, destinationId, destinationQuery or destinationCoordinates; optional originAddressId/originQuery/originCoordinates and departureTime. A destinationId is resolved only from verified existing place results; address IDs resolve only from this conversation's unexpired exact GUGiK matches. It emits a plan_transit browser action and status planning_requested. This is acceptance of a request, never a computed route or ETA. Browser/provider output alone supplies the itinerary.

Verification commands: node --test tests/*.test.mjs; node scripts/build.mjs; node --test bridge/*.test.mjs. Focused fixtures cover GTFS ZIP/CSV/calendar/DST/pickup data, exact trip identity, transfer feasibility, brigade evidence, headway aliasing, normalized progress crossings, stale/negative delays, request races, safe text, current vehicle markers and both map adapters. See issue8 comments for the current exact candidate, real source/browser smoke and RAM measurements.
