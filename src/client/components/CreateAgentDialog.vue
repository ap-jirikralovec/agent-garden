<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type { ProjectCheck, ProviderId } from '../../shared/types';
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
  createProject: false,
});
const projectStatus = ref<'unchecked' | 'checking' | 'exists' | 'missing' | 'error'>('unchecked');
const projectError = ref('');
let projectCheckVersion = 0;
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

watch(
  () => form.value.project,
  () => {
    // Consent and in-flight checks belong to the exact path the user entered.
    projectCheckVersion++;
    projectStatus.value = 'unchecked';
    projectError.value = '';
    form.value.createProject = false;
    formError.value = '';
  },
  { flush: 'sync' },
);

async function checkProject(): Promise<ProjectCheck | null> {
  const project = form.value.project;
  const version = ++projectCheckVersion;
  if (!project.trim()) {
    projectStatus.value = 'unchecked';
    return null;
  }
  projectStatus.value = 'checking';
  projectError.value = '';
  try {
    const result = await gardenApi.checkProject(project);
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

async function open() {
  formError.value = '';
  projectCheckVersion++;
  projectStatus.value = 'unchecked';
  projectError.value = '';
  form.value = {
    provider: readyProviders.value[0]?.id ?? '',
    name: '',
    project: state.value.projectSuggestion,
    model: '',
    reasoning: null,
    createProject: false,
  };
  selectProvider();
  dialog.value?.showModal();
  await nextTick();
  nameInput.value?.focus();
}

async function createAgent() {
  const provider = selectedProvider.value;
  if (creating.value || !selectedReady.value || !provider) return;
  creating.value = true;
  formError.value = '';
  try {
    const project = await checkProject();
    if (!project) return;
    if (!project.exists && !form.value.createProject) {
      formError.value = 'Confirm creation of the new folder before continuing.';
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
  <dialog ref="dialog" aria-labelledby="dialog-title" @cancel="creating && $event.preventDefault()">
    <form @submit.prevent="createAgent">
      <div class="dialog-heading">
        <span class="dialog-icon" aria-hidden="true">＋</span
        ><button
          class="icon-button"
          type="button"
          aria-label="Close dialog"
          :disabled="creating"
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
          :disabled="creating"
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
          :disabled="creating"
          autocomplete="off"
      /></label>
      <label class="form-label" for="agent-project"
        >Project folder<input
          id="agent-project"
          v-model="form.project"
          required
          maxlength="4096"
          placeholder="/Users/you/projects/my-app"
          :disabled="creating"
          spellcheck="false"
          aria-describedby="project-hint project-feedback"
          :aria-invalid="projectStatus === 'error' ? true : undefined"
          @blur="!creating && checkProject()"
        /><small id="project-hint">Use an absolute path or ~/projects/my-app.</small></label
      >
      <div id="project-feedback" class="project-feedback" aria-live="polite">
        <p v-if="projectStatus === 'checking'">Checking folder…</p>
        <p v-else-if="projectStatus === 'exists'">Folder exists.</p>
        <p v-else-if="projectStatus === 'error'" class="project-error">{{ projectError }}</p>
        <template v-else-if="projectStatus === 'missing'">
          <p>This folder does not exist yet.</p>
          <label class="folder-confirm"
            ><input v-model="form.createProject" type="checkbox" :disabled="creating" />Confirm
            creation of new folder</label
          >
          <small
            >Missing parent folders will also be created when you choose Create &amp; open
            terminal.</small
          >
        </template>
      </div>
      <div class="form-columns">
        <label class="form-label" for="agent-model"
          >Model<select
            id="agent-model"
            v-model="form.model"
            required
            :disabled="creating"
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
            :disabled="creating"
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
        <button class="secondary" type="button" :disabled="creating" @click="dialog?.close()">
          Cancel</button
        ><button
          class="primary"
          type="submit"
          :disabled="
            creating || !selectedReady || (projectStatus === 'missing' && !form.createProject)
          "
        >
          {{ creating ? 'Creating session…' : 'Create & open terminal' }}
          <span v-if="!creating" aria-hidden="true">↗</span>
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
@use '../styles/tokens' as tokens;

.project-feedback:not(:empty) {
  margin: -9px 0 19px;
  color: #63725f;
  font-size: 11px;
  line-height: 1.6;
}
.project-feedback .project-error {
  color: var(--color-danger);
}
.folder-confirm {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 10px;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}
.folder-confirm input {
  width: 16px;
  height: 16px;
  margin: 0;
  flex-shrink: 0;
  accent-color: var(--color-primary);
}
.project-feedback small {
  display: block;
  color: var(--color-muted);
  font-size: 10px;
  margin-top: 6px;
}
</style>
