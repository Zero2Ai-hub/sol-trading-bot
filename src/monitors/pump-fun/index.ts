/**
 * Pump.fun Monitor
 *
 * Main monitoring service for Pump.fun token events.
 * Subscribes to gRPC stream, parses events, and emits typed events.
 */

import type { SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import bs58 from 'bs58';
import { PUMP_FUN_PROGRAM_ID } from '../../config/constants.js';
import type { SolanaAddress } from '../../core/types.js';
import {
  createEventEmitter,
  type PumpFunEventEmitter,
  type TokenLaunchedEvent,
  type BondingProgressEvent,
  type TokenMigrationEvent,
  type TokenTradeEvent,
} from '../../core/events.js';
import { getComponentLogger, type ComponentLogger } from '../../infrastructure/logger/index.js';
import {
  grpcService,
  initializeGrpc,
  connectGrpc,
  disconnectGrpc,
} from '../../services/grpc/index.js';
import {
  parseBondingCurve,
  parseInstruction,
  identifyInstructionType,
  formatBondingCurveForLog,
} from './parser.js';
import {
  tokenState,
  initializeTokenState,
  stopTokenState,
  type StateStats,
} from './state.js';
import {
  PumpFunInstructionType,
  type CreateInstruction,
  type BuyInstruction,
  type SellInstruction,
  type WithdrawInstruction,
  type TrackedToken,
} from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface PumpFunMonitorConfig {
  /** Emit progress events only when in entry zone */
  emitOnlyEntryZone: boolean;

  /** Minimum progress change to emit event (percent) */
  minProgressChangePercent: number;

  /** Track all tokens or only those approaching entry zone */
  trackAllTokens: boolean;
}

export interface MonitorStats {
  isRunning: boolean;
  tokensLaunched: number;
  tradesProcessed: number;
  migrationsDetected: number;
  stateStats: StateStats;
  startedAt: Date | null;
  uptime: number;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: PumpFunMonitorConfig = {
  emitOnlyEntryZone: false,
  minProgressChangePercent: 1,
  trackAllTokens: true,
};

// =============================================================================
// PUMP.FUN MONITOR CLASS
// =============================================================================

class PumpFunMonitor {
  private config: PumpFunMonitorConfig;
  private eventEmitter: PumpFunEventEmitter | null = null;
  private logger: ComponentLogger | null = null;
  private isRunning = false;
  private startedAt: Date | null = null;

  // Stats
  private tokensLaunched = 0;
  private tradesProcessed = 0;
  private migrationsDetected = 0;

  constructor(config: Partial<PumpFunMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initializes the monitor
   */
  async initialize(): Promise<void> {
    this.logger = getComponentLogger('pump-fun-monitor');
    this.eventEmitter = createEventEmitter();

    // Initialize dependencies
    initializeTokenState();
    await initializeGrpc();

    this.logger.info('Pump.fun monitor initialized', {
      config: this.config,
    });
  }

  /**
   * Starts monitoring Pump.fun events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger?.warn('Monitor already running');
      return;
    }

    this.logger?.info('Starting Pump.fun monitor');

    // Set up update handler
    grpcService.setUpdateHandler(update => this.handleUpdate(update));

    // Forward stream events to our emitter
    const grpcEmitter = grpcService.getEventEmitter();
    grpcEmitter.on('stream:connected', event => {
      this.eventEmitter?.emit('stream:connected', event);
    });
    grpcEmitter.on('stream:disconnected', event => {
      this.eventEmitter?.emit('stream:disconnected', event);
    });
    grpcEmitter.on('stream:error', event => {
      this.eventEmitter?.emit('stream:error', event);
    });

    // Connect to gRPC
    await connectGrpc({
      accounts: true,
      transactions: true,
      slots: false,
      commitment: 1, // CONFIRMED
    });

    this.isRunning = true;
    this.startedAt = new Date();

    this.logger?.info('Pump.fun monitor started');
  }

  /**
   * Stops the monitor
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger?.info('Stopping Pump.fun monitor');

    await disconnectGrpc();
    stopTokenState();

    this.isRunning = false;

    this.logger?.info('Pump.fun monitor stopped', {
      tokensLaunched: this.tokensLaunched,
      tradesProcessed: this.tradesProcessed,
      migrationsDetected: this.migrationsDetected,
    });
  }

  /**
   * Gets the event emitter for subscribing to events
   */
  getEventEmitter(): PumpFunEventEmitter {
    if (!this.eventEmitter) {
      throw new Error('Monitor not initialized');
    }
    return this.eventEmitter;
  }

  /**
   * Gets current monitor statistics
   */
  getStats(): MonitorStats {
    return {
      isRunning: this.isRunning,
      tokensLaunched: this.tokensLaunched,
      tradesProcessed: this.tradesProcessed,
      migrationsDetected: this.migrationsDetected,
      stateStats: tokenState.getStats(),
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
    };
  }

  /**
   * Gets tokens currently in entry zone
   */
  getEntryZoneTokens(): TrackedToken[] {
    return tokenState.getEntryZoneTokens();
  }

  /**
   * Gets a specific token by mint address
   */
  getToken(mintAddress: SolanaAddress): TrackedToken | undefined {
    return tokenState.getByMint(mintAddress);
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Handles incoming gRPC updates
   */
  private handleUpdate(update: SubscribeUpdate): void {
    try {
      // Handle account updates
      if (update.account) {
        this.handleAccountUpdate(update);
      }

      // Handle transaction updates
      if (update.transaction) {
        this.handleTransactionUpdate(update);
      }
    } catch (error) {
      this.logger?.error('Error handling update', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handles account updates (bonding curve state changes)
   */
  private handleAccountUpdate(update: SubscribeUpdate): void {
    const account = update.account?.account;
    if (!account) {
      return;
    }

    // Check if this is a Pump.fun account
    const owner = account.owner ? Buffer.from(account.owner).toString('base64') : '';

    // Only process if owned by Pump.fun program
    // Note: In practice, we'd decode the owner to base58 and compare
    // For now, we'll handle this in transaction processing which has clearer program identification

    const pubkey = account.pubkey ? bs58.encode(Buffer.from(account.pubkey)) : '';
    const data = account.data ? Buffer.from(account.data) : null;

    if (!data || data.length < 49) {
      return; // Not a bonding curve account (too small)
    }

    // Try to find existing token by bonding curve address
    const existingToken = tokenState.getByBondingCurve(pubkey);
    if (!existingToken) {
      return; // Unknown bonding curve, will be tracked when we see the create transaction
    }

    // Parse bonding curve
    const bondingCurve = parseBondingCurve(data, pubkey, existingToken.mintAddress);
    if (!bondingCurve) {
      return;
    }

    // Check for significant progress change
    const previousProgress = existingToken.bondingCurve?.progressPercent ?? 0;
    const progressChange = Math.abs(bondingCurve.progressPercent - previousProgress);

    if (progressChange < this.config.minProgressChangePercent) {
      // Update state but don't emit event
      tokenState.updateBondingCurve(existingToken.mintAddress, bondingCurve);
      return;
    }

    // Update state
    tokenState.updateBondingCurve(existingToken.mintAddress, bondingCurve);

    // Check for migration
    if (bondingCurve.complete && !existingToken.hasMigrated) {
      this.handleMigration(existingToken, bondingCurve, {
        slot: BigInt(update.account?.slot ?? 0),
      });
      return;
    }

    // Emit progress event
    if (!this.config.emitOnlyEntryZone || bondingCurve.inEntryZone) {
      const progressEvent: BondingProgressEvent = {
        mintAddress: existingToken.mintAddress,
        bondingCurveAddress: pubkey,
        progressPercent: bondingCurve.progressPercent,
        virtualTokenReserves: bondingCurve.virtualTokenReserves,
        virtualSolReserves: bondingCurve.virtualSolReserves,
        realTokenReserves: bondingCurve.realTokenReserves,
        realSolReserves: bondingCurve.realSolReserves,
        tokenTotalSupply: bondingCurve.tokenTotalSupply,
        inEntryZone: bondingCurve.inEntryZone,
        signature: '', // Account updates don't have signatures
        timestamp: Date.now(),
        slot: BigInt(update.account?.slot ?? 0),
      };

      this.eventEmitter?.emit('bonding:progress', progressEvent);

      this.logger?.debug('Bonding progress updated', formatBondingCurveForLog(bondingCurve));
    }
  }

  /**
   * Handles transaction updates
   */
  private handleTransactionUpdate(update: SubscribeUpdate): void {
    const txInfo = update.transaction?.transaction;
    if (!txInfo) {
      return;
    }

    const transaction = txInfo.transaction;
    const meta = txInfo.meta;

    if (!transaction || !meta) {
      return;
    }

    // Check if transaction was successful
    if (meta.err) {
      return; // Skip failed transactions
    }

    const signature = update.transaction?.transaction?.signature
      ? bs58.encode(Buffer.from(update.transaction.transaction.signature))
      : '';

    const slot = BigInt(update.transaction?.slot ?? 0);

    // Process each instruction
    const message = transaction.message;
    if (!message) {
      return;
    }

    const accountKeys = (message.accountKeys ?? []).map((key: Uint8Array) =>
      bs58.encode(Buffer.from(key))
    );

    // Find Pump.fun program instructions
    const instructions = message.instructions ?? [];

    for (const ix of instructions) {
      const programIdIndex = ix.programIdIndex ?? 0;
      const programId = accountKeys[programIdIndex];

      if (programId !== PUMP_FUN_PROGRAM_ID) {
        continue;
      }

      const ixData = ix.data ? Buffer.from(ix.data) : Buffer.alloc(0);
      const ixAccounts = (ix.accounts ?? []).map((idx: number) => accountKeys[idx] ?? '');

      this.processInstruction(ixData, ixAccounts, signature, slot);
    }

    // Also check inner instructions
    const innerInstructions = meta.innerInstructions ?? [];
    for (const inner of innerInstructions) {
      for (const ix of inner.instructions ?? []) {
        const programIdIndex = ix.programIdIndex ?? 0;
        const programId = accountKeys[programIdIndex];

        if (programId !== PUMP_FUN_PROGRAM_ID) {
          continue;
        }

        const ixData = ix.data ? Buffer.from(ix.data) : Buffer.alloc(0);
        const ixAccounts = (ix.accounts ?? []).map((idx: number) => accountKeys[idx] ?? '');

        this.processInstruction(ixData, ixAccounts, signature, slot);
      }
    }
  }

  /**
   * Processes a single Pump.fun instruction
   */
  private processInstruction(
    data: Buffer,
    accounts: SolanaAddress[],
    signature: string,
    slot: bigint
  ): void {
    const instructionType = identifyInstructionType(data);
    const instruction = parseInstruction(data, accounts);

    switch (instructionType) {
      case PumpFunInstructionType.CREATE:
        this.handleCreate(instruction as CreateInstruction, signature, slot);
        break;

      case PumpFunInstructionType.BUY:
        this.handleBuy(instruction as BuyInstruction, signature, slot);
        break;

      case PumpFunInstructionType.SELL:
        this.handleSell(instruction as SellInstruction, signature, slot);
        break;

      case PumpFunInstructionType.WITHDRAW:
        this.handleWithdraw(instruction as WithdrawInstruction, signature, slot);
        break;
    }
  }

  /**
   * Handles token creation
   */
  private handleCreate(
    instruction: CreateInstruction,
    signature: string,
    slot: bigint
  ): void {
    this.tokensLaunched++;

    // Track new token
    const token = tokenState.upsertToken(
      instruction.mint,
      instruction.bondingCurve,
      {
        name: instruction.name,
        symbol: instruction.symbol,
        uri: instruction.uri,
        creator: instruction.creator,
      }
    );

    // Emit launch event
    const launchEvent: TokenLaunchedEvent = {
      mintAddress: instruction.mint,
      bondingCurveAddress: instruction.bondingCurve,
      name: instruction.name,
      symbol: instruction.symbol,
      uri: instruction.uri,
      creator: instruction.creator,
      signature,
      timestamp: Date.now(),
      slot,
    };

    this.eventEmitter?.emit('token:launched', launchEvent);

    this.logger?.info('New token launched', {
      mint: instruction.mint,
      name: instruction.name,
      symbol: instruction.symbol,
      creator: instruction.creator,
    });
  }

  /**
   * Handles buy transactions
   */
  private handleBuy(
    instruction: BuyInstruction,
    signature: string,
    slot: bigint
  ): void {
    this.tradesProcessed++;

    // Update token state
    tokenState.recordTrade(instruction.mint, 'buy', instruction.solAmount);

    // Emit trade event
    const tradeEvent: TokenTradeEvent = {
      mintAddress: instruction.mint,
      bondingCurveAddress: instruction.bondingCurve,
      tradeType: 'buy',
      trader: instruction.buyer,
      solAmount: instruction.solAmount,
      tokenAmount: instruction.tokenAmount,
      signature,
      timestamp: Date.now(),
      slot,
    };

    this.eventEmitter?.emit('token:trade', tradeEvent);
  }

  /**
   * Handles sell transactions
   */
  private handleSell(
    instruction: SellInstruction,
    signature: string,
    slot: bigint
  ): void {
    this.tradesProcessed++;

    // Update token state
    tokenState.recordTrade(instruction.mint, 'sell', instruction.solAmount);

    // Emit trade event
    const tradeEvent: TokenTradeEvent = {
      mintAddress: instruction.mint,
      bondingCurveAddress: instruction.bondingCurve,
      tradeType: 'sell',
      trader: instruction.seller,
      solAmount: instruction.solAmount,
      tokenAmount: instruction.tokenAmount,
      signature,
      timestamp: Date.now(),
      slot,
    };

    this.eventEmitter?.emit('token:trade', tradeEvent);
  }

  /**
   * Handles withdraw (migration) transactions
   */
  private handleWithdraw(
    instruction: WithdrawInstruction,
    signature: string,
    slot: bigint
  ): void {
    const token = tokenState.getByMint(instruction.mint);
    if (!token) {
      return;
    }

    this.handleMigration(token, token.bondingCurve, { signature, slot });
  }

  /**
   * Handles token migration to Raydium
   */
  private handleMigration(
    token: TrackedToken,
    bondingCurve: { progressPercent: number } | null,
    context: { signature?: string; slot?: bigint; account?: unknown }
  ): void {
    this.migrationsDetected++;

    // Mark as migrated
    tokenState.markMigrated(token.mintAddress);

    // Emit migration event
    const migrationEvent: TokenMigrationEvent = {
      mintAddress: token.mintAddress,
      bondingCurveAddress: token.bondingCurveAddress,
      poolAddress: '', // Will be populated when we detect the Raydium pool
      finalProgressPercent: bondingCurve?.progressPercent ?? 100,
      signature: (context as { signature?: string }).signature ?? '',
      timestamp: Date.now(),
      slot: (context as { slot?: bigint }).slot ?? 0n,
    };

    this.eventEmitter?.emit('token:migration', migrationEvent);

    this.logger?.info('TOKEN MIGRATION DETECTED', {
      mint: token.mintAddress,
      name: token.name,
      symbol: token.symbol,
      finalProgress: bondingCurve?.progressPercent,
    });
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const pumpFunMonitor = new PumpFunMonitor();

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

export async function initializePumpFunMonitor(): Promise<void> {
  await pumpFunMonitor.initialize();
}

export async function startPumpFunMonitor(): Promise<void> {
  await pumpFunMonitor.start();
}

export async function stopPumpFunMonitor(): Promise<void> {
  await pumpFunMonitor.stop();
}

export function getPumpFunEventEmitter(): PumpFunEventEmitter {
  return pumpFunMonitor.getEventEmitter();
}

export function getPumpFunMonitorStats(): MonitorStats {
  return pumpFunMonitor.getStats();
}

export function getEntryZoneTokens(): TrackedToken[] {
  return pumpFunMonitor.getEntryZoneTokens();
}

// Re-export types
export type { TrackedToken, ParsedBondingCurve } from './types.js';
export { tokenState, getTokenByMint, getTokenByBondingCurve } from './state.js';
