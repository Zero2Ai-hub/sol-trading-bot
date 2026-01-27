/**
 * Configuration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Configuration Module', () => {
  beforeAll(() => {
    // Set required environment variables for testing
    process.env.NODE_ENV = 'test';
    process.env.HELIUS_RPC_URL = 'https://test.helius-rpc.com/?api-key=test';
    process.env.HELIUS_WS_URL = 'wss://test.helius-rpc.com/?api-key=test';
    process.env.HELIUS_API_KEY = 'test-api-key';
    process.env.WALLET_PRIVATE_KEY = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi4UACB3zSRdRbCpoGUWJQoNd4PBvEGQaEiQj5FkHPt8dzz';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.MAX_POSITION_SIZE_SOL = '0.5';
    process.env.DAILY_LOSS_LIMIT_PERCENT = '10';
    process.env.TAKE_PROFIT_LEVELS = '25,50,100';
    process.env.TAKE_PROFIT_PERCENTAGES = '30,40,30';
  });

  afterAll(() => {
    // Clean up
  });

  describe('Environment Validation', () => {
    it('should load valid configuration', async () => {
      const { getEnvConfig, resetEnvConfig } = await import('../../src/config/env.js');
      resetEnvConfig();

      const config = getEnvConfig();

      expect(config.NODE_ENV).toBe('test');
      expect(config.HELIUS_RPC_URL).toBe('https://test.helius-rpc.com/?api-key=test');
      expect(config.MAX_POSITION_SIZE_SOL).toBe(0.5);
      expect(config.DAILY_LOSS_LIMIT_PERCENT).toBe(10);
    });

    it('should parse take profit arrays correctly', async () => {
      const { getEnvConfig, resetEnvConfig } = await import('../../src/config/env.js');
      resetEnvConfig();

      const config = getEnvConfig();

      expect(config.TAKE_PROFIT_LEVELS).toEqual([25, 50, 100]);
      expect(config.TAKE_PROFIT_PERCENTAGES).toEqual([30, 40, 30]);
    });

    it('should sanitize sensitive values', async () => {
      const { getSanitizedConfig, resetEnvConfig } = await import('../../src/config/env.js');
      resetEnvConfig();

      const sanitized = getSanitizedConfig();

      expect(sanitized.WALLET_PRIVATE_KEY).toBe('[REDACTED]');
      expect(sanitized.HELIUS_API_KEY).toBe('[REDACTED]');
    });
  });

  describe('Constants', () => {
    it('should export valid program IDs', async () => {
      const {
        PUMP_FUN_PROGRAM_ID,
        WSOL_MINT,
        USDC_MINT,
        JITO_TIP_ACCOUNTS,
      } = await import('../../src/config/constants.js');

      expect(PUMP_FUN_PROGRAM_ID).toBe('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
      expect(WSOL_MINT).toBe('So11111111111111111111111111111111111111112');
      expect(USDC_MINT).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(JITO_TIP_ACCOUNTS.length).toBe(8);
    });

    it('should have valid bonding curve config', async () => {
      const { BONDING_CURVE } = await import('../../src/config/constants.js');

      expect(BONDING_CURVE.GRADUATION_MARKET_CAP_USD).toBe(69000);
      expect(BONDING_CURVE.TOTAL_SUPPLY).toBe(1_000_000_000);
    });
  });

  describe('Networks', () => {
    it('should return correct network config', async () => {
      const { getNetworkConfig, NETWORKS } = await import('../../src/config/networks.js');

      const mainnet = getNetworkConfig('mainnet-beta');
      expect(mainnet.name).toBe('mainnet-beta');
      expect(mainnet.isProduction).toBe(true);
      expect(mainnet.jitoAvailable).toBe(true);

      const devnet = getNetworkConfig('devnet');
      expect(devnet.name).toBe('devnet');
      expect(devnet.isProduction).toBe(false);
      expect(devnet.jitoAvailable).toBe(false);
    });

    it('should detect network from URL', async () => {
      const { detectNetworkFromUrl } = await import('../../src/config/networks.js');

      expect(detectNetworkFromUrl('https://api.mainnet-beta.solana.com')).toBe('mainnet-beta');
      expect(detectNetworkFromUrl('https://api.devnet.solana.com')).toBe('devnet');
      expect(detectNetworkFromUrl('https://my.helius-rpc.com')).toBe('mainnet-beta');
      expect(detectNetworkFromUrl('http://127.0.0.1:8899')).toBe('localnet');
    });
  });
});
