/**
 * Logger Transports
 *
 * Custom Winston transports for the trading bot.
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

// =============================================================================
// FORMATS
// =============================================================================

/**
 * JSON format for structured logging
 */
export const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Console format with colors and readable output
 */
export const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ level, message, timestamp, component, ...meta }) => {
    const componentStr = component ? `[${component}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level} ${componentStr} ${message}${metaStr}`;
  })
);

/**
 * Trade log format - includes all fields for analysis
 */
export const tradeFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.json()
);

// =============================================================================
// TRANSPORT FACTORY
// =============================================================================

export interface TransportOptions {
  logDir: string;
  level: string;
  retentionDays: number;
  tradeRetentionDays: number;
  logToConsole: boolean;
  logToFile: boolean;
}

/**
 * Creates all transports based on configuration
 */
export function createTransports(options: TransportOptions): winston.transport[] {
  const transports: winston.transport[] = [];

  // Ensure log directory exists
  if (options.logToFile) {
    ensureDirectory(options.logDir);
  }

  // Console transport
  if (options.logToConsole) {
    transports.push(
      new winston.transports.Console({
        level: options.level,
        format: consoleFormat,
      })
    );
  }

  // File transports (if enabled)
  if (options.logToFile) {
    // Combined log (all levels)
    transports.push(
      new DailyRotateFile({
        dirname: options.logDir,
        filename: 'combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: options.level,
        format: jsonFormat,
        maxFiles: `${options.retentionDays}d`,
        maxSize: '100m',
        zippedArchive: true,
      })
    );

    // Error log (error level only)
    transports.push(
      new DailyRotateFile({
        dirname: options.logDir,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        format: jsonFormat,
        maxFiles: `${options.retentionDays}d`,
        maxSize: '50m',
        zippedArchive: true,
      })
    );
  }

  return transports;
}

/**
 * Creates a transport specifically for trade logs
 */
export function createTradeTransport(options: TransportOptions): winston.transport | null {
  if (!options.logToFile) {
    return null;
  }

  const tradeLogDir = path.join(options.logDir, 'trades');
  ensureDirectory(tradeLogDir);

  return new DailyRotateFile({
    dirname: tradeLogDir,
    filename: 'trades-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'info',
    format: tradeFormat,
    maxFiles: `${options.tradeRetentionDays}d`,
    maxSize: '100m',
    zippedArchive: true,
  });
}

/**
 * Creates a transport for component-specific logs
 */
export function createComponentTransport(
  options: TransportOptions,
  componentName: string
): winston.transport | null {
  if (!options.logToFile) {
    return null;
  }

  const componentLogDir = path.join(options.logDir, 'components');
  ensureDirectory(componentLogDir);

  return new DailyRotateFile({
    dirname: componentLogDir,
    filename: `${componentName}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    level: options.level,
    format: jsonFormat,
    maxFiles: `${options.retentionDays}d`,
    maxSize: '50m',
    zippedArchive: true,
  });
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Ensures a directory exists, creating it if necessary
 */
function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
