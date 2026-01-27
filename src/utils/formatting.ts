/**
 * Formatting Utilities
 *
 * Functions for formatting addresses, amounts, and other values.
 */

import { Decimal } from 'decimal.js';
import { EXECUTION } from '../config/constants.js';

// =============================================================================
// ADDRESS FORMATTING
// =============================================================================

/**
 * Shortens an address for display (e.g., "7xK...abc")
 */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) {
    return address;
  }
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Validates a Solana address format (44 character base58)
 */
export function isValidSolanaAddress(address: string): boolean {
  // Base58 characters (no 0, O, I, l)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Validates a transaction signature format (88 character base58)
 */
export function isValidSignature(signature: string): boolean {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
  return base58Regex.test(signature);
}

// =============================================================================
// AMOUNT FORMATTING
// =============================================================================

/**
 * Converts lamports to SOL
 */
export function lamportsToSol(lamports: bigint | number): Decimal {
  return new Decimal(lamports.toString()).div(Number(EXECUTION.LAMPORTS_PER_SOL));
}

/**
 * Converts SOL to lamports
 */
export function solToLamports(sol: number | Decimal): bigint {
  const solDecimal = sol instanceof Decimal ? sol : new Decimal(sol);
  return BigInt(solDecimal.mul(Number(EXECUTION.LAMPORTS_PER_SOL)).floor().toString());
}

/**
 * Converts token base units to UI amount based on decimals
 */
export function baseToUi(amount: bigint | number, decimals: number): Decimal {
  return new Decimal(amount.toString()).div(new Decimal(10).pow(decimals));
}

/**
 * Converts UI amount to token base units
 */
export function uiToBase(amount: number | Decimal, decimals: number): bigint {
  const amountDecimal = amount instanceof Decimal ? amount : new Decimal(amount);
  return BigInt(amountDecimal.mul(new Decimal(10).pow(decimals)).floor().toString());
}

/**
 * Formats SOL amount for display
 */
export function formatSol(
  lamports: bigint | number,
  options: { decimals?: number; symbol?: boolean } = {}
): string {
  const { decimals = 4, symbol = true } = options;
  const sol = lamportsToSol(lamports);
  const formatted = sol.toFixed(decimals);
  return symbol ? `${formatted} SOL` : formatted;
}

/**
 * Formats USD amount for display
 */
export function formatUsd(
  amount: number | Decimal,
  options: { decimals?: number; symbol?: boolean } = {}
): string {
  const { decimals = 2, symbol = true } = options;
  const value = amount instanceof Decimal ? amount.toNumber() : amount;
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return symbol ? `$${formatted}` : formatted;
}

/**
 * Formats a token amount with proper decimal places
 */
export function formatTokenAmount(
  amount: bigint | number | Decimal,
  decimals: number,
  displayDecimals?: number
): string {
  let value: Decimal;

  if (typeof amount === 'bigint' || typeof amount === 'number') {
    value = baseToUi(amount, decimals);
  } else {
    value = amount;
  }

  return value.toFixed(displayDecimals ?? Math.min(decimals, 6));
}

/**
 * Formats a large number with K/M/B suffixes
 */
export function formatCompact(value: number | Decimal): string {
  const num = value instanceof Decimal ? value.toNumber() : value;

  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(2)}K`;
  }
  return num.toFixed(2);
}

// =============================================================================
// PERCENTAGE FORMATTING
// =============================================================================

/**
 * Formats a percentage for display
 */
export function formatPercent(
  value: number,
  options: { decimals?: number; sign?: boolean } = {}
): string {
  const { decimals = 2, sign = false } = options;
  const formatted = value.toFixed(decimals);
  const signStr = sign && value > 0 ? '+' : '';
  return `${signStr}${formatted}%`;
}

/**
 * Formats basis points as a percentage
 */
export function bpsToPercent(bps: number): string {
  return formatPercent(bps / 100);
}

/**
 * Converts percentage to basis points
 */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

// =============================================================================
// TIME FORMATTING
// =============================================================================

/**
 * Formats a duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Formats a timestamp as ISO string
 */
export function formatTimestamp(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toISOString();
}

/**
 * Formats a timestamp for logging (shorter format)
 */
export function formatLogTimestamp(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Returns relative time string (e.g., "5 minutes ago")
 */
export function formatRelativeTime(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 0) {
    return 'in the future';
  }

  if (diff < 60_000) {
    const seconds = Math.floor(diff / 1000);
    return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`;
  }

  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000);
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }

  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  const days = Math.floor(diff / 86_400_000);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// =============================================================================
// PRICE FORMATTING
// =============================================================================

/**
 * Formats a price with appropriate decimal places
 * - High prices (>$1): 2 decimals
 * - Medium prices ($0.01-$1): 4 decimals
 * - Low prices (<$0.01): 6-8 decimals
 */
export function formatPrice(price: number | Decimal): string {
  const value = price instanceof Decimal ? price.toNumber() : price;

  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  if (value >= 0.0001) {
    return `$${value.toFixed(6)}`;
  }
  return `$${value.toFixed(8)}`;
}

/**
 * Formats a price impact percentage
 */
export function formatPriceImpact(impactPercent: number): string {
  const formatted = Math.abs(impactPercent).toFixed(2);
  if (impactPercent > 3) {
    return `⚠️ ${formatted}%`;
  }
  if (impactPercent > 1) {
    return `${formatted}%`;
  }
  return `${formatted}%`;
}

// =============================================================================
// SANITIZATION
// =============================================================================

/**
 * Sanitizes a string that might contain sensitive data for logging
 */
export function sanitizeForLog(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars * 2) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, visibleChars)}${'*'.repeat(8)}${value.slice(-visibleChars)}`;
}

/**
 * Sanitizes an object for logging, replacing sensitive fields
 */
export function sanitizeObject(
  obj: Record<string, unknown>,
  sensitiveKeys: string[] = ['privateKey', 'secretKey', 'password', 'apiKey', 'token', 'secret']
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveKeys.some(
      sk => lowerKey.includes(sk.toLowerCase())
    );

    if (isSensitive && typeof value === 'string') {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>, sensitiveKeys);
    } else {
      result[key] = value;
    }
  }

  return result;
}
