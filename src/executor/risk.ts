/**
 * Risk Manager
 *
 * Enforces trading risk limits:
 * - Position size limits
 * - Concurrent position limits
 * - Daily loss limits (circuit breaker)
 * - Capital allocation
 */

import { EventEmitter } from 'events';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { walletManager } from '../infrastructure/wallet/index.js';
// LAMPORTS_PER_SOL not directly used in this file
import type { SolanaAddress, Timestamp } from '../core/types.js';
import {
  type Order,
  type Position,
  type RiskLimits,
  type DailyPnL,
  type RiskCheckResult,
  type ExecutorConfig,
  OrderSide,
  DEFAULT_EXECUTOR_CONFIG,
} from './types.js';
import { positionManager } from './positions.js';

// =============================================================================
// EVENTS
// =============================================================================

export interface RiskManagerEvents {
  /** Daily loss limit hit */
  dailyLimitHit: (dailyPnL: DailyPnL) => void;

  /** Trading paused */
  tradingPaused: (reason: string) => void;

  /** Trading resumed */
  tradingResumed: () => void;

  /** Risk alert */
  riskAlert: (alert: { level: 'warning' | 'critical'; message: string }) => void;
}

// =============================================================================
// RISK MANAGER CLASS
// =============================================================================

const logger = getComponentLogger('RiskManager');

/**
 * Risk Manager
 */
export class RiskManager extends EventEmitter {
  private config: ExecutorConfig;
  private dailyPnL: DailyPnL;
  private tradingPaused: boolean = false;
  private pauseReason: string | null = null;
  private tradeHistory: Array<{
    timestamp: Timestamp;
    pnlSol: number;
    type: 'realized' | 'unrealized';
  }> = [];

  constructor(config: Partial<ExecutorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.dailyPnL = this.initializeDailyPnL();
  }

  // ===========================================================================
  // DAILY P&L TRACKING
  // ===========================================================================

  /**
   * Initializes daily P&L tracking
   */
  private initializeDailyPnL(): DailyPnL {
    const today = new Date().toISOString().split('T')[0] ?? new Date().toISOString().slice(0, 10);

    return {
      date: today,
      startingCapitalSol: 0,
      currentCapitalSol: 0,
      realizedPnlSol: 0,
      unrealizedPnlSol: 0,
      totalPnlSol: 0,
      pnlPercent: 0,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      dailyLimitHit: false,
      tradingPaused: false,
    };
  }

  /**
   * Updates starting capital (call at start of day)
   */
  async updateStartingCapital(): Promise<void> {
    try {
      const balances = await walletManager.getAllBalances();
      const totalSol = balances.reduce((sum, b) => sum + b.sol, 0);

      this.dailyPnL.startingCapitalSol = totalSol;
      this.dailyPnL.currentCapitalSol = totalSol;

      logger.info('Updated starting capital', {
        capitalSol: totalSol,
        date: this.dailyPnL.date,
      });
    } catch (error) {
      logger.error('Failed to update starting capital', { error });
    }
  }

  /**
   * Resets daily P&L (call at start of new day)
   */
  resetDailyPnL(): void {
    const today = new Date().toISOString().split('T')[0];

    if (this.dailyPnL.date !== today) {
      logger.info('Resetting daily P&L', {
        previousDate: this.dailyPnL.date,
        previousPnl: this.dailyPnL.totalPnlSol,
        newDate: today,
      });

      this.dailyPnL = this.initializeDailyPnL();
      this.tradeHistory = [];

      // Resume trading if paused due to daily limit
      if (this.tradingPaused && this.pauseReason === 'daily_limit') {
        this.resumeTrading();
      }
    }
  }

  /**
   * Records a trade result
   */
  recordTrade(order: Order, position: Position): void {
    // Only record completed buys/sells
    if (order.status !== 'CONFIRMED') return;

    this.dailyPnL.tradeCount++;

    // For sells, record realized P&L
    if (order.side === OrderSide.SELL && position.totalPnlSol !== undefined) {
      this.dailyPnL.realizedPnlSol += position.totalPnlSol;

      if (position.totalPnlSol > 0) {
        this.dailyPnL.winCount++;
      } else if (position.totalPnlSol < 0) {
        this.dailyPnL.lossCount++;
      }

      this.tradeHistory.push({
        timestamp: Date.now(),
        pnlSol: position.totalPnlSol,
        type: 'realized',
      });
    }

    // Update totals
    this.updateDailyTotals();

    // Check daily limit
    this.checkDailyLimit();
  }

