/**
 * Wallet Manager
 *
 * Securely manages wallet keypairs with:
 * - Loading from environment (base58 encoded)
 * - Audit logging for all operations
 * - Private key sanitization (never logs keys)
 * - Wallet rotation support
 */

import {
  createKeyPairSignerFromBytes,
  type KeyPairSigner,
  type Address,
  address,
} from '@solana/kit';
import bs58 from 'bs58';
import { getEnvConfig } from '../../config/env.js';
import { InvalidKeyError, WalletError, InsufficientFundsError } from '../../core/errors.js';
import { getComponentLogger, type ComponentLogger } from '../logger/index.js';
import { getRpc } from '../rpc/index.js';
import { shortenAddress } from '../../utils/formatting.js';

// =============================================================================
// TYPES
// =============================================================================

export interface Wallet {
  name: string;
  signer: KeyPairSigner;
  address: Address;
  lastUsedAt: Date | null;
}

export interface WalletBalance {
  address: Address;
  lamports: bigint;
  sol: number;
}

// =============================================================================
// WALLET MANAGER CLASS
// =============================================================================

class WalletManager {
  private wallets: Map<string, Wallet> = new Map();
  private primaryWallet: Wallet | null = null;
  private currentWalletIndex = 0;
  private logger: ComponentLogger | null = null;
  private initialized = false;

  /**
   * Initializes the wallet manager by loading keys from environment.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger = getComponentLogger('wallet');

    try {
      const env = getEnvConfig();

      // Load primary wallet (required)
      const primarySigner = await this.loadKeyFromBase58(env.WALLET_PRIVATE_KEY, 'primary');
      this.primaryWallet = {
        name: 'primary',
        signer: primarySigner,
        address: primarySigner.address,
        lastUsedAt: null,
      };
      this.wallets.set('primary', this.primaryWallet);

      // Load optional wallets
      if (env.WALLET_2_PRIVATE_KEY) {
        const wallet2Signer = await this.loadKeyFromBase58(env.WALLET_2_PRIVATE_KEY, 'wallet-2');
        this.wallets.set('wallet-2', {
          name: 'wallet-2',
          signer: wallet2Signer,
          address: wallet2Signer.address,
          lastUsedAt: null,
        });
      }

      if (env.WALLET_3_PRIVATE_KEY) {
        const wallet3Signer = await this.loadKeyFromBase58(env.WALLET_3_PRIVATE_KEY, 'wallet-3');
        this.wallets.set('wallet-3', {
          name: 'wallet-3',
          signer: wallet3Signer,
          address: wallet3Signer.address,
          lastUsedAt: null,
        });
      }

      this.initialized = true;

      // Log initialization (addresses only, NEVER keys)
      this.logger?.info('Wallet Manager initialized', {
        walletCount: this.wallets.size,
        wallets: Array.from(this.wallets.values()).map(w => ({
          name: w.name,
          address: shortenAddress(w.address),
        })),
      });

      // Audit log
      this.auditLog('WALLETS_LOADED', {
        count: this.wallets.size,
        addresses: Array.from(this.wallets.values()).map(w => w.address),
      });
    } catch (error) {
      this.logger?.error('Failed to initialize Wallet Manager', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Gets the primary wallet signer.
   */
  getPrimarySigner(): KeyPairSigner {
    if (!this.primaryWallet) {
      throw new WalletError('Wallet Manager not initialized');
    }
    return this.primaryWallet.signer;
  }

  /**
   * Gets the primary wallet address.
   */
  getPrimaryAddress(): Address {
    if (!this.primaryWallet) {
      throw new WalletError('Wallet Manager not initialized');
    }
    return this.primaryWallet.address;
  }

  /**
   * Gets a specific wallet by name.
   */
  getWallet(name: string): Wallet | undefined {
    return this.wallets.get(name);
  }

  /**
   * Gets all wallet addresses.
   */
  getAllAddresses(): Address[] {
    return Array.from(this.wallets.values()).map(w => w.address);
  }

