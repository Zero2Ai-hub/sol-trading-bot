/**
 * Analyzer Type Definitions
 *
 * Comprehensive types for all data analyzers.
 * Based on trading-bot-architecture, rug-detection-checklist,
 * and token-analysis-checklist skills.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Confidence level for metrics (0-1)
 */
export type Confidence = number;

/**
 * Score value (0-100)
 */
export type Score = number;

/**
 * Risk level enumeration
 */
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Time window for metric aggregation
 */
export enum TimeWindow {
  ONE_MINUTE = 60 * 1000,
  FIVE_MINUTES = 5 * 60 * 1000,
  FIFTEEN_MINUTES = 15 * 60 * 1000,
  THIRTY_MINUTES = 30 * 60 * 1000,
  ONE_HOUR = 60 * 60 * 1000,
  TWO_HOURS = 2 * 60 * 60 * 1000,
}

/**
 * Analyzer health status
 */
export enum AnalyzerStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR',
  STALE = 'STALE',
}

// =============================================================================
// BASE METRICS
// =============================================================================

/**
 * Base interface for all analyzer metrics
 */
export interface BaseMetrics {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Metric calculation timestamp */
  calculatedAt: Timestamp;

  /** Confidence level (0-1) */
  confidence: Confidence;

  /** Is data stale? */
  isStale: boolean;

  /** Data age in milliseconds */
  dataAgeMs: number;
}

// =============================================================================
// VOLUME METRICS
// =============================================================================

/**
 * Individual trade record
 */
export interface TradeRecord {
  /** Unique trade ID (signature) */
  id: string;

  /** Trade timestamp */
  timestamp: Timestamp;

  /** Trade type */
  type: 'buy' | 'sell';

  /** Trader wallet address */
  trader: SolanaAddress;

  /** SOL amount (in lamports) */
  solAmount: bigint;

  /** Token amount */
  tokenAmount: bigint;

  /** Transaction signature */
  signature: string;
}

/**
 * Volume metrics output
 */
export interface VolumeMetrics extends BaseMetrics {
  /** Total volume in last 5 minutes (SOL) */
  volume5m: bigint;

  /** Total volume in last 15 minutes (SOL) */
  volume15m: bigint;

  /** Total volume in last hour (SOL) */
  volume1h: bigint;

  /** Average volume per 5 minutes (based on 1h data) */
  avgVolumePer5m: bigint;

  /** Volume velocity (rate of change, -1 to +inf) */
  volumeVelocity: number;

  /** Buy volume in window */
  buyVolume: bigint;

  /** Sell volume in window */
  sellVolume: bigint;

  /** Buy ratio (0-1, >0.6 = strong buying) */
  buyRatio: number;

  /** Number of trades in window */
  tradeCount: number;

  /** Number of unique traders */
  uniqueTraders: number;

  /** Volume per unique trader (SOL) */
  volumePerTrader: bigint;

  /** Is volume spike detected (>3x average)? */
  hasVolumeSpike: boolean;

  /** Spike multiplier if detected */
  spikeMultiplier: number;

  /** Wash trading score (0-1, higher = more suspicious) */
  washTradingScore: number;

  /** Trade size distribution skew (-1 to 1, bot-like if extreme) */
  tradeSizeSkew: number;

  /** Volume trend direction */
  volumeTrend: 'accelerating' | 'stable' | 'decelerating';
}

// =============================================================================
// HOLDER METRICS
// =============================================================================

/**
 * Holder info
 */
export interface HolderInfo {
  /** Wallet address */
  address: SolanaAddress;

  /** Token balance */
  balance: bigint;

  /** Percentage of total supply */
  percentage: number;

  /** Is this wallet known (dev, team, exchange)? */
  isKnown: boolean;

  /** Label if known */
  label?: string;

  /** Wallet age (if available) */
  walletAgeMs?: number;

  /** Funded from address (for clustering) */
  fundedFrom?: SolanaAddress;
}

/**
 * Holder snapshot
 */
export interface HolderSnapshot {
  /** Snapshot timestamp */
  timestamp: Timestamp;

  /** Total holder count */
  totalHolders: number;

  /** Top holders */
  topHolders: HolderInfo[];

  /** Top 10 concentration percentage */
  top10Percentage: number;

