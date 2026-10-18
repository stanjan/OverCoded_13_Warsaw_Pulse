# Assistant bridge

The bridge source is included in `bridge/`. From the repository root, run `npm run bridge:start` (or `node --env-file-if-exists=.env bridge/server.mjs`) in one terminal and `npm run dev` in another. Both use the ignored local `.env`; copy `.env.example` first if needed. Requires Node.js 24+. The previously installed global `codex-bridge` command points at a separate installation; use the repository script for this version. If port 8780 is occupied, stop that bridge first or set `CODEX_BRIDGE_PORT` and update `CODEX_BRIDGE_URL` to match. Startup never kills another listener.

### Bridge on a second LAN computer

On the **bridge computer** (with its signed-in Codex/Antigravity/Claude CLI), set in its local ignored `.env`:

```dotenv
CODEX_BRIDGE_HOST=0.0.0.0
CODEX_BRIDGE_PORT=8780
CODEX_BRIDGE_API_KEY=
```

Run `npm run bridge:start` there. On the **application server computer**, set `CODEX_BRIDGE_URL=http://192.168.1.50:8780/v1` (replace the example IP with the bridge computer's private IPv4), leave `CODEX_BRIDGE_API_KEY=` blank, and restart `npm run dev`. The application can still listen on localhost; only its backend talks to the bridge. No presentation changes are needed.

Check `http://192.168.1.50:8780/health` from the server computer (for example `curl.exe http://192.168.1.50:8780/health`). If unreachable, check that both computers share the LAN and allow inbound TCP 8780 on the bridge computer's **Private** firewall profile, restricted to the application server IP. Do not open an Internet/router port or the Public profile. Nothing changes the firewall automatically.

This explicit LAN mode works **without a key** and trusts private-network peers; HTTP is unencrypted. Optional: set the same `CODEX_BRIDGE_API_KEY` on both computers and/or `CODEX_BRIDGE_ALLOWED_CLIENTS=192.168.1.20` on the bridge to restrict the exact app-server IP. When a key is configured, even health requests require `Authorization: Bearer …`. For a specific interface, replace `0.0.0.0` with the bridge computer's private IP. Existing bridge HTTPS remains supported with a valid trusted certificate; certificate verification is never disabled. Browser-origin requests, public peers/Host names and public destination URLs are rejected; legacy `/v1/run` stays loopback-only. Restart both processes after changing their configuration.

Leave `CODEX_BRIDGE_MODEL` blank to choose an available provider in this order: **Antigravity → Codex → Claude CLI**. Antigravity and Claude use their CLI's default model; Codex uses **gpt-6.1-sol, low effort**. Discovery checks the Antigravity daemon or CLI, Codex ChatGPT login, then Claude subscription authentication. Results are cached for 30 seconds. An explicit model selects that provider directly; failures never retry inference on a different provider.

To use a Claude subscription, install current [Claude Code](https://code.claude.com/docs/en/setup), run `claude`, and sign in with the subscription account. Set `CODEX_BRIDGE_MODEL=claude-cli/default` to preserve the CLI default, or choose `claude-cli/sonnet`, `claude-cli/opus`, `claude-cli/haiku`, or `claude-cli/<Claude model ID>`. Restart the app after changing its model. If the executable is not on PATH, set `CLAUDE_CLI_PATH` to the native executable or CLI JavaScript entry point. Windows batch wrappers are not supported; use the native Claude Code installation. This provider runs natively where the bridge runs, rather than inside the Codex WSL environment.

The Claude provider checks `claude auth status --json` for `claude.ai` or `oauth_token` authentication before each request. Ambient API/cloud keys are excluded from its child environment to avoid switching to API billing, while `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CONFIG_DIR` remain supported. API-key, Console and third-party authentication are rejected. It uses regular print mode with subscription credentials, safe mode, no built-in tools and an empty MCP configuration. Stream-json partial events provide assistant text as it arrives; structured tool calls are validated before execution. Claude print invocations remain separate, while conversation history is retained by the app. The application executes and validates its own search/map tools. Subscription availability and usage limits still apply; see [Claude authentication](https://code.claude.com/docs/en/authentication) and [CLI reference](https://code.claude.com/docs/en/cli-reference).

Codex chat now uses the native signed-in CLI's persistent app-server, with a separate ephemeral thread for each browser conversation. Set CODEX_APP_SERVER_PATH if Codex is not on PATH. Threads expire after 30 minutes, are bounded to 100 conversations, and are never shared between browser sessions. Follow-up messages and tool results reuse that thread and send only new conversation messages. Cancelling a request interrupts its active turn and discards that thread. The legacy /v1/run route still uses the existing Bash/WSL execution supervisor. codex-chatgpt remains an explicit alias for gpt-6.1-sol@low.

Use `GET /health` for bridge admission/queue status, `GET /health/deep` for Codex login, `GET /health/claude` for Claude subscription login, and `GET /v1/models` for model routes. Listed models describe supported routes, not proof that a CLI is installed. The bridge binds to loopback by default and rejects browser-origin requests; the app connects from its backend. Local processes are trusted. Claude cancellation/timeouts terminate its owned process tree before returning capacity; abrupt operating-system termination of the bridge is not a durable recovery guarantee for the native Claude process.

Run `npm run bridge:test`, `npm test` and `npm run build` to verify the bridge and application. Claude tests use a simulated CLI and exercise authentication rejection, isolation flags, streaming, cancellation and the real application's search/display tool loop. A live Claude subscription has not been verified on this machine because Claude CLI is not installed or signed in. The supplied archive's certificates, private key, runtime journals, logs and machine-specific diagnostic scripts are excluded from the repository.
