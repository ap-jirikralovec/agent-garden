# Agent Garden

Agent Garden is a local browser dashboard for creating and monitoring Codex
agents. It shows their status, project, and current task, and opens their terminal
when you need to respond. Conversations and approvals stay with Codex.

The server, dashboard, and saved data run only on your machine. Agent Garden
supports macOS, Linux, Windows through WSL2, and native Windows.

## Run locally

Install Node.js 24.12+ and Codex CLI 0.163.0+, then sign in to Codex. Use the
standalone Codex installer on native Windows. On WSL2, install both inside the
distribution.

```sh
npm install
npm run build
npm start
```

Open **http://127.0.0.1:4317** if the browser does not open automatically. Keep
the launcher terminal running; press **Ctrl+C** to stop Agent Garden. For
development, use `npm run dev`.

## Local Work presets

Choose **Work** when creating an agent to run a recurring workflow:
**Choose work → Fill parameters → Review/edit prompt → Send**. Send creates the
agent and submits the exact reviewed text. **Open terminal after creation** is
checked by default; uncheck it to start without a terminal window. Conversations
and approvals still belong in the agent's terminal.

Open **Settings → Manage presets** to create, edit or delete presets with a
structured form for metadata, parameter names/defaults and the prompt. Saves
validate the same schema as manually authored files. Invalid files appear here
with their error and can be replaced or deleted, while remaining hidden from
agent creation. Saving rewrites YAML formatting and comments. If a file changes
after loading, reload the list before editing it again; unsaved changes are kept
in the form until you discard them. Delete asks for confirmation and moves the
file into `work/.trash/<unique-id>/`; recover it by moving it back into `work`.
Managing presets never starts an agent or changes existing conversations.

You can also create a `work` folder inside Garden's data directory and put one
preset in each `.yaml` or `.yml` file. These files are local user data, not built-in workflows.
Garden reloads them whenever the creation dialog opens. The empty Work picker
shows the folder path; a custom `--data-dir PATH` uses `PATH/work`.

Default locations:

- macOS: `~/Library/Application Support/Agent Garden/work` (or the existing
  `Codex Garden/work` directory when legacy metadata is reused).
- Linux/WSL: `$XDG_DATA_HOME/Agent Garden/work`, falling back to
  `~/.local/share/Agent Garden/work`.
- Windows: `%LOCALAPPDATA%\Agent Garden\work`.

For example, save your own `review.yaml`:

```yaml
name: Review a pull request
author: Jiri
description: Review a PR with a particular focus.
parameters:
  - pull_request: ''
  - focus: 'Correctness and regression risks'
prompt: |
  Review {{pull_request}}.
  Focus on {{focus}}.
```

All five fields are required. `parameters` is an ordered list of single string
key:value pairs; use `parameters: []` for work without parameters. Values are
editable defaults; every parameter needs a nonblank value before review. Quote
numeric/boolean defaults such as `"123"` or `"true"` to keep them strings. Parameter
names start with a letter or underscore and contain letters, numbers, underscores
or hyphens. Reference them with `{{parameter_name}}`; surrounding whitespace inside
the braces is allowed. Substitution is literal and runs once, including repeated
placeholders. No template expressions, includes, or YAML aliases are supported.

Back preserves your inputs and review edits, including drafts for other presets
selected in the same dialog. If changed parameters would overwrite review edits,
you must confirm replacing those edits. Closing/reopening starts a fresh form.
Changes to files during an open dialog do not change its reviewed prompt.

Malformed YAML, missing/invalid fields, duplicate parameter names and unknown or
malformed placeholders exclude the file from the picker. Garden logs its filename
and validation error to the server terminal without printing its prompt. Fix the
file and reopen the dialog. Loading presets never creates an agent or starts work.

Limits: 100 YAML files per load, 128 KiB per file, 32 parameters, 4,000 characters
per parameter value, and 16,000 characters in the final prompt. Names and authors
allow 120 characters each; descriptions allow 2,000. Extra fields are rejected.
