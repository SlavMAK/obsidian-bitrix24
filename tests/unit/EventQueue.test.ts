import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventQueue, type DedupableEvent } from '../../src/services/EventQueue';
import { noticeMock } from '../mocks/obsidian';
import { makeFakeLogger } from '../helpers/fakeLogger';

interface TestEvent extends DedupableEvent {
  payload: string;
}

function defer<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Small delay for the microtask + setImmediate boundaries used inside pump(). */
const tick = () => new Promise<void>((res) => setImmediate(res));

describe('EventQueue', () => {
  let logger: ReturnType<typeof makeFakeLogger>;
  let queue: EventQueue<TestEvent>;

  beforeEach(() => {
    noticeMock.mockClear();
    logger = makeFakeLogger();
    queue = new EventQueue<TestEvent>(logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('coalescing', () => {
    it('replaces a pending event with the same dedupKey in place', async () => {
      // Hold the first event in-flight so a second enqueue can land while it processes.
      const gate = defer<void>();
      const seen: TestEvent[] = [];
      queue.setHandler(async (e) => {
        seen.push(e);
        if (e.payload === 'first-in-flight') await gate.promise;
      });

      queue.enqueue({ dedupKey: 'A', payload: 'first-in-flight' });
      await tick(); // let pump pick up the first event

      // While the first is held, push two with the same key — second should coalesce onto first.
      queue.enqueue({ dedupKey: 'B', payload: 'B-v1' });
      queue.enqueue({ dedupKey: 'B', payload: 'B-v2' });
      expect(queue.size()).toBe(1); // only one pending entry for key B

      gate.resolve();
      await tick();
      await tick();

      expect(seen.map((e) => e.payload)).toEqual(['first-in-flight', 'B-v2']);

      const coalesceCall = logger.log.mock.calls.find((c) => String(c[0]).includes('coalesced'));
      expect(coalesceCall).toBeDefined();
    });

    it('preserves FIFO position when coalescing', async () => {
      const gate = defer<void>();
      const seen: string[] = [];
      queue.setHandler(async (e) => {
        seen.push(e.payload);
        if (e.payload === 'gate') await gate.promise;
      });

      queue.enqueue({ dedupKey: 'gate', payload: 'gate' });
      await tick();

      queue.enqueue({ dedupKey: 'A', payload: 'A-v1' });
      queue.enqueue({ dedupKey: 'B', payload: 'B' });
      queue.enqueue({ dedupKey: 'A', payload: 'A-v2' }); // coalesces onto A's existing slot
      expect(queue.size()).toBe(2);

      gate.resolve();
      await tick();
      await tick();

      // A keeps its earlier position (before B), but carries A-v2's payload.
      expect(seen).toEqual(['gate', 'A-v2', 'B']);
    });
  });

  describe('FIFO order', () => {
    it('processes distinct-key events in enqueue order', async () => {
      const seen: string[] = [];
      queue.setHandler(async (e) => {
        seen.push(e.payload);
      });

      queue.enqueue({ dedupKey: '1', payload: 'one' });
      queue.enqueue({ dedupKey: '2', payload: 'two' });
      queue.enqueue({ dedupKey: '3', payload: 'three' });

      await tick();
      expect(seen).toEqual(['one', 'two', 'three']);
    });

    it('runs handlers strictly sequentially (single-flight)', async () => {
      let inFlight = 0;
      let maxConcurrent = 0;
      queue.setHandler(async () => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      });

      for (let i = 0; i < 5; i++) {
        queue.enqueue({ dedupKey: `k${i}`, payload: String(i) });
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(maxConcurrent).toBe(1);
    });
  });

  describe('pause / resume', () => {
    it('does not process events while paused', async () => {
      const seen: string[] = [];
      queue.setHandler(async (e) => {
        seen.push(e.payload);
      });

      queue.pause();
      queue.enqueue({ dedupKey: 'a', payload: 'a' });
      queue.enqueue({ dedupKey: 'b', payload: 'b' });
      await tick();
      await tick();
      expect(seen).toEqual([]);
      expect(queue.size()).toBe(2);
    });

    it('drains queued events on resume', async () => {
      const seen: string[] = [];
      queue.setHandler(async (e) => {
        seen.push(e.payload);
      });

      queue.pause();
      queue.enqueue({ dedupKey: 'a', payload: 'a' });
      queue.enqueue({ dedupKey: 'b', payload: 'b' });
      queue.resume();
      await tick();

      expect(seen).toEqual(['a', 'b']);
    });

    it('lets the in-flight handler finish, then pauses before the next event', async () => {
      const gate = defer<void>();
      const seen: string[] = [];
      queue.setHandler(async (e) => {
        if (e.payload === 'first') await gate.promise;
        seen.push(e.payload);
      });

      queue.enqueue({ dedupKey: '1', payload: 'first' });
      await tick();
      queue.enqueue({ dedupKey: '2', payload: 'second' });
      queue.pause(); // pause while #1 is in flight

      gate.resolve(); // let #1 finish
      await tick();
      await tick();
      expect(seen).toEqual(['first']); // #2 must NOT run while paused

      queue.resume();
      await tick();
      expect(seen).toEqual(['first', 'second']);
    });
  });

  describe('clear', () => {
    it('drops pending events but lets in-flight finish', async () => {
      const gate = defer<void>();
      const seen: string[] = [];
      queue.setHandler(async (e) => {
        if (e.payload === 'inflight') await gate.promise;
        seen.push(e.payload);
      });

      queue.enqueue({ dedupKey: '1', payload: 'inflight' });
      await tick();
      queue.enqueue({ dedupKey: '2', payload: 'pending-1' });
      queue.enqueue({ dedupKey: '3', payload: 'pending-2' });

      queue.clear();
      expect(queue.size()).toBe(0);

      gate.resolve();
      await tick();
      await tick();
      expect(seen).toEqual(['inflight']);
    });
  });

  describe('handler errors', () => {
    it('does not kill the pump when a handler throws', async () => {
      const seen: string[] = [];
      queue.setHandler(async (e) => {
        if (e.payload === 'boom') throw new Error('handler exploded');
        seen.push(e.payload);
      });

      queue.enqueue({ dedupKey: 'a', payload: 'before' });
      queue.enqueue({ dedupKey: 'b', payload: 'boom' });
      queue.enqueue({ dedupKey: 'c', payload: 'after' });

      await tick();
      await tick();

      expect(seen).toEqual(['before', 'after']);
      const errorLog = logger.log.mock.calls.find((c) => c[1] === 'ERROR');
      expect(errorLog).toBeDefined();
      expect(noticeMock).toHaveBeenCalledWith(
        expect.stringContaining('Ошибка обработки события синхронизации'),
        undefined,
      );
    });
  });

  describe('handler lifecycle', () => {
    it('does not drop events enqueued before setHandler', async () => {
      const seen: string[] = [];
      queue.enqueue({ dedupKey: 'a', payload: 'pre-1' });
      queue.enqueue({ dedupKey: 'b', payload: 'pre-2' });

      queue.setHandler(async (e) => {
        seen.push(e.payload);
      });

      await tick();
      expect(seen).toEqual(['pre-1', 'pre-2']);
    });
  });
});
