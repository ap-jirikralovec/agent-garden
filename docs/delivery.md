# MVP delivery agreement

Source: the approved conversation on 2026-10-19. Implementation uses Rails.

## Requirements and approved decisions

- Local browser dashboard, macOS first, Vue 3 + TypeScript + Vite.
- Track dashboard-created Codex sessions initially; discover other sessions later.
- Cards show agent name, project, current task (latest user prompt), model/reasoning,
  and Working / Waiting for input / Finished / Failed / Idle.
- Finished means the latest Codex response completed, not proof the task succeeded.
- Disconnected is a monitoring indicator: preserve last state and last seen, retry
  automatically, and refresh state on reconnection.
- Add-agent dialog accepts name, project folder, model and reasoning. Confirmation
  creates a Codex session and opens a terminal ready for the first task.
- Check the project folder on blur. If missing, require a checkbox confirming
  creation, reset consent when the path changes, and create missing parents
  recursively only on Create & open terminal. Existing files/access errors must
  not be treated as missing folders. The server rechecks on submission.
- Open terminal uses the exact Codex thread ID. Conversation and approvals stay in
  Codex's terminal UI. No chat, approval handling, or task execution in the dashboard.
- Use the configured default terminal where possible, Terminal.app fallback.
- Persist tracked IDs and names across restarts. Prepare an npm executable; publishing
  to npm and the cat playground are excluded.
- Approved extension: a common built-in provider interface and Codex adapter,
  persistent connection toggles in a settings modal, provider labels on cards,
  provider-specific terminal routing, and backend-provided models/reasoning.
  Provider identity is the closed `codex | claude` union with runtime validation;
  no external plugins. Claude itself remains unimplemented. Existing cards keep
  their identities. Session discovery and origin/provider filters are follow-up
  work, as requested after this update.

## Implementation approach

Node's built-in HTTP server serves built Vue assets and a local API. A JSON-RPC client connects through
`codex app-server proxy` to the existing daemon. SSE sends dashboard snapshots.
Poll tracked threads only, supplementing status events, without resuming agents just
to monitor them. Store small metadata in an atomic local JSON file. Generate safe
`.command` launch files for macOS rather than interpolate user input into scripts.

## Planned acceptance evidence

- Test status mapping including wait flags, failure, completion, interruption, and idle.
- Test disconnect/reconnect, stale state and missing sessions, task extraction,
  persistence, concurrent requests, validation and terminal argument escaping.
- Browser smoke check for the dashboard and dialog when a browser and local server
  can run. Keep the automated check set small, as requested during implementation.
- Isolated installed-Codex protocol check: initialize, model catalog, thread creation,
  read, metadata/settings and persistence across process restart.
- Real terminal workflow: open -> task -> status -> respond -> close -> continued work.
  The current sandbox blocks the existing daemon socket and native terminal launch;
  report checks actually performed separately from this planned evidence.

## Verification outcomes

Implemented the scoped Vue dashboard, metadata store, read-only Codex monitor,
terminal launchers and npm executable. The CLI package contains built browser assets
and uses Node built-ins plus `ws` for the shared server's WebSocket protocol.
Vue and build/test tools are dev dependencies.

- Eight initial focused checks pass: work/wait/approval mapping, completion/failure/interrupt,
  stale unloaded state, current task and model extraction, runtime errors, concurrent
  metadata writes/reload, corrupt metadata handling, and shell argument quoting.
- Vue/server TypeScript checks and the production build pass.
- `npm pack` produces a roughly 50 kB executable package. Running its CLI with
  `npm exec --offline --package ./codex-garden-0.1.0.tgz -- codex-garden --help`
  succeeds from the packaged entry point, without runtime dependencies.
- The installed Codex 0.163.0 smoke check creates an isolated no-task session, reads
  its model catalog, saves the selected model/reasoning and title, monitors idle,
  reopens the same ID, restarts app-server, reads saved history and resumes the exact
  session with the preset intact. Monitoring/reopening submits no task or inference.
- Real work/wait/failure transitions are checked with protocol-shaped fixtures;
  the smoke check deliberately submits no model task. It does not prove task
  execution survives terminal closure.
- Local HTTP startup is blocked by this sandbox (`listen EPERM` on 127.0.0.1).
  The existing Codex daemon socket and native terminal launch are also inaccessible.
  Headless Chromium could not start here. Full browser behavior, actual default
  terminal opening, answering a real approval/question, and closing the terminal
  while a turn runs remain manual checks on the host. These are verification gaps,
  not claims of successful end-to-end validation.
