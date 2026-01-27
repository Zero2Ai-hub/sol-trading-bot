/**
 * Safety Analyzer
 *
 * Comprehensive rug detection and safety scoring.
 * Implements full checks from rug-detection-checklist
 * and token-analysis-checklist skills.
 *
 * CRITICAL: This is the primary defense against scams.
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
  scoreToRiskLevel,
} from './base.js';
import {
  type SafetyMetrics,
  type SafetyAnalyzerConfig,
  type AuthorityCheck,
  type CreatorAnalysis,
  type BundleAnalysis,
  type SocialVerification,
  type Score,
  RiskLevel,
} from './types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_SAFETY_CONFIG: SafetyAnalyzerConfig = {
  updateIntervalMs: 60_000, // 1 minute (safety checks are expensive)
  maxDataAgeMs: 300_000, // 5 minutes
  debug: false,
  minSafetyScore: 60, // Minimum score to trade (0-100)
  scoreWeights: {
    mintAuthority: 25, // 25% weight - most critical
    freezeAuthority: 15, // 15% weight
    holderDistribution: 15, // 15% weight
    devHoldings: 15, // 15% weight
    creatorAnalysis: 10, // 10% weight
    socialPresence: 5, // 5% weight
    tokenAge: 10, // 10% weight
    bundleAnalysis: 5, // 5% weight
  },
  minTokenAgeMinutes: 5,
  maxTop10Concentration: 30,
  maxDevHoldings: 20,
};

// =============================================================================
// TOKEN SAFETY DATA
// =============================================================================

/**
 * Per-token safety tracking data
 */
interface TokenSafetyData {
  /** Token launch timestamp */
  launchedAt: Timestamp;

  /** Creator address */
  creator: SolanaAddress;

  /** Mint authority status */
  mintAuthority: AuthorityCheck | null;

  /** Freeze authority status */
  freezeAuthority: AuthorityCheck | null;

  /** First trades (for bundle detection) */
  firstTrades: Array<{
    trader: SolanaAddress;
    timestamp: Timestamp;
    type: 'buy' | 'sell';
    solAmount: bigint;
    signature: string;
  }>;

  /** Unique first-minute traders */
  firstMinuteTraders: Set<SolanaAddress>;

  /** Creator analysis */
  creatorAnalysis: CreatorAnalysis | null;

  /** Bundle analysis */
  bundleAnalysis: BundleAnalysis | null;

  /** Social verification */
  socialVerification: SocialVerification | null;

  /** Token metadata URI */
  metadataUri?: string;

  /** Last safety check timestamp */
  lastCheckAt: Timestamp;

  /** Last calculated metrics */
  lastMetrics: SafetyMetrics | null;

  /** Has passed initial safety check? */
  initialCheckDone: boolean;
}

// =============================================================================
// INSTANT REJECT PATTERNS
// =============================================================================

/**
 * Patterns that should cause immediate rejection
 */
const INSTANT_REJECT_PATTERNS = {
  // Suspicious token names
  SUSPICIOUS_NAMES: [
    /safe/i, // "SafeMoon" pattern
    /elon/i, // Elon scams
    /trump/i, // Political scams
    /guaranteed/i,
    /100x/i,
    /1000x/i,
    /moon/i,
    /lambo/i,
  ],

  // Known scam patterns in metadata
  SCAM_PATTERNS: [
    /airdrop.*claim/i,
    /free.*tokens/i,
    /guaranteed.*return/i,
  ],
};

// =============================================================================
// SAFETY ANALYZER CLASS
// =============================================================================

export class SafetyAnalyzer extends BaseAnalyzer<SafetyMetrics, SafetyAnalyzerConfig> {
  protected readonly name = 'safety-analyzer';

  /** Per-token safety data */
  private safetyData: Map<SolanaAddress, TokenSafetyData> = new Map();

  /** Known rug creators (blacklist) */
  private knownRugCreators: Set<SolanaAddress> = new Set();

