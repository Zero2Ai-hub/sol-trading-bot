/**
 * Environment Configuration with Zod Validation
 *
 * Validates all environment variables on startup and provides
 * a type-safe configuration object.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

const envSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Chainstack gRPC Configuration (Primary for Yellowstone gRPC)
  CHAINSTACK_GRPC_URL: z.string().url('CHAINSTACK_GRPC_URL must be a valid URL').optional(),
  CHAINSTACK_GRPC_TOKEN: z.string().optional(),

  // Helius RPC Configuration (Used for RPC calls, WebSocket, backup)
  HELIUS_RPC_URL: z.string().url('HELIUS_RPC_URL must be a valid URL'),
  HELIUS_WS_URL: z.string().url('HELIUS_WS_URL must be a valid URL'),
  HELIUS_API_KEY: z.string().min(1, 'HELIUS_API_KEY is required'),
  BACKUP_RPC_URLS: z
    .string()
    .transform(val => (val ? val.split(',').map(s => s.trim()).filter(Boolean) : []))
    .default(''),
  RPC_HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  RPC_MAX_LATENCY_MS: z.coerce.number().int().positive().default(500),

  // Wallet Configuration (CRITICAL)
  WALLET_PRIVATE_KEY: z.string().min(1, 'WALLET_PRIVATE_KEY is required'),
  WALLET_2_PRIVATE_KEY: z.string().optional(),
  WALLET_3_PRIVATE_KEY: z.string().optional(),
  WALLET_ENCRYPTION_KEY: z.string().length(64, 'WALLET_ENCRYPTION_KEY must be 64 hex chars').optional(),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),
  DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  // Trading Parameters
  MAX_POSITION_SIZE_SOL: z.coerce.number().positive().default(0.5),
  MAX_CONCURRENT_POSITIONS: z.coerce.number().int().positive().default(3),
  MAX_TOTAL_EXPOSURE_SOL: z.coerce.number().positive().default(2.0),
  MIN_MOMENTUM_SCORE: z.coerce.number().min(0).max(100).default(65),
  BONDING_CURVE_MIN_PERCENT: z.coerce.number().min(0).max(100).default(70),
  BONDING_CURVE_MAX_PERCENT: z.coerce.number().min(0).max(100).default(95),

  // Risk Management
  DAILY_LOSS_LIMIT_PERCENT: z.coerce.number().min(0).max(100).default(10),
  MAX_DRAWDOWN_PERCENT: z.coerce.number().min(0).max(100).default(15),
  DEFAULT_STOP_LOSS_PERCENT: z.coerce.number().min(0).max(100).default(15),
  TAKE_PROFIT_LEVELS: z
    .string()
    .transform(val => val.split(',').map(s => parseFloat(s.trim())))
    .default('25,50,100'),
  TAKE_PROFIT_PERCENTAGES: z
    .string()
    .transform(val => val.split(',').map(s => parseFloat(s.trim())))
    .default('30,40,30'),

  // Execution Settings
  USE_JITO: z.coerce.boolean().default(true),
  JITO_BLOCK_ENGINE_URL: z.string().url().default('https://mainnet.block-engine.jito.wtf'),
  JITO_TIP_LAMPORTS: z.coerce.number().int().nonnegative().default(10000),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(5000).default(500),
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().nonnegative().default(10000),
  MAX_PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().nonnegative().default(500000),
  TX_CONFIRMATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MAX_TX_RETRIES: z.coerce.number().int().min(0).default(3),

  // Jupiter API
  JUPITER_API_URL: z.string().url().default('https://quote-api.jup.ag/v6'),
  JUPITER_PRICE_API_URL: z.string().url().default('https://price.jup.ag/v6'),
  JUPITER_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(60),

  // Monitoring & Alerts
  ENABLE_PAPER_TRADING: z.coerce.boolean().default(true),
  DISCORD_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  ALERT_ON_TRADE: z.coerce.boolean().default(true),
  ALERT_ON_ERROR: z.coerce.boolean().default(true),
  ALERT_ON_KILL_SWITCH: z.coerce.boolean().default(true),

  // Logging
  LOG_DIR: z.string().default('./data/logs'),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  TRADE_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  LOG_TO_CONSOLE: z.coerce.boolean().default(true),
  LOG_TO_FILE: z.coerce.boolean().default(true),
});

// =============================================================================
// VALIDATION & EXPORT
// =============================================================================

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

/**
 * Validates and returns the environment configuration.
 * Caches the result for subsequent calls.
 *
 * @throws {Error} If any required environment variable is missing or invalid
 */
export function getEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  // Additional validation: take profit levels and percentages must match
  if (result.data.TAKE_PROFIT_LEVELS.length !== result.data.TAKE_PROFIT_PERCENTAGES.length) {
    throw new Error(
      'TAKE_PROFIT_LEVELS and TAKE_PROFIT_PERCENTAGES must have the same number of values'
    );
  }

  // Additional validation: take profit percentages must sum to 100
  const tpSum = result.data.TAKE_PROFIT_PERCENTAGES.reduce((a, b) => a + b, 0);
  if (Math.abs(tpSum - 100) > 0.01) {
    throw new Error(`TAKE_PROFIT_PERCENTAGES must sum to 100 (got ${tpSum})`);
  }

  // Additional validation: bonding curve min < max
  if (result.data.BONDING_CURVE_MIN_PERCENT >= result.data.BONDING_CURVE_MAX_PERCENT) {
    throw new Error('BONDING_CURVE_MIN_PERCENT must be less than BONDING_CURVE_MAX_PERCENT');
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/**
 * Resets the cached configuration.
 * Useful for testing or when environment variables change.
 */
export function resetEnvConfig(): void {
  cachedConfig = null;
}

/**
 * Checks if a specific environment variable is set.
 */
export function hasEnvVar(key: string): boolean {
  return process.env[key] !== undefined && process.env[key] !== '';
}

/**
 * Gets a sanitized version of the config for logging.
 * Removes sensitive values like private keys.
 */
export function getSanitizedConfig(): Record<string, unknown> {
  const config = getEnvConfig();
  return {
    ...config,
    WALLET_PRIVATE_KEY: '[REDACTED]',
    WALLET_2_PRIVATE_KEY: config.WALLET_2_PRIVATE_KEY ? '[REDACTED]' : undefined,
    WALLET_3_PRIVATE_KEY: config.WALLET_3_PRIVATE_KEY ? '[REDACTED]' : undefined,
    WALLET_ENCRYPTION_KEY: config.WALLET_ENCRYPTION_KEY ? '[REDACTED]' : undefined,
    HELIUS_API_KEY: '[REDACTED]',
    CHAINSTACK_GRPC_TOKEN: config.CHAINSTACK_GRPC_TOKEN ? '[REDACTED]' : undefined,
    DATABASE_URL: config.DATABASE_URL.replace(/:[^:@]+@/, ':****@'),
    DISCORD_WEBHOOK_URL: config.DISCORD_WEBHOOK_URL ? '[REDACTED]' : undefined,
    TELEGRAM_BOT_TOKEN: config.TELEGRAM_BOT_TOKEN ? '[REDACTED]' : undefined,
  };
}
