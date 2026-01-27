/**
 * Backtesting Module
 *
 * Framework to validate trading strategy using historical data.
 * Components:
 * - Historical Data Collector: Fetches data from APIs and database
 * - Backtest Engine: Simulates trading on historical data
 * - Parameter Optimizer: Grid search and walk-forward testing
 * - Performance Analytics: Comprehensive metrics and analysis
 * - Report Generator: Text reports and CSV exports
 *
 * Architecture:
 * ```
 * Historical Data → Backtest Engine → Performance Metrics → Reports
 *        │               │                   │                │
 *        └── Collector ──┴── Optimizer ──────┴── Analytics ───┴── Export
 * ```
 */

// =============================================================================
// TYPES
// =============================================================================

export * from './types.js';

// =============================================================================
// HISTORICAL DATA COLLECTOR
// =============================================================================

export {
  HistoricalDataCollector,
  historicalCollector,
  collectTokenHistory,
  collectBatch,
  loadHistoricalToken,
  loadAllHistoricalTokens,
} from './collector.js';

// =============================================================================
// BACKTEST ENGINE
// =============================================================================

export {
  BacktestEngine,
  backtestEngine,
  runBacktest,
  type BacktestEngineEvents,
} from './engine.js';

// =============================================================================
// PARAMETER OPTIMIZER
// =============================================================================

export {
  ParameterOptimizer,
  optimizer,
  runGridSearch,
  runWalkForward,
  DEFAULT_PARAMETER_RANGES,
  type OptimizerEvents,
} from './optimizer.js';

// =============================================================================
// PERFORMANCE ANALYTICS
// =============================================================================

export {
  PerformanceAnalytics,
  analytics,
  analyzeTradeDistribution,
  analyzeWinningPatterns,
  runScenarioTests,
} from './analytics.js';

// =============================================================================
// REPORT GENERATOR
// =============================================================================

export {
  ReportGenerator,
  reporter,
  generateReport,
  saveReport,
  printSummary,
} from './reporter.js';

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

import { BacktestEngine } from './engine.js';
import { ParameterOptimizer, DEFAULT_PARAMETER_RANGES } from './optimizer.js';
import { PerformanceAnalytics } from './analytics.js';
import { ReportGenerator } from './reporter.js';
import { historicalCollector } from './collector.js';
import {
  type HistoricalToken,
  type BacktestConfig,
  type OptimizationConfig,
  DEFAULT_BACKTEST_CONFIG,
} from './types.js';
import { getComponentLogger } from '../infrastructure/logger/index.js';

const logger = getComponentLogger('Backtesting');

/**
 * Runs a complete backtest with default configuration
 */
export async function runQuickBacktest(
  tokens: HistoricalToken[],
  config?: Partial<BacktestConfig>
): Promise<void> {
  logger.info('Running quick backtest', { tokens: tokens.length });

  const engine = new BacktestEngine(config);
  const result = await engine.run(tokens);

  const reporter = new ReportGenerator();
  reporter.printSummary(result);
}

/**
 * Runs a complete backtest with optimization
 */
