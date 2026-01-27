/**
 * Position Manager
 *
 * Tracks open positions with:
 * - Stop-loss monitoring
 * - Laddered take-profit
 * - Unrealized P&L calculation
 * - Position lifecycle management
 */

import { EventEmitter } from 'events';
import type { Address } from '@solana/kit';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import type { SolanaAddress, Timestamp } from '../core/types.js';
import {
  type Position,
  type TakeProfitLevel,
  type ExecutorConfig,
  PositionStatus,
  ExitReason,
  DEFAULT_EXECUTOR_CONFIG,
} from './types.js';

// =============================================================================
// EVENTS
// =============================================================================

export interface PositionManagerEvents {
  /** Position opened */
  positionOpened: (position: Position) => void;

  /** Position updated */
  positionUpdated: (position: Position) => void;

  /** Position closed */
  positionClosed: (position: Position) => void;

  /** Stop-loss triggered */
  stopLossTriggered: (position: Position) => void;

  /** Take-profit triggered */
  takeProfitTriggered: (position: Position, level: TakeProfitLevel) => void;

  /** Emergency exit triggered */
  emergencyExit: (position: Position, reason: string) => void;
}

// =============================================================================
// POSITION MANAGER CLASS
// =============================================================================

const logger = getComponentLogger('PositionManager');

/**
 * Position Manager
 */
export class PositionManager extends EventEmitter {
  private positions: Map<string, Position> = new Map();
  private positionsByToken: Map<string, string[]> = new Map();
  private config: ExecutorConfig;
  private monitorInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config: Partial<ExecutorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Starts position monitoring
   */
  start(): void {
    if (this.isRunning) return;

    logger.info('Starting position manager', {
      monitorInterval: this.config.positionMonitorIntervalMs,
    });

    this.monitorInterval = setInterval(
      () => this.monitorPositions(),
      this.config.positionMonitorIntervalMs
    );

    this.isRunning = true;
  }

  /**
   * Stops position monitoring
   */
  stop(): void {
    if (!this.isRunning) return;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.isRunning = false;
    logger.info('Position manager stopped');
  }

  // ===========================================================================
  // POSITION CREATION
  // ===========================================================================

  /**
   * Creates a new position
   */
  createPosition(params: {
    mintAddress: SolanaAddress;
    symbol?: string;
    walletAddress: Address;
    entryOrderId: string;
    entryPrice: number;
    tokenAmount: bigint;
    costBasisSol: number;
    momentumScore: number;
    signalId?: string;
  }): Position {
    const id = this.generatePositionId();

    // Calculate stop-loss price
    const stopLossPrice = this.calculateStopLoss(params.entryPrice);

    // Create take-profit levels
    const takeProfitLevels = this.createTakeProfitLevels(params.entryPrice);

    const position: Position = {
      id,
      mintAddress: params.mintAddress,
      symbol: params.symbol,
      status: PositionStatus.OPEN,
      walletAddress: params.walletAddress,
      entryOrderId: params.entryOrderId,
      entryPrice: params.entryPrice,
      entryTimestamp: Date.now(),
      tokenAmount: params.tokenAmount,
      initialTokenAmount: params.tokenAmount,
      costBasisSol: params.costBasisSol,
      currentPrice: params.entryPrice,
      currentValueSol: params.costBasisSol,
      unrealizedPnlSol: 0,
      unrealizedPnlPercent: 0,
      realizedPnlSol: 0,
      stopLossPrice,
      takeProfitLevels,
      exitOrderIds: [],
      updatedAt: Date.now(),
      entryMomentumScore: params.momentumScore,
      signalId: params.signalId,
    };

    this.positions.set(id, position);
    this.addToTokenIndex(params.mintAddress, id);

    logger.info('Position created', {
      id,
      mint: params.mintAddress,
      entryPrice: params.entryPrice,
      amount: params.tokenAmount.toString(),
      stopLoss: stopLossPrice,
      takeProfitLevels: takeProfitLevels.map(l => l.multiplier),
    });

    this.emit('positionOpened', position);
    return position;
  }

  /**
   * Calculates stop-loss price
   */
  private calculateStopLoss(entryPrice: number): number {
    const { stopLoss } = this.config;

    if (stopLoss.useAtr) {
      // ATR-based stop-loss would require price history
      // For simplicity, use fixed percentage
      return entryPrice * (1 - stopLoss.fixedPercent / 100);
    }

    return entryPrice * (1 - stopLoss.fixedPercent / 100);
  }

  /**
   * Creates take-profit levels
   */
  private createTakeProfitLevels(entryPrice: number): TakeProfitLevel[] {
    return this.config.takeProfit.levels.map(level => ({
      multiplier: level.multiplier,
      sellPercent: level.sellPercent,
      triggered: false,
    }));
  }

  // ===========================================================================
  // POSITION UPDATES
  // ===========================================================================