  /** Top 20 concentration percentage */
  top20Percentage: number;
}

/**
 * Holder metrics output
 */
export interface HolderMetrics extends BaseMetrics {
  /** Current total holder count */
  totalHolders: number;

  /** Holder count 5 minutes ago */
  holders5mAgo: number;

  /** Holder count 1 hour ago */
  holders1hAgo: number;

  /** New holders per minute (velocity) */
  holderVelocity: number;

  /** Holder growth rate percentage (1h) */
  holderGrowthRate: number;

  /** Top 10 holder concentration percentage */
  top10Concentration: number;

  /** Top 20 holder concentration percentage */
  top20Concentration: number;

  /** Developer holdings percentage */
  devHoldingsPercent: number;

  /** Creator holdings percentage */
  creatorHoldingsPercent: number;

  /** Largest single holder percentage (excluding LP) */
  largestHolderPercent: number;

  /** Number of wallets with same funding source (sybil indicator) */
  clusteredWallets: number;

  /** Cluster percentage (clustered wallets / unique traders) */
  clusterPercentage: number;

  /** Average wallet age of top 20 holders (ms) */
  avgWalletAgeMs: number;

  /** New wallet percentage (wallets < 24h old) */
  newWalletPercentage: number;

  /** Holder distribution score (0-10, higher = better distributed) */
  distributionScore: Score;

  /** Holder quality score (0-10, old/active wallets = higher) */
  holderQualityScore: Score;

  /** Holder trend */
  holderTrend: 'growing' | 'stable' | 'shrinking';

  /** Red flags */
  redFlags: string[];
}

// =============================================================================
// LIQUIDITY METRICS
// =============================================================================

/**
 * Slippage estimate for a trade size
 */
export interface SlippageEstimate {
  /** Trade size in SOL */
  tradeSizeSol: number;

  /** Estimated slippage percentage */
  slippagePercent: number;

  /** Price impact percentage */
  priceImpactPercent: number;

  /** Is trade size executable? */
  isExecutable: boolean;
}

/**
 * Liquidity metrics output
 */
export interface LiquidityMetrics extends BaseMetrics {
  /** Bonding curve completion percentage (0-100) */
  bondingCurveProgress: number;

  /** Is bonding curve complete (migrated)? */
  isComplete: boolean;

  /** Is in entry zone (70-95%)? */
  inEntryZone: boolean;

  /** Virtual token reserves */
  virtualTokenReserves: bigint;

  /** Virtual SOL reserves */
  virtualSolReserves: bigint;

  /** Real token reserves */
  realTokenReserves: bigint;

  /** Real SOL reserves */
  realSolReserves: bigint;

  /** Total liquidity in SOL */
  totalLiquiditySol: bigint;

  /** Current token price in SOL */
  currentPriceSol: number;

  /** Market cap in SOL */
  marketCapSol: number;

  /** Slippage estimates for common trade sizes */
  slippageEstimates: SlippageEstimate[];

  /** Estimated slippage for 0.1 SOL trade */
  slippage01Sol: number;

  /** Estimated slippage for 1 SOL trade */
  slippage1Sol: number;

  /** Estimated slippage for 5 SOL trade */
  slippage5Sol: number;

  /** Liquidity depth score (0-10) */
  liquidityDepthScore: Score;

  /** Distance to migration (100 - progress) */
  distanceToMigration: number;

  /** Estimated time to migration (ms) based on current velocity */
  estimatedTimeToMigration: number | null;

  /** Liquidity trend */
  liquidityTrend: 'growing' | 'stable' | 'shrinking';

  /** Progress velocity (% per minute) */
  progressVelocity: number;
}

// =============================================================================
// SAFETY METRICS
// =============================================================================

/**
 * Authority check result
 */
export interface AuthorityCheck {
  /** Authority type */
  type: 'mint' | 'freeze';

  /** Is revoked (safe)? */
  isRevoked: boolean;

  /** Authority address if not revoked */
  authorityAddress?: SolanaAddress;

  /** Risk level */
  riskLevel: RiskLevel;

  /** Score contribution (0-10) */
  score: Score;
}

/**
 * Creator wallet analysis
 */
export interface CreatorAnalysis {
  /** Creator address */
  address: SolanaAddress;

