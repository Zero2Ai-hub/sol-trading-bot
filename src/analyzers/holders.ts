/**
 * Holder Analyzer
 *
 * Tracks token holder distribution and growth.
 * Includes wallet clustering detection for sybil attack identification.
 *
 * Based on token-analysis-checklist and rug-detection-checklist skills.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';
import type {
  PumpFunEventEmitter,
  TokenLaunchedEvent,
  TokenTradeEvent,
} from '../core/events.js';
import {
  BaseAnalyzer,
  createBaseMetrics,
  normalizeScore,
} from './base.js';
import { SnapshotStorage } from './time-window.js';
import {
  type HolderMetrics,
  type HolderAnalyzerConfig,
  type HolderInfo,
  type HolderSnapshot,
  TimeWindow,
  RiskLevel,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_HOLDER_CONFIG: HolderAnalyzerConfig = {
  updateIntervalMs: 60_000, // 1 minute
  maxDataAgeMs: 180_000, // 3 minutes
  debug: false,
  snapshotIntervalMs: 60_000, // 1 minute
  topHoldersCount: 20,
  maxConcentrationWarning: 30, // 30% warning
  maxConcentrationCritical: 50, // 50% critical
  maxDevHoldingsPercent: 20,
  newWalletThresholdMs: 24 * 60 * 60 * 1000, // 24 hours
};

// =============================================================================
// TOKEN HOLDER DATA
// =============================================================================

/**
 * Per-token holder tracking data
 */
interface TokenHolderData {
  /** Holder snapshots over time */
  snapshots: SnapshotStorage<HolderSnapshot>;

  /** Known traders from trade events */
  knownTraders: Set<SolanaAddress>;

  /** Creator address */
  creator: SolanaAddress;

  /** Last snapshot timestamp */
  lastSnapshotAt: Timestamp;

  /** Trader wallet ages (estimated from first seen) */
  traderFirstSeen: Map<SolanaAddress, Timestamp>;

  /** Wallet funding sources (for clustering) */
  walletFundingSources: Map<SolanaAddress, SolanaAddress>;

  /** Last calculated metrics */
  lastMetrics: HolderMetrics | null;

  /** Estimated holder count from trades */
  estimatedHolderCount: number;
}

// =============================================================================
// HOLDER ANALYZER CLASS
// =============================================================================

export class HolderAnalyzer extends BaseAnalyzer<HolderMetrics, HolderAnalyzerConfig> {
  protected readonly name = 'holder-analyzer';

  /** Per-token holder data */
  private holderData: Map<SolanaAddress, TokenHolderData> = new Map();

