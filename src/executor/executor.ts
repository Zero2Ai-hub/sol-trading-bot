/**
 * Trade Executor
 *
 * Main execution engine for trading operations.
 * Features:
 * - Buy/sell execution via Jupiter + Jito
 * - Paper trading mode
 * - Retry logic with fee escalation
 * - Position lifecycle management
 */

import { EventEmitter } from 'events';
import {
  type Address,
  type KeyPairSigner,
  getBase64EncodedWireTransaction,
} from '@solana/kit';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { getRpc, getRpcSubscriptions } from '../infrastructure/rpc/index.js';
import { walletManager, type Wallet } from '../infrastructure/wallet/index.js';
import { WSOL_MINT, EXECUTION } from '../config/constants.js';

const LAMPORTS_PER_SOL = Number(EXECUTION.LAMPORTS_PER_SOL);
import type { SolanaAddress, Timestamp } from '../core/types.js';
import type { GeneratedSignal } from '../engine/types.js';
import {
  type Order,
  type Position,
  type ExecutionResult,
  type SwapQuote,
  type ExecutorConfig,
  OrderSide,
  OrderStatus,
  PositionStatus,
  ExitReason,
  DEFAULT_EXECUTOR_CONFIG,
} from './types.js';
import { jupiterClient } from './jupiter.js';
import { jitoClient } from './jito.js';
import { positionManager } from './positions.js';
import { riskManager } from './risk.js';

// =============================================================================
// EVENTS
// =============================================================================

export interface ExecutorEvents {
  /** Order submitted */
  orderSubmitted: (order: Order) => void;

  /** Order filled */
  orderFilled: (order: Order, result: ExecutionResult) => void;

  /** Order failed */
  orderFailed: (order: Order, error: string) => void;

  /** Position opened */
  positionOpened: (position: Position) => void;

  /** Position closed */
  positionClosed: (position: Position) => void;

  /** Paper trade executed */
  paperTrade: (order: Order) => void;

  /** Error occurred */
  error: (error: Error, context: string) => void;
}

// =============================================================================
// TRADE EXECUTOR CLASS
// =============================================================================

const logger = getComponentLogger('TradeExecutor');

/**
 * Trade Executor
 */
export class TradeExecutor extends EventEmitter {
  private config: ExecutorConfig;
  private orders: Map<string, Order> = new Map();
  private isInitialized: boolean = false;

  constructor(config: Partial<ExecutorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Initializes the executor
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('Initializing trade executor', {
      paperTrading: this.config.paperTrading,
      useJito: this.config.useJito,
      maxPositionSizeSol: this.config.riskLimits.maxPositionSizeSol,
    });

    // Start position manager
    positionManager.start();

    // Set up position manager event forwarding
    positionManager.on('stopLossTriggered', (position) => {
      this.handleStopLoss(position).catch(err => {
        logger.error('Stop-loss execution failed', { error: err });
      });
    });

    positionManager.on('takeProfitTriggered', (position, level) => {
      this.handleTakeProfit(position, level).catch(err => {
        logger.error('Take-profit execution failed', { error: err });
      });
    });

    this.isInitialized = true;
    logger.info('Trade executor initialized');
  }

  /**
   * Shuts down the executor
   */
  async shutdown(): Promise<void> {
    positionManager.stop();
    this.isInitialized = false;
    logger.info('Trade executor shut down');
  }

  // ===========================================================================
  // BUY EXECUTION
  // ===========================================================================

  /**
   * Executes a buy order from a signal
   */
  async executeBuy(
    signal: GeneratedSignal,
    positionSizeSol?: number
  ): Promise<{ order: Order; position?: Position }> {
    // Validate signal
    if (!signal.shouldExecute) {
      throw new Error('Signal should not be executed');
    }

    // Calculate position size
    const sizeSol = positionSizeSol ?? signal.positionSizing.recommendedSizeSol;
    const sizeLamports = BigInt(Math.floor(sizeSol * LAMPORTS_PER_SOL));

    // Risk check
    const riskCheck = riskManager.canExecuteBuy(sizeSol);
    if (!riskCheck.allowed) {
      throw new Error(`Risk check failed: ${riskCheck.reason}`);
    }

    // Select wallet
    const wallet = walletManager.getNextWallet();

    // Create order
    const order = this.createOrder({
      mintAddress: signal.mintAddress,
      side: OrderSide.BUY,
      amount: sizeLamports,
      slippageBps: signal.positionSizing.maxSlippage * 100, // Convert % to bps
      walletAddress: wallet.address,
    });

    logger.info('Executing buy order', {
      orderId: order.id,
      mint: signal.mintAddress,
      sizeSol,
      slippageBps: order.slippageBps,
      wallet: wallet.name,
      paperTrading: this.config.paperTrading,
    });

    // Paper trading mode
    if (this.config.paperTrading) {
      return this.executePaperBuy(order, signal, wallet);
    }

    // Real execution
    return this.executeRealBuy(order, signal, wallet);
  }

