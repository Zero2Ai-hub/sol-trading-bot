/**
 * Base Analyzer Class
 *
 * Abstract base class for all data analyzers.
 * Provides common functionality for metric calculation,
 * health monitoring, and event handling.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';
import type { PumpFunEventEmitter, TokenLaunchedEvent } from '../core/events.js';
import { getComponentLogger, type ComponentLogger } from '../infrastructure/logger/index.js';
import {
  type AnalyzerConfig,
  type AnalyzerHealth,
  type BaseMetrics,
  AnalyzerStatus,
} from './types.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Token tracking entry
 */
export interface TrackedTokenEntry {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Bonding curve address */
  bondingCurveAddress: SolanaAddress;

  /** Token name */
  name?: string;

  /** Token symbol */
  symbol?: string;

  /** Creator address */
  creator: SolanaAddress;

  /** First seen timestamp */
  firstSeenAt: Timestamp;

  /** Last update timestamp */
  lastUpdateAt: Timestamp;

  /** Has migrated? */
  hasMigrated: boolean;
}

/**
 * Base analyzer configuration
 */
const DEFAULT_CONFIG: AnalyzerConfig = {
  updateIntervalMs: 30_000, // 30 seconds
  maxDataAgeMs: 120_000, // 2 minutes before considered stale
  debug: false,
};

// =============================================================================
// BASE ANALYZER CLASS
// =============================================================================

/**
 * Abstract base class for all analyzers
 */
export abstract class BaseAnalyzer<
  TMetrics extends BaseMetrics,
  TConfig extends AnalyzerConfig = AnalyzerConfig
