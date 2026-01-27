/**
 * Liquidity Analyzer
 *
 * Tracks bonding curve progress and liquidity depth.
 * Calculates price impact and slippage estimates.
 *
 * Based on liquidity-and-price-dynamics-explainer skill.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';
import type {
  PumpFunEventEmitter,
  BondingProgressEvent,
  TokenLaunchedEvent,
} from '../core/events.js';
import { BONDING_CURVE } from '../config/constants.js';
import {
  BaseAnalyzer,
  createBaseMetrics,
  lamportsToSol,
  solToLamports,
} from './base.js';
import { NumericWindowStorage } from './time-window.js';
import {
  type LiquidityMetrics,
  type AnalyzerConfig,
  type SlippageEstimate,
  TimeWindow,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface LiquidityAnalyzerConfig extends AnalyzerConfig {
  /** Trade sizes to estimate slippage for (in SOL) */
  slippageEstimateSizes: number[];

  /** Minimum progress to consider tracking */
  minProgressPercent: number;

  /** Maximum acceptable slippage for trading */
  maxAcceptableSlippage: number;
}

const DEFAULT_LIQUIDITY_CONFIG: LiquidityAnalyzerConfig = {
  updateIntervalMs: 30_000, // 30 seconds
  maxDataAgeMs: 120_000, // 2 minutes
  debug: false,
  slippageEstimateSizes: [0.1, 0.5, 1, 2, 5, 10],
  minProgressPercent: 0,
  maxAcceptableSlippage: 5, // 5%
};

// =============================================================================
// TOKEN LIQUIDITY DATA
// =============================================================================

/**
 * Per-token liquidity tracking data
 */
interface TokenLiquidityData {
  /** Progress history */
  progressHistory: NumericWindowStorage;

  /** Current bonding curve state */
  currentState: {
    progressPercent: number;
    virtualTokenReserves: bigint;
    virtualSolReserves: bigint;
    realTokenReserves: bigint;
    realSolReserves: bigint;
    tokenTotalSupply: bigint;
    complete: boolean;
    inEntryZone: boolean;
    lastUpdateAt: Timestamp;
  } | null;

  /** Last calculated metrics */
  lastMetrics: LiquidityMetrics | null;
}

// =============================================================================
// BONDING CURVE MATH
// =============================================================================

/**
 * Pump.fun uses constant product AMM: x * y = k
 * Price = virtualSolReserves / virtualTokenReserves
 */

/**
 * Calculates current token price in SOL
 */
function calculatePrice(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): number {
  if (virtualTokenReserves === 0n) return 0;
  // Price in SOL per token (accounting for 6 decimals on token)
  return (Number(virtualSolReserves) / 1e9) / (Number(virtualTokenReserves) / 1e6);
}

/**
 * Calculates market cap in SOL
 */
function calculateMarketCap(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint,
  totalSupply: bigint
): number {
  const price = calculatePrice(virtualSolReserves, virtualTokenReserves);
  const supplyInTokens = Number(totalSupply) / 1e6;
  return price * supplyInTokens;
}

/**
 * Calculates price impact for a buy trade
 * Using constant product formula: new_price = (sol + amount) / (tokens - tokens_out)
 */
function calculateBuyPriceImpact(
  solAmount: bigint,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): { priceImpact: number; tokensOut: bigint; newPrice: number } {
  if (virtualSolReserves === 0n || virtualTokenReserves === 0n) {
    return { priceImpact: 100, tokensOut: 0n, newPrice: 0 };
  }

  // Constant product: k = x * y
  const k = virtualSolReserves * virtualTokenReserves;

  // After adding SOL, new token reserves to maintain k
  const newSolReserves = virtualSolReserves + solAmount;
  const newTokenReserves = k / newSolReserves;
  const tokensOut = virtualTokenReserves - newTokenReserves;

  // Prices before and after
  const priceBefore = calculatePrice(virtualSolReserves, virtualTokenReserves);
  const priceAfter = calculatePrice(newSolReserves, newTokenReserves);

  // Price impact percentage
  const priceImpact = ((priceAfter - priceBefore) / priceBefore) * 100;

  return {
    priceImpact: Math.abs(priceImpact),
    tokensOut,
    newPrice: priceAfter,
  };
}

/**
 * Calculates slippage for a given trade size
 * Slippage = price_impact + market_movement_estimate
 */
