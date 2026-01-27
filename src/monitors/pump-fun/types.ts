/**
 * Pump.fun Type Definitions
 *
 * TypeScript interfaces for Pump.fun on-chain data structures.
 * Based on reverse engineering of the Pump.fun program.
 */

import type { SolanaAddress, Timestamp } from '../../core/types.js';

// =============================================================================
// BONDING CURVE CONSTANTS
// =============================================================================

/**
 * Pump.fun bonding curve parameters
 */
export const BONDING_CURVE_CONSTANTS = {
  /** Initial virtual token reserves (1.073B tokens with 6 decimals) */
  INITIAL_VIRTUAL_TOKEN_RESERVES: 1_073_000_000_000_000n,

  /** Initial virtual SOL reserves (30 SOL in lamports) */
  INITIAL_VIRTUAL_SOL_RESERVES: 30_000_000_000n,

  /** SOL threshold for graduation (~85 SOL in lamports) */
  GRADUATION_SOL_THRESHOLD: 85_000_000_000n,

  /** Token decimals (Pump.fun tokens use 6 decimals) */
  TOKEN_DECIMALS: 6,

  /** Total token supply (1B tokens) */
  TOTAL_SUPPLY: 1_000_000_000_000_000n,

  /** Graduation market cap in USD (~$69,000) */
  GRADUATION_MARKET_CAP_USD: 69_000,

  /** Fee percentage on buys/sells (1%) */
  FEE_PERCENTAGE: 1,
} as const;

// =============================================================================
// ACCOUNT STRUCTURES
// =============================================================================

/**
 * Bonding curve account state
 * Size: ~200 bytes
 */
export interface BondingCurveState {
  /** Account discriminator (first 8 bytes) */
  discriminator: bigint;

  /** Virtual token reserves for AMM calculation */
  virtualTokenReserves: bigint;

  /** Virtual SOL reserves for AMM calculation */
  virtualSolReserves: bigint;

  /** Actual tokens held in the bonding curve */
  realTokenReserves: bigint;

  /** Actual SOL held in the bonding curve */
  realSolReserves: bigint;

  /** Total token supply */
  tokenTotalSupply: bigint;

  /** Whether the curve has completed (migrated) */
  complete: boolean;
}

/**
 * Parsed bonding curve with calculated metrics
 */
export interface ParsedBondingCurve extends BondingCurveState {
  /** Bonding curve account address */
  bondingCurveAddress: SolanaAddress;

  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Progress toward graduation (0-100%) */
  progressPercent: number;

  /** Current token price in SOL */
  currentPriceSol: number;

  /** Market cap in SOL */
  marketCapSol: number;

  /** Is in entry zone (70-95%)? */
  inEntryZone: boolean;

  /** Is near graduation (>90%)? */
  nearGraduation: boolean;

  /** Timestamp of parsing */
  parsedAt: Timestamp;
}

// =============================================================================
// INSTRUCTION TYPES
// =============================================================================

/**
 * Pump.fun instruction discriminators (first 8 bytes of instruction data)
 */
export const INSTRUCTION_DISCRIMINATORS = {
  /** Create token instruction */
  CREATE: Buffer.from([0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77]),

  /** Buy tokens instruction */
  BUY: Buffer.from([0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea]),

  /** Sell tokens instruction */
  SELL: Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]),

  /** Withdraw (migration) instruction */
  WITHDRAW: Buffer.from([0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22]),
} as const;

/**
 * Instruction type enum
 */
