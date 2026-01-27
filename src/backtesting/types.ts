/**
 * Backtesting Types
 *
 * Types for historical data, backtest simulation, and performance analytics.
 */

import type { SolanaAddress, Timestamp } from '../core/types.js';
import { SignalType } from '../analyzers/types.js';

// =============================================================================
// HISTORICAL DATA TYPES
// =============================================================================

/**
 * Historical token data point
 */
export interface HistoricalDataPoint {
  /** Timestamp of data point */
  timestamp: Timestamp;

  /** Token price in SOL */
  priceSol: number;

  /** Token price in USD */
  priceUsd: number;

  /** Volume in last interval (SOL) */
  volumeSol: number;

  /** Total market cap */
  marketCapUsd: number;

  /** Bonding curve progress (0-100) */
  bondingProgress: number;

  /** Number of unique holders */
  holderCount: number;

  /** Liquidity in pool (USD) */
  liquidityUsd: number;
}

/**
 * Historical token record
 */
export interface HistoricalToken {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Token symbol */
  symbol: string;

  /** Token name */
  name: string;

  /** Launch timestamp */
  launchTimestamp: Timestamp;

  /** Migration timestamp (if graduated) */
  migrationTimestamp?: Timestamp;

  /** Final outcome of token */
  outcome: TokenOutcome;

  /** Peak market cap reached */
  peakMarketCapUsd: number;

  /** Time series data */
  dataPoints: HistoricalDataPoint[];

  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Token outcome classification
 */
export enum TokenOutcome {
  /** Token graduated and did well */
  SUCCESS = 'SUCCESS',

  /** Token graduated but declined */
  NEUTRAL = 'NEUTRAL',

  /** Token was rugged or abandoned */
  RUG = 'RUG',

  /** Token never graduated */
  FAILED = 'FAILED',

  /** Still active, unknown outcome */
  ACTIVE = 'ACTIVE',
}

// =============================================================================
// BACKTEST CONFIGURATION
// =============================================================================

/**
 * Backtest configuration
 */
export interface BacktestConfig {
  /** Starting capital in SOL */
  startingCapitalSol: number;

  /** Time step for simulation (ms) */
  timeStepMs: number;

  /** Slippage settings */
  slippage: {
    /** Entry slippage percentage */
    entryPercent: number;
    /** Exit slippage percentage */
    exitPercent: number;
  };

  /** Transaction costs */
  fees: {
    /** Gas fee per trade (SOL) */
    gasSol: number;
    /** Jito tip per trade (SOL) */
    jitoTipSol: number;
  };

  /** Transaction failure rate (0-1) */
  failureRate: number;

  /** Execution delay (ms) */
  executionDelayMs: number;

  /** Momentum thresholds to test */
  thresholds: {
    buy: number;
    strongBuy: number;
    sell: number;
  };

  /** Risk parameters */
  risk: {
    maxPositionSizeSol: number;
    maxConcurrentPositions: number;
    stopLossPercent: number;
    takeProfitLevels: Array<{ multiplier: number; sellPercent: number }>;
  };
}

/**
 * Default backtest configuration
 */
export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  startingCapitalSol: 10,
  timeStepMs: 30_000, // 30 seconds

  slippage: {
    entryPercent: 3, // 3% entry slippage
    exitPercent: 5, // 5% exit slippage
  },

  fees: {
    gasSol: 0.001,
    jitoTipSol: 0.0001,
  },

  failureRate: 0.05, // 5% transaction failure rate
  executionDelayMs: 2000, // 2 second execution delay

  thresholds: {
    buy: 75,
    strongBuy: 85,
    sell: 50,
  },

  risk: {
    maxPositionSizeSol: 0.5,
    maxConcurrentPositions: 3,
    stopLossPercent: 30,
    takeProfitLevels: [
      { multiplier: 2, sellPercent: 25 },
      { multiplier: 3, sellPercent: 25 },
      { multiplier: 5, sellPercent: 50 },
    ],
  },
};

// =============================================================================
// BACKTEST TRADE TYPES
// =============================================================================

/**
 * Simulated trade
 */
export interface BacktestTrade {
  /** Trade ID */
  id: string;

  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Token symbol */
  symbol: string;

  /** Signal that triggered the trade */
  signal: SignalType;

  /** Momentum score at entry */
  momentumScore: number;