> {
  /** Analyzer name for logging */
  protected abstract readonly name: string;

  /** Logger instance */
  protected logger: ComponentLogger | null = null;

  /** Configuration */
  protected config: TConfig;

  /** Tracked tokens */
  protected trackedTokens: Map<SolanaAddress, TrackedTokenEntry> = new Map();

  /** Calculated metrics per token */
  protected metrics: Map<SolanaAddress, TMetrics> = new Map();

  /** Event emitter reference */
  protected eventEmitter: PumpFunEventEmitter | null = null;

  /** Analyzer status */
  protected status: AnalyzerStatus = AnalyzerStatus.IDLE;

  /** Start timestamp */
  protected startedAt: Timestamp | null = null;

  /** Last update timestamp */
  protected lastUpdateAt: Timestamp | null = null;

  /** Update counter */
  protected updateCount = 0;

  /** Error counter */
  protected errorCount = 0;

  /** Last error message */
  protected lastError?: string;

  /** Update timer */
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<TConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as TConfig;
  }

  // ===========================================================================
  // LIFECYCLE METHODS
  // ===========================================================================

  /**
   * Initializes the analyzer
   */
  initialize(): void {
    this.logger = getComponentLogger(this.name);
    this.status = AnalyzerStatus.IDLE;

    this.logger.info(`${this.name} initialized`, {
      config: this.config,
    });

    // Call subclass initialization
    this.onInitialize();
  }

  /**
   * Hook for subclass initialization
   */
  protected onInitialize(): void {
    // Override in subclass if needed
  }

  /**
   * Starts the analyzer
   */
  start(eventEmitter: PumpFunEventEmitter): void {
    if (this.status === AnalyzerStatus.RUNNING) {
      this.logger?.warn(`${this.name} already running`);
      return;
    }

    this.eventEmitter = eventEmitter;
    this.status = AnalyzerStatus.RUNNING;
    this.startedAt = Date.now();

    // Subscribe to events
    this.subscribeToEvents(eventEmitter);

    // Start periodic updates
    this.startUpdateTimer();

    this.logger?.info(`${this.name} started`);

    // Call subclass start
    this.onStart();
  }

  /**
   * Hook for subclass start
   */
  protected onStart(): void {
    // Override in subclass if needed
  }

  /**
   * Stops the analyzer
   */
  stop(): void {
    if (this.status === AnalyzerStatus.IDLE) {
      return;
    }

    // Stop update timer
    this.stopUpdateTimer();

    // Unsubscribe from events
    if (this.eventEmitter) {
      this.unsubscribeFromEvents(this.eventEmitter);
    }

    this.status = AnalyzerStatus.IDLE;

    this.logger?.info(`${this.name} stopped`, {
      trackedTokens: this.trackedTokens.size,
      updateCount: this.updateCount,
      errorCount: this.errorCount,
    });

    // Call subclass stop
    this.onStop();
  }

  /**
   * Hook for subclass stop
   */
  protected onStop(): void {
    // Override in subclass if needed
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  /**
   * Subscribes to relevant events
   */
  protected subscribeToEvents(eventEmitter: PumpFunEventEmitter): void {
    eventEmitter.on('token:launched', event => this.handleTokenLaunched(event));
    eventEmitter.on('token:migration', event => this.handleTokenMigration(event.mintAddress));

    // Let subclass subscribe to additional events
    this.onSubscribeEvents(eventEmitter);
  }

  /**
   * Hook for subclass event subscriptions
   */
  protected onSubscribeEvents(eventEmitter: PumpFunEventEmitter): void {
    // Override in subclass
  }

  /**
   * Unsubscribes from events
   */
  protected unsubscribeFromEvents(eventEmitter: PumpFunEventEmitter): void {
    eventEmitter.removeAllListeners('token:launched');
    eventEmitter.removeAllListeners('token:migration');

    // Let subclass unsubscribe
    this.onUnsubscribeEvents(eventEmitter);
  }

  /**
   * Hook for subclass event unsubscription
   */
  protected onUnsubscribeEvents(eventEmitter: PumpFunEventEmitter): void {
    // Override in subclass
  }

  /**
   * Handles new token launch
   */
  protected handleTokenLaunched(event: TokenLaunchedEvent): void {
    const entry: TrackedTokenEntry = {
      mintAddress: event.mintAddress,
      bondingCurveAddress: event.bondingCurveAddress,
      name: event.name,
      symbol: event.symbol,
      creator: event.creator,
      firstSeenAt: event.timestamp,
      lastUpdateAt: event.timestamp,
      hasMigrated: false,
    };

    this.trackedTokens.set(event.mintAddress, entry);

    this.logger?.debug('Token added to tracking', {
      mint: event.mintAddress,
      symbol: event.symbol,
    });

    // Let subclass handle
    this.onTokenLaunched(event);
  }

  /**
   * Hook for subclass token launch handling
   */
  protected onTokenLaunched(event: TokenLaunchedEvent): void {
    // Override in subclass
  }

  /**
   * Handles token migration
   */
  protected handleTokenMigration(mintAddress: SolanaAddress): void {
    const entry = this.trackedTokens.get(mintAddress);
    if (entry) {
      entry.hasMigrated = true;
      entry.lastUpdateAt = Date.now();
    }

    this.logger?.debug('Token migrated', { mint: mintAddress });

    // Let subclass handle
    this.onTokenMigration(mintAddress);
  }

  /**
   * Hook for subclass migration handling
   */
  protected onTokenMigration(mintAddress: SolanaAddress): void {
    // Override in subclass
  }

  // ===========================================================================
  // UPDATE METHODS
  // ===========================================================================

  /**
   * Starts periodic update timer
   */
  private startUpdateTimer(): void {
    if (this.updateTimer) {
      return;
    }

    this.updateTimer = setInterval(() => {
      this.runUpdate();
    }, this.config.updateIntervalMs);
  }

  /**
   * Stops update timer
   */
  private stopUpdateTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Runs periodic update
   */
  private async runUpdate(): Promise<void> {
    try {
      await this.update();
      this.lastUpdateAt = Date.now();
      this.updateCount++;

      // Check for stale data
      if (this.hasStaleData()) {
        this.status = AnalyzerStatus.STALE;
      } else {
        this.status = AnalyzerStatus.RUNNING;
      }
    } catch (error) {
      this.errorCount++;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.status = AnalyzerStatus.ERROR;

      this.logger?.error('Update failed', {
        error: this.lastError,
      });
    }
  }

  /**
   * Abstract method for subclass to implement update logic
   */
  protected abstract update(): Promise<void>;

  /**
   * Checks if data is stale
   */
  private hasStaleData(): boolean {
    if (!this.lastUpdateAt) {
      return false;
    }
    return Date.now() - this.lastUpdateAt > this.config.maxDataAgeMs;
  }

  // ===========================================================================
  // METRICS ACCESS
  // ===========================================================================

  /**
   * Gets metrics for a specific token
   */
  getMetrics(mintAddress: SolanaAddress): TMetrics | undefined {
    return this.metrics.get(mintAddress);
  }

  /**
   * Gets metrics for all tracked tokens
   */
  getAllMetrics(): Map<SolanaAddress, TMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Gets metrics for tokens matching a predicate
   */
  getMetricsWhere(predicate: (metrics: TMetrics) => boolean): TMetrics[] {
    return Array.from(this.metrics.values()).filter(predicate);
  }

  /**
   * Checks if a token is being tracked
   */
  isTracking(mintAddress: SolanaAddress): boolean {
    return this.trackedTokens.has(mintAddress);
  }

  /**
   * Gets list of tracked token addresses
   */
  getTrackedTokens(): SolanaAddress[] {
    return Array.from(this.trackedTokens.keys());
  }

  /**
   * Gets count of tracked tokens
   */
  getTrackedCount(): number {
    return this.trackedTokens.size;
  }

  // ===========================================================================
  // HEALTH & DIAGNOSTICS
  // ===========================================================================

  /**
   * Gets analyzer health status
   */
  getHealth(): AnalyzerHealth {
    return {
      name: this.name,
      status: this.status,
      trackedTokens: this.trackedTokens.size,
      lastUpdateAt: this.lastUpdateAt,
      updateCount: this.updateCount,
      errorCount: this.errorCount,
      lastError: this.lastError,
      memoryUsageBytes: this.estimateMemoryUsage(),
      isHealthy: this.isHealthy(),
    };
  }

  /**
   * Checks if analyzer is healthy
   */
  isHealthy(): boolean {
    return (
      this.status === AnalyzerStatus.RUNNING &&
      this.errorCount < 10 &&
      !this.hasStaleData()
    );
  }

  /**
   * Estimates memory usage
   */
  protected estimateMemoryUsage(): number {
    // Base estimate: 1KB per tracked token + 500 bytes per metric
    return this.trackedTokens.size * 1024 + this.metrics.size * 500;
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  /**
   * Removes a token from tracking
   */
  removeToken(mintAddress: SolanaAddress): void {
    this.trackedTokens.delete(mintAddress);
    this.metrics.delete(mintAddress);

    // Let subclass clean up
    this.onTokenRemoved(mintAddress);
  }

  /**
   * Hook for subclass token removal handling
   */
  protected onTokenRemoved(mintAddress: SolanaAddress): void {
    // Override in subclass
  }

  /**
   * Cleans up old/migrated tokens
   */
  cleanup(maxAgeMs: number = 2 * 60 * 60 * 1000): void {
    const now = Date.now();
    const toRemove: SolanaAddress[] = [];

    for (const [mintAddress, entry] of this.trackedTokens) {
      // Remove migrated tokens after some time
      if (entry.hasMigrated && now - entry.lastUpdateAt > 5 * 60 * 1000) {
        toRemove.push(mintAddress);
        continue;
      }

      // Remove old inactive tokens
      if (now - entry.lastUpdateAt > maxAgeMs) {
        toRemove.push(mintAddress);
      }
    }

    for (const mintAddress of toRemove) {
      this.removeToken(mintAddress);
    }

    if (toRemove.length > 0) {
      this.logger?.debug('Cleanup completed', {
        removed: toRemove.length,
        remaining: this.trackedTokens.size,
      });
    }
  }

  /**
   * Clears all tracked tokens and metrics
   */
  clear(): void {
    this.trackedTokens.clear();
    this.metrics.clear();
    this.updateCount = 0;
    this.errorCount = 0;
    this.lastError = undefined;
    this.lastUpdateAt = null;
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Creates base metrics with common fields
 */
export function createBaseMetrics(
  mintAddress: SolanaAddress,
  confidence: number = 1,
  lastUpdateAt?: Timestamp
): Omit<BaseMetrics, keyof BaseMetrics> & BaseMetrics {
  const now = Date.now();
  const dataAge = lastUpdateAt ? now - lastUpdateAt : 0;

  return {
    mintAddress,
    calculatedAt: now,
    confidence,
    isStale: dataAge > 120_000, // 2 minutes
    dataAgeMs: dataAge,
  };
}

/**
 * Calculates confidence based on data availability
 */
export function calculateConfidence(
  hasVolume: boolean,
  hasHolders: boolean,
  hasLiquidity: boolean,
  hasSafety: boolean
): number {
  const weights = { volume: 0.3, holders: 0.2, liquidity: 0.3, safety: 0.2 };

  let confidence = 0;
  if (hasVolume) confidence += weights.volume;
  if (hasHolders) confidence += weights.holders;
  if (hasLiquidity) confidence += weights.liquidity;
  if (hasSafety) confidence += weights.safety;

  return Math.min(confidence, 1);
}

/**
 * Normalizes a score to 0-10 range
 */
export function normalizeScore(value: number, min: number, max: number): number {
  if (max === min) return 5;
  const normalized = ((value - min) / (max - min)) * 10;
  return Math.max(0, Math.min(10, normalized));
}

/**
 * Converts score to risk level
 */
export function scoreToRiskLevel(score: number): import('./types.js').RiskLevel {
  const { RiskLevel } = require('./types.js');
  if (score >= 8) return RiskLevel.LOW;
  if (score >= 6) return RiskLevel.MEDIUM;
  if (score >= 4) return RiskLevel.HIGH;
  return RiskLevel.CRITICAL;
}

/**
 * Safely divides two bigints, returning number
 */
export function safeBigIntDivide(
  numerator: bigint,
  denominator: bigint,
  decimals: number = 9
): number {
  if (denominator === 0n) return 0;
  const scale = BigInt(10 ** decimals);
  const result = (numerator * scale) / denominator;
  return Number(result) / 10 ** decimals;
}

/**
 * Converts lamports to SOL
 */
export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1e9;
}

/**
 * Converts SOL to lamports
 */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * 1e9));
}
