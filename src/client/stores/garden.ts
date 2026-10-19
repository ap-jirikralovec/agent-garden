import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { ProviderId, Snapshot } from '../../shared/types';
import { hasWaitingWorker } from '../agentPresentation';

export const useGardenStore = defineStore('garden', () => {
  const snapshot = ref<Snapshot>({ agents: [], providers: [], error: null, projectSuggestion: '' });
  const loaded = ref(false);
  const browserConnected = ref(true);
  const notice = ref('');
  const revision = ref(0);

  const availableProviders = computed(() =>
    snapshot.value.providers.filter((provider) => provider.available),
  );
  const readyProviders = computed(() =>
    availableProviders.value.filter(
      (provider) =>
        provider.enabled &&
        provider.connection === 'connected' &&
        provider.configuration?.models.length,
    ),
  );
  const providerProblems = computed(() =>
    snapshot.value.providers.filter((provider) => provider.enabled && provider.error),
  );
  const connectionsEnabled = computed(() =>
    availableProviders.value.some((provider) => provider.enabled),
  );
  const connectedCount = computed(
    () =>
      availableProviders.value.filter(
        (provider) => provider.enabled && provider.connection === 'connected',
      ).length,
  );
  const monitorReady = computed(() => browserConnected.value && readyProviders.value.length > 0);
  const total = computed(() => snapshot.value.agents.length);
  const counts = computed(() => ({
    working: snapshot.value.agents.filter(
      (agent) => agent.status === 'working' && agent.connection === 'connected',
    ).length,
    waiting: snapshot.value.agents.filter(
      (agent) =>
        (agent.status === 'waiting' && agent.connection === 'connected') || hasWaitingWorker(agent),
    ).length,
    finished: snapshot.value.agents.filter((agent) => agent.status === 'finished').length,
  }));

  function receiveSnapshot(value: Snapshot) {
    snapshot.value = value;
    loaded.value = true;
    browserConnected.value = true;
    revision.value++;
  }
  function disconnect() {
    browserConnected.value = false;
    loaded.value = true;
  }
  function notify(message: string) {
    notice.value = message;
  }
  function providerName(id: ProviderId) {
    return snapshot.value.providers.find((provider) => provider.id === id)?.name ?? id;
  }
  function providerEnabled(id: ProviderId) {
    return !!availableProviders.value.find((provider) => provider.id === id)?.enabled;
  }

  return {
    snapshot,
    loaded,
    browserConnected,
    notice,
    revision,
    availableProviders,
    readyProviders,
    providerProblems,
    connectionsEnabled,
    connectedCount,
    monitorReady,
    total,
    counts,
    receiveSnapshot,
    disconnect,
    notify,
    providerName,
    providerEnabled,
  };
});
