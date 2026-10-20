# Agent Garden

Agent Garden is a local browser dashboard for creating and monitoring Codex
agents. It shows their status, project, and current task, and opens their terminal
when you need to respond. Conversations and approvals stay with Codex.

The server, dashboard, and saved data run only on your machine. Agent Garden
supports macOS, Windows through WSL2, and native Windows.

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
