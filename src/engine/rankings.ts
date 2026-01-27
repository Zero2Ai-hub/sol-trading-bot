/**
 * Rankings System
 *
 * Tracks and ranks tokens by momentum score in real-time.
 * Phase 4 specification:
 * - Maintain top 20 rankings
 * - Track rank changes
 * - Emit events when tokens enter/exit top 10
 */

import { EventEmitter } from 'events';
import type { SolanaAddress, Timestamp } from '../core/types.js';
import type { LiquidityMetrics } from '../analyzers/types.js';
import {
  TradingSignal,
  type RankingEntry,
  type RankingsSnapshot,
  type GeneratedSignal,
  type MomentumEngineConfig,
  DEFAULT_ENGINE_CONFIG,
} from './types.js';

// =============================================================================
// RANKING EVENTS
// =============================================================================

export interface RankingEvents {
  /** Emitted when a token enters the top N */
  topNEntry: (entry: RankingEntry, threshold: number) => void;

  /** Emitted when a token exits the top N */
  topNExit: (entry: RankingEntry, threshold: number) => void;

  /** Emitted when rankings are updated */
  rankingsUpdated: (snapshot: RankingsSnapshot) => void;

  /** Emitted when a new token is added to tracking */
  tokenAdded: (mintAddress: SolanaAddress) => void;

  /** Emitted when a token is removed from tracking */
  tokenRemoved: (mintAddress: SolanaAddress) => void;
}

// =============================================================================
// RANKINGS MANAGER
// =============================================================================

/**
 * Internal token data for ranking
 */
interface TrackedToken {
  mintAddress: SolanaAddress;
  symbol?: string;
  momentumScore: number;
  signal: TradingSignal;
  bondingProgress: number;
  updatedAt: Timestamp;
  previousRank: number | null;
}

/**
 * Rankings Manager - tracks and ranks tokens by momentum
 */
export class RankingsManager extends EventEmitter {
  private trackedTokens: Map<string, TrackedToken> = new Map();
  private currentRankings: RankingEntry[] = [];
  private previousTop10: Set<string> = new Set();
  private config: MomentumEngineConfig;

  constructor(config: MomentumEngineConfig = DEFAULT_ENGINE_CONFIG) {
    super();
    this.config = config;
  }

  // ===========================================================================
  // TOKEN TRACKING
  // ===========================================================================

  /**
   * Updates a token's data and recalculates rankings
   */
  updateToken(signal: GeneratedSignal): void {
    const existing = this.trackedTokens.get(signal.mintAddress);

    const token: TrackedToken = {
      mintAddress: signal.mintAddress,
      symbol: existing?.symbol,
      momentumScore: signal.momentumScore,
      signal: signal.signal,
      bondingProgress: signal.breakdown.liquidity.progressPoints > 0
        ? this.estimateBondingProgress(signal.breakdown.liquidity.progressPoints)
        : existing?.bondingProgress ?? 0,
      updatedAt: signal.timestamp,
      previousRank: existing ? this.getCurrentRank(signal.mintAddress) : null,
    };

    const isNew = !existing;
    this.trackedTokens.set(signal.mintAddress, token);

    if (isNew) {
      this.emit('tokenAdded', signal.mintAddress);
    }

    // Recalculate rankings
    this.recalculateRankings();
  }

  /**
   * Updates multiple tokens at once
   */
  updateTokensBatch(signals: GeneratedSignal[]): void {
    for (const signal of signals) {
      const existing = this.trackedTokens.get(signal.mintAddress);

      const token: TrackedToken = {
        mintAddress: signal.mintAddress,
        symbol: existing?.symbol,
        momentumScore: signal.momentumScore,
        signal: signal.signal,
        bondingProgress: signal.breakdown.liquidity.progressPoints > 0
          ? this.estimateBondingProgress(signal.breakdown.liquidity.progressPoints)
          : existing?.bondingProgress ?? 0,
        updatedAt: signal.timestamp,
        previousRank: existing ? this.getCurrentRank(signal.mintAddress) : null,
      };

      const isNew = !existing;
      this.trackedTokens.set(signal.mintAddress, token);

      if (isNew) {
        this.emit('tokenAdded', signal.mintAddress);
      }
    }

    // Recalculate rankings once
    this.recalculateRankings();
  }

  /**
   * Sets token symbol (metadata)
   */
  setTokenSymbol(mintAddress: SolanaAddress, symbol: string): void {
    const token = this.trackedTokens.get(mintAddress);
    if (token) {
      token.symbol = symbol;
    }
  }

