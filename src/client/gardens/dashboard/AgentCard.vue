<script setup lang="ts">
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { statusLabels, type Agent } from '../../../shared/types';
import { useGardenStore } from '../../stores/garden';
import { gardenApi } from '../../api';
import { projectName, hasWaitingWorker, initials, seen } from '../../agentPresentation';
import ProviderLogo from '../../components/ProviderLogo.vue';
import WorkerList from './WorkerList.vue';
defineProps<{ agent: Agent; index: number; now: number }>();
const emit = defineEmits<{ removed: [] }>();
const store = useGardenStore();
const { browserConnected } = storeToRefs(store);
const { providerName, providerEnabled } = store;
const busy = ref(false);
async function openTerminal(agent: Agent) {
  busy.value = true;
  store.notify('');
  try {
    await gardenApi.openTerminal(agent.id);
    store.notify(`Opening ${agent.name} in your terminal.`);
  } catch (error) {
    store.notify((error as Error).message);
  } finally {
    busy.value = false;
  }
}

async function remove(agent: Agent) {
  if (
    !window.confirm(
      `Remove ${agent.name} from Garden? Its ${providerName(agent.provider)} session and any running work will be kept.`,
    )
  )
    return;
  try {
    await gardenApi.removeAgent(agent.id);
    emit('removed');
  } catch (error) {
    store.notify((error as Error).message);
  }
}
</script>

<template>
  <article
    class="agent-card"
    :class="{
      disconnected: agent.connection === 'disconnected' || !browserConnected,
      'needs-input':
        browserConnected &&
        agent.connection === 'connected' &&
        (agent.status === 'waiting' || hasWaitingWorker(agent)),
      'response-finished':
        browserConnected &&
        agent.connection === 'connected' &&
        agent.status === 'finished' &&
        !hasWaitingWorker(agent),
    }"
  >
    <p
      v-if="
        browserConnected &&
        agent.connection === 'connected' &&
        (agent.status === 'waiting' || agent.status === 'finished' || hasWaitingWorker(agent))
      "
      class="card-attention"
    >
      <span aria-hidden="true">{{
        agent.status === 'waiting' || hasWaitingWorker(agent) ? '●' : '✓'
      }}</span
      >{{
        agent.status === 'waiting'
          ? 'Waiting for you'
          : hasWaitingWorker(agent)
            ? 'Worker needs your input'
            : 'Response finished'
      }}
    </p>
    <div class="card-heading">
      <span class="avatar" :class="`avatar-${index % 4}`">{{ initials(agent.name) }}</span>
      <div class="agent-name">
        <h3>{{ agent.name }}</h3>
        <span class="project-name" :title="agent.project">⌁ {{ projectName(agent.project) }}</span>
      </div>
      <button
        class="icon-button remove-card"
        :aria-label="`Remove ${agent.name} from dashboard`"
        title="Remove card; keep session"
        @click="remove(agent)"
      >
        ×
      </button>
    </div>
    <div class="status-row">
      <span
        class="provider-identity"
        :title="`${providerName(agent.provider)} session: ${agent.sessionId}`"
        ><ProviderLogo :provider="agent.provider" /></span
      ><span class="status-badge" :class="agent.status"
        ><span class="dot"></span
        >{{ agent.connection === 'disconnected' || !browserConnected ? 'Last known: ' : ''
        }}{{ statusLabels[agent.status] }}</span
      ><span
        v-if="agent.connection === 'disconnected' || !browserConnected"
        class="disconnected-label"
        >Disconnected</span
      >
    </div>
    <div class="task">
      <span class="field-label">{{ agent.task ? 'CURRENT TASK' : 'READY WHEN YOU ARE' }}</span>
      <p :class="{ placeholder: !agent.task }">
        {{
          agent.task || 'No task yet. Open the terminal and give your agent something to work on.'
        }}
      </p>
    </div>
    <p v-if="agent.detail" class="agent-detail">{{ agent.detail }}</p>
    <div class="model-row">
      <span :title="agent.model">{{ agent.model }}</span
      ><span v-if="agent.reasoning" class="reasoning">{{ agent.reasoning }}</span>
    </div>
    <WorkerList
      :workers="agent.workers ?? []"
      :parent-session-id="agent.sessionId"
      :parent-agent-name="agent.name"
      :browser-connected="browserConnected"
      :error="agent.workersError"
    />
    <footer class="card-footer">
      <span class="last-seen" :title="agent.lastSeen || ''"
        >{{ agent.connection === 'connected' && browserConnected ? 'Seen ' : 'Last seen '
        }}{{ seen(agent.lastSeen, now) }}</span
      ><button
        class="terminal-button"
        :disabled="busy || !browserConnected || !providerEnabled(agent.provider)"
        :title="
          providerEnabled(agent.provider)
            ? `Open ${providerName(agent.provider)} session ${agent.sessionId}`
            : 'Enable this provider in connection settings'
        "
        @click="openTerminal(agent)"
      >
        <span aria-hidden="true">›_</span> {{ busy ? 'Opening…' : 'Open terminal' }}
        <span aria-hidden="true">↗</span>
      </button>
    </footer>
  </article>
