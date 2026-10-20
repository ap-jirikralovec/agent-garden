<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { statusLabels, type AgentWorker } from '../../../shared/types';
const props = defineProps<{
  workers: AgentWorker[];
  parentSessionId: string;
  parentAgentName: string;
  browserConnected: boolean;
  error?: string | null;
}>();
const dialog = ref<HTMLDialogElement>();
const titleId = `workers-title-${useId()}`;
const waiting = computed(() =>
  props.browserConnected
    ? props.workers.filter(
        (worker) => worker.status === 'waiting' && worker.connection === 'connected',
      ).length
    : 0,
);
const finished = computed(
  () => props.workers.filter((worker) => worker.status === 'finished').length,
);
const label = (worker: AgentWorker) =>
  worker.status === 'unknown' ? 'Unknown' : statusLabels[worker.status];
const parentName = (worker: AgentWorker) =>
  props.workers.find((parent) => parent.id === worker.parentSessionId)?.name ??
  worker.parentSessionId;
</script>

<template>
  <div v-if="workers.length || error" class="worker-panel">
    <button
      class="worker-trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-label="`View ${parentAgentName}’s ${workers.length} subagents${waiting ? `, ${waiting} need input` : ''}`"
      @click="dialog?.showModal()"
    >
      <span>{{ workers.length }} subagent{{ workers.length === 1 ? '' : 's' }}</span
      ><span v-if="waiting" class="worker-alert">{{ waiting }} need input</span
      ><span v-else-if="finished" class="worker-done">{{ finished }} finished</span
      ><span class="worker-open-icon" aria-hidden="true">↗</span>
    </button>
    <dialog ref="dialog" class="worker-dialog" :aria-labelledby="titleId">
      <div class="dialog-heading">
        <h2 :id="titleId">{{ parentAgentName }}’s subagents</h2>
        <button class="icon-button" aria-label="Close subagents" @click="dialog?.close()">×</button>
      </div>
      <p class="dialog-intro">
        {{ workers.length }} worker{{ workers.length === 1 ? '' : 's' }}. Use the parent terminal to
        inspect them or respond.
      </p>
      <p v-if="error" class="agent-detail">{{ error }}</p>
      <ul class="worker-list">
        <li
          v-for="worker in workers"
          :key="worker.id"
          :class="{
            'worker-nested': worker.parentSessionId !== parentSessionId,
            'worker-waiting':
              browserConnected && worker.connection === 'connected' && worker.status === 'waiting',
            'worker-finished':
              browserConnected && worker.connection === 'connected' && worker.status === 'finished',
          }"
        >
          <div class="worker-heading">
            <strong>{{ worker.name }}</strong
            ><span
              class="status-badge"
              :class="[
                worker.status,
                { 'worker-stale': worker.connection === 'disconnected' || !browserConnected },
              ]"
              >{{ worker.connection === 'disconnected' || !browserConnected ? 'Last known: ' : ''
              }}{{ label(worker) }}</span
            >
          </div>
          <small class="worker-id">{{ worker.id }}</small>
          <small v-if="worker.parentSessionId !== parentSessionId"
            >↳ Under {{ parentName(worker) }}</small
          >
          <p class="worker-task">{{ worker.task || 'Task details unavailable.' }}</p>
          <small>{{ worker.project }}{{ worker.model ? ` · ${worker.model}` : '' }}</small>
          <small :title="worker.detail || ''"
            >{{ worker.connection === 'disconnected' || !browserConnected ? 'Disconnected · ' : ''
            }}{{
              worker.lastSeen
                ? `Observed ${new Date(worker.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Not observed yet'
            }}</small
          >
        </li>
      </ul>
      <div class="dialog-footer">
        <button class="primary" @click="dialog?.close()">Done</button>
      </div>
    </dialog>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/tokens' as tokens;

.worker-panel {
  border-top: 1px solid #e7ecdf;
  padding: var(--space-3) 0;
  color: #617057;
}
.worker-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  width: 100%;
  padding: var(--space-2) 10px;
  border: 1px solid #dfe7d5;
  border-radius: 7px;
  color: #566c49;
  background: #f3f6ed;
  font-size: 11px;
  text-align: left;
}
.worker-trigger:hover {
  background: #eaf0e1;
}
.worker-open-icon {
  margin-left: auto;
  color: #8b9a7e;
}
.worker-dialog {
  width: min(660px, calc(100% - 32px));
}
.worker-dialog .dialog-heading {
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 10px;
}
.worker-dialog h2 {
  overflow-wrap: anywhere;
}
.worker-dialog .dialog-intro {
  margin-bottom: 18px;
}
.worker-dialog .worker-list li {
  padding: 15px;
}
.worker-dialog .worker-heading strong {
  font-size: 14px;
}
.worker-dialog .worker-task {
  font-size: 12px;
}
.worker-dialog .worker-list small {
  font-size: 10px;
}
.worker-dialog .worker-heading .status-badge {
  font-size: 10px;
  padding: var(--space-1) 7px;
}
.worker-dialog .worker-id {
  font-family: monospace;
  margin-top: var(--space-1);
}
.worker-dialog .agent-detail {
  margin: 0 0 14px;
  color: var(--color-muted);
  font-size: 10px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.worker-alert {
  color: var(--color-warning);
  background: #fff0c8;
  padding: 3px 5px;
  border-radius: 4px;
  font-size: 10px;
}
.worker-done {
  color: var(--color-success);
  font-size: 10px;
}
.worker-note {
  font-size: 10px;
  line-height: 1.6;
  color: #839078;
  margin: 10px 0;
}
.worker-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.worker-list li {
  padding: 10px;
  border: 1px solid #e2e7db;
  border-radius: var(--radius-control);
  background: #f8faf5;
  min-width: 0;
}
.worker-list .worker-waiting {
  border-color: #d7b258;
  background: #fff8e9;
}
.worker-list .worker-finished {
  border-color: #a8c396;
  background: #f1f7eb;
}
.worker-list li.worker-nested {
  margin-left: 10px;
  border-left-width: 3px;
}
.worker-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}
.worker-heading strong {
  font-size: 11px;
  font-weight: 600;
  overflow-wrap: anywhere;
  min-width: 0;
}
.worker-heading .status-badge {
  font-size: 9px;
  padding: 3px 5px;
}
.worker-task {
  font-size: 11px;
  line-height: 1.6;
  margin: 7px 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.worker-list small {
  display: block;
  font-size: 9px;
  line-height: 1.6;
  color: #7f8b76;
  overflow-wrap: anywhere;
}

.worker-list .status-badge.worker-stale {
  color: #8b8d85;
  background: #f2f3ee;
  border-color: #e8e9e0;
}
</style>