  /**
   * Removes a token from tracking
   */
  removeToken(mintAddress: SolanaAddress): void {
    if (this.trackedTokens.has(mintAddress)) {
      this.trackedTokens.delete(mintAddress);
      this.emit('tokenRemoved', mintAddress);
      this.recalculateRankings();
    }
  }

  /**
   * Prunes stale tokens (not updated recently)
   */
  pruneStaleTokens(maxAgeMs: number): number {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [mint, token] of this.trackedTokens) {
      if (now - token.updatedAt > maxAgeMs) {
        toRemove.push(mint);
      }
    }

    for (const mint of toRemove) {
      this.removeToken(mint);
    }

    return toRemove.length;
  }

  // ===========================================================================
  // RANKINGS CALCULATION
  // ===========================================================================

  /**
   * Recalculates rankings from current token data
   */
  private recalculateRankings(): void {
    // Sort by momentum score (descending)
    const sorted = Array.from(this.trackedTokens.values())
      .sort((a, b) => b.momentumScore - a.momentumScore);

    // Create ranking entries
    const newRankings: RankingEntry[] = sorted
      .slice(0, this.config.rankings.topN)
      .map((token, index) => {
        const rank = index + 1;
        const previousRank = token.previousRank;
        const rankChange = previousRank !== null ? previousRank - rank : 0;

        return {
          rank,
          previousRank,
          rankChange,
          mintAddress: token.mintAddress,
          symbol: token.symbol,
          momentumScore: token.momentumScore,
          signal: token.signal,
          bondingProgress: token.bondingProgress,
          inEntryZone: token.bondingProgress >= 70 && token.bondingProgress <= 95,
          updatedAt: token.updatedAt,
        };
      });

    // Detect top N threshold entries/exits
    const newTop10 = new Set(
      newRankings
        .filter(r => r.rank <= this.config.rankings.emitTopNThreshold)
        .map(r => r.mintAddress)
    );

    // Check for new entries
    for (const mint of newTop10) {
      if (!this.previousTop10.has(mint)) {
        const entry = newRankings.find(r => r.mintAddress === mint);
        if (entry) {
          this.emit('topNEntry', entry, this.config.rankings.emitTopNThreshold);
        }
      }
    }

    // Check for exits
    for (const mint of this.previousTop10) {
      if (!newTop10.has(mint)) {
        const token = this.trackedTokens.get(mint);
        if (token) {
          const entry: RankingEntry = {
            rank: this.getCurrentRank(mint) ?? 999,
            previousRank: token.previousRank,
            rankChange: 0,
            mintAddress: mint,
            symbol: token.symbol,
            momentumScore: token.momentumScore,
            signal: token.signal,
            bondingProgress: token.bondingProgress,
            inEntryZone: token.bondingProgress >= 70 && token.bondingProgress <= 95,
            updatedAt: token.updatedAt,
          };
          this.emit('topNExit', entry, this.config.rankings.emitTopNThreshold);
        }
      }
    }

    // Update state
    this.currentRankings = newRankings;
    this.previousTop10 = newTop10;

    // Emit rankings update
    const snapshot = this.getSnapshot();
    this.emit('rankingsUpdated', snapshot);
  }

  /**
   * Gets current rank for a token
   */
  private getCurrentRank(mintAddress: SolanaAddress): number | null {
    const entry = this.currentRankings.find(r => r.mintAddress === mintAddress);
    return entry?.rank ?? null;
  }

  /**
   * Estimates bonding progress from liquidity points
   */
  private estimateBondingProgress(progressPoints: number): number {
    // Reverse mapping from scoring:
    // 15 pts = 80-90%, 10 pts = 70-80 or 90-95, 5 pts = 60-70 or 95-100
    if (progressPoints >= 15) return 85;
    if (progressPoints >= 10) return 75;
    if (progressPoints >= 5) return 65;
    return 50;
  }

  // ===========================================================================
  // QUERIES
  // ===========================================================================

  /**
   * Gets current rankings snapshot
   */
  getSnapshot(): RankingsSnapshot {
    const newTop10 = this.currentRankings
      .filter(r => r.rank <= this.config.rankings.emitTopNThreshold)
      .filter(r => r.previousRank === null || r.previousRank > this.config.rankings.emitTopNThreshold)
      .map(r => r.mintAddress);

    const exitedTop10 = Array.from(this.previousTop10)
      .filter(mint => {
        const entry = this.currentRankings.find(r => r.mintAddress === mint);
        return !entry || entry.rank > this.config.rankings.emitTopNThreshold;
      });

    return {
      timestamp: Date.now(),
      rankings: [...this.currentRankings],
      newTop10,
      exitedTop10,
      totalTracked: this.trackedTokens.size,
    };
  }

  /**
   * Gets top N tokens
   */
  getTopN(n: number = this.config.rankings.topN): RankingEntry[] {
    return this.currentRankings.slice(0, n);
  }

  /**
   * Gets tokens in entry zone
   */
  getEntryZoneTokens(): RankingEntry[] {
    return this.currentRankings.filter(r => r.inEntryZone);
  }

  /**
   * Gets tokens with BUY or STRONG_BUY signals
   */
  getBuySignals(): RankingEntry[] {
    return this.currentRankings.filter(
      r => r.signal === TradingSignal.STRONG_BUY || r.signal === TradingSignal.BUY
    );
  }

  /**
   * Gets a specific token's ranking
   */
  getRanking(mintAddress: SolanaAddress): RankingEntry | undefined {
    return this.currentRankings.find(r => r.mintAddress === mintAddress);
  }

  /**
   * Gets tokens that improved in rank
   */
  getMoversUp(): RankingEntry[] {
    return this.currentRankings.filter(r => r.rankChange > 0);
  }

  /**
   * Gets tokens that dropped in rank
   */
  getMoversDown(): RankingEntry[] {
    return this.currentRankings.filter(r => r.rankChange < 0);
  }

  /**
   * Gets new entries (no previous rank)
   */
  getNewEntries(): RankingEntry[] {
    return this.currentRankings.filter(r => r.previousRank === null);
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Gets statistics about tracked tokens
   */
  getStatistics(): RankingStatistics {
    const rankings = this.currentRankings;
    const tracked = this.trackedTokens.size;

    const signalCounts = {
      [TradingSignal.STRONG_BUY]: 0,
      [TradingSignal.BUY]: 0,
      [TradingSignal.HOLD]: 0,
      [TradingSignal.SELL]: 0,
      [TradingSignal.NO_TRADE]: 0,
    };

    for (const token of this.trackedTokens.values()) {
      signalCounts[token.signal]++;
    }

    const scores = rankings.map(r => r.momentumScore);
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;

    const inEntryZone = rankings.filter(r => r.inEntryZone).length;

    return {
      totalTracked: tracked,
      rankedCount: rankings.length,
      signalCounts,
      averageScore: avgScore,
      maxScore,
      minScore,
      inEntryZoneCount: inEntryZone,
      moversUpCount: this.getMoversUp().length,
      moversDownCount: this.getMoversDown().length,
      newEntriesCount: this.getNewEntries().length,
    };
  }

  /**
   * Clears all tracked tokens
   */
  clear(): void {
    this.trackedTokens.clear();
    this.currentRankings = [];
    this.previousTop10.clear();
  }
}

