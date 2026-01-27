/**
 * Signal Persistence
 *
 * Stores generated signals to the database for:
 * - Historical analysis
 * - Trade execution tracking
 * - Performance metrics
 */

import { db as defaultDb, type QueryResult } from '../infrastructure/database/index.js';

/** Database interface for signal persistence */
interface Database {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  getClient(): Promise<{ query: (text: string, values?: unknown[]) => Promise<any>; release: () => void }>;
}
import type { SolanaAddress, Timestamp } from '../core/types.js';
import {
  TradingSignal,
  type SignalRecord,
  type GeneratedSignal,
  type ScoreBreakdown,
} from './types.js';

// =============================================================================
// SIGNAL REPOSITORY
// =============================================================================

/**
 * Repository for signal persistence
 */
export class SignalRepository {
  constructor(private db: Database) {}

  /**
   * Saves a generated signal to the database
   */
  async saveSignal(signal: GeneratedSignal): Promise<string> {
    const id = this.generateId();

    const query = `
      INSERT INTO signals (
        id,
        mint_address,
        signal_type,
        momentum_score,
        score_breakdown,
        timestamp,
        executed,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    const values = [
      id,
      signal.mintAddress,
      signal.signal,
      signal.momentumScore,
      JSON.stringify(signal.breakdown),
      new Date(signal.timestamp),
      false,
      JSON.stringify({
        strength: signal.strength,
        reasons: signal.reasons,
        meetsEntryCriteria: signal.meetsEntryCriteria,
        positionSizing: signal.positionSizing,
      }),
    ];

    await this.db.query(query, values);
    return id;
  }

  /**
   * Saves multiple signals in a batch
   */
  async saveSignalsBatch(signals: GeneratedSignal[]): Promise<string[]> {
    if (signals.length === 0) return [];

    const ids: string[] = [];

    // Use a transaction for batch insert
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      for (const signal of signals) {
        const id = this.generateId();
        ids.push(id);

        const query = `
          INSERT INTO signals (
            id,
            mint_address,
            signal_type,
            momentum_score,
            score_breakdown,
            timestamp,
            executed,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const values = [
          id,
          signal.mintAddress,
          signal.signal,
          signal.momentumScore,
          JSON.stringify(signal.breakdown),
          new Date(signal.timestamp),
          false,
          JSON.stringify({
            strength: signal.strength,
            reasons: signal.reasons,
            meetsEntryCriteria: signal.meetsEntryCriteria,
            positionSizing: signal.positionSizing,
          }),
        ];

        await client.query(query, values);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return ids;
  }

  /**
   * Marks a signal as executed
   */
  async markExecuted(
    signalId: string,
    result: 'success' | 'failed' | 'skipped',
    notes?: string
  ): Promise<void> {
    const query = `
      UPDATE signals
      SET
        executed = true,
        executed_at = NOW(),
        execution_result = $2,
        execution_notes = $3
      WHERE id = $1
    `;

    await this.db.query(query, [signalId, result, notes ?? null]);
  }

  /**
   * Gets signal by ID
   */
  async getSignal(signalId: string): Promise<SignalRecord | null> {
    const query = `
      SELECT * FROM signals WHERE id = $1
    `;

    const result = await this.db.query(query, [signalId]);

    if (result.rows.length === 0) return null;

    return this.rowToRecord(result.rows[0]);
  }

  /**
   * Gets recent signals for a token
   */
  async getRecentSignals(
    mintAddress: SolanaAddress,
    limit: number = 10
  ): Promise<SignalRecord[]> {
    const query = `
      SELECT * FROM signals
      WHERE mint_address = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `;

    const result = await this.db.query(query, [mintAddress, limit]);
    return result.rows.map(row => this.rowToRecord(row));
  }

  /**
   * Gets all unexecuted actionable signals
   */
  async getUnexecutedSignals(): Promise<SignalRecord[]> {
    const query = `
      SELECT * FROM signals
      WHERE executed = false
        AND signal_type IN ('STRONG_BUY', 'BUY')
      ORDER BY momentum_score DESC, timestamp DESC
    `;

    const result = await this.db.query(query);
    return result.rows.map(row => this.rowToRecord(row));
  }

  /**
   * Gets signals within a time range
   */
  async getSignalsInRange(
    startTime: Timestamp,
    endTime: Timestamp,
    signalType?: TradingSignal
  ): Promise<SignalRecord[]> {
    let query = `
      SELECT * FROM signals
      WHERE timestamp >= $1 AND timestamp <= $2
    `;

    const params: any[] = [new Date(startTime), new Date(endTime)];

    if (signalType) {
      query += ` AND signal_type = $3`;
      params.push(signalType);
    }

    query += ` ORDER BY timestamp DESC`;

    const result = await this.db.query(query, params);
    return result.rows.map(row => this.rowToRecord(row));
  }

  /**
   * Gets signal statistics for a time period
   */
  async getSignalStats(
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<SignalStatistics> {
    const query = `
      SELECT
        signal_type,
        COUNT(*) as count,
        AVG(momentum_score) as avg_score,
        COUNT(CASE WHEN executed THEN 1 END) as executed_count,
        COUNT(CASE WHEN execution_result = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN execution_result = 'failed' THEN 1 END) as failed_count
      FROM signals
      WHERE timestamp >= $1 AND timestamp <= $2
      GROUP BY signal_type
    `;

    const result = await this.db.query(query, [new Date(startTime), new Date(endTime)]);

    const stats: SignalStatistics = {
      totalSignals: 0,
      byType: {},
      executionRate: 0,
      successRate: 0,
    };

    let totalExecuted = 0;
    let totalSuccess = 0;

    for (const row of result.rows) {
      const r = row as {
        signal_type: string;
        count: string;
        avg_score: string;
        executed_count: string;
        success_count: string;
        failed_count: string;
      };
      const count = parseInt(r.count, 10);
      stats.totalSignals += count;
      stats.byType[r.signal_type as TradingSignal] = {
        count,
        avgScore: parseFloat(r.avg_score) || 0,
        executedCount: parseInt(r.executed_count, 10),
        successCount: parseInt(r.success_count, 10),
        failedCount: parseInt(r.failed_count, 10),
      };
      totalExecuted += parseInt(r.executed_count, 10);
      totalSuccess += parseInt(r.success_count, 10);
    }

    stats.executionRate = stats.totalSignals > 0
      ? totalExecuted / stats.totalSignals
      : 0;
    stats.successRate = totalExecuted > 0
      ? totalSuccess / totalExecuted
      : 0;

    return stats;
  }

  /**
   * Deletes old signals beyond retention period
   */
  async pruneOldSignals(retentionDays: number): Promise<number> {
    const query = `
      DELETE FROM signals
      WHERE timestamp < NOW() - INTERVAL '${retentionDays} days'
      RETURNING id
    `;

    const result = await this.db.query(query);
    return result.rowCount ?? 0;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private generateId(): string {
    // Generate a unique ID: timestamp + random
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `sig_${timestamp}_${random}`;
  }

  private rowToRecord(row: any): SignalRecord {
    return {
      id: row.id,
      mintAddress: row.mint_address,
      signal: row.signal_type as TradingSignal,
      momentumScore: parseFloat(row.momentum_score),
      scoreBreakdown: typeof row.score_breakdown === 'string'
        ? JSON.parse(row.score_breakdown)
        : row.score_breakdown,
      timestamp: new Date(row.timestamp).getTime(),
      executed: row.executed,
      executedAt: row.executed_at ? new Date(row.executed_at).getTime() : undefined,
      executionResult: row.execution_result,
      executionNotes: row.execution_notes,
    };
  }
}

// =============================================================================
// STATISTICS TYPE
// =============================================================================

export interface SignalStatistics {
  totalSignals: number;
  byType: Record<string, {
    count: number;
    avgScore: number;
    executedCount: number;
    successCount: number;
    failedCount: number;
  }>;
  executionRate: number;
  successRate: number;
}

// =============================================================================
// IN-MEMORY SIGNAL BUFFER
// =============================================================================

/**
 * Buffers signals in memory before batch persistence
 * Useful for reducing database writes
 */
export class SignalBuffer {
  private buffer: GeneratedSignal[] = [];
  private maxSize: number;
  private flushCallback: ((signals: GeneratedSignal[]) => Promise<void>) | null = null;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Sets the callback to run when buffer is flushed
   */
  onFlush(callback: (signals: GeneratedSignal[]) => Promise<void>): void {
    this.flushCallback = callback;
  }

  /**
   * Adds a signal to the buffer
   */
  async add(signal: GeneratedSignal): Promise<void> {
    this.buffer.push(signal);

    if (this.buffer.length >= this.maxSize) {
      await this.flush();
    }
  }

  /**
   * Adds multiple signals to the buffer
   */
  async addBatch(signals: GeneratedSignal[]): Promise<void> {
    this.buffer.push(...signals);

    if (this.buffer.length >= this.maxSize) {
      await this.flush();
    }
  }

  /**
   * Flushes all buffered signals
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const toFlush = [...this.buffer];
    this.buffer = [];

    if (this.flushCallback) {
      await this.flushCallback(toFlush);
    }
  }

  /**
   * Gets current buffer size
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Clears buffer without flushing
   */
  clear(): void {
    this.buffer = [];
  }
}

// =============================================================================
// SIGNAL FILTER PRESETS
// =============================================================================

/**
 * Filters for common signal queries
 */
export const SignalFilters = {
  /** Only actionable signals (BUY/STRONG_BUY) */
  actionable: (signal: SignalRecord) =>
    signal.signal === TradingSignal.BUY || signal.signal === TradingSignal.STRONG_BUY,

  /** High confidence signals (score >= 80) */
  highConfidence: (signal: SignalRecord) =>
    signal.momentumScore >= 80,

  /** Not yet executed */
  unexecuted: (signal: SignalRecord) =>
    !signal.executed,

  /** Successfully executed */
  successfullyExecuted: (signal: SignalRecord) =>
    signal.executed && signal.executionResult === 'success',

  /** Failed execution */
  failedExecution: (signal: SignalRecord) =>
    signal.executed && signal.executionResult === 'failed',

  /** Recent (last hour) */
  recent: (signal: SignalRecord) =>
    Date.now() - signal.timestamp < 60 * 60 * 1000,
};
