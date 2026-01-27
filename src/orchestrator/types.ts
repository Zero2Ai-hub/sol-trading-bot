/**
 * Orchestrator Types
 *
 * Types for bot state management, health monitoring, and orchestration.
 */

import type { Timestamp } from '../core/types.js';

// =============================================================================
// BOT STATUS
// =============================================================================

/**
 * Bot operational status
 */
export enum BotStatus {
  /** Bot is starting up */
  INITIALIZING = 'INITIALIZING',

  /** Bot is running normally */
  RUNNING = 'RUNNING',

  /** Bot is paused (not trading but monitoring) */
  PAUSED = 'PAUSED',

  /** Bot is shutting down gracefully */
  SHUTTING_DOWN = 'SHUTTING_DOWN',

  /** Bot encountered a critical error */
  ERROR = 'ERROR',

  /** Bot is stopped */
  STOPPED = 'STOPPED',
}

/**
 * Service health status
 */
export enum HealthStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNHEALTHY = 'UNHEALTHY',
  UNKNOWN = 'UNKNOWN',
}

// =============================================================================
// BOT STATE
// =============================================================================

/**
 * Complete bot state
 */
export interface BotState {
  /** Current bot status */
  status: BotStatus;

  /** Bot start time */
  startTime: Timestamp;

  /** Current uptime in ms */
  uptimeMs: number;

  /** Number of tokens being tracked */
  trackedTokensCount: number;

  /** Number of open positions */
  openPositionsCount: number;

  /** Signals generated today */
  signalsGeneratedToday: number;

  /** Trades executed today */
  tradesExecutedToday: number;

  /** Daily P&L in SOL */
  dailyPnlSol: number;

  /** Daily P&L percentage */
  dailyPnlPercent: number;

  /** Capital currently in positions (SOL) */
  capitalDeployedSol: number;

  /** Capital available for trading (SOL) */
  capitalAvailableSol: number;

  /** Total capital (SOL) */
  totalCapitalSol: number;

  /** Last trade timestamp */
  lastTradeTime: Timestamp | null;

  /** Error count today */
  errorsToday: number;

  /** Whether paper trading is enabled */
  paperTradingEnabled: boolean;

  /** Service health statuses */
  services: ServiceHealthMap;
}

/**
 * Service health status map
 */
export interface ServiceHealthMap {
  rpc: ServiceHealth;
  grpc: ServiceHealth;
  database: ServiceHealth;
  pumpMonitor: ServiceHealth;
  momentumEngine: ServiceHealth;
  tradeExecutor: ServiceHealth;
}

/**
 * Individual service health
 */
export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  lastCheck: Timestamp;
  lastError?: string;
  consecutiveFailures: number;
  latencyMs?: number;
}

// =============================================================================
// BOT CONFIGURATION
// =============================================================================

/**
 * Runtime bot configuration
 */
export interface BotConfig {
  /** Enable paper trading mode */
  paperTradingEnabled: boolean;

  /** Enable dry run mode (signals only, no execution) */
  dryRunEnabled: boolean;

  /** Pause trading (still monitor) */
  tradingPaused: boolean;

  /** Maximum tokens to track simultaneously */
  maxTrackedTokens: number;

  /** Health check interval (ms) */
  healthCheckIntervalMs: number;

  /** State persistence interval (ms) */
  statePersistIntervalMs: number;

  /** Dashboard refresh interval (ms) */
  dashboardRefreshMs: number;

  /** Graceful shutdown timeout (ms) */
  shutdownTimeoutMs: number;

  /** Token blacklist (mint addresses) */
  tokenBlacklist: Set<string>;

  /** Momentum thresholds (can be updated at runtime) */
  thresholds: {
    buy: number;
    strongBuy: number;
    sell: number;
  };

  /** Risk limits */
  riskLimits: {
    maxPositionSizeSol: number;
    maxConcurrentPositions: number;
    dailyLossLimitPercent: number;
    maxSlippagePercent: number;
  };
}

/**
 * Default bot configuration
 */
export const DEFAULT_BOT_CONFIG: BotConfig = {
  paperTradingEnabled: true,
  dryRunEnabled: false,
  tradingPaused: false,
  maxTrackedTokens: 100,
  healthCheckIntervalMs: 30_000,
  statePersistIntervalMs: 60_000,
  dashboardRefreshMs: 5_000,
  shutdownTimeoutMs: 30_000,
  tokenBlacklist: new Set(),
  thresholds: {
    buy: 75,
    strongBuy: 85,
    sell: 50,
  },
  riskLimits: {
    maxPositionSizeSol: 0.5,
    maxConcurrentPositions: 3,
    dailyLossLimitPercent: 10,
    maxSlippagePercent: 5,
  },
};

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Bot lifecycle events
 */