- Git initialization is blocked by read-only Git metadata policy; no commit.
- SonarQube is unavailable; no analysis ran.

## Changes to the provisional approach

- Replaced Fastify with Node's built-in HTTP server for the small API and SSE stream,
  reducing dependencies and allowing the build from the local package cache.
- Use polling of structured Codex read methods every two seconds. This avoids
  subscribing via resume, which could load or affect a session just to observe it.
- Restore model/reasoning through the server when the user opens an unloaded
  session. A real restart check found that Codex's empty-thread resume can fall
  back to global defaults. Keep normal terminal resume free of preset overrides,
  so it reuses the local daemon and retains the restored settings. Monitoring
  preserves the last observed preset while a session is unloaded.
- Native terminal selection follows the macOS `.command` file association with a
  Terminal.app fallback; arbitrary terminal-specific tab reuse is not implemented.

## Host acceptance check still required

Run `npm start`, create a session in a temporary project, check its model/reasoning
in the opened terminal, submit a small task, observe Working and Finished, respond
to a real request in the terminal, then close the terminal while a turn is active
and verify whether Codex continues. Restart Garden to check the same card returns.

## Connection correction

The first host run showed `Codex did not respond to initialize`. The initial
monitor sent JSONL to `codex app-server proxy`, but the proxy forwards raw bytes
to the shared daemon control socket, which expects HTTP Upgrade and WebSocket
frames. Only standalone `app-server --stdio` accepts JSONL. The original isolated
smoke check did not exercise the production transport.

Corrected the default RPC transport to perform WebSocket initialization over the
proxy's stdin/stdout byte stream, using `ws` for handshake and framing. Standalone
stdio remains explicit for the no-inference Codex lifecycle smoke check. Added one
regression check that fails with the original JSONL transport and passes with the
WebSocket transport, including a disconnect/reconnect cycle. It uses an in-memory
HTTP Upgrade peer, without binding a port. `npm run check:connection` now checks
the actual shared server separately, without submitting work.

The running host dashboard needs a restart to load this backend correction.
Current sandbox policy still prevents direct access to its shared socket.

Correction checks: all nine focused tests, Vue/server type checks, the isolated
real-Codex smoke check, and production build pass. The compiled CLI loads its
WebSocket dependency and prints help successfully. After the requested host
restart, the browser showed no HTTP listener at port 4317; startup output is
needed before the live Codex connection can be confirmed. The computer-use
tool blocks access to Terminal, so that output must come from the user.

## Terminal handoff and trust correction

The next host check created Miso successfully, but opening it in Terminal showed
`This conversation is open in another app`. Codex's startup code excludes
reasoning `-c` overrides from implicit daemon reuse. The launcher therefore
started an embedded backend, which collided with the shared server's active
conversation writer. This is a backend-selection conflict, not a reason to delete
or fork the conversation or change its source metadata.

An initial correction used explicit `--remote unix://`. The next host attempt
failed with `remote project directory is inside an explicitly untrusted project`
despite already supplying `--cd`. Source inspection pinned to the installed
`rust-v0.163.0` tag confirms that explicit Unix endpoints use remote trust handling
in that release. Newer main-branch source recognizes a verified local endpoint;
relying on it was incorrect for the installed version.

The current launcher uses `codex --enable daemon_auto_start resume <thread-id>
--cd <project>`, with no remote/model/reasoning flags. New sessions already have
their preset loaded by `thread/start`. On explicit Open terminal, Garden reads
the session and restores the preset with `thread/resume` only if it is unloaded.
It does not alter loaded/running sessions or resume as part of monitoring. Unloaded
observations retain the last known preset rather than replacing it with defaults.
Trust settings and conversation IDs are unchanged. Existing launchers regenerate
on Open terminal after restarting Garden.

Evidence: OpenAI's `rust-v0.163.0` source in
`codex-rs/tui/src/daemon_startup.rs::config_exclusion`,
`codex-rs/tui/src/startup_orchestration.rs`,
`codex-rs/tui/src/config_update.rs::read_remote_project_trust`, and
`codex-rs/tui/src/app_server_session.rs::thread_resume_params_from_config`.
All ten focused checks, TypeScript checks and the production build pass; the npm
archive was rebuilt. The real-Codex isolated smoke
check passes cold restoration through Garden followed by override-free resume,
including a non-default reasoning effort and zero submitted turns. Actual native
terminal handoff still requires a host check because Terminal automation and the
shared daemon socket are blocked in this agent environment.

