/**
 * Pump.fun Data Parser
 *
 * Deserializes bonding curve account data and parses transaction instructions.
 * Calculates bonding progress and detects critical events.
 */

import type { SolanaAddress } from '../../core/types.js';
import { getComponentLogger, type ComponentLogger } from '../../infrastructure/logger/index.js';
import {
  type BondingCurveState,
  type ParsedBondingCurve,
  type PumpFunInstruction,
  type CreateInstruction,
  type BuyInstruction,
  type SellInstruction,
  type WithdrawInstruction,
  PumpFunInstructionType,
  BONDING_CURVE_CONSTANTS,
  BONDING_CURVE_OFFSETS,
  BONDING_CURVE_ACCOUNT_SIZE,
  INSTRUCTION_DISCRIMINATORS,
} from './types.js';
import { BONDING_CURVE } from '../../config/constants.js';

// =============================================================================
// LOGGER
// =============================================================================

let logger: ComponentLogger | null = null;

function getLogger(): ComponentLogger {
  if (!logger) {
    logger = getComponentLogger('pump-fun-parser');
  }
  return logger;
}

// =============================================================================
// BONDING CURVE PARSING
// =============================================================================

/**
 * Parses raw bonding curve account data
 */
export function parseBondingCurveData(data: Buffer | Uint8Array): BondingCurveState | null {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  if (buffer.length < BONDING_CURVE_ACCOUNT_SIZE) {
    getLogger().warn('Bonding curve data too short', {
      expected: BONDING_CURVE_ACCOUNT_SIZE,
      actual: buffer.length,
    });
    return null;
  }

  try {
    return {
      discriminator: buffer.readBigUInt64LE(BONDING_CURVE_OFFSETS.DISCRIMINATOR),
      virtualTokenReserves: buffer.readBigUInt64LE(BONDING_CURVE_OFFSETS.VIRTUAL_TOKEN_RESERVES),
      virtualSolReserves: buffer.readBigUInt64LE(BONDING_CURVE_OFFSETS.VIRTUAL_SOL_RESERVES),
      realTokenReserves: buffer.readBigUInt64LE(BONDING_CURVE_OFFSETS.REAL_TOKEN_RESERVES),
      realSolReserves: buffer.readBigUInt64LE(BONDING_CURVE_OFFSETS.REAL_SOL_RESERVES),
      tokenTotalSupply: buffer.readBigUInt64LE(BONDING_CURVE_OFFSETS.TOKEN_TOTAL_SUPPLY),
      complete: buffer.readUInt8(BONDING_CURVE_OFFSETS.COMPLETE) === 1,
    };
  } catch (error) {
    getLogger().error('Failed to parse bonding curve data', {
      error: error instanceof Error ? error.message : String(error),
      dataLength: buffer.length,
    });
    return null;
  }
}

/**
 * Calculates bonding curve progress percentage
 * Progress is based on realSolReserves approaching the graduation threshold
 */
export function calculateProgress(state: BondingCurveState): number {
  const threshold = BONDING_CURVE_CONSTANTS.GRADUATION_SOL_THRESHOLD;

  if (state.complete) {
    return 100;
  }

  // Progress = (realSolReserves / graduationThreshold) * 100
  const progress = (Number(state.realSolReserves) / Number(threshold)) * 100;

  // Clamp between 0 and 100
  return Math.min(100, Math.max(0, progress));
}

/**
 * Calculates current token price in SOL
 * Uses the constant product formula: x * y = k
 */
export function calculatePrice(state: BondingCurveState): number {
  if (state.virtualTokenReserves === 0n) {
    return 0;
  }

  // Price = virtualSolReserves / virtualTokenReserves
  // Convert to numbers for calculation (precision is OK for display purposes)
  const solReserves = Number(state.virtualSolReserves) / 1e9; // Convert lamports to SOL
  const tokenReserves = Number(state.virtualTokenReserves) / 1e6; // Convert to token units

  return solReserves / tokenReserves;
}

/**
 * Calculates market cap in SOL
 */
export function calculateMarketCapSol(state: BondingCurveState): number {
  const price = calculatePrice(state);
  const totalSupply = Number(state.tokenTotalSupply) / 1e6;
  return price * totalSupply;
}

/**
 * Parses bonding curve account into a full parsed structure
 */
export function parseBondingCurve(
  data: Buffer | Uint8Array,
  bondingCurveAddress: SolanaAddress,
  mintAddress: SolanaAddress
): ParsedBondingCurve | null {
  const state = parseBondingCurveData(data);

  if (!state) {
    return null;
  }

  const progressPercent = calculateProgress(state);

  return {
    ...state,
    bondingCurveAddress,
    mintAddress,
    progressPercent,
    currentPriceSol: calculatePrice(state),
    marketCapSol: calculateMarketCapSol(state),
    inEntryZone: progressPercent >= BONDING_CURVE.MIN_PROGRESS_PERCENT &&
                 progressPercent <= BONDING_CURVE.MAX_PROGRESS_PERCENT,
    nearGraduation: progressPercent >= 90,
    parsedAt: Date.now(),
  };
}

