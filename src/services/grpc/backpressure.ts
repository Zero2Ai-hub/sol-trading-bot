/**
 * Backpressure Queue
 *
 * Handles high-volume event streams with priority-based overflow protection.
 * Critical events (like migrations) are never dropped.
 */

import { getComponentLogger, type ComponentLogger } from '../../infrastructure/logger/index.js';
import { EventPriority, isCriticalEvent, type PumpFunEventMap } from '../../core/events.js';

// =============================================================================
// TYPES
// =============================================================================

export interface BackpressureConfig {
  /** Maximum queue size before dropping */
  maxQueueSize: number;

  /** Start dropping low-priority events at this level */
  highWaterMark: number;

  /** Resume normal processing at this level */
  lowWaterMark: number;

  /** Drop policy when full */
  dropPolicy: 'oldest' | 'newest' | 'lowest-priority';

  /** Process batch size */
  batchSize: number;

  /** Process interval in ms */
  processIntervalMs: number;
}

export interface QueuedEvent<K extends keyof PumpFunEventMap = keyof PumpFunEventMap> {
  eventName: K;
  payload: PumpFunEventMap[K];
  priority: EventPriority;
  enqueuedAt: number;
  slot?: bigint;
}

export interface BackpressureStats {
  queueSize: number;
  eventsProcessed: number;
  eventsDropped: number;
  criticalEventsProcessed: number;
  isPaused: boolean;
  isOverflowing: boolean;
  avgProcessingTimeMs: number;
}

type EventProcessor = <K extends keyof PumpFunEventMap>(
  eventName: K,
  payload: PumpFunEventMap[K]
) => Promise<void> | void;

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: BackpressureConfig = {
  maxQueueSize: 10000,
  highWaterMark: 8000,
  lowWaterMark: 5000,
  dropPolicy: 'lowest-priority',
  batchSize: 100,
  processIntervalMs: 10,
};

// =============================================================================
// BACKPRESSURE QUEUE CLASS
// =============================================================================

export class BackpressureQueue {
  private config: BackpressureConfig;
  private queue: QueuedEvent[] = [];
  private processor: EventProcessor | null = null;
  private processTimer: ReturnType<typeof setInterval> | null = null;
  private logger: ComponentLogger | null = null;
  private isProcessing = false;
  private isPaused = false;

  // Stats
  private eventsProcessed = 0;
  private eventsDropped = 0;
  private criticalEventsProcessed = 0;
  private processingTimes: number[] = [];
  private maxProcessingTimeSamples = 100;