## Confirmed folder creation

The creation dialog now checks the path on blur through a local read-only API.
Missing paths reveal an unchecked confirmation; changing the path clears both
the check result and consent. Stale asynchronous responses are ignored. Form
submission also validates the path, covering Enter without an earlier blur.
The server accepts only a boolean creation flag, rechecks the filesystem and
creates missing parents before starting Codex. Existing folders follow the
previous flow. No directory is created by checking the path or the checkbox.
A new folder is retained if later session creation fails; no rollback deletes
potential user files. Existing Codex permissions, trust and launch behavior stay
unchanged.

Evidence: all 13 focused checks, TypeScript checks, the production build and the
isolated no-inference Codex smoke check pass. Three filesystem checks cover
read-only existence checks, rejection without confirmation, recursive creation
before session startup, and files/file parents. An in-memory HTTP handler probe
verified the new route, strict boolean validation and local-request protection.
The built Vue dialog was checked in Zen using a local preview with stubbed API
responses: missing/existing/error states, checkbox gating, reset after editing,
pending feedback, confirmed submission and desktop layout. Filesystem creation
was verified independently against real temporary directories. The running host
backend must restart and the browser reload to use this extension; full native
terminal handoff remains a host check.

## Built-in provider boundary and connection settings

Garden now depends on `AgentProvider`, with Codex's transport, protocol, status
mapping, model catalog and terminal-resume rules inside its adapter. A small
factory registers built-in implementations. `ProviderId` is a closed union and
creation requires an explicit provider, with runtime allowlist validation at API
and persistence boundaries. Claude is reserved in the type only; no real Claude
implementation or UI option is shipped. Backend configuration supplies each
provider's default model and each model's reasoning options/default. Models with
no reasoning choice use null. No dependency was added.

Connections has a settings modal with persistent toggles. Disabling closes only
Garden's monitoring transport, blocks creation/opening, keeps cards and last
known status/timestamps, and does not issue cancellation or daemon-stop commands.
Re-enabling reconnects and refreshes configuration and state. Providers have
independent retry timing and failures. A generation check discards stale reads
across a toggle; toggles cannot interrupt a session creation/terminal operation.

Cards display provider labels. Each new card uses a Garden UUID and stores the
provider's opaque native session ID separately. Terminal/protocol operations use
the native ID through its owning adapter, while launcher filenames use the safe
Garden ID. Equal native IDs from different providers remain distinct. Legacy
version 1 Codex cards retain both their original card and native ID; mutations
persist version 2 with connection settings. Read updates apply only to cards
still tracked, avoiding re-adding a removed card from an in-flight poll.
Search now also matches provider names and native session IDs. Actual discovery,
Claude support and dedicated created/discovered filters remain the next task.

Verification: all 16 focused checks, Vue/server type checks, clean production
build, and real-Codex no-inference smoke check pass. Three new checks exercise
per-provider configuration and exact routing with equal native IDs, failure
isolation, persisted toggles and in-flight invalidation, and legacy identity
migration. Existing shell quoting checks now include opaque native IDs. An
in-memory HTTP probe confirms local-request protections, strict toggle booleans,
unknown/unregistered/missing-provider rejection, null reasoning, and exact saved
session opening. Browser QA of the built UI used two stub providers on desktop
and at a 390px viewport: provider labels, models/optional reasoning, creation
payload, independently toggled connections, all-paused state, and re-enabling.
These fake-provider checks establish the common boundary, not actual Claude
integration. Native terminal launch and the host daemon remain inaccessible to
this session, so the running host must restart and reload for the final check.

The user confirmed creating the requested baseline commit before this refactor.
Git metadata remains unavailable in this session (`not a git repository`, no
visible `.git`), so its hash/branch could not be verified and these refactor edits
could not be committed here. The refactor proceeded on the user's confirmation.
SonarQube remains unavailable. Provider commands are unchanged from the verified
Codex launch correction; actual host terminal attachment remains a limitation.

Deviation from initial plan: the approved provider refactor now includes the
requested connection settings and provider-aware creation UI, with a closed
provider type instead of arbitrary provider IDs. Builds clear generated output
before compiling so moved Codex modules do not leave stale packaged code.

