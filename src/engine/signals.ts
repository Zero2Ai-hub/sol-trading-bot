/**
 * Signal Generation
 *
 * Generates trading signals based on momentum scores and entry criteria.
 * Phase 4 specification:
 * - STRONG_BUY: Score >= 85, Safety >= 8
 * - BUY: Score >= 75, Safety >= 7
 * - HOLD: Score >= 50
 * - SELL: Score < 50
 * - NO_TRADE: Fails entry criteria
 */

import type { SolanaAddress } from '../core/types.js';
import type {
  VolumeMetrics,
  HolderMetrics,
  LiquidityMetrics,
  SafetyMetrics,
} from '../analyzers/types.js';
import {
  TradingSignal,
  type ScoreBreakdown,
  type PositionSizing,
  type GeneratedSignal,
  type MomentumEngineConfig,
  DEFAULT_ENGINE_CONFIG,
} from './types.js';
import {
  calculateTotalScore,
  getWeakestArea,
  getImprovementSuggestions,
} from './scoring.js';

// =============================================================================
// ENTRY CRITERIA CHECKS
// =============================================================================

/**
 * Entry criteria that MUST be met for any trade
 */
export interface EntryCriteria {
  /** Bonding curve in entry zone (70-95%) */
  inEntryZone: boolean;

  /** Minimum safety score met */
  safetyPassed: boolean;

  /** No instant reject flags */
  noRejectFlags: boolean;

  /** Sufficient liquidity */
  hasLiquidity: boolean;

  /** All criteria met */
  allMet: boolean;

  /** Reasons for failure (if any) */
  failureReasons: string[];
}

/**
 * Checks if token meets entry criteria
 */
export function checkEntryCriteria(
  liquidity: LiquidityMetrics | null,
  safety: SafetyMetrics | null,
  config: MomentumEngineConfig = DEFAULT_ENGINE_CONFIG
): EntryCriteria {
  const failureReasons: string[] = [];

  // Check bonding curve zone (70-95%)
  const progress = liquidity?.bondingCurveProgress ?? 0;
  const inEntryZone = progress >= 70 && progress <= 95;
  if (!inEntryZone) {
    if (progress < 70) {
      failureReasons.push(`Bonding curve too early: ${progress.toFixed(1)}% (need 70%+)`);
    } else if (progress > 95) {
      failureReasons.push(`Bonding curve too late: ${progress.toFixed(1)}% (migration imminent)`);
    } else if (progress >= 100) {
      failureReasons.push('Token has migrated - not on bonding curve');
    }
  }

  // Check safety score
  const safetyScore = safety?.safetyScore ?? 0;
  const normalizedSafety = safetyScore / 10; // Convert 0-100 to 0-10
  const safetyPassed = normalizedSafety >= config.thresholds.minSafety;
  if (!safetyPassed) {
    failureReasons.push(
      `Safety score too low: ${normalizedSafety.toFixed(1)}/10 (need ${config.thresholds.minSafety}+)`
    );
  }

  // Check for instant reject flags
  const hasRejectReasons = safety?.instantRejectReasons?.length ?? 0;
  const noRejectFlags = hasRejectReasons === 0 && !safety?.shouldInstantReject;
  if (!noRejectFlags && safety?.instantRejectReasons) {
    failureReasons.push(`Instant reject: ${safety.instantRejectReasons.join(', ')}`);
  }

  // Check liquidity
  const liquidityLamports = liquidity?.totalLiquiditySol ?? BigInt(0);
  const liquiditySol = Number(liquidityLamports) / 1e9; // lamports to SOL
  const hasLiquidity = liquiditySol >= 5; // Minimum 5 SOL liquidity
  if (!hasLiquidity) {
    failureReasons.push(`Insufficient liquidity: ${liquiditySol.toFixed(2)} SOL (need 5+)`);
  }

  return {
    inEntryZone,
    safetyPassed,
    noRejectFlags,
    hasLiquidity,
    allMet: inEntryZone && safetyPassed && noRejectFlags && hasLiquidity,
    failureReasons,
  };
}

// =============================================================================
// SIGNAL DETERMINATION
// =============================================================================

/**
 * Determines trading signal based on score
 */
