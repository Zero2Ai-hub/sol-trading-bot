/**
 * Jest Test Setup
 *
 * This file runs before each test suite.
 * Configure global mocks, test utilities, and environment here.
 */

import { jest } from '@jest/globals';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise during tests
process.env.LOG_TO_CONSOLE = 'false';
process.env.LOG_TO_FILE = 'false';

// Mock console methods to reduce noise (optional - uncomment if needed)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   // Keep error for debugging
//   error: console.error,
// };

// Global test timeout
jest.setTimeout(30000);

// Clean up after all tests
afterAll(async () => {
  // Close any open connections, cleanup resources
  // This will be populated as we add more infrastructure
});

// Export utilities for tests
export const testUtils = {
  /**
   * Wait for a condition to be true
   */
  async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs = 5000,
    intervalMs = 100
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  },

  /**
   * Generate a random Solana-like address for testing
   */
  randomAddress(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 44; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Generate a random transaction signature for testing
   */
  randomSignature(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 88; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Sleep for a given number of milliseconds
   */
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
};
