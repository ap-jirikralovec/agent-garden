import { gardenApi } from './api';
import type { Snapshot } from '../shared/types';

const POLL_INTERVAL = 5000;
const REQUEST_TIMEOUT = 10000;

interface SnapshotSink {
  receive: (snapshot: Snapshot) => void;
  disconnect: () => void;
  revision: () => number;
}

// App owns this subscription. Gardens consume state without opening transports.
export function subscribeToGarden(sink: SnapshotSink) {
  let stopped = false;
  let polling = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  const events = new EventSource('/api/events');

  async function refresh() {
    if (stopped || request) return;
    const revision = sink.revision();
    const controller = new AbortController();
    request = controller;
    try {
      const snapshot = await gardenApi.state(
        AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT)]),
      );
      // A stream or explicit settings update can overtake this HTTP read.
      if (!stopped && revision === sink.revision()) sink.receive(snapshot);
    } catch {
      if (!stopped && revision === sink.revision()) sink.disconnect();
    } finally {
      request = undefined;
      if (!stopped && polling) {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), POLL_INTERVAL);
      }
    }
  }

  function usePolling() {
    if (stopped) return;
    sink.disconnect();
    if (polling) return;
    polling = true;
    void refresh();
  }

  events.onmessage = (event) => {
    if (stopped) return;
    try {
      const snapshot = JSON.parse(event.data) as Snapshot;
      sink.receive(snapshot);
      polling = false;
      clearTimeout(timer);
    } catch {
      usePolling();
    }
  };
  events.onerror = usePolling;
  void refresh();

  return {
    refresh,
    stop() {
      stopped = true;
      events.close();
      events.onmessage = null;
      events.onerror = null;
      clearTimeout(timer);
      request?.abort();
    },
  };
}
