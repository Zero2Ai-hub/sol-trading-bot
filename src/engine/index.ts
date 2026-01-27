/**
 * Momentum Engine
 *
 * Central orchestrator for the Phase 4 momentum scoring system.
 * Combines analyzers, scoring, signals, rankings, and persistence.
 *
 * Architecture:
 * ```
 * Raw Events → Analyzers → Engine → Signals → Execution
 *                           │
 *                           ├→ Rankings (top 20)
 *                           └→ Persistence (DB)
 * ```
 */

import { EventEmitter } from 'events';
import type { PumpFunEventEmitter } from '../core/events.js';
import type { SolanaAddress, Timestamp } from '../core/types.js';
import { db as defaultDb, type QueryResult } from '../infrastructure/database/index.js';

/** Database interface for engine */
interface DatabaseInterface {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  getClient(): Promise<{ query: (text: string, values?: unknown[]) => Promise<any>; release: () => void }>;
}
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { momentumAggregator } from '../analyzers/momentum.js';
import type { MomentumMetrics } from '../analyzers/types.js';
import {
  TradingSignal,
  type GeneratedSignal,
  type MomentumEngineConfig,
  type RankingEntry,
  type RankingsSnapshot,
  DEFAULT_ENGINE_CONFIG,
} from './types.js';
import {
  generateSignal,
  generateSignalsBatch,
  getActionableSignals,
  type TokenMetricsBundle,
} from './signals.js';
import { RankingsManager, type RankingStatistics } from './rankings.js';
import { SignalRepository, SignalBuffer } from './persistence.js';

// Re-export types and utilities
export * from './types.js';
export * from './scoring.js';
export * from './signals.js';
export * from './rankings.js';
export * from './persistence.js';

// =============================================================================
// ENGINE EVENTS
// =============================================================================

export interface MomentumEngineEvents {
  /** Emitted when a new signal is generated */
  signal: (signal: GeneratedSignal) => void;

  /** Emitted when an actionable signal is detected */
  actionableSignal: (signal: GeneratedSignal) => void;

  /** Emitted when rankings are updated */
  rankingsUpdated: (snapshot: RankingsSnapshot) => void;

  /** Emitted when a token enters top 10 */
  topEntry: (entry: RankingEntry) => void;

  /** Emitted when a token exits top 10 */
  topExit: (entry: RankingEntry) => void;

  /** Emitted on engine errors */
  error: (error: Error, context: string) => void;

  /** Emitted when engine starts */
  started: () => void;

  /** Emitted when engine stops */
  stopped: () => void;
}

// =============================================================================
// MOMENTUM ENGINE
// =============================================================================

const logger = getComponentLogger('MomentumEngine');

/**
 * Momentum Engine - orchestrates all Phase 4 components
 */
export class MomentumEngine extends EventEmitter {
  private config: MomentumEngineConfig;
  private rankings: RankingsManager;
  private signalRepo: SignalRepository | null = null;
  private signalBuffer: SignalBuffer;
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastUpdate: Timestamp = 0;

  // Cache for latest signals
  private signalCache: Map<string, GeneratedSignal> = new Map();

