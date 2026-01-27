/**
 * Custom Error Classes
 *
 * Specific error types for better error handling and debugging.
 * Each error class includes context information and is serializable.
 */

// =============================================================================
// BASE ERROR
// =============================================================================

/**
 * Base error class for all custom errors.
 * Includes context object for additional debugging information.
 */
export class BotError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly recoverable: boolean;

  constructor(
    message: string,
    code: string,
    context: Record<string, unknown> = {},
    recoverable = false
  ) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
    this.recoverable = recoverable;

    // Maintains proper stack trace in Node.js
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serializes the error for logging or transmission.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }

  /**
   * Creates a string representation for logging.
   */
  override toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}

// =============================================================================
// CONFIGURATION ERRORS
// =============================================================================

/**
 * Error thrown when configuration is invalid or missing.
 */
export class ConfigurationError extends BotError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'CONFIGURATION_ERROR', context, false);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error thrown when a required environment variable is missing.
 */
export class MissingEnvVarError extends ConfigurationError {
  constructor(varName: string) {
    super(`Missing required environment variable: ${varName}`, { varName });
    this.name = 'MissingEnvVarError';
  }
}

// =============================================================================
// RPC ERRORS
// =============================================================================

/**
 * Error thrown when RPC communication fails.
 */
export class RPCError extends BotError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    recoverable = true
  ) {
    super(message, 'RPC_ERROR', context, recoverable);
    this.name = 'RPCError';
  }
}

/**
 * Error thrown when RPC request times out.
 */
export class RPCTimeoutError extends RPCError {
  constructor(endpoint: string, timeoutMs: number) {
    super(`RPC request timed out after ${timeoutMs}ms`, {
      endpoint,
      timeoutMs,
    });
    this.name = 'RPCTimeoutError';
  }
}

/**
 * Error thrown when all RPC endpoints are unhealthy.
 */
export class NoHealthyRPCError extends RPCError {
  constructor(endpoints: string[]) {
    super('No healthy RPC endpoints available', { endpoints }, false);
    this.name = 'NoHealthyRPCError';
  }
}

// =============================================================================
// GRPC ERRORS
// =============================================================================

/**
 * Error thrown when gRPC communication fails.
 */
export class GRPCError extends BotError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    recoverable = true
  ) {
    super(message, 'GRPC_ERROR', context, recoverable);
    this.name = 'GRPCError';
  }
}

/**
 * Error thrown when gRPC connection is lost.
 */
export class GRPCConnectionError extends GRPCError {
  constructor(reason?: string) {
    super(`gRPC connection failed${reason ? `: ${reason}` : ''}`, {
      reason,
    });
    this.name = 'GRPCConnectionError';
  }
}

/**
 * Error thrown when gRPC stream encounters an error.
 */
export class GRPCStreamError extends GRPCError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(`gRPC stream error: ${message}`, context, true);
    this.name = 'GRPCStreamError';
  }
}

// =============================================================================
// TRANSACTION ERRORS
// =============================================================================

/**
 * Error thrown when transaction execution fails.
 */
export class TransactionError extends BotError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    recoverable = true
  ) {
    super(message, 'TRANSACTION_ERROR', context, recoverable);
    this.name = 'TransactionError';
  }
}

/**
 * Error thrown when a transaction fails simulation.
 */
export class SimulationError extends TransactionError {
  constructor(logs: string[], context: Record<string, unknown> = {}) {
    super('Transaction simulation failed', { logs, ...context }, true);
    this.name = 'SimulationError';
  }
}

/**
 * Error thrown when transaction confirmation times out.
 */
export class ConfirmationTimeoutError extends TransactionError {
  constructor(signature: string, timeoutMs: number) {
    super(`Transaction confirmation timed out after ${timeoutMs}ms`, {
      signature,
      timeoutMs,
    });
    this.name = 'ConfirmationTimeoutError';
  }
}

/**
 * Error thrown when blockhash expires before confirmation.
 */
export class BlockhashExpiredError extends TransactionError {
  constructor(signature?: string) {
    super('Blockhash expired before confirmation', { signature }, true);
    this.name = 'BlockhashExpiredError';
  }
}

// =============================================================================
// WALLET ERRORS
// =============================================================================

/**
 * Error thrown when wallet operations fail.
 */
export class WalletError extends BotError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    recoverable = false
  ) {
    super(message, 'WALLET_ERROR', context, recoverable);
    this.name = 'WalletError';
  }
}

/**
 * Error thrown when wallet has insufficient funds.
 */