export function determineSignal(
  totalScore: number,
  safetyScore: number,
  entryCriteria: EntryCriteria,
  config: MomentumEngineConfig = DEFAULT_ENGINE_CONFIG
): TradingSignal {
  // If entry criteria not met, NO_TRADE
  if (!entryCriteria.allMet) {
    return TradingSignal.NO_TRADE;
  }

  // Normalize safety to 0-10 range for threshold comparison
  const normalizedSafety = safetyScore / 10;

  // STRONG_BUY: High score AND high safety
  if (
    totalScore >= config.thresholds.strongBuy &&
    normalizedSafety >= config.thresholds.strongBuySafety
  ) {
    return TradingSignal.STRONG_BUY;
  }

  // BUY: Good score
  if (totalScore >= config.thresholds.buy) {
    return TradingSignal.BUY;
  }

  // SELL: Below threshold
  if (totalScore < config.thresholds.sell) {
    return TradingSignal.SELL;
  }

  // HOLD: Between sell and buy
  return TradingSignal.HOLD;
}

// =============================================================================
// POSITION SIZING
// =============================================================================

/**
 * Calculates position size based on signal and score
 */
export function calculatePositionSizing(
  signal: TradingSignal,
  totalScore: number,
  liquidity: LiquidityMetrics | null,
  config: MomentumEngineConfig = DEFAULT_ENGINE_CONFIG
): PositionSizing {
  // No position for non-buy signals
  if (signal === TradingSignal.NO_TRADE || signal === TradingSignal.SELL || signal === TradingSignal.HOLD) {
    return {
      sizePercent: 0,
      recommendedSizeSol: 0,
      maxSlippage: 0,
      reason: `No position for ${signal} signal`,
    };
  }

  // Base size percent from signal
  let sizePercent: number;
  let reason: string;

  if (signal === TradingSignal.STRONG_BUY) {
    sizePercent = config.positionSizing.strongBuyPercent;
    reason = 'STRONG_BUY - full position';
  } else {
    sizePercent = config.positionSizing.buyPercent;
    reason = 'BUY - standard position';
  }

  // Scale by score (optional fine-tuning)
  // Score of 85 = 100%, 75 = 75%, linear interpolation
  const scoreScaling = Math.min(1, (totalScore - 60) / 40);
  sizePercent = Math.round(sizePercent * scoreScaling);

  // Calculate actual size in SOL
  const recommendedSizeSol = (sizePercent / 100) * config.positionSizing.maxPositionSol;

  // Determine max slippage based on liquidity
  let maxSlippage = config.positionSizing.defaultMaxSlippage;
  if (liquidity) {
    const estimatedSlippage = liquidity.slippage1Sol ?? 0;
    // Allow up to 3x the estimated slippage, max 10%
    maxSlippage = Math.min(10, Math.max(config.positionSizing.defaultMaxSlippage, estimatedSlippage * 3));
  }

  return {
    sizePercent,
    recommendedSizeSol,
    maxSlippage,
    reason,
  };
}

// =============================================================================
// SIGNAL GENERATION
// =============================================================================

/**
 * Generates a complete trading signal for a token
 */
export function generateSignal(
  mintAddress: SolanaAddress,
  volume: VolumeMetrics | null,
  holders: HolderMetrics | null,
  liquidity: LiquidityMetrics | null,
  safety: SafetyMetrics | null,
  config: MomentumEngineConfig = DEFAULT_ENGINE_CONFIG
): GeneratedSignal {
  // Calculate scores
  const breakdown = calculateTotalScore(volume, holders, liquidity, safety);

  // Check entry criteria
  const entryCriteria = checkEntryCriteria(liquidity, safety, config);

  // Determine signal
  const signal = determineSignal(
    breakdown.totalScore,
    safety?.safetyScore ?? 0,
    entryCriteria,
    config
  );

  // Calculate position sizing
  const positionSizing = calculatePositionSizing(signal, breakdown.totalScore, liquidity, config);

  // Calculate signal strength (0-1)
  const strength = calculateSignalStrength(signal, breakdown, entryCriteria);

  // Compile reasons
  const reasons = compileSignalReasons(signal, breakdown, entryCriteria);

  // Determine if should execute
  const shouldExecute =
    (signal === TradingSignal.STRONG_BUY || signal === TradingSignal.BUY) &&
    entryCriteria.allMet &&
    strength >= 0.5;

  return {
    mintAddress,
    signal,
    momentumScore: breakdown.totalScore,
    breakdown,
    positionSizing,
    strength,
    timestamp: Date.now(),
    reasons,
    meetsEntryCriteria: entryCriteria.allMet,
    shouldExecute,
  };
}

