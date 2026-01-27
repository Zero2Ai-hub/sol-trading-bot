/**
 * Jupiter Swap Client
 *
 * Integrates with Jupiter aggregator for optimal swap routing.
 * Based on jupiter-swap-integration skill patterns:
 * - Quote caching with TTL
 * - Price impact assessment
 * - Slippage strategies by token type
 * - Retry logic with priority fee escalation
 */

import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  prependTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type Address,
  type KeyPairSigner,
  type IInstruction,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { getRpc, getRpcSubscriptions } from '../infrastructure/rpc/index.js';
import { WSOL_MINT } from '../config/constants.js';
import type { SolanaAddress, Timestamp } from '../core/types.js';
import type { SwapQuote, ExecutionResult, ExecutorConfig } from './types.js';
import { DEFAULT_EXECUTOR_CONFIG } from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const JUPITER_API = 'https://quote-api.jup.ag/v6';
const JUPITER_PRICE_API = 'https://price.jup.ag/v6';

const logger = getComponentLogger('Jupiter');

// =============================================================================
// QUOTE CACHE
// =============================================================================

interface CachedQuote {
  quote: SwapQuote;
  timestamp: number;
}

class QuoteCache {
  private cache: Map<string, CachedQuote> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 10_000) {
    this.ttlMs = ttlMs;
  }

  private getKey(inputMint: string, outputMint: string, amount: string): string {
    return `${inputMint}:${outputMint}:${amount}`;
  }

  get(inputMint: string, outputMint: string, amount: string): SwapQuote | null {
    const key = this.getKey(inputMint, outputMint, amount);
    const cached = this.cache.get(key);

    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return cached.quote;
  }

  set(inputMint: string, outputMint: string, amount: string, quote: SwapQuote): void {
    const key = this.getKey(inputMint, outputMint, amount);
    this.cache.set(key, { quote, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// =============================================================================
// JUPITER CLIENT CLASS
// =============================================================================

/**
 * Jupiter API response types
 */
interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      label: string;
    };
  }>;
}

interface JupiterSwapResponse {
  swapTransaction: string;
}

/**
 * Jupiter Swap Client
 */