## Agent Garden, dormant Claude, and subagent dialogs

The following user requests are cumulative: real Claude adapter, provider logos,
multi-select provider filters, full-project grouping toggle, Agent Garden rename,
waiting/finished highlights, and subagent visibility. Subsequent explicit steering
keeps Claude's code but sets its backend `enabled` flag false because the host
attempt failed on subscription access. Subagents now open in a dialog, replacing
the initial inline disclosure. External top-level discovery remains a follow-up.

| Requirement                        | Implemented behavior and observed evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude adapter and backend catalog | Installed Claude Code 2.1.292 supplies five models through an initialize-only control request, including model-specific effort support and Haiku with no effort choice. Installed-CLI smoke check sends no user messages or inference. Tests exercise reserved UUID creation, exact-ID first launch/resume, background job attachment, and focusing/refusing a competing interactive writer. The host reported subscription failure; paid-task and native-terminal success are not established.                                                                                                                        |
| Backend availability flag          | `AgentProvider.enabled` is checked before registration or connection. Codex is true; Claude is false. Disabled providers, cards, settings and creation options disappear, while storage retains native IDs and presets. A regression check verifies zero connection attempts, API-access rejection, and identities reappearing after re-enabling the backend flag. UI connection preferences cannot override it.                                                                                                                                                                                                       |
| Logos and filtering                | Local ChatGPT knot / Claude starburst SVGs replace provider text chips, with accessible labels and bundled licensing. Both checked provider filters use OR and combine with status/search. Browser preview with explicitly simulated enabled providers showed 8/8 loaded logos and Claude-only results after deselecting Codex. Pure checks cover both/one/neither selections, search/native IDs and status. Production currently exposes only Codex.                                                                                                                                                                  |
| Project grouping                   | The toggle groups filtered parent cards by the exact saved project path. Browser preview keeps `/work/app` and `/other/app` separate even though both are named app. Tests cover full-path grouping and order preservation.                                                                                                                                                                                                                                                                                                                                                                                            |
| Rename and persistence             | App title/branding, RPC client identity, package, executable and archive use Agent Garden / `agent-garden`. New data uses Agent Garden. Existing Codex Garden metadata is reused in place to avoid losing IDs or racing an old process. A filesystem check covers fresh, legacy, new-metadata and explicit-directory cases. The repository folder itself is unchanged.                                                                                                                                                                                                                                                 |
| Attention highlights               | Fresh waiting parents/workers receive amber text/border highlights; completed parent responses and workers receive green highlights. Parent attention prioritizes a waiting worker. Stale cards retain explicit last-known treatment. Browser previews show all states; overview input count includes parents with waiting workers.                                                                                                                                                                                                                                                                                    |
| Subagents                          | Codex reads descendant threads with native lineage filters, pagination and both archive states; local lineage checks exclude unrelated sessions. No resume/load/write calls occur during observation. Claude captures session-local lifecycle/tool events, including reactivation of the same native ID and in-process teammates. Tests execute the actual generated hook, covering start, waiting, tool completion, stop, failure, stale reads, unsafe IDs and exclusion of internal-only Stop events. Persistence tests retain worker IDs but mark them stale after restart; toggles also stale worker observations. |
| Subagent dialog                    | Cards keep compact count/attention buttons. The modal shows worker names, native IDs, task/recent activity, projects, available model, status/time and nested Codex relationships. Native dialog focus and Escape closing were checked in Chrome. Desktop and 390px iframe previews fit the dialog and preserve dashboard layout, with no horizontal overflow. Per-component accessible heading IDs avoid collisions between equal native IDs from different providers. Responding uses the parent terminal.                                                                                                           |

Final local evidence: all **25** focused checks pass; Vue/server type checks and
clean production build pass. Isolated real-Codex smoke passes, including the new
descendant-list query with no children/errors, preset restoration and no submitted
turns. The explicit dormant-Claude developer smoke passes model discovery and
exact-ID preset routing without inference; it does not enable Claude in Garden.
The compiled CLI prints Agent Garden help. `npm pack` succeeds with a writable
temporary cache (the default user cache is blocked by this sandbox). Archive
contents include both retained adapters, descendant support and local logo assets.

