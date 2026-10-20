<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useGardenStore } from './stores/garden';
import { subscribeToGarden } from './gardenSync';
import { faviconState, type FaviconState } from './favicon';
import { NotificationTracker } from './browserNotifications';
import CreateAgentDialog from './components/CreateAgentDialog.vue';
import ApplicationHeader from './components/ApplicationHeader.vue';
import DashboardGarden from './gardens/dashboard/DashboardGarden.vue';
const creation = ref<InstanceType<typeof CreateAgentDialog>>();
const garden = useGardenStore();
const notificationTracker = new NotificationTracker();
const faviconPaths: Record<FaviconState, string> = {
  default: '/favicon.svg',
  running: '/favicon-running.svg',
  waiting: '/favicon-waiting.svg',
};
watch(
  () => faviconState(garden.snapshot.agents, garden.browserConnected),
  (state) => document.querySelector('link[rel="icon"]')?.setAttribute('href', faviconPaths[state]),
  { immediate: true },
);
watch(
  () => [garden.loaded, garden.snapshot, garden.browserConnected] as const,
  ([loaded, snapshot, connected]) => {
    const alerts = notificationTracker.observe(snapshot.agents, loaded && connected);
    if (
      !garden.notificationsEnabled ||
      !('Notification' in window) ||
      Notification.permission !== 'granted' ||
      (document.visibilityState === 'visible' && document.hasFocus())
    )
      return;
    for (const alert of alerts) {
      try {
        const notification = new Notification(alert.title, {
          body: alert.body,
          icon: '/favicon.svg',
          tag: `garden-agent-${alert.agentId}`,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch {
        // Permission and platform support can change while Garden is open.
      }
    }
  },
  { immediate: true, flush: 'sync' },
);
let subscription: ReturnType<typeof subscribeToGarden> | undefined;
const reloadNotificationPreference = () => garden.reloadNotificationPreference();
onMounted(() => {
  window.addEventListener('storage', reloadNotificationPreference);
  subscription = subscribeToGarden({
    receive: garden.receiveSnapshot,
    disconnect: garden.disconnect,
    revision: () => garden.revision,
  });
});
onUnmounted(() => {
  window.removeEventListener('storage', reloadNotificationPreference);
  subscription?.stop();
});
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
