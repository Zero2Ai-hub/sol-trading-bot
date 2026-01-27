/**
 * Momentum Aggregator
 *
 * Combines all analyzer outputs into a unified momentum score
 * and generates trading signals (BUY/SELL/HOLD).
 *
 * Based on trading-bot-architecture skill's signal generation patterns.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';
import type { PumpFunEventEmitter } from '../core/events.js';
import {
  BaseAnalyzer,
  createBaseMetrics,
  calculateConfidence,
} from './base.js';
import { VolumeAnalyzer, volumeAnalyzer } from './volume.js';
import { HolderAnalyzer, holderAnalyzer } from './holders.js';
import { LiquidityAnalyzer, liquidityAnalyzer } from './liquidity.js';
import { SafetyAnalyzer, safetyAnalyzer } from './safety.js';
import {
  type MomentumMetrics,
  type MomentumConfig,
  type VolumeMetrics,
  type HolderMetrics,
  type LiquidityMetrics,
  type SafetyMetrics,
  SignalType,
  RiskLevel,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_MOMENTUM_CONFIG: MomentumConfig = {
  updateIntervalMs: 15_000, // 15 seconds - aggregation is fast
  maxDataAgeMs: 60_000, // 1 minute
  debug: false,
  analyzerWeights: {
    volume: 0.25, // 25% weight
    holders: 0.20, // 20% weight
    liquidity: 0.30, // 30% weight - most important for Pump.fun
    safety: 0.25, // 25% weight - critical for capital protection
  },
  buyThreshold: 65, // Score >= 65 for BUY signal
  strongBuyThreshold: 80, // Score >= 80 for STRONG_BUY
  sellThreshold: 40, // Score < 40 for SELL signal
  strongSellThreshold: 25, // Score < 25 for STRONG_SELL
  enableTimeDecay: true,
  timeDecayHalfLifeMs: 5 * 60 * 1000, // 5 minutes
  minDataCompleteness: 0.5, // Need 50% of data for signals
};

// =============================================================================
// MOMENTUM AGGREGATOR CLASS
// =============================================================================

export class MomentumAggregator extends BaseAnalyzer<MomentumMetrics, MomentumConfig> {
  protected readonly name = 'momentum-aggregator';

  /** Child analyzers */
  private volumeAnalyzer: VolumeAnalyzer;
  private holderAnalyzer: HolderAnalyzer;
  private liquidityAnalyzer: LiquidityAnalyzer;
  private safetyAnalyzer: SafetyAnalyzer;

  /** Token signal history for time decay */
  private signalHistory: Map<SolanaAddress, Array<{
    timestamp: Timestamp;
    score: number;
    signal: SignalType;
  }>> = new Map();

  constructor(
    config: Partial<MomentumConfig> = {},
    analyzers?: {
      volume?: VolumeAnalyzer;
      holder?: HolderAnalyzer;
      liquidity?: LiquidityAnalyzer;
      safety?: SafetyAnalyzer;
    }
  ) {
    super({ ...DEFAULT_MOMENTUM_CONFIG, ...config });

    // Use provided analyzers or singletons
    this.volumeAnalyzer = analyzers?.volume ?? volumeAnalyzer;
    this.holderAnalyzer = analyzers?.holder ?? holderAnalyzer;
    this.liquidityAnalyzer = analyzers?.liquidity ?? liquidityAnalyzer;
    this.safetyAnalyzer = analyzers?.safety ?? safetyAnalyzer;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected override onInitialize(): void {
    this.logger?.debug('Momentum aggregator initialized', {
      weights: this.config.analyzerWeights,
      buyThreshold: this.config.buyThreshold,
      sellThreshold: this.config.sellThreshold,
    });
  }

  override start(eventEmitter: PumpFunEventEmitter): void {
    // Initialize child analyzers
    this.volumeAnalyzer.initialize();
    this.holderAnalyzer.initialize();
    this.liquidityAnalyzer.initialize();
    this.safetyAnalyzer.initialize();

    // Start child analyzers
    this.volumeAnalyzer.start(eventEmitter);
    this.holderAnalyzer.start(eventEmitter);
    this.liquidityAnalyzer.start(eventEmitter);
    this.safetyAnalyzer.start(eventEmitter);

    // Start aggregator
    super.start(eventEmitter);
  }

  override stop(): void {
    // Stop aggregator first
    super.stop();

    // Stop child analyzers
    this.volumeAnalyzer.stop();
    this.holderAnalyzer.stop();
    this.liquidityAnalyzer.stop();
    this.safetyAnalyzer.stop();
  }

  protected override onTokenRemoved(mintAddress: SolanaAddress): void {
    this.signalHistory.delete(mintAddress);
  }

  // ===========================================================================
  // UPDATE & METRICS
  // ===========================================================================

  protected override async update(): Promise<void> {
    const now = Date.now();

    for (const [mintAddress, tokenEntry] of this.trackedTokens) {
      // Skip migrated tokens
      if (tokenEntry.hasMigrated) {
        continue;
      }

      // Gather all analyzer metrics
      const volumeMetrics = this.volumeAnalyzer.getMetrics(mintAddress) ?? null;
      const holderMetrics = this.holderAnalyzer.getMetrics(mintAddress) ?? null;
      const liquidityMetrics = this.liquidityAnalyzer.getMetrics(mintAddress) ?? null;
      const safetyMetrics = this.safetyAnalyzer.getMetrics(mintAddress) ?? null;

      // Calculate aggregated metrics
      const metrics = this.calculateMetrics(
        mintAddress,
        volumeMetrics,
        holderMetrics,
        liquidityMetrics,
        safetyMetrics,
        now
      );

      this.metrics.set(mintAddress, metrics);

      // Record signal history for time decay
      this.recordSignalHistory(mintAddress, metrics, now);

      // Log significant signals
      if (metrics.signal === SignalType.STRONG_BUY || metrics.signal === SignalType.STRONG_SELL) {
        this.logger?.info('Strong signal generated', {
          mint: mintAddress.slice(0, 8) + '...',
          signal: metrics.signal,
          score: metrics.momentumScore.toFixed(1),
          reasons: metrics.signalReasons,
        });
      }
    }
  }

  /**
   * Calculates aggregated momentum metrics
   */
  private calculateMetrics(
    mintAddress: SolanaAddress,
    volume: VolumeMetrics | null,
    holders: HolderMetrics | null,
    liquidity: LiquidityMetrics | null,
    safety: SafetyMetrics | null,
    now: Timestamp
  ): MomentumMetrics {
    const baseMetrics = createBaseMetrics(mintAddress);

    // Calculate data completeness
    const dataCompleteness = this.calculateDataCompleteness(
      volume,
      holders,
      liquidity,
      safety
    );

    // Calculate individual scores (0-100)
    const volumeScore = this.calculateVolumeScore(volume);
    const holderScore = this.calculateHolderScore(holders);
    const liquidityScore = this.calculateLiquidityScore(liquidity);
    const safetyScore = safety?.safetyScore ?? 0;

    // Apply weights
    const weights = this.config.analyzerWeights;
    const weightedScores = {
      volume: volumeScore * weights.volume,
      holders: holderScore * weights.holders,
      liquidity: liquidityScore * weights.liquidity,
      safety: safetyScore * weights.safety,
    };

    // Calculate raw momentum score
    let momentumScore =
      weightedScores.volume +
      weightedScores.holders +
      weightedScores.liquidity +
      weightedScores.safety;

    // Apply time decay if enabled
    let hasTimeDecay = false;
    if (this.config.enableTimeDecay) {
      const decayFactor = this.calculateTimeDecay(mintAddress, now);
      if (decayFactor < 1) {
        hasTimeDecay = true;
        // Decay pulls score toward 50 (neutral)
        momentumScore = 50 + (momentumScore - 50) * decayFactor;
      }
    }

    // Determine signal
    const { signal, signalStrength, signalReasons } = this.determineSignal(
      momentumScore,
      volume,
      holders,
      liquidity,
      safety,
      dataCompleteness
    );

    // Entry/exit decisions
    const inEntryZone = liquidity?.inEntryZone ?? false;
    const shouldEnter = signal === SignalType.BUY || signal === SignalType.STRONG_BUY;
    const shouldExit = signal === SignalType.SELL || signal === SignalType.STRONG_SELL ||
                       signal === SignalType.DO_NOT_TRADE;

    // Calculate confidence
    const momentumConfidence = calculateConfidence(
      !!volume,
      !!holders,
      !!liquidity,
      !!safety
    ) * dataCompleteness;

    return {
      ...baseMetrics,
      confidence: momentumConfidence,
      momentumScore,
      momentumConfidence,
      signal,
      signalStrength,
      volume,
      holders,
      liquidity,
      safety,
      weightedScores,
      weights,
      inEntryZone,
      shouldEnter: shouldEnter && inEntryZone,
      shouldExit,
      signalReasons,
      hasTimeDecay,
      dataCompleteness,
    };
  }

  /**
   * Calculates data completeness (0-1)
   */
  private calculateDataCompleteness(
    volume: VolumeMetrics | null,
    holders: HolderMetrics | null,
    liquidity: LiquidityMetrics | null,
    safety: SafetyMetrics | null
  ): number {
    let complete = 0;
    let total = 0;

    // Volume (weighted by importance)
    total += 0.25;
    if (volume && volume.confidence > 0.3) complete += 0.25;

    // Holders
    total += 0.20;
    if (holders && holders.confidence > 0.3) complete += 0.20;

    // Liquidity (most important)
    total += 0.30;
    if (liquidity && liquidity.confidence > 0.3) complete += 0.30;

    // Safety
    total += 0.25;
    if (safety && safety.confidence > 0.3) complete += 0.25;

    return complete / total;
  }

  /**
   * Calculates volume-based score (0-100)
   */
  private calculateVolumeScore(volume: VolumeMetrics | null): number {
    if (!volume) return 50; // Neutral if no data

    let score = 50; // Base score

    // Volume velocity bonus/penalty
    if (volume.volumeVelocity > 1) score += 15;
    else if (volume.volumeVelocity > 0.5) score += 10;
    else if (volume.volumeVelocity > 0) score += 5;
    else if (volume.volumeVelocity < -0.3) score -= 10;
    else if (volume.volumeVelocity < -0.5) score -= 15;

    // Buy ratio bonus/penalty
    if (volume.buyRatio > 0.7) score += 15;
    else if (volume.buyRatio > 0.6) score += 10;
    else if (volume.buyRatio < 0.4) score -= 10;
    else if (volume.buyRatio < 0.3) score -= 15;

    // Volume spike bonus
    if (volume.hasVolumeSpike && volume.buyRatio > 0.5) score += 10;

    // Wash trading penalty
    if (volume.washTradingScore > 0.5) score -= 20;
    else if (volume.washTradingScore > 0.3) score -= 10;

    // Unique trader bonus
    if (volume.uniqueTraders >= 10) score += 5;
    if (volume.uniqueTraders >= 20) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculates holder-based score (0-100)
   */
  private calculateHolderScore(holders: HolderMetrics | null): number {
    if (!holders) return 50; // Neutral if no data

    let score = 50;

    // Holder growth bonus/penalty
    if (holders.holderVelocity > 2) score += 15;
    else if (holders.holderVelocity > 1) score += 10;
    else if (holders.holderVelocity > 0) score += 5;
    else if (holders.holderVelocity < -1) score -= 15;

    // Concentration penalty
    if (holders.top10Concentration > 50) score -= 20;
    else if (holders.top10Concentration > 30) score -= 10;
    else if (holders.top10Concentration < 20) score += 10;

    // Quality score contribution
    score += (holders.holderQualityScore - 5) * 3;

    // Distribution score contribution
    score += (holders.distributionScore - 5) * 2;

    // Clustering penalty
    if (holders.clusterPercentage > 30) score -= 15;
    else if (holders.clusterPercentage > 15) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculates liquidity-based score (0-100)
   */
  private calculateLiquidityScore(liquidity: LiquidityMetrics | null): number {
    if (!liquidity) return 50;

    let score = 50;

    // Entry zone bonus (critical for our strategy)
    if (liquidity.inEntryZone) {
      score += 25; // Big bonus for being in entry zone

      // Extra bonus for sweet spot (80-90%)
      if (liquidity.bondingCurveProgress >= 80 && liquidity.bondingCurveProgress <= 90) {
        score += 10;
      }
    }

    // Progress velocity bonus (momentum toward migration)
    if (liquidity.progressVelocity > 0.5) score += 10;
    else if (liquidity.progressVelocity > 0.2) score += 5;
    else if (liquidity.progressVelocity < 0) score -= 10;

    // Liquidity depth bonus
    score += (liquidity.liquidityDepthScore - 5) * 3;

    // Slippage penalty
    if (liquidity.slippage1Sol > 5) score -= 15;
    else if (liquidity.slippage1Sol > 3) score -= 5;
    else if (liquidity.slippage1Sol < 1) score += 5;

    // Near migration warning (too close to migrate, might miss exit)
    if (liquidity.bondingCurveProgress > 95) score -= 10;

    // Complete (migrated) = exit signal
    if (liquidity.isComplete) score = 20;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculates time decay factor (0-1)
   */
  private calculateTimeDecay(mintAddress: SolanaAddress, now: Timestamp): number {
    const history = this.signalHistory.get(mintAddress);
    if (!history || history.length === 0) return 1;

    const lastSignal = history[history.length - 1];
    if (!lastSignal) return 1;

    const age = now - lastSignal.timestamp;
    const halfLife = this.config.timeDecayHalfLifeMs;

    // Exponential decay: factor = 0.5 ^ (age / halfLife)
    return Math.pow(0.5, age / halfLife);
  }

  /**
   * Determines trading signal and reasons
   */
  private determineSignal(
    score: number,
    volume: VolumeMetrics | null,
    holders: HolderMetrics | null,
    liquidity: LiquidityMetrics | null,
    safety: SafetyMetrics | null,
    dataCompleteness: number
  ): {
    signal: SignalType;
    signalStrength: number;
    signalReasons: string[];
  } {
    const reasons: string[] = [];

    // Safety override - if not safe, DO_NOT_TRADE
    if (safety && !safety.isSafeToTrade) {
      reasons.push('SAFETY: Token failed safety checks');
      reasons.push(...safety.instantRejectReasons.map(r => `REJECT: ${r}`));
      return {
        signal: SignalType.DO_NOT_TRADE,
        signalStrength: 1,
        signalReasons: reasons,
      };
    }

    // Data completeness check
    if (dataCompleteness < this.config.minDataCompleteness) {
      reasons.push(`Insufficient data (${(dataCompleteness * 100).toFixed(0)}% complete)`);
      return {
        signal: SignalType.HOLD,
        signalStrength: 0.3,
        signalReasons: reasons,
      };
    }

    // Migration check - if complete, exit immediately
    if (liquidity?.isComplete) {
      reasons.push('TOKEN MIGRATED - Exit immediately');
      return {
        signal: SignalType.STRONG_SELL,
        signalStrength: 1,
        signalReasons: reasons,
      };
    }

    // Generate signal based on score thresholds
    let signal: SignalType;
    let signalStrength: number;

    if (score >= this.config.strongBuyThreshold) {
      signal = SignalType.STRONG_BUY;
      signalStrength = Math.min(1, (score - this.config.strongBuyThreshold) / 20 + 0.7);
      reasons.push(`High momentum score: ${score.toFixed(1)}`);
    } else if (score >= this.config.buyThreshold) {
      signal = SignalType.BUY;
      signalStrength = Math.min(0.7, (score - this.config.buyThreshold) / 15 + 0.4);
      reasons.push(`Good momentum score: ${score.toFixed(1)}`);
    } else if (score < this.config.strongSellThreshold) {
      signal = SignalType.STRONG_SELL;
      signalStrength = Math.min(1, (this.config.strongSellThreshold - score) / 15 + 0.7);
      reasons.push(`Very low momentum score: ${score.toFixed(1)}`);
    } else if (score < this.config.sellThreshold) {
      signal = SignalType.SELL;
      signalStrength = Math.min(0.7, (this.config.sellThreshold - score) / 10 + 0.4);
      reasons.push(`Low momentum score: ${score.toFixed(1)}`);
    } else {
      signal = SignalType.HOLD;
      signalStrength = 0.3;
      reasons.push(`Neutral momentum score: ${score.toFixed(1)}`);
    }

    // Add contributing factor reasons
    if (volume) {
      if (volume.volumeTrend === 'accelerating') {
        reasons.push('Volume accelerating');
      }
      if (volume.hasVolumeSpike && volume.buyRatio > 0.5) {
        reasons.push('Buy volume spike detected');
      }
      if (volume.washTradingScore > 0.3) {
        reasons.push('Wash trading suspected');
      }
    }

    if (liquidity) {
      if (liquidity.inEntryZone) {
        reasons.push(`In entry zone (${liquidity.bondingCurveProgress.toFixed(1)}%)`);
      }
      if (liquidity.bondingCurveProgress > 90) {
        reasons.push('Near migration');
      }
    }

    if (holders) {
      if (holders.holderTrend === 'growing') {
        reasons.push('Holders growing');
      }
      if (holders.holderTrend === 'shrinking') {
        reasons.push('Holders declining');
      }
    }

    return { signal, signalStrength, signalReasons: reasons };
  }

  /**
   * Records signal in history for time decay
   */
  private recordSignalHistory(
    mintAddress: SolanaAddress,
    metrics: MomentumMetrics,
    now: Timestamp
  ): void {
    if (!this.signalHistory.has(mintAddress)) {
      this.signalHistory.set(mintAddress, []);
    }

    const history = this.signalHistory.get(mintAddress)!;
    history.push({
      timestamp: now,
      score: metrics.momentumScore,
      signal: metrics.signal,
    });

    // Keep only last 20 signals
    if (history.length > 20) {
      history.shift();
    }
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Gets momentum metrics for a token
   */
  getMomentumMetrics(mintAddress: SolanaAddress): MomentumMetrics | undefined {
    return this.metrics.get(mintAddress);
  }

  /**
   * Gets trading signal for a token
   */
  getSignal(mintAddress: SolanaAddress): SignalType | undefined {
    return this.metrics.get(mintAddress)?.signal;
  }

  /**
   * Gets tokens with BUY or STRONG_BUY signals
   */
  getBuySignals(): Array<{ mint: SolanaAddress; metrics: MomentumMetrics }> {
    return this.getMetricsWhere(m =>
      m.signal === SignalType.BUY || m.signal === SignalType.STRONG_BUY
    ).map(m => ({ mint: m.mintAddress, metrics: m }));
  }

  /**
   * Gets tokens with STRONG_BUY signals
   */
  getStrongBuySignals(): Array<{ mint: SolanaAddress; metrics: MomentumMetrics }> {
    return this.getMetricsWhere(m => m.signal === SignalType.STRONG_BUY)
      .map(m => ({ mint: m.mintAddress, metrics: m }));
  }

  /**
   * Gets tokens that should be exited
   */
  getExitSignals(): Array<{ mint: SolanaAddress; metrics: MomentumMetrics }> {
    return this.getMetricsWhere(m => m.shouldExit)
      .map(m => ({ mint: m.mintAddress, metrics: m }));
  }

  /**
   * Gets tokens ready for entry (BUY + in entry zone + safe)
   */
  getEntryOpportunities(): Array<{ mint: SolanaAddress; metrics: MomentumMetrics }> {
    return this.getMetricsWhere(m =>
      m.shouldEnter &&
      m.inEntryZone &&
      m.safety?.isSafeToTrade !== false
    ).map(m => ({ mint: m.mintAddress, metrics: m }));
  }

  /**
   * Gets top N tokens by momentum score
   */
  getTopTokens(n: number = 10): Array<{ mint: SolanaAddress; metrics: MomentumMetrics }> {
    return Array.from(this.metrics.values())
      .filter(m => m.safety?.isSafeToTrade !== false)
      .sort((a, b) => b.momentumScore - a.momentumScore)
      .slice(0, n)
      .map(m => ({ mint: m.mintAddress, metrics: m }));
  }

  /**
   * Gets health of all analyzers
   */
  getAnalyzerHealth(): {
    volume: ReturnType<VolumeAnalyzer['getHealth']>;
    holders: ReturnType<HolderAnalyzer['getHealth']>;
    liquidity: ReturnType<LiquidityAnalyzer['getHealth']>;
    safety: ReturnType<SafetyAnalyzer['getHealth']>;
    aggregator: ReturnType<MomentumAggregator['getHealth']>;
  } {
    return {
      volume: this.volumeAnalyzer.getHealth(),
      holders: this.holderAnalyzer.getHealth(),
      liquidity: this.liquidityAnalyzer.getHealth(),
      safety: this.safetyAnalyzer.getHealth(),
      aggregator: this.getHealth(),
    };
  }
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

export const momentumAggregator = new MomentumAggregator();

export function initializeMomentumAggregator(
  config?: Partial<MomentumConfig>
): MomentumAggregator {
  const aggregator = new MomentumAggregator(config);
  aggregator.initialize();
  return aggregator;
}

// Re-export types
export { SignalType } from './types.js';
