/**
 * Type declarations for @triton-one/yellowstone-grpc
 *
 * This file provides type declarations to work around package.json exports
 * issue in the yellowstone-grpc package.
 */

declare module '@triton-one/yellowstone-grpc' {
  export interface SubscribeRequest {
    accounts?: Record<string, SubscribeRequestFilterAccounts>;
    slots?: Record<string, SubscribeRequestFilterSlots>;
    transactions?: Record<string, SubscribeRequestFilterTransactions>;
    transactionsStatus?: Record<string, SubscribeRequestFilterTransactions>;
    blocks?: Record<string, SubscribeRequestFilterBlocks>;
    blocksMeta?: Record<string, SubscribeRequestFilterBlocksMeta>;
    entry?: Record<string, SubscribeRequestFilterEntry>;
    commitment?: CommitmentLevel;
    accountsDataSlice?: AccountsDataSlice[];
    ping?: { id: number };
  }

  export interface SubscribeRequestFilterAccounts {
    account?: string[];
    owner?: string[];
    filters?: MemcmpFilter[];
  }

  export interface SubscribeRequestFilterSlots {
    filterByCommitment?: boolean;
  }

  export interface SubscribeRequestFilterTransactions {
    vote?: boolean;
    failed?: boolean;
    signature?: string;
    accountInclude?: string[];
    accountExclude?: string[];
    accountRequired?: string[];
  }

  export interface SubscribeRequestFilterBlocks {
    accountInclude?: string[];
    includeTransactions?: boolean;
    includeAccounts?: boolean;
    includeEntries?: boolean;
  }

  export interface SubscribeRequestFilterBlocksMeta {
    accountInclude?: string[];
  }

  export interface SubscribeRequestFilterEntry {
    // Entry filter options
  }

  export interface MemcmpFilter {
    offset: number;
    data: Uint8Array;
  }

  export interface AccountsDataSlice {
    offset: number;
    length: number;
  }

  export type CommitmentLevel = 0 | 1 | 2; // PROCESSED | CONFIRMED | FINALIZED

  export interface SubscribeUpdate {
    filters?: string[];
    account?: SubscribeUpdateAccount;
    slot?: SubscribeUpdateSlot;
    transaction?: SubscribeUpdateTransaction;
    transactionStatus?: SubscribeUpdateTransactionStatus;
    block?: SubscribeUpdateBlock;
    ping?: { id: number };
    pong?: { id: number };
    blockMeta?: SubscribeUpdateBlockMeta;
    entry?: SubscribeUpdateEntry;
  }

  export interface SubscribeUpdateAccount {
    account?: {
      pubkey?: Uint8Array;
      lamports?: bigint;
      owner?: Uint8Array;
      executable?: boolean;
      rentEpoch?: bigint;
      data?: Uint8Array;
      writeVersion?: bigint;
      txnSignature?: Uint8Array;
    };
    slot?: bigint;
    isStartup?: boolean;
  }

  export interface SubscribeUpdateSlot {
    slot?: bigint;
    parent?: bigint;
    status?: number;
  }

  export interface SubscribeUpdateTransaction {
    transaction?: {
      signature?: Uint8Array;
      isVote?: boolean;
      transaction?: {
        signatures?: Uint8Array[];
        message?: {
          header?: {
            numRequiredSignatures?: number;
            numReadonlySignedAccounts?: number;
            numReadonlyUnsignedAccounts?: number;
          };
          accountKeys?: Uint8Array[];
          recentBlockhash?: Uint8Array;
          instructions?: TransactionInstruction[];
          addressTableLookups?: AddressTableLookup[];
        };
      };
      meta?: TransactionMeta;
      index?: bigint;
    };
    slot?: bigint;
  }

  export interface TransactionInstruction {
    programIdIndex?: number;
    accounts?: number[];
    data?: Uint8Array;
  }

  export interface AddressTableLookup {
    accountKey?: Uint8Array;
    writableIndexes?: number[];
    readonlyIndexes?: number[];
  }

  export interface TransactionMeta {
    err?: unknown;
    fee?: bigint;
    preBalances?: bigint[];
    postBalances?: bigint[];
    innerInstructions?: InnerInstructions[];
    logMessages?: string[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    rewards?: Reward[];
    loadedWritableAddresses?: Uint8Array[];
    loadedReadonlyAddresses?: Uint8Array[];
    returnData?: ReturnData;
    computeUnitsConsumed?: bigint;
  }

  export interface InnerInstructions {
    index?: number;
    instructions?: TransactionInstruction[];
  }

  export interface TokenBalance {
    accountIndex?: number;
    mint?: string;
    uiTokenAmount?: {
      uiAmount?: number;
      decimals?: number;
      amount?: string;
      uiAmountString?: string;
    };
    owner?: string;
    programId?: string;
  }

  export interface Reward {
    pubkey?: string;
    lamports?: bigint;
    postBalance?: bigint;
    rewardType?: number;
    commission?: string;
  }

  export interface ReturnData {
    programId?: Uint8Array;
    data?: Uint8Array;
  }

  export interface SubscribeUpdateTransactionStatus {
    slot?: bigint;
    signature?: Uint8Array;
    isVote?: boolean;
    index?: bigint;
    err?: unknown;
  }

  export interface SubscribeUpdateBlock {
    slot?: bigint;
    blockhash?: string;
    rewards?: Reward[];
    blockTime?: bigint;
    blockHeight?: bigint;
    parentSlot?: bigint;
    parentBlockhash?: string;
    executedTransactionCount?: bigint;
    transactions?: SubscribeUpdateTransaction[];
    updatedAccountCount?: bigint;
    accounts?: SubscribeUpdateAccount[];
    entriesCount?: bigint;
    entries?: SubscribeUpdateEntry[];
  }

  export interface SubscribeUpdateBlockMeta {
    slot?: bigint;
    blockhash?: string;
    rewards?: Reward[];
    blockTime?: bigint;
    blockHeight?: bigint;
    parentSlot?: bigint;
    parentBlockhash?: string;
    executedTransactionCount?: bigint;
  }

  export interface SubscribeUpdateEntry {
    slot?: bigint;
    index?: bigint;
    numHashes?: bigint;
    hash?: Uint8Array;
    executedTransactionCount?: bigint;
  }

  export default class Client {
    constructor(
      endpoint: string,
      xToken?: string,
      channelOptions?: unknown
    );

    subscribe(): Promise<AsyncGenerator<SubscribeUpdate>>;
    close(): void;
  }
}