  /**
   * Updates a position with current price
   */
  updatePosition(positionId: string, currentPrice: number): Position | null {
    const position = this.positions.get(positionId);
    if (!position || position.status !== PositionStatus.OPEN) return null;

    // Calculate current value
    const tokenAmountNum = Number(position.tokenAmount);
    position.currentPrice = currentPrice;
    position.currentValueSol = tokenAmountNum * currentPrice;

    // Calculate unrealized P&L
    position.unrealizedPnlSol = position.currentValueSol - position.costBasisSol + position.realizedPnlSol;
    position.unrealizedPnlPercent = (position.unrealizedPnlSol / position.costBasisSol) * 100;

    position.updatedAt = Date.now();

    this.emit('positionUpdated', position);
    return position;
  }

  /**
   * Updates position after partial sell
   */
  updatePositionAfterPartialSell(
    positionId: string,
    soldAmount: bigint,
    sellPrice: number,
    orderId: string,
    takeProfitLevelIndex?: number
  ): Position | null {
    const position = this.positions.get(positionId);
    if (!position) return null;

    // Calculate realized P&L from this sell
    const soldAmountNum = Number(soldAmount);
    const avgCostPerToken = position.costBasisSol / Number(position.initialTokenAmount);
    const costOfSold = soldAmountNum * avgCostPerToken;
    const proceedsFromSell = soldAmountNum * sellPrice;
    const realizedPnl = proceedsFromSell - costOfSold;

    // Update position
    position.tokenAmount -= soldAmount;
    position.realizedPnlSol += realizedPnl;
    position.exitOrderIds.push(orderId);

    // Mark take-profit level as triggered
    if (takeProfitLevelIndex !== undefined && position.takeProfitLevels[takeProfitLevelIndex]) {
      position.takeProfitLevels[takeProfitLevelIndex].triggered = true;
      position.takeProfitLevels[takeProfitLevelIndex].triggeredAt = Date.now();
      position.takeProfitLevels[takeProfitLevelIndex].orderId = orderId;

      // Move stop-loss to break-even after first take-profit
      if (this.config.takeProfit.moveStopToBreakeven && takeProfitLevelIndex === 0) {
        position.stopLossPrice = position.entryPrice;
        logger.info('Moved stop-loss to break-even', {
          positionId,
          newStopLoss: position.entryPrice,
        });
      }
    }

    // Update trailing stop if enabled
    if (this.config.stopLoss.trailingEnabled) {
      const trailingStop = sellPrice * (1 - this.config.stopLoss.trailingPercent / 100);
      if (trailingStop > position.stopLossPrice) {
        position.stopLossPrice = trailingStop;
        logger.debug('Updated trailing stop', {
          positionId,
          newStopLoss: trailingStop,
        });
      }
    }

    position.updatedAt = Date.now();

    logger.info('Position updated after partial sell', {
      positionId,
      soldAmount: soldAmount.toString(),
      sellPrice,
      realizedPnl,
      remainingAmount: position.tokenAmount.toString(),
    });

    this.emit('positionUpdated', position);
    return position;
  }

  // ===========================================================================
  // POSITION CLOSING
  // ===========================================================================

  /**
   * Closes a position
   */
  closePosition(
    positionId: string,
    exitPrice: number,
    exitReason: ExitReason,
    finalOrderId?: string
  ): Position | null {
    const position = this.positions.get(positionId);
    if (!position) return null;

    // Calculate final P&L
    const tokenAmountNum = Number(position.tokenAmount);
    const finalProceeds = tokenAmountNum * exitPrice;
    const avgCostPerToken = position.costBasisSol / Number(position.initialTokenAmount);
    const remainingCost = tokenAmountNum * avgCostPerToken;
    const finalRealizedPnl = finalProceeds - remainingCost;

    // Update position
    position.status = exitReason === ExitReason.STOP_LOSS
      ? PositionStatus.LIQUIDATED
      : PositionStatus.CLOSED;
    position.exitPrice = exitPrice;
    position.exitTimestamp = Date.now();
    position.exitReason = exitReason;
    position.tokenAmount = BigInt(0);

    // Total P&L
    position.totalPnlSol = position.realizedPnlSol + finalRealizedPnl;
    position.totalPnlPercent = (position.totalPnlSol / position.costBasisSol) * 100;

    if (finalOrderId) {
      position.exitOrderIds.push(finalOrderId);
    }

    position.updatedAt = Date.now();

    logger.info('Position closed', {
      positionId,
      exitPrice,
      exitReason,
      totalPnlSol: position.totalPnlSol,
      totalPnlPercent: position.totalPnlPercent,
      holdTimeMs: position.exitTimestamp - position.entryTimestamp,
    });

    this.emit('positionClosed', position);
    return position;
  }

  // ===========================================================================
  // MONITORING
  // ===========================================================================