  /**
   * Executes a paper buy (simulated)
   */
  private async executePaperBuy(
    order: Order,
    signal: GeneratedSignal,
    wallet: Wallet
  ): Promise<{ order: Order; position: Position }> {
    // Get quote for realistic pricing
    const quote = await jupiterClient.getBuyQuote(
      order.mintAddress,
      order.amount,
      order.slippageBps
    );

    // Simulate successful execution
    order.status = OrderStatus.CONFIRMED;
    order.confirmedAt = Date.now();
    order.signature = `paper_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    order.expectedOutput = quote.outputAmount;
    order.actualOutput = quote.outputAmount;
    order.expectedPrice = Number(order.amount) / Number(quote.outputAmount);
    order.actualPrice = order.expectedPrice;
    order.actualSlippage = 0;

    this.orders.set(order.id, order);
    this.emit('paperTrade', order);

    // Create position
    const position = positionManager.createPosition({
      mintAddress: order.mintAddress,
      walletAddress: wallet.address,
      entryOrderId: order.id,
      entryPrice: order.actualPrice,
      tokenAmount: quote.outputAmount,
      costBasisSol: Number(order.amount) / LAMPORTS_PER_SOL,
      momentumScore: signal.momentumScore,
      signalId: signal.mintAddress, // Using mint as signal ID for now
    });

    // Update risk manager
    riskManager.recordTrade(order, position);

    logger.info('Paper buy executed', {
      orderId: order.id,
      positionId: position.id,
      entryPrice: order.actualPrice,
      tokenAmount: quote.outputAmount.toString(),
    });

    this.emit('positionOpened', position);
    return { order, position };
  }

  /**
   * Executes a real buy
   */
  private async executeRealBuy(
    order: Order,
    signal: GeneratedSignal,
    wallet: Wallet
  ): Promise<{ order: Order; position?: Position }> {
    let lastError: Error | null = null;
    let currentPriorityFee = this.config.basePriorityFeeMicroLamports;

    for (let attempt = 1; attempt <= order.maxRetries; attempt++) {
      try {
        // Get fresh quote
        const quote = await jupiterClient.getBuyQuote(
          order.mintAddress,
          order.amount,
          order.slippageBps
        );

        // Check price impact
        const impact = jupiterClient.assessPriceImpact(quote.priceImpactPct);
        if (!impact.shouldProceed) {
          throw new Error(`Price impact too high: ${quote.priceImpactPct}%`);
        }

        // Build transaction
        const swapTx = await jupiterClient.buildSwapTransaction(
          quote,
          wallet.address,
          currentPriorityFee
        );

        // Update order
        order.status = OrderStatus.SUBMITTED;
        order.submittedAt = Date.now();
        order.expectedOutput = quote.outputAmount;
        order.expectedPrice = Number(order.amount) / Number(quote.outputAmount);
        order.priorityFeeMicroLamports = currentPriorityFee;
        order.retryCount = attempt;

        this.orders.set(order.id, order);
        this.emit('orderSubmitted', order);

        // Execute via Jito or regular RPC
        const result = this.config.useJito
          ? await this.executeViaJito(swapTx)
          : await this.executeViaRpc(swapTx);

        if (result.success) {
          // Update order
          order.status = OrderStatus.CONFIRMED;
          order.confirmedAt = Date.now();
          order.signature = result.signature;
          order.actualOutput = result.actualOutput ?? quote.outputAmount;
          order.actualPrice = Number(order.amount) / Number(order.actualOutput);
          order.actualSlippage = result.actualSlippageBps
            ? result.actualSlippageBps / 100
            : undefined;

          this.orders.set(order.id, order);

          // Create position
          const position = positionManager.createPosition({
            mintAddress: order.mintAddress,
            walletAddress: wallet.address,
            entryOrderId: order.id,
            entryPrice: order.actualPrice,
            tokenAmount: order.actualOutput,
            costBasisSol: Number(order.amount) / LAMPORTS_PER_SOL,
            momentumScore: signal.momentumScore,
          });

          // Update risk manager
          riskManager.recordTrade(order, position);

          logger.info('Buy order executed', {
            orderId: order.id,
            positionId: position.id,
            signature: result.signature,
            entryPrice: order.actualPrice,
          });

          this.emit('orderFilled', order, result);
          this.emit('positionOpened', position);

          return { order, position };
        }

        // Execution failed, will retry
        lastError = new Error(result.error ?? 'Execution failed');

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('Buy attempt failed', {
          orderId: order.id,
          attempt,
          error: lastError.message,
        });
      }

      // Wait before retry
      await new Promise(r => setTimeout(r, this.config.retryDelayMs * attempt));

      // Escalate priority fee
      currentPriorityFee = Math.min(
        currentPriorityFee * 1.5,
        this.config.maxPriorityFeeMicroLamports
      );
    }

    // All retries exhausted
    order.status = OrderStatus.FAILED;
    order.error = lastError?.message ?? 'Unknown error';
    this.orders.set(order.id, order);

    logger.error('Buy order failed', {
      orderId: order.id,
      error: order.error,
      retries: order.maxRetries,
    });

    this.emit('orderFailed', order, order.error);
    return { order };
  }

  // ===========================================================================
  // SELL EXECUTION
  // ===========================================================================

  /**
   * Executes a sell order
   */
  async executeSell(
    position: Position,
    reason: ExitReason,
    percentToSell: number = 100,
    urgentSlippage?: number
  ): Promise<{ order: Order; success: boolean }> {
    // Calculate amount to sell
    const sellRatio = percentToSell / 100;
    const tokenAmount = percentToSell === 100
      ? position.tokenAmount
      : BigInt(Math.floor(Number(position.tokenAmount) * sellRatio));

    // Determine slippage
    const slippageBps = urgentSlippage
      ? urgentSlippage * 100
      : reason === ExitReason.MIGRATION || reason === ExitReason.EMERGENCY
        ? this.config.riskLimits.maxSlippageBps // Max slippage for urgent
        : this.config.defaultSlippageBps;

    // Get wallet
    const wallet = walletManager.getWallet('primary');
    if (!wallet) {
      throw new Error('Wallet not available');
    }

    // Create order
    const order = this.createOrder({
      mintAddress: position.mintAddress,
      side: OrderSide.SELL,
      amount: tokenAmount,
      slippageBps,
      walletAddress: wallet.address,
      positionId: position.id,
      exitReason: reason,
    });

    logger.info('Executing sell order', {
      orderId: order.id,
      positionId: position.id,
      reason,
      percentToSell,
      tokenAmount: tokenAmount.toString(),
      paperTrading: this.config.paperTrading,
    });

    // Paper trading mode
    if (this.config.paperTrading) {
      return this.executePaperSell(order, position, reason, percentToSell);
    }

    // Real execution
    return this.executeRealSell(order, position, reason, percentToSell);
  }

  /**
   * Executes a paper sell (simulated)
   */
  private async executePaperSell(
    order: Order,
    position: Position,
    reason: ExitReason,
    percentToSell: number
  ): Promise<{ order: Order; success: boolean }> {
    // Get quote for realistic pricing
    const quote = await jupiterClient.getSellQuote(
      order.mintAddress,
      order.amount,
      order.slippageBps
    );

    // Simulate successful execution
    const exitPrice = Number(quote.outputAmount) / Number(order.amount);

    order.status = OrderStatus.CONFIRMED;
    order.confirmedAt = Date.now();
    order.signature = `paper_sell_${Date.now()}`;
    order.actualOutput = quote.outputAmount;
    order.actualPrice = exitPrice;
    order.actualSlippage = 0;

    this.orders.set(order.id, order);
    this.emit('paperTrade', order);

    // Update or close position
    if (percentToSell >= 100) {
      positionManager.closePosition(position.id, exitPrice, reason, order.id);
      this.emit('positionClosed', position);
    } else {
      positionManager.updatePositionAfterPartialSell(
        position.id,
        order.amount,
        exitPrice,
        order.id
      );
    }

    // Update risk manager
    riskManager.recordTrade(order, position);

    logger.info('Paper sell executed', {
      orderId: order.id,
      positionId: position.id,
      exitPrice,
      proceeds: Number(quote.outputAmount) / LAMPORTS_PER_SOL,
    });

    return { order, success: true };
  }

  /**
   * Executes a real sell
   */
  private async executeRealSell(
    order: Order,
    position: Position,
    reason: ExitReason,
    percentToSell: number
  ): Promise<{ order: Order; success: boolean }> {
    const wallet = walletManager.getWallet('primary');
    if (!wallet) {
      throw new Error('Wallet not available');
    }

    let lastError: Error | null = null;
    let currentPriorityFee = this.config.basePriorityFeeMicroLamports;

    // Urgent exits get higher initial priority
    if (reason === ExitReason.MIGRATION || reason === ExitReason.EMERGENCY) {
      currentPriorityFee = this.config.maxPriorityFeeMicroLamports;
    }

    for (let attempt = 1; attempt <= order.maxRetries; attempt++) {
      try {
        // Get fresh quote
        const quote = await jupiterClient.getSellQuote(
          order.mintAddress,
          order.amount,
          order.slippageBps
        );

        // Build transaction
        const swapTx = await jupiterClient.buildSwapTransaction(
          quote,
          wallet.address,
          currentPriorityFee
        );

        // Update order
        order.status = OrderStatus.SUBMITTED;
        order.submittedAt = Date.now();
        order.expectedOutput = quote.outputAmount;
        order.priorityFeeMicroLamports = currentPriorityFee;
        order.retryCount = attempt;

        this.orders.set(order.id, order);
        this.emit('orderSubmitted', order);

        // Execute
        const result = this.config.useJito
          ? await this.executeViaJito(swapTx)
          : await this.executeViaRpc(swapTx);

        if (result.success) {
          const exitPrice = Number(result.actualOutput ?? quote.outputAmount) / Number(order.amount);

          order.status = OrderStatus.CONFIRMED;
          order.confirmedAt = Date.now();
          order.signature = result.signature;
          order.actualOutput = result.actualOutput ?? quote.outputAmount;
          order.actualPrice = exitPrice;

          this.orders.set(order.id, order);

          // Update or close position
          if (percentToSell >= 100) {
            positionManager.closePosition(position.id, exitPrice, reason, order.id);
            this.emit('positionClosed', position);
          } else {
            positionManager.updatePositionAfterPartialSell(
              position.id,
              order.amount,
              exitPrice,
              order.id
            );
          }

          // Update risk manager
          riskManager.recordTrade(order, position);

          logger.info('Sell order executed', {
            orderId: order.id,
            positionId: position.id,
            signature: result.signature,
            exitPrice,
          });

          this.emit('orderFilled', order, result);
          return { order, success: true };
        }

        lastError = new Error(result.error ?? 'Execution failed');

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('Sell attempt failed', {
          orderId: order.id,
          attempt,
          error: lastError.message,
        });
      }

      // Wait before retry (shorter for urgent)
      const delay = reason === ExitReason.MIGRATION || reason === ExitReason.EMERGENCY
        ? this.config.retryDelayMs / 2
        : this.config.retryDelayMs * attempt;
      await new Promise(r => setTimeout(r, delay));

      // Escalate priority fee
      currentPriorityFee = Math.min(
        currentPriorityFee * 2,
        this.config.maxPriorityFeeMicroLamports
      );
    }

    // All retries exhausted
    order.status = OrderStatus.FAILED;
    order.error = lastError?.message ?? 'Unknown error';
    this.orders.set(order.id, order);

    logger.error('Sell order failed', {
      orderId: order.id,
      positionId: position.id,
      error: order.error,
    });

    this.emit('orderFailed', order, order.error);
    return { order, success: false };
  }

  // ===========================================================================
  // STOP-LOSS / TAKE-PROFIT HANDLERS
  // ===========================================================================

  /**
   * Handles stop-loss trigger
   */
  private async handleStopLoss(position: Position): Promise<void> {
    logger.warn('Executing stop-loss', {
      positionId: position.id,
      currentPrice: position.currentPrice,
      stopLossPrice: position.stopLossPrice,
    });

    await this.executeSell(position, ExitReason.STOP_LOSS, 100);
  }

  /**
   * Handles take-profit trigger
   */
  private async handleTakeProfit(
    position: Position,
    level: { multiplier: number; sellPercent: number }
  ): Promise<void> {
    logger.info('Executing take-profit', {
      positionId: position.id,
      multiplier: level.multiplier,
      sellPercent: level.sellPercent,
    });

    await this.executeSell(position, ExitReason.TAKE_PROFIT, level.sellPercent);
  }

  // ===========================================================================
  // TRANSACTION EXECUTION
  // ===========================================================================

  /**
   * Executes transaction via Jito
   */
  private async executeViaJito(swapTx: string): Promise<ExecutionResult> {
    const bundleResult = await jitoClient.submitTransactionAndConfirm(
      swapTx,
      this.config.confirmationTimeoutMs
    );

    return {
      success: bundleResult.landed,
      signature: bundleResult.signatures[0],
      slot: bundleResult.slot,
      retries: 0,
      error: bundleResult.error,
    };
  }

  /**
   * Executes transaction via regular RPC
   */
  private async executeViaRpc(swapTx: string): Promise<ExecutionResult> {
    const rpc = getRpc();
    const rpcSubscriptions = getRpcSubscriptions();

    try {
      // Decode and send (cast to expected type)
      const signature = await rpc.sendTransaction(
        swapTx as Parameters<typeof rpc.sendTransaction>[0],
        {
          encoding: 'base64',
          skipPreflight: false,
          maxRetries: BigInt(0), // We handle retries ourselves
        }
      ).send();

      // Wait for confirmation
      const startTime = Date.now();
      while (Date.now() - startTime < this.config.confirmationTimeoutMs) {
        const status = await rpc.getSignatureStatuses([signature]).send();
        const result = status.value?.[0];

        if (result) {
          if (result.err) {
            return {
              success: false,
              signature,
              error: JSON.stringify(result.err),
              retries: 0,
            };
          }

          if (result.confirmationStatus === 'confirmed' || result.confirmationStatus === 'finalized') {
            return {
              success: true,
              signature,
              slot: result.slot ? Number(result.slot) : undefined,
              confirmationTimeMs: Date.now() - startTime,
              retries: 0,
            };
          }
        }

        await new Promise(r => setTimeout(r, 2000));
      }

      return {
        success: false,
        signature,
        error: 'Confirmation timeout',
        retries: 0,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        retries: 0,
      };
    }
  }

  // ===========================================================================
  // ORDER MANAGEMENT
  // ===========================================================================

  /**
   * Creates a new order
   */
  private createOrder(params: {
    mintAddress: SolanaAddress;
    side: OrderSide;
    amount: bigint;
    slippageBps: number;
    walletAddress: Address;
    positionId?: string;
    exitReason?: ExitReason;
  }): Order {
    const id = this.generateOrderId();

    return {
      id,
      mintAddress: params.mintAddress,
      side: params.side,
      amount: params.amount,
      slippageBps: params.slippageBps,
      priorityFeeMicroLamports: this.config.basePriorityFeeMicroLamports,
      status: OrderStatus.PENDING,
      walletAddress: params.walletAddress,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      positionId: params.positionId,
      exitReason: params.exitReason,
    };
  }

  private generateOrderId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `ord_${timestamp}_${random}`;
  }

  /**
   * Gets an order by ID
   */
  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Gets all orders
   */
  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  // ===========================================================================
  // STATUS
  // ===========================================================================

  /**
   * Gets executor status
   */
  getStatus(): {
    initialized: boolean;
    paperTrading: boolean;
    totalOrders: number;
    pendingOrders: number;
    positions: ReturnType<typeof positionManager.getSummary>;
  } {
    const orders = this.getAllOrders();
    const pendingOrders = orders.filter(
      o => o.status === OrderStatus.PENDING || o.status === OrderStatus.SUBMITTED
    ).length;

    return {
      initialized: this.isInitialized,
      paperTrading: this.config.paperTrading,
      totalOrders: orders.length,
      pendingOrders,
      positions: positionManager.getSummary(),
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const tradeExecutor = new TradeExecutor();

// Convenience exports
export const initializeExecutor = () => tradeExecutor.initialize();
export const shutdownExecutor = () => tradeExecutor.shutdown();
export const executeBuy = (signal: GeneratedSignal, size?: number) =>
  tradeExecutor.executeBuy(signal, size);
export const executeSell = (
  position: Position,
  reason: ExitReason,
  percent?: number,
  slippage?: number
) => tradeExecutor.executeSell(position, reason, percent, slippage);
