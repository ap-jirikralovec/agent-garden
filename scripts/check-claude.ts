import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCli } from '../src/server/providers/claude/cli.js';
import { ClaudeProvider } from '../src/server/providers/claude/index.js';
import { ClaudeObservations } from '../src/server/providers/claude/observation.js';
import type { Agent } from '../src/shared/types.js';
import type { TerminalCommand } from '../src/server/terminal.js';

// Explicit developer probe of the dormant adapter. Garden never registers a
// provider whose backend enabled flag is false. No task or inference is sent.
const directory = await mkdtemp(join(tmpdir(), 'agent-garden-claude-check-'));
try {
  const cli = new ClaudeCli('claude', directory, { ...process.env, CLAUDE_CONFIG_DIR: directory });
  const commands: TerminalCommand[] = [];
  const adapter = new ClaudeProvider(cli, new ClaudeObservations(directory), {
    async open(_id, command) {
      commands.push(command);
    },
    async focus() {
      return false;
    },
  });
  try {
    await adapter.connect();
    const config = await adapter.configuration();
    assert.ok(config.models.length);
    const model = config.models.find((model) => model.id === config.defaultModel)!;
    const preset = {
      name: 'Clove smoke check',
      project: directory,
      model: model.id,
      reasoning: model.defaultReasoning,
    };
    const { sessionId, warning } = await adapter.createSession(preset);
    const agent: Agent = {
      ...preset,
      id: randomUUID(),
      origin: 'garden',
      provider: 'claude',
      sessionId,
      task: '',
      status: 'idle',
      connection: 'disconnected',
      lastSeen: null,
      detail: null,
      createdAt: new Date().toISOString(),
    };
    assert.equal(warning, null);
    assert.notEqual(agent.id, agent.sessionId);
    await adapter.openTerminal(agent);
    assert.equal(commands[0].args[0], '--session-id');
    assert.equal(commands[0].args[1], agent.sessionId);
    await adapter.openTerminal(agent);
    assert.equal(commands[1].args[1], agent.sessionId);
    assert.deepEqual(await cli.sessions(), []);
    console.log(
      `Dormant Claude adapter model discovery and exact-ID preset routing passed (${config.models.length} models). No task or inference submitted. Claude stays disabled in Garden.`,
    );
  } finally {
    await adapter.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
