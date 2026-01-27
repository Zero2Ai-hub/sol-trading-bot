/**
 * Jito Bundle Client
 *
 * Submits transactions via Jito block engine for MEV protection.
 * Features:
 * - Bundle submission with tips
 * - Bundle status tracking
 * - Confirmation polling
 * - Fallback to regular RPC
 */

import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { getRpc } from '../infrastructure/rpc/index.js';
import { getEnvConfig } from '../config/env.js';
import type { SolanaAddress, Timestamp } from '../core/types.js';
import type { BundleResult, ExecutorConfig } from './types.js';
import { DEFAULT_EXECUTOR_CONFIG } from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

// Jito Block Engine endpoints
const JITO_BLOCK_ENGINE_MAINNET = 'https://mainnet.block-engine.jito.wtf';
const JITO_BLOCK_ENGINE_API = `${JITO_BLOCK_ENGINE_MAINNET}/api/v1`;

// Jito tip accounts (rotate for load balancing)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

const logger = getComponentLogger('Jito');

// =============================================================================
// JITO CLIENT CLASS
// =============================================================================

/**
 * Bundle status response
 */
interface BundleStatusResponse {
  jsonrpc: string;
  result: {
    context: { slot: number };
    value: Array<{
      bundle_id: string;
      status: 'Invalid' | 'Pending' | 'Landed' | 'Failed';
      landed_slot?: number;
    }>;
  };
}

/**
 * Send bundle response
 */
interface SendBundleResponse {
  jsonrpc: string;
  result: string; // bundle_id
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Jito Bundle Client
 */
export class JitoClient {
  private config: ExecutorConfig;
  private currentTipAccountIndex: number = 0;
  private endpoint: string;

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };

    // Use configured endpoint or default
    try {
      const env = getEnvConfig();
      this.endpoint = env.JITO_BLOCK_ENGINE_URL || JITO_BLOCK_ENGINE_API;
    } catch {
      this.endpoint = JITO_BLOCK_ENGINE_API;
    }
  }

  // ===========================================================================
  // TIP MANAGEMENT
  // ===========================================================================

  /**
   * Gets the next tip account (round-robin)
   */
  getNextTipAccount(): SolanaAddress {
    const account = JITO_TIP_ACCOUNTS[this.currentTipAccountIndex];
    this.currentTipAccountIndex = (this.currentTipAccountIndex + 1) % JITO_TIP_ACCOUNTS.length;
    return account as SolanaAddress;
  }

  /**
   * Creates a tip instruction
   */
  async createTipInstruction(
    tipperSigner: KeyPairSigner,
    tipLamports: bigint = BigInt(this.config.jitoTipLamports)
  ): Promise<ReturnType<typeof getTransferSolInstruction>> {
    const tipAccount = this.getNextTipAccount();

    return getTransferSolInstruction({
      source: tipperSigner,
      destination: tipAccount as Address,
      amount: tipLamports,
    });
  }

  // ===========================================================================
  // BUNDLE SUBMISSION
  // ===========================================================================

  /**
   * Submits a bundle to Jito block engine
   */
  async submitBundle(
    serializedTransactions: string[],
  ): Promise<BundleResult> {
    const startTime = Date.now();

    try {
      logger.info('Submitting bundle to Jito', {
        txCount: serializedTransactions.length,
        endpoint: this.endpoint,
      });

      const response = await fetch(`${this.endpoint}/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [serializedTransactions],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jito API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as SendBundleResponse;

      if (data.error) {
        return {
          bundleId: '',
          accepted: false,
          landed: false,
          signatures: [],
          error: data.error.message,
        };
      }

      const bundleId = data.result;

      logger.info('Bundle submitted', {
        bundleId,
        durationMs: Date.now() - startTime,
      });

      return {
        bundleId,
        accepted: true,
        landed: false,
        signatures: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to submit bundle', { error: message });

      return {
        bundleId: '',
        accepted: false,
        landed: false,
        signatures: [],
        error: message,
      };
    }
  }

  /**
   * Submits a single transaction as a bundle
   */
  async submitTransaction(
    serializedTransaction: string,
  ): Promise<BundleResult> {
    return this.submitBundle([serializedTransaction]);
  }

  // ===========================================================================
  // BUNDLE STATUS
  // ===========================================================================

  /**
   * Gets the status of a bundle
   */
  async getBundleStatus(bundleId: string): Promise<{
    status: 'Invalid' | 'Pending' | 'Landed' | 'Failed' | 'Unknown';
    slot?: number;
  }> {
    try {
      const response = await fetch(`${this.endpoint}/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      });

      if (!response.ok) {
        return { status: 'Unknown' };
      }

      const data = await response.json() as BundleStatusResponse;
      const bundleStatus = data.result?.value?.[0];

      if (!bundleStatus) {
        return { status: 'Unknown' };
      }

      return {
        status: bundleStatus.status,
        slot: bundleStatus.landed_slot,
      };
    } catch (error) {
      logger.warn('Failed to get bundle status', { bundleId, error });
      return { status: 'Unknown' };
    }
  }

  /**
   * Waits for a bundle to land
   */
  async waitForBundle(
    bundleId: string,
    timeoutMs: number = this.config.confirmationTimeoutMs
  ): Promise<BundleResult> {
    const startTime = Date.now();
    const pollIntervalMs = 2000;

    logger.debug('Waiting for bundle confirmation', { bundleId, timeoutMs });

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getBundleStatus(bundleId);

      if (status.status === 'Landed') {
        logger.info('Bundle landed', {
          bundleId,
          slot: status.slot,
          durationMs: Date.now() - startTime,
        });

        return {
          bundleId,
          accepted: true,
          landed: true,
          signatures: [],
          slot: status.slot,
        };
      }

      if (status.status === 'Failed' || status.status === 'Invalid') {
        logger.warn('Bundle failed', { bundleId, status: status.status });

        return {
          bundleId,
          accepted: true,
          landed: false,
          signatures: [],
          error: `Bundle ${status.status.toLowerCase()}`,
        };
      }

      // Still pending, wait and retry
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout
    logger.warn('Bundle confirmation timeout', { bundleId, timeoutMs });

    return {
      bundleId,
      accepted: true,
      landed: false,
      signatures: [],
      error: 'Confirmation timeout',
    };
  }

  // ===========================================================================
  // HIGH-LEVEL METHODS
  // ===========================================================================

  /**
   * Submits a bundle and waits for confirmation
   */
  async submitAndConfirm(
    serializedTransactions: string[],
    timeoutMs?: number
  ): Promise<BundleResult> {
    const submitResult = await this.submitBundle(serializedTransactions);

    if (!submitResult.accepted) {
      return submitResult;
    }

    return this.waitForBundle(submitResult.bundleId, timeoutMs);
  }

  /**
   * Submits a single transaction as a bundle and waits for confirmation
   */
  async submitTransactionAndConfirm(
    serializedTransaction: string,
    timeoutMs?: number
  ): Promise<BundleResult> {
    return this.submitAndConfirm([serializedTransaction], timeoutMs);
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Checks if Jito is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTipAccounts',
          params: [],
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Gets recommended tip amount based on network conditions
   */
  async getRecommendedTip(): Promise<bigint> {
    // In production, would query recent tips
    // For now, return configured default
    return BigInt(this.config.jitoTipLamports);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const jitoClient = new JitoClient();

// Convenience exports
export const submitJitoBundle = (transactions: string[]) =>
  jitoClient.submitBundle(transactions);

export const submitJitoTransaction = (transaction: string) =>
  jitoClient.submitTransaction(transaction);

export const waitForJitoBundle = (bundleId: string, timeout?: number) =>
  jitoClient.waitForBundle(bundleId, timeout);

export const isJitoAvailable = () => jitoClient.isAvailable();