/**
 * Checks if bonding curve is in the entry zone (70-95%)
 */
export function isInEntryZone(state: BondingCurveState | ParsedBondingCurve): boolean {
  const progress = 'progressPercent' in state
    ? state.progressPercent
    : calculateProgress(state);

  return progress >= BONDING_CURVE.MIN_PROGRESS_PERCENT &&
         progress <= BONDING_CURVE.MAX_PROGRESS_PERCENT;
}

/**
 * Checks if bonding curve has completed (migrated)
 */
export function hasCompleted(state: BondingCurveState): boolean {
  return state.complete;
}

// =============================================================================
// INSTRUCTION PARSING
// =============================================================================

/**
 * Identifies instruction type from discriminator
 */
export function identifyInstructionType(data: Buffer | Uint8Array): PumpFunInstructionType {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  if (buffer.length < 8) {
    return PumpFunInstructionType.UNKNOWN;
  }

  const discriminator = buffer.subarray(0, 8);

  if (discriminator.equals(INSTRUCTION_DISCRIMINATORS.CREATE)) {
    return PumpFunInstructionType.CREATE;
  }

  if (discriminator.equals(INSTRUCTION_DISCRIMINATORS.BUY)) {
    return PumpFunInstructionType.BUY;
  }

  if (discriminator.equals(INSTRUCTION_DISCRIMINATORS.SELL)) {
    return PumpFunInstructionType.SELL;
  }

  if (discriminator.equals(INSTRUCTION_DISCRIMINATORS.WITHDRAW)) {
    return PumpFunInstructionType.WITHDRAW;
  }

  return PumpFunInstructionType.UNKNOWN;
}

/**
 * Parses a create instruction
 */
