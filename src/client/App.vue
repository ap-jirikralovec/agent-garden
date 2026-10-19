<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { statusLabels, type Agent, type AgentStatus, type ProjectCheck, type ProviderId, type ProviderSnapshot, type Snapshot } from '../shared/types';
import ProviderLogo from './ProviderLogo.vue';
import WorkerList from './WorkerList.vue';
import { filterAgents, groupAgents } from './agentView';

const state = ref<Snapshot>({ agents: [], providers: [], error: null, projectSuggestion: '' });
const loaded = ref(false);
const browserConnected = ref(true);
const filter = ref('all');
const search = ref('');
const providerFilters = ref<ProviderId[]>(['codex', 'claude']);
const groupByProject = ref(false);
const notice = ref('');
const dialog = ref<HTMLDialogElement>();
const settingsDialog = ref<HTMLDialogElement>();
const settingsBusy = ref('');
const settingsError = ref('');
const nameInput = ref<HTMLInputElement>();
const creating = ref(false);
const formError = ref('');
const busyAgent = ref('');
const form = ref({ provider: '' as ProviderId | '', name: '', project: '', model: '', reasoning: null as string | null, createProject: false });
const projectStatus = ref<'unchecked' | 'checking' | 'exists' | 'missing' | 'error'>('unchecked');
const projectError = ref('');
let projectCheckVersion = 0;
const now = ref(Date.now());
let events: EventSource | undefined;
let clock: ReturnType<typeof setInterval>;

const availableProviders = computed(() => state.value.providers.filter(provider => provider.available));
const readyProviders = computed(() => availableProviders.value.filter(provider => provider.enabled && provider.connection === 'connected' && provider.configuration?.models.length));
const selectedProvider = computed(() => state.value.providers.find(provider => provider.id === form.value.provider));
const selectedModel = computed(() => selectedProvider.value?.configuration?.models.find(model => model.id === form.value.model));
const providerProblems = computed(() => state.value.providers.filter(provider => provider.enabled && provider.error));
const connectionsEnabled = computed(() => state.value.providers.some(provider => provider.enabled));
const connectedCount = computed(() => state.value.providers.filter(provider => provider.enabled && provider.connection === 'connected').length);
const counts = computed(() => ({
  working: state.value.agents.filter(agent => agent.status === 'working' && agent.connection === 'connected').length,
  waiting: state.value.agents.filter(agent => agent.status === 'waiting' && agent.connection === 'connected' || hasWaitingWorker(agent)).length,
  finished: state.value.agents.filter(agent => agent.status === 'finished').length,
}));
const visible = computed(() => filterAgents(state.value.agents, providerFilters.value, filter.value, search.value));
const groups = computed(() => groupAgents(visible.value, groupByProject.value));
const total = computed(() => state.value.agents.length);
const monitorReady = computed(() => browserConnected.value && readyProviders.value.length > 0);
const selectedReady = computed(() => browserConnected.value && readyProviders.value.some(provider => provider.id === form.value.provider));
function providerName(id: ProviderId) { return state.value.providers.find(provider => provider.id === id)?.name ?? id; }
function providerEnabled(id: ProviderId) { return !!state.value.providers.find(provider => provider.id === id)?.enabled; }

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Garden-Request': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

async function refresh() {
  try { state.value = await api<Snapshot>('/api/state'); loaded.value = true; browserConnected.value = true; }
  catch { browserConnected.value = false; loaded.value = true; }
}

onMounted(async () => {
  await refresh();
  events = new EventSource('/api/events');
  events.onmessage = event => { state.value = JSON.parse(event.data); browserConnected.value = true; loaded.value = true; };
  events.onerror = () => { browserConnected.value = false; };
  clock = setInterval(() => { now.value = Date.now(); }, 10000);
});
onUnmounted(() => { events?.close(); clearInterval(clock); });

function selectModel() { form.value.reasoning = selectedModel.value?.defaultReasoning ?? null; }
function selectProvider() {
  const config = selectedProvider.value?.configuration;
  form.value.model = config?.defaultModel || config?.models[0]?.id || '';
  selectModel();
}

function showSettings() { settingsError.value = ''; settingsDialog.value?.showModal(); }
async function toggleConnection(provider: ProviderSnapshot, event: Event) {
  if (!provider.available) return;
  const input = event.target as HTMLInputElement;
  settingsBusy.value = provider.id;
  settingsError.value = '';
  try { state.value = await api<Snapshot>(`/api/providers/${provider.id}`, 'POST', { enabled: input.checked }); }
  catch (error) {
    settingsError.value = (error as Error).message;
    input.checked = providerEnabled(provider.id);
  } finally { settingsBusy.value = ''; }
}

