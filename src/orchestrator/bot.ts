/**
 * Main Bot Orchestrator
 *
 * Central controller that wires all components together,
 * manages lifecycle, and coordinates the trading bot.
 */

import { EventEmitter } from 'events';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { db, initializeDatabase, closeDatabase } from '../infrastructure/database/index.js';
import { getEnvConfig } from '../config/env.js';
import { healthMonitor, HealthMonitor } from './health.js';
import {
  type BotState,
  type BotConfig,
  type BotEvents,
  type DashboardData,
  type StartupResult,
  type ShutdownResult,
  BotStatus,
  HealthStatus,
  StartupPhase,
  ShutdownReason,
  DEFAULT_BOT_CONFIG,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const logger = getComponentLogger('Bot');

// =============================================================================
// BOT ORCHESTRATOR CLASS
// =============================================================================

/**
 * Main Bot Orchestrator
 *
 * Coordinates all trading bot components and manages lifecycle.
 */
export class TradingBot extends EventEmitter {
  private config: BotConfig;
  private state: BotState;
  private healthMonitor: HealthMonitor;
  private isInitialized: boolean = false;

  // Intervals
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private statePersistInterval: NodeJS.Timeout | null = null;
  private dashboardInterval: NodeJS.Timeout | null = null;

  // Shutdown handling
  private shutdownPromise: Promise<ShutdownResult> | null = null;

  constructor(config: Partial<BotConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BOT_CONFIG, ...config };
    this.healthMonitor = healthMonitor;

    // Initialize state
    this.state = this.createInitialState();

    // Setup process signal handlers
    this.setupSignalHandlers();
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Creates initial bot state
   */
  private createInitialState(): BotState {
    return {
      status: BotStatus.STOPPED,
      startTime: 0,
      uptimeMs: 0,
      trackedTokensCount: 0,
      openPositionsCount: 0,
      signalsGeneratedToday: 0,
      tradesExecutedToday: 0,
      dailyPnlSol: 0,
      dailyPnlPercent: 0,
      capitalDeployedSol: 0,
      capitalAvailableSol: 0,
      totalCapitalSol: 0,
      lastTradeTime: null,
      errorsToday: 0,
      paperTradingEnabled: this.config.paperTradingEnabled,
      services: {
        rpc: { name: 'rpc', status: HealthStatus.UNKNOWN, lastCheck: 0, consecutiveFailures: 0 },
        grpc: { name: 'grpc', status: HealthStatus.UNKNOWN, lastCheck: 0, consecutiveFailures: 0 },
        database: { name: 'database', status: HealthStatus.UNKNOWN, lastCheck: 0, consecutiveFailures: 0 },
        pumpMonitor: { name: 'pumpMonitor', status: HealthStatus.UNKNOWN, lastCheck: 0, consecutiveFailures: 0 },
        momentumEngine: { name: 'momentumEngine', status: HealthStatus.UNKNOWN, lastCheck: 0, consecutiveFailures: 0 },
        tradeExecutor: { name: 'tradeExecutor', status: HealthStatus.UNKNOWN, lastCheck: 0, consecutiveFailures: 0 },
      },
    };
  }

  /**
   * Starts the bot
   */
  async start(): Promise<StartupResult> {
    const startTime = Date.now();

    if (this.isInitialized) {
      return {
        success: false,
        phase: StartupPhase.CONFIG,
        error: new Error('Bot already initialized'),
        durationMs: 0,
      };
    }

    this.updateStatus(BotStatus.INITIALIZING);
    logger.info('Starting trading bot...');

    try {
      // Phase 1: Load configuration
      logger.info('Phase 1: Loading configuration...');
      const env = getEnvConfig();
      this.config.paperTradingEnabled = env.ENABLE_PAPER_TRADING;

      // Phase 2: Initialize database
      logger.info('Phase 2: Initializing database...');
      await initializeDatabase();

      // Phase 3: Register health checks
      logger.info('Phase 3: Registering health checks...');
      this.healthMonitor.registerDefaultChecks();

      // Phase 4: Start health monitoring
      logger.info('Phase 4: Starting health monitoring...');
      this.healthMonitor.start();
      this.setupHealthListeners();

      // Phase 5: Load persisted state
      logger.info('Phase 5: Loading persisted state...');
      await this.loadPersistedState();

      // Update state
      this.state.startTime = Date.now();
      this.state.paperTradingEnabled = this.config.paperTradingEnabled;
      this.isInitialized = true;

      // Start periodic tasks
      this.startPeriodicTasks();

      // Update status to running
      this.updateStatus(BotStatus.RUNNING);

      const result: StartupResult = {
        success: true,
        phase: StartupPhase.COMPLETE,
        durationMs: Date.now() - startTime,
      };

      logger.info('Bot started successfully', {
        durationMs: result.durationMs,
        paperTrading: this.config.paperTradingEnabled,
      });

      return result;
    } catch (error) {
      this.updateStatus(BotStatus.ERROR);

      const result: StartupResult = {
        success: false,
        phase: StartupPhase.CONFIG,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
      };

      logger.error('Bot startup failed', { error: result.error?.message });
      return result;
    }
  }

  /**
   * Stops the bot gracefully
   */
  async stop(reason: ShutdownReason = ShutdownReason.USER_REQUEST): Promise<ShutdownResult> {
    // If already shutting down, return existing promise
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown(reason);
    return this.shutdownPromise;
  }

  /**
   * Performs the actual shutdown
   */
  private async performShutdown(reason: ShutdownReason): Promise<ShutdownResult> {
    const startTime = Date.now();

    if (this.state.status === BotStatus.STOPPED) {
      return {
        success: true,
        reason,
        positionsClosed: 0,
        durationMs: 0,
      };
    }

    this.updateStatus(BotStatus.SHUTTING_DOWN);
    this.emit('shutdown:initiated', reason);
    logger.info('Shutting down bot...', { reason });

    try {
      // Stop periodic tasks
      this.stopPeriodicTasks();

      // Stop accepting new signals
      this.config.tradingPaused = true;

      // Close open positions (in production, would close actual positions)
      const positionsClosed = await this.closeAllPositions();

      // Stop health monitoring
      this.healthMonitor.stop();

      // Persist final state
      await this.persistState();

      // Close database connection
      await closeDatabase();

      // Update status
      this.updateStatus(BotStatus.STOPPED);
      this.isInitialized = false;

      const result: ShutdownResult = {
        success: true,
        reason,
        positionsClosed,
        durationMs: Date.now() - startTime,
      };

      this.emit('shutdown:complete');
      logger.info('Bot shutdown complete', { durationMs: result.durationMs, positionsClosed });

      return result;
    } catch (error) {
      const result: ShutdownResult = {
        success: false,
        reason,
        positionsClosed: 0,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
      };

      logger.error('Bot shutdown failed', { error: result.error?.message });
      return result;
    }
  }

  // ===========================================================================
  // STATE MANAGEMENT
  // ===========================================================================

  /**
   * Updates bot status
   */
  private updateStatus(newStatus: BotStatus): void {
    const oldStatus = this.state.status;
    if (oldStatus !== newStatus) {
      this.state.status = newStatus;
      this.emit('status:changed', oldStatus, newStatus);
      logger.info('Bot status changed', { from: oldStatus, to: newStatus });
    }
  }

  /**
   * Gets current bot state
   */
  getState(): BotState {
    // Update uptime
    if (this.state.startTime > 0) {
      this.state.uptimeMs = Date.now() - this.state.startTime;
    }

    // Update service health
    this.state.services = this.healthMonitor.getAllHealth();

    return { ...this.state };
  }

  /**
   * Gets current configuration
   */
  getConfig(): BotConfig {
    return { ...this.config };
  }

  /**
   * Updates configuration at runtime
   */
  updateConfig(updates: Partial<BotConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('Bot configuration updated', { updates: Object.keys(updates) });
  }

  // ===========================================================================
  // TRADING CONTROL
  // ===========================================================================

  /**
   * Pauses trading (keeps monitoring)
   */
  pauseTrading(): void {
    this.config.tradingPaused = true;
    this.updateStatus(BotStatus.PAUSED);
    logger.info('Trading paused');
  }

  /**
   * Resumes trading
   */
  resumeTrading(): void {
    if (this.state.status === BotStatus.PAUSED) {
      this.config.tradingPaused = false;
      this.updateStatus(BotStatus.RUNNING);
      logger.info('Trading resumed');
    }
  }

  /**
   * Checks if trading is allowed
   */
  canTrade(): boolean {
    return (
      this.state.status === BotStatus.RUNNING &&
      !this.config.tradingPaused &&
      !this.config.dryRunEnabled &&
      this.healthMonitor.isAllHealthy()
    );
  }

  // ===========================================================================
  // TOKEN TRACKING
  // ===========================================================================

  /**
   * Handles new token detection
   */
  onTokenDetected(mintAddress: string, symbol: string): void {
    if (this.config.tokenBlacklist.has(mintAddress)) {
      logger.debug('Ignoring blacklisted token', { mintAddress, symbol });
      return;
    }

    if (this.state.trackedTokensCount >= this.config.maxTrackedTokens) {
      logger.debug('Max tracked tokens reached', { current: this.state.trackedTokensCount });
      return;
    }

    this.state.trackedTokensCount++;
    this.emit('token:detected', mintAddress, symbol);
    logger.debug('Token detected', { mintAddress, symbol });
  }

  /**
   * Handles signal generation
   */
  onSignalGenerated(mintAddress: string, signal: string, score: number): void {
    this.state.signalsGeneratedToday++;
    this.emit('signal:generated', mintAddress, signal, score);

    logger.info('Signal generated', { mintAddress, signal, score });
  }

  /**
   * Handles trade execution
   */
  onTradeExecuted(mintAddress: string, side: 'buy' | 'sell', amountSol: number): void {
    this.state.tradesExecutedToday++;
    this.state.lastTradeTime = Date.now();

    if (side === 'buy') {
      this.state.capitalDeployedSol += amountSol;
      this.state.capitalAvailableSol -= amountSol;
      this.state.openPositionsCount++;
    } else {
      this.state.capitalDeployedSol -= amountSol;
      this.state.capitalAvailableSol += amountSol;
    }

    this.emit('trade:executed', mintAddress, side, amountSol);
    logger.info('Trade executed', { mintAddress, side, amountSol });
  }

  /**
   * Handles position close
   */
  onPositionClosed(mintAddress: string, pnlSol: number): void {
    this.state.openPositionsCount = Math.max(0, this.state.openPositionsCount - 1);
    this.state.dailyPnlSol += pnlSol;

    if (this.state.totalCapitalSol > 0) {
      this.state.dailyPnlPercent = (this.state.dailyPnlSol / this.state.totalCapitalSol) * 100;
    }

    this.emit('position:closed', mintAddress, pnlSol);
    logger.info('Position closed', { mintAddress, pnlSol });

    // Check daily loss limit
    if (this.state.dailyPnlPercent <= -this.config.riskLimits.dailyLossLimitPercent) {
      logger.error('Daily loss limit hit', { pnlPercent: this.state.dailyPnlPercent });
      this.stop(ShutdownReason.DAILY_LOSS_LIMIT);
    }
  }

  // ===========================================================================
  // DASHBOARD DATA
  // ===========================================================================

  /**
   * Gets dashboard display data
   */
  getDashboardData(): DashboardData {
    return {
      state: this.getState(),
      topTokens: [], // Will be populated by momentum engine
      positions: [], // Will be populated by position manager
      recentTrades: [], // Will be populated from trade history
      recentErrors: [], // Will be populated from error log
    };
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  /**
   * Loads persisted state from database
   */
  private async loadPersistedState(): Promise<void> {
    try {
      const result = await db.query<{ state_data: BotState }>(
        `SELECT state_data FROM bot_state WHERE id = 1`
      );

      if (result.rows.length > 0 && result.rows[0]) {
        const savedState = result.rows[0].state_data;
        // Restore relevant state (but not status/uptime)
        this.state.dailyPnlSol = savedState.dailyPnlSol ?? 0;
        this.state.dailyPnlPercent = savedState.dailyPnlPercent ?? 0;
        this.state.signalsGeneratedToday = savedState.signalsGeneratedToday ?? 0;
        this.state.tradesExecutedToday = savedState.tradesExecutedToday ?? 0;

        logger.debug('Loaded persisted state');
      }
    } catch (error) {
      // Table might not exist yet, that's OK
      logger.debug('No persisted state found');
    }
  }

  /**
   * Persists current state to database
   */
  private async persistState(): Promise<void> {
    try {
      await db.query(
        `INSERT INTO bot_state (id, state_data, updated_at)
         VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE SET
           state_data = $1,
           updated_at = NOW()`,
        [JSON.stringify(this.state)]
      );
      logger.debug('State persisted');
    } catch (error) {
      logger.warn('Failed to persist state', { error });
    }
  }

  /**
   * Closes all open positions
   */
  private async closeAllPositions(): Promise<number> {
    // In production, this would close actual positions
    const positionsClosed = this.state.openPositionsCount;
    this.state.openPositionsCount = 0;
    logger.info('Closed all positions', { count: positionsClosed });
    return positionsClosed;
  }

  // ===========================================================================
  // PERIODIC TASKS
  // ===========================================================================

  /**
   * Starts periodic tasks
   */
  private startPeriodicTasks(): void {
    // State persistence
    this.statePersistInterval = setInterval(() => {
      this.persistState().catch((err) => {
        logger.error('State persistence failed', { error: err });
      });
    }, this.config.statePersistIntervalMs);
  }

  /**
   * Stops periodic tasks
   */
  private stopPeriodicTasks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.statePersistInterval) {
      clearInterval(this.statePersistInterval);
      this.statePersistInterval = null;
    }
    if (this.dashboardInterval) {
      clearInterval(this.dashboardInterval);
      this.dashboardInterval = null;
    }
  }

  // ===========================================================================
  // EVENT LISTENERS
  // ===========================================================================

  /**
   * Sets up health monitoring listeners
   */
  private setupHealthListeners(): void {
    this.healthMonitor.on('health:critical', (service, health) => {
      this.state.errorsToday++;
      this.emit('error:occurred', new Error(`Service unhealthy: ${service}`), 'health');

      // Check if critical service is down
      const criticalServices = ['database', 'rpc'];
      if (criticalServices.includes(service)) {
        logger.error('Critical service failure', { service });
        this.pauseTrading();
      }
    });

    this.healthMonitor.on('health:recovered', (service) => {
      logger.info('Service recovered', { service });

      // Resume if all critical services are healthy
      if (this.state.status === BotStatus.PAUSED && this.healthMonitor.isAllHealthy()) {
        this.resumeTrading();
      }
    });
  }

  /**
   * Sets up process signal handlers
   */
  private setupSignalHandlers(): void {
    const handleSignal = (signal: string) => {
      logger.info(`Received ${signal}, initiating shutdown...`);
      this.stop(ShutdownReason.SIGNAL).then((result) => {
        process.exit(result.success ? 0 : 1);
      });
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.stop(ShutdownReason.CRITICAL_ERROR).then(() => {
        process.exit(1);
      });
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason });
      this.state.errorsToday++;
    });
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

let botInstance: TradingBot | null = null;

/**
 * Gets or creates the bot instance
 */
export function getBot(config?: Partial<BotConfig>): TradingBot {
  if (!botInstance) {
    botInstance = new TradingBot(config);
  }
  return botInstance;
}

/**
 * Resets the bot instance (for testing)
 */
export function resetBot(): void {
  if (botInstance) {
    botInstance.removeAllListeners();
    botInstance = null;
  }
}

// Convenience exports
export const startBot = async (config?: Partial<BotConfig>) => {
  const bot = getBot(config);
  return bot.start();
};

export const stopBot = async (reason?: ShutdownReason) => {
  if (botInstance) {
    return botInstance.stop(reason);
  }
  return null;
};

export const getBotState = () => {
  if (botInstance) {
    return botInstance.getState();
  }
  return null;
};