  /** Entry timestamp */
  entryTimestamp: Timestamp;

  /** Entry price (SOL per token) */
  entryPrice: number;

  /** Position size in SOL */
  positionSizeSol: number;

  /** Token amount purchased */
  tokenAmount: number;

  /** Entry slippage applied */
  entrySlippage: number;

  /** Exit timestamp (if closed) */
  exitTimestamp?: Timestamp;

  /** Exit price (if closed) */
  exitPrice?: number;

  /** Exit slippage applied */
  exitSlippage?: number;

  /** Exit reason */
  exitReason?: TradeExitReason;

  /** Realized P&L in SOL */
  realizedPnlSol?: number;

  /** Realized P&L percentage */
  realizedPnlPercent?: number;

  /** Total fees paid (SOL) */
  feesPaidSol: number;

  /** Trade status */
  status: TradeStatus;

  /** Take profit levels hit */
  takeProfitHits: number[];
}

/**
 * Trade exit reason
 */
export enum TradeExitReason {
  STOP_LOSS = 'STOP_LOSS',
  TAKE_PROFIT = 'TAKE_PROFIT',
  MIGRATION = 'MIGRATION',
  SIGNAL = 'SIGNAL',
  END_OF_DATA = 'END_OF_DATA',
  MANUAL = 'MANUAL',
}

/**
 * Trade status
 */
export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  FAILED = 'FAILED',
}

// =============================================================================
// BACKTEST RESULTS
// =============================================================================

/**
 * Backtest run result
 */
export interface BacktestResult {
  /** Run ID */
  runId: string;

  /** Configuration used */
  config: BacktestConfig;

  /** Start timestamp */
  startTimestamp: Timestamp;

  /** End timestamp */
  endTimestamp: Timestamp;

  /** Duration (ms) */
  durationMs: number;

  /** Number of tokens tested */
  tokensAnalyzed: number;

  /** All trades executed */
  trades: BacktestTrade[];

  /** Performance metrics */
  metrics: PerformanceMetrics;

  /** Equity curve (capital over time) */
  equityCurve: EquityPoint[];

  /** Daily P&L */
  dailyPnl: DailyPnlRecord[];
}

/**
 * Equity curve data point
 */
export interface EquityPoint {
  timestamp: Timestamp;
  capitalSol: number;
  unrealizedPnlSol: number;
  drawdownPercent: number;
}

/**
 * Daily P&L record
 */
export interface DailyPnlRecord {
  date: string;
  startingCapitalSol: number;
  endingCapitalSol: number;
  realizedPnlSol: number;
  tradesExecuted: number;
  wins: number;
  losses: number;
}

// =============================================================================
// PERFORMANCE METRICS
// =============================================================================

/**
 * Comprehensive performance metrics
 */
export interface PerformanceMetrics {
  // === OVERALL ===
  /** Total P&L in SOL */
  totalPnlSol: number;

  /** Total P&L percentage */
  totalPnlPercent: number;

  /** Final capital */
  finalCapitalSol: number;

  // === TRADE STATISTICS ===
  /** Total number of trades */
  totalTrades: number;

  /** Number of winning trades */
  winningTrades: number;

  /** Number of losing trades */
  losingTrades: number;

  /** Win rate (0-100) */
  winRate: number;

  /** Average win amount (SOL) */
  averageWinSol: number;

  /** Average loss amount (SOL) */
  averageLossSol: number;

  /** Average win percentage */
  averageWinPercent: number;

  /** Average loss percentage */
  averageLossPercent: number;

  /** Largest winning trade (SOL) */
  largestWinSol: number;

  /** Largest losing trade (SOL) */
  largestLossSol: number;

  /** Average holding time (ms) */
  averageHoldingTimeMs: number;

  // === RISK METRICS ===
  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;

  /** Sharpe ratio (annualized) */
  sharpeRatio: number;

  /** Sortino ratio */
  sortinoRatio: number;

  /** Calmar ratio (annual return / max drawdown) */
  calmarRatio: number;

  /** Maximum drawdown percentage */
  maxDrawdownPercent: number;

  /** Maximum drawdown duration (ms) */
  maxDrawdownDurationMs: number;

  // === STREAKS ===
  /** Longest winning streak */
  longestWinStreak: number;

  /** Longest losing streak */
  longestLoseStreak: number;