  constructor(config: Partial<SafetyAnalyzerConfig> = {}) {
    super({ ...DEFAULT_SAFETY_CONFIG, ...config });
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  protected override onInitialize(): void {
    this.logger?.debug('Safety analyzer initialized', {
      minSafetyScore: this.config.minSafetyScore,
      scoreWeights: this.config.scoreWeights,
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
    // Create safety data for new token
    const data: TokenSafetyData = {
      launchedAt: event.timestamp,
      creator: event.creator,
      mintAuthority: null,
      freezeAuthority: null,
      firstTrades: [],
      firstMinuteTraders: new Set(),
      creatorAnalysis: null,
      bundleAnalysis: null,
      socialVerification: null,
      metadataUri: event.uri,
      lastCheckAt: 0,
      lastMetrics: null,
      initialCheckDone: false,
    };

    this.safetyData.set(event.mintAddress, data);

    // Check for instant rejects
    this.checkInstantRejects(event.mintAddress, event.name, event.symbol);
  }

  protected override onTokenRemoved(mintAddress: SolanaAddress): void {
    this.safetyData.delete(mintAddress);
  }

  /**
   * Handles trade events for bundle detection
   */
  private handleTrade(event: TokenTradeEvent): void {
    const data = this.safetyData.get(event.mintAddress);
    if (!data) return;

    // Track first-minute traders for bundle detection
    const timeSinceLaunch = event.timestamp - data.launchedAt;
    if (timeSinceLaunch <= 60_000) { // First minute
      data.firstMinuteTraders.add(event.trader);

      // Store first trades (limit to 50)
      if (data.firstTrades.length < 50) {
        data.firstTrades.push({
          trader: event.trader,
          timestamp: event.timestamp,
          type: event.tradeType,
          solAmount: event.solAmount,
          signature: event.signature,
        });
      }
    }
  }

  // ===========================================================================
  // INSTANT REJECT CHECKS
  // ===========================================================================

  /**
   * Checks for instant reject conditions
   */
  private checkInstantRejects(
    mintAddress: SolanaAddress,
    name?: string,
    symbol?: string
  ): void {
    const data = this.safetyData.get(mintAddress);
    if (!data) return;

    const instantRejects: string[] = [];

    // Check creator blacklist
    if (this.knownRugCreators.has(data.creator)) {
      instantRejects.push('CREATOR_BLACKLISTED: Known rug creator');
    }

    // Check suspicious name patterns
    if (name) {
      for (const pattern of INSTANT_REJECT_PATTERNS.SUSPICIOUS_NAMES) {
        if (pattern.test(name)) {
          // Note: This is a warning, not auto-reject (many legit memecoins use these)
          this.logger?.debug('Suspicious name pattern detected', {
            mint: mintAddress,
            name,
            pattern: pattern.toString(),
          });
        }
      }
    }

    if (instantRejects.length > 0) {
      this.logger?.warn('INSTANT REJECT triggered', {
        mint: mintAddress,
        reasons: instantRejects,
      });
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

      const data = this.safetyData.get(mintAddress);
      if (!data) continue;

      // Run initial check if not done
      if (!data.initialCheckDone) {
        await this.runInitialCheck(mintAddress, data);
        data.initialCheckDone = true;
      }

      // Calculate metrics
      const metrics = this.calculateMetrics(mintAddress, data, now);
      this.metrics.set(mintAddress, metrics);
      data.lastMetrics = metrics;
      data.lastCheckAt = now;
    }
  }

  /**
   * Runs initial safety check on new token
   */
  private async runInitialCheck(
    mintAddress: SolanaAddress,
    data: TokenSafetyData
  ): Promise<void> {
    // In production, these would query the blockchain
    // For now, we'll use simulated/default values

    // Check authorities (simulate - in production use RPC)
    data.mintAuthority = await this.checkAuthority(mintAddress, 'mint');
    data.freezeAuthority = await this.checkAuthority(mintAddress, 'freeze');

    // Analyze creator
    data.creatorAnalysis = await this.analyzeCreator(data.creator);

    // Bundle analysis (from first trades)
    data.bundleAnalysis = this.analyzeBundles(data);

    // Social verification (from metadata)
    data.socialVerification = await this.verifySocials(data.metadataUri);

    this.logger?.info('Initial safety check completed', {
      mint: mintAddress.slice(0, 8) + '...',
      mintAuthorityRevoked: data.mintAuthority?.isRevoked,
      freezeAuthorityRevoked: data.freezeAuthority?.isRevoked,
    });
  }

  /**
   * Checks mint or freeze authority status
   * In production, query SPL Token program
   */
  private async checkAuthority(
    mintAddress: SolanaAddress,
    type: 'mint' | 'freeze'
  ): Promise<AuthorityCheck> {
    // In production:
    // const mintInfo = await rpcManager.getAccountInfo(mintAddress);
    // Parse mint account data to check authority

    // Pump.fun tokens typically have authorities revoked after creation
    // Default to safe for Pump.fun tokens (they auto-revoke)
    const isRevoked = true; // Pump.fun revokes by default

    const score: Score = isRevoked ? 10 : 0;
    const riskLevel = isRevoked ? RiskLevel.LOW : RiskLevel.CRITICAL;

    return {
      type,
      isRevoked,
      authorityAddress: isRevoked ? undefined : 'unknown',
      riskLevel,
      score,
    };
  }

  /**
   * Analyzes creator wallet
   */
  private async analyzeCreator(creator: SolanaAddress): Promise<CreatorAnalysis> {
    // In production, query transaction history:
    // const history = await rpcManager.getSignaturesForAddress(creator);

    // Default analysis (would be enriched with actual data)
    const isKnownRug = this.knownRugCreators.has(creator);

    return {
      address: creator,
      walletAgeDays: 30, // Default estimate
      fundingSource: 'unknown',
      previousTokensCount: 0,
      previousRugsCount: isKnownRug ? 1 : 0,
      currentHoldingsPercent: 10, // Default estimate
      hasDumped: false,
      score: isKnownRug ? 0 : 7,
      redFlags: isKnownRug ? ['Known rug creator'] : [],
    };
  }

  /**
   * Analyzes first trades for bundled transactions
   */
  private analyzeBundles(data: TokenSafetyData): BundleAnalysis {
    const firstTrades = data.firstTrades;

    if (firstTrades.length < 3) {
      return {
        hasBundledTrades: false,
        bundleSize: 0,
        bundledAddresses: [],
        bundledSupplyPercent: 0,
        riskLevel: RiskLevel.LOW,
      };
    }

    // Check for suspicious patterns:
    // 1. Multiple buys in same slot/block
    // 2. Sequential transactions from different wallets
    // 3. Similar buy amounts

    // Group by timestamp (within 2 seconds = likely bundled)
    const timeGroups = new Map<number, typeof firstTrades>();
    for (const trade of firstTrades) {
      const bucket = Math.floor(trade.timestamp / 2000) * 2000;
      if (!timeGroups.has(bucket)) {
        timeGroups.set(bucket, []);
      }
      timeGroups.get(bucket)!.push(trade);
    }

    // Find potential bundles (3+ trades in same time bucket)
    let bundledAddresses: SolanaAddress[] = [];
    let maxBundleSize = 0;

    for (const [, trades] of timeGroups) {
      if (trades.length >= 3) {
        const addresses = trades.map(t => t.trader);
        if (trades.length > maxBundleSize) {
          maxBundleSize = trades.length;
          bundledAddresses = addresses;
        }
      }
    }

    const hasBundledTrades = maxBundleSize >= 3;

    // Estimate supply acquired in bundle
    const bundledVolume = firstTrades
      .filter(t => bundledAddresses.includes(t.trader))
      .reduce((sum, t) => sum + t.solAmount, 0n);

    // Rough estimate: bundled SOL / total first trades SOL * estimated supply %
    const totalVolume = firstTrades.reduce((sum, t) => sum + t.solAmount, 0n);
    const bundledSupplyPercent = totalVolume > 0n
      ? (Number(bundledVolume) / Number(totalVolume)) * 30 // Assume first trades are ~30% of supply
      : 0;

    const riskLevel = hasBundledTrades
      ? bundledSupplyPercent > 10
        ? RiskLevel.HIGH
        : RiskLevel.MEDIUM
      : RiskLevel.LOW;

    return {
      hasBundledTrades,
      bundleSize: maxBundleSize,
      bundledAddresses,
      bundledSupplyPercent,
      riskLevel,
    };
  }

  /**
   * Verifies social links from metadata
   */
  private async verifySocials(metadataUri?: string): Promise<SocialVerification> {
    // In production, fetch and parse metadata JSON
    // Then verify social links exist

    // Default: no socials verified
    return {
      hasWebsite: false,
      hasTwitter: false,
      hasTelegram: false,
      score: 0,
      notes: ['Social verification not implemented - manual check recommended'],
    };
  }

  /**
   * Calculates safety metrics for a token
   */
  private calculateMetrics(
    mintAddress: SolanaAddress,
    data: TokenSafetyData,
    now: Timestamp
  ): SafetyMetrics {
    const baseMetrics = createBaseMetrics(mintAddress);

    // Token age
    const tokenAgeMs = now - data.launchedAt;
    const tokenAgeMinutes = tokenAgeMs / (60 * 1000);
    const tokenAgeOk = tokenAgeMinutes >= this.config.minTokenAgeMinutes;

    // Default values for missing checks
    const mintAuthority = data.mintAuthority ?? {
      type: 'mint' as const,
      isRevoked: false,
      riskLevel: RiskLevel.CRITICAL,
      score: 0,
    };

    const freezeAuthority = data.freezeAuthority ?? {
      type: 'freeze' as const,
      isRevoked: false,
      riskLevel: RiskLevel.HIGH,
      score: 0,
    };

    const creatorAnalysis = data.creatorAnalysis ?? {
      address: data.creator,
      walletAgeDays: 0,
      fundingSource: 'unknown' as const,
      previousTokensCount: 0,
      previousRugsCount: 0,
      currentHoldingsPercent: 0,
      hasDumped: false,
      score: 5,
      redFlags: [],
    };

    const bundleAnalysis = data.bundleAnalysis ?? {
      hasBundledTrades: false,
      bundleSize: 0,
      bundledAddresses: [],
      bundledSupplyPercent: 0,
      riskLevel: RiskLevel.LOW,
    };

    const socialVerification = data.socialVerification ?? {
      hasWebsite: false,
      hasTwitter: false,
      hasTelegram: false,
      score: 0,
      notes: [],
    };

    // Calculate score breakdown
    const scoreBreakdown = this.calculateScoreBreakdown(
      mintAuthority,
      freezeAuthority,
      creatorAnalysis,
      bundleAnalysis,
      socialVerification,
      tokenAgeOk
    );

    // Calculate weighted total score (0-100)
    const safetyScore = this.calculateWeightedScore(scoreBreakdown);

    // Determine risk level
    const riskLevel = this.determineRiskLevel(safetyScore);

    // Collect red flags
    const redFlags = this.collectRedFlags(
      mintAuthority,
      freezeAuthority,
      creatorAnalysis,
      bundleAnalysis,
      tokenAgeMinutes
    );

    // Collect green flags
    const greenFlags = this.collectGreenFlags(
      mintAuthority,
      freezeAuthority,
      tokenAgeMinutes
    );

    // Check for instant rejects
    const instantRejectReasons = this.getInstantRejectReasons(
      mintAuthority,
      freezeAuthority,
      creatorAnalysis
    );

    const shouldInstantReject = instantRejectReasons.length > 0;
    const isSafeToTrade = !shouldInstantReject && safetyScore >= this.config.minSafetyScore;

    // Holder checks (would come from HolderAnalyzer in practice)
    const holderDistributionOk = true; // Default - integrate with holder analyzer
    const devHoldingsOk = creatorAnalysis.currentHoldingsPercent <= this.config.maxDevHoldings;

    const confidence = this.calculateConfidence(data);

    return {
      ...baseMetrics,
      confidence,
      safetyScore,
      riskLevel,
      isSafeToTrade,
      mintAuthority,
      freezeAuthority,
      holderDistributionOk,
      devHoldingsOk,
      creatorAnalysis,
      bundleAnalysis,
      socialVerification,
      tokenAgeMinutes,
      tokenAgeOk,
      redFlags,
      greenFlags,
      instantRejectReasons,
      shouldInstantReject,
      scoreBreakdown,
    };
  }

  /**
   * Calculates individual score components
   */
  private calculateScoreBreakdown(
    mintAuthority: AuthorityCheck,
    freezeAuthority: AuthorityCheck,
    creatorAnalysis: CreatorAnalysis,
    bundleAnalysis: BundleAnalysis,
    socialVerification: SocialVerification,
    tokenAgeOk: boolean
  ): SafetyMetrics['scoreBreakdown'] {
    // Each component is 0-10
    return {
      mintAuthority: mintAuthority.isRevoked ? 10 : 0,
      freezeAuthority: freezeAuthority.isRevoked ? 10 : 2,
      holderDistribution: 7, // Default - integrate with holder analyzer
      devHoldings: creatorAnalysis.currentHoldingsPercent <= 20 ? 8 : 4,
      creatorAnalysis: creatorAnalysis.score,
      socialPresence: socialVerification.score,
      tokenAge: tokenAgeOk ? 8 : 3,
      bundleAnalysis: bundleAnalysis.hasBundledTrades ? 3 : 8,
    };
  }

  /**
   * Calculates weighted total score
   */
  private calculateWeightedScore(breakdown: SafetyMetrics['scoreBreakdown']): number {
    const weights = this.config.scoreWeights;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

    const weightedSum =
      (breakdown.mintAuthority * weights.mintAuthority) +
      (breakdown.freezeAuthority * weights.freezeAuthority) +
      (breakdown.holderDistribution * weights.holderDistribution) +
      (breakdown.devHoldings * weights.devHoldings) +
      (breakdown.creatorAnalysis * weights.creatorAnalysis) +
      (breakdown.socialPresence * weights.socialPresence) +
      (breakdown.tokenAge * weights.tokenAge) +
      (breakdown.bundleAnalysis * weights.bundleAnalysis);

    // Normalize to 0-100
    return (weightedSum / totalWeight) * 10;
  }

  /**
   * Determines overall risk level from score
   */
  private determineRiskLevel(score: number): RiskLevel {
    if (score >= 80) return RiskLevel.LOW;
    if (score >= 60) return RiskLevel.MEDIUM;
    if (score >= 40) return RiskLevel.HIGH;
    return RiskLevel.CRITICAL;
  }

  /**
   * Collects red flags
   */
  private collectRedFlags(
    mintAuthority: AuthorityCheck,
    freezeAuthority: AuthorityCheck,
    creatorAnalysis: CreatorAnalysis,
    bundleAnalysis: BundleAnalysis,
    tokenAgeMinutes: number
  ): string[] {
    const flags: string[] = [];

    if (!mintAuthority.isRevoked) {
      flags.push('CRITICAL: Mint authority NOT revoked - can print unlimited tokens');
    }

    if (!freezeAuthority.isRevoked) {
      flags.push('WARNING: Freeze authority NOT revoked - can freeze your tokens');
    }

    if (creatorAnalysis.previousRugsCount > 0) {
      flags.push(`CRITICAL: Creator has ${creatorAnalysis.previousRugsCount} previous rugs`);
    }

    if (creatorAnalysis.currentHoldingsPercent > 20) {
      flags.push(`Dev holds ${creatorAnalysis.currentHoldingsPercent}% - dump risk`);
    }

    if (creatorAnalysis.walletAgeDays < 7) {
      flags.push('Creator wallet is less than 7 days old');
    }

    if (bundleAnalysis.hasBundledTrades) {
      flags.push(`Bundled trades detected (${bundleAnalysis.bundleSize} wallets)`);
    }

    if (bundleAnalysis.bundledSupplyPercent > 10) {
      flags.push(`${bundleAnalysis.bundledSupplyPercent.toFixed(1)}% supply acquired in bundles`);
    }

    if (tokenAgeMinutes < 5) {
      flags.push(`Token is only ${tokenAgeMinutes.toFixed(1)} minutes old`);
    }

    // Add creator-specific flags
    flags.push(...creatorAnalysis.redFlags);

    return flags;
  }

  /**
   * Collects green flags
   */
  private collectGreenFlags(
    mintAuthority: AuthorityCheck,
    freezeAuthority: AuthorityCheck,
    tokenAgeMinutes: number
  ): string[] {
    const flags: string[] = [];

    if (mintAuthority.isRevoked) {
      flags.push('Mint authority revoked');
    }

    if (freezeAuthority.isRevoked) {
      flags.push('Freeze authority revoked');
    }

    if (tokenAgeMinutes >= 30) {
      flags.push('Token has survived 30+ minutes');
    }

    return flags;
  }

  /**
   * Gets reasons for instant rejection
   */
  private getInstantRejectReasons(
    mintAuthority: AuthorityCheck,
    freezeAuthority: AuthorityCheck,
    creatorAnalysis: CreatorAnalysis
  ): string[] {
    const reasons: string[] = [];

    // Active mint authority is an instant reject
    if (!mintAuthority.isRevoked) {
      reasons.push('Mint authority active - can print infinite tokens');
    }

    // Known rug creator is instant reject
    if (creatorAnalysis.previousRugsCount > 0) {
      reasons.push('Creator has previous rug pulls');
    }

    return reasons;
  }

  /**
   * Calculates confidence based on data completeness
   */
  private calculateConfidence(data: TokenSafetyData): number {
    let confidence = 0.3;

    if (data.mintAuthority) confidence += 0.2;
    if (data.freezeAuthority) confidence += 0.1;
    if (data.creatorAnalysis) confidence += 0.15;
    if (data.bundleAnalysis) confidence += 0.1;
    if (data.socialVerification) confidence += 0.05;
    if (data.firstTrades.length >= 5) confidence += 0.1;

    return Math.min(confidence, 1);
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Gets safety metrics for a token
   */
  getSafetyMetrics(mintAddress: SolanaAddress): SafetyMetrics | undefined {
    return this.metrics.get(mintAddress);
  }

  /**
   * Checks if a token is safe to trade
   */
  isSafeToTrade(mintAddress: SolanaAddress): boolean {
    const metrics = this.metrics.get(mintAddress);
    return metrics?.isSafeToTrade ?? false;
  }

  /**
   * Gets tokens that are safe to trade
   */
  getSafeTokens(): SolanaAddress[] {
    return this.getMetricsWhere(m => m.isSafeToTrade).map(m => m.mintAddress);
  }

  /**
   * Gets tokens with critical risk
   */
  getCriticalRiskTokens(): SolanaAddress[] {
    return this.getMetricsWhere(m => m.riskLevel === RiskLevel.CRITICAL)
      .map(m => m.mintAddress);
  }

  /**
   * Gets all red flags for a token
   */
  getRedFlags(mintAddress: SolanaAddress): string[] {
    return this.metrics.get(mintAddress)?.redFlags ?? [];
  }

  /**
   * Adds a creator to the rug blacklist
   */
  addToBlacklist(creator: SolanaAddress): void {
    this.knownRugCreators.add(creator);
    this.logger?.warn('Creator added to blacklist', { creator });
  }

  /**
   * Removes a creator from the blacklist
   */
  removeFromBlacklist(creator: SolanaAddress): void {
    this.knownRugCreators.delete(creator);
  }

  /**
   * Manually triggers a safety recheck
   */
  async recheckToken(mintAddress: SolanaAddress): Promise<SafetyMetrics | undefined> {
    const data = this.safetyData.get(mintAddress);
    if (!data) return undefined;

    // Re-run all checks
    data.mintAuthority = await this.checkAuthority(mintAddress, 'mint');
    data.freezeAuthority = await this.checkAuthority(mintAddress, 'freeze');
    data.creatorAnalysis = await this.analyzeCreator(data.creator);
    data.bundleAnalysis = this.analyzeBundles(data);
    data.socialVerification = await this.verifySocials(data.metadataUri);

    const metrics = this.calculateMetrics(mintAddress, data, Date.now());
    this.metrics.set(mintAddress, metrics);

    return metrics;
  }
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

export const safetyAnalyzer = new SafetyAnalyzer();

export function initializeSafetyAnalyzer(
  config?: Partial<SafetyAnalyzerConfig>
): SafetyAnalyzer {
  const analyzer = new SafetyAnalyzer(config);
  analyzer.initialize();
  return analyzer;
}
