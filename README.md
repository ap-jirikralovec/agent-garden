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