  constructor(
    config: Partial<MomentumEngineConfig> = {},
    db?: DatabaseInterface
  ) {
    super();
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.rankings = new RankingsManager(this.config);
    this.signalBuffer = new SignalBuffer(50);

    // Set up persistence if database provided
    if (db) {
      this.signalRepo = new SignalRepository(db);
      this.signalBuffer.onFlush(async (signals) => {
        try {
          await this.signalRepo!.saveSignalsBatch(signals);
          logger.debug('Flushed signal buffer', { count: signals.length });
        } catch (error) {
          logger.error('Failed to flush signal buffer', { error });
        }
      });
    }

    // Forward ranking events
    this.rankings.on('topNEntry', (entry, threshold) => {
      logger.info('Token entered top rankings', {
        mint: entry.mintAddress,
        rank: entry.rank,
        score: entry.momentumScore,
        threshold,
      });
      this.emit('topEntry', entry);
    });

    this.rankings.on('topNExit', (entry, threshold) => {
      logger.info('Token exited top rankings', {
        mint: entry.mintAddress,
        score: entry.momentumScore,
        threshold,
      });
      this.emit('topExit', entry);
    });

    this.rankings.on('rankingsUpdated', (snapshot) => {
      this.emit('rankingsUpdated', snapshot);
    });
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Starts the momentum engine
   */
  start(eventEmitter: PumpFunEventEmitter): void {
    if (this.isRunning) {
      logger.warn('Engine already running');
      return;
    }

    logger.info('Starting momentum engine', {
      updateInterval: this.config.updateIntervalMs,
      thresholds: this.config.thresholds,
    });

    // Initialize the momentum aggregator
    momentumAggregator.initialize();
    momentumAggregator.start(eventEmitter);

    // Start update loop
    this.updateInterval = setInterval(() => {
      this.update().catch(error => {
        logger.error('Update loop error', { error });
        this.emit('error', error, 'update-loop');
      });
    }, this.config.updateIntervalMs);

    this.isRunning = true;
    this.emit('started');
    logger.info('Momentum engine started');
  }

  /**
   * Stops the momentum engine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping momentum engine');

    // Stop update loop
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Flush any pending signals
    await this.signalBuffer.flush();

    // Stop aggregator
    momentumAggregator.stop();

    this.isRunning = false;
    this.emit('stopped');
    logger.info('Momentum engine stopped');
  }

  /**
   * Checks if engine is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  // ===========================================================================
  // UPDATE CYCLE
  // ===========================================================================

  /**
   * Performs a full update cycle
   */
  private async update(): Promise<void> {
    const startTime = Date.now();

    try {
      // Get all tracked tokens from aggregator
      const trackedTokens = momentumAggregator.getTrackedTokens();

      if (trackedTokens.length === 0) {
        return;
      }

      // Build metrics bundles
      const bundles: TokenMetricsBundle[] = trackedTokens.map(mint => {
        const metrics = momentumAggregator.getMomentumMetrics(mint);
        return {
          mintAddress: mint,
          volume: metrics?.volume ?? null,
          holders: metrics?.holders ?? null,
          liquidity: metrics?.liquidity ?? null,
          safety: metrics?.safety ?? null,
        };
      });

      // Generate signals for all tokens
      const signals = generateSignalsBatch(bundles, this.config);

      // Update cache
      for (const signal of signals) {
        this.signalCache.set(signal.mintAddress, signal);
        this.emit('signal', signal);
      }

      // Update rankings
      this.rankings.updateTokensBatch(signals);

      // Get actionable signals
      const actionable = getActionableSignals(signals);
      for (const signal of actionable) {
        this.emit('actionableSignal', signal);
      }

      // Buffer signals for persistence
      if (this.signalRepo) {
        await this.signalBuffer.addBatch(actionable);
      }

      this.lastUpdate = Date.now();

      logger.debug('Update cycle complete', {
        tokens: trackedTokens.length,
        signals: signals.length,
        actionable: actionable.length,
        durationMs: Date.now() - startTime,
      });

    } catch (error) {
      logger.error('Update cycle failed', { error });
      throw error;
    }
  }

  // ===========================================================================
  // SIGNAL QUERIES
  // ===========================================================================

  /**
   * Gets the latest signal for a token
   */
  getSignal(mintAddress: SolanaAddress): GeneratedSignal | undefined {
    return this.signalCache.get(mintAddress);
  }

  /**
   * Generates a fresh signal for a token (bypasses cache)
   */
  generateFreshSignal(mintAddress: SolanaAddress): GeneratedSignal | null {
    const metrics = momentumAggregator.getMomentumMetrics(mintAddress);
    if (!metrics) return null;

    return generateSignal(
      mintAddress,
      metrics.volume,
      metrics.holders,
      metrics.liquidity,
      metrics.safety,
      this.config
    );
  }

  /**
   * Gets all current actionable signals
   */
  getActionableSignals(): GeneratedSignal[] {
    return Array.from(this.signalCache.values())
      .filter(s => s.shouldExecute);
  }

  /**
   * Gets signals by type
   */
  getSignalsByType(type: TradingSignal): GeneratedSignal[] {
    return Array.from(this.signalCache.values())
      .filter(s => s.signal === type);
  }

  /**
   * Gets top N signals by score
   */
  getTopSignals(n: number = 10): GeneratedSignal[] {
    return Array.from(this.signalCache.values())
      .sort((a, b) => b.momentumScore - a.momentumScore)
      .slice(0, n);
  }

  // ===========================================================================
  // RANKING QUERIES
  // ===========================================================================

  /**
   * Gets current rankings snapshot
   */
  getRankings(): RankingsSnapshot {
    return this.rankings.getSnapshot();
  }

  /**
   * Gets top N ranked tokens
   */
  getTopRanked(n: number = 20): RankingEntry[] {
    return this.rankings.getTopN(n);
  }

  /**
   * Gets tokens in entry zone
   */
  getEntryZoneTokens(): RankingEntry[] {
    return this.rankings.getEntryZoneTokens();
  }

  /**
   * Gets ranking for a specific token
   */
  getTokenRanking(mintAddress: SolanaAddress): RankingEntry | undefined {
    return this.rankings.getRanking(mintAddress);
  }

  /**
   * Gets ranking statistics
   */
  getRankingStats(): RankingStatistics {
    return this.rankings.getStatistics();
  }

  // ===========================================================================
  // HEALTH & STATUS
  // ===========================================================================

  /**
   * Gets engine health status
   */
  getHealth(): EngineHealth {
    const aggregatorHealth = momentumAggregator.getAnalyzerHealth();
    const rankingStats = this.rankings.getStatistics();

    return {
      isRunning: this.isRunning,
      lastUpdate: this.lastUpdate,
      timeSinceUpdate: Date.now() - this.lastUpdate,
      trackedTokens: rankingStats.totalTracked,
      rankedTokens: rankingStats.rankedCount,
      cachedSignals: this.signalCache.size,
      pendingSignals: this.signalBuffer.size(),
      analyzers: aggregatorHealth,
      signalCounts: rankingStats.signalCounts,
    };
  }

  /**
   * Gets detailed status for logging
   */
  getStatus(): string {
    const health = this.getHealth();
    const top3 = this.getTopRanked(3);

    const lines = [
      `Momentum Engine Status`,
      `  Running: ${health.isRunning}`,
      `  Last Update: ${health.timeSinceUpdate}ms ago`,
      `  Tracked: ${health.trackedTokens} tokens`,
      `  Cached Signals: ${health.cachedSignals}`,
      `  Top 3:`,
    ];

    for (const entry of top3) {
      lines.push(`    #${entry.rank} ${entry.symbol ?? entry.mintAddress.slice(0, 8)}: ${entry.momentumScore}/100 [${entry.signal}]`);
    }

    return lines.join('\n');
  }

  // ===========================================================================
  // PERSISTENCE QUERIES
  // ===========================================================================

  /**
   * Marks a signal as executed
   */
  async markSignalExecuted(
    signalId: string,
    result: 'success' | 'failed' | 'skipped',
    notes?: string
  ): Promise<void> {
    if (!this.signalRepo) {
      throw new Error('Database not configured');
    }
    await this.signalRepo.markExecuted(signalId, result, notes);
  }

  /**
   * Gets historical signals for a token
   */
  async getHistoricalSignals(
    mintAddress: SolanaAddress,
    limit: number = 10
  ): Promise<GeneratedSignal[]> {
    if (!this.signalRepo) {
      throw new Error('Database not configured');
    }

    const records = await this.signalRepo.getRecentSignals(mintAddress, limit);

    // Convert records back to GeneratedSignal format
    return records.map(record => ({
      mintAddress: record.mintAddress,
      signal: record.signal,
      momentumScore: record.momentumScore,
      breakdown: record.scoreBreakdown,
      positionSizing: {
        sizePercent: 0,
        recommendedSizeSol: 0,
        maxSlippage: 0,
        reason: 'Historical record',
      },
      strength: 0,
      timestamp: record.timestamp,
      reasons: [],
      meetsEntryCriteria: false,
      shouldExecute: false,
    }));
  }
}

// =============================================================================
// HEALTH TYPE
// =============================================================================

export interface EngineHealth {
  isRunning: boolean;
  lastUpdate: Timestamp;
  timeSinceUpdate: number;
  trackedTokens: number;
  rankedTokens: number;
  cachedSignals: number;
  pendingSignals: number;
  analyzers: ReturnType<typeof momentumAggregator.getAnalyzerHealth>;
  signalCounts: Record<TradingSignal, number>;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/** Global momentum engine instance */
export const momentumEngine = new MomentumEngine();

/**
 * Initializes the global momentum engine with config
 */
export function initializeMomentumEngine(
  config?: Partial<MomentumEngineConfig>,
  db?: DatabaseInterface
): MomentumEngine {
  // Create new instance with config
  const engine = new MomentumEngine(config, db);

  // Replace global instance reference
  Object.assign(momentumEngine, engine);

  logger.info('Momentum engine initialized', { config });
  return momentumEngine;
}
