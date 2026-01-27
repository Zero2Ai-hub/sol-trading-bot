/**
 * Historical Data Collector
 *
 * Collects historical token data from various APIs for backtesting.
 * Sources:
 * - Birdeye API (prices, volume)
 * - DexScreener API (market data)
 * - Database (previously collected data)
 */

import { getComponentLogger } from '../infrastructure/logger/index.js';
import { db } from '../infrastructure/database/index.js';
import type { SolanaAddress, Timestamp } from '../core/types.js';
import {
  type HistoricalToken,
  type HistoricalDataPoint,
  TokenOutcome,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const BIRDEYE_API = 'https://public-api.birdeye.so';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest';

const logger = getComponentLogger('HistoricalCollector');

// =============================================================================
// BIRDEYE RESPONSE TYPES
// =============================================================================

interface BirdeyeOHLCVResponse {
  success: boolean;
  data: {
    items: Array<{
      unixTime: number;
      o: number; // open
      h: number; // high
      l: number; // low
      c: number; // close
      v: number; // volume
    }>;
  };
}

interface BirdeyeTokenOverviewResponse {
  success: boolean;
  data: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    liquidity: number;
    mc: number;
    holder: number;
  };
}

// =============================================================================
// DEXSCREENER RESPONSE TYPES
// =============================================================================

interface DexScreenerPairResponse {
  pairs: Array<{
    chainId: string;
    dexId: string;
    pairAddress: string;
    baseToken: {
      address: string;
      symbol: string;
      name: string;
    };
    priceNative: string;
    priceUsd: string;
    volume: {
      h24: number;
      h6: number;
      h1: number;
      m5: number;
    };
    liquidity: {
      usd: number;
    };
    fdv: number;
    pairCreatedAt: number;
  }>;
}

// =============================================================================
// HISTORICAL DATA COLLECTOR CLASS
// =============================================================================

/**
 * Historical Data Collector
 */
export class HistoricalDataCollector {
  private birdeyeApiKey: string | null = null;
  private cache: Map<string, HistoricalToken> = new Map();

  constructor() {
    // Get Birdeye API key from environment (optional)
    this.birdeyeApiKey = process.env.BIRDEYE_API_KEY || null;
  }

  // ===========================================================================
  // BIRDEYE DATA COLLECTION
  // ===========================================================================

  /**
   * Fetches OHLCV data from Birdeye
   */
  async fetchBirdeyeOHLCV(
    tokenMint: SolanaAddress,
    intervalType: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' = '1m',
    timeFrom: number,
    timeTo: number
  ): Promise<HistoricalDataPoint[]> {
    if (!this.birdeyeApiKey) {
      logger.warn('Birdeye API key not configured');
      return [];
    }

    try {
      const url = `${BIRDEYE_API}/defi/ohlcv?address=${tokenMint}&type=${intervalType}&time_from=${timeFrom}&time_to=${timeTo}`;

      const response = await fetch(url, {
        headers: {
          'X-API-KEY': this.birdeyeApiKey,
          'x-chain': 'solana',
        },
      });

      if (!response.ok) {
        logger.warn('Birdeye OHLCV request failed', {
          status: response.status,
          tokenMint,
        });
        return [];
      }

      const data = (await response.json()) as BirdeyeOHLCVResponse;

      if (!data.success || !data.data?.items) {
        return [];
      }

      return data.data.items.map((item) => ({
        timestamp: item.unixTime * 1000,
        priceSol: 0, // Need to calculate from USD/SOL price
        priceUsd: item.c,
        volumeSol: 0,
        marketCapUsd: 0,
        bondingProgress: 0,
        holderCount: 0,
        liquidityUsd: 0,
      }));
    } catch (error) {
      logger.error('Failed to fetch Birdeye OHLCV', { tokenMint, error });
      return [];
    }
  }