  constructor(config: Partial<HolderAnalyzerConfig> = {}) {
    super({ ...DEFAULT_HOLDER_CONFIG, ...config });
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected override onInitialize(): void {
    this.logger?.debug('Holder analyzer initialized with config', {
      snapshotIntervalMs: this.config.snapshotIntervalMs,
      maxConcentrationWarning: this.config.maxConcentrationWarning,
    });
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

  protected override onTokenLaunched(event: TokenLaunchedEvent): void {
    // Create holder data for new token
    const data = this.createHolderData(event.creator);
    this.holderData.set(event.mintAddress, data);

    // Creator is first known trader
    data.knownTraders.add(event.creator);
    data.traderFirstSeen.set(event.creator, event.timestamp);
  }

  protected override onTokenRemoved(mintAddress: SolanaAddress): void {
    this.holderData.delete(mintAddress);
  }

  /**
   * Handles trade events to track unique traders
   */
  private handleTrade(event: TokenTradeEvent): void {
    const data = this.holderData.get(event.mintAddress);
    if (!data) {
      return;
    }

    // Track trader
    data.knownTraders.add(event.trader);

    // Track first seen time (wallet age proxy)
    if (!data.traderFirstSeen.has(event.trader)) {
      data.traderFirstSeen.set(event.trader, event.timestamp);
    }

    // Update estimated holder count
    // Buy = potential new holder, Sell might remove holder
    if (event.tradeType === 'buy') {
      data.estimatedHolderCount = Math.max(
        data.estimatedHolderCount,
        data.knownTraders.size
      );
    }
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

      let data = this.holderData.get(mintAddress);
      if (!data) {
        data = this.createHolderData(tokenEntry.creator);
        this.holderData.set(mintAddress, data);
      }

      // Take snapshot if needed
      if (now - data.lastSnapshotAt >= this.config.snapshotIntervalMs) {
        await this.takeSnapshot(mintAddress, data, now);
      }

      // Calculate metrics
      const metrics = this.calculateMetrics(mintAddress, data, now);
      this.metrics.set(mintAddress, metrics);
      data.lastMetrics = metrics;
    }
  }

  /**
   * Takes a holder snapshot
   * Note: In production, this would query RPC for actual holder data
   * For now, we estimate from trade events
   */
  private async takeSnapshot(
    mintAddress: SolanaAddress,
    data: TokenHolderData,
    now: Timestamp
  ): Promise<void> {
    // Estimate holders from known traders
    // In production, query token accounts via RPC:
    // const accounts = await rpcManager.getTokenAccountsByMint(mintAddress);

    const snapshot: HolderSnapshot = {
      timestamp: now,
      totalHolders: data.estimatedHolderCount,
      topHolders: this.estimateTopHolders(data),
      top10Percentage: 0, // Will be calculated
      top20Percentage: 0,
    };

    // Calculate concentrations
    snapshot.top10Percentage = snapshot.topHolders
      .slice(0, 10)
      .reduce((sum, h) => sum + h.percentage, 0);
    snapshot.top20Percentage = snapshot.topHolders
      .slice(0, 20)
      .reduce((sum, h) => sum + h.percentage, 0);

    data.snapshots.addSnapshot(snapshot, now);
    data.lastSnapshotAt = now;

    this.logger?.debug('Holder snapshot taken', {
      mint: mintAddress.slice(0, 8) + '...',
      holders: snapshot.totalHolders,
      top10: snapshot.top10Percentage.toFixed(1) + '%',
    });
  }

  /**
   * Estimates top holders from trade data
   * In production, replace with actual RPC query
   */
  private estimateTopHolders(data: TokenHolderData): HolderInfo[] {
    const holders: HolderInfo[] = [];

    // Creator is likely a top holder
    holders.push({
      address: data.creator,
      balance: 0n, // Unknown without RPC
      percentage: 10, // Estimate
      isKnown: true,
      label: 'Creator',
    });

    // Add known traders as potential holders
    // In production, sort by actual balance
    let index = 0;
    for (const trader of data.knownTraders) {
      if (trader === data.creator) continue;
      if (index >= this.config.topHoldersCount - 1) break;

      const firstSeen = data.traderFirstSeen.get(trader);
      const walletAgeMs = firstSeen ? Date.now() - firstSeen : undefined;

      holders.push({
        address: trader,
        balance: 0n,
        percentage: Math.max(1, 5 - index * 0.5), // Decreasing estimate
        isKnown: false,
        walletAgeMs,
        fundedFrom: data.walletFundingSources.get(trader),
      });
      index++;
    }

    return holders;
  }

  /**
   * Calculates holder metrics for a token
   */
  private calculateMetrics(
    mintAddress: SolanaAddress,
    data: TokenHolderData,
    now: Timestamp
  ): HolderMetrics {
    const baseMetrics = createBaseMetrics(mintAddress);

    // Get current and historical snapshots
    const currentSnapshot = data.snapshots.getLatest();
    const snapshot5mAgo = data.snapshots.getSnapshotAt(TimeWindow.FIVE_MINUTES, now);
    const snapshot1hAgo = data.snapshots.getSnapshotAt(TimeWindow.ONE_HOUR, now);

    const totalHolders = currentSnapshot?.totalHolders ?? data.estimatedHolderCount;
    const holders5mAgo = snapshot5mAgo?.totalHolders ?? totalHolders;
    const holders1hAgo = snapshot1hAgo?.totalHolders ?? totalHolders;

    // Holder velocity (new holders per minute)
    const holderVelocity = (totalHolders - holders5mAgo) / 5;

    // Holder growth rate (1h)
    const holderGrowthRate = holders1hAgo > 0
      ? ((totalHolders - holders1hAgo) / holders1hAgo) * 100
      : 0;

    // Concentrations
    const top10Concentration = currentSnapshot?.top10Percentage ?? 50;
    const top20Concentration = currentSnapshot?.top20Percentage ?? 70;

    // Dev/Creator holdings
    const devHoldingsPercent = this.estimateDevHoldings(data);
    const creatorHoldingsPercent = devHoldingsPercent; // Same for Pump.fun

    // Largest holder
    const largestHolderPercent = currentSnapshot?.topHolders[0]?.percentage ?? 10;

    // Wallet clustering detection
    const clusteringResult = this.detectWalletClustering(data);

    // Wallet age analysis
    const walletAgeResult = this.analyzeWalletAges(data, now);

    // Calculate scores
    const distributionScore = this.calculateDistributionScore(
      top10Concentration,
      top20Concentration,
      largestHolderPercent
    );

    const holderQualityScore = this.calculateHolderQualityScore(
      walletAgeResult.avgWalletAgeMs,
      walletAgeResult.newWalletPercentage,
      clusteringResult.clusterPercentage
    );

    // Determine trend
    const holderTrend = this.determineHolderTrend(holderVelocity, holderGrowthRate);

    // Collect red flags
    const redFlags = this.collectRedFlags(
      top10Concentration,
      devHoldingsPercent,
      clusteringResult,
      walletAgeResult,
      holderVelocity
    );

    // Calculate confidence
    const confidence = this.calculateConfidence(data, currentSnapshot);

    return {
      ...baseMetrics,
      confidence,
      totalHolders,
      holders5mAgo,
      holders1hAgo,
      holderVelocity,
      holderGrowthRate,
      top10Concentration,
      top20Concentration,
      devHoldingsPercent,
      creatorHoldingsPercent,
      largestHolderPercent,
      clusteredWallets: clusteringResult.clusteredWallets,
      clusterPercentage: clusteringResult.clusterPercentage,
      avgWalletAgeMs: walletAgeResult.avgWalletAgeMs,
      newWalletPercentage: walletAgeResult.newWalletPercentage,
      distributionScore,
      holderQualityScore,
      holderTrend,
      redFlags,
    };
  }

  /**
   * Estimates dev holdings percentage
   */
  private estimateDevHoldings(data: TokenHolderData): number {
    // In production, check actual creator balance
    // For now, estimate based on trade patterns
    const snapshot = data.snapshots.getLatest();
    const creatorHolder = snapshot?.topHolders.find(h => h.address === data.creator);
    return creatorHolder?.percentage ?? 10;
  }

  /**
   * Detects wallet clustering (sybil attack indicator)
   */
  private detectWalletClustering(data: TokenHolderData): {
    clusteredWallets: number;
    clusterPercentage: number;
  } {
    // Check for wallets funded from the same source
    const fundingGroups = new Map<SolanaAddress, SolanaAddress[]>();

    for (const [wallet, fundedFrom] of data.walletFundingSources) {
      if (!fundingGroups.has(fundedFrom)) {
        fundingGroups.set(fundedFrom, []);
      }
      fundingGroups.get(fundedFrom)!.push(wallet);
    }

    // Count wallets in clusters (groups > 2)
    let clusteredWallets = 0;
    for (const group of fundingGroups.values()) {
      if (group.length >= 2) {
        clusteredWallets += group.length;
      }
    }

    const clusterPercentage = data.knownTraders.size > 0
      ? (clusteredWallets / data.knownTraders.size) * 100
      : 0;

    return { clusteredWallets, clusterPercentage };
  }

  /**
   * Analyzes wallet ages
   */
  private analyzeWalletAges(
    data: TokenHolderData,
    now: Timestamp
  ): {
    avgWalletAgeMs: number;
    newWalletPercentage: number;
  } {
    const ages: number[] = [];
    let newWallets = 0;

    for (const firstSeen of data.traderFirstSeen.values()) {
      const age = now - firstSeen;
      ages.push(age);

      if (age < this.config.newWalletThresholdMs) {
        newWallets++;
      }
    }

    const avgWalletAgeMs = ages.length > 0
      ? ages.reduce((a, b) => a + b, 0) / ages.length
      : 0;

    const newWalletPercentage = data.traderFirstSeen.size > 0
      ? (newWallets / data.traderFirstSeen.size) * 100
      : 0;

    return { avgWalletAgeMs, newWalletPercentage };
  }

  /**
   * Calculates holder distribution score (0-10)
   */
  private calculateDistributionScore(
    top10: number,
    top20: number,
    largest: number
  ): number {
    let score = 10;

    // Penalize high concentration
    if (top10 > 30) score -= 2;
    if (top10 > 50) score -= 2;
    if (top20 > 50) score -= 1;
    if (top20 > 70) score -= 1;
    if (largest > 10) score -= 1;
    if (largest > 20) score -= 2;

    return Math.max(0, Math.min(10, score));
  }

  /**
   * Calculates holder quality score (0-10)
   */
  private calculateHolderQualityScore(
    avgAgeMs: number,
    newWalletPercent: number,
    clusterPercent: number
  ): number {
    let score = 5;

    // Reward older wallets
    const avgAgeDays = avgAgeMs / (24 * 60 * 60 * 1000);
    if (avgAgeDays > 7) score += 1;
    if (avgAgeDays > 30) score += 1;
    if (avgAgeDays > 90) score += 1;

    // Penalize new wallets
    if (newWalletPercent > 50) score -= 2;
    if (newWalletPercent > 80) score -= 2;

    // Penalize clustering
    if (clusterPercent > 10) score -= 1;
    if (clusterPercent > 30) score -= 2;

    return Math.max(0, Math.min(10, score));
  }

  /**
   * Determines holder trend
   */
  private determineHolderTrend(
    velocity: number,
    growthRate: number
  ): 'growing' | 'stable' | 'shrinking' {
    if (velocity > 1 || growthRate > 10) return 'growing';
    if (velocity < -0.5 || growthRate < -5) return 'shrinking';
    return 'stable';
  }

  /**
   * Collects red flags for holder metrics
   */
  private collectRedFlags(
    top10: number,
    devHoldings: number,
    clustering: { clusteredWallets: number; clusterPercentage: number },
    walletAge: { avgWalletAgeMs: number; newWalletPercentage: number },
    velocity: number
  ): string[] {
    const flags: string[] = [];

    if (top10 > this.config.maxConcentrationCritical) {
      flags.push(`CRITICAL: Top 10 holders control ${top10.toFixed(1)}%`);
    } else if (top10 > this.config.maxConcentrationWarning) {
      flags.push(`WARNING: Top 10 holders control ${top10.toFixed(1)}%`);
    }

    if (devHoldings > this.config.maxDevHoldingsPercent) {
      flags.push(`Dev holds ${devHoldings.toFixed(1)}% - dump risk`);
    }

    if (clustering.clusterPercentage > 20) {
      flags.push(`${clustering.clusteredWallets} wallets from same source (sybil risk)`);
    }

    if (walletAge.newWalletPercentage > 80) {
      flags.push(`${walletAge.newWalletPercentage.toFixed(0)}% new wallets`);
    }

    if (velocity < -1) {
      flags.push('Holders declining rapidly');
    }

    return flags;
  }

  /**
   * Calculates confidence based on data availability
   */
  private calculateConfidence(
    data: TokenHolderData,
    snapshot: HolderSnapshot | undefined
  ): number {
    let confidence = 0.3; // Base confidence

    if (snapshot) confidence += 0.2;
    if (data.knownTraders.size >= 5) confidence += 0.1;
    if (data.knownTraders.size >= 20) confidence += 0.1;
    if (data.snapshots.getCount() >= 3) confidence += 0.2;
    if (data.traderFirstSeen.size >= 10) confidence += 0.1;

    return Math.min(confidence, 1);
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Creates new holder data structure for a token
   */
  private createHolderData(creator: SolanaAddress): TokenHolderData {
    return {
      snapshots: new SnapshotStorage({
        maxSnapshots: 120, // 2 hours at 1 per minute
        maxAgeMs: TimeWindow.TWO_HOURS,
      }),
      knownTraders: new Set(),
      creator,
      lastSnapshotAt: 0,
      traderFirstSeen: new Map(),
      walletFundingSources: new Map(),
      lastMetrics: null,
      estimatedHolderCount: 1, // Creator
    };
  }

  /**
   * Manually sets wallet funding source for clustering detection
   */
  setWalletFundingSource(
    mintAddress: SolanaAddress,
    wallet: SolanaAddress,
    fundedFrom: SolanaAddress
  ): void {
    const data = this.holderData.get(mintAddress);
    if (data) {
      data.walletFundingSources.set(wallet, fundedFrom);
    }
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Gets holder metrics for a token
   */
  getHolderMetrics(mintAddress: SolanaAddress): HolderMetrics | undefined {
    return this.metrics.get(mintAddress);
  }

  /**
   * Gets tokens with concerning holder concentration
   */
  getConcentratedTokens(threshold?: number): SolanaAddress[] {
    const limit = threshold ?? this.config.maxConcentrationWarning;
    return this.getMetricsWhere(m => m.top10Concentration > limit)
      .map(m => m.mintAddress);
  }

  /**
   * Gets tokens with suspected sybil patterns
   */
  getSybilSuspects(threshold: number = 20): SolanaAddress[] {
    return this.getMetricsWhere(m => m.clusterPercentage > threshold)
      .map(m => m.mintAddress);
  }

  /**
   * Gets tokens with growing holder base
   */
  getGrowingTokens(): SolanaAddress[] {
    return this.getMetricsWhere(m => m.holderTrend === 'growing')
      .map(m => m.mintAddress);
  }

  /**
   * Gets tokens with high holder quality
   */
  getHighQualityHolders(minScore: number = 7): SolanaAddress[] {
    return this.getMetricsWhere(m => m.holderQualityScore >= minScore)
      .map(m => m.mintAddress);
  }
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

export const holderAnalyzer = new HolderAnalyzer();

export function initializeHolderAnalyzer(
  config?: Partial<HolderAnalyzerConfig>
): HolderAnalyzer {
  const analyzer = new HolderAnalyzer(config);
  analyzer.initialize();
  return analyzer;
}