  constructor(config: Partial<BackpressureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initializes the queue with a processor function
   */
  initialize(processor: EventProcessor): void {
    this.logger = getComponentLogger('backpressure-queue');
    this.processor = processor;

    this.logger.info('Backpressure queue initialized', {
      config: this.config,
    });
  }

  /**
   * Starts processing the queue
   */
  start(): void {
    if (this.processTimer) {
      return;
    }

    this.logger?.info('Starting queue processing');
    this.processTimer = setInterval(() => {
      this.processBatch().catch(error => {
        this.logger?.error('Batch processing error', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.config.processIntervalMs);
  }

  /**
   * Stops processing the queue
   */
  stop(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    this.logger?.info('Queue processing stopped', {
      remainingEvents: this.queue.length,
    });
  }

  /**
   * Pauses processing (events still queued)
   */
  pause(): void {
    this.isPaused = true;
    this.logger?.info('Queue processing paused');
  }

  /**
   * Resumes processing
   */
  resume(): void {
    this.isPaused = false;
    this.logger?.info('Queue processing resumed');
  }

  /**
   * Enqueues an event for processing
   */
  enqueue<K extends keyof PumpFunEventMap>(
    eventName: K,
    payload: PumpFunEventMap[K],
    priority?: EventPriority
  ): boolean {
    const eventPriority = priority ?? this.getDefaultPriority(eventName);
    const isCritical = isCriticalEvent(eventName);

    // Check queue capacity
    if (this.queue.length >= this.config.maxQueueSize) {
      // Critical events are never dropped
      if (isCritical) {
        this.dropLowestPriorityEvent();
      } else {
        this.eventsDropped++;
        this.logger?.warn('Event dropped - queue full', {
          eventName,
          queueSize: this.queue.length,
          priority: eventPriority,
        });
        return false;
      }
    }

    // High water mark - start being selective
    if (this.queue.length >= this.config.highWaterMark && !isCritical) {
      if (eventPriority <= EventPriority.LOW) {
        this.eventsDropped++;
        return false;
      }
    }

    const event: QueuedEvent<K> = {
      eventName,
      payload,
      priority: eventPriority,
      enqueuedAt: Date.now(),
      slot: this.extractSlot(payload),
    };

    // Insert based on priority (higher priority = earlier in queue)
    this.insertByPriority(event);
    return true;
  }

  /**
   * Gets current queue statistics
   */
  getStats(): BackpressureStats {
    const avgProcessingTime = this.processingTimes.length > 0
      ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
      : 0;

    return {
      queueSize: this.queue.length,
      eventsProcessed: this.eventsProcessed,
      eventsDropped: this.eventsDropped,
      criticalEventsProcessed: this.criticalEventsProcessed,
      isPaused: this.isPaused,
      isOverflowing: this.queue.length >= this.config.highWaterMark,
      avgProcessingTimeMs: avgProcessingTime,
    };
  }

  /**
   * Clears the queue
   */
  clear(): void {
    const dropped = this.queue.length;
    this.queue = [];
    this.logger?.warn('Queue cleared', { droppedEvents: dropped });
  }

  /**
   * Drains remaining events (for graceful shutdown)
   */
  async drain(timeoutMs: number = 5000): Promise<number> {
    const startTime = Date.now();
    let processed = 0;

    this.logger?.info('Draining queue', { eventsRemaining: this.queue.length });

    while (this.queue.length > 0 && (Date.now() - startTime) < timeoutMs) {
      const batch = this.queue.splice(0, this.config.batchSize);
      for (const event of batch) {
        try {
          await this.processor?.(event.eventName, event.payload);
          processed++;
        } catch {
          // Continue draining even on errors
        }
      }
    }

    this.logger?.info('Queue drained', {
      processed,
      remaining: this.queue.length,
      timeMs: Date.now() - startTime,
    });

    return processed;
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.isPaused || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      const batch = this.queue.splice(0, this.config.batchSize);

      for (const event of batch) {
        try {
          await this.processor?.(event.eventName, event.payload);
          this.eventsProcessed++;

          if (isCriticalEvent(event.eventName)) {
            this.criticalEventsProcessed++;
          }
        } catch (error) {
          this.logger?.error('Event processing error', {
            eventName: event.eventName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Track processing time
      const processingTime = Date.now() - startTime;
      this.processingTimes.push(processingTime);
      if (this.processingTimes.length > this.maxProcessingTimeSamples) {
        this.processingTimes.shift();
      }

      // Log if we're at low water mark (recovered from overflow)
      if (this.queue.length <= this.config.lowWaterMark && this.queue.length > 0) {
        this.logger?.debug('Queue at low water mark', {
          queueSize: this.queue.length,
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private insertByPriority(event: QueuedEvent): void {
    // Find insertion point (maintain priority order, FIFO within same priority)
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      const queuedEvent = this.queue[i];
      if (queuedEvent && queuedEvent.priority < event.priority) {
        insertIndex = i;
        break;
      }
    }
    this.queue.splice(insertIndex, 0, event);
  }

  private dropLowestPriorityEvent(): void {
    // Find and remove lowest priority non-critical event from the end
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const queuedEvent = this.queue[i];
      if (queuedEvent && !isCriticalEvent(queuedEvent.eventName)) {
        this.queue.splice(i, 1);
        this.eventsDropped++;
        return;
      }
    }
  }

  private getDefaultPriority(eventName: keyof PumpFunEventMap): EventPriority {
    switch (eventName) {
      case 'token:migration':
        return EventPriority.CRITICAL;
      case 'token:launched':
        return EventPriority.HIGH;
      case 'bonding:progress':
      case 'token:trade':
        return EventPriority.NORMAL;
      case 'stream:error':
        return EventPriority.HIGH;
      default:
        return EventPriority.LOW;
    }
  }

  private extractSlot(payload: unknown): bigint | undefined {
    if (payload && typeof payload === 'object' && 'slot' in payload) {
      const slot = (payload as { slot: unknown }).slot;
      if (typeof slot === 'bigint') {
        return slot;
      }
    }
    return undefined;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Creates a backpressure queue with trading-optimized defaults
 */
export function createBackpressureQueue(
  config?: Partial<BackpressureConfig>
): BackpressureQueue {
  return new BackpressureQueue({
    maxQueueSize: 10000,
    highWaterMark: 8000,
    lowWaterMark: 5000,
    dropPolicy: 'lowest-priority',
    batchSize: 100,
    processIntervalMs: 10,
    ...config,
  });
}
