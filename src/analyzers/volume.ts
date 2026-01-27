/**
 * Volume Analyzer
 *
 * Tracks trading volume and detects momentum patterns.
 * Includes wash trading detection and trade pattern analysis.
 *
 * Based on trading-bot-architecture skill recommendations.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';
import type { PumpFunEventEmitter, TokenTradeEvent } from '../core/events.js';
import {
  BaseAnalyzer,
  createBaseMetrics,
  lamportsToSol,
} from './base.js';
import {
  TimeWindowedStorage,
  BigIntWindowStorage,
} from './time-window.js';
import {
  type VolumeMetrics,
  type VolumeAnalyzerConfig,
  type TradeRecord,
  TimeWindow,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_VOLUME_CONFIG: VolumeAnalyzerConfig = {
  updateIntervalMs: 30_000, // 30 seconds
  maxDataAgeMs: 120_000, // 2 minutes
  debug: false,
  windows: [
    TimeWindow.FIVE_MINUTES,
    TimeWindow.FIFTEEN_MINUTES,
    TimeWindow.ONE_HOUR,
  ],
  spikeThreshold: 3, // 3x average = spike
  minTradesForMetrics: 3, // Need at least 3 trades
  washTradingThreshold: 0.6, // 60% same wallets = suspicious
};

// =============================================================================
// TOKEN VOLUME DATA
// =============================================================================

/**
 * Per-token volume tracking data
 */
interface TokenVolumeData {
  /** Trade records */
  trades: TimeWindowedStorage<TradeRecord>;

  /** Buy volume storage */
  buyVolume: BigIntWindowStorage;

  /** Sell volume storage */
  sellVolume: BigIntWindowStorage;

  /** Unique traders per window */
  uniqueTraders: Map<SolanaAddress, Timestamp>;

  /** Trade count by trader (for wash detection) */
  tradesByTrader: Map<SolanaAddress, number>;

  /** Last calculated metrics */
  lastMetrics: VolumeMetrics | null;
}

// =============================================================================
// VOLUME ANALYZER CLASS
// =============================================================================

export class VolumeAnalyzer extends BaseAnalyzer<VolumeMetrics, VolumeAnalyzerConfig> {
  protected readonly name = 'volume-analyzer';

  /** Per-token volume data */
  private volumeData: Map<SolanaAddress, TokenVolumeData> = new Map();