// =============================================================================
// STATISTICS TYPE
// =============================================================================

export interface RankingStatistics {
  totalTracked: number;
  rankedCount: number;
  signalCounts: Record<TradingSignal, number>;
  averageScore: number;
  maxScore: number;
  minScore: number;
  inEntryZoneCount: number;
  moversUpCount: number;
  moversDownCount: number;
  newEntriesCount: number;
}

// =============================================================================
// FORMATTING UTILITIES
// =============================================================================

/**
 * Formats rankings for display
 */
export function formatRankings(rankings: RankingEntry[], limit: number = 10): string {
  const lines: string[] = ['# Top Tokens by Momentum'];
  lines.push('');
  lines.push('Rank | Token | Score | Signal | BC% | Change');
  lines.push('-----|-------|-------|--------|-----|-------');

  for (const entry of rankings.slice(0, limit)) {
    const symbol = entry.symbol ?? entry.mintAddress.slice(0, 8);
    const change = entry.rankChange > 0 ? `+${entry.rankChange}` :
                   entry.rankChange < 0 ? `${entry.rankChange}` :
                   entry.previousRank === null ? 'NEW' : '-';

    lines.push(
      `${entry.rank.toString().padStart(4)} | ` +
      `${symbol.padEnd(5)} | ` +
      `${entry.momentumScore.toString().padStart(5)} | ` +
      `${entry.signal.padEnd(6)} | ` +
      `${entry.bondingProgress.toFixed(0).padStart(3)}% | ` +
      `${change}`
    );
  }

  return lines.join('\n');
}

/**
 * Formats a single ranking entry for logging
 */
export function formatRankingEntry(entry: RankingEntry): string {
  const symbol = entry.symbol ?? entry.mintAddress.slice(0, 8);
  const change = entry.rankChange > 0 ? `(+${entry.rankChange})` :
                 entry.rankChange < 0 ? `(${entry.rankChange})` :
                 entry.previousRank === null ? '(NEW)' : '';

  return `#${entry.rank} ${symbol}: ${entry.momentumScore}/100 [${entry.signal}] BC:${entry.bondingProgress.toFixed(0)}% ${change}`;
}
