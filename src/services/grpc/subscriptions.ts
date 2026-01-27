/**
 * gRPC Subscription Builders
 *
 * Builds subscription requests for Yellowstone gRPC with proper filters
 * for Pump.fun program accounts and transactions.
 */

import type {
  SubscribeRequest,
  SubscribeRequestFilterAccounts,
  SubscribeRequestFilterTransactions,
  CommitmentLevel,
} from '@triton-one/yellowstone-grpc';
import { PUMP_FUN_PROGRAM_ID, PUMP_FUN_MIGRATION_ACCOUNT } from '../../config/constants.js';

// =============================================================================
// TYPES
// =============================================================================

export interface SubscriptionConfig {
  /** Subscribe to account updates */
  accounts: boolean;

  /** Subscribe to transactions */
  transactions: boolean;

  /** Subscribe to slot updates */
  slots: boolean;

  /** Commitment level */
  commitment: CommitmentLevel;

  /** Additional program IDs to monitor */
  additionalPrograms?: string[];
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  accounts: true,
  transactions: true,
  slots: false,
  commitment: 1, // CONFIRMED
};

// =============================================================================
// SUBSCRIPTION BUILDERS
// =============================================================================

/**
 * Builds account subscription filter for Pump.fun program
 */
export function buildAccountFilter(
  programs: string[] = [PUMP_FUN_PROGRAM_ID]
): SubscribeRequestFilterAccounts {
  return {
    account: [],
    owner: programs,
    filters: [],
  };
}

/**
 * Builds transaction subscription filter for Pump.fun
 */
export function buildTransactionFilter(
  programs: string[] = [PUMP_FUN_PROGRAM_ID]
): SubscribeRequestFilterTransactions {
  return {
    vote: false,
    failed: false,
    signature: undefined,
    accountInclude: programs,
    accountExclude: [],
    accountRequired: [],
  };
}

/**
 * Builds complete subscription request for Pump.fun monitoring
 */
export function buildPumpFunSubscription(
  config: Partial<SubscriptionConfig> = {}
): SubscribeRequest {
  const mergedConfig = { ...DEFAULT_SUBSCRIPTION_CONFIG, ...config };
  const programs = [PUMP_FUN_PROGRAM_ID, ...(mergedConfig.additionalPrograms ?? [])];

  const request: SubscribeRequest = {
    accounts: {},
    slots: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment: mergedConfig.commitment,
    accountsDataSlice: [],
    ping: undefined,
  };

  // Add account subscription
  if (mergedConfig.accounts) {
    request.accounts = {
      pumpfun: buildAccountFilter(programs),
    };
  }

  // Add transaction subscription
  if (mergedConfig.transactions) {
    request.transactions = {
      pumpfun: buildTransactionFilter(programs),
    };
  }

  // Add slot subscription
  if (mergedConfig.slots) {
    request.slots = {
      slots: {
        filterByCommitment: true,
      },
    };
  }

  return request;
}

/**
 * Builds subscription specifically for migration events
 * (watches the migration authority account)
 */
export function buildMigrationSubscription(): SubscribeRequest {
  return {
    accounts: {
      migration: {
        account: [PUMP_FUN_MIGRATION_ACCOUNT],
        owner: [],
        filters: [],
      },
    },
    slots: {},
    transactions: {
      migration: {
        vote: false,
        failed: false,
        signature: undefined,
        accountInclude: [PUMP_FUN_MIGRATION_ACCOUNT],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment: 1, // CONFIRMED
    accountsDataSlice: [],
    ping: undefined,
  };
}

/**
 * Merges multiple subscription requests
 */
export function mergeSubscriptions(...subscriptions: SubscribeRequest[]): SubscribeRequest {
  const merged: SubscribeRequest = {
    accounts: {},
    slots: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment: 1,
    accountsDataSlice: [],
    ping: undefined,
  };

  for (const sub of subscriptions) {
    merged.accounts = { ...merged.accounts, ...sub.accounts };
    merged.slots = { ...merged.slots, ...sub.slots };
    merged.transactions = { ...merged.transactions, ...sub.transactions };
    merged.transactionsStatus = { ...merged.transactionsStatus, ...sub.transactionsStatus };
    merged.blocks = { ...merged.blocks, ...sub.blocks };
    merged.blocksMeta = { ...merged.blocksMeta, ...sub.blocksMeta };
  }

  return merged;
}

// =============================================================================
// COMMITMENT LEVELS
// =============================================================================

export const CommitmentLevels = {
  PROCESSED: 0,
  CONFIRMED: 1,
  FINALIZED: 2,
} as const;

/**
 * Returns recommended commitment level for trading
 * CONFIRMED is fastest while still being reliable
 */
export function getTradingCommitment(): CommitmentLevel {
  return CommitmentLevels.CONFIRMED;
}