Browser QA uses the built Vue bundle and stub state, independently of real backend
checks. It confirms modal rendering, worker lineage/IDs, attention highlights,
provider filtering with grouping, logo loading, Escape dismissal and 390px layout.
The running host was observed serving Agent Garden and connected providers before
the kill switch; it must restart to load the final disabled-Claude backend. The
last UI change only replaces disclosure with a native dialog and keeps the same
worker observation contract.

Remaining limits: no live inference swarm was started for verification. Native
terminal launch and focus are unavailable through this session's computer tool,
and direct host shared-daemon/socket access is sandboxed. Separate-process Claude
teams are not discovered, and Claude worker status denotes the last observed hook
event. Existing Claude sessions would need reopening to load new hooks when the
adapter is enabled again. Worker lists cap at 200 with visible truncation. No
session stealing, approval response, automatic backgrounding or task submission
was added. SonarQube is unavailable. Git still reports `not a git repository` in
this tool environment, so no commit/hash can be produced here; the user's earlier
baseline-commit confirmation remains the authority for proceeding.

Deviation from initial plan: cumulative UI/rename/subagent requests were included;
Claude is retained behind a disabled backend flag after the user's subscription
check, and worker details use a dialog at the user's request.

### Final availability and modal refinements

Later steering keeps dormant integrations visible only in Connections. Provider
snapshots now distinguish backend `available` from the runtime connection
`enabled` preference. Claude is `available: false`, `enabled: false`, disconnected,
with null configuration and no error/retry. Its cards, filter and creation option
are hidden. Connections shows its logo/name, **Off · Unavailable**, and a disabled
switch. Backend operations still reject attempts to enable, open or create it;
all saved native IDs and presets remain. The availability regression check was
updated to assert this catalog entry alongside zero connection attempts, blocked
access and identity restoration after re-enabling the backend implementation.
This supersedes the earlier note that Connections hides Claude altogether.

All native dialogs now prevent parent-page scrolling through the shared
`html/body:has(dialog[open])` rule. Dialog contents retain their own bounded
scrolling and contain scroll chaining. No JavaScript scroll-position bookkeeping
or extra dependency was introduced. In the built-browser preview, creation listed
only Codex; Connections showed Claude Off with a disabled switch. Creation,
Connections and worker dialogs reported root/body overflow hidden. A background
scroll attempt while the worker dialog was open left its parent at **222px →
222px**. Closing by Escape restores the ordinary page selector state.

All 25 focused checks, type checks and the final clean build pass. The package is
rebuilt as `agent-garden-0.1.0.tgz`. Browser checks use stub snapshots; active Codex
integration uses the separate no-inference CLI smoke. The final change retains
all previously delivered creation, persistence, status and terminal routing work.

## Dashboard garden, Pinia, SCSS and repository tooling

The approved frontend refactor keeps the existing dashboard appearance and session
behavior. App now owns one SSE subscription, its initial/explicit refresh and
five-second fallback polling, and writes snapshots into Pinia. Dashboard UI lives
under `src/client/gardens/dashboard`; the shared header, creation and connection
dialogs live under `components`. No garden switch, additional garden, router or
plugin registry was added. The user also requested repo-wide ESLint/Prettier and
save-time integration during implementation.

| Requirement                       | Final evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell and shared state        | App renders the header and dashboard and owns subscription cleanup. Two focused Pinia checks establish available-provider creation gating, retention of the full settings catalog and last snapshot on disconnect, and readiness recovery. Forms, filters and dialog state stay local.                                                                                                                                                                                                                      |
| SSE and fallback polling          | Three focused checks establish initial delivery, recovery to five-second polling on stream failure, return to SSE, failed-read recovery, non-overlapping reads, rejection of an overtaken HTTP snapshot, late-read suppression and polling/stream cleanup. Requests have a ten-second timeout.                                                                                                                                                                                                              |
| Dashboard extraction and behavior | Built Vue browser previews on desktop and at 390px show the existing layout, logos and attention states without horizontal overflow. Combined provider filtering/grouping kept equally named project folders distinct. The extracted creation dialog preserved model/reasoning selection, missing-folder confirmation and the explicit consent payload, then refreshed Pinia and the card list. Connections showed dormant Claude Off/Unavailable with a disabled switch, and a Codex toggle updated state. |
| Dialogs and scroll containment    | Creation and connection dialogs reported root/body overflow hidden. The 390px subagent dialog showed worker IDs, lineage, waiting/finished state and parent-terminal guidance. Background scroll remained at 731.5px during a scroll attempt; Escape dismissed the dialog.                                                                                                                                                                                                                                  |
| SCSS ownership                    | The original global CSS file was removed. Shared tokens, responsive mixins, base/accessibility and controls use Sass `@use`; component-specific styles are scoped SCSS. Production compilation and browser previews verify the extracted styles.                                                                                                                                                                                                                                                            |
| ESLint and Prettier               | Flat ESLint config covers client/server/scripts/tests/configuration; Prettier formats supported source, SCSS, HTML, JSON and documentation. Repo-wide formatting is intentional. Workspace settings enable formatting and ESLint fixes on manual/auto save, with editor extension recommendations. Save hooks depend on those extensions being installed in a compatible editor.                                                                                                                            |