  /** Wallet age in days */
  walletAgeDays: number;

  /** Funding source (if traceable) */
  fundingSource: 'cex' | 'dex' | 'wallet' | 'mixer' | 'unknown';

  /** Number of previous tokens created */
  previousTokensCount: number;

  /** Number of previous rugged tokens (if detectable) */
  previousRugsCount: number;

  /** Current holdings percentage */
  currentHoldingsPercent: number;

  /** Has sold significant amount? */
  hasDumped: boolean;

  /** Creator risk score (0-10, higher = safer) */
  score: Score;

  /** Red flags */
  redFlags: string[];
}

/**
 * Bundled transaction detection
 */
export interface BundleAnalysis {
  /** Were first trades bundled? */
  hasBundledTrades: boolean;

  /** Number of transactions in bundle */
  bundleSize: number;

  /** Addresses involved in bundle */
  bundledAddresses: SolanaAddress[];

  /** Percentage of supply acquired in bundle */
  bundledSupplyPercent: number;

  /** Risk level */
  riskLevel: RiskLevel;
}

/**
 * Social verification result
 */
export interface SocialVerification {
  /** Has website? */
  hasWebsite: boolean;

  /** Website URL */
  websiteUrl?: string;

  /** Has Twitter? */
  hasTwitter: boolean;

  /** Twitter URL/handle */
  twitterHandle?: string;

  /** Has Telegram? */
  hasTelegram: boolean;

  /** Telegram URL */
  telegramUrl?: string;

  /** Social presence score (0-10) */
  score: Score;

  /** Verification notes */
  notes: string[];
}

/**
 * Safety metrics output
 */
export interface SafetyMetrics extends BaseMetrics {
  /** Overall safety score (0-100) */
  safetyScore: Score;

  /** Overall risk level */
  riskLevel: RiskLevel;

  /** Is safe to trade (score >= threshold)? */
  isSafeToTrade: boolean;

  /** Mint authority check */
  mintAuthority: AuthorityCheck;

  /** Freeze authority check */
  freezeAuthority: AuthorityCheck;

  /** Holder distribution check passed? */
  holderDistributionOk: boolean;

  /** Developer holdings check passed? */
  devHoldingsOk: boolean;

  /** Creator analysis */
  creatorAnalysis: CreatorAnalysis;

  /** Bundle analysis */
  bundleAnalysis: BundleAnalysis;

  /** Social verification */
  socialVerification: SocialVerification;

  /** Token age in minutes */
  tokenAgeMinutes: number;

  /** Token age check passed (>5 min)? */
  tokenAgeOk: boolean;

  /** All red flags combined */
  redFlags: string[];

  /** All green flags combined */
  greenFlags: string[];

  /** Instant reject reasons (if any) */
  instantRejectReasons: string[];

  /** Should instantly reject? */
  shouldInstantReject: boolean;

  /** Score breakdown */
  scoreBreakdown: {
    mintAuthority: Score;
    freezeAuthority: Score;
    holderDistribution: Score;
    devHoldings: Score;
    creatorAnalysis: Score;
    socialPresence: Score;
    tokenAge: Score;
    bundleAnalysis: Score;
  };
}

// =============================================================================
// MOMENTUM METRICS (AGGREGATED)
// =============================================================================

/**
 * Signal type for trading decisions
 */
export enum SignalType {
  STRONG_BUY = 'STRONG_BUY',
  BUY = 'BUY',
  HOLD = 'HOLD',
  SELL = 'SELL',
  STRONG_SELL = 'STRONG_SELL',
  DO_NOT_TRADE = 'DO_NOT_TRADE',
}

/**
 * Aggregated momentum metrics
 */
export interface MomentumMetrics extends BaseMetrics {
  /** Overall momentum score (0-100) */
  momentumScore: Score;

  /** Momentum confidence (0-1) */
  momentumConfidence: Confidence;

  /** Trading signal */
  signal: SignalType;

  /** Signal strength (0-1) */
  signalStrength: number;

  /** Volume metrics */
  volume: VolumeMetrics | null;

  /** Holder metrics */
  holders: HolderMetrics | null;

  /** Liquidity metrics */
  liquidity: LiquidityMetrics | null;