  constructor(config: Partial<VolumeAnalyzerConfig> = {}) {
    super({ ...DEFAULT_VOLUME_CONFIG, ...config });
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected override onInitialize(): void {
    this.logger?.debug('Volume analyzer initialized with config', {
      windows: this.config.windows,
      spikeThreshold: this.config.spikeThreshold,
    });
  }

  protected override onStart(): void {
    // Start cleanup timers for all tracked tokens
    for (const data of this.volumeData.values()) {
      data.trades.start();
      data.buyVolume.start();
      data.sellVolume.start();
    }
  }

  protected override onStop(): void {
    // Stop all cleanup timers
    for (const data of this.volumeData.values()) {
      data.trades.stop();
      data.buyVolume.stop();
      data.sellVolume.stop();
    }
  }

  // ===========================================================================
  // EVENT HANDLING
  // ===========================================================================

  protected override onSubscribeEvents(eventEmitter: PumpFunEventEmitter): void {
    eventEmitter.on('token:trade', event => this.handleTrade(event));
  }

  protected override onUnsubscribeEvents(eventEmitter: PumpFunEventEmitter): void {
    eventEmitter.removeAllListeners('token:trade');
  }

  protected override onTokenLaunched(): void {
    // Volume data is created lazily on first trade
  }

  protected override onTokenRemoved(mintAddress: SolanaAddress): void {
    const data = this.volumeData.get(mintAddress);
    if (data) {
      data.trades.stop();
      data.buyVolume.stop();
      data.sellVolume.stop();
      this.volumeData.delete(mintAddress);
    }
  }

  /**
   * Handles incoming trade events
   */
  private handleTrade(event: TokenTradeEvent): void {
    // Ensure token is tracked
    if (!this.trackedTokens.has(event.mintAddress)) {
      return;
    }

    // Get or create volume data
    let data = this.volumeData.get(event.mintAddress);
    if (!data) {
      data = this.createVolumeData();
      this.volumeData.set(event.mintAddress, data);
    }

    // Create trade record
    const trade: TradeRecord = {
      id: event.signature,
      timestamp: event.timestamp,
      type: event.tradeType,
      trader: event.trader,
      solAmount: event.solAmount,
      tokenAmount: event.tokenAmount,
      signature: event.signature,
    };

    // Store trade
    data.trades.add(trade, event.timestamp);

    // Store volume by type
    if (event.tradeType === 'buy') {
      data.buyVolume.add(event.solAmount, event.timestamp);
    } else {
      data.sellVolume.add(event.solAmount, event.timestamp);
    }

    // Track unique traders
    data.uniqueTraders.set(event.trader, event.timestamp);

    // Track trades by trader (for wash detection)
    const currentCount = data.tradesByTrader.get(event.trader) ?? 0;
    data.tradesByTrader.set(event.trader, currentCount + 1);

    // Update token entry
    const tokenEntry = this.trackedTokens.get(event.mintAddress);
    if (tokenEntry) {
      tokenEntry.lastUpdateAt = event.timestamp;
    }

    this.logger?.debug('Trade recorded', {
      mint: event.mintAddress,
      type: event.tradeType,
      solAmount: lamportsToSol(event.solAmount),
      trader: event.trader.slice(0, 8) + '...',
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

      const data = this.volumeData.get(mintAddress);
      if (!data) {
        continue;
      }

      // Calculate metrics
      const metrics = this.calculateMetrics(mintAddress, data, now);
      this.metrics.set(mintAddress, metrics);
      data.lastMetrics = metrics;

      // Cleanup old trader data
      this.cleanupTraderData(data, now);
    }
  }

  /**
   * Calculates volume metrics for a token
   */
  private calculateMetrics(
    mintAddress: SolanaAddress,
    data: TokenVolumeData,
    now: Timestamp
  ): VolumeMetrics {
    const baseMetrics = createBaseMetrics(mintAddress);

    // Get trades for different windows
    const trades5m = data.trades.getWindow(TimeWindow.FIVE_MINUTES, now);
    const trades15m = data.trades.getWindow(TimeWindow.FIFTEEN_MINUTES, now);
    const trades1h = data.trades.getWindow(TimeWindow.ONE_HOUR, now);

    // Calculate volumes
    const volume5m = data.buyVolume.getSum(TimeWindow.FIVE_MINUTES, now) +
                     data.sellVolume.getSum(TimeWindow.FIVE_MINUTES, now);
    const volume15m = data.buyVolume.getSum(TimeWindow.FIFTEEN_MINUTES, now) +
                      data.sellVolume.getSum(TimeWindow.FIFTEEN_MINUTES, now);
    const volume1h = data.buyVolume.getSum(TimeWindow.ONE_HOUR, now) +
                     data.sellVolume.getSum(TimeWindow.ONE_HOUR, now);

    // Average volume per 5 minutes (based on 1h data)
    const avgVolumePer5m = volume1h / 12n;

    // Volume velocity
    const volumeVelocity = avgVolumePer5m > 0n
      ? Number(volume5m - avgVolumePer5m) / Number(avgVolumePer5m)
      : 0;

    // Buy/sell volumes
    const buyVolume = data.buyVolume.getSum(TimeWindow.FIVE_MINUTES, now);
    const sellVolume = data.sellVolume.getSum(TimeWindow.FIVE_MINUTES, now);
    const totalVolume = buyVolume + sellVolume;
    const buyRatio = totalVolume > 0n
      ? Number(buyVolume) / Number(totalVolume)
      : 0.5;

    // Unique traders
    const uniqueTraders = this.countUniqueTraders(trades5m);
    const tradeCount = trades5m.length;

    // Volume per trader
    const volumePerTrader = uniqueTraders > 0
      ? volume5m / BigInt(uniqueTraders)
      : 0n;

    // Volume spike detection
    const spikeMultiplier = avgVolumePer5m > 0n
      ? Number(volume5m) / Number(avgVolumePer5m)
      : 0;
    const hasVolumeSpike = spikeMultiplier >= this.config.spikeThreshold;

    // Wash trading detection
    const washTradingScore = this.calculateWashTradingScore(trades5m, data);

    // Trade size distribution analysis
    const tradeSizeSkew = this.calculateTradeSizeSkew(trades5m);

    // Determine volume trend
    const volumeTrend = this.determineVolumeTrend(volumeVelocity);

    // Calculate confidence based on data availability
    const confidence = this.calculateConfidence(tradeCount, trades1h.length);

    return {
      ...baseMetrics,
      confidence,
      volume5m,
      volume15m,
      volume1h,
      avgVolumePer5m,
      volumeVelocity,
      buyVolume,
      sellVolume,
      buyRatio,
      tradeCount,
      uniqueTraders,
      volumePerTrader,
      hasVolumeSpike,
      spikeMultiplier,
      washTradingScore,
      tradeSizeSkew,
      volumeTrend,
    };
  }

  /**
   * Counts unique traders in trades
   */
  private countUniqueTraders(trades: TradeRecord[]): number {
    const traders = new Set<SolanaAddress>();
    for (const trade of trades) {
      traders.add(trade.trader);
    }
    return traders.size;
  }

  /**
   * Calculates wash trading score (0-1)
   * Higher score = more suspicious
   */
  private calculateWashTradingScore(
    trades: TradeRecord[],
    data: TokenVolumeData
  ): number {
    if (trades.length < 4) {
      return 0; // Not enough data
    }

    let suspiciousPatterns = 0;
    let totalChecks = 0;

    // Check 1: Same traders doing both buy and sell
    const traderTypes = new Map<SolanaAddress, Set<'buy' | 'sell'>>();
    for (const trade of trades) {
      if (!traderTypes.has(trade.trader)) {
        traderTypes.set(trade.trader, new Set());
      }
      traderTypes.get(trade.trader)!.add(trade.type);
    }

    let bothSidesCount = 0;
    for (const types of traderTypes.values()) {
      if (types.has('buy') && types.has('sell')) {
        bothSidesCount++;
      }
    }
    const bothSidesRatio = bothSidesCount / traderTypes.size;
    if (bothSidesRatio > 0.3) {
      suspiciousPatterns++;
    }
    totalChecks++;

    // Check 2: High trade frequency from few wallets
    const tradeCountByTrader = new Map<SolanaAddress, number>();
    for (const trade of trades) {
      const count = tradeCountByTrader.get(trade.trader) ?? 0;
      tradeCountByTrader.set(trade.trader, count + 1);
    }

    let highFrequencyTraders = 0;
    for (const count of tradeCountByTrader.values()) {
      if (count >= 3) {
        highFrequencyTraders++;
      }
    }
    const highFrequencyRatio = highFrequencyTraders / traderTypes.size;
    if (highFrequencyRatio > 0.2) {
      suspiciousPatterns++;
    }
    totalChecks++;

    // Check 3: Low unique traders vs trade count
    const uniqueTraderRatio = traderTypes.size / trades.length;
    if (uniqueTraderRatio < 0.3) {
      suspiciousPatterns++;
    }
    totalChecks++;

    // Check 4: Similar trade sizes (round numbers)
    const tradeSizes = trades.map(t => Number(t.solAmount));
    const roundNumberCount = tradeSizes.filter(size => {
      const solAmount = size / 1e9;
      // Check if it's a round number (0.1, 0.5, 1, 5, 10, etc.)
      return solAmount === Math.round(solAmount * 10) / 10;
    }).length;
    const roundNumberRatio = roundNumberCount / trades.length;
    if (roundNumberRatio > 0.5) {
      suspiciousPatterns++;
    }
    totalChecks++;

    // Check 5: Ping-pong pattern (alternating buy/sell)
    let alternatingCount = 0;
    for (let i = 1; i < trades.length; i++) {
      const prev = trades[i - 1];
      const curr = trades[i];
      if (prev && curr && prev.type !== curr.type) {
        alternatingCount++;
      }
    }
    const alternatingRatio = alternatingCount / (trades.length - 1);
    if (alternatingRatio > 0.7) {
      suspiciousPatterns++;
    }
    totalChecks++;

    return totalChecks > 0 ? suspiciousPatterns / totalChecks : 0;
  }

  /**
   * Calculates trade size distribution skew
   * Bot-like behavior tends to have similar trade sizes
   * Returns -1 to 1, where extreme values indicate suspicious patterns
   */
  private calculateTradeSizeSkew(trades: TradeRecord[]): number {
    if (trades.length < 5) {
      return 0; // Not enough data
    }

    const sizes = trades.map(t => Number(t.solAmount));
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;

    if (mean === 0) return 0;

    // Calculate standard deviation
    const squaredDiffs = sizes.map(size => Math.pow(size - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / sizes.length;
    const stdDev = Math.sqrt(variance);

    // Coefficient of variation (CV)
    // Low CV = similar sizes (suspicious)
    // High CV = varied sizes (more natural)
    const cv = stdDev / mean;

    // Normalize to -1 to 1
    // CV < 0.3 = suspicious (bot-like), returns positive skew
    // CV > 1.0 = natural variation, returns negative skew
    if (cv < 0.3) {
      return Math.min(1, (0.3 - cv) / 0.3); // Suspicious
    } else if (cv > 1.0) {
      return -Math.min(1, (cv - 1.0) / 2); // Natural
    }
    return 0; // Neutral
  }

  /**
   * Determines volume trend from velocity
   */
  private determineVolumeTrend(
    velocity: number
  ): 'accelerating' | 'stable' | 'decelerating' {
    if (velocity > 0.5) return 'accelerating';
    if (velocity < -0.3) return 'decelerating';
    return 'stable';
  }

  /**
   * Calculates confidence based on data availability
   */
  private calculateConfidence(recentTrades: number, hourlyTrades: number): number {
    // Need minimum trades for any confidence
    if (recentTrades < this.config.minTradesForMetrics) {
      return 0.1;
    }

    // More trades = higher confidence
    let confidence = 0.3;

    if (recentTrades >= 5) confidence += 0.2;
    if (recentTrades >= 10) confidence += 0.1;
    if (hourlyTrades >= 20) confidence += 0.2;
    if (hourlyTrades >= 50) confidence += 0.2;

    return Math.min(confidence, 1);
  }

  /**
   * Cleans up old trader data
   */
  private cleanupTraderData(data: TokenVolumeData, now: Timestamp): void {
    const cutoff = now - TimeWindow.ONE_HOUR;

    // Clean up unique traders map
    for (const [trader, timestamp] of data.uniqueTraders) {
      if (timestamp < cutoff) {
        data.uniqueTraders.delete(trader);
        data.tradesByTrader.delete(trader);
      }
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Creates new volume data structure for a token
   */
  private createVolumeData(): TokenVolumeData {
    const data: TokenVolumeData = {
      trades: new TimeWindowedStorage({
        maxAgeMs: TimeWindow.TWO_HOURS,
        maxItems: 2000,
      }),
      buyVolume: new BigIntWindowStorage({
        maxAgeMs: TimeWindow.TWO_HOURS,
        maxItems: 2000,
      }),
      sellVolume: new BigIntWindowStorage({
        maxAgeMs: TimeWindow.TWO_HOURS,
        maxItems: 2000,
      }),
      uniqueTraders: new Map(),
      tradesByTrader: new Map(),
      lastMetrics: null,
    };

    // Start cleanup timers if analyzer is running
    if (this.status === 'RUNNING') {
      data.trades.start();
      data.buyVolume.start();
      data.sellVolume.start();
    }

    return data;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Gets volume metrics for a token
   */
  getVolumeMetrics(mintAddress: SolanaAddress): VolumeMetrics | undefined {
    return this.metrics.get(mintAddress);
  }

  /**
   * Gets tokens with volume spikes
   */
  getTokensWithVolumeSpikes(): SolanaAddress[] {
    return this.getMetricsWhere(m => m.hasVolumeSpike).map(m => m.mintAddress);
  }

  /**
   * Gets tokens with strong buying pressure
   */
  getTokensWithBuyingPressure(minBuyRatio: number = 0.6): SolanaAddress[] {
    return this.getMetricsWhere(m => m.buyRatio >= minBuyRatio).map(m => m.mintAddress);
  }

  /**
   * Gets tokens with suspected wash trading
   */
  getSuspectedWashTrading(threshold: number = 0.5): SolanaAddress[] {
    return this.getMetricsWhere(m => m.washTradingScore >= threshold).map(m => m.mintAddress);
  }

  /**
   * Gets tokens with accelerating volume
   */
  getAcceleratingTokens(): SolanaAddress[] {
    return this.getMetricsWhere(m => m.volumeTrend === 'accelerating').map(m => m.mintAddress);
  }

  protected override estimateMemoryUsage(): number {
    let totalBytes = super.estimateMemoryUsage();

    for (const data of this.volumeData.values()) {
      const tradeStats = data.trades.getStats();
      const buyStats = data.buyVolume.getStats();
      const sellStats = data.sellVolume.getStats();

      totalBytes += tradeStats.memoryEstimateBytes;
      totalBytes += buyStats.memoryEstimateBytes;
      totalBytes += sellStats.memoryEstimateBytes;
      totalBytes += data.uniqueTraders.size * 100;
      totalBytes += data.tradesByTrader.size * 50;
    }

    return totalBytes;
  }
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

export const volumeAnalyzer = new VolumeAnalyzer();

export function initializeVolumeAnalyzer(
  config?: Partial<VolumeAnalyzerConfig>
): VolumeAnalyzer {
  const analyzer = new VolumeAnalyzer(config);
  analyzer.initialize();
  return analyzer;
}
