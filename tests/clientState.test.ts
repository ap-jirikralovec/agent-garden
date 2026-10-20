import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGardenStore } from '../src/client/stores/garden';
import type { Snapshot } from '../src/shared/types';

function snapshot(): Snapshot {
  return {
    agents: [],
    error: null,
    projectSuggestion: '/work/app',
    providers: [
      {
        id: 'codex',
        name: 'Codex',
        available: true,
        enabled: true,
        connection: 'connected',
        error: null,
        configuration: {
          defaultModel: 'test',
          models: [{ id: 'test', name: 'Test', defaultReasoning: null, reasoningLevels: [] }],
        },
      },
      {
        id: 'claude',
        name: 'Claude',
        available: false,
        enabled: false,
        connection: 'disconnected',
        error: null,
        configuration: null,
      },
    ],
  };
}

describe('shared Garden state', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('exposes only available, connected providers for creation, retaining the full settings catalog', () => {
    const store = useGardenStore();
    store.receiveSnapshot(snapshot());
    expect(store.snapshot.providers).toHaveLength(2);
    expect(store.availableProviders.map((provider) => provider.id)).toEqual(['codex']);
    expect(store.readyProviders.map((provider) => provider.id)).toEqual(['codex']);
    expect(store.monitorReady).toBe(true);
  });

  it('retains the last snapshot on disconnect and restores readiness with fresh state', () => {
    const store = useGardenStore();
    store.receiveSnapshot(snapshot());
    store.disconnect();
    expect(store.loaded).toBe(true);
    expect(store.monitorReady).toBe(false);
    expect(store.snapshot.projectSuggestion).toBe('/work/app');
    store.receiveSnapshot(snapshot());
    expect(store.monitorReady).toBe(true);
  });
});
