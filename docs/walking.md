# Walking paths and transfer times

`server/walking.mjs` requests Valhalla's pedestrian route using OpenStreetMap paths, at a walking speed of 4.32 km/h. ZTM still supplies transit schedules and vehicle evidence; Google is used only for the optional basemap.

`planPedestrianGraph(graph, options, { provider })` in `server/walking-router.mjs` wraps the synchronous timetable planner. Candidate walks initially use its old heuristic. Each selected walk is then routed and its actual duration is inserted into the next timetable search, before boarding and transfer checks. Unreachable directed edges are excluded. Only options with all nonzero walking legs verified are returned. This can invalidate an earlier departure or connection, and search another candidate. It is a bounded search, not a claim of global optimality.

The wrapper uses at most 12 route calls, 16 search rounds and 25 seconds per request. Endpoint snapping is limited to 25 m at each end. These short endpoint gaps and their estimated walking time are disclosed; they are not claimed to be mapped paths. The destination pin stays on the actual requested location. Failures, cancellation and limits cannot turn heuristic walks into verified blue paths. A verified subset may be returned with a coverage warning; when none can be verified the service reports an explicit limitation.

Walking edges and paths are request-local RAM only. No GPS history or on-disk path cache is created. The default public FOSSGIS Valhalla demo is for local prototypes: requests identify `warsaw-ai-local-prototype`, globally start at most once per second in a server process, and the queue is bounded. For production use, host your own Valhalla graph/service and set `WALK_ROUTING_URL` to its trusted HTTPS `/route` endpoint. HTTP is accepted only for loopback self-hosting. This environment setting is server-controlled, never accepted from users or model tool arguments. Redirects are refused and no city API key is forwarded.

Both map renderers display confirmed walking geometry as blue dots with white outlines, every 12 pixels. Schematic unverified geometry retains a visibly distinct gray style. Route details credit OpenStreetMap and Valhalla, including on the Google basemap.

Official API reference: https://valhalla.github.io/valhalla/api/route/api-reference/
Demo service policy: https://github.com/valhalla/valhalla#demo-server
`createTransitService({ walkingProvider })` supports an injected provider for deterministic service tests; production uses the configured Valhalla adapter by default. Continuous all-fleet delay learning is independent of the pedestrian provider and remains active while a request validates its walking legs. The service passes current exact-trip deltas into every replan, so both real walking times and learned delays affect transfer feasibility.
