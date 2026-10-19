# Agent Garden

A small local dashboard for your **Codex agents**, with a dormant Claude Code adapter. Vue 3,
TypeScript and Node.js. Conversations and approvals stay in your terminal.

## Run locally

Requires macOS, **Node.js 24.12 or later**, and **Codex CLI 0.163.0+**,
installed and signed in (`codex login`). Claude Code is currently disabled by its
backend `enabled` flag because of a subscription constraint. Its implementation,
logos and saved session identities are retained for re-enabling later; no Claude
connection is made. Its cards, filters and creation option are hidden; Connections
shows it as Off · Unavailable with a disabled switch.

To restore Claude later, set `ClaudeProvider.enabled` to `true`, rebuild and restart
Garden. It requires Claude Code 2.1.292+ and an account with access. The frontend
then picks up its models, effort levels, logo and filters automatically. A runtime
connection toggle cannot override a backend-disabled provider.

```sh
npm install
npm run build
npm start
```

Your browser opens at **http://127.0.0.1:4317**. Keep the launcher running.
Use `npm start -- --port 4318` for another port, or `--no-open` to skip opening a
browser. `npm run dev` runs the backend with Vite middleware. Runtime monitoring can be paused in **Connections** for each backend-enabled provider.

1. Choose **Add agent**, select an available provider, enter a name and project folder,
   and choose from that provider's models and reasoning levels. Choices come from
   the installed CLI; models without effort options hide that field.
2. Garden checks the folder on blur. A missing folder reveals **Confirm creation
   of new folder**; changing the path clears consent. **Create & open terminal**
   creates confirmed missing parents recursively, saves the preset and opens a
   terminal ready for your first task. Checking the path or checkbox alone creates
   nothing. Files/inaccessible paths show errors. Created folders survive later
   session failures.
3. Return to Garden for status. **Open terminal** uses that provider and the exact
   saved native session ID. Removing a card only removes Garden's tracking metadata.

Codex cards show the ChatGPT logo; Claude cards show the Claude logo. The agent
identity and terminal button expose the native session ID on hover. Use the
**Agent types** checkboxes to select Codex, Claude, both, or neither; combine them
with status and search filters. Search includes names, projects, tasks, providers
and native IDs, including observed workers. **Group by project** groups the filtered cards by the full path,
so equally named folders stay separate. Waiting cards have an amber border and
**Waiting for you** label. Finished responses have a green border and **Response
finished** label. These highlights require a current connection; disconnected
cards retain their last known state.

## Terminal behavior

The launcher uses macOS's default application for `.command` files, usually
Terminal.app, with Terminal.app as a fallback. All arguments and working
folders are quoted. Failed launches retain the card so you can retry.

**Codex:** Garden shares the local daemon used by your terminal. Opening an unloaded
session restores its preset through the server, then launches
`codex --enable daemon_auto_start resume <thread-id> --cd <project>`. Loaded
sessions keep their current settings. No CLI model/reasoning overrides or explicit
remote endpoint are used; those cause writer/trust conflicts in Codex 0.163.0.
Trust and permission prompts remain in Codex.

**Claude (currently disabled):** Garden reserves a UUID and saves the preset. The first terminal starts
`claude --session-id <uuid>` with the selected name/model/effort, project working
directory and session-only observation settings. Claude handles sign-in and trust
there; Garden sends no initial task. After you submit a prompt, reopening a closed
session uses `--resume <uuid>` without overriding its model or effort. A live
background session uses `claude attach <exact-job-id>`. A live interactive session
is focused in Terminal.app using its recorded terminal and matching process ID;
Garden refuses to start a competing writer if it cannot focus that terminal.
macOS may request permission to control Terminal for focusing. Other terminal apps
can launch sessions, but focusing their existing tabs is currently unsupported.

Claude task snippets and completion events come from observation hooks installed
only for Garden sessions, using `--settings`; your global settings are unchanged.
The hooks write no conversation context or approval decisions. Disabling Claude
monitoring leaves those sessions running and their local hooks intact. If hooks
are disabled by your Claude policy, live status can still be read, but task text
and closed-session reopening metadata may be unavailable. Model/effort selection
on creation uses the installed CLI's model catalog. The card keeps the saved
effort; effort changes made inside Claude are not currently observed.

