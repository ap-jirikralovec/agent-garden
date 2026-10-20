<script setup lang="ts">
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { gardenApi } from '../api';
import { useGardenStore } from '../stores/garden';
const store = useGardenStore();
const { snapshot, browserConnected } = storeToRefs(store);
const dialog = ref<HTMLDialogElement>();
const busy = ref(false);
const error = ref('');
function open() {
  error.value = '';
  dialog.value?.showModal();
}
async function toggle(event: Event) {
  const input = event.target as HTMLInputElement;
  busy.value = true;
  error.value = '';
  try {
    store.receiveSnapshot(await gardenApi.setShowExternalAgents(input.checked));
  } catch (cause) {
    error.value = (cause as Error).message;
    input.checked = snapshot.value.settings.showExternalAgents;
  } finally {
    busy.value = false;
  }
}
defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="garden-settings-title"
    @cancel="busy && $event.preventDefault()"
  >
    <div class="dialog-heading">
      <h2 id="garden-settings-title">Settings</h2>
      <button
        class="icon-button"
        aria-label="Close settings"
        :disabled="busy"
        @click="dialog?.close()"
      >
        ×
      </button>
    </div>
    <div class="visibility-setting">
      <div>
        <strong id="external-agents-label">Show external agents</strong>
        <p id="external-agents-hint">
          Show agents created outside Garden in your dashboard, counts and search. This setting
          applies to every Garden window.
        </p>
      </div>
      <label class="connection-switch">
        <input
          type="checkbox"
          role="switch"
          aria-labelledby="external-agents-label"
          aria-describedby="external-agents-hint"
          :checked="snapshot.settings.showExternalAgents"
          :disabled="busy || !browserConnected"
          @change="toggle"
        />
        <span aria-hidden="true"></span>
      </label>
    </div>
    <p class="dialog-note">
      Garden automatically discovers open Codex sessions in saved project folders, even when they
      are hidden. Discovered agents stay tracked after closing. Hidden agents still count toward
      project-removal rules.
    </p>
    <p
      v-for="provider in snapshot.providers.filter((provider) => provider.discoveryError)"
      :key="provider.id"
      class="form-error"
      role="status"
    >
      {{ provider.name }} discovery: {{ provider.discoveryError }}
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="dialog-footer">
      <button class="primary" :disabled="busy" @click="dialog?.close()">Done</button>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
.visibility-setting {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding-bottom: var(--space-5);
}
.visibility-setting > div {
  flex: 1;
  min-width: 0;
}
.visibility-setting strong {
  font-size: 14px;
}
.visibility-setting p {
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-muted);
  margin-top: var(--space-2);
}
</style>
