/**
 * CLI Dashboard
 *
 * Terminal-based real-time status display for the trading bot.
 */

import { getComponentLogger } from '../infrastructure/logger/index.js';
import { type BotState, type DashboardData, BotStatus, HealthStatus } from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const logger = getComponentLogger('Dashboard');

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Formats duration in human-readable form
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Formats SOL amount
 */
function formatSol(amount: number): string {
  return amount.toFixed(4);
}

/**
 * Formats percentage
 */
function formatPercent(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Gets color for P&L
 */
function getPnlColor(pnl: number): string {
  if (pnl > 0) return COLORS.green;
  if (pnl < 0) return COLORS.red;
  return COLORS.white;
}

/**
 * Gets color for status
 */
function getStatusColor(status: BotStatus): string {
  switch (status) {
    case BotStatus.RUNNING:
      return COLORS.green;
    case BotStatus.PAUSED:
      return COLORS.yellow;
    case BotStatus.INITIALIZING:
    case BotStatus.SHUTTING_DOWN:
      return COLORS.cyan;
    case BotStatus.ERROR:
      return COLORS.red;
    default:
      return COLORS.white;
  }
}

/**
 * Gets color for health status
 */
function getHealthColor(status: HealthStatus): string {
  switch (status) {
    case HealthStatus.HEALTHY:
      return COLORS.green;
    case HealthStatus.DEGRADED:
      return COLORS.yellow;
    case HealthStatus.UNHEALTHY:
      return COLORS.red;
    default:
      return COLORS.dim;
  }
}

/**
 * Gets icon for health status
 */
function getHealthIcon(status: HealthStatus): string {
  switch (status) {
    case HealthStatus.HEALTHY:
      return '✓';
    case HealthStatus.DEGRADED:
      return '!';
    case HealthStatus.UNHEALTHY:
      return '✗';
    default:
      return '?';
  }
}

/**
 * Pads string to length
 */
function pad(str: string, len: number, align: 'left' | 'right' = 'left'): string {
  if (str.length >= len) return str.substring(0, len);
  const padding = ' '.repeat(len - str.length);
  return align === 'left' ? str + padding : padding + str;
}

// =============================================================================
// DASHBOARD CLASS
// =============================================================================

/**
 * CLI Dashboard
 */
export class Dashboard {
  private refreshInterval: NodeJS.Timeout | null = null;
  private dataProvider: (() => DashboardData) | null = null;
  private width: number = 60;

  /**
   * Sets the data provider function
   */
  setDataProvider(provider: () => DashboardData): void {
    this.dataProvider = provider;
  }

  /**
   * Starts auto-refresh
   */
  startAutoRefresh(intervalMs: number = 5000): void {
    if (this.refreshInterval) {
      this.stopAutoRefresh();
    }

    this.refreshInterval = setInterval(() => {
      this.render();
    }, intervalMs);

    // Initial render
    this.render();
  }

  /**
   * Stops auto-refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Renders the dashboard
   */
  render(): void {
    if (!this.dataProvider) {
      console.log('No data provider set');
      return;
    }

    const data = this.dataProvider();
    const output = this.generateOutput(data);

    // Clear screen and move cursor to top
    console.clear();
    console.log(output);
  }

  /**
   * Generates dashboard output
   */
  private generateOutput(data: DashboardData): string {
    const lines: string[] = [];
    const w = this.width;

    // Header
    lines.push(this.drawBox('Solana Momentum Trading Bot', w));
    lines.push('');

    // Status section
    lines.push(this.drawStatusSection(data.state));
    lines.push('');

    // Performance section
    lines.push(this.drawPerformanceSection(data.state));
    lines.push('');

    // Positions section
    lines.push(this.drawPositionsSection(data.positions));
    lines.push('');

    // Top tokens section
    lines.push(this.drawTopTokensSection(data.topTokens));
    lines.push('');

    // Health section
    lines.push(this.drawHealthSection(data.state));
    lines.push('');

    // Footer
    const modeText = data.state.paperTradingEnabled ? 'PAPER TRADING' : 'LIVE TRADING';
    const modeColor = data.state.paperTradingEnabled ? COLORS.yellow : COLORS.red;
    lines.push(`${modeColor}${COLORS.bold}  Mode: ${modeText}${COLORS.reset}`);
    lines.push(`${COLORS.dim}  Press Ctrl+C to stop${COLORS.reset}`);

    return lines.join('\n');
  }

  /**
   * Draws a box with title
   */
  private drawBox(title: string, width: number): string {
    const padding = Math.max(0, width - title.length - 4);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;

    return `${COLORS.cyan}┌${'─'.repeat(leftPad)} ${COLORS.bold}${title}${COLORS.reset}${COLORS.cyan} ${'─'.repeat(rightPad)}┐${COLORS.reset}`;
  }

  /**
   * Draws status section
   */
  private drawStatusSection(state: BotState): string {
    const lines: string[] = [];
    const statusColor = getStatusColor(state.status);

    lines.push(`${COLORS.bold}  STATUS${COLORS.reset}`);
    lines.push(`  ├─ Bot:     ${statusColor}${state.status}${COLORS.reset}`);
    lines.push(`  ├─ Uptime:  ${formatDuration(state.uptimeMs)}`);
    lines.push(`  └─ Errors:  ${state.errorsToday > 0 ? COLORS.red : COLORS.green}${state.errorsToday}${COLORS.reset}`);

    return lines.join('\n');
  }

  /**
   * Draws performance section
   */
  private drawPerformanceSection(state: BotState): string {
    const lines: string[] = [];
    const pnlColor = getPnlColor(state.dailyPnlSol);

    lines.push(`${COLORS.bold}  TODAY'S PERFORMANCE${COLORS.reset}`);
    lines.push(`  ├─ Signals:     ${state.signalsGeneratedToday}`);
    lines.push(`  ├─ Trades:      ${state.tradesExecutedToday}`);
    lines.push(`  ├─ P&L:         ${pnlColor}${formatSol(state.dailyPnlSol)} SOL (${formatPercent(state.dailyPnlPercent)})${COLORS.reset}`);
    lines.push(`  └─ Capital:     ${formatSol(state.totalCapitalSol)} SOL (${formatSol(state.capitalAvailableSol)} available)`);

    return lines.join('\n');
  }

  /**
   * Draws positions section
   */
  private drawPositionsSection(positions: DashboardData['positions']): string {
    const lines: string[] = [];

    lines.push(`${COLORS.bold}  OPEN POSITIONS (${positions.length})${COLORS.reset}`);

    if (positions.length === 0) {
      lines.push(`${COLORS.dim}  └─ No open positions${COLORS.reset}`);
    } else {
      positions.slice(0, 5).forEach((pos, idx) => {
        const isLast = idx === positions.length - 1 || idx === 4;
        const prefix = isLast ? '└─' : '├─';
        const pnlColor = getPnlColor(pos.pnlPercent);

        const symbol = pad(pos.symbol, 8);
        const pnl = pad(formatPercent(pos.pnlPercent), 8, 'right');
        const size = pad(`${formatSol(pos.sizeSol)} SOL`, 12, 'right');

        lines.push(`  ${prefix} ${symbol} ${pnlColor}${pnl}${COLORS.reset} ${COLORS.dim}${size}${COLORS.reset}`);
      });

      if (positions.length > 5) {
        lines.push(`${COLORS.dim}      ... and ${positions.length - 5} more${COLORS.reset}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Draws top tokens section
   */
  private drawTopTokensSection(tokens: DashboardData['topTokens']): string {
    const lines: string[] = [];

    lines.push(`${COLORS.bold}  TOP MOMENTUM TOKENS${COLORS.reset}`);

    if (tokens.length === 0) {
      lines.push(`${COLORS.dim}  └─ No tokens tracked${COLORS.reset}`);
    } else {
      tokens.slice(0, 5).forEach((token, idx) => {
        const isLast = idx === tokens.length - 1 || idx === 4;
        const prefix = isLast ? '└─' : '├─';

        const rank = `${idx + 1}.`;
        const symbol = pad(token.symbol, 8);
        const score = pad(`Score: ${token.score}`, 12);

        let signalColor = COLORS.dim;
        let signalIcon = '';
        if (token.signal === 'STRONG_BUY') {
          signalColor = COLORS.green;
          signalIcon = '⚡';
        } else if (token.signal === 'BUY') {
          signalColor = COLORS.cyan;
          signalIcon = '→';
        }

        lines.push(`  ${prefix} ${rank} ${symbol} ${score} ${signalColor}${signalIcon} ${token.signal}${COLORS.reset}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Draws health section
   */
  private drawHealthSection(state: BotState): string {
    const lines: string[] = [];
    const services = Object.values(state.services);

    lines.push(`${COLORS.bold}  SYSTEM HEALTH${COLORS.reset}`);

    services.forEach((service, idx) => {
      const isLast = idx === services.length - 1;
      const prefix = isLast ? '└─' : '├─';
      const color = getHealthColor(service.status);
      const icon = getHealthIcon(service.status);

      const name = pad(service.name, 16);
      const latency = service.latencyMs !== undefined ? `${service.latencyMs}ms` : '';

      lines.push(`  ${prefix} ${color}${icon}${COLORS.reset} ${name} ${COLORS.dim}${latency}${COLORS.reset}`);
    });

    return lines.join('\n');
  }

  /**
   * Prints a one-line status
   */
  printStatus(state: BotState): void {
    const statusColor = getStatusColor(state.status);
    const pnlColor = getPnlColor(state.dailyPnlSol);

    const status = `${statusColor}${state.status}${COLORS.reset}`;
    const pnl = `${pnlColor}${formatSol(state.dailyPnlSol)} SOL${COLORS.reset}`;
    const positions = state.openPositionsCount;
    const tracked = state.trackedTokensCount;

    console.log(
      `[${status}] P&L: ${pnl} | Positions: ${positions} | Tracked: ${tracked} | Trades: ${state.tradesExecutedToday}`
    );
  }

  /**
   * Prints startup banner
   */
  static printBanner(): void {
    console.log(`
${COLORS.cyan}${COLORS.bold}
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   ███████╗ ██████╗ ██╗      ██████╗  ██████╗ ████████╗   ║
  ║   ██╔════╝██╔═══██╗██║      ██╔══██╗██╔═══██╗╚══██╔══╝   ║
  ║   ███████╗██║   ██║██║█████╗██████╔╝██║   ██║   ██║      ║
  ║   ╚════██║██║   ██║██║╚════╝██╔══██╗██║   ██║   ██║      ║
  ║   ███████║╚██████╔╝███████╗ ██████╔╝╚██████╔╝   ██║      ║
  ║   ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝    ╚═╝      ║
  ║                                                           ║
  ║          Solana Momentum Trading Bot v1.0.0               ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
${COLORS.reset}
`);
  }

  /**
   * Prints shutdown message
   */
  static printShutdown(reason: string, durationMs: number): void {
    console.log(`
${COLORS.yellow}${COLORS.bold}
  Bot shutdown complete
  ─────────────────────
  Reason:   ${reason}
  Duration: ${formatDuration(durationMs)}
${COLORS.reset}
`);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const dashboard = new Dashboard();

// Convenience exports
export const printBanner = () => Dashboard.printBanner();
export const printShutdown = (reason: string, duration: number) =>
  Dashboard.printShutdown(reason, duration);