  /**
   * Fetches token overview from Birdeye
   */
  async fetchBirdeyeTokenOverview(
    tokenMint: SolanaAddress
  ): Promise<Partial<HistoricalToken> | null> {
    if (!this.birdeyeApiKey) {
      return null;
    }

    try {
      const url = `${BIRDEYE_API}/defi/token_overview?address=${tokenMint}`;

      const response = await fetch(url, {
        headers: {
          'X-API-KEY': this.birdeyeApiKey,
          'x-chain': 'solana',
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as BirdeyeTokenOverviewResponse;

      if (!data.success || !data.data) return null;

      return {
        mintAddress: data.data.address as SolanaAddress,
        symbol: data.data.symbol,
        name: data.data.name,
        peakMarketCapUsd: data.data.mc,
      };
    } catch (error) {
      logger.error('Failed to fetch Birdeye token overview', { tokenMint, error });
      return null;
    }
  }

  // ===========================================================================
  // DEXSCREENER DATA COLLECTION
  // ===========================================================================

  /**
   * Fetches pair data from DexScreener
   */
  async fetchDexScreenerData(
    tokenMint: SolanaAddress
  ): Promise<Partial<HistoricalToken> | null> {
    try {
      const url = `${DEXSCREENER_API}/dex/tokens/${tokenMint}`;

      const response = await fetch(url);

      if (!response.ok) {
        logger.warn('DexScreener request failed', { status: response.status });
        return null;
      }

      const data = (await response.json()) as DexScreenerPairResponse;

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Get the main Solana pair (prefer Raydium)
      const pair = data.pairs.find(
        (p) => p.chainId === 'solana' && p.dexId === 'raydium'
      ) || data.pairs.find((p) => p.chainId === 'solana');

      if (!pair) return null;

      return {
        mintAddress: pair.baseToken.address as SolanaAddress,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        launchTimestamp: pair.pairCreatedAt,
        peakMarketCapUsd: pair.fdv,
        dataPoints: [
          {
            timestamp: Date.now(),
            priceSol: parseFloat(pair.priceNative),
            priceUsd: parseFloat(pair.priceUsd),
            volumeSol: 0,
            marketCapUsd: pair.fdv,
            bondingProgress: 100, // Already graduated if on DEX
            holderCount: 0,
            liquidityUsd: pair.liquidity?.usd ?? 0,
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to fetch DexScreener data', { tokenMint, error });
      return null;
    }
  }

  // ===========================================================================
  // DATABASE OPERATIONS
  // ===========================================================================

  /**
   * Saves historical token data to database
   */
  async saveToDatabase(token: HistoricalToken): Promise<void> {
    try {
      // Save token record
      await db.query(
        `INSERT INTO historical_tokens
         (mint_address, symbol, name, launch_timestamp, migration_timestamp, outcome, peak_market_cap_usd, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (mint_address) DO UPDATE SET
           symbol = EXCLUDED.symbol,
           name = EXCLUDED.name,
           migration_timestamp = EXCLUDED.migration_timestamp,
           outcome = EXCLUDED.outcome,
           peak_market_cap_usd = EXCLUDED.peak_market_cap_usd,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [
          token.mintAddress,
          token.symbol,
          token.name,
          new Date(token.launchTimestamp),
          token.migrationTimestamp ? new Date(token.migrationTimestamp) : null,
          token.outcome,
          token.peakMarketCapUsd,
          JSON.stringify(token.metadata ?? {}),
        ]
      );

      // Save data points in batch
      if (token.dataPoints.length > 0) {
        const values: unknown[] = [];
        const placeholders: string[] = [];

        token.dataPoints.forEach((point, idx) => {
          const offset = idx * 9;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`
          );
          values.push(
            token.mintAddress,
            new Date(point.timestamp),
            point.priceSol,
            point.priceUsd,
            point.volumeSol,
            point.marketCapUsd,
            point.bondingProgress,
            point.holderCount,
            point.liquidityUsd
          );
        });

        await db.query(
          `INSERT INTO historical_data_points
           (mint_address, timestamp, price_sol, price_usd, volume_sol, market_cap_usd, bonding_progress, holder_count, liquidity_usd)
           VALUES ${placeholders.join(', ')}
           ON CONFLICT (mint_address, timestamp) DO NOTHING`,
          values
        );
      }

      logger.debug('Saved historical token to database', {
        mintAddress: token.mintAddress,
        dataPoints: token.dataPoints.length,
      });
    } catch (error) {
      logger.error('Failed to save historical token', {
        mintAddress: token.mintAddress,
        error,
      });
    }
  }

  /**
   * Loads historical token data from database
   */
  async loadFromDatabase(mintAddress: SolanaAddress): Promise<HistoricalToken | null> {
    // Define row types for database queries
    interface TokenRow {
      mint_address: string;
      symbol: string;
      name: string;
      launch_timestamp: Date | string;
      migration_timestamp?: Date | string | null;
      outcome: string;
      peak_market_cap_usd: string | number;
      metadata?: Record<string, unknown>;
    }

    interface DataPointRow {
      timestamp: Date | string;
      price_sol: string | number;
      price_usd: string | number;
      volume_sol: string | number;
      market_cap_usd: string | number;
      bonding_progress: string | number;
      holder_count: string | number;
      liquidity_usd: string | number;
    }

    try {
      // Load token record
      const tokenResult = await db.query<TokenRow>(
        `SELECT * FROM historical_tokens WHERE mint_address = $1`,
        [mintAddress]
      );

      if (tokenResult.rows.length === 0) {
        return null;
      }

      const tokenRow = tokenResult.rows[0];
      if (!tokenRow) {
        return null;
      }

      // Load data points
      const pointsResult = await db.query<DataPointRow>(
        `SELECT * FROM historical_data_points
         WHERE mint_address = $1
         ORDER BY timestamp ASC`,
        [mintAddress]
      );

      const dataPoints: HistoricalDataPoint[] = pointsResult.rows.map((row) => ({
        timestamp: new Date(row.timestamp).getTime(),
        priceSol: parseFloat(String(row.price_sol)),
        priceUsd: parseFloat(String(row.price_usd)),
        volumeSol: parseFloat(String(row.volume_sol)),
        marketCapUsd: parseFloat(String(row.market_cap_usd)),
        bondingProgress: parseFloat(String(row.bonding_progress)),
        holderCount: parseInt(String(row.holder_count), 10),
        liquidityUsd: parseFloat(String(row.liquidity_usd)),
      }));

      return {
        mintAddress: tokenRow.mint_address as SolanaAddress,
        symbol: tokenRow.symbol,
        name: tokenRow.name,
        launchTimestamp: new Date(tokenRow.launch_timestamp).getTime(),
        migrationTimestamp: tokenRow.migration_timestamp
          ? new Date(tokenRow.migration_timestamp).getTime()
          : undefined,
        outcome: tokenRow.outcome as TokenOutcome,
        peakMarketCapUsd: parseFloat(String(tokenRow.peak_market_cap_usd)),
        dataPoints,
        metadata: tokenRow.metadata,
      };
    } catch (error) {
      logger.error('Failed to load historical token', { mintAddress, error });
      return null;
    }
  }

  /**
   * Loads all historical tokens from database
   */
  async loadAllFromDatabase(): Promise<HistoricalToken[]> {
    try {
      const result = await db.query<{ mint_address: string }>(
        `SELECT mint_address FROM historical_tokens ORDER BY launch_timestamp DESC`
      );

      const tokens: HistoricalToken[] = [];

      for (const row of result.rows) {
        const token = await this.loadFromDatabase(row.mint_address as SolanaAddress);
        if (token) {
          tokens.push(token);
        }
      }

      return tokens;
    } catch (error) {
      logger.error('Failed to load all historical tokens', { error });
      return [];
    }
  }

  // ===========================================================================
  // COLLECTION ORCHESTRATION
  // ===========================================================================

  /**
   * Collects complete historical data for a token
   */
  async collectTokenHistory(
    tokenMint: SolanaAddress,
    fromTimestamp: Timestamp,
    toTimestamp: Timestamp
  ): Promise<HistoricalToken | null> {
    logger.info('Collecting historical data', {
      tokenMint,
      from: new Date(fromTimestamp).toISOString(),
      to: new Date(toTimestamp).toISOString(),
    });

    // Check cache first
    if (this.cache.has(tokenMint)) {
      return this.cache.get(tokenMint)!;
    }

    // Try loading from database
    const dbToken = await this.loadFromDatabase(tokenMint);
    if (dbToken && dbToken.dataPoints.length > 0) {
      this.cache.set(tokenMint, dbToken);
      return dbToken;
    }

    // Collect from APIs
    let token: HistoricalToken | null = null;

    // Try DexScreener first (no API key needed)
    const dexData = await this.fetchDexScreenerData(tokenMint);
    if (dexData) {
      token = {
        mintAddress: dexData.mintAddress ?? tokenMint,
        symbol: dexData.symbol ?? 'UNKNOWN',
        name: dexData.name ?? 'Unknown Token',
        launchTimestamp: dexData.launchTimestamp ?? fromTimestamp,
        outcome: TokenOutcome.ACTIVE,
        peakMarketCapUsd: dexData.peakMarketCapUsd ?? 0,
        dataPoints: dexData.dataPoints ?? [],
      };
    }

    // Enrich with Birdeye data if available
    if (this.birdeyeApiKey) {
      const birdeyeOverview = await this.fetchBirdeyeTokenOverview(tokenMint);
      if (birdeyeOverview && token) {
        token.symbol = birdeyeOverview.symbol ?? token.symbol;
        token.name = birdeyeOverview.name ?? token.name;
        token.peakMarketCapUsd = Math.max(
          token.peakMarketCapUsd,
          birdeyeOverview.peakMarketCapUsd ?? 0
        );
      }

      // Fetch OHLCV data
      const ohlcvData = await this.fetchBirdeyeOHLCV(
        tokenMint,
        '1m',
        Math.floor(fromTimestamp / 1000),
        Math.floor(toTimestamp / 1000)
      );

      if (ohlcvData.length > 0) {
        if (!token) {
          token = {
            mintAddress: tokenMint,
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            launchTimestamp: fromTimestamp,
            outcome: TokenOutcome.ACTIVE,
            peakMarketCapUsd: 0,
            dataPoints: [],
          };
        }
        token.dataPoints = ohlcvData;
      }
    }

    if (token) {
      // Save to database for future use
      await this.saveToDatabase(token);
      this.cache.set(tokenMint, token);
    }

    return token;
  }

  /**
   * Collects historical data for multiple tokens
   */
  async collectBatch(
    tokenMints: SolanaAddress[],
    fromTimestamp: Timestamp,
    toTimestamp: Timestamp,
    onProgress?: (completed: number, total: number) => void
  ): Promise<HistoricalToken[]> {
    const tokens: HistoricalToken[] = [];
    let completed = 0;

    for (const mint of tokenMints) {
      const token = await this.collectTokenHistory(mint, fromTimestamp, toTimestamp);
      if (token) {
        tokens.push(token);
      }

      completed++;
      onProgress?.(completed, tokenMints.length);

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    logger.info('Batch collection complete', {
      requested: tokenMints.length,
      collected: tokens.length,
    });

    return tokens;
  }

  /**
   * Classifies token outcome based on price history
   */
  classifyOutcome(token: HistoricalToken): TokenOutcome {
    if (token.dataPoints.length < 10) {
      return TokenOutcome.ACTIVE;
    }

    const firstPrice = token.dataPoints[0]?.priceUsd ?? 0;
    const lastPrice = token.dataPoints[token.dataPoints.length - 1]?.priceUsd ?? 0;
    const peakPrice = Math.max(...token.dataPoints.map((p) => p.priceUsd));

    if (firstPrice === 0 || lastPrice === 0) {
      return TokenOutcome.FAILED;
    }

    const returnFromPeak = (lastPrice - peakPrice) / peakPrice;
    const totalReturn = (lastPrice - firstPrice) / firstPrice;

    // Rug: Lost more than 90% from peak within 24 hours
    if (returnFromPeak < -0.9) {
      return TokenOutcome.RUG;
    }

    // Success: Maintained value or grew
    if (totalReturn > 0.5) {
      return TokenOutcome.SUCCESS;
    }

    // Neutral: Some loss but not a rug
    if (totalReturn > -0.5) {
      return TokenOutcome.NEUTRAL;
    }

    // Failed: Lost significant value but not a rug
    return TokenOutcome.FAILED;
  }

  /**
   * Clears the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const historicalCollector = new HistoricalDataCollector();

// Convenience exports
export const collectTokenHistory = (
  tokenMint: SolanaAddress,
  from: Timestamp,
  to: Timestamp
) => historicalCollector.collectTokenHistory(tokenMint, from, to);

export const collectBatch = (
  mints: SolanaAddress[],
  from: Timestamp,
  to: Timestamp,
  onProgress?: (completed: number, total: number) => void
) => historicalCollector.collectBatch(mints, from, to, onProgress);

export const loadHistoricalToken = (mint: SolanaAddress) =>
  historicalCollector.loadFromDatabase(mint);

export const loadAllHistoricalTokens = () =>
  historicalCollector.loadAllFromDatabase();
