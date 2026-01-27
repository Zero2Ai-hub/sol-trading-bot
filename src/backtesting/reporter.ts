/**
 * Report Generator
 *
 * Generates summary reports and CSV exports for backtest results.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { analytics } from './analytics.js';
import {
  type BacktestResult,
  type BacktestReport,
  type TradeExportRow,
  type HistoricalToken,
  TradeExitReason,
  TradeStatus,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const logger = getComponentLogger('Reporter');

// =============================================================================
// REPORT GENERATOR CLASS
// =============================================================================

/**
 * Report Generator
 */
export class ReportGenerator {
  // ===========================================================================
  // REPORT GENERATION
  // ===========================================================================

  /**
   * Generates a comprehensive backtest report
   */
  generateReport(
    result: BacktestResult,
    tokens: HistoricalToken[] = []
  ): BacktestReport {
    const tradeDistribution = analytics.analyzeTradeDistribution(result.trades);

    // Get top trades
    const closedTrades = result.trades.filter((t) => t.status === TradeStatus.CLOSED);
    const sortedByPnl = [...closedTrades].sort(
      (a, b) => (b.realizedPnlSol ?? 0) - (a.realizedPnlSol ?? 0)
    );

    const topWinningTrades = sortedByPnl.slice(0, 5);
    const topLosingTrades = sortedByPnl.slice(-5).reverse();

    // Generate recommendations
    const recommendations = this.generateRecommendations(result);

    return {
      title: `Backtest Report - ${result.runId}`,
      generatedAt: Date.now(),
      summary: {
        totalPnlSol: result.metrics.totalPnlSol,
        totalPnlPercent: result.metrics.totalPnlPercent,
        winRate: result.metrics.winRate,
        sharpeRatio: result.metrics.sharpeRatio,
        maxDrawdown: result.metrics.maxDrawdownPercent,
        totalTrades: result.metrics.totalTrades,
        profitFactor: result.metrics.profitFactor,
      },
      metrics: result.metrics,
      config: result.config,
      tradeBreakdown: {
        byOutcome: tradeDistribution.byOutcome,
        byExitReason: tradeDistribution.byExitReason as Record<TradeExitReason, number>,
        byHoldingTime: tradeDistribution.byHoldingTime,
      },
      topWinningTrades,
      topLosingTrades,
      recommendations,
    };
  }

  /**
   * Generates recommendations based on results
   */
  private generateRecommendations(result: BacktestResult): string[] {
    const recommendations: string[] = [];
    const { metrics } = result;

    // Win rate analysis
    if (metrics.winRate < 30) {
      recommendations.push(
        'Win rate is below 30%. Consider raising the buy threshold to be more selective.'
      );
    } else if (metrics.winRate > 50) {
      recommendations.push(
        'Win rate above 50% is excellent. Results may be too good - verify with out-of-sample data.'
      );
    }

    // Sharpe ratio
    if (metrics.sharpeRatio < 1) {
      recommendations.push(
        'Sharpe ratio below 1.0 suggests risk-adjusted returns need improvement. Consider tightening stop-losses.'
      );
    } else if (metrics.sharpeRatio > 2) {
      recommendations.push(
        'Sharpe ratio above 2.0 is excellent but verify this holds on validation data.'
      );
    }

    // Drawdown analysis
    if (metrics.maxDrawdownPercent > 30) {
      recommendations.push(
        `Max drawdown of ${metrics.maxDrawdownPercent.toFixed(1)}% is high. Consider reducing position sizes or max concurrent positions.`
      );
    }

    // Profit factor
    if (metrics.profitFactor < 1.5) {
      recommendations.push(
        'Profit factor below 1.5 means winners are not significantly larger than losers. Consider adjusting take-profit levels.'
      );
    }

    // Average loss analysis
    if (metrics.averageLossPercent > 40) {
      recommendations.push(
        `Average loss of ${metrics.averageLossPercent.toFixed(1)}% is high. Consider tightening stop-loss percentage.`
      );
    }

    // Trade count
    if (metrics.totalTrades < 30) {
      recommendations.push(
        'Low trade count (<30) makes statistics less reliable. Consider gathering more historical data.'
      );
    }

    // Streak analysis
    if (metrics.longestLoseStreak > 5) {
      recommendations.push(
        `Longest losing streak of ${metrics.longestLoseStreak} trades could be psychologically challenging. Ensure adequate capital reserves.`
      );
    }

    // Fees analysis
    const feePercent = (metrics.totalFeesSol / result.config.startingCapitalSol) * 100;
    if (feePercent > 10) {
      recommendations.push(
        `Fees consumed ${feePercent.toFixed(1)}% of starting capital. Consider reducing trade frequency or optimizing for larger moves.`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'Results look reasonable. Proceed with paper trading to validate in live market conditions.'
      );
    }

    return recommendations;
  }

