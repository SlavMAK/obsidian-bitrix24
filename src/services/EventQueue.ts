import { Notice } from "obsidian";
import { Logger } from "./LoggerService";

/**
 * Minimal contract for events handled by EventQueue.
 * The dedupKey is computed by the producer; the queue uses it for coalescing.
 */
export interface DedupableEvent {
	dedupKey: string;
}

export type EventHandler<T> = (event: T) => Promise<void>;

/**
 * Generic single-flight FIFO queue with producer-side dedup coalescing.
 *
 * Semantics:
 *  - enqueue(event): if an event with the same dedupKey is already pending
 *    (not yet picked up by the worker), the new event replaces it in place
 *    (queue position preserved). This implements "last write wins" /
 *    "rename -> modify coalesces" — the choice of dedupKey lives in the producer.
 *  - Only one event is processed at a time (no real mutex needed: JS is
 *    single-threaded; we just track an isProcessing flag).
 *  - Handler exceptions are logged and surfaced via Notice; the pump never dies.
 *  - pause()/resume() allow halting consumption (e.g. while a conflict modal
 *    is open or token refresh failed) without dropping events.
 */
export class EventQueue<T extends DedupableEvent> {
	private queue: T[] = [];
	private handler: EventHandler<T> | null = null;
	private isProcessing = false;
	private paused = false;

	constructor(private logger: Logger) {}

	/**
	 * Append an event, or coalesce with an existing pending event sharing the
	 * same dedupKey (replace in place, preserve position).
	 */
	enqueue(event: T): void {
		const existingIdx = this.queue.findIndex(e => e.dedupKey === event.dedupKey);
		if (existingIdx !== -1) {
			// Coalesce: replace existing pending event, keep its queue position.
			this.queue[existingIdx] = event;
			this.logger.log(
				`EventQueue: coalesced event for dedupKey=${event.dedupKey}`,
				'INFO',
				{ position: existingIdx, queueSize: this.queue.length }
			);
		} else {
			this.queue.push(event);
		}
		// Kick the pump (no-op if already running or no handler / paused).
		void this.pump();
	}

	/**
	 * Register / replace the consumer. If the queue already has items,
	 * pumping starts immediately.
	 */
	setHandler(fn: EventHandler<T>): void {
		this.handler = fn;
		void this.pump();
	}

	/** Halt consumption. Enqueue still accepts events while paused. */
	pause(): void {
		this.paused = true;
		this.logger.log('EventQueue: paused', 'INFO', { queueSize: this.queue.length });
	}

	/** Resume consumption and re-kick the pump. */
	resume(): void {
		if (!this.paused) return;
		this.paused = false;
		this.logger.log('EventQueue: resumed', 'INFO', { queueSize: this.queue.length });
		void this.pump();
	}

	/** Pending count (excludes the event currently being processed). */
	size(): number {
		return this.queue.length;
	}

	/** Drop all pending events. Does not interrupt an in-flight handler. */
	clear(): void {
		const dropped = this.queue.length;
		this.queue = [];
		this.logger.log('EventQueue: cleared', 'INFO', { droppedCount: dropped });
	}

	/**
	 * Single-flight async pump. Runs until queue is empty, handler is unset,
	 * or queue is paused. Concurrent invocations are no-ops via isProcessing.
	 */
	private async pump(): Promise<void> {
		if (this.isProcessing) return;
		if (!this.handler) return;
		if (this.paused) return;
		if (this.queue.length === 0) return;

		this.isProcessing = true;
		try {
			while (!this.paused && this.queue.length > 0 && this.handler) {
				const event = this.queue.shift() as T;
				try {
					await this.handler(event);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.logger.log(
						`EventQueue: handler threw for dedupKey=${event.dedupKey}`,
						'ERROR',
						{ error: msg, event }
					);
					// Short user-visible notice; keep details in the log.
					new Notice(`Ошибка обработки события синхронизации: ${msg}`);
					// Swallow and continue — never let the pump die.
				}
			}
		} finally {
			this.isProcessing = false;
		}
	}
}