watch(() => form.value.project, () => {
  // Consent and in-flight checks belong to the exact path the user entered.
  projectCheckVersion++;
  projectStatus.value = 'unchecked';
  projectError.value = '';
  form.value.createProject = false;
  formError.value = '';
}, { flush: 'sync' });

async function checkProject(): Promise<ProjectCheck | null> {
  const project = form.value.project;
  const version = ++projectCheckVersion;
  if (!project.trim()) { projectStatus.value = 'unchecked'; return null; }
  projectStatus.value = 'checking';
  projectError.value = '';
  try {
    const result = await api<ProjectCheck>('/api/projects/check', 'POST', { project });
    if (version !== projectCheckVersion) return null;
    projectStatus.value = result.exists ? 'exists' : 'missing';
    return result;
  } catch (error) {
    if (version !== projectCheckVersion) return null;
    projectStatus.value = 'error';
    projectError.value = (error as Error).message;
    return null;
  }
}

async function showDialog() {
  formError.value = '';
  projectCheckVersion++;
  projectStatus.value = 'unchecked';
  projectError.value = '';
  form.value = {
    provider: readyProviders.value[0]?.id ?? '', name: '', project: state.value.projectSuggestion,
    model: '', reasoning: null,
    createProject: false,
  };
  selectProvider();
  dialog.value?.showModal();
  await nextTick();
  nameInput.value?.focus();
}

async function createAgent() {
  if (creating.value || !selectedReady.value) return;
  creating.value = true;
  formError.value = '';
  try {
    const project = await checkProject();
    if (!project) return;
    if (!project.exists && !form.value.createProject) {
      formError.value = 'Confirm creation of the new folder before continuing.';
      return;
    }
    const result = await api<{ agent: Agent; warning: string | null }>('/api/agents', 'POST', form.value);
    dialog.value?.close();
    notice.value = result.warning || `${result.agent.name} is ready. Write your first task in the terminal.`;
    await refresh();
  } catch (error) { formError.value = (error as Error).message; }
  finally { creating.value = false; }
}

async function openTerminal(agent: Agent) {
  busyAgent.value = agent.id;
  notice.value = '';
  try { await api(`/api/agents/${agent.id}/terminal`, 'POST'); notice.value = `Opening ${agent.name} in your terminal.`; }
  catch (error) { notice.value = (error as Error).message; }
  finally { busyAgent.value = ''; }
}

async function remove(agent: Agent) {
  if (!window.confirm(`Remove ${agent.name} from Garden? Its ${providerName(agent.provider)} session and any running work will be kept.`)) return;
  try { await api(`/api/agents/${agent.id}`, 'DELETE'); await refresh(); }
  catch (error) { notice.value = (error as Error).message; }
}

