import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToGarden } from '../src/client/gardenSync';

const initial = {
  projects: [],
  agents: [],
  providers: [],
  error: null,
  projectSuggestion: 'initial',
};
class Stream {
  static current: Stream;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() {
    Stream.current = this;
  }
}

describe('application snapshot subscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', Stream);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function callbacks() {
    let revision = 0;
    return { receive: vi.fn(() => revision++), disconnect: vi.fn(), revision: () => revision };
  }

  it('falls back to polling after SSE failure and stops polling when SSE delivers again', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => initial });
    vi.stubGlobal('fetch', fetch);
    const sink = callbacks();
    const sync = subscribeToGarden(sink);
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.receive).toHaveBeenCalledWith(initial);
    Stream.current.onerror?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(3);
    Stream.current.onmessage?.({
      data: JSON.stringify({ ...initial, projectSuggestion: 'stream' }),
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(3);
    sync.stop();
    expect(Stream.current.close).toHaveBeenCalledOnce();
  });

  it('discards an older HTTP snapshot after a newer stream snapshot and ignores reads after cleanup', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((result) => {
            resolve = result;
          }),
      ),
    );
    const sink = callbacks();
    const sync = subscribeToGarden(sink);
    Stream.current.onmessage?.({
      data: JSON.stringify({ ...initial, projectSuggestion: 'newer' }),
    });
    resolve({ ok: true, json: async () => initial });
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.receive).toHaveBeenCalledTimes(1);
    const pending = sync.refresh();
    sync.stop();
    resolve({ ok: true, json: async () => initial });
    await pending;
    expect(sink.receive).toHaveBeenCalledTimes(1);
  });

  it('recovers from failed fallback reads, avoids overlapping requests, and cancels polling on cleanup', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => initial });
    vi.stubGlobal('fetch', fetch);
    const sink = callbacks();
    const sync = subscribeToGarden(sink);
    await vi.advanceTimersByTimeAsync(0);
    fetch.mockRejectedValueOnce(new Error('offline'));
    Stream.current.onerror?.();
    void sync.refresh();
    void sync.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sink.disconnect).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sink.receive).toHaveBeenCalledTimes(2);
    sync.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
