<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { ProviderId } from '../../../shared/types';
import { useGardenStore } from '../../stores/garden';
import { filterAgents, groupAgents } from './agentView';
import DashboardOverview from './DashboardOverview.vue';
import DashboardFilters from './DashboardFilters.vue';
import AgentCard from './AgentCard.vue';
const emit = defineEmits<{ refresh: []; addAgent: [project?: string] }>();
const store = useGardenStore();
const {
  snapshot: state,
  loaded,
  browserConnected,
  notice,
  providerProblems,
  connectionsEnabled,
  monitorReady,
  total,
} = storeToRefs(store);
const filter = ref('all');
const search = ref('');
const selectedProviders = ref<ProviderId[] | null>(null);
// Start with the backend catalog; an explicit selection also supports choosing none.
const providerFilters = computed({
  get: () => selectedProviders.value ?? store.availableProviders.map((provider) => provider.id),
  set: (value: ProviderId[]) => {
    selectedProviders.value = value;
  },
});
const groupByProject = ref(false);
const hideEmpty = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval>;
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now();
  }, 10000);
});
onUnmounted(() => clearInterval(clock));
const visible = computed(() =>
  filterAgents(
    state.value.agents,
    providerFilters.value,
    filter.value,
    search.value,
    state.value.projects,
  ),
);
const groups = computed(() =>
  groupAgents(visible.value, groupByProject.value, {
    projects: state.value.projects,
    allAgents: state.value.agents,
    hideEmpty: hideEmpty.value,
    search: search.value,
    status: filter.value,
  }),
);
function clearFilters() {
  filter.value = 'all';
  search.value = '';
  selectedProviders.value = null;
  hideEmpty.value = false;
}
</script>