  /**
   * Updates daily P&L totals
   */
  updateDailyTotals(): void {
    // Get unrealized P&L from positions
    this.dailyPnL.unrealizedPnlSol = positionManager.getTotalUnrealizedPnl();

    // Calculate total
    this.dailyPnL.totalPnlSol = this.dailyPnL.realizedPnlSol + this.dailyPnL.unrealizedPnlSol;

    // Calculate percentage
    if (this.dailyPnL.startingCapitalSol > 0) {
      this.dailyPnL.pnlPercent =
        (this.dailyPnL.totalPnlSol / this.dailyPnL.startingCapitalSol) * 100;
    }

    // Calculate win rate
    const totalClosedTrades = this.dailyPnL.winCount + this.dailyPnL.lossCount;
    this.dailyPnL.winRate = totalClosedTrades > 0
      ? (this.dailyPnL.winCount / totalClosedTrades) * 100
      : 0;
  }

  /**
   * Checks if daily loss limit has been hit
   */
  private checkDailyLimit(): void {
    const { maxDailyLossPercent } = this.config.riskLimits;
    const lossPercent = Math.abs(Math.min(0, this.dailyPnL.pnlPercent));

    if (lossPercent >= maxDailyLossPercent && !this.dailyPnL.dailyLimitHit) {
      this.dailyPnL.dailyLimitHit = true;

      logger.error('Daily loss limit hit!', {
        lossPercent,
        maxAllowed: maxDailyLossPercent,
        realizedPnl: this.dailyPnL.realizedPnlSol,
      });

      this.pauseTrading('daily_limit');
      this.emit('dailyLimitHit', this.dailyPnL);
    }
  }

  // ===========================================================================
  // TRADING CONTROLS
  // ===========================================================================

  /**
   * Pauses trading
   */
  pauseTrading(reason: string): void {
    if (this.tradingPaused) return;

    this.tradingPaused = true;
    this.pauseReason = reason;
    this.dailyPnL.tradingPaused = true;

    logger.warn('Trading paused', { reason });
    this.emit('tradingPaused', reason);
  }

  /**
   * Resumes trading
   */
  resumeTrading(): void {
    if (!this.tradingPaused) return;

    this.tradingPaused = false;
    this.pauseReason = null;
    this.dailyPnL.tradingPaused = false;

    logger.info('Trading resumed');
    this.emit('tradingResumed');
  }

  /**
   * Checks if trading is allowed
   */
  isTradingAllowed(): boolean {
    return !this.tradingPaused;
  }

  // ===========================================================================
  // PRE-TRADE RISK CHECKS
  // ===========================================================================

  /**
   * Checks if a buy can be executed
   */
  canExecuteBuy(sizeSol: number): RiskCheckResult {
    const checks: RiskCheckResult['checks'] = [];
    let adjustedSize = sizeSol;

    // Check 1: Trading not paused
    checks.push({
      name: 'tradingAllowed',
      passed: !this.tradingPaused,
      message: this.tradingPaused
        ? `Trading paused: ${this.pauseReason}`
        : 'Trading allowed',
    });

    // Check 2: Position size limit
    const maxSize = this.config.riskLimits.maxPositionSizeSol;
    const sizeOk = sizeSol <= maxSize;
    checks.push({
      name: 'positionSize',
      passed: sizeOk,
      message: sizeOk
        ? `Size ${sizeSol} SOL within limit`
        : `Size ${sizeSol} SOL exceeds max ${maxSize} SOL`,
    });
    if (!sizeOk) {
      adjustedSize = maxSize;
    }

    // Check 3: Concurrent positions
    const openCount = positionManager.getOpenPositionCount();
    const maxConcurrent = this.config.riskLimits.maxConcurrentPositions;
    const concurrentOk = openCount < maxConcurrent;
    checks.push({
      name: 'concurrentPositions',
      passed: concurrentOk,
      message: concurrentOk
        ? `${openCount}/${maxConcurrent} positions open`
        : `Max positions reached: ${openCount}/${maxConcurrent}`,
    });

    // Check 4: Total exposure
    const currentExposure = positionManager.getTotalExposure();
    const newExposure = currentExposure + sizeSol;
    const maxExposure = this.config.riskLimits.maxTotalExposureSol;
    const exposureOk = newExposure <= maxExposure;
    checks.push({
      name: 'totalExposure',
      passed: exposureOk,
      message: exposureOk
        ? `Exposure ${newExposure.toFixed(2)} SOL within limit`
        : `Exposure ${newExposure.toFixed(2)} SOL exceeds max ${maxExposure} SOL`,
    });
    if (!exposureOk && currentExposure < maxExposure) {
      adjustedSize = maxExposure - currentExposure;
    }

    // Check 5: Capital percentage
    const capitalPercent = this.dailyPnL.startingCapitalSol > 0
      ? (sizeSol / this.dailyPnL.startingCapitalSol) * 100
      : 0;
    const maxCapitalPercent = this.config.riskLimits.maxTradeCapitalPercent;
    const capitalOk = capitalPercent <= maxCapitalPercent;
    checks.push({
      name: 'capitalPercent',
      passed: capitalOk,
      message: capitalOk
        ? `${capitalPercent.toFixed(1)}% of capital`
        : `${capitalPercent.toFixed(1)}% exceeds max ${maxCapitalPercent}%`,
    });

    // Check 6: Daily loss not exceeded
    checks.push({
      name: 'dailyLimit',
      passed: !this.dailyPnL.dailyLimitHit,
      message: this.dailyPnL.dailyLimitHit
        ? 'Daily loss limit already hit'
        : 'Within daily loss limit',
    });

    // Determine if trade is allowed
    const allowed = checks.every(c => c.passed);
    const reason = checks.find(c => !c.passed)?.message;

    return {
      allowed,
      checks,
      reason,
      adjustedSizeSol: allowed ? undefined : adjustedSize,
    };
  }

