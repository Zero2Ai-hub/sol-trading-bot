/**
 * Time-Windowed Data Storage
 *
 * Efficient storage for time-series data with automatic cleanup.
 * Used by analyzers to track metrics over rolling time windows.
 */

import type { Timestamp } from '../core/types.js';
import { TimeWindow } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Data point with timestamp
 */
export interface TimestampedData<T> {
  timestamp: Timestamp;
  data: T;
}

/**
 * Configuration for time-windowed storage
 */
export interface TimeWindowConfig {
  /** Maximum age of data to keep (ms) */
  maxAgeMs: number;

  /** Cleanup interval (ms) */
  cleanupIntervalMs: number;

  /** Maximum items to store (prevents memory issues) */
  maxItems: number;
}

/**
 * Aggregation result for a time window
 */
export interface WindowAggregation<T> {
  /** Start of window */
  windowStart: Timestamp;

  /** End of window */
  windowEnd: Timestamp;

  /** Items in window */
  items: T[];

  /** Count of items */
  count: number;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: TimeWindowConfig = {
  maxAgeMs: TimeWindow.TWO_HOURS,
  cleanupIntervalMs: 30 * 1000, // 30 seconds
  maxItems: 10000,
};

// =============================================================================
// TIME-WINDOWED STORAGE CLASS
// =============================================================================

/**
 * Time-windowed data storage with automatic cleanup
 */
export class TimeWindowedStorage<T> {
  private data: TimestampedData<T>[] = [];
  private config: TimeWindowConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lastCleanup: Timestamp = Date.now();

