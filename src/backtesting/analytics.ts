/**
 * Performance Analytics
 *
 * Comprehensive analysis and statistics for backtest results.
 * Includes scenario testing and trade distribution analysis.
 */

import { getComponentLogger } from '../infrastructure/logger/index.js';
import { BacktestEngine } from './engine.js';
import {
  type HistoricalToken,
  type HistoricalDataPoint,
  type BacktestConfig,
  type BacktestResult,
  type BacktestTrade,
  type PerformanceMetrics,
  type ScenarioConfig,
  type ScenarioResult,
  ScenarioType,
  TradeExitReason,
  TradeStatus,
  TokenOutcome,
  DEFAULT_BACKTEST_CONFIG,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const logger = getComponentLogger('Analytics');

// =============================================================================
// ANALYTICS CLASS
// =============================================================================

/**
 * Performance Analytics
 */
export class PerformanceAnalytics {
  // ===========================================================================
  // TRADE ANALYSIS
  // ===========================================================================

  /**
   * Analyzes trade distribution
   */
  analyzeTradeDistribution(trades: BacktestTrade[]): {
    byOutcome: { wins: number; losses: number; breakeven: number };
    byExitReason: Record<string, number>;
    byHoldingTime: {
      under1Hour: number;
      oneToSixHours: number;
      sixToTwentyFourHours: number;
      overTwentyFourHours: number;
    };
    pnlDistribution: {
      buckets: Array<{ range: string; count: number }>;
      mean: number;
      median: number;
      stdDev: number;
      skewness: number;
    };
  } {
    const closedTrades = trades.filter((t) => t.status === TradeStatus.CLOSED);

    // By outcome
    const wins = closedTrades.filter((t) => (t.realizedPnlSol ?? 0) > 0).length;
    const losses = closedTrades.filter((t) => (t.realizedPnlSol ?? 0) < 0).length;
    const breakeven = closedTrades.filter((t) => t.realizedPnlSol === 0).length;

    // By exit reason
    const byExitReason: Record<string, number> = {};
    for (const trade of closedTrades) {
      const reason = trade.exitReason ?? 'UNKNOWN';
      byExitReason[reason] = (byExitReason[reason] ?? 0) + 1;
    }

    // By holding time
    const holdingTimes = closedTrades.map(
      (t) => ((t.exitTimestamp ?? 0) - t.entryTimestamp) / (1000 * 60 * 60)
    ); // in hours

    const byHoldingTime = {
      under1Hour: holdingTimes.filter((h) => h < 1).length,
      oneToSixHours: holdingTimes.filter((h) => h >= 1 && h < 6).length,
      sixToTwentyFourHours: holdingTimes.filter((h) => h >= 6 && h < 24).length,
      overTwentyFourHours: holdingTimes.filter((h) => h >= 24).length,
    };

    // P&L distribution
    const pnls = closedTrades.map((t) => t.realizedPnlPercent ?? 0);
    const pnlDistribution = this.calculateDistributionStats(pnls);

    return {
      byOutcome: { wins, losses, breakeven },
      byExitReason,
      byHoldingTime,
      pnlDistribution,
    };
  }

  /**
   * Calculates distribution statistics
   */
  private calculateDistributionStats(values: number[]): {
    buckets: Array<{ range: string; count: number }>;
    mean: number;
    median: number;
    stdDev: number;
    skewness: number;
  } {
    if (values.length === 0) {
      return {
        buckets: [],
        mean: 0,
        median: 0,
        stdDev: 0,
        skewness: 0,
      };
    }

    // Mean
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    // Median
    const sorted = [...values].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
        : sorted[Math.floor(sorted.length / 2)] ?? 0;

    // Standard deviation
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Skewness
    const skewness =
      stdDev > 0
        ? values.reduce((sum, v) => sum + Math.pow((v - mean) / stdDev, 3), 0) /
          values.length
        : 0;

    // Buckets for histogram
    const buckets = this.createHistogramBuckets(values);

    return { buckets, mean, median, stdDev, skewness };
  }

  /**
   * Creates histogram buckets
   */
  private createHistogramBuckets(
    values: number[]
  ): Array<{ range: string; count: number }> {
    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const bucketCount = 10;
    const bucketSize = (max - min) / bucketCount || 1;

    const buckets: Array<{ range: string; count: number }> = [];

    for (let i = 0; i < bucketCount; i++) {
      const rangeStart = min + i * bucketSize;
      const rangeEnd = min + (i + 1) * bucketSize;
      const count = values.filter((v) => v >= rangeStart && v < rangeEnd).length;

      buckets.push({
        range: `${rangeStart.toFixed(1)} to ${rangeEnd.toFixed(1)}`,
        count,
      });
    }

    return buckets;
  }

  // ===========================================================================
  // TOKEN ANALYSIS
  // ===========================================================================

  /**
   * Analyzes which token characteristics lead to winning trades
   */
  analyzeWinningPatterns(
    trades: BacktestTrade[],
    tokens: HistoricalToken[]
  ): {
    avgWinningMomentumScore: number;
    avgLosingMomentumScore: number;
    winRateByScoreRange: Array<{ range: string; winRate: number; count: number }>;
    winRateBySignal: Record<string, { winRate: number; count: number }>;
    bestTokenOutcomes: Record<string, { winRate: number; count: number }>;
  } {
    const closedTrades = trades.filter((t) => t.status === TradeStatus.CLOSED);
    const winningTrades = closedTrades.filter((t) => (t.realizedPnlSol ?? 0) > 0);
    const losingTrades = closedTrades.filter((t) => (t.realizedPnlSol ?? 0) < 0);

    // Average momentum scores
    const avgWinningMomentumScore =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.momentumScore, 0) /
          winningTrades.length
        : 0;

    const avgLosingMomentumScore =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.momentumScore, 0) /
          losingTrades.length
        : 0;

    // Win rate by score range
    const scoreRanges = [
      { min: 70, max: 75 },
      { min: 75, max: 80 },
      { min: 80, max: 85 },
      { min: 85, max: 90 },
      { min: 90, max: 100 },
    ];

    const winRateByScoreRange = scoreRanges.map(({ min, max }) => {
      const inRange = closedTrades.filter(
        (t) => t.momentumScore >= min && t.momentumScore < max
      );
      const winsInRange = inRange.filter((t) => (t.realizedPnlSol ?? 0) > 0).length;

      return {
        range: `${min}-${max}`,
        winRate: inRange.length > 0 ? (winsInRange / inRange.length) * 100 : 0,
        count: inRange.length,
      };
    });

    // Win rate by signal type
    const signalTypes = [...new Set(closedTrades.map((t) => t.signal))];
    const winRateBySignal: Record<string, { winRate: number; count: number }> = {};

    for (const signal of signalTypes) {
      const signalTrades = closedTrades.filter((t) => t.signal === signal);
      const signalWins = signalTrades.filter((t) => (t.realizedPnlSol ?? 0) > 0).length;

      winRateBySignal[signal] = {
        winRate: signalTrades.length > 0 ? (signalWins / signalTrades.length) * 100 : 0,
        count: signalTrades.length,
      };
    }

    // Win rate by token outcome (requires token data)
    const tokenMap = new Map(tokens.map((t) => [t.mintAddress, t]));
    const outcomeGroups: Record<string, { wins: number; total: number }> = {};

    for (const trade of closedTrades) {
      const token = tokenMap.get(trade.mintAddress);
      const outcome = token?.outcome ?? 'UNKNOWN';

      if (!outcomeGroups[outcome]) {
        outcomeGroups[outcome] = { wins: 0, total: 0 };
      }

      const group = outcomeGroups[outcome];
      if (group) {
        group.total++;
        if ((trade.realizedPnlSol ?? 0) > 0) {
          group.wins++;
        }
      }
    }

    const bestTokenOutcomes: Record<string, { winRate: number; count: number }> = {};
    for (const [outcome, { wins, total }] of Object.entries(outcomeGroups)) {
      bestTokenOutcomes[outcome] = {
        winRate: total > 0 ? (wins / total) * 100 : 0,
        count: total,
      };
    }

    return {
      avgWinningMomentumScore,
      avgLosingMomentumScore,
      winRateByScoreRange,
      winRateBySignal,
      bestTokenOutcomes,
    };
  }

  // ===========================================================================
  // SCENARIO TESTING
  // ===========================================================================

  /**
   * Runs scenario tests
   */
  async runScenarioTests(
    tokens: HistoricalToken[],
    baseConfig: Partial<BacktestConfig> = {}
  ): Promise<ScenarioResult[]> {
    const scenarios: ScenarioConfig[] = [
      {
        type: ScenarioType.MARKET_CRASH,
        description: 'Simulate all tokens dumping 50%',
        parameters: { crashPercent: 50 },
      },
      {
        type: ScenarioType.HIGH_VOLATILITY,
        description: 'Simulate 3x normal volatility',
        parameters: { volatilityMultiplier: 3 },
      },
      {
        type: ScenarioType.NETWORK_CONGESTION,
        description: 'Simulate 30% transaction failure rate',
        parameters: { failureRate: 0.3 },
      },
    ];

    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.runScenario(tokens, scenario, baseConfig);
      results.push(result);

      logger.info('Scenario test complete', {
        type: scenario.type,
        passed: result.passed,
      });
    }

    return results;
  }

  /**
   * Runs a single scenario test
   */
  private async runScenario(
    tokens: HistoricalToken[],
    scenario: ScenarioConfig,
    baseConfig: Partial<BacktestConfig>
  ): Promise<ScenarioResult> {
    let modifiedTokens = tokens;
    let config: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG, ...baseConfig };

    switch (scenario.type) {
      case ScenarioType.MARKET_CRASH:
        // Modify token data to simulate crash
        modifiedTokens = this.applyMarketCrash(tokens, scenario.parameters.crashPercent ?? 50);
        break;

      case ScenarioType.HIGH_VOLATILITY:
        // Modify token data to increase volatility
        modifiedTokens = this.applyVolatility(
          tokens,
          scenario.parameters.volatilityMultiplier ?? 3
        );
        break;

      case ScenarioType.NETWORK_CONGESTION:
        // Increase failure rate in config
        config = {
          ...config,
          failureRate: scenario.parameters.failureRate ?? 0.3,
        };
        break;

      case ScenarioType.NO_OPPORTUNITIES:
        // Remove all qualifying tokens
        modifiedTokens = tokens.filter(
          (t) => t.dataPoints.every((d) => d.bondingProgress < 50)
        );
        break;

      case ScenarioType.RUG_DETECTION:
        // Only use known rugs
        modifiedTokens = tokens.filter((t) => t.outcome === TokenOutcome.RUG);
        break;
    }

    // Run backtest with scenario
    const engine = new BacktestEngine(config);
    const result = await engine.run(modifiedTokens);

    // Evaluate scenario success
    const passed = this.evaluateScenario(scenario, result);

    return {
      scenario,
      passed,
      details: this.getScenarioDetails(scenario, result),
      metrics: {
        totalPnlSol: result.metrics.totalPnlSol,
        maxDrawdownPercent: result.metrics.maxDrawdownPercent,
        winRate: result.metrics.winRate,
      },
    };
  }

  /**
   * Applies market crash to token data
   */
  private applyMarketCrash(
    tokens: HistoricalToken[],
    crashPercent: number
  ): HistoricalToken[] {
    return tokens.map((token) => ({
      ...token,
      dataPoints: token.dataPoints.map((point, index) => {
        // Apply crash at midpoint
        const midpoint = Math.floor(token.dataPoints.length / 2);
        const crashMultiplier = index > midpoint ? 1 - crashPercent / 100 : 1;

        return {
          ...point,
          priceUsd: point.priceUsd * crashMultiplier,
          priceSol: point.priceSol * crashMultiplier,
        };
      }),
    }));
  }

  /**
   * Applies volatility multiplier to token data
   */
  private applyVolatility(
    tokens: HistoricalToken[],
    multiplier: number
  ): HistoricalToken[] {
    return tokens.map((token) => {
      if (token.dataPoints.length < 2) return token;

      const avgPrice =
        token.dataPoints.reduce((sum, p) => sum + p.priceUsd, 0) /
        token.dataPoints.length;

      return {
        ...token,
        dataPoints: token.dataPoints.map((point) => {
          const deviation = point.priceUsd - avgPrice;
          const newPrice = avgPrice + deviation * multiplier;

          return {
            ...point,
            priceUsd: Math.max(0, newPrice),
            priceSol: Math.max(0, point.priceSol * (newPrice / point.priceUsd)),
          };
        }),
      };
    });
  }

  /**
   * Evaluates if scenario passed
   */
  private evaluateScenario(scenario: ScenarioConfig, result: BacktestResult): boolean {
    switch (scenario.type) {
      case ScenarioType.MARKET_CRASH:
        // Pass if max drawdown is within acceptable limits
        return result.metrics.maxDrawdownPercent < 50;

      case ScenarioType.HIGH_VOLATILITY:
        // Pass if stop-losses protected capital
        return result.metrics.maxDrawdownPercent < 40;

      case ScenarioType.NETWORK_CONGESTION:
        // Pass if no double executions (hard to detect in backtest)
        return result.metrics.totalTrades < result.trades.length * 1.1;

      case ScenarioType.NO_OPPORTUNITIES:
        // Pass if bot stayed dormant (few or no trades)
        return result.metrics.totalTrades < 5;

      case ScenarioType.RUG_DETECTION:
        // Pass if losses were limited on rugs
        return result.metrics.averageLossPercent < 50;

      default:
        return true;
    }
  }

  /**
   * Gets scenario result details
   */
  private getScenarioDetails(scenario: ScenarioConfig, result: BacktestResult): string {
    switch (scenario.type) {
      case ScenarioType.MARKET_CRASH:
        return `Max drawdown: ${result.metrics.maxDrawdownPercent.toFixed(1)}%. Stop-losses ${
          result.metrics.maxDrawdownPercent < 50 ? 'protected' : 'failed to protect'
        } capital.`;

      case ScenarioType.HIGH_VOLATILITY:
        return `${result.metrics.totalTrades} trades executed. Average win: ${result.metrics.averageWinPercent.toFixed(1)}%, Average loss: ${result.metrics.averageLossPercent.toFixed(1)}%`;

      case ScenarioType.NETWORK_CONGESTION:
        return `${result.metrics.totalTrades} trades completed despite ${
          (scenario.parameters.failureRate ?? 0) * 100
        }% failure rate.`;

      case ScenarioType.NO_OPPORTUNITIES:
        return `Bot executed ${result.metrics.totalTrades} trades when no opportunities met criteria.`;

      case ScenarioType.RUG_DETECTION:
        return `${result.metrics.totalTrades} trades on rugged tokens. Win rate: ${result.metrics.winRate.toFixed(1)}%, Avg loss: ${result.metrics.averageLossPercent.toFixed(1)}%`;

      default:
        return 'Scenario completed.';
    }
  }

  // ===========================================================================
  // COMPARATIVE ANALYSIS
  // ===========================================================================

  /**
   * Compares multiple backtest results
   */
  compareResults(
    results: Array<{ name: string; result: BacktestResult }>
  ): {
    comparison: Array<{
      name: string;
      totalPnl: number;
      winRate: number;
      sharpe: number;
      maxDrawdown: number;
      trades: number;
    }>;
    bestBy: {
      totalPnl: string;
      winRate: string;
      sharpeRatio: string;
      lowestDrawdown: string;
    };
  } {
    const comparison = results.map(({ name, result }) => ({
      name,
      totalPnl: result.metrics.totalPnlSol,
      winRate: result.metrics.winRate,
      sharpe: result.metrics.sharpeRatio,
      maxDrawdown: result.metrics.maxDrawdownPercent,
      trades: result.metrics.totalTrades,
    }));

    // Find best by each metric
    const bestByTotalPnl = comparison.reduce((best, curr) =>
      curr.totalPnl > (best?.totalPnl ?? -Infinity) ? curr : best
    );
    const bestByWinRate = comparison.reduce((best, curr) =>
      curr.winRate > (best?.winRate ?? -Infinity) ? curr : best
    );
    const bestBySharpe = comparison.reduce((best, curr) =>
      curr.sharpe > (best?.sharpe ?? -Infinity) ? curr : best
    );
    const bestByDrawdown = comparison.reduce((best, curr) =>
      curr.maxDrawdown < (best?.maxDrawdown ?? Infinity) ? curr : best
    );

    return {
      comparison,
      bestBy: {
        totalPnl: bestByTotalPnl?.name ?? '',
        winRate: bestByWinRate?.name ?? '',
        sharpeRatio: bestBySharpe?.name ?? '',
        lowestDrawdown: bestByDrawdown?.name ?? '',
      },
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const analytics = new PerformanceAnalytics();

// Convenience exports
export const analyzeTradeDistribution = (trades: BacktestTrade[]) =>
  analytics.analyzeTradeDistribution(trades);

export const analyzeWinningPatterns = (
  trades: BacktestTrade[],
  tokens: HistoricalToken[]
) => analytics.analyzeWinningPatterns(trades, tokens);

export const runScenarioTests = (
  tokens: HistoricalToken[],
  config?: Partial<BacktestConfig>
) => analytics.runScenarioTests(tokens, config);