function projectName(path: string) { return path.split('/').filter(Boolean).pop() || path; }
function hasWaitingWorker(agent: Agent) { return !!agent.workers?.some(worker => worker.connection === 'connected' && worker.status === 'waiting'); }
function initials(name: string) { return name.slice(0, 2).toUpperCase(); }
function seen(value: string | null) {
  if (!value) return 'Not seen yet';
  const seconds = Math.max(0, Math.round((now.value - new Date(value).getTime()) / 1000));
  if (seconds < 15) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Agent Garden home">
        <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 26V15M16 20C7 20 5 13 6 7c7 0 11 4 10 13ZM16 16C16 8 21 5 27 6c0 7-4 11-11 10Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span>agent<span class="brand-light">garden</span><small>LOCAL WORKSPACE</small></span>
      </a>
      <div class="header-actions"><button class="secondary settings-button" @click="showSettings">⚙ Connections</button><span class="local-tag"><span class="dot" :class="browserConnected && connectedCount ? 'green' : 'amber'"></span>{{ !browserConnected ? 'Dashboard offline' : !connectionsEnabled ? 'Connections paused' : `${connectedCount} connected` }}</span></div>
    </header>

    <main>
      <section class="page-heading">
        <div><p class="eyebrow">A LITTLE SPACE FOR BIG IDEAS</p><h1>Your agents, at a glance.</h1><p class="subtitle">See what’s growing. Jump into a terminal when you’re needed.</p></div>
        <button class="primary" :disabled="!monitorReady" @click="showDialog"><span aria-hidden="true">＋</span> Add agent</button>
      </section>

      <div v-if="!browserConnected || state.error || providerProblems.length || (loaded && !connectionsEnabled)" class="connection-banner" role="status">
        <span class="banner-icon" aria-hidden="true">◌</span>
        <div><strong>{{ !browserConnected ? 'Dashboard connection lost' : !connectionsEnabled ? 'Connections paused' : 'Connection needs attention' }}</strong><p v-if="!browserConnected">Keep the local Garden process running. This page will reconnect automatically.</p><p v-else-if="!connectionsEnabled">Enable a connection in settings to add agents and monitor their status.</p><p v-else-if="state.error">{{ state.error }}</p><p v-for="provider in providerProblems" v-else :key="provider.id">{{ provider.name }}: {{ provider.error }}</p></div>
        <span v-if="connectionsEnabled" class="retry-label">Retrying automatically</span>
      </div>
      <div v-if="notice" class="notice" role="status"><span>{{ notice }}</span><button class="icon-button" aria-label="Dismiss notification" @click="notice = ''">×</button></div>

      <section class="overview" aria-label="Agent overview">
        <div class="overview-item"><span class="metric-icon moss" aria-hidden="true">⌘</span><div><strong>{{ total }}</strong><span>Total agents</span></div></div>
        <div class="overview-item"><span class="metric-icon blue" aria-hidden="true">↗</span><div><strong>{{ counts.working }}</strong><span>Working</span></div></div>
        <div class="overview-item"><span class="metric-icon sand" aria-hidden="true">…</span><div><strong>{{ counts.waiting }}</strong><span>Need your input</span></div></div>
        <div class="overview-item"><span class="metric-icon lavender" aria-hidden="true">✓</span><div><strong>{{ counts.finished }}</strong><span>Latest response finished</span></div></div>
      </section>

      <section aria-labelledby="agents-title" class="agents-section">
        <div class="section-toolbar"><div class="section-title"><h2 id="agents-title">Your agents</h2><span class="count-bubble">{{ total }}</span></div>
          <div class="filters"><label class="search"><span aria-hidden="true">⌕</span><input v-model="search" aria-label="Search agents and workers by name, project, provider or ID" placeholder="Search agents, projects or IDs" type="search" /></label>
            <select v-model="filter" aria-label="Filter by status"><option value="all">All statuses</option><option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option><option value="disconnected">Disconnected</option></select>
          </div>
        </div>

        <div class="view-toolbar">
          <fieldset class="provider-filters"><legend>Agent types</legend>
            <label v-for="provider in availableProviders" :key="provider.id" class="provider-filter" :class="{ selected: providerFilters.includes(provider.id) }"><input v-model="providerFilters" type="checkbox" :value="provider.id" /><ProviderLogo :provider="provider.id" /><span>{{ provider.name }}</span></label>
          </fieldset>
          <label class="group-toggle"><span>Group by project</span><span class="connection-switch"><input v-model="groupByProject" type="checkbox" role="switch" aria-label="Group by project" /><span aria-hidden="true"></span></span></label>
        </div>

        <div v-if="!loaded" class="empty-state"><p>Opening the garden…</p></div>
        <div v-else-if="!total" class="empty-state">
          <div class="empty-art" aria-hidden="true"><span class="plant-stem"></span><span class="plant-leaf left"></span><span class="plant-leaf right"></span><span class="plant-pot"></span><i class="spark one">✧</i><i class="spark two">✧</i></div>
          <span class="eyebrow">ROOM TO GROW</span><h3>A home for your first agent.</h3><p>Give it a name, choose a project, and start a task in your terminal.<br />We’ll keep an eye on its status here.</p>
          <button class="primary" :disabled="!monitorReady" @click="showDialog">＋ Add your first agent</button>
          <small>Local to your Mac. Conversations stay in your terminal.</small>
        </div>
        <div v-else-if="!visible.length" class="empty-state compact"><h3>No agents match this view.</h3><p>Choose an agent type, try another status, or clear your search.</p><button class="secondary" @click="filter = 'all'; search = ''; providerFilters = ['codex', 'claude']">Clear filters</button></div>
        <div v-else class="agent-groups">
          <section v-for="group in groups" :key="group.project" :class="{ 'project-group': groupByProject }" :aria-label="groupByProject ? group.project : undefined">
            <header v-if="groupByProject" class="project-heading"><div><h3>{{ projectName(group.project) }} <span class="count-bubble">{{ group.agents.length }}</span></h3><p>{{ group.project }}</p></div></header>
            <div class="agent-grid">
          <article v-for="(agent, index) in group.agents" :key="agent.id" class="agent-card" :class="{ disconnected: agent.connection === 'disconnected' || !browserConnected, 'needs-input': browserConnected && agent.connection === 'connected' && (agent.status === 'waiting' || hasWaitingWorker(agent)), 'response-finished': browserConnected && agent.connection === 'connected' && agent.status === 'finished' && !hasWaitingWorker(agent) }">
            <p v-if="browserConnected && agent.connection === 'connected' && (agent.status === 'waiting' || agent.status === 'finished' || hasWaitingWorker(agent))" class="card-attention"><span aria-hidden="true">{{ agent.status === 'waiting' || hasWaitingWorker(agent) ? '●' : '✓' }}</span>{{ agent.status === 'waiting' ? 'Waiting for you' : hasWaitingWorker(agent) ? 'Worker needs your input' : 'Response finished' }}</p>
            <div class="card-heading"><span class="avatar" :class="`avatar-${index % 4}`">{{ initials(agent.name) }}</span><div class="agent-name"><h3>{{ agent.name }}</h3><span class="project-name" :title="agent.project">⌁ {{ projectName(agent.project) }}</span></div><button class="icon-button remove-card" :aria-label="`Remove ${agent.name} from dashboard`" title="Remove card; keep session" @click="remove(agent)">×</button></div>
            <div class="status-row"><span class="provider-identity" :title="`${providerName(agent.provider)} session: ${agent.sessionId}`"><ProviderLogo :provider="agent.provider" /></span><span class="status-badge" :class="agent.status"><span class="dot"></span>{{ agent.connection === 'disconnected' || !browserConnected ? 'Last known: ' : '' }}{{ statusLabels[agent.status as AgentStatus] }}</span><span v-if="agent.connection === 'disconnected' || !browserConnected" class="disconnected-label">Disconnected</span></div>
            <div class="task"><span class="field-label">{{ agent.task ? 'CURRENT TASK' : 'READY WHEN YOU ARE' }}</span><p :class="{ placeholder: !agent.task }">{{ agent.task || 'No task yet. Open the terminal and give your agent something to work on.' }}</p></div>
            <p v-if="agent.detail" class="agent-detail">{{ agent.detail }}</p>
            <div class="model-row"><span :title="agent.model">{{ agent.model }}</span><span v-if="agent.reasoning" class="reasoning">{{ agent.reasoning }}</span></div>
            <WorkerList :workers="agent.workers ?? []" :parent-session-id="agent.sessionId" :parent-agent-name="agent.name" :browser-connected="browserConnected" :error="agent.workersError" />
            <footer class="card-footer"><span class="last-seen" :title="agent.lastSeen || ''">{{ agent.connection === 'connected' && browserConnected ? 'Seen ' : 'Last seen ' }}{{ seen(agent.lastSeen) }}</span><button class="terminal-button" :disabled="busyAgent === agent.id || !browserConnected || !providerEnabled(agent.provider)" :title="providerEnabled(agent.provider) ? `Open ${providerName(agent.provider)} session ${agent.sessionId}` : 'Enable this provider in connection settings'" @click="openTerminal(agent)"><span aria-hidden="true">›_</span> {{ busyAgent === agent.id ? 'Opening…' : 'Open terminal' }} <span aria-hidden="true">↗</span></button></footer>
          </article>
          <button v-if="!groupByProject" class="add-card" :disabled="!monitorReady" @click="showDialog"><span aria-hidden="true">＋</span><strong>Make room for another</strong><small>Add a new agent</small></button>
            </div>
          </section>
        </div>
      </section>
      <footer class="page-footer"><span><span class="dot green"></span> Everything happens on your Mac</span><span>Conversations stay in your terminal <span aria-hidden="true">↗</span></span></footer>
    </main>

    <dialog ref="settingsDialog" aria-labelledby="settings-title" @cancel="settingsBusy && $event.preventDefault()">
      <div class="dialog-heading"><h2 id="settings-title">Connections</h2><button class="icon-button" aria-label="Close settings" :disabled="!!settingsBusy" @click="settingsDialog?.close()">×</button></div>
      <p class="dialog-intro">Choose which agent providers Garden connects to. Turning a connection off keeps your cards and leaves running agents alone.</p>
      <div class="connection-settings">
        <div v-for="provider in state.providers" :key="provider.id" class="connection-setting">
          <div><strong :id="`provider-${provider.id}`" class="connection-provider"><ProviderLogo :provider="provider.id" />{{ provider.name }}</strong><p :id="`provider-status-${provider.id}`">{{ !provider.available ? 'Off · Unavailable' : settingsBusy === provider.id ? 'Updating…' : !provider.enabled ? 'Off' : provider.connection === 'connected' ? 'Connected' : 'Connecting…' }}</p></div>
          <label class="connection-switch" :class="{ unavailable: !provider.available }"><input type="checkbox" role="switch" :aria-labelledby="`provider-${provider.id}`" :aria-describedby="`provider-status-${provider.id}`" :checked="provider.available && provider.enabled" :disabled="!provider.available || !!settingsBusy || !browserConnected" @change="toggleConnection(provider, $event)" /><span aria-hidden="true"></span></label>
          <p v-if="provider.enabled && provider.error" class="connection-setting-error">{{ provider.error }}</p>
        </div>
      </div>
      <p v-if="settingsError" class="form-error" role="alert">{{ settingsError }}</p>
      <div class="dialog-footer"><button class="primary" :disabled="!!settingsBusy" @click="settingsDialog?.close()">Done</button></div>
    </dialog>

    <dialog ref="dialog" aria-labelledby="dialog-title" @cancel="creating && $event.preventDefault()">
      <form @submit.prevent="createAgent">
        <div class="dialog-heading"><span class="dialog-icon" aria-hidden="true">＋</span><button class="icon-button" type="button" aria-label="Close dialog" :disabled="creating" @click="dialog?.close()">×</button></div>
        <h2 id="dialog-title">A new agent, a fresh start.</h2><p class="dialog-intro">Choose its setup. Your first task starts in the terminal.</p>
        <label class="form-label" for="agent-provider">Agent type<select id="agent-provider" v-model="form.provider" :disabled="creating" @change="selectProvider"><option v-for="provider in readyProviders" :key="provider.id" :value="provider.id">{{ provider.name }}</option></select></label>
        <label class="form-label" for="agent-name">Name<input id="agent-name" ref="nameInput" v-model="form.name" required maxlength="60" placeholder="e.g. Miso" :disabled="creating" autocomplete="off" /></label>
        <label class="form-label" for="agent-project">Project folder<input id="agent-project" v-model="form.project" required maxlength="4096" placeholder="/Users/you/projects/my-app" :disabled="creating" spellcheck="false" aria-describedby="project-hint project-feedback" :aria-invalid="projectStatus === 'error' ? true : undefined" @blur="!creating && checkProject()" /><small id="project-hint">Use an absolute path or ~/projects/my-app.</small></label>
        <div id="project-feedback" class="project-feedback" aria-live="polite">
          <p v-if="projectStatus === 'checking'">Checking folder…</p>
          <p v-else-if="projectStatus === 'exists'">Folder exists.</p>
          <p v-else-if="projectStatus === 'error'" class="project-error">{{ projectError }}</p>
          <template v-else-if="projectStatus === 'missing'">
            <p>This folder does not exist yet.</p>
            <label class="folder-confirm"><input v-model="form.createProject" type="checkbox" :disabled="creating" />Confirm creation of new folder</label>
            <small>Missing parent folders will also be created when you choose Create &amp; open terminal.</small>
          </template>
        </div>
        <div class="form-columns"><label class="form-label" for="agent-model">Model<select id="agent-model" v-model="form.model" required :disabled="creating" @change="selectModel"><option v-for="model in selectedProvider?.configuration?.models" :key="model.id" :value="model.id">{{ model.name }}</option></select></label>
          <label v-if="selectedModel?.reasoningLevels.length" class="form-label" for="agent-reasoning">Reasoning<select id="agent-reasoning" v-model="form.reasoning" required :disabled="creating"><option v-for="effort in selectedModel?.reasoningLevels" :key="effort.id" :value="effort.id">{{ effort.name }}</option></select></label></div>
        <p class="dialog-note">↗ Opens the saved session in your terminal. {{ selectedProvider?.name }} keeps your existing permissions and sign-in settings.</p>
        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
        <div class="dialog-footer"><button class="secondary" type="button" :disabled="creating" @click="dialog?.close()">Cancel</button><button class="primary" type="submit" :disabled="creating || !selectedReady || (projectStatus === 'missing' && !form.createProject)">{{ creating ? 'Creating session…' : 'Create & open terminal' }} <span v-if="!creating" aria-hidden="true">↗</span></button></div>
      </form>
    </dialog>
  </div>
</template>