  /** Safety metrics */
  safety: SafetyMetrics | null;

  /** Weighted score breakdown */
  weightedScores: {
    volume: number;
    holders: number;
    liquidity: number;
    safety: number;
  };

  /** Score weights used */
  weights: {
    volume: number;
    holders: number;
    liquidity: number;
    safety: number;
  };

  /** Is in entry zone? */
  inEntryZone: boolean;

  /** Should enter position? */
  shouldEnter: boolean;

  /** Should exit position? */
  shouldExit: boolean;

  /** Reasons for signal */
  signalReasons: string[];

  /** Time-decay applied? */
  hasTimeDecay: boolean;

  /** Data completeness (0-1) */
  dataCompleteness: number;
}

// =============================================================================
// ANALYZER CONFIGURATION
// =============================================================================

/**
 * Base analyzer configuration
 */
export interface AnalyzerConfig {
  /** Update interval in milliseconds */
  updateIntervalMs: number;

  /** Maximum data age before considered stale */
  maxDataAgeMs: number;

  /** Enable debug logging */
  debug: boolean;
}

/**
 * Volume analyzer configuration
 */
export interface VolumeAnalyzerConfig extends AnalyzerConfig {
  /** Time windows to track */
  windows: TimeWindow[];

  /** Volume spike threshold multiplier */
  spikeThreshold: number;

  /** Minimum trades for valid metrics */
  minTradesForMetrics: number;

  /** Wash trading detection threshold */
  washTradingThreshold: number;
}

/**
 * Holder analyzer configuration
 */
export interface HolderAnalyzerConfig extends AnalyzerConfig {
  /** Snapshot interval */
  snapshotIntervalMs: number;

  /** Top N holders to track */
  topHoldersCount: number;

  /** Max concentration threshold (warning) */
  maxConcentrationWarning: number;

  /** Max concentration threshold (critical) */
  maxConcentrationCritical: number;

  /** Max dev holdings threshold */
  maxDevHoldingsPercent: number;

  /** New wallet age threshold (ms) */
  newWalletThresholdMs: number;
}

/**
 * Safety analyzer configuration
 */
export interface SafetyAnalyzerConfig extends AnalyzerConfig {
  /** Minimum safety score to trade */
  minSafetyScore: Score;

  /** Score weights for each category */
  scoreWeights: {
    mintAuthority: number;
    freezeAuthority: number;
    holderDistribution: number;
    devHoldings: number;
    creatorAnalysis: number;
    socialPresence: number;
    tokenAge: number;
    bundleAnalysis: number;
  };

  /** Minimum token age to trade (minutes) */
  minTokenAgeMinutes: number;

  /** Max holder concentration allowed */
  maxTop10Concentration: number;

  /** Max dev holdings allowed */
  maxDevHoldings: number;
}

/**
 * Momentum aggregator configuration
 */
export interface MomentumConfig extends AnalyzerConfig {
  /** Analyzer weights for final score */
  analyzerWeights: {
    volume: number;
    holders: number;
    liquidity: number;
    safety: number;
  };

  /** Minimum score to generate BUY signal */
  buyThreshold: Score;

  /** Minimum score for STRONG_BUY signal */
  strongBuyThreshold: Score;

  /** Score below which to generate SELL signal */
  sellThreshold: Score;

  /** Score below which to generate STRONG_SELL */
  strongSellThreshold: Score;

  /** Enable time decay for older signals */
  enableTimeDecay: boolean;

  /** Time decay half-life (ms) */
  timeDecayHalfLifeMs: number;

  /** Minimum data completeness required */
  minDataCompleteness: number;
}

// =============================================================================
// ANALYZER HEALTH
// =============================================================================

/**
 * Analyzer health information
 */
export interface AnalyzerHealth {
  /** Analyzer name */
  name: string;

  /** Current status */
  status: AnalyzerStatus;

  /** Tokens being tracked */
  trackedTokens: number;

  /** Last update timestamp */
  lastUpdateAt: Timestamp | null;

  /** Update count since start */
  updateCount: number;

  /** Error count since start */
  errorCount: number;

  /** Last error message */
  lastError?: string;

  /** Memory usage estimate (bytes) */
  memoryUsageBytes: number;

  /** Is healthy? */
  isHealthy: boolean;
}
