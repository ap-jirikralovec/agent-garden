<script setup lang="ts">
import { ref } from 'vue';
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
        aria-label="Manage connections"
        class="local-tag"
        @click="connections?.open()"
      >
        <span class="dot" :class="browserConnected && connectedCount ? 'green' : 'amber'"></span
        >{{
          !browserConnected
            ? 'Dashboard offline'
            : !connectionsEnabled
              ? 'Connections paused'
              : `${connectedCount} connected`
        }}
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
.local-tag {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  color: #63725f;
  background: #edf1e7;
  border: 1px solid #e0e7d6;
  border-radius: 30px;
  padding: 9px 13px;
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
  .local-tag {
    font-size: 0;
    padding: 9px;
  }
  .local-tag .dot {
    width: 7px;
    height: 7px;
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
  .header-actions .local-tag {
    display: flex;
  }
}
</style>