Final checks: **30 tests**, repo-wide ESLint, formatting check, Vue/server type
checks and production build pass. The installed-Codex no-inference smoke check
also passes. Server changes are formatting, two intentional control-character
validation lint explanations and retaining the cause of a wrapped Claude CLI
error; provider/session behavior is preserved. Native terminal attachment was
not reverified and remains a host integration check. Browser evidence uses stub
API snapshots rather than a live swarm. SonarQube is unavailable.

Git access is now working: the previously reported metadata limitation was
resolved before this task, and baseline `8b5f538` exists. This work is on
`scss-pinia-dashboard`. Architecture and editor integration details live in
[frontend.md](frontend.md).

Deviation from initial plan: added repo-wide ESLint/Prettier, initial formatting
and workspace save hooks at the user's explicit request.

## Persistent projects and header actions — 2026-10-20

Approved in conversation: add folders through a native picker, retain projects
without agents, manage projects from a header dialog, move Add agent to the
header while keeping the ghost card, and offer Hide empty projects. Project
management includes display-name editing and removal only after all tracked
agents are removed. Manual path entry is superseded by folder selection; users
can create a directory through the picker's New Folder action. Execution: Rails.

Projects use canonical folder paths as their keys, with independent display
names. Metadata version 3 adds projects to the existing atomic `agents.json`;
versions 1 and 2 derive projects from tracked cards without changing card/native
IDs or connection preferences. Removing the last card keeps its project. A
provider observation that changes its working directory retains both projects.
Project removal checks all tracked cards, including unavailable providers, in
the same serialized store operation as the deletion. No folder deletion occurs.
Provider session creation, terminal handoff, and monitoring remain provider-owned.

The server opens an AppKit folder-only panel on explicit Add project, supporting
New Folder and cancellation. It passes a static JXA program to `osascript` as an
argument, validates the returned directory and deduplicates canonical paths.
Only one picker may open at once. Project routes retain local-host, origin and
request-header checks. Cancellation returns an unchanged snapshot. The browser
uses saved projects for agent creation, with Add project available there too.
Grouped dashboard rows include truly empty projects with a compact message and
an Add agent action preselecting that project. Hide empty defaults off; status
filters omit empty rows, and populated projects hidden by filters are not
misrepresented as empty. Search includes saved display names and full paths.

Verification performed:

- All 41 tests pass. New cases cover independent project persistence, legacy
  migration, display names, concurrent writes, removal guards, preservation of
  malformed metadata, working-directory changes, hidden-provider counts,
  empty-project/search/status combinations, native picker cancellation/failure
  and concurrency, and same-origin protection on project routes.
- Type checks, lint, formatting, production build and `git diff --check` pass.
  The real-Codex no-inference lifecycle smoke check passes.
- An isolated preview with temporary metadata and a fake provider confirmed the
  header actions, retained ghost card, compact empty row, hide-empty toggle,
  display-name editing and disabled removal of a populated project in Zen.
  Native folder selection returned a real folder and saved it in the preview.
  No actual agent tasks or terminal sessions were created by the preview.
- The computer-use tool then repeatedly timed out. Mobile layout, end-to-end
  creation from the saved-project selector, and creating a new directory inside
  the native picker remain manual visual checks. Native cancellation and
  creation capability are covered at the process/API boundary, rather than
  claimed as full native UI verification. SonarQube is unavailable.

Deviation from initial plan: None. The remaining host checks above are
verification limitations, not a change to scope. Restart the Garden backend and
reload the browser to load the new project routes and snapshot schema.

## External-agent discovery and global visibility — 2026-10-20