export class InsufficientFundsError extends WalletError {
  constructor(required: bigint | number, available: bigint | number, token: string = 'SOL') {
    super(`Insufficient ${token} balance: required ${required}, available ${available}`, {
      required: required.toString(),
      available: available.toString(),
      token,
    });
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Error thrown when wallet key is invalid.
 */
export class InvalidKeyError extends WalletError {
  constructor(reason: string) {
    super(`Invalid wallet key: ${reason}`, { reason });
    this.name = 'InvalidKeyError';
  }
}

// =============================================================================
// TRADE ERRORS
// =============================================================================

/**
 * Error thrown when slippage exceeds tolerance.
 */
export class SlippageError extends BotError {
  constructor(expected: number, actual: number, maxSlippageBps: number) {
    super(
      `Slippage exceeded: expected ${expected}, got ${actual} (max ${maxSlippageBps} bps)`,
      'SLIPPAGE_ERROR',
      {
        expected,
        actual,
        maxSlippageBps,
        actualSlippageBps: Math.round(((expected - actual) / expected) * 10000),
      },
      true
    );
    this.name = 'SlippageError';
  }
}

/**
 * Error thrown when price impact is too high.
 */
export class PriceImpactError extends BotError {
  constructor(priceImpactPercent: number, maxImpactPercent: number) {
    super(
      `Price impact too high: ${priceImpactPercent.toFixed(2)}% (max ${maxImpactPercent}%)`,
      'PRICE_IMPACT_ERROR',
      {
        priceImpactPercent,
        maxImpactPercent,
      },
      true
    );
    this.name = 'PriceImpactError';
  }
}

// =============================================================================
// SAFETY ERRORS
// =============================================================================

/**
 * Error thrown when a safety check fails.
 */
export class SafetyCheckError extends BotError {
  public readonly checkName: string;
  public readonly failureReason: string;

  constructor(checkName: string, failureReason: string, context: Record<string, unknown> = {}) {
    super(
      `Safety check failed [${checkName}]: ${failureReason}`,
      'SAFETY_CHECK_ERROR',
      {
        checkName,
        failureReason,
        ...context,
      },
      false
    );
    this.name = 'SafetyCheckError';
    this.checkName = checkName;
    this.failureReason = failureReason;
  }
}

/**
 * Error thrown when mint authority is not revoked.
 */
export class MintAuthorityActiveError extends SafetyCheckError {
  constructor(mint: string, authority: string) {
    super('mint_authority', 'Mint authority is active - token supply can be inflated', {
      mint,
      authority,
    });
    this.name = 'MintAuthorityActiveError';
  }
}

/**
 * Error thrown when freeze authority is not revoked.
 */
export class FreezeAuthorityActiveError extends SafetyCheckError {
  constructor(mint: string, authority: string) {
    super('freeze_authority', 'Freeze authority is active - wallets can be frozen', {
      mint,
      authority,
    });
    this.name = 'FreezeAuthorityActiveError';
  }
}

// =============================================================================
// DATABASE ERRORS
// =============================================================================

/**
 * Error thrown when database operations fail.
 */
export class DatabaseError extends BotError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    recoverable = true
  ) {
    super(message, 'DATABASE_ERROR', context, recoverable);
    this.name = 'DatabaseError';
  }
}

/**
 * Error thrown when database connection fails.
 */
export class DatabaseConnectionError extends DatabaseError {
  constructor(reason: string) {
    super(`Database connection failed: ${reason}`, { reason }, true);
    this.name = 'DatabaseConnectionError';
  }
}

// =============================================================================
// RISK ERRORS
// =============================================================================

/**
 * Error thrown when a risk limit is exceeded.
 */
export class RiskLimitError extends BotError {
  constructor(limitName: string, currentValue: number, maxValue: number) {
    super(
      `Risk limit exceeded [${limitName}]: ${currentValue} > ${maxValue}`,
      'RISK_LIMIT_ERROR',
      {
        limitName,
        currentValue,
        maxValue,
      },
      false
    );
    this.name = 'RiskLimitError';
  }
}

/**
 * Error thrown when daily loss limit is exceeded.
 */
export class DailyLossLimitError extends RiskLimitError {
  constructor(currentLossPercent: number, maxLossPercent: number) {
    super('daily_loss', currentLossPercent, maxLossPercent);
    this.name = 'DailyLossLimitError';
  }
}

/**
 * Error thrown when maximum drawdown is exceeded.
 */
export class MaxDrawdownError extends RiskLimitError {
  constructor(currentDrawdownPercent: number, maxDrawdownPercent: number) {
    super('max_drawdown', currentDrawdownPercent, maxDrawdownPercent);
    this.name = 'MaxDrawdownError';
  }
}

// =============================================================================
// KILL SWITCH ERROR
// =============================================================================

/**
 * Error thrown when kill switch is activated.
 */
export class KillSwitchError extends BotError {
  constructor(reason: string, triggeredBy: string) {
    super(`Kill switch activated: ${reason}`, 'KILL_SWITCH_ERROR', { reason, triggeredBy }, false);
    this.name = 'KillSwitchError';
  }
}

// =============================================================================
// RATE LIMIT ERROR
// =============================================================================

/**
 * Error thrown when rate limit is exceeded.
 */
export class RateLimitError extends BotError {
  constructor(service: string, retryAfterMs?: number) {
    super(`Rate limit exceeded for ${service}`, 'RATE_LIMIT_ERROR', {
      service,
      retryAfterMs,
    }, true);
    this.name = 'RateLimitError';
  }
}

// =============================================================================
// ERROR UTILITIES
// =============================================================================

/**
 * Type guard to check if an error is a BotError.
 */
export function isBotError(error: unknown): error is BotError {
  return error instanceof BotError;
}

/**
 * Type guard to check if an error is recoverable.
 */
export function isRecoverableError(error: unknown): boolean {
  if (isBotError(error)) {
    return error.recoverable;
  }
  return false;
}

/**
 * Wraps an unknown error in a BotError if it isn't already one.
 */
export function wrapError(error: unknown, defaultCode = 'UNKNOWN_ERROR'): BotError {
  if (isBotError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new BotError(error.message, defaultCode, {
      originalName: error.name,
      originalStack: error.stack,
    });
  }

  return new BotError(String(error), defaultCode);
}

/**
 * Extracts a user-friendly message from any error.
 */
export function getErrorMessage(error: unknown): string {
  if (isBotError(error)) {
    return error.toString();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