  // ===========================================================================
  // TEXT REPORT
  // ===========================================================================

  /**
   * Formats report as text
   */
  formatAsText(report: BacktestReport): string {
    const lines: string[] = [];

    lines.push('='.repeat(70));
    lines.push(report.title);
    lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);
    lines.push('='.repeat(70));
    lines.push('');

    // Summary
    lines.push('SUMMARY');
    lines.push('-'.repeat(70));
    lines.push(`Total P&L:        ${report.summary.totalPnlSol.toFixed(4)} SOL (${report.summary.totalPnlPercent.toFixed(2)}%)`);
    lines.push(`Win Rate:         ${report.summary.winRate.toFixed(1)}%`);
    lines.push(`Sharpe Ratio:     ${report.summary.sharpeRatio.toFixed(2)}`);
    lines.push(`Profit Factor:    ${report.summary.profitFactor.toFixed(2)}`);
    lines.push(`Max Drawdown:     ${report.summary.maxDrawdown.toFixed(1)}%`);
    lines.push(`Total Trades:     ${report.summary.totalTrades}`);
    lines.push('');

    // Trade breakdown
    lines.push('TRADE BREAKDOWN');
    lines.push('-'.repeat(70));
    lines.push(`Wins:     ${report.tradeBreakdown.byOutcome.wins}`);
    lines.push(`Losses:   ${report.tradeBreakdown.byOutcome.losses}`);
    lines.push(`Breakeven: ${report.tradeBreakdown.byOutcome.breakeven}`);
    lines.push('');

    lines.push('By Exit Reason:');
    for (const [reason, count] of Object.entries(report.tradeBreakdown.byExitReason)) {
      lines.push(`  ${reason}: ${count}`);
    }
    lines.push('');

    lines.push('By Holding Time:');
    lines.push(`  < 1 hour:     ${report.tradeBreakdown.byHoldingTime.under1Hour}`);
    lines.push(`  1-6 hours:    ${report.tradeBreakdown.byHoldingTime.oneToSixHours}`);
    lines.push(`  6-24 hours:   ${report.tradeBreakdown.byHoldingTime.sixToTwentyFourHours}`);
    lines.push(`  > 24 hours:   ${report.tradeBreakdown.byHoldingTime.overTwentyFourHours}`);
    lines.push('');

    // Detailed metrics
    lines.push('DETAILED METRICS');
    lines.push('-'.repeat(70));
    lines.push(`Average Win:      ${report.metrics.averageWinSol.toFixed(4)} SOL (${report.metrics.averageWinPercent.toFixed(1)}%)`);
    lines.push(`Average Loss:     ${report.metrics.averageLossSol.toFixed(4)} SOL (${report.metrics.averageLossPercent.toFixed(1)}%)`);
    lines.push(`Largest Win:      ${report.metrics.largestWinSol.toFixed(4)} SOL`);
    lines.push(`Largest Loss:     ${report.metrics.largestLossSol.toFixed(4)} SOL`);
    lines.push(`Avg Hold Time:    ${(report.metrics.averageHoldingTimeMs / (1000 * 60 * 60)).toFixed(1)} hours`);
    lines.push(`Sortino Ratio:    ${report.metrics.sortinoRatio.toFixed(2)}`);
    lines.push(`Calmar Ratio:     ${report.metrics.calmarRatio.toFixed(2)}`);
    lines.push(`Win Streak:       ${report.metrics.longestWinStreak}`);
    lines.push(`Loss Streak:      ${report.metrics.longestLoseStreak}`);
    lines.push(`Total Fees:       ${report.metrics.totalFeesSol.toFixed(4)} SOL`);
    lines.push('');

    // Top trades
    lines.push('TOP WINNING TRADES');
    lines.push('-'.repeat(70));
    for (const trade of report.topWinningTrades) {
      lines.push(
        `  ${trade.symbol}: +${(trade.realizedPnlSol ?? 0).toFixed(4)} SOL (${(trade.realizedPnlPercent ?? 0).toFixed(1)}%)`
      );
    }
    lines.push('');

