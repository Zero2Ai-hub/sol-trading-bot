/**
 * Pump.fun Token State Manager
 *
 * Tracks token states in memory with TTL-based expiration.
 * Maintains active tokens, progress history, and trade statistics.
 */

import type { SolanaAddress, Timestamp } from '../../core/types.js';
import { getComponentLogger, type ComponentLogger } from '../../infrastructure/logger/index.js';
import type { TrackedToken, ParsedBondingCurve } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface StateManagerConfig {
  /** Maximum number of tokens to track */
  maxTokens: number;

  /** TTL for inactive tokens in ms (default: 1 hour) */
  inactiveTokenTtlMs: number;

  /** TTL for migrated tokens in ms (default: 5 minutes) */
  migratedTokenTtlMs: number;

  /** Cleanup interval in ms */
  cleanupIntervalMs: number;
}

export interface StateStats {
  totalTokens: number;
  activeTokens: number;
  migratedTokens: number;
  entryZoneTokens: number;
  oldestToken: Timestamp | null;
  newestToken: Timestamp | null;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: StateManagerConfig = {
  maxTokens: 10000,
  inactiveTokenTtlMs: 60 * 60 * 1000, // 1 hour
  migratedTokenTtlMs: 5 * 60 * 1000, // 5 minutes
  cleanupIntervalMs: 60 * 1000, // 1 minute
};

// =============================================================================
// STATE MANAGER CLASS
// =============================================================================

export class TokenStateManager {
  private config: StateManagerConfig;
  private tokens: Map<SolanaAddress, TrackedToken> = new Map();
  private bondingCurveToMint: Map<SolanaAddress, SolanaAddress> = new Map();
  private logger: ComponentLogger | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<StateManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initializes the state manager
   */
  initialize(): void {
    this.logger = getComponentLogger('pump-fun-state');

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);

    this.logger.info('Token state manager initialized', {
      maxTokens: this.config.maxTokens,
      inactiveTokenTtlMs: this.config.inactiveTokenTtlMs,
    });
  }

  /**
   * Stops the state manager
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.logger?.info('Token state manager stopped', {
      trackedTokens: this.tokens.size,
    });
  }

  /**
   * Adds or updates a token
   */
  upsertToken(
    mintAddress: SolanaAddress,
    bondingCurveAddress: SolanaAddress,
    updates: Partial<TrackedToken>
  ): TrackedToken {
    const now = Date.now();
    let token = this.tokens.get(mintAddress);

    if (token) {
      // Update existing token
      token = {
        ...token,
        ...updates,
        lastUpdatedAt: now,
      };
    } else {
      // Check capacity
      if (this.tokens.size >= this.config.maxTokens) {
        this.evictOldest();
      }

      // Create new token
      token = {
        mintAddress,
        bondingCurveAddress,
        creator: updates.creator ?? '',
        name: updates.name,
        symbol: updates.symbol,
        uri: updates.uri,
        bondingCurve: updates.bondingCurve ?? null,
        firstSeenAt: now,
        lastUpdatedAt: now,
        buyCount: 0,
        sellCount: 0,
        totalVolumeSol: 0n,
        hasMigrated: false,
        ...updates,
      };

      // Map bonding curve to mint
      this.bondingCurveToMint.set(bondingCurveAddress, mintAddress);
    }

    this.tokens.set(mintAddress, token);
    return token;
  }

  /**
   * Gets a token by mint address
   */
  getByMint(mintAddress: SolanaAddress): TrackedToken | undefined {
    return this.tokens.get(mintAddress);
  }

  /**
   * Gets a token by bonding curve address
   */
  getByBondingCurve(bondingCurveAddress: SolanaAddress): TrackedToken | undefined {
    const mintAddress = this.bondingCurveToMint.get(bondingCurveAddress);
    if (mintAddress) {
      return this.tokens.get(mintAddress);
    }
    return undefined;
  }

  /**
   * Updates bonding curve state for a token
   */
  updateBondingCurve(
    mintAddress: SolanaAddress,
    bondingCurve: ParsedBondingCurve
  ): TrackedToken | undefined {
    const token = this.tokens.get(mintAddress);
    if (!token) {
      return undefined;
    }

    token.bondingCurve = bondingCurve;
    token.lastUpdatedAt = Date.now();
    token.hasMigrated = bondingCurve.complete;

    if (bondingCurve.complete && !token.migratedAt) {
      token.migratedAt = Date.now();
    }

    return token;
  }

  /**
   * Records a trade for a token
   */
  recordTrade(
    mintAddress: SolanaAddress,
    tradeType: 'buy' | 'sell',
    solAmount: bigint
  ): void {
    const token = this.tokens.get(mintAddress);
    if (!token) {
      return;
    }

    if (tradeType === 'buy') {
      token.buyCount++;
    } else {
      token.sellCount++;
    }

    token.totalVolumeSol += solAmount;
    token.lastUpdatedAt = Date.now();
  }

