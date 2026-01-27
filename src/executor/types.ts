/**
 * Trade Executor Types
 *
 * Type definitions for the Phase 5 trading execution system.
 * Based on trading-bot-architecture and jupiter-swap-integration skills.
 */

import type { Address } from '@solana/kit';
import type { SolanaAddress, Timestamp } from '../core/types.js';

// =============================================================================
// ORDER TYPES
// =============================================================================

/**
 * Order side (buy or sell)
 */
export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

/**
 * Order status
 */
export enum OrderStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/**
 * Exit reason for sells
 */
export enum ExitReason {
  STOP_LOSS = 'STOP_LOSS',
  TAKE_PROFIT = 'TAKE_PROFIT',
  MIGRATION = 'MIGRATION',
  MANUAL = 'MANUAL',
  DAILY_LIMIT = 'DAILY_LIMIT',
  EMERGENCY = 'EMERGENCY',
  SIGNAL_EXIT = 'SIGNAL_EXIT',
}

/**
 * Trade order
 */
export interface Order {
  /** Unique order ID */
  id: string;

  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Order side */
  side: OrderSide;

  /** Amount in lamports (SOL) for buys, token amount for sells */
  amount: bigint;

  /** Maximum slippage in basis points */
  slippageBps: number;

  /** Priority fee in micro-lamports */
  priorityFeeMicroLamports: number;

  /** Order status */
  status: OrderStatus;

  /** Wallet used for this order */
  walletAddress: Address;

  /** Created timestamp */
  createdAt: Timestamp;

  /** Submitted timestamp */
  submittedAt?: Timestamp;

  /** Confirmed timestamp */
  confirmedAt?: Timestamp;

  /** Transaction signature */
  signature?: string;

  /** Expected output amount */
  expectedOutput?: bigint;

  /** Actual output amount */
  actualOutput?: bigint;

  /** Expected price */
  expectedPrice?: number;

  /** Actual fill price */
  actualPrice?: number;

  /** Actual slippage (%) */
  actualSlippage?: number;

  /** Error message if failed */
  error?: string;

  /** Retry count */
  retryCount: number;

  /** Max retries */
  maxRetries: number;

  /** Associated position ID (for sells) */
  positionId?: string;

  /** Exit reason (for sells) */
  exitReason?: ExitReason;

  /** Metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// POSITION TYPES
// =============================================================================

/**
 * Position status
 */
export enum PositionStatus {
  PENDING = 'PENDING',      // Order submitted, not yet confirmed
  OPEN = 'OPEN',            // Position is active
  CLOSING = 'CLOSING',      // Exit order submitted
  CLOSED = 'CLOSED',        // Position closed
  LIQUIDATED = 'LIQUIDATED', // Closed due to stop-loss
}

/**
 * Take profit level
 */
export interface TakeProfitLevel {
  /** Target price multiplier (e.g., 2.0 = 2x) */
  multiplier: number;

  /** Percentage of position to sell at this level */
  sellPercent: number;

  /** Has this level been triggered? */
  triggered: boolean;

  /** Trigger timestamp */
  triggeredAt?: Timestamp;

  /** Order ID for the sell */
  orderId?: string;
}

/**
 * Trading position
 */
export interface Position {
  /** Unique position ID */
  id: string;

  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Token symbol (if known) */
  symbol?: string;

  /** Position status */
  status: PositionStatus;

  /** Wallet holding this position */
  walletAddress: Address;

  /** Entry order ID */
  entryOrderId: string;

  /** Entry price (SOL per token) */
  entryPrice: number;

  /** Entry timestamp */
  entryTimestamp: Timestamp;

  /** Current token amount held */
  tokenAmount: bigint;

  /** Initial token amount (before partial sells) */
  initialTokenAmount: bigint;

  /** Cost basis in SOL */
  costBasisSol: number;

  /** Current price (SOL per token) */
  currentPrice: number;

  /** Current value in SOL */
  currentValueSol: number;

  /** Unrealized P&L in SOL */
  unrealizedPnlSol: number;

  /** Unrealized P&L percentage */
  unrealizedPnlPercent: number;

  /** Realized P&L from partial sells */
  realizedPnlSol: number;

  /** Stop-loss price */
  stopLossPrice: number;

  /** Take-profit levels */
  takeProfitLevels: TakeProfitLevel[];

  /** Exit price (if closed) */
  exitPrice?: number;

  /** Exit timestamp (if closed) */
  exitTimestamp?: Timestamp;

  /** Exit reason (if closed) */
  exitReason?: ExitReason;

