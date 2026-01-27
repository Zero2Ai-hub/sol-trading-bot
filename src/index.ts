/**
 * Solana Momentum Trading Bot
 *
 * Main entry point for the trading bot application.
 *
 * This bot detects momentum in newly launched tokens on Pump.fun
 * BEFORE they migrate to Raydium/PumpSwap, entering positions at
 * 70-95% bonding curve completion and exiting during migration pumps.
 */

import { getConfig, getLoggableConfig } from './config/index.js';
import {
  initializeLogger,
  logger,
} from './infrastructure/logger/index.js';
import { initializeDatabase, closeDatabase } from './infrastructure/database/index.js';
import { initializeRPC, stopRPC, rpcManager } from './infrastructure/rpc/index.js';
import { initializeWallet, walletManager } from './infrastructure/wallet/index.js';
import { initializeKillSwitch, registerKillSwitchCallback } from './core/kill-switch.js';
import { initializeRateLimiter } from './infrastructure/rate-limiter/index.js';
import {
  initializePumpFunMonitor,
  startPumpFunMonitor,
  stopPumpFunMonitor,
  getPumpFunEventEmitter,
  getPumpFunMonitorStats,
} from './monitors/pump-fun/index.js';
import { formatSol, shortenAddress } from './utils/formatting.js';
import type { BotStatus } from './core/types.js';

// =============================================================================
// BOT STATE
// =============================================================================

let botStatus: BotStatus = 'stopped';

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initializes all bot components in the correct order.
 */
