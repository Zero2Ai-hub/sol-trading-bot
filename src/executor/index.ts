/**
 * Trade Executor Module
 *
 * Phase 5 implementation for executing trades on Solana.
 * Components:
 * - Jupiter Client: Swap routing and transaction building
 * - Jito Client: MEV-protected bundle submission
 * - Position Manager: Position lifecycle and P&L tracking
 * - Risk Manager: Trade validation and loss limits
 * - Trade Executor: Main orchestrator
 *
 * Architecture:
 * ```
 * Signal → Risk Check → Jupiter Quote → Jito Bundle → Position
 *              │              │              │           │
 *              └── Validate ──┴── Build ─────┴── Execute ┴── Track
 * ```
 */

// =============================================================================
// TYPES
// =============================================================================

export * from './types.js';

// =============================================================================
// JUPITER CLIENT
// =============================================================================

export {
  JupiterClient,
  jupiterClient,
  getJupiterQuote,
  getBuyQuote,
  getSellQuote,
  getTokenPrice,
} from './jupiter.js';

// =============================================================================
// JITO CLIENT
// =============================================================================

export {
  JitoClient,
  jitoClient,
  submitJitoBundle,
  submitJitoTransaction,
  waitForJitoBundle,
  isJitoAvailable,
} from './jito.js';

// =============================================================================
// POSITION MANAGER
// =============================================================================

export {
  PositionManager,
  positionManager,
  startPositionManager,
  stopPositionManager,
  getOpenPositions,
  getPositionSummary,
  type PositionManagerEvents,
} from './positions.js';

// =============================================================================
// RISK MANAGER
// =============================================================================

export {
  RiskManager,
  riskManager,
  canExecuteBuy,
  canExecuteSell,
  isTradingAllowed,
  pauseTrading,
  resumeTrading,
  getDailyPnL,
  getRiskStatus,
  type RiskManagerEvents,
} from './risk.js';

// =============================================================================
// TRADE EXECUTOR
// =============================================================================

export {
  TradeExecutor,
  tradeExecutor,
  initializeExecutor,
  shutdownExecutor,
  executeBuy,
  executeSell,
  type ExecutorEvents,
} from './executor.js';

// =============================================================================
// CONVENIENCE INITIALIZATION
// =============================================================================

import { tradeExecutor } from './executor.js';
import { positionManager } from './positions.js';
import { riskManager } from './risk.js';
import { getComponentLogger } from '../infrastructure/logger/index.js';

const logger = getComponentLogger('Executor');

/**
 * Initializes the entire executor subsystem
 */
export async function initializeExecutorSubsystem(): Promise<void> {
  logger.info('Initializing executor subsystem');

  // Initialize risk manager starting capital
  await riskManager.updateStartingCapital();

  // Initialize trade executor (starts position manager)
  await tradeExecutor.initialize();

  logger.info('Executor subsystem initialized');
}

/**
 * Shuts down the executor subsystem
 */
export async function shutdownExecutorSubsystem(): Promise<void> {
  logger.info('Shutting down executor subsystem');

  await tradeExecutor.shutdown();

  logger.info('Executor subsystem shut down');
}

/**
 * Gets combined executor status
 */
export function getExecutorStatus(): {
  executor: ReturnType<typeof tradeExecutor.getStatus>;
  risk: ReturnType<typeof riskManager.getRiskStatus>;
} {
  return {
    executor: tradeExecutor.getStatus(),
    risk: riskManager.getRiskStatus(),
  };
}
