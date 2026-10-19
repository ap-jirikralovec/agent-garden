<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { statusLabels, type AgentWorker } from '../shared/types';
const props = defineProps<{ workers: AgentWorker[]; parentSessionId: string; parentAgentName: string; browserConnected: boolean; error?: string | null }>();
const dialog = ref<HTMLDialogElement>();
const titleId = `workers-title-${useId()}`;
const waiting = computed(() => props.browserConnected ? props.workers.filter(worker => worker.status === 'waiting' && worker.connection === 'connected').length : 0);
const finished = computed(() => props.workers.filter(worker => worker.status === 'finished').length);
const label = (worker: AgentWorker) => worker.status === 'unknown' ? 'Unknown' : statusLabels[worker.status];
const parentName = (worker: AgentWorker) => props.workers.find(parent => parent.id === worker.parentSessionId)?.name ?? worker.parentSessionId;
</script>

<template>
  <div v-if="workers.length || error" class="worker-panel">
    <button class="worker-trigger" type="button" aria-haspopup="dialog" :aria-label="`View ${parentAgentName}’s ${workers.length} subagents${waiting ? `, ${waiting} need input` : ''}`" @click="dialog?.showModal()"><span>{{ workers.length }} subagent{{ workers.length === 1 ? '' : 's' }}</span><span v-if="waiting" class="worker-alert">{{ waiting }} need input</span><span v-else-if="finished" class="worker-done">{{ finished }} finished</span><span class="worker-open-icon" aria-hidden="true">↗</span></button>
    <dialog ref="dialog" class="worker-dialog" :aria-labelledby="titleId">
      <div class="dialog-heading"><h2 :id="titleId">{{ parentAgentName }}’s subagents</h2><button class="icon-button" aria-label="Close subagents" @click="dialog?.close()">×</button></div>
      <p class="dialog-intro">{{ workers.length }} worker{{ workers.length === 1 ? '' : 's' }}. Use the parent terminal to inspect them or respond.</p>
      <p v-if="error" class="agent-detail">{{ error }}</p>
      <ul class="worker-list">
        <li v-for="worker in workers" :key="worker.id" :class="{ 'worker-nested': worker.parentSessionId !== parentSessionId, 'worker-waiting': browserConnected && worker.connection === 'connected' && worker.status === 'waiting', 'worker-finished': browserConnected && worker.connection === 'connected' && worker.status === 'finished' }">
          <div class="worker-heading"><strong>{{ worker.name }}</strong><span class="status-badge" :class="[worker.status, { 'worker-stale': worker.connection === 'disconnected' || !browserConnected }]">{{ worker.connection === 'disconnected' || !browserConnected ? 'Last known: ' : '' }}{{ label(worker) }}</span></div>
          <small class="worker-id">{{ worker.id }}</small>
          <small v-if="worker.parentSessionId !== parentSessionId">↳ Under {{ parentName(worker) }}</small>
          <p class="worker-task">{{ worker.task || 'Task details unavailable.' }}</p>
          <small>{{ worker.project }}{{ worker.model ? ` · ${worker.model}` : '' }}</small>
          <small :title="worker.detail || ''">{{ worker.connection === 'disconnected' || !browserConnected ? 'Disconnected · ' : '' }}{{ worker.lastSeen ? `Observed ${new Date(worker.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not observed yet' }}</small>
        </li>
      </ul>
      <div class="dialog-footer"><button class="primary" @click="dialog?.close()">Done</button></div>
    </dialog>
  </div>
</template>