export interface BotEvents {
  /** Bot status changed */
  'status:changed': (oldStatus: BotStatus, newStatus: BotStatus) => void;

  /** Service health changed */
  'health:changed': (service: string, health: ServiceHealth) => void;

  /** New token detected */
  'token:detected': (mintAddress: string, symbol: string) => void;

  /** Signal generated */
  'signal:generated': (mintAddress: string, signal: string, score: number) => void;

  /** Trade executed */
  'trade:executed': (mintAddress: string, side: 'buy' | 'sell', amountSol: number) => void;

  /** Position opened */
  'position:opened': (mintAddress: string, sizeSol: number) => void;

  /** Position closed */
  'position:closed': (mintAddress: string, pnlSol: number) => void;

  /** Error occurred */
  'error:occurred': (error: Error, context: string) => void;

  /** Daily stats updated */
  'stats:updated': (state: BotState) => void;

  /** Shutdown initiated */
  'shutdown:initiated': (reason: string) => void;

  /** Shutdown complete */
  'shutdown:complete': () => void;
}

// =============================================================================
// STARTUP/SHUTDOWN
// =============================================================================

/**
 * Startup phase
 */
export enum StartupPhase {
  CONFIG = 'CONFIG',
  WALLETS = 'WALLETS',
  DATABASE = 'DATABASE',
  RPC = 'RPC',
  GRPC = 'GRPC',
  ANALYZERS = 'ANALYZERS',
  ENGINE = 'ENGINE',
  EXECUTOR = 'EXECUTOR',
  MONITOR = 'MONITOR',
  COMPLETE = 'COMPLETE',
}

/**
 * Shutdown reason
 */
export enum ShutdownReason {
  USER_REQUEST = 'USER_REQUEST',
  SIGNAL = 'SIGNAL',
  CRITICAL_ERROR = 'CRITICAL_ERROR',
  DAILY_LOSS_LIMIT = 'DAILY_LOSS_LIMIT',
  SERVICE_FAILURE = 'SERVICE_FAILURE',
  MAINTENANCE = 'MAINTENANCE',
}

/**
 * Startup result
 */
export interface StartupResult {
  success: boolean;
  phase: StartupPhase;
  error?: Error;
  durationMs: number;
}

/**
 * Shutdown result
 */
export interface ShutdownResult {
  success: boolean;
  reason: ShutdownReason;
  positionsClosed: number;
  error?: Error;
  durationMs: number;
}

// =============================================================================
// DASHBOARD DATA
// =============================================================================

/**
 * Dashboard display data
 */
export interface DashboardData {
  /** Bot state */
  state: BotState;

  /** Top momentum tokens */
  topTokens: Array<{
    symbol: string;
    mintAddress: string;
    score: number;
    signal: string;
  }>;

  /** Open positions */
  positions: Array<{
    symbol: string;
    mintAddress: string;
    entryPrice: number;
    currentPrice: number;
    sizeSol: number;
    pnlPercent: number;
    holdingTimeMs: number;
  }>;

  /** Recent trades */
  recentTrades: Array<{
    timestamp: Timestamp;
    symbol: string;
    side: 'buy' | 'sell';
    amountSol: number;
    pnlSol?: number;
  }>;

  /** Recent errors */
  recentErrors: Array<{
    timestamp: Timestamp;
    message: string;
    context: string;
  }>;
}

// =============================================================================
// ALERTS
// =============================================================================

/**
 * Alert severity
 */
export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

/**
 * Alert message
 */
export interface Alert {
  timestamp: Timestamp;
  severity: AlertSeverity;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  /** Enable Telegram alerts */
  telegramEnabled: boolean;

  /** Telegram bot token */
  telegramBotToken?: string;

  /** Telegram chat ID */
  telegramChatId?: string;

  /** Minimum severity to alert */
  minSeverity: AlertSeverity;

  /** Alert on trade execution */
  alertOnTrade: boolean;

  /** Alert on position close */
  alertOnPositionClose: boolean;

  /** Send daily summary */
  sendDailySummary: boolean;
}
