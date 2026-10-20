<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useGardenStore } from './stores/garden';
import { subscribeToGarden } from './gardenSync';
import CreateAgentDialog from './components/CreateAgentDialog.vue';
import ApplicationHeader from './components/ApplicationHeader.vue';
import DashboardGarden from './gardens/dashboard/DashboardGarden.vue';
const creation = ref<InstanceType<typeof CreateAgentDialog>>();
const garden = useGardenStore();
let subscription: ReturnType<typeof subscribeToGarden> | undefined;
onMounted(() => {
  subscription = subscribeToGarden({
    receive: garden.receiveSnapshot,
    disconnect: garden.disconnect,
    revision: () => garden.revision,
  });
});
onUnmounted(() => subscription?.stop());
function refresh() {
  void subscription?.refresh();
}
</script>

<template>
  <div class="shell">
    <ApplicationHeader @add-agent="creation?.open()" />
    <DashboardGarden @refresh="refresh" @add-agent="creation?.open($event)" />
    <CreateAgentDialog ref="creation" @created="refresh" />
  </div>
</template>

<style scoped lang="scss">
@use './styles/tokens' as tokens;
.shell {
  max-width: 1380px;
  margin: auto;
  padding: 0 56px;
}
@include tokens.wide {
  .shell {
    padding: 0 64px;
  }
}
@include tokens.tablet {
  .shell {
    padding: 0 30px;
  }
}
@include tokens.mobile {
  .shell {
    padding: 0 var(--space-5);
  }
}
</style>