    lines.push('TOP LOSING TRADES');
    lines.push('-'.repeat(70));
    for (const trade of report.topLosingTrades) {
      lines.push(
        `  ${trade.symbol}: ${(trade.realizedPnlSol ?? 0).toFixed(4)} SOL (${(trade.realizedPnlPercent ?? 0).toFixed(1)}%)`
      );
    }
    lines.push('');

    // Configuration
    lines.push('CONFIGURATION');
    lines.push('-'.repeat(70));
    lines.push(`Starting Capital: ${report.config.startingCapitalSol} SOL`);
    lines.push(`Buy Threshold:    ${report.config.thresholds.buy}`);
    lines.push(`Strong Buy:       ${report.config.thresholds.strongBuy}`);
    lines.push(`Stop Loss:        ${report.config.risk.stopLossPercent}%`);
    lines.push(`Max Position:     ${report.config.risk.maxPositionSizeSol} SOL`);
    lines.push(`Max Positions:    ${report.config.risk.maxConcurrentPositions}`);
    lines.push(`Entry Slippage:   ${report.config.slippage.entryPercent}%`);
    lines.push(`Exit Slippage:    ${report.config.slippage.exitPercent}%`);
    lines.push('');

    // Recommendations
    lines.push('RECOMMENDATIONS');
    lines.push('-'.repeat(70));
    for (const rec of report.recommendations) {
      lines.push(`* ${rec}`);
    }
    lines.push('');

    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  // ===========================================================================
  // CSV EXPORTS
  // ===========================================================================

  /**
   * Exports trades to CSV
   */
  exportTradesToCsv(result: BacktestResult): string {
    const headers = [
      'trade_id',
      'mint_address',
      'symbol',
      'signal',
      'momentum_score',
      'entry_timestamp',
      'entry_price',
      'position_size_sol',
      'exit_timestamp',
      'exit_price',
      'exit_reason',
      'pnl_sol',
      'pnl_percent',
      'fees_sol',
      'holding_time_hours',
    ];

    const rows: string[] = [headers.join(',')];

    for (const trade of result.trades) {
      if (trade.status !== TradeStatus.CLOSED) continue;

      const holdingTimeHours =
        ((trade.exitTimestamp ?? trade.entryTimestamp) - trade.entryTimestamp) /
        (1000 * 60 * 60);

      const row: TradeExportRow = {
        trade_id: trade.id,
        mint_address: trade.mintAddress,
        symbol: trade.symbol,
        signal: trade.signal,
        momentum_score: trade.momentumScore,
        entry_timestamp: new Date(trade.entryTimestamp).toISOString(),
        entry_price: trade.entryPrice,
        position_size_sol: trade.positionSizeSol,
        exit_timestamp: trade.exitTimestamp
          ? new Date(trade.exitTimestamp).toISOString()
          : '',
        exit_price: trade.exitPrice ?? 0,
        exit_reason: trade.exitReason ?? '',
        pnl_sol: trade.realizedPnlSol ?? 0,
        pnl_percent: trade.realizedPnlPercent ?? 0,
        fees_sol: trade.feesPaidSol,
        holding_time_hours: holdingTimeHours,
      };

      rows.push(Object.values(row).join(','));
    }

    return rows.join('\n');
  }

  /**
   * Exports daily P&L to CSV
   */
  exportDailyPnlToCsv(result: BacktestResult): string {
    const headers = [
      'date',
      'starting_capital_sol',
      'ending_capital_sol',
      'realized_pnl_sol',
      'trades_executed',
      'wins',
      'losses',
      'win_rate',
    ];

    const rows: string[] = [headers.join(',')];

    for (const daily of result.dailyPnl) {
      const winRate =
        daily.tradesExecuted > 0
          ? ((daily.wins / daily.tradesExecuted) * 100).toFixed(1)
          : '0.0';

      rows.push(
        [
          daily.date,
          daily.startingCapitalSol.toFixed(4),
          daily.endingCapitalSol.toFixed(4),
          daily.realizedPnlSol.toFixed(4),
          daily.tradesExecuted,
          daily.wins,
          daily.losses,
          winRate,
        ].join(',')
      );
    }

    return rows.join('\n');
  }