  /** Total realized P&L (when closed) */
  totalPnlSol?: number;

  /** Total realized P&L percentage (when closed) */
  totalPnlPercent?: number;

  /** Exit order IDs */
  exitOrderIds: string[];

  /** Last updated timestamp */
  updatedAt: Timestamp;

  /** Momentum score at entry */
  entryMomentumScore: number;

  /** Associated signal ID */
  signalId?: string;

  /** Metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// EXECUTION RESULT TYPES
// =============================================================================

/**
 * Quote from Jupiter
 */
export interface SwapQuote {
  /** Input token mint */
  inputMint: SolanaAddress;

  /** Output token mint */
  outputMint: SolanaAddress;

  /** Input amount */
  inputAmount: bigint;

  /** Expected output amount */
  outputAmount: bigint;

  /** Minimum output (after slippage) */
  minimumOutput: bigint;

  /** Price impact percentage */
  priceImpactPct: number;

  /** Route info */
  routeInfo: {
    /** DEX labels used */
    dexLabels: string[];

    /** Number of hops */
    hops: number;
  };

  /** Quote timestamp */
  timestamp: Timestamp;

  /** Quote expiry */
  expiresAt: Timestamp;

  /** Raw quote response for building transaction */
  rawQuote: unknown;
}

/**
 * Transaction execution result
 */
export interface ExecutionResult {
  /** Was execution successful? */
  success: boolean;

  /** Transaction signature */
  signature?: string;

  /** Confirmed slot */
  slot?: number;

  /** Confirmation time in ms */
  confirmationTimeMs?: number;

  /** Actual output amount */
  actualOutput?: bigint;

  /** Actual slippage */
  actualSlippageBps?: number;

  /** Fees paid */
  feesPaid?: {
    baseFee: bigint;
    priorityFee: bigint;
    jitoTip?: bigint;
    total: bigint;
  };

  /** Error if failed */
  error?: string;

  /** Error code */
  errorCode?: string;

  /** Number of retries */
  retries: number;
}

/**
 * Bundle submission result (Jito)
 */
export interface BundleResult {
  /** Bundle ID */
  bundleId: string;

  /** Was bundle accepted? */
  accepted: boolean;

  /** Was bundle landed on-chain? */
  landed: boolean;

  /** Signatures in bundle */
  signatures: string[];

  /** Slot landed in */
  slot?: number;

  /** Error if failed */
  error?: string;
}

// =============================================================================
// RISK TYPES
// =============================================================================

/**
 * Risk limits configuration
 */
export interface RiskLimits {
  /** Maximum position size in SOL */
  maxPositionSizeSol: number;

  /** Maximum total exposure in SOL */
  maxTotalExposureSol: number;

  /** Maximum concurrent positions */
  maxConcurrentPositions: number;

  /** Maximum loss per trade in SOL */
  maxLossPerTradeSol: number;

  /** Maximum daily loss percentage of capital */
  maxDailyLossPercent: number;

  /** Maximum single trade as % of capital */
  maxTradeCapitalPercent: number;

  /** Minimum SOL reserved for fees */
  minReservedSol: number;

  /** Maximum slippage allowed */
  maxSlippageBps: number;
}

/**
 * Daily P&L tracking
 */
export interface DailyPnL {
  /** Date (YYYY-MM-DD) */
  date: string;

  /** Starting capital */
  startingCapitalSol: number;

  /** Current capital */
  currentCapitalSol: number;

  /** Realized P&L */
  realizedPnlSol: number;

  /** Unrealized P&L */
  unrealizedPnlSol: number;

  /** Total P&L */
  totalPnlSol: number;

  /** P&L percentage */
  pnlPercent: number;

  /** Trade count */
  tradeCount: number;

  /** Win count */
  winCount: number;

  /** Loss count */
  lossCount: number;

  /** Win rate */
  winRate: number;

  /** Is daily limit hit? */
  dailyLimitHit: boolean;

  /** Trading paused? */
  tradingPaused: boolean;
}

/**
 * Risk check result
 */
export interface RiskCheckResult {
  /** Can execute trade? */
  allowed: boolean;

  /** Check results */
  checks: {
    name: string;
    passed: boolean;
    message: string;
  }[];

  /** Reason if not allowed */
  reason?: string;

  /** Suggested position size (if adjusted) */
  adjustedSizeSol?: number;
}

// =============================================================================
// EXECUTION CONFIG
// =============================================================================

/**
 * Execution configuration
 */
export interface ExecutorConfig {
  /** Enable paper trading mode */
  paperTrading: boolean;

