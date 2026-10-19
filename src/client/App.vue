<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useGardenStore } from './stores/garden';
import { subscribeToGarden } from './gardenSync';
import ApplicationHeader from './components/ApplicationHeader.vue';
import DashboardGarden from './gardens/dashboard/DashboardGarden.vue';
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
  <div class="shell"><ApplicationHeader /><DashboardGarden @refresh="refresh" /></div>
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
