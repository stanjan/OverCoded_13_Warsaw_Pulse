# Warsaw AI

Mobile web app imported from Stitch’s **Warszawa Pulse — Dodane Cieniowanie & Głębia** screen in project `4253701792170330935`.

Run `npm run dev` (or `node --env-file-if-exists=.env scripts/serve.mjs`) and open http://127.0.0.1:5173. Requires Node.js 24+.
Run `npm run build` (or `node scripts/build.mjs`) to produce the static app in `dist/`.

The current original export is preserved in `design/stitch-depth.html`; the previous welcome export remains in `design/stitch-welcome.html`. The app adapts the full-screen map, floating weather pill, shadowed bottom drawer and prompt cards for responsive widths, browser zoom, safe areas, keyboard input, accessible controls, and safe message rendering. The existing interactive map fills the design's map integration area.

The app includes an assistant backend at `POST /api/chat` and an interactive Leaflet/OpenStreetMap map. Google Fonts, Tailwind, Leaflet and map tiles require internet access. Weather, AQI and sunset values remain sample design content. Voice and the other navigation screens are not connected.

## Local assistant bridge

The bridge source is included in `bridge/`. From the repository root, run `npm run bridge:start` (or `node --env-file-if-exists=.env bridge/server.mjs`) in one terminal and `npm run dev` in another. Both use the ignored local `.env`; copy `.env.example` first if needed. Requires Node.js 24+. The previously installed global `codex-bridge` command points at a separate installation; use the repository script for this version. If port 8780 is occupied, stop that bridge first or set `CODEX_BRIDGE_PORT` and update `CODEX_BRIDGE_URL` to match. Startup never kills another listener.

Leave `CODEX_BRIDGE_MODEL` blank to choose an available provider in this order: **Antigravity → Codex → Claude CLI**. Antigravity and Claude use their CLI's default model; Codex uses **gpt-6.1-sol, low effort**. Discovery checks the Antigravity daemon or CLI, Codex ChatGPT login, then Claude subscription authentication. Results are cached for 30 seconds. An explicit model selects that provider directly; failures never retry inference on a different provider.

To use a Claude subscription, install current [Claude Code](https://code.claude.com/docs/en/setup), run `claude`, and sign in with the subscription account. Set `CODEX_BRIDGE_MODEL=claude-cli/default` to preserve the CLI default, or choose `claude-cli/sonnet`, `claude-cli/opus`, `claude-cli/haiku`, or `claude-cli/<Claude model ID>`. Restart the app after changing its model. If the executable is not on PATH, set `CLAUDE_CLI_PATH` to the native executable or CLI JavaScript entry point. Windows batch wrappers are not supported; use the native Claude Code installation. This provider runs natively where the bridge runs, rather than inside the Codex WSL environment.

The Claude provider checks `claude auth status --json` for `claude.ai` or `oauth_token` authentication before each request. Ambient API/cloud keys are excluded from its child environment to avoid switching to API billing, while `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CONFIG_DIR` remain supported. API-key, Console and third-party authentication are rejected. It uses regular print mode with subscription credentials, safe mode, no built-in tools and an empty MCP configuration. Stream-json partial events provide assistant text as it arrives; structured tool calls are validated before execution. Claude print invocations remain separate, while conversation history is retained by the app. The application executes and validates its own search/map tools. Subscription availability and usage limits still apply; see [Claude authentication](https://code.claude.com/docs/en/authentication) and [CLI reference](https://code.claude.com/docs/en/cli-reference).

Codex chat now uses the native signed-in CLI's persistent app-server, with a separate ephemeral thread for each browser conversation. Set CODEX_APP_SERVER_PATH if Codex is not on PATH. Threads expire after 30 minutes, are bounded to 100 conversations, and are never shared between browser sessions. Follow-up messages and tool results reuse that thread and send only new conversation messages. Cancelling a request interrupts its active turn and discards that thread. The legacy /v1/run route still uses the existing Bash/WSL execution supervisor. codex-chatgpt remains an explicit alias for gpt-6.1-sol@low.

Use `GET /health` for bridge admission/queue status, `GET /health/deep` for Codex login, `GET /health/claude` for Claude subscription login, and `GET /v1/models` for model routes. Listed models describe supported routes, not proof that a CLI is installed. The bridge binds to loopback and rejects browser-origin requests; the app connects from its backend. Local processes are trusted. Claude cancellation/timeouts terminate its owned process tree before returning capacity; abrupt operating-system termination of the bridge is not a durable recovery guarantee for the native Claude process.

Run `npm run bridge:test`, `npm test` and `npm run build` to verify the bridge and application. Claude tests use a simulated CLI and exercise authentication rejection, isolation flags, streaming, cancellation and the real application's search/display tool loop. A live Claude subscription has not been verified on this machine because Claude CLI is not installed or signed in. The supplied archive's certificates, private key, runtime journals, logs and machine-specific diagnostic scripts are excluded from the repository.

The UI receives live SSE progress, completed steps, elapsed time, assistant text, and validated map/list actions. The stop button cancels the active turn. The JSON API remains available when stream is omitted. Codex streams actual app-server text deltas; Claude uses stream-json partial events; the Antigravity daemon's native SSE is passed through. Antigravity CLI fallback remains buffered when its installed CLI does not provide partial events. Keepalive comments are transport heartbeats, never simulated model text. No workflow reference or unrelated integration documentation is injected into model prompts.

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
