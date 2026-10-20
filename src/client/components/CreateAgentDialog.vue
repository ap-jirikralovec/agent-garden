<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { ProviderId } from '../../shared/types';
import { useGardenStore } from '../stores/garden';
import { gardenApi } from '../api';
const emit = defineEmits<{ created: [] }>();
const store = useGardenStore();
const { snapshot: state, readyProviders, browserConnected } = storeToRefs(store);
const dialog = ref<HTMLDialogElement>();
const nameInput = ref<HTMLInputElement>();
const creating = ref(false);
const formError = ref('');
const form = ref({
  provider: '' as ProviderId | '',
  name: '',
  project: '',
  model: '',
  reasoning: null as string | null,
});
const picking = ref(false);
const selectedProvider = computed(() =>
  state.value.providers.find((provider) => provider.id === form.value.provider),
);
const selectedModel = computed(() =>
  selectedProvider.value?.configuration?.models.find((model) => model.id === form.value.model),
);
const selectedReady = computed(
  () =>
    browserConnected.value &&
    readyProviders.value.some((provider) => provider.id === form.value.provider),
);
function selectModel() {
  form.value.reasoning = selectedModel.value?.defaultReasoning ?? null;
}
function selectProvider() {
  const config = selectedProvider.value?.configuration;
  form.value.model = config?.defaultModel || config?.models[0]?.id || '';
  selectModel();
}

async function addProject() {
  if (picking.value || creating.value) return;
  picking.value = true;
  formError.value = '';
  try {
    const result = await gardenApi.pickProject();
    store.receiveSnapshot(result.snapshot);
    if (result.project) form.value.project = result.project.path;
  } catch (error) {
    formError.value = (error as Error).message;
  } finally {
    picking.value = false;
  }
}

async function open(project?: string) {
  formError.value = '';
  form.value = {
    provider: readyProviders.value[0]?.id ?? '',
    name: '',
    project: project ?? state.value.projects[0]?.path ?? '',
    model: '',
    reasoning: null,
  };
  selectProvider();
  dialog.value?.showModal();
  await nextTick();
  nameInput.value?.focus();
}

async function createAgent() {
  const provider = selectedProvider.value;
  if (creating.value || picking.value || !selectedReady.value || !provider) return;
  creating.value = true;
  formError.value = '';
  try {
    if (!state.value.projects.some((project) => project.path === form.value.project)) {
      formError.value = 'Choose a saved project first.';
      return;
    }
    const result = await gardenApi.createAgent({
      ...form.value,
      provider: provider.id,
    });
    dialog.value?.close();
    store.notify(
      result.warning || `${result.agent.name} is ready. Write your first task in the terminal.`,
    );
    emit('created');
  } catch (error) {
    formError.value = (error as Error).message;
  } finally {
    creating.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="dialog-title"
    @cancel="(creating || picking) && $event.preventDefault()"
  >
    <form @submit.prevent="createAgent">
      <div class="dialog-heading">
        <span class="dialog-icon" aria-hidden="true">＋</span
        ><button
          class="icon-button"
          type="button"
          aria-label="Close dialog"
          :disabled="creating || picking"
          @click="dialog?.close()"
        >
          ×
        </button>
      </div>
      <h2 id="dialog-title">A new agent, a fresh start.</h2>
      <p class="dialog-intro">Choose its setup. Your first task starts in the terminal.</p>
      <label class="form-label" for="agent-provider"
        >Agent type<select
          id="agent-provider"
          v-model="form.provider"
          :disabled="creating || picking"
          @change="selectProvider"
        >
          <option v-for="provider in readyProviders" :key="provider.id" :value="provider.id">
            {{ provider.name }}
          </option>
        </select></label
      >
      <label class="form-label" for="agent-name"
        >Name<input
          id="agent-name"
          ref="nameInput"
          v-model="form.name"
          required
          maxlength="60"
          placeholder="e.g. Miso"
          :disabled="creating || picking"
          autocomplete="off"
      /></label>
      <label class="form-label" for="agent-project"
        >Project
        <select id="agent-project" v-model="form.project" required :disabled="creating || picking">
          <option disabled value="">Choose a project</option>
          <option v-for="project in state.projects" :key="project.path" :value="project.path">
            {{ project.name }} — {{ project.path }}
          </option>
        </select>
      </label>
      <button
        class="secondary add-project"
        type="button"
        :disabled="creating || picking || !browserConnected"
        @click="addProject"
      >
        {{ picking ? 'Choose a project folder…' : '＋ Add project' }}
      </button>
      <div class="form-columns">
        <label class="form-label" for="agent-model"
          >Model<select
            id="agent-model"
            v-model="form.model"
            required
            :disabled="creating || picking"
            @change="selectModel"
          >
            <option
              v-for="model in selectedProvider?.configuration?.models"
              :key="model.id"
              :value="model.id"
            >
              {{ model.name }}
            </option>
          </select></label
        >
        <label v-if="selectedModel?.reasoningLevels.length" class="form-label" for="agent-reasoning"
          >Reasoning<select
            id="agent-reasoning"
            v-model="form.reasoning"
            required
            :disabled="creating || picking"
          >
            <option
              v-for="effort in selectedModel?.reasoningLevels"
              :key="effort.id"
              :value="effort.id"
            >
              {{ effort.name }}
            </option>
          </select></label
        >
      </div>
      <p class="dialog-note">
        ↗ Opens the saved session in your terminal. {{ selectedProvider?.name }} keeps your existing
        permissions and sign-in settings.
      </p>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <div class="dialog-footer">
        <button
          class="secondary"
          type="button"
          :disabled="creating || picking"
          @click="dialog?.close()"
        >
          Cancel</button
        ><button
          class="primary"
          type="submit"
          :disabled="creating || picking || !selectedReady || !form.project"
        >
          {{ creating ? 'Creating session…' : 'Create & open terminal' }}
          <span v-if="!creating" aria-hidden="true">↗</span>
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
.add-project {
  margin: -5px 0 var(--space-5);
}
</style>
