/**
 * Structured Logger
 *
 * Production-ready logging infrastructure with:
 * - Structured JSON logging for analysis
 * - Daily file rotation
 * - Component-specific loggers
 * - Trade-specific logging with extended retention
 * - Sensitive data sanitization
 */

import winston from 'winston';
import { getEnvConfig } from '../../config/env.js';
import { sanitizeObject } from '../../utils/formatting.js';
import {
  createTransports,
  createTradeTransport,
  createComponentTransport,
  type TransportOptions,
} from './transports.js';

// =============================================================================
// TYPES
// =============================================================================

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogMeta {
  component?: string;
  [key: string]: unknown;
}

export interface TradeLogData {
  action: 'OPEN' | 'CLOSE' | 'STOP_LOSS' | 'TAKE_PROFIT';
  token: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  signature?: string;
  pnl?: number;
  pnlPercent?: number;
  executionTimeMs?: number;
  slippageBps?: number;
  [key: string]: unknown;
}

// =============================================================================
// SENSITIVE KEYS (for sanitization)
// =============================================================================

const SENSITIVE_KEYS = [
  'privateKey',
  'secretKey',
  'password',
  'apiKey',
  'token',
  'secret',
  'authorization',
  'credential',
  'encryptionKey',
  'webhookUrl',
];

// =============================================================================
// LOGGER CLASS
// =============================================================================

class Logger {
  private mainLogger: winston.Logger;
  private tradeLogger: winston.Logger | null = null;
  private componentLoggers: Map<string, winston.Logger> = new Map();
  private options: TransportOptions;
  private initialized = false;

  constructor() {
    // Create a minimal logger for startup
    this.mainLogger = winston.createLogger({
      level: 'info',
      transports: [new winston.transports.Console()],
    });

    this.options = {
      logDir: './data/logs',
      level: 'info',
      retentionDays: 30,
      tradeRetentionDays: 90,
      logToConsole: true,
      logToFile: false,
    };
  }

  /**
   * Initializes the logger with configuration.
   * Should be called after environment validation.
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      const env = getEnvConfig();

      this.options = {
        logDir: env.LOG_DIR,
        level: env.LOG_LEVEL,
        retentionDays: env.LOG_RETENTION_DAYS,
        tradeRetentionDays: env.TRADE_LOG_RETENTION_DAYS,
        logToConsole: env.LOG_TO_CONSOLE,
        logToFile: env.LOG_TO_FILE,
      };

      // Create main logger
      this.mainLogger = winston.createLogger({
        level: this.options.level,
        transports: createTransports(this.options),
        exitOnError: false,
      });

      // Create trade logger
      const tradeTransport = createTradeTransport(this.options);
      if (tradeTransport) {
        this.tradeLogger = winston.createLogger({
          level: 'info',
          transports: [tradeTransport],
          exitOnError: false,
        });
      }

      this.initialized = true;
      this.info('Logger initialized', { options: this.options });
    } catch (error) {
      // Fallback to console if initialization fails
      console.error('Failed to initialize logger:', error);
    }
  }

  /**
   * Gets or creates a component-specific logger
   */
  getComponentLogger(componentName: string): ComponentLogger {
    if (!this.componentLoggers.has(componentName)) {
      const transport = createComponentTransport(this.options, componentName);
      const transports: winston.transport[] = transport
        ? [transport, ...createTransports({ ...this.options, logToFile: false })]
        : createTransports(this.options);

      const componentLogger = winston.createLogger({
        level: this.options.level,
        defaultMeta: { component: componentName },
        transports,
        exitOnError: false,
      });

      this.componentLoggers.set(componentName, componentLogger);
    }

    return new ComponentLogger(
      componentName,
      this.componentLoggers.get(componentName)!,
      this.tradeLogger
    );
  }

  // ---------------------------------------------------------------------------
  // Logging Methods
  // ---------------------------------------------------------------------------

  error(message: string, meta?: LogMeta): void {
    this.log('error', message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: LogMeta): void {
    this.log('info', message, meta);
  }

  debug(message: string, meta?: LogMeta): void {
    this.log('debug', message, meta);
  }

  trace(message: string, meta?: LogMeta): void {
    this.log('trace' as LogLevel, message, meta);
  }

  /**
   * Logs a trade event (goes to separate trade log with extended retention)
   */
  trade(data: TradeLogData): void {
    const sanitized = sanitizeObject(data, SENSITIVE_KEYS);
    const logData = {
      event: 'TRADE',
      ...sanitized,
    };

    // Log to trade logger (file)
    this.tradeLogger?.info(logData);

    // Also log to main logger
    this.info(`Trade ${data.action}: ${data.side} ${data.token}`, sanitized);
  }

  /**
   * Logs a structured event
   */
  event(eventType: string, data: Record<string, unknown>): void {
    const sanitized = sanitizeObject(data, SENSITIVE_KEYS);
    this.info(eventType, { event: eventType, ...sanitized });
  }

  // ---------------------------------------------------------------------------
  // Internal Methods
  // ---------------------------------------------------------------------------

  private log(level: LogLevel, message: string, meta?: LogMeta): void {
    const sanitizedMeta = meta ? sanitizeObject(meta, SENSITIVE_KEYS) : {};
    this.mainLogger.log(level, message, sanitizedMeta);
  }
}

// =============================================================================
// COMPONENT LOGGER CLASS
// =============================================================================

/**
 * Logger instance for a specific component.
 * Automatically adds component name to all log entries.
 */
export class ComponentLogger {
  constructor(
    private componentName: string,
    private logger: winston.Logger,
    private tradeLogger: winston.Logger | null
  ) {}

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  trace(message: string, meta?: Record<string, unknown>): void {
    this.log('trace' as LogLevel, message, meta);
  }

  trade(data: TradeLogData): void {
    const sanitized = sanitizeObject(data, SENSITIVE_KEYS);
    const logData = {
      event: 'TRADE',
      component: this.componentName,
      ...sanitized,
    };

    this.tradeLogger?.info(logData);
    this.info(`Trade ${data.action}: ${data.side} ${data.token}`, sanitized);
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const sanitizedMeta = meta ? sanitizeObject(meta, SENSITIVE_KEYS) : {};
    this.logger.log(level, message, sanitizedMeta);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const logger = new Logger();

// Export convenience methods bound to the singleton
export const error = (message: string, meta?: LogMeta) => logger.error(message, meta);
export const warn = (message: string, meta?: LogMeta) => logger.warn(message, meta);
export const info = (message: string, meta?: LogMeta) => logger.info(message, meta);
export const debug = (message: string, meta?: LogMeta) => logger.debug(message, meta);
export const trace = (message: string, meta?: LogMeta) => logger.trace(message, meta);
export const trade = (data: TradeLogData) => logger.trade(data);
export const event = (eventType: string, data: Record<string, unknown>) =>
  logger.event(eventType, data);
export const getComponentLogger = (name: string) => logger.getComponentLogger(name);
export const initializeLogger = () => logger.initialize();