async function initializeBot(): Promise<void> {
  botStatus = 'starting';
  console.log('\n🚀 Starting Solana Momentum Trading Bot...\n');

  try {
    // 1. Initialize logger first (other components need it)
    initializeLogger();
    logger.info('═══════════════════════════════════════════════════');
    logger.info('        SOLANA MOMENTUM TRADING BOT STARTING');
    logger.info('═══════════════════════════════════════════════════');

    // 2. Load and validate configuration
    const config = getConfig();
    logger.info('Configuration loaded', getLoggableConfig());

    // 3. Initialize kill switch
    initializeKillSwitch();
    logger.info('Kill switch initialized');

    // Register kill switch callbacks
    registerKillSwitchCallback({
      name: 'log-shutdown',
      priority: 100,
      callback: async (state) => {
        logger.error('KILL SWITCH ACTIVATED - Shutting down', {
          reason: state.reason,
          triggeredBy: state.triggeredBy,
        });
      },
    });

    registerKillSwitchCallback({
      name: 'stop-monitor',
      priority: 90,
      callback: async () => {
        await stopPumpFunMonitor();
      },
    });

    // 4. Initialize rate limiter
    initializeRateLimiter();
    logger.info('Rate limiter initialized');

    // 5. Initialize RPC connection
    await initializeRPC();
    const activeEndpoint = rpcManager.getActiveEndpoint();
    logger.info('RPC connection established', {
      endpoint: activeEndpoint?.name,
      latency: activeEndpoint?.lastLatencyMs,
    });

    // 6. Initialize wallet
    await initializeWallet();
    const primaryAddress = walletManager.getPrimaryAddress();
    const balance = await walletManager.getBalance();
    logger.info('Wallet initialized', {
      address: shortenAddress(primaryAddress),
      balance: formatSol(balance.lamports),
    });

    // 7. Initialize database (skip if URL not configured for now)
    if (process.env.DATABASE_URL) {
      try {
        await initializeDatabase();
        logger.info('Database connection established');
      } catch (dbError) {
        logger.warn('Database initialization skipped (not configured or unavailable)', {
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }
    } else {
      logger.warn('Database not configured - skipping initialization');
    }

    // 8. Initialize Pump.fun monitor
    await initializePumpFunMonitor();
    logger.info('Pump.fun monitor initialized');

    // 9. Log final status
    botStatus = 'running';
    logger.info('═══════════════════════════════════════════════════');
    logger.info('               BOT INITIALIZED SUCCESSFULLY');
    logger.info('═══════════════════════════════════════════════════');

    // Log trading mode warning
    if (config.features.paperTrading) {
      logger.warn('📝 PAPER TRADING MODE - No real transactions will be executed');
    } else {
      logger.warn('💰 LIVE TRADING MODE - Real transactions will be executed');
    }

    // Log key settings
    logger.info('Trading Configuration:', {
      maxPositionSol: config.risk.maxPositionSizeSol,
      maxConcurrentPositions: config.risk.maxConcurrentPositions,
      dailyLossLimit: `${config.risk.dailyLossLimitPercent}%`,
      bondingCurveRange: `${config.env.BONDING_CURVE_MIN_PERCENT}-${config.env.BONDING_CURVE_MAX_PERCENT}%`,
      useJito: config.features.useJito,
    });

  } catch (error) {
    botStatus = 'error';
    logger.error('Failed to initialize bot', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Starts the data streaming and monitoring services.
 */
async function startStreaming(): Promise<void> {
  logger.info('Starting data streaming services...');

  try {
    // Set up event handlers
    const eventEmitter = getPumpFunEventEmitter();

    // Token launch handler
    eventEmitter.on('token:launched', (event) => {
      logger.info('🚀 NEW TOKEN LAUNCHED', {
        mint: shortenAddress(event.mintAddress),
        name: event.name,
        symbol: event.symbol,
        creator: shortenAddress(event.creator),
      });
    });

    // Bonding progress handler
    eventEmitter.on('bonding:progress', (event) => {
      if (event.inEntryZone) {
        logger.info('🎯 TOKEN IN ENTRY ZONE', {
          mint: shortenAddress(event.mintAddress),
          progress: `${event.progressPercent.toFixed(2)}%`,
          inEntryZone: event.inEntryZone,
        });
      }
    });

    // Migration handler (CRITICAL - exit signal)
    eventEmitter.on('token:migration', (event) => {
      logger.warn('🎓 TOKEN MIGRATION DETECTED', {
        mint: shortenAddress(event.mintAddress),
        finalProgress: `${event.finalProgressPercent.toFixed(2)}%`,
        signature: event.signature,
      });
    });

    // Stream status handlers
    eventEmitter.on('stream:connected', (event) => {
      logger.info('Stream connected', {
        type: event.streamType,
        reconnectAttempt: event.reconnectAttempt,
      });
    });

    eventEmitter.on('stream:disconnected', (event) => {
      logger.warn('Stream disconnected', {
        type: event.streamType,
        reason: event.reason,
        willReconnect: event.willReconnect,
      });
    });

    eventEmitter.on('stream:error', (event) => {
      logger.error('Stream error', {
        type: event.streamType,
        error: event.error,
      });
    });

    // Start the monitor
    await startPumpFunMonitor();

    logger.info('Data streaming services started');
    logger.info('Listening for Pump.fun events...');

  } catch (error) {
    logger.error('Failed to start streaming services', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Gracefully shuts down the bot.
 */
async function shutdownBot(signal?: string): Promise<void> {
  if (botStatus === 'stopping' || botStatus === 'stopped') {
    return;
  }

  botStatus = 'stopping';
  logger.info(`Shutting down bot${signal ? ` (signal: ${signal})` : ''}...`);

  try {
    // Log final stats
    const monitorStats = getPumpFunMonitorStats();
    logger.info('Final monitor statistics', {
      tokensLaunched: monitorStats.tokensLaunched,
      tradesProcessed: monitorStats.tradesProcessed,
      migrationsDetected: monitorStats.migrationsDetected,
      uptime: `${(monitorStats.uptime / 1000 / 60).toFixed(2)} minutes`,
    });

    // Stop Pump.fun monitor
    await stopPumpFunMonitor();

    // Stop RPC connections
    stopRPC();

    // Close database
    await closeDatabase();

    botStatus = 'stopped';
    logger.info('Bot shutdown complete');

  } catch (error) {
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// =============================================================================
// SIGNAL HANDLERS
// =============================================================================

process.on('SIGINT', async () => {
  await shutdownBot('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdownBot('SIGTERM');
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  await shutdownBot('uncaughtException');
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  try {
    await initializeBot();
    await startStreaming();

    logger.info('═══════════════════════════════════════════════════');
    logger.info('          BOT IS NOW MONITORING PUMP.FUN');
    logger.info('═══════════════════════════════════════════════════');
    logger.info('Press Ctrl+C to stop.');

    // Keep process alive
    await new Promise(() => {});

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
main();

// Export for testing
export { initializeBot, shutdownBot, startStreaming, botStatus };
