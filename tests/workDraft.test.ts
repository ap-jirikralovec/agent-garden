import { expect, it } from 'vitest';
import { useWorkDraft } from '../src/client/useWorkDraft';
import type { WorkPreset } from '../src/shared/work';

const work: WorkPreset = {
  id: 'review.yaml',
  name: 'Review',
  author: 'Jiri',
  description: 'Review a ticket',
  parameters: [{ key: 'ticket', value: '' }],
  prompt: 'Review {{ticket}}.',
};
it('requires selection and parameter values before generating a review, then preserves edits when navigating back', () => {
  const draft = useWorkDraft();
  expect(() => draft.next()).toThrow('Choose');
  draft.choose(work);
  expect(draft.next()).toBe(false);
  expect(() => draft.next()).toThrow('ticket');
  draft.values.value.ticket = 'DEV-123';
  expect(draft.next()).toBe(false);
  expect(draft.prompt.value).toBe('Review DEV-123.');
  draft.prompt.value = 'Edited prompt.';
  draft.back();
  draft.next();
  expect(draft.prompt.value).toBe('Edited prompt.');
  expect(draft.next()).toBe(true);
});
it('never silently replaces edited review text after parameters change', () => {
  const draft = useWorkDraft();
  draft.choose(work);
  draft.next();
  draft.values.value.ticket = 'One';
  draft.next();
  draft.prompt.value = 'Keep my edits';
  draft.back();
  draft.values.value.ticket = 'Two';
  expect(draft.wouldReplaceEdits.value).toBe(true);
  expect(() => draft.next()).toThrow('edited prompt');
  expect(draft.prompt.value).toBe('Keep my edits');
  draft.next(true);
  expect(draft.prompt.value).toBe('Review Two.');
});
it('retains separate drafts when choosing another preset, resets for a fresh dialog, and handles no parameters', () => {
  const draft = useWorkDraft();
  draft.choose(work);
  draft.next();
  draft.values.value.ticket = 'One';
  draft.next();
  draft.prompt.value = 'My edits';
  draft.back();
  draft.back();
  draft.choose({ ...work, id: 'hello.yml', parameters: [], prompt: 'Hello' });
  draft.next();
  draft.next();
  expect(draft.prompt.value).toBe('Hello');
  draft.back();
  draft.back();
  draft.choose(work);
  expect(draft.values.value.ticket).toBe('One');
  draft.next();
  draft.next();
  expect(draft.prompt.value).toBe('My edits');
  draft.prompt.value = ' ';
  expect(() => draft.next()).toThrow('prompt');
  draft.reset();
  expect(draft.selected.value).toBeNull();
  expect(draft.step.value).toBe(0);
  expect(draft.prompt.value).toBe('');
});
