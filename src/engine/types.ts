/**
 * Momentum Engine Types
 *
 * Type definitions for the Phase 4 Momentum Scoring Engine.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';
import type {
  VolumeMetrics,
  HolderMetrics,
  LiquidityMetrics,
  SafetyMetrics,
} from '../analyzers/types.js';

// =============================================================================
// SCORE TYPES
// =============================================================================

/**
 * Volume score breakdown (max 30 points)
 */
export interface VolumeScoreBreakdown {
  /** Velocity points (0-15) */
  velocityPoints: number;

  /** Buy ratio points (0-10) */
  buyRatioPoints: number;

  /** Volume spike points (0-5) */
  spikePoints: number;

  /** Total volume score (0-30) */
  total: number;
}

/**
 * Holder score breakdown (max 25 points)
 */
export interface HolderScoreBreakdown {
  /** Velocity points (0-10) */
  velocityPoints: number;

  /** Concentration safety points (0-10) */
  concentrationPoints: number;

  /** Holder count points (0-5) */
  countPoints: number;

  /** Total holder score (0-25) */
  total: number;
}

/**
 * Liquidity score breakdown (max 20 points)
 */
export interface LiquidityScoreBreakdown {
  /** Bonding progress points (0-15) */
  progressPoints: number;

  /** Liquidity depth points (0-5) */
  depthPoints: number;

  /** Total liquidity score (0-20) */
  total: number;
}

/**
 * Social score breakdown (max 15 points)
 */
export interface SocialScoreBreakdown {
  /** Social links points (0-10) */
  linksPoints: number;

  /** Community growth points (0-5) */
  growthPoints: number;

  /** Total social score (0-15) */
  total: number;
}

/**
 * Safety score breakdown (max 10 points)
 */
export interface SafetyScoreBreakdown {
  /** Normalized safety score (0-10) */
  total: number;
}

/**
 * Complete score breakdown
 */
export interface ScoreBreakdown {
  volume: VolumeScoreBreakdown;
  holders: HolderScoreBreakdown;
  liquidity: LiquidityScoreBreakdown;
  social: SocialScoreBreakdown;
  safety: SafetyScoreBreakdown;

  /** Total momentum score (0-100) */
  totalScore: number;
}

// =============================================================================
// SIGNAL TYPES
// =============================================================================

/**
 * Trading signal type
 */
export enum TradingSignal {
  STRONG_BUY = 'STRONG_BUY',
  BUY = 'BUY',
  HOLD = 'HOLD',
  SELL = 'SELL',
  NO_TRADE = 'NO_TRADE',
}

/**
 * Position sizing recommendation
 */
export interface PositionSizing {
  /** Percentage of max position to use (0-100) */
  sizePercent: number;

  /** Recommended position size in SOL */
  recommendedSizeSol: number;

  /** Maximum acceptable slippage (%) */
  maxSlippage: number;

  /** Sizing reason */
  reason: string;
}

/**
 * Generated trading signal
 */
export interface GeneratedSignal {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Signal type */
  signal: TradingSignal;

  /** Momentum score (0-100) */
  momentumScore: number;

  /** Score breakdown */
  breakdown: ScoreBreakdown;

  /** Position sizing */
  positionSizing: PositionSizing;

  /** Signal strength (0-1) */
  strength: number;

  /** Signal timestamp */
  timestamp: Timestamp;

  /** Reasons for signal */
  reasons: string[];

  /** Whether signal meets all entry criteria */
  meetsEntryCriteria: boolean;

  /** Whether signal should be executed */
  shouldExecute: boolean;
}

// =============================================================================
// RANKING TYPES
// =============================================================================

/**
 * Token ranking entry
 */
export interface RankingEntry {
  /** Current rank (1-based) */
  rank: number;

  /** Previous rank (null if new) */
  previousRank: number | null;

  /** Rank change (+positive = improved, -negative = dropped) */
  rankChange: number;

  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Token symbol */
  symbol?: string;

  /** Momentum score */
  momentumScore: number;

  /** Trading signal */
  signal: TradingSignal;

  /** Bonding curve progress */
  bondingProgress: number;

  /** Is in entry zone */
  inEntryZone: boolean;

  /** Last update timestamp */
  updatedAt: Timestamp;
}

/**
 * Rankings snapshot
 */
export interface RankingsSnapshot {
  /** Timestamp of snapshot */
  timestamp: Timestamp;

  /** Top 20 rankings */
  rankings: RankingEntry[];

  /** Tokens that entered top 10 this update */
  newTop10: SolanaAddress[];

  /** Tokens that exited top 10 this update */
  exitedTop10: SolanaAddress[];

  /** Total tokens being tracked */
  totalTracked: number;
}

// =============================================================================
// PERSISTENCE TYPES
// =============================================================================

/**
 * Signal record for database persistence
 */
export interface SignalRecord {
  /** Unique ID */
  id: string;

  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Signal type */
  signal: TradingSignal;

  /** Momentum score */
  momentumScore: number;

  /** Full score breakdown (JSON) */
  scoreBreakdown: ScoreBreakdown;

  /** Signal timestamp */
  timestamp: Timestamp;

  /** Whether signal was executed */
  executed: boolean;

  /** Execution timestamp (if executed) */
  executedAt?: Timestamp;

  /** Execution result */
  executionResult?: 'success' | 'failed' | 'skipped';

  /** Execution notes */
  executionNotes?: string;
}

// =============================================================================
// ENGINE CONFIGURATION
// =============================================================================

/**
 * Momentum engine configuration
 */
export interface MomentumEngineConfig {
  /** Update interval (ms) */
  updateIntervalMs: number;

  /** Thresholds */
  thresholds: {
    /** Minimum score for STRONG_BUY */
    strongBuy: number;

    /** Minimum score for BUY */
    buy: number;

    /** Score below which to SELL */
    sell: number;

    /** Minimum safety score to trade */
    minSafety: number;

    /** Minimum safety score for STRONG_BUY */
    strongBuySafety: number;
  };

  /** Position sizing */
  positionSizing: {
    /** Max position size in SOL */
    maxPositionSol: number;

    /** STRONG_BUY position percentage */
    strongBuyPercent: number;

    /** BUY position percentage */
    buyPercent: number;

    /** Default max slippage */
    defaultMaxSlippage: number;
  };

  /** Rankings */
  rankings: {
    /** Number of top tokens to track */
    topN: number;

    /** Emit event when token enters top N */
    emitTopNThreshold: number;
  };
}

/**
 * Default engine configuration
 */
export const DEFAULT_ENGINE_CONFIG: MomentumEngineConfig = {
  updateIntervalMs: 30_000, // 30 seconds
  thresholds: {
    strongBuy: 85,
    buy: 75,
    sell: 50,
    minSafety: 7,
    strongBuySafety: 8,
  },
  positionSizing: {
    maxPositionSol: 1,
    strongBuyPercent: 100,
    buyPercent: 75,
    defaultMaxSlippage: 3,
  },
  rankings: {
    topN: 20,
    emitTopNThreshold: 10,
  },
};
