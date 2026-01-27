/**
 * Orchestrator Module
 *
 * Main bot orchestration - wires all components together
 * and manages the trading bot lifecycle.
 *
 * Components:
 * - TradingBot: Central controller
 * - HealthMonitor: Service health tracking
 * - Dashboard: CLI status display
 */

// =============================================================================
// TYPES
// =============================================================================

export * from './types.js';

// =============================================================================
// HEALTH MONITOR
// =============================================================================

export {
  HealthMonitor,
  healthMonitor,
  registerHealthCheck,
  checkAllHealth,
  isServiceHealthy,
  isSystemHealthy,
  type HealthMonitorEvents,
} from './health.js';

// =============================================================================
// BOT ORCHESTRATOR
// =============================================================================

export {
  TradingBot,
  getBot,
  resetBot,
  startBot,
  stopBot,
  getBotState,
} from './bot.js';

// =============================================================================
// DASHBOARD
// =============================================================================

export {
  Dashboard,
  dashboard,
  printBanner,
  printShutdown,
} from './dashboard.js';