</template>

<style scoped lang="scss">
@use '../../styles/tokens' as tokens;
.agent-card {
  padding: 22px 23px 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  display: flex;
  flex-direction: column;
  min-width: 0;
  box-shadow: 0 3px 5px #263c1e02;
}
.card-heading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.avatar {
  height: 42px;
  width: 42px;
  border: 1px solid #dce4d2;
  background: #eaf0df;
  color: #7e9165;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 650;
  border-radius: 12px;
  flex-shrink: 0;
}
.avatar-1 {
  color: #8d7ca5;
  background: #f0eaf6;
  border-color: #e8def1;
}
.avatar-2 {
  color: #66889d;
  background: #eaf3f7;
  border-color: #dcebf0;
}
.avatar-3 {
  color: #aa8a58;
  background: #faf0e1;
  border-color: #eee2d2;
}
.agent-name {
  min-width: 0;
  flex: 1;
}
.agent-name h3 {
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.project-name {
  display: block;
  font-size: 11px;
  color: #8b9485;
  margin-top: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.remove-card {
  align-self: flex-start;
  font-size: 18px;
  margin: -9px -12px 0 0;
}
.status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: var(--space-6);
}
.disconnected-label {
  font-size: 9px;
  color: #a08663;
}
.disconnected > .status-row .status-badge {
  color: #8b8d85;
  background: #f2f3ee;
  border-color: #e8e9e0;
}
.task {
  margin-top: 21px;
  flex: 1;
  min-height: 96px;
}
.field-label {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 1.1px;
  color: #9ca392;
}
.task p {
  font-size: 12px;
  line-height: 1.75;
  margin-top: var(--space-2);
  color: #50604d;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.task p.placeholder {
  color: #9ba292;
}
.agent-detail {
  font-size: 10px;
  color: #a38c64;
  line-height: 1.65;
  margin-top: 10px;
  overflow-wrap: anywhere;
}
.model-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 19px;
  margin-bottom: var(--space-5);
  font-size: 9px;
  color: #8f9985;
}
.model-row > span:first-child {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reasoning {
  background: var(--color-background);
  border: 1px solid #e9ece1;
  padding: 3px 6px;
  border-radius: 4px;
}
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  border-top: 1px solid #edf0e8;
  padding: 14px 0;
}
.last-seen {
  color: #a3ab99;
  font-size: 9px;
}
.terminal-button {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #54704c;
  background: #f3f6ed;
  border: 1px solid #e2e9d9;
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 10px;
  white-space: nowrap;
}
.terminal-button:hover {
  background: #e8efdd;
}
.terminal-button > span:first-child {
  font-family: monospace;
  font-size: 13px;
}
.terminal-button > span:last-child {
  margin-left: 3px;
  color: #94a382;
}
@include tokens.mobile {
  .agent-card {
    padding: 22px 22px 0;
  }
  .task {
    min-height: 80px;
  }
  .task p {
    font-size: 13px;
  }
  .card-footer {
    padding: var(--space-4) 0;
  }
  .terminal-button {
    font-size: 11px;
  }
}
.provider-identity {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
}
.provider-identity .provider-logo {
  width: 30px;
  height: 30px;
}
.provider-identity img[alt^='Codex'] {
  transform: scale(1.35);
}
.agent-card.needs-input {
  border-color: #c99b3d;
  box-shadow: 0 0 0 1px #c99b3d35;
  background: #fffbf5;
}
.agent-card.response-finished {
  border-color: #83a575;
  box-shadow: 0 0 0 1px #83a57525;
  background: #f5f8f1;
}
.card-attention {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.5;
  margin: -4px 0 15px;
  color: var(--color-warning);
}
.response-finished .card-attention {
  color: var(--color-success);
}
.needs-input .status-badge.waiting {
  color: #805b16;
  border-color: #dec17a;
  background: #fff0c8;
}
.response-finished .status-badge.finished {
  color: #476d36;
  border-color: #b8cea8;
  background: #e7f2dd;
}
</style>
