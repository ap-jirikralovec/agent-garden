<script setup lang="ts">
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { ProviderSnapshot } from '../../shared/types';
import { useGardenStore } from '../stores/garden';
import { gardenApi } from '../api';
import ProviderLogo from './ProviderLogo.vue';
const store = useGardenStore();
const { snapshot: state, browserConnected } = storeToRefs(store);
const settingsDialog = ref<HTMLDialogElement>();
const settingsBusy = ref('');
const settingsError = ref('');
function open() {
  settingsError.value = '';
  settingsDialog.value?.showModal();
}
async function toggleConnection(provider: ProviderSnapshot, event: Event) {
  if (!provider.available) return;
  const input = event.target as HTMLInputElement;
  settingsBusy.value = provider.id;
  settingsError.value = '';
  try {
    store.receiveSnapshot(await gardenApi.setProvider(provider.id, input.checked));
  } catch (error) {
    settingsError.value = (error as Error).message;
    input.checked = store.providerEnabled(provider.id);
  } finally {
    settingsBusy.value = '';
  }
}
defineExpose({ open });
</script>

<template>
  <dialog
    ref="settingsDialog"
    aria-labelledby="settings-title"
    @cancel="settingsBusy && $event.preventDefault()"
  >
    <div class="dialog-heading">
      <h2 id="settings-title">Connections</h2>
      <button
        class="icon-button"
        aria-label="Close settings"
        :disabled="!!settingsBusy"
        @click="settingsDialog?.close()"
      >
        ×
      </button>
    </div>
    <p class="dialog-intro">
      Choose which agent providers Garden connects to. Turning a connection off keeps your cards and
      leaves running agents alone.
    </p>
    <div class="connection-settings">
      <div v-for="provider in state.providers" :key="provider.id" class="connection-setting">
        <div>
          <strong :id="`provider-${provider.id}`" class="connection-provider"
            ><ProviderLogo :provider="provider.id" />{{ provider.name }}</strong
          >
          <p :id="`provider-status-${provider.id}`">
            {{
              !provider.available
                ? 'Off · Unavailable'
                : settingsBusy === provider.id
                  ? 'Updating…'
                  : !provider.enabled
                    ? 'Off'
                    : provider.connection === 'connected'
                      ? 'Connected'
                      : 'Connecting…'
            }}
          </p>
        </div>
        <label class="connection-switch" :class="{ unavailable: !provider.available }"
          ><input
            type="checkbox"
            role="switch"
            :aria-labelledby="`provider-${provider.id}`"
            :aria-describedby="`provider-status-${provider.id}`"
            :checked="provider.available && provider.enabled"
            :disabled="!provider.available || !!settingsBusy || !browserConnected"
            @change="toggleConnection(provider, $event)" /><span aria-hidden="true"></span
        ></label>
        <p v-if="provider.enabled && provider.error" class="connection-setting-error">
          {{ provider.error }}
        </p>
      </div>
    </div>
    <p v-if="settingsError" class="form-error" role="alert">{{ settingsError }}</p>
    <div class="dialog-footer">
      <button class="primary" :disabled="!!settingsBusy" @click="settingsDialog?.close()">
        Done
      </button>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
@use '../styles/tokens' as tokens;
.connection-settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.connection-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
}
.connection-setting strong {
  font-size: 14px;
  font-weight: 600;
}
.connection-setting p {
  font-size: 11px;
  color: var(--color-muted);
  margin-top: 5px;
  line-height: 1.6;
}
.connection-setting .connection-setting-error {
  flex-basis: 100%;
  color: var(--color-danger);
  overflow-wrap: anywhere;
}
.connection-provider {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.connection-provider .provider-logo {
  width: 24px;
  height: 24px;
}
</style>
