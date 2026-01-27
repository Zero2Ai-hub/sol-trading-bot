/**
 * Retry Utilities
 *
 * Provides exponential backoff retry logic for resilient operations.
 */

import { isRecoverableError, RateLimitError } from '../core/errors.js';

// =============================================================================
// TYPES
// =============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;

  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;

  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;

  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;

  /** Whether to add jitter to delays (default: true) */
  jitter?: boolean;

  /** Custom function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;

  /** Callback called before each retry */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;

  /** Abort signal to cancel retries */
  abortSignal?: AbortSignal;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: unknown;
  attempts: number;
  totalTimeMs: number;
}

// =============================================================================
// DEFAULT OPTIONS
// =============================================================================

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'abortSignal' | 'isRetryable'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

// =============================================================================
// RETRY FUNCTIONS
// =============================================================================

/**
 * Retries a function with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @returns The function result if successful
 * @throws The last error if all retries fail
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let attempt = 0;

  while (attempt <= opts.maxRetries) {
    // Check for abort
    if (opts.abortSignal?.aborted) {
      throw new Error('Retry aborted');
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;

      // Check if we should retry
      const shouldRetry =
        attempt <= opts.maxRetries &&
        (opts.isRetryable ? opts.isRetryable(error) : isRetryableError(error));

      if (!shouldRetry) {
        throw error;
      }

      // Calculate delay
      const delay = calculateDelay(attempt, opts);

      // Handle rate limit errors specially
      if (error instanceof RateLimitError && error.context.retryAfterMs) {
        const retryAfter = error.context.retryAfterMs as number;
        await sleep(Math.min(retryAfter, opts.maxDelayMs));
      } else {
        // Callback before retry
        opts.onRetry?.(error, attempt, delay);

        // Wait before retry
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Retries a function and returns a result object instead of throwing.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @returns RetryResult object with success status and result/error
 */
export async function retryWithResult<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const result = await retry(fn, {
      ...options,
      onRetry: (error, attempt, delayMs) => {
        attempts = attempt;
        options.onRetry?.(error, attempt, delayMs);
      },
    });

    return {
      success: true,
      result,
      attempts: attempts + 1,
      totalTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error,
      attempts: attempts + 1,
      totalTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Creates a retryable version of an async function.
 *
 * @param fn - The async function to wrap
 * @param options - Retry configuration options
 * @returns A new function that retries on failure
 */
export function withRetry<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs) => retry(() => fn(...args), options);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculates the delay for a given attempt number.
 */
function calculateDelay(attempt: number, opts: typeof DEFAULT_OPTIONS): number {
  // Exponential backoff
  let delay = opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1);

  // Cap at maximum
  delay = Math.min(delay, opts.maxDelayMs);

  // Add jitter (±25%)
  if (opts.jitter) {
    const jitterRange = delay * 0.25;
    delay = delay + (Math.random() * 2 - 1) * jitterRange;
  }

  return Math.round(delay);
}

/**
 * Determines if an error is retryable.
 * Uses BotError's recoverable flag or checks for common retryable patterns.
 */
function isRetryableError(error: unknown): boolean {
  // Check BotError recoverable flag
  if (isRecoverableError(error)) {
    return true;
  }

  // Check for common retryable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up') ||
      message.includes('network')
    ) {
      return true;
    }

    // Solana-specific retryable errors
    if (
      message.includes('blockhash') ||
      message.includes('too many requests') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('503') ||
      message.includes('502')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// SPECIALIZED RETRY FUNCTIONS
// =============================================================================

/**
 * Retry configuration optimized for RPC calls.
 */
export const RPC_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Retry configuration optimized for transaction submission.
 */
export const TX_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 1.5,
  jitter: true,
};

/**
 * Retry configuration optimized for Jupiter API calls.
 */
export const JUPITER_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 3000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Retries an RPC call with optimized settings.
 */
export function retryRPC<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, RPC_RETRY_OPTIONS);
}

/**
 * Retries a transaction submission with optimized settings.
 */
export function retryTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, TX_RETRY_OPTIONS);
}

/**
 * Retries a Jupiter API call with optimized settings.
 */
export function retryJupiter<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, JUPITER_RETRY_OPTIONS);
}

// =============================================================================
// BATCH RETRY
// =============================================================================

export interface BatchRetryResult<T> {
  results: (T | Error)[];
  successCount: number;
  failureCount: number;
}

/**
 * Retries multiple operations in parallel, returning results for each.
 *
 * @param operations - Array of async functions to execute
 * @param options - Retry configuration options
 * @returns Results for each operation (value or error)
 */
export async function batchRetry<T>(
  operations: Array<() => Promise<T>>,
  options: RetryOptions = {}
): Promise<BatchRetryResult<T>> {
  const results = await Promise.all(
    operations.map(async (op) => {
      try {
        return await retry(op, options);
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    })
  );

  const successCount = results.filter(r => !(r instanceof Error)).length;

  return {
    results,
    successCount,
    failureCount: results.length - successCount,
  };
}
