<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { gardenApi } from '../api';
import { useGardenStore } from '../stores/garden';
import type { WorkPresetCatalog, WorkPresetFile, WorkPresetInput } from '../../shared/work';

const { browserConnected } = storeToRefs(useGardenStore());
const dialog = ref<HTMLDialogElement>();
const heading = ref<HTMLHeadingElement>();
const nameInput = ref<HTMLInputElement>();
const busy = ref(false);
const error = ref('');
const notice = ref('');
const catalog = ref<WorkPresetCatalog>({ directory: '', files: [], truncated: false });
const editing = ref(false);
const current = ref<WorkPresetFile | null>(null);
const deleting = ref<WorkPresetFile | null>(null);
const discardTarget = ref<'list' | 'close' | null>(null);
const emptyForm = (): WorkPresetInput => ({
  name: '',
  author: '',
  description: '',
  parameters: [],
  prompt: '',
});
const form = ref<WorkPresetInput>(emptyForm());
const baseline = ref('');
const dirty = computed(() => editing.value && JSON.stringify(form.value) !== baseline.value);

async function load() {
  busy.value = true;
  error.value = '';
  try {
    catalog.value = await gardenApi.workCatalog(AbortSignal.timeout(10000));
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
async function open() {
  editing.value = false;
  current.value = null;
  deleting.value = null;
  discardTarget.value = null;
  notice.value = '';
  error.value = '';
  dialog.value?.showModal();
  await load();
  await nextTick();
  heading.value?.focus();
}
async function edit(file: WorkPresetFile | null = null) {
  current.value = file;
  const preset = file?.preset;
  form.value = preset
    ? {
        name: preset.name,
        author: preset.author,
        description: preset.description,
        parameters: preset.parameters.map((parameter) => ({ ...parameter })),
        prompt: preset.prompt,
      }
    : emptyForm();
  baseline.value = JSON.stringify(form.value);
  editing.value = true;
  deleting.value = null;
  error.value = '';
  notice.value = '';
  await nextTick();
  nameInput.value?.focus();
}
function close() {
  if (busy.value) return;
  if (dirty.value) {
    discardTarget.value = 'close';
    return;
  }
  dialog.value?.close();
}
async function back() {
  if (dirty.value) {
    discardTarget.value = 'list';
    return;
  }
  editing.value = false;
  current.value = null;
  await load();
  await nextTick();
  heading.value?.focus();
}
async function keepEditing() {
  discardTarget.value = null;
  await nextTick();
  nameInput.value?.focus();
}
async function cancelDelete() {
  deleting.value = null;
  await nextTick();
  heading.value?.focus();
}
async function discard() {
  const target = discardTarget.value;
  discardTarget.value = null;
  editing.value = false;
  current.value = null;
  if (target === 'close') dialog.value?.close();
  else {
    await load();
    await nextTick();
    heading.value?.focus();
  }
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (current.value) {
      if (!current.value.revision)
        throw new Error('This file cannot be updated. Check it in the local work folder.');
      await gardenApi.updateWork(current.value.id, current.value.revision, form.value);
    } else await gardenApi.createWork(form.value);
    editing.value = false;
    current.value = null;
    notice.value = 'Preset saved. It is available the next time you create an agent.';
    await load();
    await nextTick();
    heading.value?.focus();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
async function confirmDelete(file: WorkPresetFile) {
  deleting.value = file;
  notice.value = '';
  error.value = '';
  await nextTick();
  heading.value?.focus();
}
async function remove() {
  const file = deleting.value;
  if (busy.value || !file?.revision) return;
  busy.value = true;
  error.value = '';
  try {
    await gardenApi.deleteWork(file.id, file.revision);
    deleting.value = null;
    notice.value = 'Preset moved to the work folder’s .trash directory.';
    await load();
    await nextTick();
    heading.value?.focus();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" aria-labelledby="work-manager-title" @cancel.prevent="close">
    <div class="dialog-heading">
      <h2 id="work-manager-title" ref="heading" tabindex="-1">
        {{
          deleting
            ? 'Delete preset?'
            : editing
              ? current
                ? 'Edit work preset'
                : 'Create work preset'
              : 'Work presets'
        }}
      </h2>
      <button
        class="icon-button"
        type="button"
        aria-label="Close work presets"
        :disabled="busy"
        @click="close"
      >
        ×
      </button>
    </div>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div
      v-if="discardTarget"
      class="discard-confirmation"
      role="group"
      aria-label="Discard unsaved changes"
    >
      <p>You have unsaved changes. Discard them?</p>
      <div class="actions">
        <button class="secondary" type="button" @click="keepEditing">Keep editing</button>
        <button class="secondary" type="button" @click="discard">Discard changes</button>
      </div>
    </div>
    <template v-else-if="deleting">
      <p class="dialog-intro">
        Delete <strong>{{ deleting.preset?.name ?? deleting.id }}</strong
        >?
      </p>
      <p class="dialog-note">
        Moves this YAML file to <code>work/.trash</code>. Existing agents are unaffected. You can
        recover it by moving the file back.
      </p>
      <p class="file-path">{{ deleting.id }}</p>
      <div class="dialog-footer">
        <button class="secondary" type="button" :disabled="busy" @click="cancelDelete">
          Cancel
        </button>
        <button
          class="secondary delete-button"
          type="button"
          :disabled="busy || !browserConnected"
          @click="remove"
        >
          {{ busy ? 'Deleting…' : 'Delete preset' }}
        </button>
      </div>
    </template>
    <form v-else-if="editing" @submit.prevent="save">
      <p v-if="current?.error" class="dialog-note">
        This file is broken: {{ current.error }} Complete this form to replace it with a valid
        preset.
      </p>
      <label class="form-label" for="preset-name"
        >Name<input
          id="preset-name"
          ref="nameInput"
          v-model="form.name"
          required
          maxlength="120"
          :disabled="busy"
          autocomplete="off"
      /></label>
      <label class="form-label" for="preset-author"
        >Author<input
          id="preset-author"
          v-model="form.author"
          required
          maxlength="120"
          :disabled="busy"
          autocomplete="off"
      /></label>
      <label class="form-label" for="preset-description"
        >Description<textarea
          id="preset-description"
          v-model="form.description"
          required
          maxlength="2000"
          rows="2"
          :disabled="busy"
        />
      </label>
      <fieldset :disabled="busy" class="parameters">
        <legend>
          Parameters <span>({{ form.parameters.length }}/32)</span>
        </legend>
        <p class="hint">
          Defaults are editable when starting Work. Leave a default blank to require a value.
        </p>
        <div v-for="(parameter, index) in form.parameters" :key="index" class="parameter-row">
          <label class="form-label" :for="`preset-key-${index}`"
            >Parameter name<input
              :id="`preset-key-${index}`"
              v-model="parameter.key"
              required
              maxlength="80"
              placeholder="e.g. pull_request"
              autocomplete="off"
          /></label>
          <label class="form-label" :for="`preset-default-${index}`"
            >Default value<textarea
              :id="`preset-default-${index}`"
              v-model="parameter.value"
              maxlength="4000"
              rows="2"
            />
          </label>
          <button
            class="icon-button"
            type="button"
            :aria-label="`Remove parameter ${parameter.key || index + 1}`"
            @click="form.parameters.splice(index, 1)"
          >
            ×
          </button>
        </div>
        <button
          class="secondary"
          type="button"
          :disabled="form.parameters.length >= 32"
          @click="form.parameters.push({ key: '', value: '' })"
        >
          ＋ Add parameter
        </button>
      </fieldset>
      <label class="form-label" for="preset-prompt"
        >Prompt<textarea
          id="preset-prompt"
          v-model="form.prompt"
          required
          maxlength="16000"
          rows="8"
          :disabled="busy"
          aria-describedby="preset-prompt-help"
        />
      </label>
      <p id="preset-prompt-help" class="hint">
        Reference parameters with double braces, for example <code v-pre>{{ pull_request }}</code
        >. All placeholders must match a declared parameter.
      </p>
      <p class="hint save-hint">
        Saves a local YAML file from these fields. Saving rewrites its formatting and comments.
      </p>
      <div class="dialog-footer">
        <button class="secondary" type="button" :disabled="busy" @click="back">Back</button>
        <button class="primary" type="submit" :disabled="busy || !browserConnected">
          {{ busy ? 'Saving…' : current?.error ? 'Replace broken preset' : 'Save preset' }}
        </button>
      </div>
    </form>
    <template v-else>
      <p class="dialog-intro">
        Create and manage reusable prompts. Presets stay in your local YAML files.
      </p>
      <div class="actions">
        <button class="primary" type="button" :disabled="busy || !browserConnected" @click="edit()">
          ＋ Create preset
        </button>
        <button class="secondary" type="button" :disabled="busy || !browserConnected" @click="load">
          Reload list
        </button>
      </div>
      <p class="file-path">{{ catalog.directory }}</p>
      <p v-if="busy" role="status" class="hint">Loading presets…</p>
      <p v-else-if="!catalog.files.length" class="hint">
        No presets yet. Create one to use it when starting an agent.
      </p>
      <p v-if="catalog.truncated" class="dialog-note">
        Showing the first 100 preset files. Remove or move files to reveal the rest.
      </p>
      <ul class="preset-list">
        <li v-for="file in catalog.files" :key="file.id">
          <strong>{{ file.preset?.name ?? file.id }}</strong>
          <p v-if="file.preset" class="hint">
            By {{ file.preset.author }} · {{ file.preset.parameters.length }} parameters
          </p>
          <p v-if="file.preset" class="preset-description">{{ file.preset.description }}</p>
          <p v-if="file.error" class="file-error">
            Broken preset: {{ file.error }} It is hidden from agent creation.
          </p>
          <p v-if="!file.revision" class="hint">
            This file cannot be read safely. Check its size and permissions in the local work
            folder.
          </p>
          <p class="file-path">{{ file.id }}</p>
          <div class="actions">
            <button
              class="secondary"
              type="button"
              :aria-label="`${file.error ? 'Replace' : 'Edit'} ${file.preset?.name ?? file.id}`"
              :disabled="busy || !browserConnected || !file.revision"
              @click="edit(file)"
            >
              {{ file.error ? 'Replace' : 'Edit' }}
            </button>
            <button
              class="secondary delete-button"
              type="button"
              :aria-label="`Delete ${file.preset?.name ?? file.id}`"
              :disabled="busy || !browserConnected || !file.revision"
              @click="confirmDelete(file)"
            >
              Delete
            </button>
          </div>
        </li>
      </ul>
      <div class="dialog-footer">
        <button class="primary" type="button" :disabled="busy" @click="close">Done</button>
      </div>
    </template>
  </dialog>
</template>

<style scoped lang="scss">
@use '../styles/tokens' as tokens;
dialog {
  width: min(820px, calc(100% - 32px));
  overflow-y: auto;
}
textarea {
  width: 100%;
  resize: vertical;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.6;
}
textarea:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.hint,
.file-path,
.preset-description,
.file-error,
.notice {
  font-size: 12px;
  line-height: 1.7;
}
.hint,
.file-path {
  color: var(--color-muted);
}
.file-path {
  margin: var(--space-3) 0;
  overflow-wrap: anywhere;
}
.file-error,
.delete-button {
  color: var(--color-danger);
}
.notice,
.discard-confirmation {
  margin-bottom: var(--space-4);
  padding: var(--space-3);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
}
.discard-confirmation p {
  font-size: 13px;
  margin-bottom: var(--space-3);
}
.preset-list {
  list-style: none;
  padding: 0;
  margin: var(--space-5) 0 0;
  display: grid;
  gap: var(--space-3);
  li {
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
  }
  strong {
    font-size: 14px;
  }
}
.preset-description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: var(--space-2);
}
.parameters {
  border: 0;
  padding: 0;
  margin: 0 0 var(--space-5);
  min-width: 0;
  legend {
    font-size: 13px;
    font-weight: 550;
    margin-bottom: var(--space-2);
  }
  span {
    color: var(--color-muted);
    font-weight: 400;
  }
}
.parameter-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
  align-items: start;
  gap: var(--space-3);
  margin-top: var(--space-4);
  .icon-button {
    margin-top: var(--space-6);
  }
}
.save-hint {
  margin-top: var(--space-3);
}
@include tokens.mobile {
  .parameter-row {
    grid-template-columns: minmax(0, 1fr) auto;
    .form-label:nth-child(2) {
      grid-column: 1;
    }
    .icon-button {
      grid-column: 2;
      grid-row: 1;
    }
  }
}
</style>
