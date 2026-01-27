/**
 * Database Infrastructure
 *
 * PostgreSQL connection pool and query utilities.
 */

import pg from 'pg';
import { getEnvConfig } from '../../config/env.js';
import { DatabaseError, DatabaseConnectionError } from '../../core/errors.js';
import { getComponentLogger, type ComponentLogger } from '../logger/index.js';

const { Pool } = pg;

// =============================================================================
// TYPES
// =============================================================================

export interface DatabaseConfig {
  connectionString: string;
  min: number;
  max: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

// =============================================================================
// DATABASE CLASS
// =============================================================================

class Database {
  private pool: pg.Pool | null = null;
  private logger: ComponentLogger | null = null;
  private initialized = false;

  /**
   * Initializes the database connection pool.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger = getComponentLogger('database');

    try {
      const env = getEnvConfig();

      const config: DatabaseConfig = {
        connectionString: env.DATABASE_URL,
        min: env.DATABASE_POOL_MIN,
        max: env.DATABASE_POOL_MAX,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };

      this.pool = new Pool(config);

      // Test connection
      await this.testConnection();

      // Set up error handlers
      this.pool.on('error', (err) => {
        this.logger?.error('Unexpected pool error', { error: err.message });
      });

      this.pool.on('connect', () => {
        this.logger?.debug('New client connected to pool');
      });

      this.initialized = true;
      this.logger?.info('Database initialized', {
        min: config.min,
        max: config.max,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatabaseConnectionError(message);
    }
  }

  /**
   * Tests the database connection.
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query<{ now: Date }>('SELECT NOW() as now');
      this.logger?.debug('Connection test successful', {
        serverTime: result.rows[0]?.now,
      });
      return true;
    } catch (error) {
      this.logger?.error('Connection test failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Executes a SQL query.
   */
  async query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized');
    }

    const start = Date.now();

    try {
      const result = await this.pool.query(text, values);

      this.logger?.trace('Query executed', {
        text: text.substring(0, 100),
        duration: Date.now() - start,
        rowCount: result.rowCount,
      });

      return {
        rows: result.rows as T[],
        rowCount: result.rowCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error('Query failed', {
        text: text.substring(0, 100),
        error: message,
        duration: Date.now() - start,
      });
      throw new DatabaseError(`Query failed: ${message}`, { query: text.substring(0, 100) });
    }
  }

  /**
   * Executes multiple queries in a transaction.
   */
  async transaction<T>(
    callback: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized');
    }

    const client = await this.pool.connect();
    const start = Date.now();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');

      this.logger?.debug('Transaction committed', {
        duration: Date.now() - start,
      });

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const message = error instanceof Error ? error.message : String(error);

      this.logger?.error('Transaction rolled back', {
        error: message,
        duration: Date.now() - start,
      });

      throw new DatabaseError(`Transaction failed: ${message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Gets a client from the pool (for advanced use cases).
   */
  async getClient(): Promise<pg.PoolClient> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized');
    }
    return this.pool.connect();
  }

  /**
   * Gets pool statistics.
   */
  getPoolStats(): {
    total: number;
    idle: number;
    waiting: number;
  } {
    if (!this.pool) {
      return { total: 0, idle: 0, waiting: 0 };
    }
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /**
   * Closes the database connection pool.
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
      this.logger?.info('Database connection closed');
    }
  }

  /**
   * Checks if the database is initialized and healthy.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.initialized || !this.pool) {
      return false;
    }

    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const db = new Database();

// Export convenience methods
export const query = <T = Record<string, unknown>>(
  text: string,
  values?: unknown[]
) => db.query<T>(text, values);

export const transaction = <T>(
  callback: (client: pg.PoolClient) => Promise<T>
) => db.transaction(callback);

export const initializeDatabase = () => db.initialize();
export const closeDatabase = () => db.close();
export const isDatabaseHealthy = () => db.isHealthy();
export const getPoolStats = () => db.getPoolStats();
