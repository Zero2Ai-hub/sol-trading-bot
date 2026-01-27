/**
 * Parameter Optimizer
 *
 * Grid search and walk-forward testing for parameter optimization.
 * Finds optimal threshold values while avoiding overfitting.
 */

import { EventEmitter } from 'events';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { BacktestEngine } from './engine.js';
import type { HistoricalToken } from './types.js';
import {
  type BacktestConfig,
  type BacktestResult,
  type PerformanceMetrics,
  type OptimizationConfig,
  type OptimizationResult,
  type ParameterRange,
  DEFAULT_BACKTEST_CONFIG,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const logger = getComponentLogger('Optimizer');

// =============================================================================
// EVENTS
// =============================================================================

export interface OptimizerEvents {
  /** Iteration completed */
  iteration: (
    current: number,
    total: number,
    params: Record<string, number>,
    metrics: PerformanceMetrics
  ) => void;

  /** Walk-forward window completed */
  windowComplete: (
    window: number,
    total: number,
    trainingMetrics: PerformanceMetrics,
    validationMetrics: PerformanceMetrics
  ) => void;

  /** Optimization complete */
  complete: (result: OptimizationResult) => void;
}

// =============================================================================
// DEFAULT PARAMETER RANGES
// =============================================================================

/**
 * Default parameter ranges for optimization
 */
export const DEFAULT_PARAMETER_RANGES: ParameterRange[] = [
  { name: 'buyThreshold', min: 70, max: 85, step: 5 },
  { name: 'strongBuyThreshold', min: 80, max: 95, step: 5 },
  { name: 'stopLossPercent', min: 20, max: 40, step: 5 },
  { name: 'maxPositionSizeSol', min: 0.3, max: 1.0, step: 0.1 },
];

// =============================================================================
// PARAMETER OPTIMIZER CLASS
// =============================================================================

/**
 * Parameter Optimizer
 */
export class ParameterOptimizer extends EventEmitter {
  private isRunning: boolean = false;

  // ===========================================================================
  // GRID SEARCH
  // ===========================================================================

  /**
   * Runs grid search optimization
   */
  async gridSearch(
    tokens: HistoricalToken[],
    config: OptimizationConfig,
    baseConfig: Partial<BacktestConfig> = {}
  ): Promise<OptimizationResult> {
    this.isRunning = true;

    logger.info('Starting grid search optimization', {
      parameters: config.parameters.map((p) => p.name),
      targetMetric: config.targetMetric,
      direction: config.direction,
    });

    // Generate all parameter combinations
    const combinations = this.generateCombinations(config.parameters);
    const totalCombinations = combinations.length;

    logger.info(`Testing ${totalCombinations} parameter combinations`);

    const allResults: Array<{
      parameters: Record<string, number>;
      metrics: PerformanceMetrics;
    }> = [];

    let bestResult: (typeof allResults)[0] | null = null;
    let bestValue = config.direction === 'maximize' ? -Infinity : Infinity;

    // Test each combination
    for (let i = 0; i < combinations.length; i++) {
      if (!this.isRunning) break;

      const params = combinations[i];
      if (!params) continue;

      // Create config with these parameters
      const testConfig = this.applyParameters(baseConfig, params);

      // Run backtest
      const engine = new BacktestEngine(testConfig);
      const result = await engine.run(tokens);

      // Record results
      allResults.push({
        parameters: params,
        metrics: result.metrics,
      });

      // Check if this is the best so far
      const metricValue = result.metrics[config.targetMetric] as number;
      const isBetter =
        config.direction === 'maximize'
          ? metricValue > bestValue
          : metricValue < bestValue;

      if (isBetter) {
        bestValue = metricValue;
        bestResult = { parameters: params, metrics: result.metrics };
      }

      // Emit progress
      this.emit('iteration', i + 1, totalCombinations, params, result.metrics);

      logger.debug('Tested combination', {
        iteration: i + 1,
        total: totalCombinations,
        params,
        [config.targetMetric]: metricValue,
      });
    }

    this.isRunning = false;

    const result: OptimizationResult = {
      bestParameters: bestResult?.parameters ?? {},
      bestMetricValue: bestValue === Infinity || bestValue === -Infinity ? 0 : bestValue,
      allResults,
    };

    logger.info('Grid search complete', {
      bestParameters: result.bestParameters,
      bestMetricValue: result.bestMetricValue,
      combinationsTested: allResults.length,
    });

    this.emit('complete', result);
    return result;
  }

  // ===========================================================================
  // WALK-FORWARD TESTING
  // ===========================================================================

  /**
   * Runs walk-forward optimization
   * More robust than simple grid search - validates on unseen data
   */
  async walkForward(
    tokens: HistoricalToken[],
    config: OptimizationConfig,
    baseConfig: Partial<BacktestConfig> = {}
  ): Promise<OptimizationResult> {
    this.isRunning = true;

    const numWindows = config.walkForwardWindows ?? 4;
    const trainingPercent = config.trainingWindowPercent ?? 75;

    logger.info('Starting walk-forward optimization', {
      windows: numWindows,
      trainingPercent,
      parameters: config.parameters.map((p) => p.name),
    });

    // Sort tokens by launch time
    const sortedTokens = [...tokens].sort(
      (a, b) => a.launchTimestamp - b.launchTimestamp
    );

    // Calculate window sizes
    const totalTokens = sortedTokens.length;
    const windowSize = Math.floor(totalTokens / numWindows);

    if (windowSize < 10) {
      logger.warn('Insufficient tokens for walk-forward testing', {
        tokens: totalTokens,
        windows: numWindows,
        windowSize,
      });
    }

    const walkForwardResults: OptimizationResult['walkForwardResults'] = [];
    const allResults: OptimizationResult['allResults'] = [];

    // Best parameters found across all windows
    const parameterVotes: Map<string, number[]> = new Map();
    config.parameters.forEach((p) => parameterVotes.set(p.name, []));

    // Process each window
    for (let w = 0; w < numWindows - 1; w++) {
      if (!this.isRunning) break;

      // Split data into training and validation
      const trainStart = w * windowSize;
      const trainEnd = trainStart + Math.floor(windowSize * (trainingPercent / 100));
      const valStart = trainEnd;
      const valEnd = (w + 1) * windowSize;

      const trainingTokens = sortedTokens.slice(trainStart, trainEnd);
      const validationTokens = sortedTokens.slice(valStart, valEnd);

      if (trainingTokens.length < 5 || validationTokens.length < 2) {
        logger.warn('Skipping window with insufficient data', { window: w });
        continue;
      }

      logger.debug('Processing window', {
        window: w + 1,
        trainingTokens: trainingTokens.length,
        validationTokens: validationTokens.length,
      });

      // Run grid search on training data
      const trainingOptConfig: OptimizationConfig = {
        ...config,
        maxIterations: config.maxIterations ?? 100,
      };

      // Find best parameters on training data
      const combinations = this.generateCombinations(config.parameters);
      let bestTrainingParams: Record<string, number> = {};
      let bestTrainingValue = config.direction === 'maximize' ? -Infinity : Infinity;
      let bestTrainingMetrics: PerformanceMetrics | null = null;

      for (const params of combinations.slice(0, trainingOptConfig.maxIterations)) {
        if (!this.isRunning || !params) break;

        const testConfig = this.applyParameters(baseConfig, params);
        const engine = new BacktestEngine(testConfig);
        const result = await engine.run(trainingTokens);

        const metricValue = result.metrics[config.targetMetric] as number;
        const isBetter =
          config.direction === 'maximize'
            ? metricValue > bestTrainingValue
            : metricValue < bestTrainingValue;

        if (isBetter) {
          bestTrainingValue = metricValue;
          bestTrainingParams = params;
          bestTrainingMetrics = result.metrics;
        }
      }

      if (!bestTrainingMetrics) continue;

      // Test best parameters on validation data
      const validationConfig = this.applyParameters(baseConfig, bestTrainingParams);
      const validationEngine = new BacktestEngine(validationConfig);
      const validationResult = await validationEngine.run(validationTokens);

      // Record window results
      const trainingPeriod = {
        start: trainingTokens[0]?.launchTimestamp ?? 0,
        end: trainingTokens[trainingTokens.length - 1]?.launchTimestamp ?? 0,
      };
      const validationPeriod = {
        start: validationTokens[0]?.launchTimestamp ?? 0,
        end: validationTokens[validationTokens.length - 1]?.launchTimestamp ?? 0,
      };

      walkForwardResults.push({
        trainingPeriod,
        validationPeriod,
        trainingMetrics: bestTrainingMetrics,
        validationMetrics: validationResult.metrics,
      });

      // Record parameter votes
      for (const [name, value] of Object.entries(bestTrainingParams)) {
        const votes = parameterVotes.get(name);
        if (votes) votes.push(value);
      }

      this.emit(
        'windowComplete',
        w + 1,
        numWindows - 1,
        bestTrainingMetrics,
        validationResult.metrics
      );

      logger.info('Window complete', {
        window: w + 1,
        bestTrainingParams,
        trainingMetric: bestTrainingValue,
        validationMetric: validationResult.metrics[config.targetMetric],
      });
    }

    this.isRunning = false;

    // Calculate consensus parameters (median of votes)
    const consensusParams: Record<string, number> = {};
    for (const [name, votes] of parameterVotes.entries()) {
      if (votes.length > 0) {
        votes.sort((a, b) => a - b);
        const medianIndex = Math.floor(votes.length / 2);
        consensusParams[name] = votes[medianIndex] ?? votes[0] ?? 0;
      }
    }

    // Calculate average validation performance
    const avgValidationMetric =
      walkForwardResults.length > 0
        ? walkForwardResults.reduce(
            (sum, r) => sum + (r.validationMetrics[config.targetMetric] as number),
            0
          ) / walkForwardResults.length
        : 0;

    const result: OptimizationResult = {
      bestParameters: consensusParams,
      bestMetricValue: avgValidationMetric,
      allResults,
      walkForwardResults,
    };

    logger.info('Walk-forward optimization complete', {
      consensusParams,
      avgValidationMetric,
      windowsProcessed: walkForwardResults.length,
    });

    this.emit('complete', result);
    return result;
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Generates all parameter combinations
   */
  private generateCombinations(
    parameters: ParameterRange[]
  ): Array<Record<string, number>> {
    if (parameters.length === 0) return [{}];

    const combinations: Array<Record<string, number>> = [];

    const generateRecursive = (
      index: number,
      current: Record<string, number>
    ): void => {
      if (index >= parameters.length) {
        combinations.push({ ...current });
        return;
      }

      const param = parameters[index];
      if (!param) return;

      for (let value = param.min; value <= param.max; value += param.step) {
        current[param.name] = Math.round(value * 100) / 100; // Round to 2 decimals
        generateRecursive(index + 1, current);
      }
    };

    generateRecursive(0, {});
    return combinations;
  }

  /**
   * Applies parameters to backtest config
   */
  private applyParameters(
    baseConfig: Partial<BacktestConfig>,
    params: Record<string, number>
  ): BacktestConfig {
    const config: BacktestConfig = {
      ...DEFAULT_BACKTEST_CONFIG,
      ...baseConfig,
    };

    // Apply known parameters
    if (params.buyThreshold !== undefined) {
      config.thresholds.buy = params.buyThreshold;
    }
    if (params.strongBuyThreshold !== undefined) {
      config.thresholds.strongBuy = params.strongBuyThreshold;
    }
    if (params.sellThreshold !== undefined) {
      config.thresholds.sell = params.sellThreshold;
    }
    if (params.stopLossPercent !== undefined) {
      config.risk.stopLossPercent = params.stopLossPercent;
    }
    if (params.maxPositionSizeSol !== undefined) {
      config.risk.maxPositionSizeSol = params.maxPositionSizeSol;
    }
    if (params.maxConcurrentPositions !== undefined) {
      config.risk.maxConcurrentPositions = params.maxConcurrentPositions;
    }
    if (params.entrySlippage !== undefined) {
      config.slippage.entryPercent = params.entrySlippage;
    }
    if (params.exitSlippage !== undefined) {
      config.slippage.exitPercent = params.exitSlippage;
    }

    return config;
  }

  /**
   * Stops the optimization
   */
  stop(): void {
    this.isRunning = false;
    logger.info('Optimization stopped');
  }

  // ===========================================================================
  // SENSITIVITY ANALYSIS
  // ===========================================================================

  /**
   * Analyzes sensitivity of a single parameter
   */
  async analyzeSensitivity(
    tokens: HistoricalToken[],
    parameter: ParameterRange,
    baseConfig: Partial<BacktestConfig> = {},
    targetMetric: keyof PerformanceMetrics = 'sharpeRatio'
  ): Promise<Array<{ value: number; metric: number }>> {
    const results: Array<{ value: number; metric: number }> = [];

    for (let value = parameter.min; value <= parameter.max; value += parameter.step) {
      const params = { [parameter.name]: value };
      const config = this.applyParameters(baseConfig, params);

      const engine = new BacktestEngine(config);
      const result = await engine.run(tokens);

      results.push({
        value,
        metric: result.metrics[targetMetric] as number,
      });
    }

    return results;
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const optimizer = new ParameterOptimizer();

// Convenience exports
export const runGridSearch = (
  tokens: HistoricalToken[],
  config: OptimizationConfig,
  baseConfig?: Partial<BacktestConfig>
) => optimizer.gridSearch(tokens, config, baseConfig);

export const runWalkForward = (
  tokens: HistoricalToken[],
  config: OptimizationConfig,
  baseConfig?: Partial<BacktestConfig>
) => optimizer.walkForward(tokens, config, baseConfig);
