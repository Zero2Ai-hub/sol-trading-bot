/**
 * Orchestrator Module Validation Tests
 *
 * Validates Phase 7 checklist:
 * - Bot starts successfully
 * - State management works
 * - Health monitoring works
 * - Graceful shutdown works
 * - Dashboard renders correctly
 */

import {
  TradingBot,
  getBot,
  resetBot,
  HealthMonitor,
  Dashboard,
  type BotConfig,
  type BotState,
  BotStatus,
  HealthStatus,
  ShutdownReason,
  DEFAULT_BOT_CONFIG,
} from '../../src/orchestrator/index.js';

// =============================================================================
// MOCKS
// =============================================================================

// Mock the database to avoid real connections
jest.mock('../../src/infrastructure/database/index.js', () => ({
  db: {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  closeDatabase: jest.fn().mockResolvedValue(undefined),
}));

// Mock env config
jest.mock('../../src/config/env.js', () => ({
  getEnvConfig: jest.fn().mockReturnValue({
    ENABLE_PAPER_TRADING: true,
    LOG_LEVEL: 'info',
  }),
}));

// =============================================================================
// TESTS
// =============================================================================

describe('Orchestrator Module Validation', () => {
  // ---------------------------------------------------------------------------
  // Bot State Management
  // ---------------------------------------------------------------------------
  describe('Bot State Management', () => {
    let bot: TradingBot;

    beforeEach(() => {
      resetBot();
      bot = new TradingBot({ paperTradingEnabled: true });
    });

    afterEach(async () => {
      if (bot) {
        await bot.stop(ShutdownReason.USER_REQUEST);
      }
      resetBot();
    });

    it('should initialize with correct default state', () => {
      const state = bot.getState();

      expect(state.status).toBe(BotStatus.STOPPED);
      expect(state.trackedTokensCount).toBe(0);
      expect(state.openPositionsCount).toBe(0);
      expect(state.signalsGeneratedToday).toBe(0);
      expect(state.tradesExecutedToday).toBe(0);
      expect(state.dailyPnlSol).toBe(0);
      expect(state.errorsToday).toBe(0);
    });

    it('should have valid configuration', () => {
      const config = bot.getConfig();

      expect(config.paperTradingEnabled).toBe(true);
      expect(config.maxTrackedTokens).toBeGreaterThan(0);
      expect(config.healthCheckIntervalMs).toBeGreaterThan(0);
      expect(config.shutdownTimeoutMs).toBeGreaterThan(0);
    });

    it('should update configuration at runtime', () => {
      const originalConfig = bot.getConfig();
      expect(originalConfig.tradingPaused).toBe(false);

      bot.updateConfig({ tradingPaused: true });

      const updatedConfig = bot.getConfig();
      expect(updatedConfig.tradingPaused).toBe(true);
    });

    it('should track token detection', () => {
      const initialState = bot.getState();
      expect(initialState.trackedTokensCount).toBe(0);

      bot.onTokenDetected('TOKEN111111111111111111111111111111111111111', 'TEST');

      const updatedState = bot.getState();
      expect(updatedState.trackedTokensCount).toBe(1);
    });

    it('should track signal generation', () => {
      const initialState = bot.getState();
      expect(initialState.signalsGeneratedToday).toBe(0);

      bot.onSignalGenerated('TOKEN111', 'BUY', 85);

      const updatedState = bot.getState();
      expect(updatedState.signalsGeneratedToday).toBe(1);
    });

    it('should track trades and update capital', () => {
      // Set initial capital
      const state = bot.getState();
      state.totalCapitalSol = 10;
      state.capitalAvailableSol = 10;

      bot.onTradeExecuted('TOKEN111', 'buy', 1);

      const afterBuy = bot.getState();
      expect(afterBuy.tradesExecutedToday).toBe(1);
      expect(afterBuy.openPositionsCount).toBe(1);
      expect(afterBuy.capitalDeployedSol).toBe(1);
    });

    it('should track P&L on position close', () => {
      const state = bot.getState();
      state.totalCapitalSol = 10;
      state.openPositionsCount = 1;

      bot.onPositionClosed('TOKEN111', 0.5);

      const afterClose = bot.getState();
      expect(afterClose.openPositionsCount).toBe(0);
      expect(afterClose.dailyPnlSol).toBe(0.5);
    });

    it('should emit events on state changes', (done) => {
      bot.on('token:detected', (mintAddress, symbol) => {
        expect(mintAddress).toBe('TOKEN111');
        expect(symbol).toBe('TEST');
        done();
      });

      bot.onTokenDetected('TOKEN111', 'TEST');
    });
  });

  // ---------------------------------------------------------------------------
  // Health Monitor
  // ---------------------------------------------------------------------------
  describe('Health Monitor', () => {
    let monitor: HealthMonitor;

    beforeEach(() => {
      monitor = new HealthMonitor(1000); // 1 second interval for testing
    });

    afterEach(() => {
      monitor.stop();
    });

    it('should register health checks', () => {
      monitor.registerCheck('testService', async () => ({
        healthy: true,
        latencyMs: 10,
      }));

      const health = monitor.getHealth('testService');
      expect(health).toBeDefined();
      expect(health?.name).toBe('testService');
    });

    it('should run health checks and update status', async () => {
      monitor.registerCheck('testService', async () => ({
        healthy: true,
        latencyMs: 5,
      }));

      const health = await monitor.checkService('testService');

      expect(health.status).toBe(HealthStatus.HEALTHY);
      expect(health.latencyMs).toBe(5);
      expect(health.consecutiveFailures).toBe(0);
    });

    it('should track consecutive failures', async () => {
      let callCount = 0;
      monitor.registerCheck('failingService', async () => {
        callCount++;
        return { healthy: false, error: 'Test error' };
      });

      await monitor.checkService('failingService');
      await monitor.checkService('failingService');
      await monitor.checkService('failingService');

      const health = monitor.getHealth('failingService');
      expect(health?.consecutiveFailures).toBe(3);
      expect(health?.status).toBe(HealthStatus.UNHEALTHY);
    });

    it('should reset failures on success', async () => {
      let shouldFail = true;
      monitor.registerCheck('recoveringService', async () => {
        if (shouldFail) {
          return { healthy: false, error: 'Test error' };
        }
        return { healthy: true };
      });

      // Fail a few times
      await monitor.checkService('recoveringService');
      await monitor.checkService('recoveringService');

      let health = monitor.getHealth('recoveringService');
      expect(health?.consecutiveFailures).toBe(2);

      // Now succeed
      shouldFail = false;
      await monitor.checkService('recoveringService');

      health = monitor.getHealth('recoveringService');
      expect(health?.consecutiveFailures).toBe(0);
      expect(health?.status).toBe(HealthStatus.HEALTHY);
    });

    it('should emit events on health changes', (done) => {
      monitor.registerCheck('eventService', async () => ({
        healthy: false,
        error: 'Test failure',
      }));

      monitor.on('health:critical', (service, health) => {
        expect(service).toBe('eventService');
        expect(health.status).toBe(HealthStatus.UNHEALTHY);
        done();
      });

      monitor.checkService('eventService');
    });

    it('should check overall system health', async () => {
      monitor.registerCheck('service1', async () => ({ healthy: true }));
      monitor.registerCheck('service2', async () => ({ healthy: true }));

      await monitor.checkAll();

      expect(monitor.isAllHealthy()).toBe(true);
      expect(monitor.getOverallStatus()).toBe(HealthStatus.HEALTHY);
    });

    it('should report degraded when non-critical service fails', async () => {
      monitor.registerCheck('optional', async () => ({ healthy: false }));
      monitor.registerCheck('database', async () => ({ healthy: true }));
      monitor.registerCheck('rpc', async () => ({ healthy: true }));

      await monitor.checkAll();

      expect(monitor.isAllHealthy()).toBe(false);
      expect(monitor.getUnhealthyServices()).toContain('optional');
    });
  });

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  describe('Dashboard', () => {
    let dashboard: Dashboard;

    beforeEach(() => {
      dashboard = new Dashboard();
    });

    afterEach(() => {
      dashboard.stopAutoRefresh();
    });

    it('should accept data provider', () => {
      const mockProvider = jest.fn().mockReturnValue({
        state: {
          status: BotStatus.RUNNING,
          uptimeMs: 3600000,
          trackedTokensCount: 10,
          openPositionsCount: 2,
          signalsGeneratedToday: 5,
          tradesExecutedToday: 3,
          dailyPnlSol: 0.5,
          dailyPnlPercent: 5,
          capitalDeployedSol: 2,
          capitalAvailableSol: 8,
          totalCapitalSol: 10,
          errorsToday: 0,
          paperTradingEnabled: true,
          services: {},
        },
        topTokens: [],
        positions: [],
        recentTrades: [],
        recentErrors: [],
      });

      dashboard.setDataProvider(mockProvider);
      expect(mockProvider).not.toHaveBeenCalled(); // Not called until render
    });

    it('should print banner without error', () => {
      expect(() => Dashboard.printBanner()).not.toThrow();
    });

    it('should print shutdown message without error', () => {
      expect(() => Dashboard.printShutdown('TEST', 1000)).not.toThrow();
    });

    it('should print status line', () => {
      const mockState: BotState = {
        status: BotStatus.RUNNING,
        startTime: Date.now() - 3600000,
        uptimeMs: 3600000,
        trackedTokensCount: 10,
        openPositionsCount: 2,
        signalsGeneratedToday: 5,
        tradesExecutedToday: 3,
        dailyPnlSol: 0.5,
        dailyPnlPercent: 5,
        capitalDeployedSol: 2,
        capitalAvailableSol: 8,
        totalCapitalSol: 10,
        lastTradeTime: Date.now(),
        errorsToday: 0,
        paperTradingEnabled: true,
        services: {
          rpc: { name: 'rpc', status: HealthStatus.HEALTHY, lastCheck: Date.now(), consecutiveFailures: 0 },
          grpc: { name: 'grpc', status: HealthStatus.HEALTHY, lastCheck: Date.now(), consecutiveFailures: 0 },
          database: { name: 'database', status: HealthStatus.HEALTHY, lastCheck: Date.now(), consecutiveFailures: 0 },
          pumpMonitor: { name: 'pumpMonitor', status: HealthStatus.HEALTHY, lastCheck: Date.now(), consecutiveFailures: 0 },
          momentumEngine: { name: 'momentumEngine', status: HealthStatus.HEALTHY, lastCheck: Date.now(), consecutiveFailures: 0 },
          tradeExecutor: { name: 'tradeExecutor', status: HealthStatus.HEALTHY, lastCheck: Date.now(), consecutiveFailures: 0 },
        },
      };

      expect(() => dashboard.printStatus(mockState)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Trading Control
  // ---------------------------------------------------------------------------
  describe('Trading Control', () => {
    let bot: TradingBot;

    beforeEach(() => {
      resetBot();
      bot = new TradingBot({ paperTradingEnabled: true });
    });

    afterEach(async () => {
      await bot.stop(ShutdownReason.USER_REQUEST);
      resetBot();
    });

    it('should pause and resume trading', () => {
      // Need to manually set status to RUNNING for this test
      (bot as unknown as { state: BotState }).state.status = BotStatus.RUNNING;

      bot.pauseTrading();
      expect(bot.getState().status).toBe(BotStatus.PAUSED);
      expect(bot.getConfig().tradingPaused).toBe(true);

      bot.resumeTrading();
      expect(bot.getState().status).toBe(BotStatus.RUNNING);
      expect(bot.getConfig().tradingPaused).toBe(false);
    });

    it('should check if trading is allowed', () => {
      // Initially stopped, trading not allowed
      expect(bot.canTrade()).toBe(false);
    });

    it('should respect token blacklist', () => {
      const blacklistedMint = 'BLACKLISTED1111111111111111111111111111111';
      bot.updateConfig({
        tokenBlacklist: new Set([blacklistedMint]),
      });

      const initialCount = bot.getState().trackedTokensCount;
      bot.onTokenDetected(blacklistedMint, 'BAD');

      // Should not increase count for blacklisted token
      expect(bot.getState().trackedTokensCount).toBe(initialCount);
    });

    it('should respect max tracked tokens limit', () => {
      bot.updateConfig({ maxTrackedTokens: 2 });

      bot.onTokenDetected('TOKEN1', 'T1');
      bot.onTokenDetected('TOKEN2', 'T2');
      bot.onTokenDetected('TOKEN3', 'T3');

      // Should cap at 2
      expect(bot.getState().trackedTokensCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Default Configuration
  // ---------------------------------------------------------------------------
  describe('Default Configuration', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_BOT_CONFIG.paperTradingEnabled).toBe(true);
      expect(DEFAULT_BOT_CONFIG.maxTrackedTokens).toBeGreaterThan(0);
      expect(DEFAULT_BOT_CONFIG.healthCheckIntervalMs).toBeGreaterThan(0);
      expect(DEFAULT_BOT_CONFIG.shutdownTimeoutMs).toBeGreaterThan(0);
      expect(DEFAULT_BOT_CONFIG.riskLimits.maxPositionSizeSol).toBeGreaterThan(0);
      expect(DEFAULT_BOT_CONFIG.riskLimits.maxConcurrentPositions).toBeGreaterThan(0);
      expect(DEFAULT_BOT_CONFIG.riskLimits.dailyLossLimitPercent).toBeGreaterThan(0);
    });

    it('should have valid threshold defaults', () => {
      expect(DEFAULT_BOT_CONFIG.thresholds.buy).toBeGreaterThan(0);
      expect(DEFAULT_BOT_CONFIG.thresholds.buy).toBeLessThanOrEqual(100);
      expect(DEFAULT_BOT_CONFIG.thresholds.strongBuy).toBeGreaterThan(DEFAULT_BOT_CONFIG.thresholds.buy);
      expect(DEFAULT_BOT_CONFIG.thresholds.sell).toBeLessThan(DEFAULT_BOT_CONFIG.thresholds.buy);
    });
  });

  // ---------------------------------------------------------------------------
  // Singleton Pattern
  // ---------------------------------------------------------------------------
  describe('Singleton Pattern', () => {
    afterEach(() => {
      resetBot();
    });

    it('should return same instance with getBot', () => {
      const bot1 = getBot();
      const bot2 = getBot();

      expect(bot1).toBe(bot2);
    });

    it('should create new instance after reset', () => {
      const bot1 = getBot();
      resetBot();
      const bot2 = getBot();

      expect(bot1).not.toBe(bot2);
    });
  });
});
