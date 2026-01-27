/**
 * Constants Configuration
 *
 * All program IDs, addresses, and static thresholds used throughout the bot.
 * These values are verified from on-chain sources.
 */

// =============================================================================
// PROGRAM IDS
// =============================================================================

/**
 * Pump.fun program ID
 * Source: https://solscan.io/account/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
 */
export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/**
 * Pump.fun migration account (monitors for graduated tokens)
 * Source: https://solscan.io/account/39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg
 */
export const PUMP_FUN_MIGRATION_ACCOUNT = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';

/**
 * Pump.fun fee recipient
 */
export const PUMP_FUN_FEE_RECIPIENT = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM';

/**
 * Raydium Liquidity Pool V4 program
 */
export const RAYDIUM_LP_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

/**
 * Raydium AMM program
 */
export const RAYDIUM_AMM_PROGRAM_ID = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';

/**
 * Raydium CPMM program (Constant Product Market Maker)
 */
export const RAYDIUM_CPMM_PROGRAM_ID = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

/**
 * Orca Whirlpool program
 */
export const ORCA_WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';

/**
 * Jupiter Aggregator V6 program
 */
export const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

/**
 * System Program
 */
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/**
 * Token Program (SPL Token)
 */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Token 2022 Program
 */
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Associated Token Account Program
 */
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Memo Program
 */
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// =============================================================================
// TOKEN ADDRESSES
// =============================================================================

/**
 * Wrapped SOL mint address
 */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * USDC mint address (Circle)
 */
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * USDT mint address (Tether)
 */
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// =============================================================================
// JITO TIP ACCOUNTS
// =============================================================================

/**
 * Jito tip accounts - tips must go to one of these addresses
 * Source: https://jito-labs.gitbook.io/mev/searcher-resources/bundles
 */
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
] as const;

// =============================================================================
// BONDING CURVE THRESHOLDS
// =============================================================================

/**
 * Bonding curve configuration for Pump.fun tokens
 */
export const BONDING_CURVE = {
  /**
   * Target market cap for graduation (in USD)
   */
  GRADUATION_MARKET_CAP_USD: 69_000,

  /**
   * Total tokens in bonding curve
   */
  TOTAL_SUPPLY: 1_000_000_000,

  /**
   * Tokens reserved for LP migration
   */
  LP_RESERVE: 200_000_000,

  /**
   * Virtual SOL reserves in the curve
   */
  VIRTUAL_SOL_RESERVES: 30,

  /**
   * Virtual token reserves in the curve
   */
  VIRTUAL_TOKEN_RESERVES: 1_073_000_000,

  /**
   * Minimum bonding progress for entry zone (%)
   */
  MIN_PROGRESS_PERCENT: 70,

  /**
   * Maximum bonding progress for entry zone (%)
   */
  MAX_PROGRESS_PERCENT: 95,

  /**
   * SOL threshold for graduation (lamports)
   */
  GRADUATION_SOL_THRESHOLD: 85_000_000_000n,
} as const;

// =============================================================================
// MOMENTUM SCORING THRESHOLDS
// =============================================================================

export const MOMENTUM_THRESHOLDS = {
  /**
   * Minimum score to consider a token (0-100)
   */
  MIN_SCORE: 50,

  /**
   * Score threshold for BUY signal
   */
  BUY_THRESHOLD: 65,

  /**
   * Score threshold for STRONG_BUY signal
   */
  STRONG_BUY_THRESHOLD: 80,

  /**
   * Volume spike multiplier (vs average)
   */
  VOLUME_SPIKE_MULTIPLIER: 3,

  /**
   * Minimum holder velocity (new holders per minute)
   */
  MIN_HOLDER_VELOCITY: 5,

  /**
   * Maximum holder concentration for top 10 (percentage)
   */
  MAX_TOP_10_CONCENTRATION: 40,
} as const;

// =============================================================================
// SAFETY THRESHOLDS
// =============================================================================

export const SAFETY_THRESHOLDS = {
  /**
   * Minimum liquidity in USD to consider trading
   */
  MIN_LIQUIDITY_USD: 5_000,

  /**
   * Maximum holder concentration for a single wallet (percentage)
   */
  MAX_SINGLE_HOLDER_PERCENT: 10,

  /**
   * Maximum holder concentration for top 10 wallets (percentage)
   */
  MAX_TOP_10_HOLDER_PERCENT: 40,

  /**
   * Maximum price impact allowed (percentage)
   */
  MAX_PRICE_IMPACT_PERCENT: 5,

  /**
   * Minimum token age in seconds before trading
   */
  MIN_TOKEN_AGE_SECONDS: 300, // 5 minutes

  /**
   * Maximum creator holding percentage
   */
  MAX_CREATOR_HOLDING_PERCENT: 5,
} as const;

// =============================================================================
// EXECUTION CONSTANTS
// =============================================================================

export const EXECUTION = {
  /**
   * Lamports per SOL
   */
  LAMPORTS_PER_SOL: 1_000_000_000n,

  /**
   * Default compute unit limit for swaps
   */
  DEFAULT_COMPUTE_UNITS: 200_000,

  /**
   * Maximum compute units for complex transactions
   */
  MAX_COMPUTE_UNITS: 1_400_000,

  /**
   * Maximum transactions per Jito bundle
   */
  MAX_JITO_BUNDLE_SIZE: 5,

  /**
   * Blockhash validity in slots (~400ms per slot)
   */
  BLOCKHASH_VALIDITY_SLOTS: 150,

  /**
   * Default slippage for stable pairs (basis points)
   */
  STABLE_PAIR_SLIPPAGE_BPS: 50,

  /**
   * Default slippage for volatile pairs (basis points)
   */
  VOLATILE_PAIR_SLIPPAGE_BPS: 300,

  /**
   * Slippage for pump.fun tokens (basis points)
   */
  PUMP_FUN_SLIPPAGE_BPS: 1000,
} as const;

// =============================================================================
// TIMING CONSTANTS
// =============================================================================

export const TIMING = {
  /**
   * Interval for polling token metrics (milliseconds)
   */
  METRICS_POLL_INTERVAL_MS: 5_000,

  /**
   * Interval for checking positions (milliseconds)
   */
  POSITION_CHECK_INTERVAL_MS: 1_000,

  /**
   * Interval for RPC health checks (milliseconds)
   */
  RPC_HEALTH_CHECK_INTERVAL_MS: 10_000,

  /**
   * Timeout for RPC requests (milliseconds)
   */
  RPC_REQUEST_TIMEOUT_MS: 10_000,

  /**
   * Debounce time for rapid events (milliseconds)
   */
  EVENT_DEBOUNCE_MS: 100,

  /**
   * Cooldown after a trade before next trade (milliseconds)
   */
  POST_TRADE_COOLDOWN_MS: 5_000,
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type JitoTipAccount = (typeof JITO_TIP_ACCOUNTS)[number];
