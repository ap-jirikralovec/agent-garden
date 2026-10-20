import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderConfiguration } from '../../../shared/types.js';

export interface ClaudeSession {
  sessionId?: string;
  id?: string;
  kind: 'interactive' | 'background';
  cwd: string;
  pid?: number;
  state?: 'working' | 'blocked' | 'done' | 'failed' | 'stopped';
  status?: 'busy' | 'waiting' | 'idle';
  waitingFor?: string;
}

export interface ClaudeModel {
  value: string;
  displayName: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

export function modelConfiguration(models: ClaudeModel[]): ProviderConfiguration {
  if (
    !Array.isArray(models) ||
    !models.length ||
    models.some(
      (model) =>
        !model ||
        typeof model.value !== 'string' ||
        typeof model.displayName !== 'string' ||
        (model.supportedEffortLevels !== undefined &&
          (!Array.isArray(model.supportedEffortLevels) ||
            model.supportedEffortLevels.some((level) => typeof level !== 'string'))),
    )
  ) {
    throw new Error('Claude returned invalid or empty model configuration.');
  }
  return {
    defaultModel: models.find((model) => model.value === 'default')?.value ?? models[0].value,
    models: models.map((model) => {
      const levels = model.supportsEffort ? (model.supportedEffortLevels ?? []) : [];
      return {
        id: model.value,
        name: model.displayName,
        defaultReasoning: levels.includes('medium') ? 'medium' : (levels[0] ?? null),
        reasoningLevels: levels.map((id) => ({ id, name: id })),
      };
    }),
  };
}

const execute = promisify(execFile);
export class ClaudeCli {
  constructor(
    readonly executable: string,
    private cwd: string,
    private env = process.env,
  ) {}

  async sessions(): Promise<ClaudeSession[]> {
    try {
      const { stdout } = await execute(this.executable, ['agents', '--json', '--all'], {
        cwd: this.cwd,
        env: this.env,
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const result: unknown = JSON.parse(stdout);
      if (
        !Array.isArray(result) ||
        result.some(
          (row) =>
            !row ||
            typeof row.cwd !== 'string' ||
            !['interactive', 'background'].includes(row.kind) ||
            (row.sessionId !== undefined && typeof row.sessionId !== 'string') ||
            (row.id !== undefined && typeof row.id !== 'string') ||
            (row.status !== undefined && !['busy', 'waiting', 'idle'].includes(row.status)) ||
            (row.state !== undefined &&
              !['working', 'blocked', 'done', 'failed', 'stopped'].includes(row.state)) ||
            (row.waitingFor !== undefined && typeof row.waitingFor !== 'string') ||
            (row.pid !== undefined && (!Number.isSafeInteger(row.pid) || row.pid < 1)),
        )
      ) {
        throw new Error('Unexpected session list.');
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('Install Claude Code 2.1.292 or later, then restart Garden.', {
          cause: error,
        });
      throw new Error(
        'Could not read Claude sessions. Garden requires Claude Code 2.1.292 or later with agents --json support.',
        { cause: error },
      );
    }
  }

  async configuration(): Promise<ProviderConfiguration> {
    // Initialize the same control protocol used by the Agent SDK. Send no user
    // messages: discovering models must never submit work or spend inference.
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
        {
          cwd: this.cwd,
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let pending = '';
      let settled = false;
      const finish = (error?: Error, configuration?: ProviderConfiguration) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin.end();
        child.kill();
        if (error) reject(error);
        else resolve(configuration!);
      };
      const timer = setTimeout(
        () => finish(new Error('Claude did not return its model configuration.')),
        15000,
      );
      child.on('error', () =>
        finish(new Error('Could not start Claude Code. Check its installation.')),
      );
      child.stdin.on('error', () =>
        finish(new Error('Claude closed its configuration connection.')),
      );
      child.stderr.resume(); // Never expose credentials or arbitrary CLI diagnostics.
      child.on('exit', () =>
        finish(new Error('Claude exited before returning model configuration.')),
      );
      child.stdout.on('data', (chunk) => {
        pending += chunk;
        if (pending.length > 4 * 1024 * 1024)
          return finish(new Error('Claude model response was too large.'));
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.type !== 'control_response' || event.response?.request_id !== 'garden-models')
              continue;
            if (event.response.subtype !== 'success')
              return finish(new Error('Claude rejected model discovery.'));
            finish(undefined, modelConfiguration(event.response.response?.models));
          } catch {
            finish(new Error('Claude returned invalid model configuration.'));
          }
        }
      });
      child.stdin.write(
        JSON.stringify({
          type: 'control_request',
          request_id: 'garden-models',
          request: { subtype: 'initialize', hooks: {} },
        }) + '\n',
      );
    });
  }
}