export async function runFullBacktest(
  tokens: HistoricalToken[],
  outputDir: string,
  config?: Partial<BacktestConfig>
): Promise<{
  result: Awaited<ReturnType<BacktestEngine['run']>>;
  optimizedParams: Record<string, number>;
  reportPaths: Awaited<ReturnType<ReportGenerator['saveReport']>>;
}> {
  logger.info('Running full backtest with optimization', { tokens: tokens.length });

  // Step 1: Run optimization
  const optimizerInstance = new ParameterOptimizer();
  const optimizationConfig: OptimizationConfig = {
    parameters: DEFAULT_PARAMETER_RANGES,
    targetMetric: 'sharpeRatio',
    direction: 'maximize',
    maxIterations: 50,
  };

  logger.info('Running parameter optimization...');
  const optResult = await optimizerInstance.gridSearch(tokens, optimizationConfig, config);
  logger.info('Optimization complete', { bestParams: optResult.bestParameters });

  // Step 2: Run backtest with optimized parameters
  const optimizedConfig: BacktestConfig = {
    ...DEFAULT_BACKTEST_CONFIG,
    ...config,
    thresholds: {
      ...DEFAULT_BACKTEST_CONFIG.thresholds,
      buy: optResult.bestParameters.buyThreshold ?? DEFAULT_BACKTEST_CONFIG.thresholds.buy,
      strongBuy:
        optResult.bestParameters.strongBuyThreshold ??
        DEFAULT_BACKTEST_CONFIG.thresholds.strongBuy,
    },
    risk: {
      ...DEFAULT_BACKTEST_CONFIG.risk,
      stopLossPercent:
        optResult.bestParameters.stopLossPercent ??
        DEFAULT_BACKTEST_CONFIG.risk.stopLossPercent,
      maxPositionSizeSol:
        optResult.bestParameters.maxPositionSizeSol ??
        DEFAULT_BACKTEST_CONFIG.risk.maxPositionSizeSol,
    },
  };

  logger.info('Running final backtest with optimized parameters...');
  const engine = new BacktestEngine(optimizedConfig);
  const result = await engine.run(tokens);

  // Step 3: Generate reports
  const reporterInstance = new ReportGenerator();
  reporterInstance.printSummary(result);
  const reportPaths = await reporterInstance.saveReport(result, outputDir, tokens);

  // Step 4: Run analytics
  const analyticsInstance = new PerformanceAnalytics();
  const tradeDistribution = analyticsInstance.analyzeTradeDistribution(result.trades);
  const winningPatterns = analyticsInstance.analyzeWinningPatterns(result.trades, tokens);

  logger.info('Trade distribution', {
    wins: tradeDistribution.byOutcome.wins,
    losses: tradeDistribution.byOutcome.losses,
  });

  logger.info('Winning patterns', {
    avgWinningScore: winningPatterns.avgWinningMomentumScore,
    avgLosingScore: winningPatterns.avgLosingMomentumScore,
  });

  return {
    result,
    optimizedParams: optResult.bestParameters,
    reportPaths,
  };
}

/**
 * Validates strategy with scenario testing
 */
export async function validateStrategy(
  tokens: HistoricalToken[],
  config?: Partial<BacktestConfig>
): Promise<{
  baselineResult: Awaited<ReturnType<BacktestEngine['run']>>;
  scenarioResults: Awaited<ReturnType<PerformanceAnalytics['runScenarioTests']>>;
  isValid: boolean;
}> {
  logger.info('Validating strategy', { tokens: tokens.length });

  // Run baseline backtest
  const engine = new BacktestEngine(config);
  const baselineResult = await engine.run(tokens);

  // Run scenario tests
  const analyticsInstance = new PerformanceAnalytics();
  const scenarioResults = await analyticsInstance.runScenarioTests(tokens, config);

  // Determine if strategy is valid
  const scenariosPassed = scenarioResults.filter((r) => r.passed).length;
  const totalScenarios = scenarioResults.length;

  const isValid =
    baselineResult.metrics.sharpeRatio > 1.0 &&
    baselineResult.metrics.winRate > 30 &&
    baselineResult.metrics.maxDrawdownPercent < 30 &&
    scenariosPassed >= totalScenarios * 0.7; // At least 70% of scenarios pass

  logger.info('Strategy validation complete', {
    sharpeRatio: baselineResult.metrics.sharpeRatio,
    winRate: baselineResult.metrics.winRate,
    maxDrawdown: baselineResult.metrics.maxDrawdownPercent,
    scenariosPassed: `${scenariosPassed}/${totalScenarios}`,
    isValid,
  });

  return {
    baselineResult,
    scenarioResults,
    isValid,
  };
}
