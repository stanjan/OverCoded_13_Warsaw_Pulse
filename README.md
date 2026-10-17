# Warsaw AI

Mobile web app imported from Stitch’s **Warszawa Pulse — Dodane Cieniowanie & Głębia** screen in project `4253701792170330935`.

Run `npm run dev` (or `node --env-file-if-exists=.env scripts/serve.mjs`) and open http://127.0.0.1:5173. Requires Node.js 24+.
Run `npm run build` (or `node scripts/build.mjs`) to produce the static app in `dist/`.

## HTTPS on a phone in the local network

Phone geolocation requires a trusted secure origin. Generate a local development CA and a separate server certificate with `npm run cert:local -- 192.168.1.222` (replace the IP if this computer's LAN address changes). Requires OpenSSL; Windows uses the OpenSSL bundled with Git when available, or set `OPENSSL_PATH` to its executable. This does not install trust on any device. Certificates and private keys stay in ignored `.local/tls/`; never share `ca.key` or `server.key`.

Set the ignored local `.env`, then restart `npm run dev`:

```dotenv
HOST=192.168.1.222
PORT=5173
HTTPS_PORT=5174
TLS_CERT_FILE=.local/tls/server.pem
TLS_KEY_FILE=.local/tls/server.key
TLS_CA_FILE=.local/tls/ca.cer
```

On the phone in the same Wi-Fi network, download the **public CA certificate** from `http://192.168.1.222:5173/dev-ca.cer`. Compare its SHA-256 fingerprint with the generator's output before installing. On iPhone, install the downloaded profile in Settings → General → VPN & Device Management, then enable **Warsaw AI Local Development CA** under General → About → Certificate Trust Settings ([Apple instructions](https://support.apple.com/en-us/102390)). On Android, install the downloaded file as a **CA certificate** under Security & privacy → More security settings → Encryption & credentials; wording varies by manufacturer ([Google instructions](https://support.google.com/pixelphone/answer/2844832?hl=en)). Then open **`https://192.168.1.222:5174`** and allow location in the browser. Merely bypassing a certificate warning does not establish a trusted origin.

HTTP and HTTPS share one backend process, assistant state and live-transit tracker. The CA download exposes only the public certificate. HTTPS is opt-in and invalid/missing TLS files stop startup with a clear error. Re-running the generator preserves the CA (phone trust remains valid) and renews the server certificate for the supplied IPs plus localhost/127.0.0.1. It refuses to replace an incomplete, invalid or expired CA: rotate it deliberately and reinstall trust if needed. Remove this development CA from the phone when no longer needed. This local server has no public-deployment authentication; keep it on the trusted LAN.

The current original export is preserved in `design/stitch-depth.html`; the previous welcome export remains in `design/stitch-welcome.html`. The app adapts the full-screen map, floating weather pill, shadowed bottom drawer and prompt cards for responsive widths, browser zoom, safe areas, keyboard input, accessible controls, and safe message rendering. The existing interactive map fills the design's map integration area.

The app includes an assistant backend at `POST /api/chat` and an interactive Google Maps map when configured, with Leaflet/OpenStreetMap fallback. Google Fonts, Tailwind, Leaflet and map tiles require internet access. Weather, AQI and sunset values remain sample design content. Voice and the other navigation screens are not connected.

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

Each assistant turn includes the current browser location status. Available fixes carry validated coordinates, accuracy in metres, observation time and optional altitude/heading/speed; fixes older than five minutes are labelled stale and undated fixes have unknown freshness. Missing or refused location is explicit and never replaced with the map centre or a previous turn's coordinates. No street address or district is inferred from coordinates. The browser also publishes `city:location` events and exposes `window.getCityLocation()` for location-aware UI modules.

Tools available to the assistant:

- `list_data_sources`: describe the four searchable categories and filters without downloading records.
- `search_places`: complete matching official data, with category, district, query, activity, audience, weekday, dates, map bounds and route-length filters.
- `filter_results`: refine previous results.
- `display_results`: selected verified IDs and 1–3 highlighted recommendations as cards, with map markers where source coordinates exist.
- `focus_map`: move and zoom the map.

## Official city-data MCP

The app now routes search, filter, display and map tools through a real MCP JSON-RPC client/dispatcher. The same implementation can be launched independently over stdio with `npm run mcp`. See [mcp/README.md](mcp/README.md) for setup, source evidence, filters, protocol details, error behavior and verified limits.

Set `DATA_API_KEY` to a token for the new Warsaw open-data portal. Production has no demo fallback: missing credentials or unavailable/changed sources are explicit errors with incomplete-result metadata. MCP searches four official activity categories: city events, sports classes, open pitches and tourist routes. Searches return every matching record from full upstream datasets. The assistant then selects relevant records and 1–3 highlights. Source observation/update times are separate from retrieval time; unknown freshness is never labelled current. Records without coordinates remain cards without pins. Weather and air quality are supplied automatically through the server environment context, alongside sunrise/sunset, with explicit GPS-versus-central-Warsaw basis, source grid and valid times; they are not MCP search categories.

Large complete searches can exceed the local bridge's 2 MiB request / 1,000,000-character prompt capacity. The app retains the full user-filtered set on the server and first tries disclosed, nonempty date/distance scopes. If none fits, it provides an explicitly partial preview, ordered by distance from the last known GPS point when available, otherwise by source order. Unknown coordinates remain eligible for cards without pins. A huge individual record can use a disclosed bounded model projection; unusually large browser actions also use a disclosed projection to fit streaming limits. Normal cards and subsequent filtering retain original records. Successful nonempty searches show real examples before asking for preferences, with original/visible counts in the UI. True zero matches and unavailable sources remain explicit. Current environmental model data is loaded automatically for the top bar and assistant context; unavailable or stale data remain explicit.

Run `npm test` (or `node --test tests/*.test.mjs`) for backend/tool tests. These test the tool loop with controlled model replies, not the actual bridge.

Current source: Stitch project `4253701792170330935`, screen `dd28cf56168340ffb6b9a92e27153783`.
