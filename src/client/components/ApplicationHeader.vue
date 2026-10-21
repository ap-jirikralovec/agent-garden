<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGardenStore } from '../stores/garden';
import GardenIcon from './GardenIcon.vue';
import SettingsDialog from './SettingsDialog.vue';
import ProjectsDialog from './ProjectsDialog.vue';
import ConnectionsDialog from './ConnectionsDialog.vue';
const emit = defineEmits<{ addAgent: [] }>();
const settings = ref<InstanceType<typeof SettingsDialog>>();
const projects = ref<InstanceType<typeof ProjectsDialog>>();
const { browserConnected, connectedCount, connectionsEnabled, monitorReady, loaded } =
  storeToRefs(useGardenStore());
const connections = ref<InstanceType<typeof ConnectionsDialog>>();
const connectionSummary = computed(() =>
  !browserConnected.value
    ? 'Dashboard offline'
    : !connectionsEnabled.value
      ? 'Connections paused'
      : `${connectedCount.value} connected`,
);
</script>

<template>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Agent Garden home">
      <span class="brand-mark" aria-hidden="true"><GardenIcon /></span>
      <span>agent<span class="brand-light">garden</span><small>LOCAL WORKSPACE</small></span>
    </a>
    <div class="header-actions">
      <button class="secondary" :disabled="!loaded" @click="settings?.open()">Settings</button>
      <button class="secondary" :disabled="!loaded || !browserConnected" @click="projects?.open()">
        Projects
      </button>
      <button class="primary" :disabled="!monitorReady" @click="emit('addAgent')">
        ＋ Add agent
      </button>
      <button
        type="button"
        :aria-label="`Manage connections: ${connectionSummary}`"
        :title="connectionSummary"
        aria-haspopup="dialog"
        class="connection-button"
        @click="connections?.open()"
      >
        <span
          class="dot"
          :class="browserConnected && connectedCount ? 'green' : 'amber'"
          aria-hidden="true"
        ></span>
      </button>
    </div>
  </header>
  <SettingsDialog ref="settings" />
  <ProjectsDialog ref="projects" />
  <ConnectionsDialog ref="connections" />
</template>

<style scoped lang="scss">
@use '../styles/tokens' as tokens;
.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  background: #ffffff;
  margin-top: 0.5rem;
  padding-block: 1.25rem;
  padding-inline: 0.75rem;
  margin-inline: -0.75rem;
  border-radius: 1.25rem;
  z-index: 10;
  gap: var(--space-3);
  position: sticky;
  top: 0.5rem;
}
.brand {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: 23px;
  font-weight: 720;
  letter-spacing: -1px;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  color: #fafbf5;
  background: var(--color-primary);
}
.brand-mark svg {
  width: 31px;
}
.brand-light {
  font-weight: 430;
  color: #74866e;
}
.brand small {
  display: block;
  font-size: 8px;
  letter-spacing: 2.2px;
  font-weight: 650;
  color: #828d7e;
  margin-top: var(--space-1);
}
.connection-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  background: transparent;
  border: 0;
  border-radius: var(--radius-control);
  padding: 0;
  cursor: pointer;
}
@include tokens.mobile {
  .topbar {
    flex-wrap: wrap;
    padding-block: var(--space-4);
  }
  .brand {
    font-size: 20px;
  }
  .brand-mark {
    width: 40px;
    height: 40px;
  }
}
.connection-button .dot {
  width: 8px;
  height: 8px;
}
.connection-button .dot.green {
  animation: connection-pulse 2.4s ease-out infinite;
}
@keyframes connection-pulse {
  0% {
    box-shadow: 0 0 0 0 #83a67066;
  }
  75%,
  100% {
    box-shadow: 0 0 0 8px #83a67000;
  }
}
@media (prefers-reduced-motion: reduce) {
  .connection-button .dot {
    animation: none;
  }
}
.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
@include tokens.mobile {
  .header-actions {
    gap: 7px;
    flex-wrap: wrap;
  }
  .header-actions > .primary,
  .header-actions > .secondary {
    padding: 9px 11px;
    font-size: 12px;
  }
}
</style>
