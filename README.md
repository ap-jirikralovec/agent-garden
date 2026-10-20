# Agent Garden

A local browser dashboard for your agents. Create agents, see their status,
project and current task, and open their terminal when you need to respond.
Conversations and approvals stay in the terminal.

## Run locally

Requires macOS, Node.js 24.12+ and Codex CLI 0.163.0+ installed and signed in.

From the project folder:

```sh
npm install
npm run build
npm start
```

Your browser opens at **http://127.0.0.1:4317**. Keep the launcher terminal running;
press **Ctrl+C** to stop Garden.

For development, use `npm run dev`.

## Projects and saved data

Use **Projects** in the header to add a project with the macOS folder picker.
Choose an existing folder, or create one with **New Folder** in the picker.
Projects stay saved even when they have no agents. Rename changes only the
Garden display name. Remove is available after all its tracked agent cards have
been removed; it never deletes the folder or its files.

**Add agent** in the header (or the ghost card) opens creation with a saved project
selector. In **Group by project**, empty projects have a compact placeholder;
**Hide empty projects** hides them. Search matches saved project names and paths.
Status filters show only projects with matching agents.

Garden saves projects, tracked agent metadata and connection settings in
`~/Library/Application Support/Agent Garden/agents.json`. Existing installations
with legacy `Codex Garden/agents.json` reuse that directory in place. Agent
conversations remain with their providers. Browser storage and the port number
do not determine your saved data: restarting on another port uses the same file.
Use `--data-dir PATH` for an independent dataset. Run only one Garden process per
data directory; concurrent processes do not coordinate metadata writes.
