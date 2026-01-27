/**
 * Backtest Simulation Engine
 *
 * Replays historical data chronologically, generates signals,
 * and simulates trades with realistic slippage and fees.
 */

import { EventEmitter } from 'events';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { SignalType } from '../analyzers/types.js';
import type { SolanaAddress, Timestamp } from '../core/types.js';
import {
  type HistoricalToken,
  type HistoricalDataPoint,
  type BacktestConfig,
  type BacktestResult,
  type BacktestTrade,
  type EquityPoint,
  type DailyPnlRecord,
  type PerformanceMetrics,
  TradeExitReason,
  TradeStatus,
  DEFAULT_BACKTEST_CONFIG,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const logger = getComponentLogger('BacktestEngine');

// =============================================================================
// EVENTS
// =============================================================================

export interface BacktestEngineEvents {
  /** Trade opened */
  tradeOpened: (trade: BacktestTrade) => void;

  /** Trade closed */
  tradeClosed: (trade: BacktestTrade) => void;

  /** Progress update */
  progress: (percent: number, currentToken: string) => void;

  /** Backtest complete */
  complete: (result: BacktestResult) => void;
}

// =============================================================================
// SIMULATED POSITION
// =============================================================================

interface SimulatedPosition {
  trade: BacktestTrade;
  stopLossPrice: number;
  takeProfitLevels: Array<{
    multiplier: number;
    sellPercent: number;
    triggered: boolean;
  }>;
}

// =============================================================================
// BACKTEST ENGINE CLASS
// =============================================================================

/**
 * Backtest Simulation Engine
 */
export class BacktestEngine extends EventEmitter {
  private config: BacktestConfig;
  private capital: number;
  private positions: Map<string, SimulatedPosition> = new Map();
  private trades: BacktestTrade[] = [];
  private equityCurve: EquityPoint[] = [];
  private dailyPnl: Map<string, DailyPnlRecord> = new Map();
  private tradeIdCounter: number = 0;
  private isRunning: boolean = false;

  constructor(config: Partial<BacktestConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BACKTEST_CONFIG, ...config };
    this.capital = this.config.startingCapitalSol;
  }

  // ===========================================================================
  // MAIN BACKTEST EXECUTION
  // ===========================================================================

  /**
   * Runs backtest on historical data
   */
  async run(tokens: HistoricalToken[]): Promise<BacktestResult> {
    this.reset();
    this.isRunning = true;

    const startTime = Date.now();
    logger.info('Starting backtest', {
      tokens: tokens.length,
      startingCapital: this.config.startingCapitalSol,
    });

    // Sort tokens by launch time
    const sortedTokens = [...tokens].sort(
      (a, b) => a.launchTimestamp - b.launchTimestamp
    );

    // Process each token
    for (let i = 0; i < sortedTokens.length; i++) {
      const token = sortedTokens[i];
      if (!token) continue;

      if (!this.isRunning) break;

      this.emit('progress', ((i + 1) / sortedTokens.length) * 100, token.symbol);
      await this.processToken(token);
    }

    // Close any remaining positions at end of data
    for (const position of this.positions.values()) {
      const lastDataPoint = sortedTokens
        .find((t) => t.mintAddress === position.trade.mintAddress)
        ?.dataPoints.slice(-1)[0];

      if (lastDataPoint) {
        this.closePosition(
          position,
          lastDataPoint.priceSol,
          lastDataPoint.timestamp,
          TradeExitReason.END_OF_DATA
        );
      }
    }

    // Calculate final metrics
    const metrics = this.calculateMetrics();
    const endTime = Date.now();

    const result: BacktestResult = {
      runId: `bt_${Date.now().toString(36)}`,
      config: this.config,
      startTimestamp: startTime,
      endTimestamp: endTime,
      durationMs: endTime - startTime,
      tokensAnalyzed: tokens.length,
      trades: this.trades,
      metrics,
      equityCurve: this.equityCurve,
      dailyPnl: Array.from(this.dailyPnl.values()),
    };

    this.isRunning = false;
    this.emit('complete', result);

    logger.info('Backtest complete', {
      tokensAnalyzed: tokens.length,
      totalTrades: this.trades.length,
      totalPnlSol: metrics.totalPnlSol,
      winRate: metrics.winRate,
      sharpeRatio: metrics.sharpeRatio,
    });

    return result;
  }

  /**
   * Stops the backtest
   */
  stop(): void {
    this.isRunning = false;
    logger.info('Backtest stopped');
  }

  /**
   * Resets the engine state
   */
  private reset(): void {
    this.capital = this.config.startingCapitalSol;
    this.positions.clear();
    this.trades = [];
    this.equityCurve = [];
    this.dailyPnl.clear();
    this.tradeIdCounter = 0;
  }

  // ===========================================================================
  // TOKEN PROCESSING
  // ===========================================================================

  /**
   * Processes a single token's historical data
   */
  private async processToken(token: HistoricalToken): Promise<void> {
    if (token.dataPoints.length < 2) {
      logger.debug('Skipping token with insufficient data', {
        mintAddress: token.mintAddress,
        dataPoints: token.dataPoints.length,
      });
      return;
    }

    // Process each time step
    for (let i = 1; i < token.dataPoints.length; i++) {
      if (!this.isRunning) break;

      const prevPoint = token.dataPoints[i - 1];
      const currentPoint = token.dataPoints[i];

      if (!prevPoint || !currentPoint) continue;

      // Calculate momentum score (simplified for backtest)
      const momentumScore = this.calculateMomentumScore(
        token.dataPoints.slice(0, i + 1),
        currentPoint
      );

      // Check for entry signal
      if (!this.hasPosition(token.mintAddress)) {
        const signal = this.checkEntrySignal(momentumScore, currentPoint);
        if (signal !== null) {
          this.tryOpenPosition(token, currentPoint, signal, momentumScore);
        }
      }

      // Update existing positions
      const position = this.positions.get(token.mintAddress);
      if (position) {
        this.updatePosition(position, currentPoint);
      }

      // Record equity point (every hour or so)
      if (i % 60 === 0) {
        this.recordEquityPoint(currentPoint.timestamp);
      }
    }
  }

  // ===========================================================================
  // MOMENTUM CALCULATION (SIMPLIFIED FOR BACKTEST)
  // ===========================================================================

  /**
   * Calculates momentum score from historical data
   */
  private calculateMomentumScore(
    dataPoints: HistoricalDataPoint[],
    currentPoint: HistoricalDataPoint
  ): number {
    if (dataPoints.length < 5) return 0;

    // Volume score (0-30)
    const volumeScore = this.calculateVolumeScore(dataPoints);

    // Price momentum score (0-25)
    const priceScore = this.calculatePriceScore(dataPoints);

    // Holder score (0-20)
    const holderScore = this.calculateHolderScore(currentPoint);

    // Liquidity score (0-15)
    const liquidityScore = this.calculateLiquidityScore(currentPoint);

    // Bonding curve score (0-10)
    const bondingScore = this.calculateBondingScore(currentPoint);

    return Math.min(
      100,
      Math.max(0, volumeScore + priceScore + holderScore + liquidityScore + bondingScore)
    );
  }

  private calculateVolumeScore(dataPoints: HistoricalDataPoint[]): number {
    if (dataPoints.length < 2) return 0;

    const recentVolume = dataPoints.slice(-5).reduce((sum, p) => sum + p.volumeSol, 0);
    const prevVolume = dataPoints.slice(-10, -5).reduce((sum, p) => sum + p.volumeSol, 0);

    if (prevVolume === 0) return 15; // New token

    const volumeGrowth = (recentVolume - prevVolume) / prevVolume;
    return Math.min(30, Math.max(0, 15 + volumeGrowth * 15));
  }

  private calculatePriceScore(dataPoints: HistoricalDataPoint[]): number {
    if (dataPoints.length < 5) return 0;

    const recentPrices = dataPoints.slice(-5).map((p) => p.priceUsd);
    const prevPrices = dataPoints.slice(-10, -5).map((p) => p.priceUsd);

    const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const prevAvg = prevPrices.reduce((a, b) => a + b, 0) / (prevPrices.length || 1);

    if (prevAvg === 0) return 12;

    const priceGrowth = (recentAvg - prevAvg) / prevAvg;
    return Math.min(25, Math.max(0, 12 + priceGrowth * 25));
  }

  private calculateHolderScore(point: HistoricalDataPoint): number {
    const holders = point.holderCount;
    if (holders < 50) return 5;
    if (holders < 100) return 10;
    if (holders < 500) return 15;
    return 20;
  }

  private calculateLiquidityScore(point: HistoricalDataPoint): number {
    const liquidity = point.liquidityUsd;
    if (liquidity < 5000) return 3;
    if (liquidity < 10000) return 7;
    if (liquidity < 50000) return 12;
    return 15;
  }

  private calculateBondingScore(point: HistoricalDataPoint): number {
    const progress = point.bondingProgress;
    if (progress < 70 || progress > 95) return 2;
    if (progress >= 80 && progress <= 90) return 10;
    return 6;
  }

  // ===========================================================================
  // ENTRY/EXIT LOGIC
  // ===========================================================================

  /**
   * Checks if entry signal should trigger
   */
  private checkEntrySignal(
    momentumScore: number,
    dataPoint: HistoricalDataPoint
  ): SignalType | null {
    // Check bonding curve is in valid range
    if (dataPoint.bondingProgress < 70 || dataPoint.bondingProgress > 95) {
      return null;
    }

    // Check minimum liquidity
    if (dataPoint.liquidityUsd < 5000) {
      return null;
    }

    // Check thresholds
    if (momentumScore >= this.config.thresholds.strongBuy) {
      return SignalType.STRONG_BUY;
    }

    if (momentumScore >= this.config.thresholds.buy) {
      return SignalType.BUY;
    }

    return null;
  }

  /**
   * Tries to open a new position
   */
  private tryOpenPosition(
    token: HistoricalToken,
    dataPoint: HistoricalDataPoint,
    signal: SignalType,
    momentumScore: number
  ): boolean {
    // Check concurrent position limit
    if (this.positions.size >= this.config.risk.maxConcurrentPositions) {
      return false;
    }

    // Calculate position size
    const baseSize = this.config.risk.maxPositionSizeSol;
    const scoreMultiplier = momentumScore / 100;
    let positionSize = baseSize * scoreMultiplier;

    // Strong buy gets full size, regular buy gets 75%
    if (signal === SignalType.BUY) {
      positionSize *= 0.75;
    }

    // Cap at available capital (leave some for fees)
    const availableCapital = this.capital - 0.01; // Reserve for fees
    positionSize = Math.min(positionSize, availableCapital * 0.33);

    if (positionSize < 0.01) {
      return false;
    }

    // Simulate transaction failure
    if (Math.random() < this.config.failureRate) {
      logger.debug('Simulated transaction failure', { token: token.symbol });
      return false;
    }

    // Apply entry slippage
    const slippageMultiplier = 1 + this.config.slippage.entryPercent / 100;
    const effectivePrice = dataPoint.priceSol * slippageMultiplier;
    const tokenAmount = positionSize / effectivePrice;

    // Calculate fees
    const fees = this.config.fees.gasSol + this.config.fees.jitoTipSol;

    // Create trade record
    const trade: BacktestTrade = {
      id: `bt_trade_${++this.tradeIdCounter}`,
      mintAddress: token.mintAddress,
      symbol: token.symbol,
      signal,
      momentumScore,
      entryTimestamp: dataPoint.timestamp,
      entryPrice: effectivePrice,
      positionSizeSol: positionSize,
      tokenAmount,
      entrySlippage: this.config.slippage.entryPercent,
      feesPaidSol: fees,
      status: TradeStatus.OPEN,
      takeProfitHits: [],
    };

    // Create position
    const position: SimulatedPosition = {
      trade,
      stopLossPrice: effectivePrice * (1 - this.config.risk.stopLossPercent / 100),
      takeProfitLevels: this.config.risk.takeProfitLevels.map((l) => ({
        multiplier: l.multiplier,
        sellPercent: l.sellPercent,
        triggered: false,
      })),
    };

    // Deduct capital
    this.capital -= positionSize + fees;
    this.positions.set(token.mintAddress, position);

    logger.debug('Opened position', {
      symbol: token.symbol,
      price: effectivePrice,
      size: positionSize,
      score: momentumScore,
    });

    this.emit('tradeOpened', trade);
    return true;
  }

  /**
   * Updates a position with current price
   */
  private updatePosition(
    position: SimulatedPosition,
    dataPoint: HistoricalDataPoint
  ): void {
    const currentPrice = dataPoint.priceSol;
    const trade = position.trade;

    // Check stop-loss
    if (currentPrice <= position.stopLossPrice) {
      this.closePosition(
        position,
        currentPrice,
        dataPoint.timestamp,
        TradeExitReason.STOP_LOSS
      );
      return;
    }

    // Check take-profit levels
    for (let i = 0; i < position.takeProfitLevels.length; i++) {
      const level = position.takeProfitLevels[i];
      if (!level || level.triggered) continue;

      const targetPrice = trade.entryPrice * level.multiplier;
      if (currentPrice >= targetPrice) {
        // Partial exit for all but last level
        if (i < position.takeProfitLevels.length - 1) {
          this.executePartialExit(position, dataPoint, level.sellPercent, i);
        } else {
          // Last level - close entire position
          this.closePosition(
            position,
            currentPrice,
            dataPoint.timestamp,
            TradeExitReason.TAKE_PROFIT
          );
        }
        return;
      }
    }

    // Update trailing stop after first take-profit
    if (position.takeProfitLevels.some((l) => l.triggered)) {
      const newStopLoss = currentPrice * (1 - this.config.risk.stopLossPercent / 100);
      if (newStopLoss > position.stopLossPrice) {
        position.stopLossPrice = newStopLoss;
      }
    }
  }

  /**
   * Executes partial exit (take-profit ladder)
   */
  private executePartialExit(
    position: SimulatedPosition,
    dataPoint: HistoricalDataPoint,
    sellPercent: number,
    levelIndex: number
  ): void {
    const trade = position.trade;
    const tokensToSell = trade.tokenAmount * (sellPercent / 100);

    // Apply exit slippage
    const slippageMultiplier = 1 - this.config.slippage.exitPercent / 100;
    const effectivePrice = dataPoint.priceSol * slippageMultiplier;
    const proceeds = tokensToSell * effectivePrice;

    // Deduct fees
    const fees = this.config.fees.gasSol + this.config.fees.jitoTipSol;
    trade.feesPaidSol += fees;

    // Add proceeds to capital
    this.capital += proceeds - fees;

    // Update trade
    trade.tokenAmount -= tokensToSell;
    trade.takeProfitHits.push(levelIndex);

    // Mark level as triggered
    const level = position.takeProfitLevels[levelIndex];
    if (level) {
      level.triggered = true;
    }

    // Move stop-loss to break-even after first take-profit
    if (levelIndex === 0) {
      position.stopLossPrice = trade.entryPrice;
    }

    logger.debug('Partial exit executed', {
      symbol: trade.symbol,
      level: levelIndex,
      soldPercent: sellPercent,
      proceeds,
    });
  }

  /**
   * Closes a position
   */
  private closePosition(
    position: SimulatedPosition,
    exitPrice: number,
    exitTimestamp: Timestamp,
    reason: TradeExitReason
  ): void {
    const trade = position.trade;

    // Apply exit slippage
    const slippageMultiplier = 1 - this.config.slippage.exitPercent / 100;
    const effectiveExitPrice = exitPrice * slippageMultiplier;
    const proceeds = trade.tokenAmount * effectiveExitPrice;

    // Deduct final fees
    const fees = this.config.fees.gasSol + this.config.fees.jitoTipSol;
    trade.feesPaidSol += fees;

    // Add proceeds to capital
    this.capital += proceeds - fees;

    // Calculate P&L
    const totalCost = trade.positionSizeSol + trade.feesPaidSol;
    const totalProceeds =
      proceeds +
      trade.takeProfitHits.length * trade.positionSizeSol * 0.25; // Rough estimate

    trade.exitTimestamp = exitTimestamp;
    trade.exitPrice = effectiveExitPrice;
    trade.exitSlippage = this.config.slippage.exitPercent;
    trade.exitReason = reason;
    trade.realizedPnlSol = totalProceeds - totalCost;
    trade.realizedPnlPercent = (trade.realizedPnlSol / trade.positionSizeSol) * 100;
    trade.status = TradeStatus.CLOSED;

    // Remove from positions
    this.positions.delete(trade.mintAddress);
    this.trades.push(trade);

    // Update daily P&L
    this.updateDailyPnl(trade);

    logger.debug('Position closed', {
      symbol: trade.symbol,
      reason,
      pnlSol: trade.realizedPnlSol,
      pnlPercent: trade.realizedPnlPercent,
    });

    this.emit('tradeClosed', trade);
  }

  // ===========================================================================
  // TRACKING & METRICS
  // ===========================================================================

  /**
   * Records equity curve point
   */
  private recordEquityPoint(timestamp: Timestamp): void {
    // Calculate unrealized P&L
    let unrealizedPnl = 0;
    for (const position of this.positions.values()) {
      // This is simplified - in reality we'd need current price
      unrealizedPnl += 0;
    }

    // Calculate drawdown (always >= 0)
    const peakCapital = Math.max(
      this.config.startingCapitalSol,
      ...this.equityCurve.map((e) => e.capitalSol),
      this.capital // Include current capital in peak calculation
    );
    const drawdownPercent =
      peakCapital > 0 ? Math.max(0, ((peakCapital - this.capital) / peakCapital) * 100) : 0;

    this.equityCurve.push({
      timestamp,
      capitalSol: this.capital,
      unrealizedPnlSol: unrealizedPnl,
      drawdownPercent,
    });
  }

  /**
   * Updates daily P&L tracking
   */
  private updateDailyPnl(trade: BacktestTrade): void {
    if (!trade.exitTimestamp) return;

    const date = new Date(trade.exitTimestamp).toISOString().split('T')[0] ?? '';

    let record = this.dailyPnl.get(date);
    if (!record) {
      record = {
        date,
        startingCapitalSol: this.capital - (trade.realizedPnlSol ?? 0),
        endingCapitalSol: this.capital,
        realizedPnlSol: 0,
        tradesExecuted: 0,
        wins: 0,
        losses: 0,
      };
      this.dailyPnl.set(date, record);
    }

    record.endingCapitalSol = this.capital;
    record.realizedPnlSol += trade.realizedPnlSol ?? 0;
    record.tradesExecuted++;

    if ((trade.realizedPnlSol ?? 0) > 0) {
      record.wins++;
    } else if ((trade.realizedPnlSol ?? 0) < 0) {
      record.losses++;
    }
  }

  /**
   * Checks if we have an open position for a token
   */
  private hasPosition(mintAddress: SolanaAddress): boolean {
    return this.positions.has(mintAddress);
  }

  /**
   * Calculates comprehensive performance metrics
   */
  private calculateMetrics(): PerformanceMetrics {
    const closedTrades = this.trades.filter((t) => t.status === TradeStatus.CLOSED);
    const winningTrades = closedTrades.filter((t) => (t.realizedPnlSol ?? 0) > 0);
    const losingTrades = closedTrades.filter((t) => (t.realizedPnlSol ?? 0) < 0);

    // Basic counts
    const totalTrades = closedTrades.length;
    const wins = winningTrades.length;
    const losses = losingTrades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    // P&L calculations
    const totalPnlSol = closedTrades.reduce((sum, t) => sum + (t.realizedPnlSol ?? 0), 0);
    const totalPnlPercent =
      this.config.startingCapitalSol > 0
        ? (totalPnlSol / this.config.startingCapitalSol) * 100
        : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + (t.realizedPnlSol ?? 0), 0);
    const grossLoss = Math.abs(
      losingTrades.reduce((sum, t) => sum + (t.realizedPnlSol ?? 0), 0)
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Average calculations
    const averageWinSol = wins > 0 ? grossProfit / wins : 0;
    const averageLossSol = losses > 0 ? grossLoss / losses : 0;
    const averageWinPercent =
      wins > 0
        ? winningTrades.reduce((sum, t) => sum + (t.realizedPnlPercent ?? 0), 0) / wins
        : 0;
    const averageLossPercent =
      losses > 0
        ? Math.abs(
            losingTrades.reduce((sum, t) => sum + (t.realizedPnlPercent ?? 0), 0) / losses
          )
        : 0;

    // Largest trades
    const largestWinSol = Math.max(0, ...winningTrades.map((t) => t.realizedPnlSol ?? 0));
    const largestLossSol = Math.abs(
      Math.min(0, ...losingTrades.map((t) => t.realizedPnlSol ?? 0))
    );

    // Holding time
    const holdingTimes = closedTrades
      .filter((t) => t.exitTimestamp)
      .map((t) => (t.exitTimestamp ?? 0) - t.entryTimestamp);
    const averageHoldingTimeMs =
      holdingTimes.length > 0
        ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length
        : 0;

    // Risk metrics
    const sharpeRatio = this.calculateSharpeRatio(closedTrades);
    const sortinoRatio = this.calculateSortinoRatio(closedTrades);
    const { maxDrawdownPercent, maxDrawdownDurationMs } = this.calculateMaxDrawdown();
    const calmarRatio =
      maxDrawdownPercent > 0 ? (totalPnlPercent / maxDrawdownPercent) : 0;

    // Streaks
    const { longestWinStreak, longestLoseStreak, currentStreak } =
      this.calculateStreaks(closedTrades);

    // Fees
    const totalFeesSol = closedTrades.reduce((sum, t) => sum + t.feesPaidSol, 0);
    const totalSlippageSol =
      closedTrades.reduce(
        (sum, t) =>
          sum +
          t.positionSizeSol * (t.entrySlippage / 100) +
          (t.exitPrice ?? 0) * t.tokenAmount * ((t.exitSlippage ?? 0) / 100),
        0
      );

    return {
      totalPnlSol,
      totalPnlPercent,
      finalCapitalSol: this.capital,
      totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      winRate,
      averageWinSol,
      averageLossSol,
      averageWinPercent,
      averageLossPercent,
      largestWinSol,
      largestLossSol,
      averageHoldingTimeMs,
      profitFactor,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      maxDrawdownPercent,
      maxDrawdownDurationMs,
      longestWinStreak,
      longestLoseStreak,
      currentStreak,
      totalFeesSol,
      totalSlippageSol,
      totalSignals: this.trades.length,
      signalsExecuted: closedTrades.length,
      signalAccuracy: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    };
  }

  /**
   * Calculates Sharpe ratio
   */
  private calculateSharpeRatio(trades: BacktestTrade[]): number {
    if (trades.length < 2) return 0;

    const returns = trades.map((t) => t.realizedPnlPercent ?? 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      (returns.length - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualize (assuming ~250 trading days, ~10 trades per day)
    const annualizationFactor = Math.sqrt(2500);
    return (avgReturn / stdDev) * annualizationFactor;
  }

  /**
   * Calculates Sortino ratio (only considers downside volatility)
   */
  private calculateSortinoRatio(trades: BacktestTrade[]): number {
    if (trades.length < 2) return 0;

    const returns = trades.map((t) => t.realizedPnlPercent ?? 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const negativeReturns = returns.filter((r) => r < 0);

    if (negativeReturns.length === 0) return avgReturn > 0 ? Infinity : 0;

    const downsideVariance =
      negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) /
      negativeReturns.length;
    const downsideDev = Math.sqrt(downsideVariance);

    if (downsideDev === 0) return 0;

    const annualizationFactor = Math.sqrt(2500);
    return (avgReturn / downsideDev) * annualizationFactor;
  }

  /**
   * Calculates maximum drawdown
   */
  private calculateMaxDrawdown(): {
    maxDrawdownPercent: number;
    maxDrawdownDurationMs: number;
  } {
    if (this.equityCurve.length < 2) {
      return { maxDrawdownPercent: 0, maxDrawdownDurationMs: 0 };
    }

    let peak = this.equityCurve[0]?.capitalSol ?? 0;
    let peakTimestamp = this.equityCurve[0]?.timestamp ?? 0;
    let maxDrawdownPercent = 0;
    let maxDrawdownDurationMs = 0;

    for (const point of this.equityCurve) {
      if (point.capitalSol > peak) {
        peak = point.capitalSol;
        peakTimestamp = point.timestamp;
      }

      const drawdown = ((peak - point.capitalSol) / peak) * 100;
      if (drawdown > maxDrawdownPercent) {
        maxDrawdownPercent = drawdown;
        maxDrawdownDurationMs = point.timestamp - peakTimestamp;
      }
    }

    return { maxDrawdownPercent, maxDrawdownDurationMs };
  }

  /**
   * Calculates win/loss streaks
   */
  private calculateStreaks(trades: BacktestTrade[]): {
    longestWinStreak: number;
    longestLoseStreak: number;
    currentStreak: number;
  } {
    let longestWinStreak = 0;
    let longestLoseStreak = 0;
    let currentWinStreak = 0;
    let currentLoseStreak = 0;

    for (const trade of trades) {
      if ((trade.realizedPnlSol ?? 0) > 0) {
        currentWinStreak++;
        currentLoseStreak = 0;
        longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
      } else if ((trade.realizedPnlSol ?? 0) < 0) {
        currentLoseStreak++;
        currentWinStreak = 0;
        longestLoseStreak = Math.max(longestLoseStreak, currentLoseStreak);
      }
    }

    const currentStreak = currentWinStreak > 0 ? currentWinStreak : -currentLoseStreak;

    return { longestWinStreak, longestLoseStreak, currentStreak };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const backtestEngine = new BacktestEngine();

// Convenience exports
export const runBacktest = (tokens: HistoricalToken[], config?: Partial<BacktestConfig>) => {
  const engine = new BacktestEngine(config);
  return engine.run(tokens);
};
