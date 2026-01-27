/**
 * Typed Event System
 *
 * Strongly typed EventEmitter for Pump.fun token events.
 * Provides type safety for event names and payloads.
 */

import { EventEmitter } from 'events';
import type { SolanaAddress, Timestamp } from './types.js';

// =============================================================================
// EVENT PAYLOADS
// =============================================================================

/**
 * Event emitted when a new token is launched on Pump.fun
 */
export interface TokenLaunchedEvent {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Bonding curve address */
  bondingCurveAddress: SolanaAddress;

  /** Token name (if available) */
  name?: string;

  /** Token symbol (if available) */
  symbol?: string;

  /** Token URI (metadata) */
  uri?: string;

  /** Creator wallet address */
  creator: SolanaAddress;

  /** Launch transaction signature */
  signature: string;

  /** Launch timestamp */
  timestamp: Timestamp;

  /** Launch slot */
  slot: bigint;
}

/**
 * Event emitted when bonding curve progress updates
 */
export interface BondingProgressEvent {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Bonding curve address */
  bondingCurveAddress: SolanaAddress;

  /** Bonding curve completion percentage (0-100) */
  progressPercent: number;

  /** Virtual token reserves */
  virtualTokenReserves: bigint;

  /** Virtual SOL reserves */
  virtualSolReserves: bigint;

  /** Real token reserves */
  realTokenReserves: bigint;

  /** Real SOL reserves (progress indicator) */
  realSolReserves: bigint;

  /** Total token supply */
  tokenTotalSupply: bigint;

  /** Is in entry zone (70-95%)? */
  inEntryZone: boolean;

  /** Transaction signature that caused update */
  signature: string;

  /** Update timestamp */
  timestamp: Timestamp;

  /** Update slot */
  slot: bigint;
}

/**
 * Event emitted when a token migrates to Raydium
 */
export interface TokenMigrationEvent {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Bonding curve address */
  bondingCurveAddress: SolanaAddress;

  /** Raydium liquidity pool address */
  poolAddress: SolanaAddress;

  /** Final bonding curve progress before migration */
  finalProgressPercent: number;

  /** Migration transaction signature */
  signature: string;

  /** Migration timestamp */
  timestamp: Timestamp;

  /** Migration slot */
  slot: bigint;
}

/**
 * Event emitted when a trade happens on a token
 */
export interface TokenTradeEvent {
  /** Token mint address */
  mintAddress: SolanaAddress;

  /** Bonding curve address */
  bondingCurveAddress: SolanaAddress;

  /** Trade type */
  tradeType: 'buy' | 'sell';

  /** Trader wallet address */
  trader: SolanaAddress;

  /** SOL amount */
  solAmount: bigint;

  /** Token amount */
  tokenAmount: bigint;

  /** Transaction signature */
  signature: string;

  /** Trade timestamp */
  timestamp: Timestamp;

  /** Trade slot */
  slot: bigint;
}

/**
 * Event emitted when gRPC stream connects
 */
export interface StreamConnectedEvent {
  /** Stream type */
  streamType: 'grpc' | 'websocket';

  /** Connection timestamp */
  timestamp: Timestamp;

  /** Reconnection attempt number (0 = initial) */
  reconnectAttempt: number;
}

/**
 * Event emitted when gRPC stream disconnects
 */
export interface StreamDisconnectedEvent {
  /** Stream type */
  streamType: 'grpc' | 'websocket';

  /** Disconnect reason */
  reason: string;

  /** Disconnect timestamp */
  timestamp: Timestamp;

  /** Will attempt reconnection? */
  willReconnect: boolean;
}

/**
 * Event emitted when stream encounters an error
 */
export interface StreamErrorEvent {
  /** Stream type */
  streamType: 'grpc' | 'websocket';

  /** Error message */
  error: string;

  /** Error details */
  details?: Record<string, unknown>;

  /** Error timestamp */
  timestamp: Timestamp;
}

// =============================================================================
// EVENT MAP
// =============================================================================

/**
 * Map of event names to their payload types
 */
export interface PumpFunEventMap {
  'token:launched': TokenLaunchedEvent;
  'bonding:progress': BondingProgressEvent;
  'token:migration': TokenMigrationEvent;
  'token:trade': TokenTradeEvent;
  'stream:connected': StreamConnectedEvent;
  'stream:disconnected': StreamDisconnectedEvent;
  'stream:error': StreamErrorEvent;
  [key: string]: unknown; // Allow Record<string, unknown> compatibility
}

// =============================================================================
// TYPED EVENT EMITTER
// =============================================================================

/**
 * Strongly typed EventEmitter for Pump.fun events
 */
export class TypedEventEmitter<TEventMap extends Record<string, unknown>> {
  private emitter = new EventEmitter();

  /**
   * Registers an event listener with proper typing
   */
  on<K extends keyof TEventMap>(
    event: K,
    listener: (payload: TEventMap[K]) => void | Promise<void>
  ): this {
    this.emitter.on(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Registers a one-time event listener
   */
  once<K extends keyof TEventMap>(
    event: K,
    listener: (payload: TEventMap[K]) => void | Promise<void>
  ): this {
    this.emitter.once(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Removes an event listener
   */
  off<K extends keyof TEventMap>(
    event: K,
    listener: (payload: TEventMap[K]) => void | Promise<void>
  ): this {
    this.emitter.off(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Removes all listeners for an event
   */
  removeAllListeners<K extends keyof TEventMap>(event?: K): this {
    this.emitter.removeAllListeners(event as string);
    return this;
  }

  /**
   * Emits an event with payload
   */
  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): boolean {
    return this.emitter.emit(event as string, payload);
  }

  /**
   * Returns the number of listeners for an event
   */
  listenerCount<K extends keyof TEventMap>(event: K): number {
    return this.emitter.listenerCount(event as string);
  }

  /**
   * Sets the maximum number of listeners
   */
  setMaxListeners(n: number): this {
    this.emitter.setMaxListeners(n);
    return this;
  }

  /**
   * Gets the maximum number of listeners
   */
  getMaxListeners(): number {
    return this.emitter.getMaxListeners();
  }
}

/**
 * Type alias for Pump.fun event emitter
 */
export type PumpFunEventEmitter = TypedEventEmitter<PumpFunEventMap>;

/**
 * Creates a new Pump.fun event emitter
 */
export function createEventEmitter(): PumpFunEventEmitter {
  const emitter = new TypedEventEmitter<PumpFunEventMap>();
  emitter.setMaxListeners(100); // Allow many listeners
  return emitter;
}

// =============================================================================
// EVENT UTILITIES
// =============================================================================

/**
 * Event priority levels
 */
export enum EventPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * Gets priority for an event type
 */
export function getEventPriority(eventName: keyof PumpFunEventMap): EventPriority {
  switch (eventName) {
    case 'token:migration':
      return EventPriority.CRITICAL; // Never drop migration events
    case 'token:launched':
      return EventPriority.HIGH;
    case 'bonding:progress':
      return EventPriority.NORMAL;
    case 'token:trade':
      return EventPriority.NORMAL;
    case 'stream:error':
      return EventPriority.HIGH;
    case 'stream:connected':
    case 'stream:disconnected':
      return EventPriority.LOW;
    default:
      return EventPriority.NORMAL;
  }
}

/**
 * Type guard to check if event is critical
 */
export function isCriticalEvent(eventName: keyof PumpFunEventMap): boolean {
  return getEventPriority(eventName) === EventPriority.CRITICAL;
}