Source: the approved conversation for external agents. Discover only currently
open sessions in saved projects; retain discovered cards after closure. Distinguish
Garden-created cards with the logo sprout. The user replaced the initial proposal
for a discovery switch and origin filter with one persistent global Show external
agents setting in a header Settings dialog, default false. Hiding external agents
must not stop discovery or monitoring. Execution: Rails.

Delivered behavior:

- Codex discovers loaded top-level sessions through its read-only provider API,
  canonicalizes their paths and requires an exact saved-project match. It excludes
  children, internal subagents, cold historical threads, known cards and removed
  native identities. Discovery and observation never resume/name/subscribe/send
  input to a session or modify provider-owned conversations. Claude remains off.
- Store version 4 adds durable garden/external origin, visibility settings and
  removed-identity exclusions. Versions 1–3 retain card/native IDs, project display
  names and connection choices, migrating cards to Garden origin and visibility
  off. Imported cards survive closing/restart. Observations cannot create saved
  projects for external sessions; cards that move outside saved folders remain
  stored and become visible again when their folder is saved.
- Candidate admission checks provider generation, project membership, creation
  activity, native-identity uniqueness, exclusions and the existing 50-card limit
  inside the serialized store operation. In-flight results cannot re-add removed
  cards/projects or import after a provider is disabled. Discovery inspects at most
  200 loaded IDs per scan; Settings exposes limits/errors separately from transport
  health so existing cards continue monitoring when discovery fails.
- Show external agents applies to server snapshots delivered to every browser,
  independently of discovery. Hidden cards contribute no dashboard cards, search
  results, overview/attention totals or group badges. Project management keeps
  truthful tracked counts/removal guards. There is no origin filter or discovery
  switch. GardenIcon reuses the exact header sprout on Garden cards with an
  accessible Created in Garden label; external cards carry text identification.
- External Open terminal retains the exact native ID and normal launcher flags,
  without applying Garden's cached model/reasoning on cold resume. An installed
  Codex check confirmed that empty conversations may persist title/identity but
  expose null stored presets after restart; native resume then uses Codex defaults.
  This is documented rather than overridden with possibly stale cached settings.

Observed evidence:

- All 53 tests pass. Discovery cases cover saved-project boundaries, every
  subagent source/parent exclusion, stored provenance, duplicate/removal behavior,
  hidden monitoring/counts, provider-disable and project-removal races, overlapping
  Garden creation, read-only calls, paging/caps, errors without disconnects,
  external working-directory moves, closure retention and cold-resume arguments.
  Migration tests cover versions 1–3 without origin fields, preserving identities,
  saved display names and disabled connection choices. API tests check strict
  boolean settings, reject unsupported discovery controls, retain same-origin
  protection and reload persisted settings.
- Type checks, lint, formatting, build and git diff checks pass. The real installed
  Codex smoke creates an isolated native session outside Garden's creation path,
  discovers it, checks default hiding/global visibility, compares loaded IDs and
  settings before/after discovery, restarts and explicitly reopens that external
  session without cached overrides. Both threads still have zero turns. The
  dormant-Claude no-inference configuration/exact-ID probe also passes.
- A separate read-only check reached the user's existing shared Codex server,
  found two loaded sessions and no new eligible external sessions in the one
  saved project. It did not import cards, write metadata or submit work.
- In an isolated Zen preview with temporary metadata and a fake provider, the
  default view showed only the Garden card and its accessible sprout badge.
  Settings exposed Show external agents as off. Enabling it added the External
  card and updated total/attention counts; hiding it removed both the card and
  its task from search results. Enabling it from a second tab updated the first
  tab's existing search result and counts through SSE. The header and cards were
  visually checked at a 375px viewport, with the Settings controls usable there.
  Preview tabs/server were closed afterward; no real agent terminal was launched.

Remaining boundaries: only sessions visible to the connected Codex server are
eligible. Loaded state may outlive a terminal window and is not inferred from
recent timestamps. Independent servers, historical imports, Claude discovery and
resetting removal exclusions are outside this delivery. Actual native-terminal
handoff to a running external conversation was not exercised; command routing,
resume parameters and the real isolated cold-session lifecycle were verified.
SonarQube is unavailable. No model inference was submitted by verification.

Deviation from initial plan: None. The empty-session preset behavior is an observed
provider limitation; native provider behavior is preserved. Restart Garden and
reload browser windows for the new routes and snapshot schema.