export function parseCreateInstruction(
  data: Buffer,
  accounts: SolanaAddress[]
): CreateInstruction | null {
  try {
    // Account indices for create instruction:
    // 0: mint
    // 1: mintAuthority
    // 2: bondingCurve
    // 3: associatedBondingCurve
    // 4: global
    // 5: mplTokenMetadata
    // 6: metadata
    // 7: user (creator)
    // ... system accounts

    if (accounts.length < 8) {
      getLogger().warn('Create instruction has insufficient accounts', {
        accountCount: accounts.length,
      });
      return null;
    }

    // Parse metadata from instruction data
    // Layout after discriminator (8 bytes):
    // - name_len: u32
    // - name: [u8; name_len]
    // - symbol_len: u32
    // - symbol: [u8; symbol_len]
    // - uri_len: u32
    // - uri: [u8; uri_len]

    let offset = 8;

    // Read name
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.subarray(offset, offset + nameLen).toString('utf8');
    offset += nameLen;

    // Read symbol
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data.subarray(offset, offset + symbolLen).toString('utf8');
    offset += symbolLen;

    // Read URI
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const uri = data.subarray(offset, offset + uriLen).toString('utf8');

    const mint = accounts[0];
    const bondingCurve = accounts[2];
    const creator = accounts[7];

    if (!mint || !bondingCurve || !creator) {
      getLogger().warn('Create instruction missing required accounts');
      return null;
    }

    return {
      type: PumpFunInstructionType.CREATE,
      name,
      symbol,
      uri,
      mint,
      bondingCurve,
      creator,
    };
  } catch (error) {
    getLogger().error('Failed to parse create instruction', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Parses a buy instruction
 */
export function parseBuyInstruction(
  data: Buffer,
  accounts: SolanaAddress[]
): BuyInstruction | null {
  try {
    // Account indices for buy instruction:
    // 0: global
    // 1: feeRecipient
    // 2: mint
    // 3: bondingCurve
    // 4: associatedBondingCurve
    // 5: associatedUser
    // 6: user (buyer)
    // ... system accounts

    if (accounts.length < 7) {
      getLogger().warn('Buy instruction has insufficient accounts', {
        accountCount: accounts.length,
      });
      return null;
    }

    // Layout after discriminator (8 bytes):
    // - amount: u64 (token amount to buy)
    // - max_sol_cost: u64 (maximum SOL to spend)

    const tokenAmount = data.readBigUInt64LE(8);
    const maxSolCost = data.readBigUInt64LE(16);

    const mint = accounts[2];
    const bondingCurve = accounts[3];
    const buyer = accounts[6];

    if (!mint || !bondingCurve || !buyer) {
      getLogger().warn('Buy instruction missing required accounts');
      return null;
    }

    return {
      type: PumpFunInstructionType.BUY,
      mint,
      bondingCurve,
      buyer,
      tokenAmount,
      maxSolCost,
      solAmount: 0n, // Will be calculated from account changes
    };
  } catch (error) {
    getLogger().error('Failed to parse buy instruction', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Parses a sell instruction
 */
export function parseSellInstruction(
  data: Buffer,
  accounts: SolanaAddress[]
): SellInstruction | null {
  try {
    // Account indices for sell instruction:
    // 0: global
    // 1: feeRecipient
    // 2: mint
    // 3: bondingCurve
    // 4: associatedBondingCurve
    // 5: associatedUser
    // 6: user (seller)
    // ... system accounts

    if (accounts.length < 7) {
      getLogger().warn('Sell instruction has insufficient accounts', {
        accountCount: accounts.length,
      });
      return null;
    }

    // Layout after discriminator (8 bytes):
    // - amount: u64 (token amount to sell)
    // - min_sol_output: u64 (minimum SOL to receive)

    const tokenAmount = data.readBigUInt64LE(8);
    const minSolOutput = data.readBigUInt64LE(16);

    const mint = accounts[2];
    const bondingCurve = accounts[3];
    const seller = accounts[6];

    if (!mint || !bondingCurve || !seller) {
      getLogger().warn('Sell instruction missing required accounts');
      return null;
    }

    return {
      type: PumpFunInstructionType.SELL,
      mint,
      bondingCurve,
      seller,
      tokenAmount,
      minSolOutput,
      solAmount: 0n, // Will be calculated from account changes
    };
  } catch (error) {
    getLogger().error('Failed to parse sell instruction', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Parses a withdraw (migration) instruction
 */
export function parseWithdrawInstruction(
  data: Buffer,
  accounts: SolanaAddress[]
): WithdrawInstruction | null {
  try {
    // Account indices for withdraw instruction:
    // 0: global
    // 1: mint
    // 2: bondingCurve
    // ... other accounts

    if (accounts.length < 3) {
      getLogger().warn('Withdraw instruction has insufficient accounts', {
        accountCount: accounts.length,
      });
      return null;
    }

    const mint = accounts[1];
    const bondingCurve = accounts[2];

    if (!mint || !bondingCurve) {
      getLogger().warn('Withdraw instruction missing required accounts');
      return null;
    }

    return {
      type: PumpFunInstructionType.WITHDRAW,
      mint,
      bondingCurve,
    };
  } catch (error) {
    getLogger().error('Failed to parse withdraw instruction', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Parses any Pump.fun instruction
 */
export function parseInstruction(
  data: Buffer | Uint8Array,
  accounts: SolanaAddress[]
): PumpFunInstruction {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const type = identifyInstructionType(buffer);

  switch (type) {
    case PumpFunInstructionType.CREATE: {
      const parsed = parseCreateInstruction(buffer, accounts);
      return parsed ?? { type: PumpFunInstructionType.UNKNOWN, data: buffer };
    }

    case PumpFunInstructionType.BUY: {
      const parsed = parseBuyInstruction(buffer, accounts);
      return parsed ?? { type: PumpFunInstructionType.UNKNOWN, data: buffer };
    }

    case PumpFunInstructionType.SELL: {
      const parsed = parseSellInstruction(buffer, accounts);
      return parsed ?? { type: PumpFunInstructionType.UNKNOWN, data: buffer };
    }

    case PumpFunInstructionType.WITHDRAW: {
      const parsed = parseWithdrawInstruction(buffer, accounts);
      return parsed ?? { type: PumpFunInstructionType.UNKNOWN, data: buffer };
    }

    default:
      return { type: PumpFunInstructionType.UNKNOWN, data: buffer };
  }
}

// =============================================================================
// LOG PARSING (FALLBACK)
// =============================================================================

/**
 * Extracts instruction type from transaction logs
 * Used as fallback when instruction parsing fails
 */
export function parseInstructionFromLogs(logs: string[]): PumpFunInstructionType {
  for (const log of logs) {
    if (log.includes('Instruction: Create')) {
      return PumpFunInstructionType.CREATE;
    }
    if (log.includes('Instruction: Buy')) {
      return PumpFunInstructionType.BUY;
    }
    if (log.includes('Instruction: Sell')) {
      return PumpFunInstructionType.SELL;
    }
    if (log.includes('Instruction: Withdraw')) {
      return PumpFunInstructionType.WITHDRAW;
    }
  }
  return PumpFunInstructionType.UNKNOWN;
}

/**
 * Extracts mint address from transaction logs
 */
export function extractMintFromLogs(logs: string[]): SolanaAddress | null {
  for (const log of logs) {
    const match = log.match(/mint: ([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Formats bonding curve state for logging
 */
export function formatBondingCurveForLog(state: ParsedBondingCurve): Record<string, unknown> {
  return {
    mint: state.mintAddress,
    bondingCurve: state.bondingCurveAddress,
    progress: `${state.progressPercent.toFixed(2)}%`,
    price: `${state.currentPriceSol.toFixed(9)} SOL`,
    marketCap: `${state.marketCapSol.toFixed(2)} SOL`,
    inEntryZone: state.inEntryZone,
    nearGraduation: state.nearGraduation,
    complete: state.complete,
    realSol: `${(Number(state.realSolReserves) / 1e9).toFixed(2)} SOL`,
  };
}

/**
 * Validates that an address looks like a valid Solana address
 */
export function isValidAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}
