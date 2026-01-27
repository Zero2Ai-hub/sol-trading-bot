/**
 * Network Configurations
 *
 * Defines network-specific settings for mainnet, devnet, and testnet.
 */

import type { Commitment } from '@solana/kit';

// =============================================================================
// TYPES
// =============================================================================

export interface NetworkConfig {
  /** Network name */
  name: 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';

  /** Display name */
  displayName: string;

  /** Whether this is a production network */
  isProduction: boolean;

  /** Default RPC HTTP endpoint */
  rpcUrl: string;

  /** Default WebSocket endpoint */
  wsUrl: string;

  /** Block explorer base URL */
  explorerUrl: string;

  /** Solscan base URL */
  solscanUrl: string;

  /** Default commitment level */
  defaultCommitment: Commitment;

  /** Default priority fee in microlamports */
  defaultPriorityFee: bigint;

  /** Whether Jito is available on this network */
  jitoAvailable: boolean;

  /** Jito block engine URL */
  jitoBlockEngineUrl?: string;
}

// =============================================================================
// NETWORK CONFIGURATIONS
// =============================================================================

export const NETWORKS: Record<string, NetworkConfig> = {
  'mainnet-beta': {
    name: 'mainnet-beta',
    displayName: 'Mainnet',
    isProduction: true,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    wsUrl: 'wss://api.mainnet-beta.solana.com',
    explorerUrl: 'https://explorer.solana.com',
    solscanUrl: 'https://solscan.io',
    defaultCommitment: 'confirmed',
    defaultPriorityFee: 10_000n,
    jitoAvailable: true,
    jitoBlockEngineUrl: 'https://mainnet.block-engine.jito.wtf',
  },

  devnet: {
    name: 'devnet',
    displayName: 'Devnet',
    isProduction: false,
    rpcUrl: 'https://api.devnet.solana.com',
    wsUrl: 'wss://api.devnet.solana.com',
    explorerUrl: 'https://explorer.solana.com?cluster=devnet',
    solscanUrl: 'https://solscan.io?cluster=devnet',
    defaultCommitment: 'confirmed',
    defaultPriorityFee: 1_000n,
    jitoAvailable: false,
  },

  testnet: {
    name: 'testnet',
    displayName: 'Testnet',
    isProduction: false,
    rpcUrl: 'https://api.testnet.solana.com',
    wsUrl: 'wss://api.testnet.solana.com',
    explorerUrl: 'https://explorer.solana.com?cluster=testnet',
    solscanUrl: 'https://solscan.io?cluster=testnet',
    defaultCommitment: 'confirmed',
    defaultPriorityFee: 1_000n,
    jitoAvailable: false,
  },

  localnet: {
    name: 'localnet',
    displayName: 'Localnet',
    isProduction: false,
    rpcUrl: 'http://127.0.0.1:8899',
    wsUrl: 'ws://127.0.0.1:8900',
    explorerUrl: 'https://explorer.solana.com?cluster=custom&customUrl=http://127.0.0.1:8899',
    solscanUrl: 'https://solscan.io',
    defaultCommitment: 'confirmed',
    defaultPriorityFee: 0n,
    jitoAvailable: false,
  },
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get network configuration by name
 */
export function getNetworkConfig(network: string): NetworkConfig {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}. Valid networks: ${Object.keys(NETWORKS).join(', ')}`);
  }
  return config;
}

/**
 * Get mainnet configuration
 */
export function getMainnetConfig(): NetworkConfig {
  return NETWORKS['mainnet-beta']!;
}

/**
 * Get devnet configuration
 */
export function getDevnetConfig(): NetworkConfig {
  return NETWORKS['devnet']!;
}

/**
 * Determine network from RPC URL
 */
export function detectNetworkFromUrl(url: string): string {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('mainnet')) {
    return 'mainnet-beta';
  }
  if (lowerUrl.includes('devnet')) {
    return 'devnet';
  }
  if (lowerUrl.includes('testnet')) {
    return 'testnet';
  }
  if (lowerUrl.includes('127.0.0.1') || lowerUrl.includes('localhost')) {
    return 'localnet';
  }

  // Default to mainnet for custom RPC providers (Helius, QuickNode, etc.)
  return 'mainnet-beta';
}

/**
 * Build Solscan transaction URL
 */
export function getSolscanTxUrl(signature: string, network: string = 'mainnet-beta'): string {
  const config = getNetworkConfig(network);
  const clusterParam = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  return `${config.solscanUrl}/tx/${signature}${clusterParam}`;
}

/**
 * Build Solscan account URL
 */
export function getSolscanAccountUrl(address: string, network: string = 'mainnet-beta'): string {
  const config = getNetworkConfig(network);
  const clusterParam = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  return `${config.solscanUrl}/account/${address}${clusterParam}`;
}

/**
 * Build Solscan token URL
 */
export function getSolscanTokenUrl(mint: string, network: string = 'mainnet-beta'): string {
  const config = getNetworkConfig(network);
  const clusterParam = network === 'mainnet-beta' ? '' : `?cluster=${network}`;
  return `${config.solscanUrl}/token/${mint}${clusterParam}`;
}

/**
 * Build Explorer transaction URL
 */
export function getExplorerTxUrl(signature: string, network: string = 'mainnet-beta'): string {
  const config = getNetworkConfig(network);
  return `${config.explorerUrl}/tx/${signature}`;
}

/**
 * Check if network supports Jito
 */
export function supportsJito(network: string): boolean {
  const config = NETWORKS[network];
  return config?.jitoAvailable ?? false;
}