  /**
   * Gets the next wallet in rotation (for distributing trades).
   */
  getNextWallet(): Wallet {
    const walletArray = Array.from(this.wallets.values());
    if (walletArray.length === 0) {
      throw new WalletError('No wallets available');
    }

    const wallet = walletArray[this.currentWalletIndex % walletArray.length];
    if (!wallet) {
      throw new WalletError('Wallet rotation error');
    }

    this.currentWalletIndex++;
    wallet.lastUsedAt = new Date();

    this.auditLog('WALLET_SELECTED', {
      name: wallet.name,
      address: shortenAddress(wallet.address),
      rotationIndex: this.currentWalletIndex,
    });

    return wallet;
  }

  /**
   * Gets the balance of a specific wallet.
   */
  async getBalance(walletNameOrAddress?: string): Promise<WalletBalance> {
    let targetAddress: Address;

    if (!walletNameOrAddress) {
      targetAddress = this.getPrimaryAddress();
    } else if (walletNameOrAddress.length === 44) {
      // It's an address
      targetAddress = address(walletNameOrAddress);
    } else {
      // It's a wallet name
      const wallet = this.wallets.get(walletNameOrAddress);
      if (!wallet) {
        throw new WalletError(`Wallet not found: ${walletNameOrAddress}`);
      }
      targetAddress = wallet.address;
    }

    const rpc = getRpc();
    const result = await rpc.getBalance(targetAddress).send();
    const balanceLamports = result.value;
    const balanceSol = Number(balanceLamports) / 1_000_000_000;

    return {
      address: targetAddress,
      lamports: balanceLamports,
      sol: balanceSol,
    };
  }

  /**
   * Gets balances for all wallets.
   */
  async getAllBalances(): Promise<WalletBalance[]> {
    const addresses = this.getAllAddresses();
    const balances = await Promise.all(
      addresses.map(addr => this.getBalance(addr))
    );
    return balances;
  }

  /**
   * Checks if a wallet has sufficient balance.
   */
  async ensureSufficientBalance(
    requiredLamports: bigint,
    walletName?: string
  ): Promise<void> {
    const balance = await this.getBalance(walletName);

    if (balance.lamports < requiredLamports) {
      throw new InsufficientFundsError(
        requiredLamports,
        balance.lamports,
        'SOL'
      );
    }
  }

  /**
   * Records a transaction for audit purposes.
   */
  recordTransaction(
    walletName: string,
    action: string,
    details: Record<string, unknown>
  ): void {
    this.auditLog('TRANSACTION', {
      wallet: walletName,
      action,
      ...details,
    });

    const wallet = this.wallets.get(walletName);
    if (wallet) {
      wallet.lastUsedAt = new Date();
    }
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Loads a keypair from a base58-encoded private key string.
   */
  private async loadKeyFromBase58(
    base58Key: string,
    walletName: string
  ): Promise<KeyPairSigner> {
    try {
      // Validate base58 format
      if (!base58Key || base58Key.length < 32) {
        throw new InvalidKeyError(`Invalid key length for ${walletName}`);
      }

      // Decode from base58
      const secretKey = bs58.decode(base58Key);

      // Validate key length (should be 64 bytes for full keypair)
      if (secretKey.length !== 64) {
        throw new InvalidKeyError(
          `Key for ${walletName} has invalid length: ${secretKey.length} (expected 64)`
        );
      }

      // Create signer
      const signer = await createKeyPairSignerFromBytes(secretKey);

      this.logger?.debug(`Loaded wallet: ${walletName}`, {
        address: shortenAddress(signer.address),
      });

      return signer;
    } catch (error) {
      if (error instanceof InvalidKeyError) {
        throw error;
      }
      throw new InvalidKeyError(
        `Failed to load key for ${walletName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Logs an audit event.
   */
  private auditLog(action: string, details: Record<string, unknown>): void {
    this.logger?.info(`[AUDIT] ${action}`, {
      audit: true,
      action,
      timestamp: new Date().toISOString(),
      ...details,
    });
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const walletManager = new WalletManager();

// Convenience exports
export const initializeWallet = () => walletManager.initialize();
export const getPrimarySigner = () => walletManager.getPrimarySigner();
export const getPrimaryAddress = () => walletManager.getPrimaryAddress();
export const getWalletBalance = (name?: string) => walletManager.getBalance(name);
export const getAllWalletBalances = () => walletManager.getAllBalances();
export const ensureSufficientBalance = (required: bigint, wallet?: string) =>
  walletManager.ensureSufficientBalance(required, wallet);
