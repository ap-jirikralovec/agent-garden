# Provider architecture

Garden coordinates local folders, cards, persistence and polling. Each built-in
adapter implements `AgentProvider` in `src/server/providers/provider.ts`:

- `connect`, `configuration`, `close`: manage Garden's transport and expose models,
  display names, default model, and per-model reasoning options/defaults.
- `createSession`: create or reserve a provider session with the validated preset and return
  its native identifier, plus an optional warning such as a failed title update.
- `readSession`: return normalized status, task, settings and connection details.
  It must stay read-only and must not load a conversation or submit work.
- `openTerminal`: prepare the exact saved session, then build that provider's
  command. It may restore an unloaded preset on explicit user action.

`ProviderId` is the closed `codex | claude` union in `src/shared/types.ts`.
`isProviderId` validates JSON input. Add built-in implementations in
`src/server/providers/factory.ts`; no runtime or third-party plugin loading.
Both Codex and Claude adapters are retained. `AgentProvider.enabled` is a backend
availability flag: Garden skips disabled adapters before any connection and hides
their cards from snapshots. Provider snapshots keep `available: false`,
`enabled: false` and null configuration so Connections can show a disabled Off
switch; creation and provider filters include only available providers. Claude currently sets it to false due to
subscription access. Native IDs/presets remain in storage for re-enabling. This is
separate from the persistent UI connection toggle, which can only pause/resume
backend-enabled adapters and cannot override the kill switch.
The UI consumes backend configuration instead of a provider-specific model list.
A model with no reasoning options uses `defaultReasoning: null`, an empty options
array, and `reasoning: null` on session creation. Creation requires a provider ID.

An agent's `id` identifies its Garden card and launcher file. Its `provider` and
`sessionId` identify the conversation. Always pass the native `sessionId` to a
provider's protocol/CLI; never pass the Garden ID. This allows equal native IDs
across different providers. Legacy Codex cards retain their old Garden ID and use
the same value as `sessionId`. Version 2 metadata stores both identities and
connection preferences. This boundary also supports later session discovery;
discovery and Garden-created/discovered filters are separate follow-up work.

Each provider has independent connection status, model configuration and retry
timing. Disabling closes Garden's connection, blocks creation/terminal access,
and retains cards, status and last-seen time. It must not cancel work or stop the
provider daemon. Re-enabling reloads configuration and checks status. In-flight
observations are invalidated during toggles; terminal/creation operations finish
before a toggle may close their connection.

The Codex adapter owns RPC, protocol types, status translation, and cold-session
restoration under `src/server/providers/codex`. It uses normal local daemon resume,
with no model/reasoning CLI overrides or explicit remote endpoint. The generic
macOS `TerminalLauncher` only quotes a command/environment/working directory and opens a private
`.command` file; it knows no provider flags.

The Claude adapter uses `claude agents --json --all` once per poll for structured
state, keeping job IDs (attachment) separate from full session UUIDs (identity).
A control-protocol initialize request discovers per-model effort choices without
sending a user message. This is version-sensitive and requires Claude 2.1.292+.

Creation reserves a native UUID. The terminal starts an interactive conversation
with that UUID and the preset, allowing normal trust/authentication. Session-only
command hooks capture bounded task snippets, actual start model, completion,
failure and session end in private local files. Hooks emit no stdout or decisions
and fail open. They never write to provider-owned transcripts or global settings.
The selected effort remains preset metadata; terminal effort changes are not read.
Closed interactive sessions are disconnected, preserving last observation time.

A live interactive session focuses the recorded Terminal.app tab only when its
PID matches the fresh CLI listing. Otherwise opening gives a useful message and
starts no competing writer. Background sessions attach by exact job ID. Closed
sessions with submitted prompts resume the exact UUID with no preset overrides.
An empty preset starts with `--session-id` again. Hook-disabled environments may
lack the metadata needed for this distinction; support for such environments and
external-session discovery needs transcript/session APIs in a follow-up.

Parent cards contain optional `AgentWorker` observations and a separate worker
read error. Native worker IDs and parent IDs are persisted under that card, keeping
them independent of other providers or parent conversations. Missing worker reads
retain the old state as disconnected; disabling, read failures and restart mark
worker observations stale along with the parent. Worker read errors do not hide
an otherwise healthy parent. The store omits parent/worker lastSeen fields from
change comparison, avoiding disk writes on every unchanged poll.

Codex uses paginated `thread/list` with the tracked native `ancestorThreadId`,
`sourceKinds: [subAgentThreadSpawn]`, both archive states, and `useStateDbOnly`.
It validates descendant lineage locally and reads each child's latest turn without
resuming or loading it. Nested parent IDs survive. Closed workers retain history
and explicit disconnected state. Results are capped at 200 with visible feedback.
The schema was generated from installed Codex 0.163.0, with experimental API
capability already enabled; no private provider DB is parsed.

Claude's session-only hooks capture SubagentStart/Stop, StopFailure, permission
requests, AskUserQuestion and later tool events, plus in-process TeammateIdle.
They store separate atomic event files per native worker ID. Start evidence is
required, excluding internal side-agent Stop events. Repeated Start for the same
ID reactivates it; a tool failure alone is not a failed worker. Tool descriptions
provide recent activity when no assigned prompt is available. Status represents
the last observed lifecycle event; parent absence makes it disconnected. There
is no silence timeout that invents completion. Separate-process teammates remain
a limitation; active Claude sessions must reopen once to load changed hook settings.
Workers are inspected/responded to through the parent's terminal, without a new
writer or worker-message endpoint in Garden. Provider filters/grouping apply to
parent cards, while search includes child native IDs and task/activity.

Verification stays focused: status/transport/folder checks, fake-provider routing
and isolation, real Claude observation hooks, native command construction,
provider/search/status filtering and full-path grouping, legacy rename metadata,
worker lifecycle/reactivation and stale persistence, and no-inference smoke checks against both installed CLIs. Native terminal UI
handoff is a separate host check. Sources: [Claude agent view](https://code.claude.com/docs/en/agent-view),
[hooks](https://code.claude.com/docs/en/hooks), and
[Agent SDK](https://platform.claude.com/docs/en/agent-sdk/typescript).
