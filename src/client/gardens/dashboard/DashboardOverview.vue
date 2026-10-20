<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useGardenStore } from '../../stores/garden';
const { total, counts } = storeToRefs(useGardenStore());
</script>

<template>
  <section class="overview" aria-label="Agent overview">
    <div class="overview-item">
      <span class="metric-icon moss" aria-hidden="true">⌘</span>
      <div>
        <strong>{{ total }}</strong
        ><span>Total agents</span>
      </div>
    </div>
    <div class="overview-item">
      <span class="metric-icon blue" aria-hidden="true">↗</span>
      <div>
        <strong>{{ counts.working }}</strong
        ><span>Working</span>
      </div>
    </div>
    <div class="overview-item">
      <span class="metric-icon sand" aria-hidden="true">…</span>
      <div>
        <strong>{{ counts.waiting }}</strong
        ><span>Need your input</span>
      </div>
    </div>
    <div class="overview-item">
      <span class="metric-icon lavender" aria-hidden="true">✓</span>
      <div>
        <strong>{{ counts.finished }}</strong
        ><span>Latest response finished</span>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use '../../styles/tokens' as tokens;
.overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-top: 34px;
}
.overview-item {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fdfefb;
  padding: var(--space-5) 22px;
}
.metric-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  font-size: 22px;
}
.moss {
  color: #6c8558;
  background: #edf2e4;
}
.blue {
  color: #62859f;
  background: #eaf1f6;
}
.sand {
  color: #a68c52;
  background: #f8f0dd;
}
.lavender {
  color: #8d7c9b;
  background: #f0ecf5;
}
.overview-item strong {
  font-size: 25px;
  font-weight: 550;
  letter-spacing: -0.7px;
  display: block;
  line-height: 1.2;
}
.overview-item div > span {
  display: block;
  font-size: 10px;
  color: var(--color-muted);
  margin-top: 6px;
}
@include tokens.wide {
  .overview {
    margin-top: 40px;
  }
}
@include tokens.tablet {
  .overview-item {
    padding: 17px 14px;
    gap: 10px;
  }
  .metric-icon {
    width: 34px;
    height: 34px;
  }
}
@include tokens.mobile {
  .overview {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-top: var(--space-6);
  }
  .overview-item {
    padding: var(--space-4) var(--space-3);
  }
  .overview-item strong {
    font-size: 23px;
  }
  .overview-item div > span {
    font-size: 9px;
  }
}
</style>
