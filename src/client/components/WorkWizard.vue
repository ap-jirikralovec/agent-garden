<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { WorkPreset } from '../../shared/work';
import { useWorkDraft } from '../useWorkDraft';

const props = defineProps<{
  presets: WorkPreset[];
  loading: boolean;
  loadError: string;
  directory: string;
  busy: boolean;
}>();
const draft = useWorkDraft();
const { selected, values, prompt, step, wouldReplaceEdits } = draft;
const error = ref('');
const replaceEdits = ref(false);
const heading = ref<HTMLHeadingElement>();
const selectedId = computed({
  get: () => selected.value?.id ?? '',
  set: (id: string) => {
    draft.choose(props.presets.find((work) => work.id === id) ?? null);
    error.value = '';
    replaceEdits.value = false;
  },
});
const canContinue = computed(() => {
  if (props.loading || props.loadError || !selected.value) return false;
  if (step.value === 0) return true;
  if (step.value === 1)
    return (
      selected.value.parameters.every(({ key }) => values.value[key]?.trim()) &&
      (!wouldReplaceEdits.value || replaceEdits.value)
    );
  return !!prompt.value.trim() && prompt.value.length <= 16000;
});
function focusHeading() {
  void nextTick(() => heading.value?.focus());
}
function next(): boolean {
  error.value = '';
  try {
    const send = draft.next(replaceEdits.value);
    replaceEdits.value = false;
    if (!send) focusHeading();
    return send;
  } catch (cause) {
    error.value = (cause as Error).message;
    return false;
  }
}
function back() {
  draft.back();
  error.value = '';
  replaceEdits.value = false;
  focusHeading();
}
defineExpose({ step, prompt, canContinue, next, back });
</script>

<template>
  <section class="work-wizard" aria-label="Work setup">
    <ol class="work-steps" aria-label="Work progress">
      <li
        v-for="(label, index) in ['Choose work', 'Parameters', 'Review', 'Send']"
        :key="label"
        :aria-current="(busy ? 3 : step) === index ? 'step' : undefined"
        :class="{ active: (busy ? 3 : step) === index, complete: index < step }"
      >
        <span aria-hidden="true">{{ index + 1 }}</span
        >{{ label }}
      </li>
    </ol>
    <template v-if="step === 0">
      <h3 ref="heading" tabindex="-1">Choose work</h3>
      <p v-if="loading" role="status">Loading local work presets…</p>
      <p v-else-if="loadError" class="form-error" role="alert">{{ loadError }}</p>
      <template v-else-if="!presets.length">
        <p>
          No work presets found. Add a valid .yaml or .yml preset to your local work folder, then
          reopen this dialog.
        </p>
        <p class="work-path">{{ directory }}</p>
      </template>
      <template v-else>
        <label class="form-label" for="work-preset"
          >Work preset
          <select id="work-preset" v-model="selectedId" required :disabled="busy">
            <option disabled value="">Choose work</option>
            <option v-for="work in presets" :key="work.id" :value="work.id">
              {{ work.name }} — {{ work.author }}
            </option>
          </select>
        </label>
        <div v-if="selected" class="work-description">
          <strong>{{ selected.name }}</strong>
          <p>By {{ selected.author }}</p>
          <p>{{ selected.description }}</p>
        </div>
      </template>
    </template>
    <template v-else-if="step === 1 && selected">
      <h3 ref="heading" tabindex="-1">Parameters for {{ selected.name }}</h3>
      <p v-if="!selected.parameters.length">
        This work has no parameters. Continue to review its prompt.
      </p>
      <label
        v-for="(parameter, index) in selected.parameters"
        :key="parameter.key"
        class="form-label"
        :for="`work-parameter-${index}`"
      >
        {{ parameter.key }}
        <textarea
          :id="`work-parameter-${index}`"
          v-model="values[parameter.key]"
          required
          maxlength="4000"
          :disabled="busy"
          rows="2"
          class="parameter-value"
        />
      </label>
      <label v-if="wouldReplaceEdits" class="replace-edits">
        <input v-model="replaceEdits" type="checkbox" :disabled="busy" />
        Replace my edited prompt with the updated parameter values.
      </label>
    </template>
    <template v-else>
      <h3 ref="heading" tabindex="-1">Review your prompt</h3>
      <label class="form-label" for="work-prompt"
        >Prompt to send
        <textarea
          id="work-prompt"
          v-model="prompt"
          required
          maxlength="16000"
          rows="10"
          :disabled="busy"
          aria-describedby="work-prompt-help"
        />
      </label>
      <p id="work-prompt-help">
        Edit anything before sending. The agent receives exactly this text. Up to 16,000 characters.
      </p>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped lang="scss">
.work-wizard {
  margin-top: var(--space-5);
}
.work-steps {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
  padding: 0;
  margin: 0 0 var(--space-6);
  color: var(--color-muted);
  font-size: 12px;
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  span {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--color-border);
    border-radius: 50%;
  }
  .active {
    color: var(--color-primary);
    font-weight: 600;
    span {
      background: var(--color-primary);
      color: white;
      border-color: var(--color-primary);
    }
  }
  .complete {
    color: var(--color-primary);
  }
}
h3 {
  margin: 0 0 var(--space-4);
  font-size: 16px;
}
p {
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-muted);
}
.work-description {
  padding: var(--space-4);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  p {
    margin-top: var(--space-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
.work-path {
  overflow-wrap: anywhere;
  margin-top: var(--space-3);
}
.replace-edits {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: 12px;
  line-height: 1.6;
}
textarea {
  display: block;
  width: 100%;
  min-height: 220px;
  padding: var(--space-3);
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
}
.parameter-value {
  min-height: 76px;
}
textarea:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}
</style>