  /**
   * Checks if a sell can be executed
   */
  canExecuteSell(position: Position): RiskCheckResult {
    const checks: RiskCheckResult['checks'] = [];

    // Check 1: Position exists and is open
    const positionOk = position.status === 'OPEN';
    checks.push({
      name: 'positionStatus',
      passed: positionOk,
      message: positionOk
        ? 'Position is open'
        : `Position status: ${position.status}`,
    });

    // Check 2: Has tokens to sell
    const hasTokens = position.tokenAmount > BigInt(0);
    checks.push({
      name: 'hasTokens',
      passed: hasTokens,
      message: hasTokens
        ? `Has ${position.tokenAmount} tokens`
        : 'No tokens to sell',
    });

    // Sells are generally always allowed if position is valid
    const allowed = checks.every(c => c.passed);
    const reason = checks.find(c => !c.passed)?.message;

    return {
      allowed,
      checks,
      reason,
    };
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  /**
   * Gets current daily P&L
   */
  getDailyPnL(): DailyPnL {
    this.updateDailyTotals();
    return { ...this.dailyPnL };
  }

  /**
   * Gets risk status summary
   */
  getRiskStatus(): {
    tradingAllowed: boolean;
    pauseReason: string | null;
    dailyPnL: DailyPnL;
    exposure: {
      current: number;
      max: number;
      percent: number;
    };
    positions: {
      open: number;
      max: number;
    };
  } {
    const exposure = positionManager.getTotalExposure();

    return {
      tradingAllowed: !this.tradingPaused,
      pauseReason: this.pauseReason,
      dailyPnL: this.getDailyPnL(),
      exposure: {
        current: exposure,
        max: this.config.riskLimits.maxTotalExposureSol,
        percent: (exposure / this.config.riskLimits.maxTotalExposureSol) * 100,
      },
      positions: {
        open: positionManager.getOpenPositionCount(),
        max: this.config.riskLimits.maxConcurrentPositions,
      },
    };
  }

  /**
   * Calculates maximum drawdown from trade history
   */
  calculateMaxDrawdown(): number {
    if (this.tradeHistory.length === 0) return 0;

    let peak = 0;
    let maxDrawdown = 0;
    let runningPnL = 0;

    for (const trade of this.tradeHistory) {
      runningPnL += trade.pnlSol;

      if (runningPnL > peak) {
        peak = runningPnL;
      }

      const drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return this.dailyPnL.startingCapitalSol > 0
      ? (maxDrawdown / this.dailyPnL.startingCapitalSol) * 100
      : 0;
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const riskManager = new RiskManager();

// Convenience exports
export const canExecuteBuy = (sizeSol: number) => riskManager.canExecuteBuy(sizeSol);
export const canExecuteSell = (position: Position) => riskManager.canExecuteSell(position);
export const isTradingAllowed = () => riskManager.isTradingAllowed();
export const pauseTrading = (reason: string) => riskManager.pauseTrading(reason);
export const resumeTrading = () => riskManager.resumeTrading();
export const getDailyPnL = () => riskManager.getDailyPnL();
export const getRiskStatus = () => riskManager.getRiskStatus();
