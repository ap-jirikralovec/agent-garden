<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGardenStore } from '../stores/garden';
import { gardenApi } from '../api';
import type { Project } from '../../shared/types';
const store = useGardenStore();
const { snapshot, browserConnected } = storeToRefs(store);
const dialog = ref<HTMLDialogElement>();
const busy = ref(false);
const picking = ref(false);
const error = ref('');
const editing = ref('');
const name = ref('');
function open() {
  error.value = '';
  editing.value = '';
  dialog.value?.showModal();
}
async function beginRename(project: Project) {
  editing.value = project.path;
  name.value = project.name;
  error.value = '';
  await nextTick();
  dialog.value?.querySelector<HTMLInputElement>('input')?.select();
}
async function add() {
  if (busy.value) return;
  busy.value = picking.value = true;
  error.value = '';
  try {
    const result = await gardenApi.pickProject();
    store.receiveSnapshot(result.snapshot);
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = picking.value = false;
  }
}
async function save(path: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    store.receiveSnapshot(await gardenApi.renameProject(path, name.value));
    editing.value = '';
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
async function remove(path: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    store.receiveSnapshot(await gardenApi.removeProject(path));
    if (editing.value === path) editing.value = '';
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
function agentCount(path: string) {
  return snapshot.value.projects.find((project) => project.path === path)?.agentCount ?? 0;
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" aria-labelledby="projects-title" @cancel="busy && $event.preventDefault()">
    <div class="dialog-heading">
      <span class="dialog-icon" aria-hidden="true">▱</span>
      <button
        class="icon-button"
        aria-label="Close projects"
        :disabled="busy"
        @click="dialog?.close()"
      >
        ×
      </button>
    </div>
    <h2 id="projects-title">Your projects.</h2>
    <p class="dialog-intro">A home for your ideas, with or without agents.</p>
    <button class="secondary add-project" :disabled="busy || !browserConnected" @click="add">
      {{ picking ? 'Choose a folder on your Mac…' : '＋ Add project' }}
    </button>
    <p class="picker-hint">Select a folder, or use New Folder in the picker to create one.</p>
    <p v-if="!snapshot.projects.length" class="no-projects">No saved projects yet.</p>
    <ul v-else class="projects-list">
      <li v-for="project in snapshot.projects" :key="project.path">
        <form
          v-if="editing === project.path"
          class="rename-form"
          @submit.prevent="save(project.path)"
        >
          <label class="form-label" :for="`project-name-${snapshot.projects.indexOf(project)}`"
            >Display name
            <input
              :id="`project-name-${snapshot.projects.indexOf(project)}`"
              v-model="name"
              required
              maxlength="60"
              :disabled="busy"
            />
          </label>
          <div class="project-actions">
            <button class="secondary" type="button" :disabled="busy" @click="editing = ''">
              Cancel
            </button>
            <button class="primary" type="submit" :disabled="busy || !browserConnected">
              Save
            </button>
          </div>
        </form>
        <template v-else>
          <strong>{{ project.name }}</strong>
          <p class="project-path">{{ project.path }}</p>
          <div class="project-bottom">
            <small>{{
              agentCount(project.path)
                ? `${agentCount(project.path)} tracked agents`
                : 'No agents currently'
            }}</small>
            <div class="project-actions">
              <button
                class="secondary"
                :aria-label="`Rename ${project.name}`"
                :disabled="busy || !browserConnected"
                @click="beginRename(project)"
              >
                Rename
              </button>
              <button
                class="secondary"
                :aria-label="`Remove ${project.name}`"
                :disabled="busy || !browserConnected || !!agentCount(project.path)"
                :title="
                  agentCount(project.path)
                    ? 'Remove its agents from Garden first'
                    : 'Remove from Garden; the folder stays on your Mac'
                "
                @click="remove(project.path)"
              >
                Remove
              </button>
            </div>
          </div>
        </template>
      </li>
    </ul>
    <p class="dialog-note">
      Remove agents from Garden before removing their project. Your folders and files stay on your
      Mac.
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div class="dialog-footer">
      <button class="primary" :disabled="busy" @click="dialog?.close()">Done</button>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
.projects-list {
  list-style: none;
  padding: 0;
  margin: var(--space-5) 0;
  display: grid;
  gap: var(--space-3);
}
.projects-list li {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  min-width: 0;
}
.projects-list strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.project-path {
  font-size: 11px;
  color: var(--color-muted);
  overflow-wrap: anywhere;
  margin-top: 5px;
}
.project-bottom,
.project-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.project-bottom {
  justify-content: space-between;
  margin-top: var(--space-3);
}
.project-bottom small,
.picker-hint,
.no-projects {
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.6;
}
.picker-hint {
  margin-top: var(--space-2);
}
.no-projects {
  margin-top: var(--space-5);
}
.project-actions .secondary,
.project-actions .primary {
  padding: 7px 10px;
  font-size: 11px;
}
.rename-form .form-label {
  margin-bottom: var(--space-3);
}
.rename-form .project-actions {
  justify-content: flex-end;
}
</style>
