# Warsaw Pulse

A mobile-first assistant for exploring Warsaw: ask in Polish, compare recommendations in chat, and see places and routes on the map.

The app combines official city data, public-transport schedules and vehicle positions, pedestrian routing, weather and air quality. Its assistant connects to a locally signed-in CLI through the included bridge.

## Quick start

Requires **Node.js 24+**, a supported signed-in CLI (Codex, Antigravity or Claude), and internet access for models, city data and map assets. The root app and bridge have no additional npm dependencies.

1. For a new checkout, copy `.env.example` to `.env`. Keep any existing local configuration.
2. Set `DATA_API_KEY` to your Warsaw open-data portal token. Leave `CODEX_BRIDGE_URL=http://127.0.0.1:8780/v1` when both processes run on this computer.
3. Start the bridge in one terminal:

   ```sh
   npm run bridge:start
   ```

4. Start the app in another terminal:

   ```sh
   npm run dev
   ```

Open [the app](http://127.0.0.1:5173/). Both processes load the ignored `.env` from the repository root; restart the affected process after changing it.

If `npm` is unavailable, use `node --env-file-if-exists=.env bridge/server.mjs` and `node --env-file-if-exists=.env scripts/serve.mjs` instead.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATA_API_KEY` | Server-side token for the Warsaw open-data portal. |
| `CODEX_BRIDGE_URL` | Bridge endpoint; default example is `http://127.0.0.1:8780/v1`. |
| `CODEX_BRIDGE_MODEL` | Blank selects an available provider: Antigravity → Codex → Claude. Set explicitly to choose one. |
| `CODEX_BRIDGE_API_KEY` | Optional shared key; set the same value on the app and bridge. |
| `GOOGLE_MAPS_API_KEY` | Optional browser map key. Without it, the map uses Leaflet/OpenStreetMap. Restrict the key to the intended site and APIs. |
| `WALK_ROUTING_URL` | Optional Valhalla route endpoint; blank uses the public demo for local prototypes. |
| `HOST`, `PORT` | App listener; defaults to `127.0.0.1:5173`. |

See [.env.example](.env.example) for the complete configuration, including LAN bridge, HTTPS and external demo controls. Keep credentials and `.local/` files out of version control.

## What the app supports

- **City recommendations:** events, sports classes, pitches, tourist routes, toilets and AED locations through the city-data MCP. Verified results become chat cards and map markers; records without coordinates remain available as cards.
- **Addresses and travel:** GUGiK address lookup, ZTM-based public-transport options, live vehicle positions and departure boards. Live ETA uses confirmed delay evidence when available; otherwise times remain scheduled.
- **Walking routes:** verified OpenStreetMap/Valhalla paths, including pedestrian legs of transit trips. Google Maps supplies map rendering when configured, not route planning.
- **Location and environment:** last-known browser GPS context, weather, air quality, sunrise and sunset. Missing location is explicit; the map centre never substitutes for GPS.
- **Saved places and routes:** browser-local favorites, including tourist-route geometry and points.
- **Live demo:** prompt tiles in the presentation and an optional API for controlling one explicitly paired app tab.

Sources can be unavailable or incomplete; the app reports this rather than substituting fixture data. Restarting the app server clears in-memory conversations and live-delay learning. Demo access metadata is persisted separately when that feature is enabled.

## Presentation

The Slidev presentation lives in [2_OverCoded_WarsawPulse](2_OverCoded_WarsawPulse/). Install its separate dependencies and start it while the app and bridge are running:

```sh
cd 2_OverCoded_WarsawPulse
npm ci
npm run dev -- --port 3030
```

Open [the presentation](http://localhost:3030/). Slide 8 embeds the app at `http://localhost:5173` and sends prompts directly to that frame. It does not require remote-demo pairing or `DEMO_REMOTE_ENABLED`. Keep the app on port 5173 and the presentation on port 3030 for this local setup.

## Checks and build

Run from the repository root:

```sh
npm test
npm run bridge:test
npm run build
```

The build writes frontend assets to `dist/`; the assistant and transit APIs still require the Node server. Tests use controlled providers and do not prove availability of a live model subscription or upstream city service.

For the presentation, run `npm run build` inside its directory.

## Further documentation

| Topic | Guide |
| --- | --- |
| Provider setup, LAN connection and bridge health | [Assistant bridge](docs/bridge.md) |
| External prompt API, pairing and persistent demo links | [Remote demo controls](docs/demo.md) |
| Phone geolocation and trusted development certificates | [Local HTTPS](docs/local-https.md) |
| MCP tools, source evidence, filters and stdio setup | [City-data MCP](mcp/README.md) |
| Public transport and routing | [Transit](docs/transit.md) |
| Delay matching and prediction limits | [Live ETA](docs/live-eta.md) |
| Pedestrian paths and routing configuration | [Walking](docs/walking.md) |
| Weather, air quality and source times | [Environment](docs/environment.md) |

The original Stitch screens are retained in `design/` as design references.
