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
const openTerminal = ref(true);
const startMode = ref<'empty' | 'prompt'>('empty');
const promptExpanded = computed(() => startMode.value === 'prompt');
const promptInput = ref<HTMLTextAreaElement>();
const formError = ref('');
const form = ref({
  provider: '' as ProviderId | '',
  name: '',
  initialPrompt: '',
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
  startMode.value = 'empty';
  openTerminal.value = true;
  form.value = {
    provider: readyProviders.value[0]?.id ?? '',
    name: '',
    initialPrompt: '',
    project: project ?? state.value.projects[0]?.path ?? '',
    model: '',
    reasoning: null,
  };
  selectProvider();
  dialog.value?.showModal();
  await nextTick();
  nameInput.value?.focus();
}

async function selectStartMode() {
  if (promptExpanded.value) {
    await nextTick();
    promptInput.value?.focus();
  }
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
      openTerminal: !promptExpanded.value || form.value.provider !== 'codex' || openTerminal.value,
      initialPrompt:
        promptExpanded.value && provider.id === 'codex' ? form.value.initialPrompt : undefined,
    });
    dialog.value?.close();
    store.notify(
      result.warning ||
        (promptExpanded.value && form.value.initialPrompt.trim()
          ? openTerminal.value
            ? `${result.agent.name} is ready. Your initial prompt was passed to the terminal.`
            : `${result.agent.name} is ready. Its initial task was submitted without opening a terminal.`
          : `${result.agent.name} is ready. Write your first task in the terminal.`),
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
    :class="{ 'with-prompt': promptExpanded && form.provider === 'codex' }"
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
      <p class="dialog-intro">Choose its setup and optionally add its first task.</p>
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
      <div v-if="form.provider === 'codex'" class="initial-prompt">
        <label class="form-label" for="agent-start-mode">
          How would you like to start:
          <select
            id="agent-start-mode"
            v-model="startMode"
            :disabled="creating || picking"
            @change="selectStartMode"
          >
            <option value="empty">Empty shell</option>
            <option value="prompt">Prompt</option>
          </select>
        </label>
        <div v-if="promptExpanded" id="initial-prompt-editor" class="prompt-editor">
          <label class="form-label" for="agent-prompt">
            Initial prompt
            <span class="optional">{{ openTerminal ? 'Optional' : 'Required' }}</span>
            <textarea
              id="agent-prompt"
              ref="promptInput"
              v-model="form.initialPrompt"
              :required="!openTerminal"
              rows="8"
              maxlength="16000"
              placeholder="What would you like this agent to work on?"
              aria-describedby="agent-prompt-help"
              :disabled="creating || picking"
            />
          </label>
          <p id="agent-prompt-help">
            Starts the first task after creation. You’ll handle conversation and approvals in the
            terminal. Up to 16,000 characters.
          </p>
          <label class="terminal-option">
            <input v-model="openTerminal" type="checkbox" :disabled="creating || picking" />
            Open terminal after creation
          </label>
          <p v-if="!openTerminal">
            The agent starts without a terminal window. If it needs input or approval, use Open
            terminal on its card.
          </p>
        </div>
      </div>
      <p class="dialog-note">
        {{
          promptExpanded && !openTerminal
            ? 'Starts the saved session without opening a terminal.'
            : '↗ Opens the saved session in your terminal.'
        }}
        {{ selectedProvider?.name }} keeps your existing permissions and sign-in settings.
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
          :disabled="
            creating ||
            picking ||
            !selectedReady ||
            !form.project ||
            (promptExpanded && !openTerminal && !form.initialPrompt.trim())
          "
        >
          {{
            creating
              ? 'Creating session…'
              : promptExpanded && !openTerminal
                ? 'Create & start agent'
                : 'Create & open terminal'
          }}
          <span v-if="!creating && (!promptExpanded || openTerminal)" aria-hidden="true">↗</span>
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
@use '../styles/tokens' as tokens;

dialog {
  transition: width 200ms ease;
}
dialog.with-prompt {
  width: min(820px, calc(100% - 32px));
}
.initial-prompt {
  margin-bottom: var(--space-5);
}
.prompt-editor {
  margin-top: var(--space-4);
}
.prompt-editor .form-label {
  display: block;
  margin-bottom: var(--space-2);
}
.terminal-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4) 0 var(--space-2);
  font-size: 12px;
  line-height: 1.6;
}
.terminal-option input {
  accent-color: var(--color-primary);
}
.optional {
  color: var(--color-muted);
  font-weight: 400;
  margin-left: var(--space-2);
}
textarea {
  display: block;
  width: 100%;
  min-height: 180px;
  margin-top: var(--space-2);
  padding: var(--space-3);
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-weight: 400;
  font-size: 14px;
  line-height: 1.6;
}
textarea:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}
textarea::placeholder {
  color: var(--color-muted);
}
.prompt-editor p {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}
@include tokens.mobile {
  .form-columns {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}

.add-project {
  margin: -5px 0 var(--space-5);
}
</style>