<template>
  <main>
    <section class="page-heading">
      <div>
        <p class="eyebrow">A LITTLE SPACE FOR BIG IDEAS</p>
        <h1>Your agents, at a glance.</h1>
        <p class="subtitle">See what’s growing. Jump into a terminal when you’re needed.</p>
      </div>
    </section>

    <div
      v-if="
        !browserConnected ||
        state.error ||
        providerProblems.length ||
        (loaded && !connectionsEnabled)
      "
      class="connection-banner"
      role="status"
    >
      <span class="banner-icon" aria-hidden="true">◌</span>
      <div>
        <strong>{{
          !browserConnected
            ? 'Dashboard connection lost'
            : !connectionsEnabled
              ? 'Connections paused'
              : 'Connection needs attention'
        }}</strong>
        <p v-if="!browserConnected">
          Keep the local Garden process running. This page will reconnect automatically.
        </p>
        <p v-else-if="!connectionsEnabled">
          Enable a connection in settings to add agents and monitor their status.
        </p>
        <p v-else-if="state.error">{{ state.error }}</p>
        <p v-for="provider in providerProblems" v-else :key="provider.id">
          {{ provider.name }}: {{ provider.error }}
        </p>
      </div>
      <span v-if="connectionsEnabled" class="retry-label">Retrying automatically</span>
    </div>
    <div v-if="notice" class="notice" role="status">
      <span>{{ notice }}</span
      ><button class="icon-button" aria-label="Dismiss notification" @click="notice = ''">×</button>
    </div>

    <DashboardOverview />

    <section aria-labelledby="agents-title" class="agents-section">
      <DashboardFilters
        v-model:search="search"
        v-model:filter="filter"
        v-model:providers="providerFilters"
        v-model:grouped="groupByProject"
        v-model:hide-empty="hideEmpty"
      />

      <div v-if="!loaded" class="empty-state"><p>Opening the garden…</p></div>
      <div v-else-if="!total && !state.projects.length" class="empty-state">
        <div class="empty-art" aria-hidden="true">
          <span class="plant-stem"></span><span class="plant-leaf left"></span
          ><span class="plant-leaf right"></span><span class="plant-pot"></span
          ><i class="spark one">✧</i><i class="spark two">✧</i>
        </div>
        <span class="eyebrow">ROOM TO GROW</span>
        <h3>A home for your first agent.</h3>
        <p>
          Give it a name, choose a project, and start a task in your terminal.<br />We’ll keep an
          eye on its status here.
        </p>
        <button class="primary" :disabled="!monitorReady" @click="emit('addAgent')">
          ＋ Add your first agent
        </button>
        <small>Local to your computer. Conversations stay in your terminal.</small>
      </div>
      <div
        v-else-if="!visible.length && !(groupByProject && groups.length)"
        class="empty-state compact"
      >
        <h3>
          {{
            groupByProject
              ? 'No projects match this view.'
              : !total
                ? 'No agents currently.'
                : 'No agents match this view.'
          }}
        </h3>
        <p>Add an agent from the header, or clear your filters to see more.</p>
        <button class="secondary" @click="clearFilters">Clear filters</button>
      </div>
      <div v-else class="agent-groups">
        <section
          v-for="group in groups"
          :key="group.project"
          :class="{ 'project-group': groupByProject }"
          :aria-label="groupByProject ? group.project : undefined"
        >
          <header v-if="groupByProject" class="project-heading">
            <div>
              <h3>
                {{ store.projectLabel(group.project) }}
                <span class="count-bubble">{{ group.agents.length }}</span>
              </h3>
              <p>{{ group.project }}</p>
            </div>
          </header>
          <div v-if="!group.agents.length && groupByProject" class="empty-project">
            <span>No agents currently.</span>
            <button
              class="secondary"
              :disabled="!monitorReady"
              @click="emit('addAgent', group.project)"
            >
              ＋ Add agent
            </button>
          </div>
          <div v-else class="agent-grid">
            <AgentCard
              v-for="(agent, index) in group.agents"
              :key="agent.id"
              :agent="agent"
              :index="index"
              :now="now"
              @removed="emit('refresh')"
            />
            <button
              v-if="!groupByProject"
              class="add-card"
              :disabled="!monitorReady"
              @click="emit('addAgent')"
            >
              <span aria-hidden="true">＋</span><strong>Make room for another</strong
              ><small>Add a new agent</small>
            </button>
          </div>
        </section>
      </div>
    </section>
    <footer class="page-footer">
      <span><span class="dot green"></span> Everything happens on your computer</span
      ><span>Conversations stay in your terminal <span aria-hidden="true">↗</span></span>
    </footer>
  </main>
</template>

