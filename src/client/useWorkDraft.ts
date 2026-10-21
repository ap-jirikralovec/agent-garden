import { computed, ref } from 'vue';
import { renderWorkPrompt, type WorkPreset } from '../shared/work';

// Keep wizard drafts local to one creation dialog, including drafts for other presets.
export function useWorkDraft() {
  const selected = ref<WorkPreset | null>(null);
  const values = ref<Record<string, string>>({});
  const prompt = ref('');
  const step = ref(0);
  const generated = ref('');
  const signature = ref('');
  const drafts = new Map<
    string,
    { values: Record<string, string>; prompt: string; generated: string; signature: string }
  >();
  const currentSignature = computed(() => JSON.stringify(values.value));
  const wouldReplaceEdits = computed(
    () =>
      signature.value !== '' &&
      signature.value !== currentSignature.value &&
      prompt.value !== generated.value,
  );
  function choose(work: WorkPreset | null) {
    if (selected.value)
      drafts.set(selected.value.id, {
        values: { ...values.value },
        prompt: prompt.value,
        generated: generated.value,
        signature: signature.value,
      });
    selected.value = work;
    const saved = work ? drafts.get(work.id) : undefined;
    values.value =
      saved?.values ??
      Object.fromEntries(work?.parameters.map(({ key, value }) => [key, value]) ?? []);
    prompt.value = saved?.prompt ?? '';
    generated.value = saved?.generated ?? '';
    signature.value = saved?.signature ?? '';
    step.value = 0;
  }
  function next(replaceEdited = false): boolean {
    if (!selected.value) throw new Error('Choose a work preset.');
    if (step.value === 0) {
      step.value = 1;
      return false;
    }
    if (step.value === 1) {
      const rendered = renderWorkPrompt(selected.value, values.value);
      if (wouldReplaceEdits.value && !replaceEdited)
        throw new Error('Confirm replacing your edited prompt with the updated parameter values.');
      if (signature.value !== currentSignature.value) prompt.value = rendered;
      generated.value = rendered;
      signature.value = currentSignature.value;
      step.value = 2;
      return false;
    }
    if (!prompt.value.trim() || prompt.value.length > 16000 || prompt.value.includes('\0'))
      throw new Error('Enter a prompt of 1–16,000 characters without null characters.');
    return true;
  }
  function back() {
    step.value = Math.max(0, step.value - 1);
  }
  function reset() {
    selected.value = null;
    values.value = {};
    prompt.value = '';
    generated.value = '';
    signature.value = '';
    step.value = 0;
    drafts.clear();
  }
  return { selected, values, prompt, step, wouldReplaceEdits, choose, next, back, reset };
}