  /**
   * Exports equity curve to CSV
   */
  exportEquityCurveToCsv(result: BacktestResult): string {
    const headers = ['timestamp', 'capital_sol', 'unrealized_pnl_sol', 'drawdown_percent'];
    const rows: string[] = [headers.join(',')];

    for (const point of result.equityCurve) {
      rows.push(
        [
          new Date(point.timestamp).toISOString(),
          point.capitalSol.toFixed(4),
          point.unrealizedPnlSol.toFixed(4),
          point.drawdownPercent.toFixed(2),
        ].join(',')
      );
    }

    return rows.join('\n');
  }

  // ===========================================================================
  // FILE OPERATIONS
  // ===========================================================================

  /**
   * Saves report to files
   */
  async saveReport(
    result: BacktestResult,
    outputDir: string,
    tokens: HistoricalToken[] = []
  ): Promise<{
    reportPath: string;
    tradesPath: string;
    dailyPnlPath: string;
    equityPath: string;
  }> {
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Generate and save text report
    const report = this.generateReport(result, tokens);
    const reportText = this.formatAsText(report);
    const reportPath = path.join(outputDir, `backtest-report-${timestamp}.txt`);
    fs.writeFileSync(reportPath, reportText);

    // Save trades CSV
    const tradesCsv = this.exportTradesToCsv(result);
    const tradesPath = path.join(outputDir, `trades-${timestamp}.csv`);
    fs.writeFileSync(tradesPath, tradesCsv);

    // Save daily P&L CSV
    const dailyPnlCsv = this.exportDailyPnlToCsv(result);
    const dailyPnlPath = path.join(outputDir, `daily-pnl-${timestamp}.csv`);
    fs.writeFileSync(dailyPnlPath, dailyPnlCsv);

    // Save equity curve CSV
    const equityCsv = this.exportEquityCurveToCsv(result);
    const equityPath = path.join(outputDir, `equity-curve-${timestamp}.csv`);
    fs.writeFileSync(equityPath, equityCsv);

    logger.info('Reports saved', {
      reportPath,
      tradesPath,
      dailyPnlPath,
      equityPath,
    });

    return {
      reportPath,
      tradesPath,
      dailyPnlPath,
      equityPath,
    };
  }

  // ===========================================================================
  // CONSOLE OUTPUT
  // ===========================================================================

  /**
   * Prints summary to console
   */
  printSummary(result: BacktestResult): void {
    const m = result.metrics;

    console.log('\n');
    console.log('='.repeat(50));
    console.log('           BACKTEST RESULTS SUMMARY');
    console.log('='.repeat(50));
    console.log(`  Total P&L:       ${m.totalPnlSol >= 0 ? '+' : ''}${m.totalPnlSol.toFixed(4)} SOL (${m.totalPnlPercent >= 0 ? '+' : ''}${m.totalPnlPercent.toFixed(2)}%)`);
    console.log(`  Final Capital:   ${m.finalCapitalSol.toFixed(4)} SOL`);
    console.log('-'.repeat(50));
    console.log(`  Total Trades:    ${m.totalTrades}`);
    console.log(`  Win Rate:        ${m.winRate.toFixed(1)}%`);
    console.log(`  Profit Factor:   ${m.profitFactor.toFixed(2)}`);
    console.log('-'.repeat(50));
    console.log(`  Sharpe Ratio:    ${m.sharpeRatio.toFixed(2)}`);
    console.log(`  Max Drawdown:    ${m.maxDrawdownPercent.toFixed(1)}%`);
    console.log('-'.repeat(50));
    console.log(`  Avg Win:         +${m.averageWinSol.toFixed(4)} SOL`);
    console.log(`  Avg Loss:        -${m.averageLossSol.toFixed(4)} SOL`);
    console.log(`  Largest Win:     +${m.largestWinSol.toFixed(4)} SOL`);
    console.log(`  Largest Loss:    -${m.largestLossSol.toFixed(4)} SOL`);
    console.log('='.repeat(50));
    console.log('\n');
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const reporter = new ReportGenerator();

// Convenience exports
export const generateReport = (result: BacktestResult, tokens?: HistoricalToken[]) =>
  reporter.generateReport(result, tokens);

export const saveReport = (
  result: BacktestResult,
  outputDir: string,
  tokens?: HistoricalToken[]
) => reporter.saveReport(result, outputDir, tokens);

export const printSummary = (result: BacktestResult) => reporter.printSummary(result);