For Claude sessions to keep working after closing their terminal, background them
using Claude's own controls. Garden does not background, restart or cancel work.
See [Claude's agent view documentation](https://code.claude.com/docs/en/agent-view)
and [hooks reference](https://code.claude.com/docs/en/hooks).

## States and connections

| State             | Meaning                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| Idle              | Ready for the first task.                                                         |
| Working           | The provider reports active work.                                                 |
| Waiting for input | A structured input/approval request needs you in the terminal.                    |
| Finished          | The latest response finished; this does not establish success of the whole task.  |
| Failed            | The provider reported failure or interruption.                                    |
| Disconnected      | Garden cannot verify current runtime state; last state and last-seen time remain. |

Garden does not infer questions or success from prose. Polling refreshes every
two seconds, with connection retry backoff up to 15 seconds. Closed Claude
interactive sessions appear disconnected until reopened. Codex closing behavior
depends on its shared daemon; verify your setup before relying on unattended work.

**Connections** has independent, persistent toggles. Disabling keeps cards and
running work, pauses monitoring, and disables creation/terminal opening for that
provider. Re-enabling reconnects and refreshes status and configuration.

Only parent sessions created in Garden are tracked, up to 50. Open a card's
**subagents** dialog to inspect workers, their native IDs, current task/recent activity,
project, status and observation time. A waiting worker also highlights its parent.
The overview counts parent cards; “Need your input” includes parents with waiting
workers. Parent response status is not replaced by an aggregate swarm status.

Codex workers come from the tracked parent's descendant-thread API, including
archived workers and nested parent relationships. Claude workers come from
session-specific lifecycle/tool hooks, including in-process teammates. Claude
worker statuses mean the last observed lifecycle event, rather than an independent
live-process check; task text may show recent tool activity. Missing evidence stays
unknown or disconnected. Completed workers remain visible; each card displays up
to 200 workers and reports truncation. Separate-process Claude teammate discovery
is not implemented. Existing Claude terminals need to exit and reopen once to
load the new worker hooks. Use the **parent's terminal** to inspect or respond to
workers; Garden does not take over worker conversations.

External top-level session discovery, dashboard chat, and dashboard approval
handling are outside this version. See [provider architecture](docs/providers.md).

## Local data and the rename

New installations use `~/Library/Application Support/Agent Garden/agents.json`.
Existing **Codex Garden** installations reuse their old data directory in place
when the new directory has no metadata. No existing card, provider ID, native
session ID, preset or connection preference is renamed or discarded.

All dialogs lock page scrolling while keeping their own contents scrollable.

Private launchers and Claude observation snippets live alongside the metadata.
Full conversation history and credentials remain with the provider; Garden does
not read or store login credentials. Version 1 Codex cards load automatically and
retain their IDs; changes save version 2 metadata. New Garden card IDs are separate
from provider/native IDs, including identical native IDs from different providers.
To select another data directory:

```sh
npm start -- --data-dir /path/to/garden-data
```

The server binds to loopback and enforces local same-origin requests. Stopping
Garden closes only its monitor/dashboard. Protocol changes produce read errors
rather than invented state.

## Checks and packaging

Frontend ownership and editor setup are documented in
[frontend architecture](docs/frontend.md). The app shell owns SSE updates with a
five-second browser polling fallback, and Pinia shares state with the dashboard
garden. Styles use SCSS with shared tokens and component-scoped rules.

```sh
npm test                 # focused status, filtering, persistence and routing checks
npm run type-check
npm run lint
npm run format:check
npm run check:codex      # isolated installed-Codex check, no task/inference
npm run check:claude     # explicit developer probe of dormant Claude; no task/inference
npm run check:connection # read-only check of the actual shared Codex connection
npm pack                 # builds the CLI with bundled browser assets
```

Try `npm exec --package ./agent-garden-0.1.0.tgz -- agent-garden` locally.
The package is not published. A future release can use `npx agent-garden`, subject
to npm name availability. Branding assets are bundled locally from
[SVGL](https://github.com/pheralb/svgl); see [their MIT license](docs/logo-license.txt).
See [delivery notes](docs/delivery.md) for observed verification and host limitations.
