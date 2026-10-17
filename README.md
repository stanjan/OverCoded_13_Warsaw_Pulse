# Warsaw AI

Mobile web app imported from Stitch’s **Warszawa Pulse — Dodane Cieniowanie & Głębia** screen in project `4253701792170330935`.

Run `npm run dev` (or `node --env-file-if-exists=.env scripts/serve.mjs`) and open http://127.0.0.1:5173. Requires Node.js 24+.
Run `npm run build` (or `node scripts/build.mjs`) to produce the static app in `dist/`.

The current original export is preserved in `design/stitch-depth.html`; the previous welcome export remains in `design/stitch-welcome.html`. The app adapts the full-screen map, floating weather pill, shadowed bottom drawer and prompt cards for responsive widths, browser zoom, safe areas, keyboard input, accessible controls, and safe message rendering. The existing interactive map fills the design's map integration area.

The app includes an assistant backend at `POST /api/chat` and an interactive Leaflet/OpenStreetMap map. Google Fonts, Tailwind, Leaflet and map tiles require internet access. Weather, AQI and sunset values remain sample design content. Voice and the other navigation screens are not connected.

## Local assistant bridge

Start your installed bridge with `codex-bridge start`. Copy `.env.example` to `.env` and fill in the address and model advertised by your bridge, then restart the app. Keys stay on the backend and `.env` is ignored by Git.

The supplied bridge is installed under `%LOCALAPPDATA%\Programs\codex-bridge` and its directory is added to the Windows user PATH. Open a new PowerShell to use `codex-bridge start`, `codex-bridge status`, and `codex-bridge stop`. The bridge is started manually; it is not registered to run at Windows sign-in.

The installation uses your existing Debian WSL distribution, `/usr/bin/node` for the process supervisor, and a Linux Codex CLI matching the desktop version (0.163.0-alpha.10.2). Its launcher reuses your existing Windows Codex authentication through `CODEX_HOME`; no credentials are copied into this repository. Workspaces live under `/home/stanjan/.local/share/codex-bridge/workspaces`. The bridge deep-health check was adjusted to respect the configured WSL distribution.

The adapter in `server/assistant.mjs` calls `http://127.0.0.1:8780/v1/chat/completions`, with `codex-chatgpt` as the bridge's default Codex alias. `.env` contains the working local configuration. The bridge's `/health/deep` check, a real Polish assistant response, and a complete search/display tool cycle have been verified. API responses contain verified result IDs, map coordinates and card content; the model does not execute app tools directly.

The backend stores conversations in memory for 30 minutes, uses a Polish concise-answer system prompt, handles tool calls, limits tool rounds, and validates tool arguments. Restarting the server clears conversation state. It binds to loopback and accepts chat requests only from its own origin. This is local development, not an authenticated public deployment. `npm run build` produces frontend assets only; the assistant still requires the Node server.

Tools available to the assistant:

- `search_places`: query, category, district, map bounds and result limit.
- `filter_results`: refine previous results.
- `display_results`: show verified result IDs as map markers and app cards.
- `focus_map`: move and zoom the map.

## Next: external-data MCP provider

`server/catalog.mjs` is the data-provider seam. Its `search(filters)` currently returns five explicitly labeled demonstration records, never live data. No external API or MCP integration is implemented yet. Replace this provider with the planned MCP client while retaining the tools, validation and frontend action format. Provider records use `id`, `name`, `category`, `district`, `lat`, `lng`, `description`, `source` and `live`. Update tool descriptions and data-mode metadata when live sources are connected. Tool-sourced text must remain untrusted data.

Run `npm test` (or `node --test tests/*.test.mjs`) for backend/tool tests. These test the tool loop with controlled model replies, not the actual bridge.

Current source: Stitch project `4253701792170330935`, screen `dd28cf56168340ffb6b9a92e27153783`.