  /**
   * Monitors all positions for stop-loss and take-profit conditions
   */
  private async monitorPositions(): Promise<void> {
    const openPositions = this.getOpenPositions();
    if (openPositions.length === 0) return;

    logger.debug('Monitoring positions', { count: openPositions.length });

    for (const position of openPositions) {
      // Check stop-loss
      if (this.shouldTriggerStopLoss(position)) {
        logger.warn('Stop-loss triggered', {
          positionId: position.id,
          currentPrice: position.currentPrice,
          stopLoss: position.stopLossPrice,
        });
        this.emit('stopLossTriggered', position);
      }

      // Check take-profit levels
      const triggeredLevel = this.getTriggeredTakeProfitLevel(position);
      if (triggeredLevel !== null) {
        const level = position.takeProfitLevels[triggeredLevel];
        if (level && !level.triggered) {
          logger.info('Take-profit triggered', {
            positionId: position.id,
            level: triggeredLevel,
            multiplier: level.multiplier,
            currentPrice: position.currentPrice,
          });
          this.emit('takeProfitTriggered', position, level);
        }
      }
    }
  }

  /**
   * Checks if stop-loss should trigger
   */
  shouldTriggerStopLoss(position: Position): boolean {
    return position.currentPrice <= position.stopLossPrice;
  }

  /**
   * Gets the index of the first untriggered take-profit level that's been hit
   */
  getTriggeredTakeProfitLevel(position: Position): number | null {
    for (let i = 0; i < position.takeProfitLevels.length; i++) {
      const level = position.takeProfitLevels[i];
      if (!level || level.triggered) continue;

      const targetPrice = position.entryPrice * level.multiplier;
      if (position.currentPrice >= targetPrice) {
        return i;
      }
    }
    return null;
  }

  /**
   * Calculates the amount to sell for a take-profit level
   */
  calculateTakeProfitSellAmount(position: Position, levelIndex: number): bigint {
    const level = position.takeProfitLevels[levelIndex];
    if (!level) {
      return position.tokenAmount; // Sell all if level not found
    }
    const sellRatio = level.sellPercent / 100;

    // For the last level, sell all remaining
    const isLastLevel = levelIndex === position.takeProfitLevels.length - 1;
    if (isLastLevel) {
      return position.tokenAmount;
    }

    // Calculate based on initial position size
    const sellAmount = BigInt(Math.floor(Number(position.initialTokenAmount) * sellRatio));

    // Don't sell more than we have
    return sellAmount > position.tokenAmount ? position.tokenAmount : sellAmount;
  }

  // ===========================================================================
  // QUERIES
  // ===========================================================================

  /**
   * Gets a position by ID
   */
  getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  /**
   * Gets all positions for a token
   */
  getPositionsByToken(mintAddress: SolanaAddress): Position[] {
    const ids = this.positionsByToken.get(mintAddress) ?? [];
    return ids.map(id => this.positions.get(id)).filter(Boolean) as Position[];
  }

  /**
   * Gets all open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(
      p => p.status === PositionStatus.OPEN
    );
  }

  /**
   * Gets all positions
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Gets open position count
   */
  getOpenPositionCount(): number {
    return this.getOpenPositions().length;
  }

  /**
   * Checks if we have an open position for a token
   */
  hasOpenPosition(mintAddress: SolanaAddress): boolean {
    return this.getPositionsByToken(mintAddress).some(
      p => p.status === PositionStatus.OPEN
    );
  }

  // ===========================================================================
  // AGGREGATED METRICS
  // ===========================================================================

  /**
   * Gets total unrealized P&L
   */
  getTotalUnrealizedPnl(): number {
    return this.getOpenPositions().reduce(
      (sum, p) => sum + p.unrealizedPnlSol,
      0
    );
  }

  /**
   * Gets total exposure (value of open positions)
   */
  getTotalExposure(): number {
    return this.getOpenPositions().reduce(
      (sum, p) => sum + p.currentValueSol,
      0
    );
  }

  /**
   * Gets total cost basis of open positions
   */
  getTotalCostBasis(): number {
    return this.getOpenPositions().reduce(
      (sum, p) => sum + p.costBasisSol,
      0
    );
  }

  /**
   * Gets position summary
   */
  getSummary(): {
    openPositions: number;
    totalExposure: number;
    totalCostBasis: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
  } {
    const openPositions = this.getOpenPositionCount();
    const totalExposure = this.getTotalExposure();
    const totalCostBasis = this.getTotalCostBasis();
    const unrealizedPnl = this.getTotalUnrealizedPnl();
    const unrealizedPnlPercent = totalCostBasis > 0
      ? (unrealizedPnl / totalCostBasis) * 100
      : 0;

    return {
      openPositions,
      totalExposure,
      totalCostBasis,
      unrealizedPnl,
      unrealizedPnlPercent,
    };
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  private generatePositionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `pos_${timestamp}_${random}`;
  }

  private addToTokenIndex(mintAddress: SolanaAddress, positionId: string): void {
    const existing = this.positionsByToken.get(mintAddress) ?? [];
    existing.push(positionId);
    this.positionsByToken.set(mintAddress, existing);
  }

  /**
   * Clears all positions (for testing)
   */
  clear(): void {
    this.positions.clear();
    this.positionsByToken.clear();
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const positionManager = new PositionManager();

// Convenience exports
export const startPositionManager = () => positionManager.start();
export const stopPositionManager = () => positionManager.stop();
export const getOpenPositions = () => positionManager.getOpenPositions();
export const getPositionSummary = () => positionManager.getSummary();