  /** Current streak (positive = wins, negative = losses) */
  currentStreak: number;

  // === FEES ===
  /** Total fees paid (SOL) */
  totalFeesSol: number;

  /** Total slippage cost (SOL) */
  totalSlippageSol: number;

  // === SIGNALS ===
  /** Total signals generated */
  totalSignals: number;

  /** Signals that resulted in trades */
  signalsExecuted: number;

  /** Signal accuracy (winning trades / total signals) */
  signalAccuracy: number;
}

// =============================================================================
// PARAMETER OPTIMIZATION
// =============================================================================

/**
 * Parameter range for optimization
 */
export interface ParameterRange {
  /** Parameter name */
  name: string;

  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;

  /** Step size */
  step: number;
}

/**
 * Optimization configuration
 */
export interface OptimizationConfig {
  /** Parameters to optimize */
  parameters: ParameterRange[];

  /** Metric to optimize for */
  targetMetric: keyof PerformanceMetrics;

  /** Minimize or maximize */
  direction: 'minimize' | 'maximize';

  /** Number of walk-forward windows */
  walkForwardWindows?: number;

  /** Training window size (% of data) */
  trainingWindowPercent?: number;

  /** Maximum iterations */
  maxIterations?: number;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  /** Best parameter combination */
  bestParameters: Record<string, number>;

  /** Best metric value achieved */
  bestMetricValue: number;

  /** All tested combinations */
  allResults: Array<{
    parameters: Record<string, number>;
    metrics: PerformanceMetrics;
  }>;

  /** Walk-forward results (if used) */
  walkForwardResults?: Array<{
    trainingPeriod: { start: Timestamp; end: Timestamp };
    validationPeriod: { start: Timestamp; end: Timestamp };
    trainingMetrics: PerformanceMetrics;
    validationMetrics: PerformanceMetrics;
  }>;
}

// =============================================================================
// SCENARIO TESTING
// =============================================================================

/**
 * Scenario type for edge case testing
 */
export enum ScenarioType {
  /** All tokens dump */
  MARKET_CRASH = 'MARKET_CRASH',

  /** No trading opportunities */
  NO_OPPORTUNITIES = 'NO_OPPORTUNITIES',

  /** Extreme volatility */
  HIGH_VOLATILITY = 'HIGH_VOLATILITY',

  /** Network congestion */
  NETWORK_CONGESTION = 'NETWORK_CONGESTION',

  /** Rug pull detection */
  RUG_DETECTION = 'RUG_DETECTION',
}

/**
 * Scenario test configuration
 */
export interface ScenarioConfig {
  type: ScenarioType;
  description: string;
  parameters: Record<string, number>;
}

/**
 * Scenario test result
 */
export interface ScenarioResult {
  scenario: ScenarioConfig;
  passed: boolean;
  details: string;
  metrics: Partial<PerformanceMetrics>;
}

// =============================================================================
// REPORT TYPES
// =============================================================================

/**
 * Backtest report format
 */
export interface BacktestReport {
  /** Report title */
  title: string;

  /** Generation timestamp */
  generatedAt: Timestamp;

  /** Summary section */
  summary: {
    totalPnlSol: number;
    totalPnlPercent: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalTrades: number;
    profitFactor: number;
  };

  /** Full metrics */
  metrics: PerformanceMetrics;

  /** Configuration used */
  config: BacktestConfig;

  /** Trade breakdown */
  tradeBreakdown: {
    byOutcome: Record<string, number>;
    byExitReason: Record<TradeExitReason, number>;
    byHoldingTime: {
      under1Hour: number;
      oneToSixHours: number;
      sixToTwentyFourHours: number;
      overTwentyFourHours: number;
    };
  };

  /** Top trades */
  topWinningTrades: BacktestTrade[];
  topLosingTrades: BacktestTrade[];

  /** Recommendations */
  recommendations: string[];
}

/**
 * CSV export row for trades
 */
export interface TradeExportRow {
  trade_id: string;
  mint_address: string;
  symbol: string;
  signal: string;
  momentum_score: number;
  entry_timestamp: string;
  entry_price: number;
  position_size_sol: number;
  exit_timestamp: string;
  exit_price: number;
  exit_reason: string;
  pnl_sol: number;
  pnl_percent: number;
  fees_sol: number;
  holding_time_hours: number;
}