  constructor(config: Partial<TimeWindowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Starts automatic cleanup
   */
  start(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Stops automatic cleanup
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Adds a data point with current timestamp
   */
  add(data: T, timestamp: Timestamp = Date.now()): void {
    // Enforce max items limit
    if (this.data.length >= this.config.maxItems) {
      // Remove oldest 10%
      const removeCount = Math.floor(this.config.maxItems * 0.1);
      this.data.splice(0, removeCount);
    }

    this.data.push({ timestamp, data });
  }

  /**
   * Gets all data within a time window
   */
  getWindow(windowMs: number, referenceTime: Timestamp = Date.now()): T[] {
    const cutoff = referenceTime - windowMs;
    return this.data
      .filter(item => item.timestamp >= cutoff)
      .map(item => item.data);
  }

  /**
   * Gets timestamped data within a time window
   */
  getWindowWithTimestamps(
    windowMs: number,
    referenceTime: Timestamp = Date.now()
  ): TimestampedData<T>[] {
    const cutoff = referenceTime - windowMs;
    return this.data.filter(item => item.timestamp >= cutoff);
  }

  /**
   * Gets aggregation for multiple time windows
   */
  getMultiWindowAggregation(
    windows: number[],
    referenceTime: Timestamp = Date.now()
  ): Map<number, WindowAggregation<T>> {
    const result = new Map<number, WindowAggregation<T>>();

    for (const windowMs of windows) {
      const cutoff = referenceTime - windowMs;
      const items = this.data
        .filter(item => item.timestamp >= cutoff)
        .map(item => item.data);

      result.set(windowMs, {
        windowStart: cutoff,
        windowEnd: referenceTime,
        items,
        count: items.length,
      });
    }

    return result;
  }

  /**
   * Gets data at a specific point in the past
   */
  getDataAt(
    msAgo: number,
    referenceTime: Timestamp = Date.now()
  ): T | undefined {
    const targetTime = referenceTime - msAgo;

    // Find closest data point
    let closest: TimestampedData<T> | undefined;
    let closestDiff = Infinity;

    for (const item of this.data) {
      const diff = Math.abs(item.timestamp - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = item;
      }
    }

    // Only return if within 10% of the window
    const tolerance = msAgo * 0.1;
    if (closest && closestDiff <= tolerance) {
      return closest.data;
    }

    return undefined;
  }

  /**
   * Gets the oldest data point
   */
  getOldest(): TimestampedData<T> | undefined {
    return this.data[0];
  }

  /**
   * Gets the newest data point
   */
  getNewest(): TimestampedData<T> | undefined {
    return this.data[this.data.length - 1];
  }

  /**
   * Gets count of items in a window
   */
  getCount(windowMs?: number, referenceTime: Timestamp = Date.now()): number {
    if (windowMs === undefined) {
      return this.data.length;
    }

    const cutoff = referenceTime - windowMs;
    return this.data.filter(item => item.timestamp >= cutoff).length;
  }

  /**
   * Checks if there's sufficient data for a time window
   */
  hasDataFor(windowMs: number, minItems: number = 1): boolean {
    const cutoff = Date.now() - windowMs;
    const count = this.data.filter(item => item.timestamp >= cutoff).length;
    return count >= minItems;
  }

  /**
   * Gets the time span of stored data
   */
  getTimeSpan(): number {
    if (this.data.length < 2) {
      return 0;
    }

    const oldest = this.data[0]?.timestamp ?? 0;
    const newest = this.data[this.data.length - 1]?.timestamp ?? 0;
    return newest - oldest;
  }

  /**
   * Cleans up old data
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.maxAgeMs;

    const beforeCount = this.data.length;
    this.data = this.data.filter(item => item.timestamp >= cutoff);
    const afterCount = this.data.length;

    this.lastCleanup = now;

    if (beforeCount !== afterCount) {
      // Could log cleanup stats if needed
    }
  }

  /**
   * Clears all data
   */
  clear(): void {
    this.data = [];
  }

  /**
   * Gets storage statistics
   */
  getStats(): {
    itemCount: number;
    oldestTimestamp: Timestamp | null;
    newestTimestamp: Timestamp | null;
    timeSpanMs: number;
    lastCleanup: Timestamp;
    memoryEstimateBytes: number;
  } {
    const oldest = this.data[0];
    const newest = this.data[this.data.length - 1];

    return {
      itemCount: this.data.length,
      oldestTimestamp: oldest?.timestamp ?? null,
      newestTimestamp: newest?.timestamp ?? null,
      timeSpanMs: this.getTimeSpan(),
      lastCleanup: this.lastCleanup,
      // Rough estimate: 100 bytes per item average
      memoryEstimateBytes: this.data.length * 100,
    };
  }
}

// =============================================================================
// SPECIALIZED STORAGES
// =============================================================================

/**
 * Storage optimized for numeric aggregations
 */
export class NumericWindowStorage extends TimeWindowedStorage<number> {
  /**
   * Gets sum of values in a window
   */
  getSum(windowMs: number, referenceTime?: Timestamp): number {
    const values = this.getWindow(windowMs, referenceTime);
    return values.reduce((sum, val) => sum + val, 0);
  }

  /**
   * Gets average of values in a window
   */
  getAverage(windowMs: number, referenceTime?: Timestamp): number {
    const values = this.getWindow(windowMs, referenceTime);
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Gets min value in a window
   */
  getMin(windowMs: number, referenceTime?: Timestamp): number {
    const values = this.getWindow(windowMs, referenceTime);
    if (values.length === 0) return 0;
    return Math.min(...values);
  }

  /**
   * Gets max value in a window
   */
  getMax(windowMs: number, referenceTime?: Timestamp): number {
    const values = this.getWindow(windowMs, referenceTime);
    if (values.length === 0) return 0;
    return Math.max(...values);
  }

  /**
   * Gets standard deviation in a window
   */
  getStdDev(windowMs: number, referenceTime?: Timestamp): number {
    const values = this.getWindow(windowMs, referenceTime);
    if (values.length < 2) return 0;

    const avg = this.getAverage(windowMs, referenceTime);
    const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Gets velocity (rate of change)
   */
  getVelocity(windowMs: number, referenceTime?: Timestamp): number {
    const now = referenceTime ?? Date.now();
    const items = this.getWindowWithTimestamps(windowMs, now);

    if (items.length < 2) return 0;

    // Linear regression for velocity
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    const n = items.length;

    for (const item of items) {
      const x = (item.timestamp - now + windowMs) / windowMs; // Normalize to 0-1
      const y = item.data;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return isNaN(slope) ? 0 : slope;
  }
}

/**
 * Storage optimized for bigint values (like SOL amounts)
 */
export class BigIntWindowStorage extends TimeWindowedStorage<bigint> {
  /**
   * Gets sum of values in a window
   */
  getSum(windowMs: number, referenceTime?: Timestamp): bigint {
    const values = this.getWindow(windowMs, referenceTime);
    return values.reduce((sum, val) => sum + val, 0n);
  }

  /**
   * Gets average of values in a window (returns bigint, truncated)
   */
  getAverage(windowMs: number, referenceTime?: Timestamp): bigint {
    const values = this.getWindow(windowMs, referenceTime);
    if (values.length === 0) return 0n;
    return values.reduce((sum, val) => sum + val, 0n) / BigInt(values.length);
  }

  /**
   * Gets min value in a window
   */
  getMin(windowMs: number, referenceTime?: Timestamp): bigint {
    const values = this.getWindow(windowMs, referenceTime);
    if (values.length === 0) return 0n;
    return values.reduce((min, val) => (val < min ? val : min), values[0] ?? 0n);
  }

  /**
   * Gets max value in a window
   */
  getMax(windowMs: number, referenceTime?: Timestamp): bigint {
    const values = this.getWindow(windowMs, referenceTime);
    if (values.length === 0) return 0n;
    return values.reduce((max, val) => (val > max ? val : max), values[0] ?? 0n);
  }
}

// =============================================================================
// SNAPSHOT STORAGE
// =============================================================================

/**
 * Storage for periodic snapshots (like holder data)
 */
export class SnapshotStorage<T> {
  private snapshots: TimestampedData<T>[] = [];
  private config: {
    maxSnapshots: number;
    maxAgeMs: number;
  };

  constructor(config: { maxSnapshots?: number; maxAgeMs?: number } = {}) {
    this.config = {
      maxSnapshots: config.maxSnapshots ?? 100,
      maxAgeMs: config.maxAgeMs ?? TimeWindow.TWO_HOURS,
    };
  }

  /**
   * Adds a snapshot
   */
  addSnapshot(data: T, timestamp: Timestamp = Date.now()): void {
    this.snapshots.push({ timestamp, data });

    // Enforce limits
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    // Remove old snapshots
    const cutoff = timestamp - this.config.maxAgeMs;
    this.snapshots = this.snapshots.filter(s => s.timestamp >= cutoff);
  }

  /**
   * Gets the latest snapshot
   */
  getLatest(): T | undefined {
    return this.snapshots[this.snapshots.length - 1]?.data;
  }

  /**
   * Gets snapshot from approximately N ms ago
   */
  getSnapshotAt(msAgo: number, referenceTime: Timestamp = Date.now()): T | undefined {
    const targetTime = referenceTime - msAgo;

    // Find closest snapshot
    let closest: TimestampedData<T> | undefined;
    let closestDiff = Infinity;

    for (const snapshot of this.snapshots) {
      const diff = Math.abs(snapshot.timestamp - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = snapshot;
      }
    }

    return closest?.data;
  }

  /**
   * Gets all snapshots within a time window
   */
  getSnapshots(windowMs: number, referenceTime: Timestamp = Date.now()): T[] {
    const cutoff = referenceTime - windowMs;
    return this.snapshots
      .filter(s => s.timestamp >= cutoff)
      .map(s => s.data);
  }

  /**
   * Gets snapshot count
   */
  getCount(): number {
    return this.snapshots.length;
  }

  /**
   * Clears all snapshots
   */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Gets time span of snapshots
   */
  getTimeSpan(): number {
    if (this.snapshots.length < 2) return 0;
    const oldest = this.snapshots[0]?.timestamp ?? 0;
    const newest = this.snapshots[this.snapshots.length - 1]?.timestamp ?? 0;
    return newest - oldest;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Creates a storage for trade data
 */
export function createTradeStorage(): TimeWindowedStorage<{
  id: string;
  type: 'buy' | 'sell';
  trader: string;
  solAmount: bigint;
  tokenAmount: bigint;
}> {
  return new TimeWindowedStorage({
    maxAgeMs: TimeWindow.TWO_HOURS,
    maxItems: 5000,
  });
}

/**
 * Creates a storage for volume data
 */
export function createVolumeStorage(): BigIntWindowStorage {
  return new BigIntWindowStorage({
    maxAgeMs: TimeWindow.TWO_HOURS,
    maxItems: 5000,
  });
}

/**
 * Creates a storage for holder snapshots
 */
export function createHolderSnapshotStorage<T>(): SnapshotStorage<T> {
  return new SnapshotStorage({
    maxSnapshots: 120, // 2 hours at 1 per minute
    maxAgeMs: TimeWindow.TWO_HOURS,
  });
}

/**
 * Creates a storage for progress tracking
 */
export function createProgressStorage(): NumericWindowStorage {
  return new NumericWindowStorage({
    maxAgeMs: TimeWindow.TWO_HOURS,
    maxItems: 1000,
  });
}