/**
 * Calculates signal strength (0-1)
 */
function calculateSignalStrength(
  signal: TradingSignal,
  breakdown: ScoreBreakdown,
  entryCriteria: EntryCriteria
): number {
  // No strength for non-actionable signals
  if (signal === TradingSignal.NO_TRADE || signal === TradingSignal.HOLD) {
    return 0;
  }

  // Base strength from score
  let strength = breakdown.totalScore / 100;

  // Boost for STRONG_BUY
  if (signal === TradingSignal.STRONG_BUY) {
    strength = Math.min(1, strength * 1.2);
  }

  // Penalize for SELL
  if (signal === TradingSignal.SELL) {
    strength = -Math.abs(strength); // Negative strength indicates bearish
  }

  // Penalize for entry criteria failures
  if (!entryCriteria.allMet) {
    const failureCount = entryCriteria.failureReasons.length;
    strength *= Math.max(0, 1 - failureCount * 0.25);
  }

  return Math.max(-1, Math.min(1, strength));
}

/**
 * Compiles human-readable reasons for the signal
 */
function compileSignalReasons(
  signal: TradingSignal,
  breakdown: ScoreBreakdown,
  entryCriteria: EntryCriteria
): string[] {
  const reasons: string[] = [];

  // Add signal-specific reason
  switch (signal) {
    case TradingSignal.STRONG_BUY:
      reasons.push(`Strong momentum score: ${breakdown.totalScore}/100`);
      break;
    case TradingSignal.BUY:
      reasons.push(`Good momentum score: ${breakdown.totalScore}/100`);
      break;
    case TradingSignal.HOLD:
      reasons.push(`Moderate score: ${breakdown.totalScore}/100 - monitoring`);
      break;
    case TradingSignal.SELL:
      reasons.push(`Low score: ${breakdown.totalScore}/100 - exit recommended`);
      break;
    case TradingSignal.NO_TRADE:
      reasons.push('Entry criteria not met');
      break;
  }

  // Add entry criteria failures
  reasons.push(...entryCriteria.failureReasons);

  // Add improvement suggestions
  const improvements = getImprovementSuggestions(breakdown);
  reasons.push(...improvements.slice(0, 3)); // Top 3 suggestions

  // Add weakest area
  const weakest = getWeakestArea(breakdown);
  reasons.push(`Weakest area: ${weakest}`);

  return reasons;
}

// =============================================================================
// BATCH SIGNAL GENERATION
// =============================================================================

/**
 * Data required for signal generation
 */
export interface TokenMetricsBundle {
  mintAddress: SolanaAddress;
  volume: VolumeMetrics | null;
  holders: HolderMetrics | null;
  liquidity: LiquidityMetrics | null;
  safety: SafetyMetrics | null;
}

/**
 * Generates signals for multiple tokens
 */
export function generateSignalsBatch(
  tokens: TokenMetricsBundle[],
  config: MomentumEngineConfig = DEFAULT_ENGINE_CONFIG
): GeneratedSignal[] {
  return tokens.map(token =>
    generateSignal(
      token.mintAddress,
      token.volume,
      token.holders,
      token.liquidity,
      token.safety,
      config
    )
  );
}

/**
 * Filters signals to only actionable ones
 */
export function getActionableSignals(signals: GeneratedSignal[]): GeneratedSignal[] {
  return signals.filter(s => s.shouldExecute);
}

/**
 * Sorts signals by strength (strongest first)
 */
export function sortSignalsByStrength(signals: GeneratedSignal[]): GeneratedSignal[] {
  return [...signals].sort((a, b) => b.strength - a.strength);
}

/**
 * Gets top N signals by score
 */
export function getTopSignals(signals: GeneratedSignal[], n: number): GeneratedSignal[] {
  return sortSignalsByStrength(signals).slice(0, n);
}
