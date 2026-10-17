# Continuous live ETA

The HTTP server starts tracking both municipal vehicle feeds when DATA_API_KEY is configured, before any route request. Each cycle refreshes the current GTFS graph and samples both fleets concurrently. Sampling aims for a 15-second period measured from cycle start; timetable evidence runs separately, so a slow departure endpoint cannot delay the next GPS sample.

## Identity and progress

A binding requires municipal brigade evidence matching an exact departure clock, terminal direction and dated GTFS trip. A complete current-platform response takes precedence. Positive bindings can be reused only when they include every spatially and temporally plausible trip at the platform, so a partial line response cannot hide a competing branch. Missing evidence is queued; multiple plausible brigade-bound trips remain schedule-only. Missing/ambiguous geometry or an ambiguous current projection cannot eliminate a positively brigade-bound competing trip sharing the current platform. A genuinely off-shape competitor can be excluded; overlapping loop occurrences cannot. Conflicting simultaneous vehicle claims for one trip suppress its correction until the conflict expires. The existing ±15-minute schedule plausibility window remains an identity guard, not a stop-detection threshold.

The model projects each fresh source point onto the exact trip's directed GTFS shape and measures cumulative **meters along the shape**. Stop events become ordered progress points. Optional shape_dist_traveled values from shapes and stop_times are interpolated in their original, matching source units into those metric distances; they are not assumed to be meters. When shape-point distances are absent (as in the current Warsaw feed), stops are projected in sequence onto the geometry. Missing shapes, non-increasing/ambiguous stop mapping and ambiguous overlapping laps are rejected. A shape projection must be within 120 m of the shape, not within a circle around a stop. Multiple comparably near projections more than 30 m apart remain ambiguous, even if deleting a backwards candidate would leave a later lap. Backwards jitter up to 25 m cannot rewind the registered next stop; a larger reversal invalidates the binding. These checks protect route identity, not vehicle speed or a stationary dwell.

The first uniquely matched point establishes the **next stop ahead**. The first newer source record at/past that point (1 cm numerical tolerance) publishes a delta immediately: no observed stop entry, stop radius, stationary speed, dwell duration, or second-stop confirmation is required. If a poll skips several stops, only the furthest crossed stop receives the current delta. A point first seen halfway through a trip does not claim earlier crossings. A confirmed binding warms evidence for the next platform ahead of crossing. If that platform's evidence is still resolving at the crossing, RAM retains just the first pending crossing record; once the identity is uniquely verified, its original timestamp is used, rather than the later evidence/poll time. A later crossed stop replaces that pending record. Ambiguous evidence invalidates the candidate.

## Distance/time normalization

For source time `t` and projected progress `q` between stop i and next stop j:

```
fraction = (q - distance_i) / (distance_j - distance_i)
scheduledPassageAt = departure_i + fraction * (arrival_j - departure_i)
deltaMs = t - scheduledPassageAt
normalizationMs = scheduledPassageAt - arrival_of_latest_crossed_stop
estimatedArrivalAtStop = t - normalizationMs
```

This uses **scheduled travel time per distance**, never speed inferred from GPS samples. A published dwell at the crossed stop is included in normalization: movement starts at its scheduled departure and ends at the next scheduled arrival. It is an explicit schedule assumption, not a measurement of how long the vehicle actually dwelled. At an exact stop progress point the outgoing departure applies; at the terminal the scheduled arrival applies, normalization is zero, and no beyond-terminal travel time is extrapolated. This prevents the polling distance after a stop from being counted as raw lateness, while retaining signed early/late deltas. Observation metadata keeps actual `observedAt` separate from estimated passage/normalization time and distance.

A fresh accepted delta adjusts only later stops of the same dated trip, before boarding and transfer feasibility checks. A negative delta may adjust an arrival but never moves a departure before the timetable. UI shows signed minutes, source observation age and the model basis. Missing/stale/uncertain deltas use timetable times. This is a model estimate, not proof of doors opening or a guaranteed arrival feed.

## Bounds and diagnostics

Evidence work is FIFO, limited to 12 requests per cycle and four concurrent requests, independently of the two fleet requests. Queue and platform cache each hold at most 512 entries; shared positive associations hold at most 32,768 trip bindings across at most 256 lines. Evidence expires after ten minutes; failed requests return with bounded exponential backoff.

Only one current progress/next-stop state (and at most one pending crossing record while evidence resolves) per vehicle and current signed trip deltas are held in RAM, bounded to 5,000 vehicles. State/delta expiry remains three minutes. No GPS history is written to disk. Existing GTFS files are schedule data. Route searches consume the all-fleet model without restarting or narrowing it; future-date queries do not replace current-day tracking. Both map responses filter stale positions before selecting the nearest 40.

`liveModel` diagnostics expose pending/cached/shared evidence, source failures and timestamps, tracked/bound vehicles, vehicles awaiting a next stop, confirmed current deltas, the normalization method, and last fleet poll time/error. Cold start waits for a unique binding and the next crossing; it does not fabricate a live value before that crossing. Source records older than 90 seconds remain excluded independently of the user's last-known GPS location policy.
