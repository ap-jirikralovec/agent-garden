<script setup lang="ts">
import type { ProviderId } from '../../shared/types';
import chatgptLogo from '../assets/chatgpt.svg';
import claudeLogo from '../assets/claude.svg';
defineProps<{ provider: ProviderId }>();
</script>

<template>
  <img
    class="provider-logo"
    :src="provider === 'codex' ? chatgptLogo : claudeLogo"
    :alt="provider === 'codex' ? 'Codex (ChatGPT)' : 'Claude'"
    :title="provider === 'codex' ? 'Codex · ChatGPT' : 'Claude'"
    width="28"
    height="28"
  />
</template>

<style scoped lang="scss">
@use '../styles/tokens' as tokens;

.provider-logo {
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}
</style>
