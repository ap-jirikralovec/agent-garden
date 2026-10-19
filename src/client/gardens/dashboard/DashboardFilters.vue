<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { statusLabels, type ProviderId } from '../../../shared/types';
import { useGardenStore } from '../../stores/garden';
import ProviderLogo from '../../components/ProviderLogo.vue';
const { total, availableProviders } = storeToRefs(useGardenStore());
const search = defineModel<string>('search', { required: true });
const filter = defineModel<string>('filter', { required: true });
const providerFilters = defineModel<ProviderId[]>('providers', { required: true });
const groupByProject = defineModel<boolean>('grouped', { required: true });
</script>

<template>
  <div class="section-toolbar">
    <div class="section-title">
      <h2 id="agents-title">Your agents</h2>
      <span class="count-bubble">{{ total }}</span>
    </div>
    <div class="filters">
      <label class="search"
        ><span aria-hidden="true">⌕</span
        ><input
          v-model="search"
          aria-label="Search agents and workers by name, project, provider or ID"
          placeholder="Search agents, projects or IDs"
          type="search"
      /></label>
      <select v-model="filter" aria-label="Filter by status">
        <option value="all">All statuses</option>
        <option v-for="(label, status) in statusLabels" :key="status" :value="status">
          {{ label }}
        </option>
        <option value="disconnected">Disconnected</option>
      </select>
    </div>
  </div>

  <div class="view-toolbar">
    <fieldset class="provider-filters">
      <legend>Agent types</legend>
      <label
        v-for="provider in availableProviders"
        :key="provider.id"
        class="provider-filter"
        :class="{ selected: providerFilters.includes(provider.id) }"
        ><input v-model="providerFilters" type="checkbox" :value="provider.id" /><ProviderLogo
          :provider="provider.id"
        /><span>{{ provider.name }}</span></label
      >
    </fieldset>
    <label class="group-toggle"
      ><span>Group by project</span
      ><span class="connection-switch"
        ><input
          v-model="groupByProject"
          type="checkbox"
          role="switch"
          aria-label="Group by project" /><span aria-hidden="true"></span></span
    ></label>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/tokens' as tokens;
.section-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-5);
}
.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.filters {
  display: flex;
  gap: 10px;
}
.search {
  display: flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: #fdfefb;
  padding-left: var(--space-3);
  color: #95a08c;
  gap: 7px;
}
.search > span {
  font-size: 22px;
}
.search input {
  background: transparent;
  border: 0;
  font-size: 11px;
  padding: 11px 10px 11px 0;
  width: 190px;
  min-width: 0;
  color: #455541;
}
.search input::placeholder {
  color: #99a08f;
}
.filters select {
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 9px;
  color: #66705e;
  background: #fdfefb;
  max-width: 150px;
}
@include tokens.mobile {
  .section-toolbar {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-4);
  }
  .filters {
    width: 100%;
  }
  .search {
    flex: 1;
    min-width: 0;
  }
  .search input {
    width: 100%;
  }
}
.view-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  margin: -2px 0 23px;
  flex-wrap: wrap;
}
.provider-filters {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}
.provider-filters legend {
  float: left;
  font-size: 11px;
  color: #66705e;
  padding: 0;
  margin-right: 6px;
}
.provider-filter {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 12px;
  cursor: pointer;
  min-height: 37px;
}
.provider-filter.selected {
  background: #eaf0e3;
  color: var(--color-primary);
  border-color: #b4c6a8;
}
.provider-filter input {
  accent-color: var(--color-primary);
  margin: 0;
  width: 14px;
  height: 14px;
}
.provider-filter .provider-logo {
  width: 21px;
  height: 21px;
}
.provider-filter img[alt^='Codex'] {
  transform: scale(1.25);
}
.group-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #63725f;
  cursor: pointer;
}
@include tokens.mobile {
  .view-toolbar {
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  .provider-filters {
    width: 100%;
  }
  .group-toggle {
    margin-left: auto;
  }
  .provider-filter {
    flex: 1;
    justify-content: center;
  }
  .provider-filters legend {
    width: 100%;
    margin: 0 0 var(--space-2);
  }
}
</style>
