# Agent Garden

Vue 3 Composition API and TypeScript, with Node's built-in HTTP server. Single npm
package; the CLI serves the built browser assets. macOS and WSL2. Read README.md and
docs/delivery.md before changing session behavior.

- Agent providers own conversations, permissions, execution and approvals. Never implement
  a dashboard chat or resolve approval/input requests in the monitoring client.
- Provider IDs are a closed `ProviderId` union (`codex` / `claude`), validated at
  JSON boundaries. Adapters are registered in code; no external plugin loading.
  Only registered implementations appear in settings or creation. Codex and
  Claude implementations exist; Claude currently has `enabled = false` due to
  subscription access. Backend-disabled adapters must not register/connect or
  appear in filters, creation, or cards. List them only as unavailable/off in
  Connections, with a disabled switch and no configuration/connection access. Keep their saved IDs/data.
  Runtime connection toggles cannot override this backend kill switch.
  Model/reasoning choices come from each installed CLI.
- Keep Garden's card ID separate from `provider` and native `sessionId`. Route
  observation and terminal opening through that provider with the native session
  ID. Legacy Codex cards retain their old IDs during migration.
- Common provider contracts live in `src/server/providers/provider.ts`; Codex RPC,
  protocol, status mapping and resume behavior stay under `providers/codex`.
  Monitoring uses read methods, not thread/resume; observing must not alter work.
- Codex terminal launchers use normal local resume with `--enable daemon_auto_start`,
  without `--remote`, model or reasoning overrides. In Codex 0.163.0, `--remote
unix://` applies remote trust checks, while reasoning `-c` disables daemon reuse.
  Restore an unloaded preset through the server only on explicit Open terminal;
  leave loaded sessions alone. Check integration source against the installed tag.
- Claude uses `agents --json --all` for structured status and init-only control
  requests for model options, with no user messages. Reserve an exact UUID and
  let the terminal create the conversation; use session-only observation hooks,
  never global hook/trust changes. Focus a live interactive Terminal.app session
  only when its recorded PID matches; attach background jobs by exact job ID.
  Resume closed conversations by native UUID without overriding their settings.
- Connection toggles persist and affect only Garden's access. Disabled providers
  must not reconnect, create sessions or open terminals until explicitly enabled.
  Keep cards and last known state; never stop a daemon or cancel work on disable.
  Prevent in-flight reads from restoring a connected state after disabling.
- Keep transport connectivity separate from agent status. Retain last known state
  and lastSeen on disconnect; confirm fresh state before claiming a live status.
- Shell arguments must be quoted; project paths and agent names are untrusted input.
  Keep the HTTP service on loopback and retain same-origin request checks.
- Keep dependencies, tests and abstractions proportional to this small local app.
  The frontend uses Pinia for shared snapshots/connection state. App owns SSE,
  fallback polling and refresh; gardens consume the store. Keep form and view
  state local. Dashboard code lives under `src/client/gardens/dashboard`.
  Use scoped SCSS and shared style tokens; see `docs/frontend.md` for ownership.
  Run `npm run lint` and `npm run format:check` before delivery. Keep the committed
  workspace format/fix-on-save settings enabled.
  Use npm test, npm run type-check, npm run build, and the no-inference
  npm run check:codex smoke check when touching Codex; use npm run check:claude
  for Claude. These submit no tasks or inference.
- Agent Garden is the app/package/CLI name. New data goes in Agent Garden; reuse
  legacy Codex Garden metadata in place instead of losing existing identities.
- Provider/status/search filters combine before grouping by the full project
  path. Fresh waiting/finished cards have text and color highlights; disconnected
  cards retain last known state without live attention highlights.
- Keep subagents nested under their tracked parent. Codex uses descendant APIs;
  Claude uses session-specific lifecycle hooks. Preserve native IDs and stale
  states, never infer completion from silence, and never submit worker messages
  or steal their sessions. Bound worker reads at 200 and show truncation.
- Discover external Codex sessions read-only from the connected server's loaded
  session list, only in exact saved project folders. Never import subagents as
  top-level cards or infer open sessions from recent timestamps. Keep native IDs
  and durable `garden`/`external` provenance separate from provider source labels.
  Visibility is a persistent global setting (Show external agents, default off),
  independent of discovery and monitoring. Hidden cards stay out of dashboard
  snapshots/counts/search; project-removal guards still include them. Remember
  removed native identities so discovery cannot immediately re-add them.
  External terminal reopening must preserve provider settings, without Garden
  preset restoration. Discovery is bounded at 200 loaded sessions and the existing
  50 tracked-card limit; report truncation without treating it as disconnection.
- Keep host folder, terminal, browser and data-directory behavior in the small
  platform boundary. WSL projects are in the current Linux distribution; do not
  treat Windows paths as interchangeable with Linux paths. Native Windows support
  still requires separate process, path and terminal verification.
- The cat playground, historical/all-project discovery, npm publication and
  native Windows terminal support are follow-up work.