export class JupiterClient {
  private quoteCache: QuoteCache;
  private config: ExecutorConfig;
  private rateLimitRemaining: number = 60;
  private rateLimitResetAt: number = 0;

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.quoteCache = new QuoteCache(10_000); // 10 second cache
  }

  // ===========================================================================
  // QUOTE METHODS
  // ===========================================================================

  /**
   * Gets a swap quote from Jupiter
   */
  async getQuote(
    inputMint: SolanaAddress,
    outputMint: SolanaAddress,
    amountLamports: bigint,
    slippageBps: number = this.config.defaultSlippageBps
  ): Promise<SwapQuote> {
    const amountStr = amountLamports.toString();

    // Check cache first
    const cached = this.quoteCache.get(inputMint, outputMint, amountStr);
    if (cached) {
      logger.debug('Using cached quote', {
        inputMint,
        outputMint,
        amount: amountStr,
      });
      return cached;
    }

    // Check rate limits
    await this.checkRateLimit();

    // Build quote URL
    const url = new URL(`${JUPITER_API}/quote`);
    url.searchParams.set('inputMint', inputMint);
    url.searchParams.set('outputMint', outputMint);
    url.searchParams.set('amount', amountStr);
    url.searchParams.set('slippageBps', slippageBps.toString());
    url.searchParams.set('onlyDirectRoutes', 'false');

    logger.debug('Fetching Jupiter quote', {
      inputMint,
      outputMint,
      amount: amountStr,
      slippageBps,
    });

    const response = await fetch(url.toString());
    this.updateRateLimits(response);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter quote failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as JupiterQuoteResponse;

    // Build quote object
    const quote: SwapQuote = {
      inputMint,
      outputMint,
      inputAmount: BigInt(data.inAmount),
      outputAmount: BigInt(data.outAmount),
      minimumOutput: BigInt(data.otherAmountThreshold),
      priceImpactPct: parseFloat(data.priceImpactPct),
      routeInfo: {
        dexLabels: data.routePlan?.map(r => r.swapInfo.label) ?? [],
        hops: data.routePlan?.length ?? 1,
      },
      timestamp: Date.now(),
      expiresAt: Date.now() + 30_000, // 30 second expiry
      rawQuote: data,
    };

    // Cache the quote
    this.quoteCache.set(inputMint, outputMint, amountStr, quote);

    logger.info('Got Jupiter quote', {
      inputMint,
      outputMint,
      inputAmount: data.inAmount,
      outputAmount: data.outAmount,
      priceImpact: data.priceImpactPct,
      route: quote.routeInfo.dexLabels.join(' -> '),
    });

    return quote;
  }

  /**
   * Gets a buy quote (SOL -> Token)
   */
  async getBuyQuote(
    tokenMint: SolanaAddress,
    solAmount: bigint,
    slippageBps?: number
  ): Promise<SwapQuote> {
    return this.getQuote(WSOL_MINT, tokenMint, solAmount, slippageBps);
  }

  /**
   * Gets a sell quote (Token -> SOL)
   */
  async getSellQuote(
    tokenMint: SolanaAddress,
    tokenAmount: bigint,
    slippageBps?: number
  ): Promise<SwapQuote> {
    return this.getQuote(tokenMint, WSOL_MINT, tokenAmount, slippageBps);
  }

  // ===========================================================================
  // TRANSACTION BUILDING
  // ===========================================================================

  /**
   * Builds a swap transaction from a quote
   */
  async buildSwapTransaction(
    quote: SwapQuote,
    userPublicKey: Address,
    priorityFeeMicroLamports: number = this.config.basePriorityFeeMicroLamports
  ): Promise<string> {
    await this.checkRateLimit();

    const response = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote.rawQuote,
        userPublicKey: userPublicKey,
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: priorityFeeMicroLamports,
        dynamicComputeUnitLimit: true,
      }),
    });

    this.updateRateLimits(response);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter swap build failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as JupiterSwapResponse;

    logger.debug('Built swap transaction', {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      priorityFee: priorityFeeMicroLamports,
    });

    return data.swapTransaction;
  }

  // ===========================================================================
  // PRICE METHODS
  // ===========================================================================

  /**
   * Gets current price for a token in USD
   */
  async getPrice(tokenMint: SolanaAddress): Promise<number | null> {
    try {
      const response = await fetch(
        `${JUPITER_PRICE_API}/price?ids=${tokenMint}`
      );

      if (!response.ok) return null;

      const data = await response.json() as { data?: Record<string, { price?: number }> };
      return data.data?.[tokenMint]?.price ?? null;
    } catch (error) {
      logger.warn('Failed to get price', { tokenMint, error });
      return null;
    }
  }

  /**
   * Gets prices for multiple tokens
   */
  async getPrices(tokenMints: SolanaAddress[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    try {
      const ids = tokenMints.join(',');
      const response = await fetch(`${JUPITER_PRICE_API}/price?ids=${ids}`);

      if (!response.ok) return prices;

      const data = await response.json() as { data?: Record<string, { price?: number }> };

      for (const mint of tokenMints) {
        const price = data.data?.[mint]?.price;
        if (price) {
          prices.set(mint, price);
        }
      }
    } catch (error) {
      logger.warn('Failed to get prices', { error });
    }

    return prices;
  }

  // ===========================================================================
  // PRICE IMPACT ASSESSMENT
  // ===========================================================================

  /**
   * Assesses price impact and returns recommendation
   */
  assessPriceImpact(impactPct: number): {
    level: 'low' | 'medium' | 'high' | 'extreme';
    warning: string | null;
    shouldProceed: boolean;
  } {
    if (impactPct < 0.5) {
      return { level: 'low', warning: null, shouldProceed: true };
    }
    if (impactPct < 2) {
      return {
        level: 'medium',
        warning: 'Moderate price impact',
        shouldProceed: true,
      };
    }
    if (impactPct < 5) {
      return {
        level: 'high',
        warning: 'High price impact - consider smaller trade',
        shouldProceed: true,
      };
    }
    return {
      level: 'extreme',
      warning: 'Extreme price impact - trade size too large for liquidity',
      shouldProceed: false,
    };
  }

  /**
   * Suggests slippage based on token type and volatility
   */
  suggestSlippage(tokenType: 'major' | 'memecoin' | 'new'): number {
    switch (tokenType) {
      case 'major':
        return 100; // 1%
      case 'memecoin':
        return 300; // 3%
      case 'new':
        return 500; // 5% - default for pump.fun tokens
      default:
        return this.config.defaultSlippageBps;
    }
  }

  // ===========================================================================
  // RATE LIMITING
  // ===========================================================================

  private async checkRateLimit(): Promise<void> {
    if (this.rateLimitRemaining <= 0 && Date.now() < this.rateLimitResetAt) {
      const waitMs = this.rateLimitResetAt - Date.now();
      logger.warn('Rate limit reached, waiting', { waitMs });
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  private updateRateLimits(response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');

    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset) {
      this.rateLimitResetAt = parseInt(reset, 10) * 1000;
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Clears the quote cache
   */
  clearCache(): void {
    this.quoteCache.clear();
  }

  /**
   * Gets rate limit status
   */
  getRateLimitStatus(): { remaining: number; resetsAt: number } {
    return {
      remaining: this.rateLimitRemaining,
      resetsAt: this.rateLimitResetAt,
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const jupiterClient = new JupiterClient();

// Convenience exports
export const getJupiterQuote = (
  inputMint: SolanaAddress,
  outputMint: SolanaAddress,
  amount: bigint,
  slippage?: number
) => jupiterClient.getQuote(inputMint, outputMint, amount, slippage);

export const getBuyQuote = (
  tokenMint: SolanaAddress,
  solAmount: bigint,
  slippage?: number
) => jupiterClient.getBuyQuote(tokenMint, solAmount, slippage);

export const getSellQuote = (
  tokenMint: SolanaAddress,
  tokenAmount: bigint,
  slippage?: number
) => jupiterClient.getSellQuote(tokenMint, tokenAmount, slippage);

export const getTokenPrice = (tokenMint: SolanaAddress) =>
  jupiterClient.getPrice(tokenMint);