function calculateSlippage(
  solAmount: bigint,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): number {
  const { priceImpact } = calculateBuyPriceImpact(
    solAmount,
    virtualSolReserves,
    virtualTokenReserves
  );

  // Add 0.5% buffer for market movement
  return priceImpact + 0.5;
}

// =============================================================================
// LIQUIDITY ANALYZER CLASS
// =============================================================================

export class LiquidityAnalyzer extends BaseAnalyzer<LiquidityMetrics, LiquidityAnalyzerConfig> {
  protected readonly name = 'liquidity-analyzer';

  /** Per-token liquidity data */
  private liquidityData: Map<SolanaAddress, TokenLiquidityData> = new Map();

  constructor(config: Partial<LiquidityAnalyzerConfig> = {}) {
    super({ ...DEFAULT_LIQUIDITY_CONFIG, ...config });
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected override onInitialize(): void {
    this.logger?.debug('Liquidity analyzer initialized', {
      slippageSizes: this.config.slippageEstimateSizes,
    });
  }

  protected override onStart(): void {
    // Start cleanup timers
    for (const data of this.liquidityData.values()) {
      data.progressHistory.start();
    }
  }

  protected override onStop(): void {
    // Stop cleanup timers
    for (const data of this.liquidityData.values()) {
      data.progressHistory.stop();
    }
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  protected override onSubscribeEvents(eventEmitter: PumpFunEventEmitter): void {
    eventEmitter.on('bonding:progress', event => this.handleBondingProgress(event));
  }

  protected override onUnsubscribeEvents(eventEmitter: PumpFunEventEmitter): void {
    eventEmitter.removeAllListeners('bonding:progress');
  }

  protected override onTokenLaunched(event: TokenLaunchedEvent): void {
    // Create liquidity data for new token
    const data = this.createLiquidityData();
    this.liquidityData.set(event.mintAddress, data);
  }

  protected override onTokenRemoved(mintAddress: SolanaAddress): void {
    const data = this.liquidityData.get(mintAddress);
    if (data) {
      data.progressHistory.stop();
      this.liquidityData.delete(mintAddress);
    }
  }

  /**
   * Handles bonding curve progress updates from Phase 2 monitor
   */
  private handleBondingProgress(event: BondingProgressEvent): void {
    let data = this.liquidityData.get(event.mintAddress);
    if (!data) {
      data = this.createLiquidityData();
      this.liquidityData.set(event.mintAddress, data);
    }

    // Update current state
    data.currentState = {
      progressPercent: event.progressPercent,
      virtualTokenReserves: event.virtualTokenReserves,
      virtualSolReserves: event.virtualSolReserves,
      realTokenReserves: event.realTokenReserves,
      realSolReserves: event.realSolReserves,
      tokenTotalSupply: event.tokenTotalSupply,
      complete: event.progressPercent >= 100,
      inEntryZone: event.inEntryZone,
      lastUpdateAt: event.timestamp,
    };

    // Record progress for velocity calculation
    data.progressHistory.add(event.progressPercent, event.timestamp);

    // Update token entry
    const tokenEntry = this.trackedTokens.get(event.mintAddress);
    if (tokenEntry) {
      tokenEntry.lastUpdateAt = event.timestamp;
    }

    this.logger?.debug('Bonding progress updated', {
      mint: event.mintAddress.slice(0, 8) + '...',
      progress: event.progressPercent.toFixed(2) + '%',
      inEntryZone: event.inEntryZone,
    });
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

      const data = this.liquidityData.get(mintAddress);
      if (!data || !data.currentState) {
        continue;
      }

      // Calculate metrics
      const metrics = this.calculateMetrics(mintAddress, data, now);
      this.metrics.set(mintAddress, metrics);
      data.lastMetrics = metrics;
    }
  }

  /**
   * Calculates liquidity metrics for a token
   */
  private calculateMetrics(
    mintAddress: SolanaAddress,
    data: TokenLiquidityData,
    now: Timestamp
  ): LiquidityMetrics {
    const baseMetrics = createBaseMetrics(
      mintAddress,
      1,
      data.currentState?.lastUpdateAt
    );

    const state = data.currentState!;

    // Calculate current price and market cap
    const currentPriceSol = calculatePrice(
      state.virtualSolReserves,
      state.virtualTokenReserves
    );
    const marketCapSol = calculateMarketCap(
      state.virtualSolReserves,
      state.virtualTokenReserves,
      state.tokenTotalSupply
    );

    // Calculate slippage estimates
    const slippageEstimates = this.calculateSlippageEstimates(
      state.virtualSolReserves,
      state.virtualTokenReserves
    );

    // Get specific slippage values
    const slippage01Sol = this.getSlippageForSize(slippageEstimates, 0.1);
    const slippage1Sol = this.getSlippageForSize(slippageEstimates, 1);
    const slippage5Sol = this.getSlippageForSize(slippageEstimates, 5);

    // Calculate liquidity depth score
    const liquidityDepthScore = this.calculateLiquidityDepthScore(
      state.realSolReserves,
      slippage1Sol
    );

    // Progress velocity (% per minute)
    const progressVelocity = data.progressHistory.getVelocity(
      TimeWindow.FIFTEEN_MINUTES,
      now
    );

    // Estimate time to migration
    const distanceToMigration = Math.max(0, 100 - state.progressPercent);
    const estimatedTimeToMigration = progressVelocity > 0
      ? (distanceToMigration / progressVelocity) * 60 * 1000 // ms
      : null;

    // Liquidity trend
    const progress5mAgo = data.progressHistory.getDataAt(
      TimeWindow.FIVE_MINUTES,
      now
    );
    const liquidityTrend = this.determineLiquidityTrend(
      state.progressPercent,
      progress5mAgo
    );

    // Calculate confidence
    const confidence = this.calculateConfidence(data, now);

    return {
      ...baseMetrics,
      confidence,
      bondingCurveProgress: state.progressPercent,
      isComplete: state.complete,
      inEntryZone: state.inEntryZone,
      virtualTokenReserves: state.virtualTokenReserves,
      virtualSolReserves: state.virtualSolReserves,
      realTokenReserves: state.realTokenReserves,
      realSolReserves: state.realSolReserves,
      totalLiquiditySol: state.realSolReserves,
      currentPriceSol,
      marketCapSol,
      slippageEstimates,
      slippage01Sol,
      slippage1Sol,
      slippage5Sol,
      liquidityDepthScore,
      distanceToMigration,
      estimatedTimeToMigration,
      liquidityTrend,
      progressVelocity,
    };
  }

  /**
   * Calculates slippage estimates for configured trade sizes
   */
  private calculateSlippageEstimates(
    virtualSolReserves: bigint,
    virtualTokenReserves: bigint
  ): SlippageEstimate[] {
    return this.config.slippageEstimateSizes.map(sizeSol => {
      const solAmount = solToLamports(sizeSol);
      const slippagePercent = calculateSlippage(
        solAmount,
        virtualSolReserves,
        virtualTokenReserves
      );
      const { priceImpact } = calculateBuyPriceImpact(
        solAmount,
        virtualSolReserves,
        virtualTokenReserves
      );

      return {
        tradeSizeSol: sizeSol,
        slippagePercent,
        priceImpactPercent: priceImpact,
        isExecutable: slippagePercent <= this.config.maxAcceptableSlippage,
      };
    });
  }

  /**
   * Gets slippage for a specific trade size
   */
  private getSlippageForSize(
    estimates: SlippageEstimate[],
    sizeSol: number
  ): number {
    const estimate = estimates.find(e => e.tradeSizeSol === sizeSol);
    return estimate?.slippagePercent ?? 0;
  }

  /**
   * Calculates liquidity depth score (0-10)
   */
  private calculateLiquidityDepthScore(
    realSolReserves: bigint,
    slippage1Sol: number
  ): number {
    let score = 5;

    // Score based on SOL reserves
    const solReserves = lamportsToSol(realSolReserves);
    if (solReserves >= 50) score += 2;
    else if (solReserves >= 20) score += 1;
    else if (solReserves < 5) score -= 2;

    // Score based on slippage for 1 SOL trade
    if (slippage1Sol <= 1) score += 2;
    else if (slippage1Sol <= 2) score += 1;
    else if (slippage1Sol > 5) score -= 1;
    else if (slippage1Sol > 10) score -= 2;

    return Math.max(0, Math.min(10, score));
  }

  /**
   * Determines liquidity trend
   */
  private determineLiquidityTrend(
    currentProgress: number,
    progress5mAgo: number | undefined
  ): 'growing' | 'stable' | 'shrinking' {
    if (progress5mAgo === undefined) return 'stable';

    const change = currentProgress - progress5mAgo;
    if (change > 1) return 'growing';
    if (change < -0.5) return 'shrinking';
    return 'stable';
  }

  /**
   * Calculates confidence based on data freshness
   */
  private calculateConfidence(data: TokenLiquidityData, now: Timestamp): number {
    if (!data.currentState) return 0.1;

    const dataAge = now - data.currentState.lastUpdateAt;

    // Fresh data = high confidence
    if (dataAge < 30_000) return 1.0;
    if (dataAge < 60_000) return 0.8;
    if (dataAge < 120_000) return 0.5;
    return 0.2;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Creates new liquidity data structure for a token
   */
  private createLiquidityData(): TokenLiquidityData {
    const data: TokenLiquidityData = {
      progressHistory: new NumericWindowStorage({
        maxAgeMs: TimeWindow.TWO_HOURS,
        maxItems: 500,
      }),
      currentState: null,
      lastMetrics: null,
    };

    // Start cleanup if analyzer is running
    if (this.status === 'RUNNING') {
      data.progressHistory.start();
    }

    return data;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Gets liquidity metrics for a token
   */
  getLiquidityMetrics(mintAddress: SolanaAddress): LiquidityMetrics | undefined {
    return this.metrics.get(mintAddress);
  }

  /**
   * Gets tokens in entry zone (70-95% progress)
   */
  getTokensInEntryZone(): SolanaAddress[] {
    return this.getMetricsWhere(m => m.inEntryZone && !m.isComplete)
      .map(m => m.mintAddress);
  }

  /**
   * Gets tokens near migration (>90% progress)
   */
  getTokensNearMigration(threshold: number = 90): SolanaAddress[] {
    return this.getMetricsWhere(m =>
      m.bondingCurveProgress >= threshold && !m.isComplete
    ).map(m => m.mintAddress);
  }

  /**
   * Gets tokens with good liquidity depth
   */
  getTokensWithGoodLiquidity(minScore: number = 6): SolanaAddress[] {
    return this.getMetricsWhere(m => m.liquidityDepthScore >= minScore)
      .map(m => m.mintAddress);
  }

  /**
   * Gets tokens with acceptable slippage for a trade size
   */
  getTokensWithAcceptableSlippage(
    tradeSizeSol: number,
    maxSlippage: number = 3
  ): SolanaAddress[] {
    return this.getMetricsWhere(m => {
      const estimate = m.slippageEstimates.find(e => e.tradeSizeSol === tradeSizeSol);
      return estimate ? estimate.slippagePercent <= maxSlippage : false;
    }).map(m => m.mintAddress);
  }

  /**
   * Estimates price impact for a custom trade size
   */
  estimatePriceImpact(
    mintAddress: SolanaAddress,
    tradeSizeSol: number
  ): { priceImpact: number; slippage: number } | undefined {
    const data = this.liquidityData.get(mintAddress);
    if (!data?.currentState) return undefined;

    const solAmount = solToLamports(tradeSizeSol);
    const { priceImpact } = calculateBuyPriceImpact(
      solAmount,
      data.currentState.virtualSolReserves,
      data.currentState.virtualTokenReserves
    );
    const slippage = calculateSlippage(
      solAmount,
      data.currentState.virtualSolReserves,
      data.currentState.virtualTokenReserves
    );

    return { priceImpact, slippage };
  }

  /**
   * Gets current bonding curve progress
   */
  getProgress(mintAddress: SolanaAddress): number | undefined {
    const data = this.liquidityData.get(mintAddress);
    return data?.currentState?.progressPercent;
  }

  /**
   * Checks if token is in entry zone
   */
  isInEntryZone(mintAddress: SolanaAddress): boolean {
    const data = this.liquidityData.get(mintAddress);
    return data?.currentState?.inEntryZone ?? false;
  }
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

export const liquidityAnalyzer = new LiquidityAnalyzer();

export function initializeLiquidityAnalyzer(
  config?: Partial<LiquidityAnalyzerConfig>
): LiquidityAnalyzer {
  const analyzer = new LiquidityAnalyzer(config);
  analyzer.initialize();
  return analyzer;
}