export enum PumpFunInstructionType {
  CREATE = 'CREATE',
  BUY = 'BUY',
  SELL = 'SELL',
  WITHDRAW = 'WITHDRAW',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Parsed create instruction
 */
export interface CreateInstruction {
  type: PumpFunInstructionType.CREATE;
  name: string;
  symbol: string;
  uri: string;
  mint: SolanaAddress;
  bondingCurve: SolanaAddress;
  creator: SolanaAddress;
}

/**
 * Parsed buy instruction
 */
export interface BuyInstruction {
  type: PumpFunInstructionType.BUY;
  mint: SolanaAddress;
  bondingCurve: SolanaAddress;
  buyer: SolanaAddress;
  solAmount: bigint;
  tokenAmount: bigint;
  maxSolCost: bigint;
}

/**
 * Parsed sell instruction
 */
export interface SellInstruction {
  type: PumpFunInstructionType.SELL;
  mint: SolanaAddress;
  bondingCurve: SolanaAddress;
  seller: SolanaAddress;
  tokenAmount: bigint;
  solAmount: bigint;
  minSolOutput: bigint;
}

/**
 * Parsed withdraw (migration) instruction
 */
export interface WithdrawInstruction {
  type: PumpFunInstructionType.WITHDRAW;
  mint: SolanaAddress;
  bondingCurve: SolanaAddress;
}

/**
 * Unknown instruction
 */
export interface UnknownInstruction {
  type: PumpFunInstructionType.UNKNOWN;
  data: Buffer;
}

/**
 * Union of all instruction types
 */
export type PumpFunInstruction =
  | CreateInstruction
  | BuyInstruction
  | SellInstruction
  | WithdrawInstruction
  | UnknownInstruction;

// =============================================================================
// TRANSACTION TYPES
// =============================================================================

/**
 * Parsed Pump.fun transaction
 */
export interface ParsedPumpFunTransaction {
  /** Transaction signature */
  signature: string;

  /** Slot number */
  slot: bigint;

  /** Block time (Unix timestamp) */
  blockTime: number | null;

  /** Main instruction type */
  instructionType: PumpFunInstructionType;

  /** Parsed instruction data */
  instruction: PumpFunInstruction;

  /** Success status */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Accounts involved */
  accounts: SolanaAddress[];
}

// =============================================================================
// TOKEN STATE
// =============================================================================

/**
 * Tracked token state in memory
 */
export interface TrackedToken {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Bonding curve address */
  bondingCurveAddress: SolanaAddress;

  /** Token name */
  name?: string;

  /** Token symbol */
  symbol?: string;

  /** Token URI */
  uri?: string;

  /** Creator wallet */
  creator: SolanaAddress;

  /** Current bonding curve state */
  bondingCurve: ParsedBondingCurve | null;

  /** First seen timestamp */
  firstSeenAt: Timestamp;

  /** Last update timestamp */
  lastUpdatedAt: Timestamp;

  /** Number of buys */
  buyCount: number;

  /** Number of sells */
  sellCount: number;

  /** Total SOL volume */
  totalVolumeSol: bigint;

  /** Has migrated to Raydium? */
  hasMigrated: boolean;

  /** Migration timestamp */
  migratedAt?: Timestamp;

  /** Raydium pool address */
  poolAddress?: SolanaAddress;
}

// =============================================================================
// EVENT LOG TYPES
// =============================================================================

/**
 * Pump.fun program log event patterns
 */
export const LOG_PATTERNS = {
  /** Token creation log */
  TOKEN_CREATED: /Program log: Instruction: Create/,

  /** Buy event log */
  BUY_EVENT: /Program log: Instruction: Buy/,

  /** Sell event log */
  SELL_EVENT: /Program log: Instruction: Sell/,

  /** Withdraw (migration) log */
  WITHDRAW_EVENT: /Program log: Instruction: Withdraw/,

  /** Token mint pattern */
  MINT_PATTERN: /mint: ([1-9A-HJ-NP-Za-km-z]{32,44})/,

  /** SOL amount pattern */
  SOL_AMOUNT_PATTERN: /sol_amount: (\d+)/,

  /** Token amount pattern */
  TOKEN_AMOUNT_PATTERN: /token_amount: (\d+)/,
} as const;

// =============================================================================
// ACCOUNT LAYOUT OFFSETS
// =============================================================================

/**
 * Byte offsets for bonding curve account fields
 */
export const BONDING_CURVE_OFFSETS = {
  DISCRIMINATOR: 0,
  VIRTUAL_TOKEN_RESERVES: 8,
  VIRTUAL_SOL_RESERVES: 16,
  REAL_TOKEN_RESERVES: 24,
  REAL_SOL_RESERVES: 32,
  TOKEN_TOTAL_SUPPLY: 40,
  COMPLETE: 48,
} as const;

/**
 * Expected bonding curve account size
 */
export const BONDING_CURVE_ACCOUNT_SIZE = 49;