<style scoped lang="scss">
@use '../../styles/tokens' as tokens;
main {
  padding-top: 46px;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
}
.subtitle {
  font-size: 14px;
  color: var(--color-muted);
  margin-top: var(--space-3);
  line-height: 1.6;
}
.connection-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff8e9;
  border: 1px solid #eaddbd;
  color: #7c6338;
  border-radius: 11px;
  padding: 15px 18px;
  margin-top: 25px;
  font-size: 12px;
}
.connection-banner strong {
  font-weight: 600;
}
.connection-banner p {
  line-height: 1.6;
  margin-top: 3px;
  overflow-wrap: anywhere;
}
.banner-icon {
  font-size: 28px;
}
.retry-label {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
}
.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-5);
  background: #eaf1e5;
  border: 1px solid #d6e4ce;
  padding: 10px 15px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.6;
}
.agents-section {
  margin-top: 42px;
}
.agent-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
  align-items: stretch;
}
.add-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 300px;
  border: 1px dashed #ccd7bf;
  border-radius: var(--radius-card);
  color: #859474;
  background: #f1f4ea;
}
.add-card:hover:not(:disabled) {
  background: #eaf0e0;
}
.add-card > span {
  font-size: 25px;
  width: 44px;
  height: 44px;
  background: #e6edda;
  border: 1px solid #d9e3c9;
  border-radius: 50%;
  display: grid;
  place-items: center;
  margin-bottom: var(--space-1);
}
.add-card strong {
  font-size: 12px;
  font-weight: 500;
}
.add-card small {
  font-size: 10px;
  color: #a0ac8c;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  border: 1px dashed #d5deca;
  border-radius: var(--radius-card);
  padding: 40px 22px 35px;
  background: #f0f3e9;
  min-height: 350px;
}
.empty-state .eyebrow {
  font-size: 8px;
  margin: var(--space-3) 0;
}
.empty-state h3 {
  font-size: 21px;
  font-weight: 550;
  letter-spacing: -0.6px;
}
.empty-state p {
  font-size: 12px;
  line-height: 1.9;
  color: #8a957e;
  margin-top: var(--space-3);
}
.empty-state .primary {
  margin-top: 23px;
}
.empty-state > small {
  font-size: 9px;
  color: #9aa68c;
  margin-top: var(--space-4);
}
.empty-state.compact {
  min-height: 180px;
  justify-content: center;
}
.compact .secondary {
  margin-top: var(--space-5);
}
.empty-art {
  position: relative;
  width: 120px;
  height: 88px;
}
.plant-pot {
  position: absolute;
  bottom: 0;
  left: 42px;
  width: 38px;
  height: 33px;
  background: #ccab8d;
  clip-path: polygon(0 0, 100% 0, 88% 100%, 12% 100%);
  border-radius: 2px;
}
.plant-stem {
  position: absolute;
  bottom: 27px;
  left: 59px;
  width: 3px;
  height: 45px;
  background: #8aab74;
  border-radius: 5px;
  transform: rotate(4deg);
}
.plant-leaf {
  position: absolute;
  width: 26px;
  height: 17px;
  background: #9db887;
  bottom: 53px;
  border-radius: 0 25px 0 25px;
}
.plant-leaf.left {
  left: 35px;
  transform: rotate(9deg);
}
.plant-leaf.right {
  left: 60px;
  bottom: 64px;
  transform: scaleX(-1) rotate(-8deg);
  background: #b5c89e;
}
.spark {
  position: absolute;
  color: #bbc5ac;
  font-style: normal;
  font-size: 18px;
}
.spark.one {
  top: 10px;
  left: 10px;
}
.spark.two {
  right: 2px;
  bottom: 18px;
  font-size: 12px;
}
.page-footer {
  margin: 30px 0 25px;
  display: flex;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid var(--color-border);
  padding-top: 18px;
  font-size: 9px;
  color: #9aa58d;
}
.page-footer > span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.page-footer .dot {
  width: 5px;
  height: 5px;
}
@include tokens.wide {
  main {
    padding-top: 56px;
  }
}
@include tokens.tablet {
  .agent-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@include tokens.mobile {
  main {
    padding-top: 30px;
  }
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 22px;
  }
  .page-heading > .primary {
    width: 100%;
  }
  .subtitle {
    font-size: 12px;
  }
  .agents-section {
    margin-top: 30px;
  }
  .agent-grid {
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }
  .add-card {
    min-height: 170px;
  }
  .page-footer {
    flex-direction: column;
    font-size: 9px;
    line-height: 1.7;
  }
  .connection-banner {
    align-items: flex-start;
  }
  .retry-label {
    display: none;
  }
  .empty-state {
    padding: 30px 18px;
  }
  .empty-state h3 {
    font-size: 20px;
  }
}
.agent-groups {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.project-heading {
  margin-bottom: 14px;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.project-heading h3 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.project-heading p {
  font-size: 11px;
  color: var(--color-muted);
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.empty-project {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-control);
  color: var(--color-muted);
  font-size: 12px;
}
.empty-project .secondary {
  padding: 7px 10px;
  font-size: 11px;
}
.project-group {
  min-width: 0;
}
@include tokens.mobile {
  .project-heading p {
    font-size: 10px;
  }
}
</style>
