/**
 * Rate Limiter
 *
 * Token bucket rate limiting for API calls.
 * Prevents exceeding rate limits on Jupiter, RPC, etc.
 */

import { RateLimitError } from '../../core/errors.js';
import { getComponentLogger, type ComponentLogger } from '../logger/index.js';
import { sleep } from '../../utils/retry.js';

// =============================================================================
// TYPES
// =============================================================================

export interface RateLimiterConfig {
  /** Maximum tokens (requests) in the bucket */
  maxTokens: number;

  /** Tokens refilled per second */
  refillRate: number;

  /** Name for logging */
  name: string;
}

export interface RateLimiterStats {
  name: string;
  availableTokens: number;
  maxTokens: number;
  refillRate: number;
  waitingRequests: number;
  totalRequests: number;
  throttledRequests: number;
}

// =============================================================================
// RATE LIMITER CLASS
// =============================================================================

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private waitingCount = 0;
  private totalRequests = 0;
  private throttledRequests = 0;

  constructor(private config: RateLimiterConfig) {
    this.tokens = config.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /**
   * Acquires a token, waiting if necessary.
   * @throws {RateLimitError} if wait would exceed timeout
   */
  async acquire(timeoutMs = 30000): Promise<void> {
    this.totalRequests++;
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Need to wait for tokens
    this.throttledRequests++;
    this.waitingCount++;

    try {
      const waitTimeMs = this.calculateWaitTime();

      if (waitTimeMs > timeoutMs) {
        throw new RateLimitError(this.config.name, waitTimeMs);
      }

      await sleep(waitTimeMs);
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
      } else {
        throw new RateLimitError(this.config.name);
      }
    } finally {
      this.waitingCount--;
    }
  }

  /**
   * Tries to acquire a token without waiting.
   * Returns true if successful, false otherwise.
   */
  tryAcquire(): boolean {
    this.totalRequests++;
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    this.throttledRequests++;
    return false;
  }

  /**
   * Gets the current stats.
   */
  getStats(): RateLimiterStats {
    this.refill();
    return {
      name: this.config.name,
      availableTokens: Math.floor(this.tokens),
      maxTokens: this.config.maxTokens,
      refillRate: this.config.refillRate,
      waitingRequests: this.waitingCount,
      totalRequests: this.totalRequests,
      throttledRequests: this.throttledRequests,
    };
  }

  /**
   * Resets the rate limiter to full capacity.
   */
  reset(): void {
    this.tokens = this.config.maxTokens;
    this.lastRefillTime = Date.now();
    this.totalRequests = 0;
    this.throttledRequests = 0;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000; // seconds
    const tokensToAdd = elapsed * this.config.refillRate;

    this.tokens = Math.min(this.config.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  private calculateWaitTime(): number {
    // Time needed to get 1 token
    const tokensNeeded = 1 - this.tokens;
    return Math.ceil((tokensNeeded / this.config.refillRate) * 1000);
  }
}

// =============================================================================
// RATE LIMITER MANAGER
// =============================================================================

class RateLimiterManager {
  private limiters: Map<string, TokenBucketRateLimiter> = new Map();
  private logger: ComponentLogger | null = null;
  private initialized = false;

  /**
   * Initializes the rate limiter manager.
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.logger = getComponentLogger('rate-limiter');

    // Create default limiters
    this.createLimiter({
      name: 'jupiter',
      maxTokens: 60,
      refillRate: 1, // 60 requests per minute
    });

    this.createLimiter({
      name: 'rpc',
      maxTokens: 100,
      refillRate: 10, // 100 per 10 seconds
    });

    this.createLimiter({
      name: 'helius',
      maxTokens: 30,
      refillRate: 0.5, // 30 per minute
    });

    this.initialized = true;
    this.logger?.info('Rate limiter manager initialized');
  }

  /**
   * Creates a new rate limiter.
   */
  createLimiter(config: RateLimiterConfig): TokenBucketRateLimiter {
    const limiter = new TokenBucketRateLimiter(config);
    this.limiters.set(config.name, limiter);

    this.logger?.debug(`Rate limiter created: ${config.name}`, {
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
    });

    return limiter;
  }

  /**
   * Gets a rate limiter by name.
   */
  getLimiter(name: string): TokenBucketRateLimiter | undefined {
    return this.limiters.get(name);
  }

  /**
   * Acquires a token from a specific limiter.
   */
  async acquire(limiterName: string, timeoutMs = 30000): Promise<void> {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) {
      throw new Error(`Rate limiter not found: ${limiterName}`);
    }

    await limiter.acquire(timeoutMs);
  }

  /**
   * Tries to acquire a token without waiting.
   */
  tryAcquire(limiterName: string): boolean {
    const limiter = this.limiters.get(limiterName);
    if (!limiter) {
      return false;
    }

    return limiter.tryAcquire();
  }

  /**
   * Gets stats for all limiters.
   */
  getAllStats(): RateLimiterStats[] {
    return Array.from(this.limiters.values()).map(l => l.getStats());
  }

  /**
   * Resets all limiters.
   */
  resetAll(): void {
    this.limiters.forEach(limiter => limiter.reset());
    this.logger?.info('All rate limiters reset');
  }
}

// =============================================================================
// CONVENIENCE DECORATOR
// =============================================================================

/**
 * Wraps an async function with rate limiting.
 */
export function withRateLimit<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  limiterName: string,
  timeoutMs = 30000
): T {
  return (async (...args: unknown[]) => {
    await rateLimiterManager.acquire(limiterName, timeoutMs);
    return fn(...args);
  }) as T;
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const rateLimiterManager = new RateLimiterManager();

// Convenience exports
export const initializeRateLimiter = () => rateLimiterManager.initialize();
export const acquireRateLimit = (name: string, timeout?: number) =>
  rateLimiterManager.acquire(name, timeout);
export const tryAcquireRateLimit = (name: string) => rateLimiterManager.tryAcquire(name);
export const getRateLimiterStats = () => rateLimiterManager.getAllStats();
export const createRateLimiter = (config: RateLimiterConfig) =>
  rateLimiterManager.createLimiter(config);

export { TokenBucketRateLimiter };
