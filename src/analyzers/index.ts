/**
 * Analyzers Module
 *
 * Data analyzers that transform raw blockchain data into
 * actionable momentum indicators and trading signals.
 *
 * Architecture:
 * ```
 * Raw Events → Volume → ┐
 *            → Holders →├→ Momentum Aggregator → Signal
 *            → Liquidity→│
 *            → Safety  → ┘
 * ```
 */

// =============================================================================
// TYPES
// =============================================================================

export * from './types.js';

// =============================================================================
// BASE CLASSES & UTILITIES
// =============================================================================

export {
  BaseAnalyzer,
  createBaseMetrics,
  calculateConfidence,
  normalizeScore,
  scoreToRiskLevel,
  safeBigIntDivide,
  lamportsToSol,
  solToLamports,
  type TrackedTokenEntry,
} from './base.js';

// =============================================================================
// TIME WINDOW STORAGE
// =============================================================================

export {
  TimeWindowedStorage,
  NumericWindowStorage,
  BigIntWindowStorage,
  SnapshotStorage,
  createTradeStorage,
  createVolumeStorage,
  createHolderSnapshotStorage,
  createProgressStorage,
  type TimestampedData,
  type TimeWindowConfig,
  type WindowAggregation,
} from './time-window.js';

// =============================================================================
// ANALYZERS
// =============================================================================

// Volume Analyzer
export {
  VolumeAnalyzer,
  volumeAnalyzer,
  initializeVolumeAnalyzer,
} from './volume.js';

// Holder Analyzer
export {
  HolderAnalyzer,
  holderAnalyzer,
  initializeHolderAnalyzer,
} from './holders.js';

// Liquidity Analyzer
export {
  LiquidityAnalyzer,
  liquidityAnalyzer,
  initializeLiquidityAnalyzer,
} from './liquidity.js';

// Safety Analyzer
export {
  SafetyAnalyzer,
  safetyAnalyzer,
  initializeSafetyAnalyzer,
} from './safety.js';

// Momentum Aggregator
export {
  MomentumAggregator,
  momentumAggregator,
  initializeMomentumAggregator,
  SignalType,
} from './momentum.js';

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

import type { PumpFunEventEmitter } from '../core/events.js';
import { momentumAggregator } from './momentum.js';
import type { MomentumMetrics } from './types.js';

/**
 * Initializes all analyzers and starts the momentum aggregator
 */
export function initializeAnalyzers(eventEmitter: PumpFunEventEmitter): void {
  momentumAggregator.initialize();
  momentumAggregator.start(eventEmitter);
}

/**
 * Stops all analyzers
 */
export function stopAnalyzers(): void {
  momentumAggregator.stop();
}

/**
 * Gets momentum metrics for a token
 */
export function getMomentumMetrics(mintAddress: string): MomentumMetrics | undefined {
  return momentumAggregator.getMomentumMetrics(mintAddress);
}

/**
 * Gets all entry opportunities (tokens ready to buy)
 */
export function getEntryOpportunities(): Array<{
  mint: string;
  metrics: MomentumMetrics;
}> {
  return momentumAggregator.getEntryOpportunities();
}

/**
 * Gets all exit signals (tokens to sell)
 */
export function getExitSignals(): Array<{
  mint: string;
  metrics: MomentumMetrics;
}> {
  return momentumAggregator.getExitSignals();
}

/**
 * Gets health status of all analyzers
 */
export function getAnalyzersHealth() {
  return momentumAggregator.getAnalyzerHealth();
}