  /**
   * Marks a token as migrated
   */
  markMigrated(
    mintAddress: SolanaAddress,
    poolAddress?: SolanaAddress
  ): void {
    const token = this.tokens.get(mintAddress);
    if (!token) {
      return;
    }

    token.hasMigrated = true;
    token.migratedAt = Date.now();
    if (poolAddress) {
      token.poolAddress = poolAddress;
    }

    this.logger?.info('Token marked as migrated', {
      mint: mintAddress,
      pool: poolAddress,
    });
  }

  /**
   * Removes a token from tracking
   */
  remove(mintAddress: SolanaAddress): boolean {
    const token = this.tokens.get(mintAddress);
    if (token) {
      this.bondingCurveToMint.delete(token.bondingCurveAddress);
      this.tokens.delete(mintAddress);
      return true;
    }
    return false;
  }

  /**
   * Gets all tokens
   */
  getAll(): TrackedToken[] {
    return Array.from(this.tokens.values());
  }

  /**
   * Gets all tokens in entry zone (70-95% progress)
   */
  getEntryZoneTokens(): TrackedToken[] {
    return this.getAll().filter(token =>
      token.bondingCurve?.inEntryZone && !token.hasMigrated
    );
  }

  /**
   * Gets all active (non-migrated) tokens
   */
  getActiveTokens(): TrackedToken[] {
    return this.getAll().filter(token => !token.hasMigrated);
  }

  /**
   * Gets tokens near graduation (>90% progress)
   */
  getNearGraduationTokens(): TrackedToken[] {
    return this.getAll().filter(token =>
      token.bondingCurve?.nearGraduation && !token.hasMigrated
    );
  }

  /**
   * Gets recently launched tokens (last N minutes)
   */
  getRecentTokens(withinMinutes: number = 5): TrackedToken[] {
    const cutoff = Date.now() - (withinMinutes * 60 * 1000);
    return this.getAll().filter(token => token.firstSeenAt >= cutoff);
  }

  /**
   * Gets state statistics
   */
  getStats(): StateStats {
    const tokens = this.getAll();
    const timestamps = tokens.map(t => t.firstSeenAt);

    return {
      totalTokens: tokens.length,
      activeTokens: tokens.filter(t => !t.hasMigrated).length,
      migratedTokens: tokens.filter(t => t.hasMigrated).length,
      entryZoneTokens: tokens.filter(t => t.bondingCurve?.inEntryZone && !t.hasMigrated).length,
      oldestToken: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestToken: timestamps.length > 0 ? Math.max(...timestamps) : null,
    };
  }

  /**
   * Checks if a token exists
   */
  has(mintAddress: SolanaAddress): boolean {
    return this.tokens.has(mintAddress);
  }

  /**
   * Gets the number of tracked tokens
   */
  get size(): number {
    return this.tokens.size;
  }

  /**
   * Clears all tokens
   */
  clear(): void {
    this.tokens.clear();
    this.bondingCurveToMint.clear();
    this.logger?.info('Token state cleared');
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Cleans up expired tokens
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [mintAddress, token] of this.tokens) {
      const age = now - token.lastUpdatedAt;

      // Remove migrated tokens after short TTL
      if (token.hasMigrated && age > this.config.migratedTokenTtlMs) {
        this.remove(mintAddress);
        removed++;
        continue;
      }

      // Remove inactive tokens after long TTL
      if (age > this.config.inactiveTokenTtlMs) {
        this.remove(mintAddress);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger?.debug('Cleanup completed', {
        removed,
        remaining: this.tokens.size,
      });
    }
  }

  /**
   * Evicts the oldest token to make room for new ones
   */
  private evictOldest(): void {
    let oldest: TrackedToken | null = null;
    let oldestTime = Infinity;

    for (const token of this.tokens.values()) {
      // Prefer to evict migrated tokens first
      if (token.hasMigrated) {
        this.remove(token.mintAddress);
        return;
      }

      if (token.lastUpdatedAt < oldestTime) {
        oldestTime = token.lastUpdatedAt;
        oldest = token;
      }
    }

    if (oldest) {
      this.logger?.debug('Evicting oldest token', {
        mint: oldest.mintAddress,
        age: Date.now() - oldest.lastUpdatedAt,
      });
      this.remove(oldest.mintAddress);
    }
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const tokenState = new TokenStateManager();

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

export function initializeTokenState(): void {
  tokenState.initialize();
}

export function stopTokenState(): void {
  tokenState.stop();
}

export function getTokenByMint(mintAddress: SolanaAddress): TrackedToken | undefined {
  return tokenState.getByMint(mintAddress);
}

export function getTokenByBondingCurve(bondingCurveAddress: SolanaAddress): TrackedToken | undefined {
  return tokenState.getByBondingCurve(bondingCurveAddress);
}

export function getEntryZoneTokens(): TrackedToken[] {
  return tokenState.getEntryZoneTokens();
}

export function getTokenStateStats(): StateStats {
  return tokenState.getStats();
}