  /** Default slippage in basis points */
  defaultSlippageBps: number;

  /** Base priority fee in micro-lamports */
  basePriorityFeeMicroLamports: number;

  /** Maximum priority fee in micro-lamports */
  maxPriorityFeeMicroLamports: number;

  /** Jito tip in lamports */
  jitoTipLamports: number;

  /** Use Jito for MEV protection */
  useJito: boolean;

  /** Transaction confirmation timeout in ms */
  confirmationTimeoutMs: number;

  /** Maximum retries for failed transactions */
  maxRetries: number;

  /** Retry delay base in ms */
  retryDelayMs: number;

  /** Risk limits */
  riskLimits: RiskLimits;

  /** Position monitoring interval in ms */
  positionMonitorIntervalMs: number;

  /** Stop-loss settings */
  stopLoss: {
    /** Use ATR-based stop-loss */
    useAtr: boolean;

    /** ATR multiplier */
    atrMultiplier: number;

    /** Fixed stop-loss percentage (if not using ATR) */
    fixedPercent: number;

    /** Trailing stop enabled */
    trailingEnabled: boolean;

    /** Trailing stop distance percentage */
    trailingPercent: number;
  };

  /** Take-profit settings */
  takeProfit: {
    /** Take-profit levels */
    levels: Array<{
      multiplier: number;
      sellPercent: number;
    }>;

    /** Move stop-loss to break-even after first TP */
    moveStopToBreakeven: boolean;
  };
}

/**
 * Default executor configuration
 */
export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  paperTrading: true, // Default to paper trading for safety
  defaultSlippageBps: 500, // 5%
  basePriorityFeeMicroLamports: 10_000,
  maxPriorityFeeMicroLamports: 500_000,
  jitoTipLamports: 10_000, // 0.00001 SOL
  useJito: true,
  confirmationTimeoutMs: 60_000, // 60 seconds
  maxRetries: 3,
  retryDelayMs: 2_000,
  riskLimits: {
    maxPositionSizeSol: 1,
    maxTotalExposureSol: 5,
    maxConcurrentPositions: 3,
    maxLossPerTradeSol: 0.5,
    maxDailyLossPercent: 10,
    maxTradeCapitalPercent: 33,
    minReservedSol: 0.05,
    maxSlippageBps: 1000, // 10%
  },
  positionMonitorIntervalMs: 5_000, // 5 seconds
  stopLoss: {
    useAtr: false, // Simplified for pump.fun
    atrMultiplier: 1.5,
    fixedPercent: 15, // 15% stop-loss
    trailingEnabled: true,
    trailingPercent: 10,
  },
  takeProfit: {
    levels: [
      { multiplier: 2.0, sellPercent: 25 },  // Sell 25% at 2x
      { multiplier: 3.0, sellPercent: 25 },  // Sell 25% at 3x
      { multiplier: 5.0, sellPercent: 50 },  // Sell remaining 50% at 5x
    ],
    moveStopToBreakeven: true,
  },
};

// =============================================================================
// ANALYTICS TYPES
// =============================================================================

/**
 * Trade statistics
 */
export interface TradeStats {
  /** Total trades */
  totalTrades: number;

  /** Winning trades */
  winningTrades: number;

  /** Losing trades */
  losingTrades: number;

  /** Win rate */
  winRate: number;

  /** Total P&L */
  totalPnlSol: number;

  /** Average win */
  averageWinSol: number;

  /** Average loss */
  averageLossSol: number;

  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;

  /** Best trade P&L */
  bestTradePnlSol: number;

  /** Worst trade P&L */
  worstTradePnlSol: number;

  /** Maximum drawdown percentage */
  maxDrawdownPercent: number;

  /** Average hold time in ms */
  averageHoldTimeMs: number;

  /** Average slippage */
  averageSlippageBps: number;
}

/**
 * Execution analytics
 */
export interface ExecutionAnalytics {
  /** Time period start */
  periodStart: Timestamp;

  /** Time period end */
  periodEnd: Timestamp;

  /** Trade statistics */
  tradeStats: TradeStats;

  /** Total volume traded (SOL) */
  totalVolumeSol: number;

  /** Total fees paid (SOL) */
  totalFeesSol: number;

  /** Average execution time (ms) */
  averageExecutionTimeMs: number;

  /** Transaction success rate */
  txSuccessRate: number;

  /** Transactions by status */
  txByStatus: Record<OrderStatus, number>;
}
