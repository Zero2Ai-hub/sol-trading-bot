/**
 * Configuration Module
 *
 * Central configuration aggregator that combines environment variables,
 * constants, and network settings into a unified config object.
 */

import { getEnvConfig, getSanitizedConfig, type EnvConfig } from './env.js';
import {
  PUMP_FUN_PROGRAM_ID,
  PUMP_FUN_MIGRATION_ACCOUNT,
  RAYDIUM_LP_V4_PROGRAM_ID,
  JUPITER_V6_PROGRAM_ID,
  WSOL_MINT,
  USDC_MINT,
  JITO_TIP_ACCOUNTS,
  BONDING_CURVE,
  MOMENTUM_THRESHOLDS,
  SAFETY_THRESHOLDS,
  EXECUTION,
  TIMING,
} from './constants.js';
import {
  getNetworkConfig,
  detectNetworkFromUrl,
  getSolscanTxUrl,
  getSolscanTokenUrl,
  supportsJito,
  type NetworkConfig,
} from './networks.js';

// =============================================================================
// AGGREGATED CONFIG TYPE
// =============================================================================

export interface AppConfig {
  // Environment config
  env: EnvConfig;

  // Detected network
  network: NetworkConfig;

  // Program addresses
  programs: {
    pumpFun: string;
    pumpFunMigration: string;
    raydiumLpV4: string;
    jupiterV6: string;
  };

  // Token addresses
  tokens: {
    wsol: string;
    usdc: string;
  };

  // Trading thresholds
  trading: {
    bondingCurve: typeof BONDING_CURVE;
    momentum: typeof MOMENTUM_THRESHOLDS;
    safety: typeof SAFETY_THRESHOLDS;
    execution: typeof EXECUTION;
  };

  // Timing configuration
  timing: typeof TIMING;

  // Jito configuration
  jito: {
    enabled: boolean;
    blockEngineUrl: string;
    tipLamports: number;
    tipAccounts: readonly string[];
  };

  // Risk limits (computed from env)
  risk: {
    maxPositionSizeSol: number;
    maxConcurrentPositions: number;
    maxTotalExposureSol: number;
    dailyLossLimitPercent: number;
    maxDrawdownPercent: number;
    defaultStopLossPercent: number;
    takeProfitLevels: number[];
    takeProfitPercentages: number[];
  };

  // Feature flags
  features: {
    paperTrading: boolean;
    useJito: boolean;
    alertOnTrade: boolean;
    alertOnError: boolean;
    alertOnKillSwitch: boolean;
  };
}

// =============================================================================
// CONFIG BUILDER
// =============================================================================

let cachedAppConfig: AppConfig | null = null;

/**
 * Builds and returns the complete application configuration.
 * Validates environment variables and constructs a unified config object.
 *
 * @throws {Error} If environment validation fails
 */
export function getConfig(): AppConfig {
  if (cachedAppConfig) {
    return cachedAppConfig;
  }

  const env = getEnvConfig();
  const network = getNetworkConfig(detectNetworkFromUrl(env.HELIUS_RPC_URL));

  cachedAppConfig = {
    env,
    network,

    programs: {
      pumpFun: PUMP_FUN_PROGRAM_ID,
      pumpFunMigration: PUMP_FUN_MIGRATION_ACCOUNT,
      raydiumLpV4: RAYDIUM_LP_V4_PROGRAM_ID,
      jupiterV6: JUPITER_V6_PROGRAM_ID,
    },

    tokens: {
      wsol: WSOL_MINT,
      usdc: USDC_MINT,
    },

    trading: {
      bondingCurve: BONDING_CURVE,
      momentum: MOMENTUM_THRESHOLDS,
      safety: SAFETY_THRESHOLDS,
      execution: EXECUTION,
    },

    timing: TIMING,

    jito: {
      enabled: env.USE_JITO && supportsJito(network.name),
      blockEngineUrl: env.JITO_BLOCK_ENGINE_URL,
      tipLamports: env.JITO_TIP_LAMPORTS,
      tipAccounts: JITO_TIP_ACCOUNTS,
    },

    risk: {
      maxPositionSizeSol: env.MAX_POSITION_SIZE_SOL,
      maxConcurrentPositions: env.MAX_CONCURRENT_POSITIONS,
      maxTotalExposureSol: env.MAX_TOTAL_EXPOSURE_SOL,
      dailyLossLimitPercent: env.DAILY_LOSS_LIMIT_PERCENT,
      maxDrawdownPercent: env.MAX_DRAWDOWN_PERCENT,
      defaultStopLossPercent: env.DEFAULT_STOP_LOSS_PERCENT,
      takeProfitLevels: env.TAKE_PROFIT_LEVELS,
      takeProfitPercentages: env.TAKE_PROFIT_PERCENTAGES,
    },

    features: {
      paperTrading: env.ENABLE_PAPER_TRADING,
      useJito: env.USE_JITO,
      alertOnTrade: env.ALERT_ON_TRADE,
      alertOnError: env.ALERT_ON_ERROR,
      alertOnKillSwitch: env.ALERT_ON_KILL_SWITCH,
    },
  };

  return cachedAppConfig;
}

/**
 * Resets the cached configuration.
 * Useful for testing or when environment variables change.
 */
export function resetConfig(): void {
  cachedAppConfig = null;
}

/**
 * Gets a version of the config safe for logging (no secrets).
 */
export function getLoggableConfig(): Record<string, unknown> {
  return getSanitizedConfig();
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export { getEnvConfig, getSanitizedConfig, type EnvConfig } from './env.js';
export * from './constants.js';
export * from './networks.js';

// Export helper for constructing URLs
export const urls = {
  solscanTx: getSolscanTxUrl,
  solscanToken: getSolscanTokenUrl,
};
