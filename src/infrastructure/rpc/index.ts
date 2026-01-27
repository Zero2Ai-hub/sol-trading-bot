/**
 * RPC Manager
 *
 * Manages RPC connections with automatic health checks, failover,
 * and connection pooling.
 */

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from '@solana/kit';
import { getEnvConfig } from '../../config/env.js';
import { NoHealthyRPCError, RPCError } from '../../core/errors.js';
import { getComponentLogger, type ComponentLogger } from '../logger/index.js';
import { checkEndpointHealth } from './health.js';

// =============================================================================
// TYPES
// =============================================================================

export interface RPCEndpoint {
  url: string;
  wsUrl?: string;
  name: string;
  priority: number;
  isHealthy: boolean;
  lastLatencyMs: number;
  lastCheckedAt: Date | null;
  failureCount: number;
}

export interface RPCManagerConfig {
  healthCheckIntervalMs: number;
  maxLatencyMs: number;
  maxFailuresBeforeUnhealthy: number;
  recoveryCheckIntervalMs: number;
}

// =============================================================================
// RPC MANAGER CLASS
// =============================================================================

class RPCManager {
  private endpoints: RPCEndpoint[] = [];
  private activeEndpoint: RPCEndpoint | null = null;
  private rpc: Rpc<SolanaRpcApi> | null = null;
  private rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private logger: ComponentLogger | null = null;
  private config: RPCManagerConfig;
  private initialized = false;

  constructor() {
    this.config = {
      healthCheckIntervalMs: 10000,
      maxLatencyMs: 500,
      maxFailuresBeforeUnhealthy: 3,
      recoveryCheckIntervalMs: 30000,
    };
  }

  /**
   * Initializes the RPC manager with configured endpoints.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger = getComponentLogger('rpc');

    try {
      const env = getEnvConfig();

      this.config = {
        healthCheckIntervalMs: env.RPC_HEALTH_CHECK_INTERVAL_MS,
        maxLatencyMs: env.RPC_MAX_LATENCY_MS,
        maxFailuresBeforeUnhealthy: 3,
        recoveryCheckIntervalMs: 30000,
      };

      // Set up endpoints
      this.endpoints = [
        {
          url: env.HELIUS_RPC_URL,
          wsUrl: env.HELIUS_WS_URL,
          name: 'helius-primary',
          priority: 0,
          isHealthy: false,
          lastLatencyMs: 0,
          lastCheckedAt: null,
          failureCount: 0,
        },
        ...env.BACKUP_RPC_URLS.map((url, index) => ({
          url,
          name: `backup-${index + 1}`,
          priority: index + 1,
          isHealthy: false,
          lastLatencyMs: 0,
          lastCheckedAt: null,
          failureCount: 0,
        })),
      ];

      // Perform initial health check
      await this.performHealthCheck();

      // Select best endpoint
      await this.selectBestEndpoint();

      // Start periodic health checks
      this.startHealthCheckLoop();

      this.initialized = true;
      this.logger?.info('RPC Manager initialized', {
        endpoints: this.endpoints.map(e => ({ name: e.name, url: e.url })),
        active: this.activeEndpoint?.name,
      });
    } catch (error) {
      this.logger?.error('Failed to initialize RPC Manager', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Gets the current RPC client.
   */
  getRpc(): Rpc<SolanaRpcApi> {
    if (!this.rpc) {
      throw new RPCError('RPC Manager not initialized');
    }
    return this.rpc;
  }

  /**
   * Gets the current WebSocket subscriptions client.
   */
  getRpcSubscriptions(): RpcSubscriptions<SolanaRpcSubscriptionsApi> {
    if (!this.rpcSubscriptions) {
      throw new RPCError('RPC Manager not initialized or no WebSocket endpoint');
    }
    return this.rpcSubscriptions;
  }

  /**
   * Gets the current active endpoint info.
   */
  getActiveEndpoint(): RPCEndpoint | null {
    return this.activeEndpoint;
  }

  /**
   * Gets all endpoints with their health status.
   */
  getAllEndpoints(): RPCEndpoint[] {
    return [...this.endpoints];
  }

  /**
   * Forces a failover to the next healthy endpoint.
   */
  async failover(): Promise<void> {
    if (this.activeEndpoint) {
      this.activeEndpoint.failureCount++;
      if (this.activeEndpoint.failureCount >= this.config.maxFailuresBeforeUnhealthy) {
        this.activeEndpoint.isHealthy = false;
      }
    }

    await this.selectBestEndpoint();
    this.logger?.warn('RPC failover executed', {
      newEndpoint: this.activeEndpoint?.name,
    });
  }

  /**
   * Records a successful request (resets failure count).
   */
  recordSuccess(): void {
    if (this.activeEndpoint) {
      this.activeEndpoint.failureCount = 0;
    }
  }

  /**
   * Records a failed request.
   */
  recordFailure(): void {
    if (this.activeEndpoint) {
      this.activeEndpoint.failureCount++;
      this.logger?.debug('RPC failure recorded', {
        endpoint: this.activeEndpoint.name,
        failures: this.activeEndpoint.failureCount,
      });
    }
  }

  /**
   * Stops the health check loop and cleans up.
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.initialized = false;
    this.logger?.info('RPC Manager stopped');
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private async performHealthCheck(): Promise<void> {
    const checkPromises = this.endpoints.map(async endpoint => {
      const result = await checkEndpointHealth(endpoint.url, {
        timeoutMs: 5000,
        maxLatencyMs: this.config.maxLatencyMs,
      });

      endpoint.isHealthy = result.isHealthy;
      endpoint.lastLatencyMs = result.latencyMs;
      endpoint.lastCheckedAt = result.checkedAt;

      // Reset failure count if healthy
      if (result.isHealthy) {
        endpoint.failureCount = 0;
      }

      return { endpoint, result };
    });

    const results = await Promise.all(checkPromises);

    const healthy = results.filter(r => r.result.isHealthy);
    const unhealthy = results.filter(r => !r.result.isHealthy);

    this.logger?.debug('Health check completed', {
      healthy: healthy.length,
      unhealthy: unhealthy.length,
      details: results.map(r => ({
        name: r.endpoint.name,
        healthy: r.result.isHealthy,
        latency: r.result.latencyMs,
      })),
    });

    // Log warnings for unhealthy endpoints
    unhealthy.forEach(({ endpoint, result }) => {
      this.logger?.warn(`Endpoint unhealthy: ${endpoint.name}`, {
        error: result.errorMessage,
        latency: result.latencyMs,
      });
    });
  }

  private async selectBestEndpoint(): Promise<void> {
    // Sort by priority, then by latency
    const candidates = [...this.endpoints]
      .filter(e => e.isHealthy)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.lastLatencyMs - b.lastLatencyMs;
      });

    if (candidates.length === 0) {
      // Try all endpoints one more time
      await this.performHealthCheck();
      const healthyAfterRetry = this.endpoints.filter(e => e.isHealthy);

      if (healthyAfterRetry.length === 0) {
        this.logger?.error('No healthy RPC endpoints available');
        throw new NoHealthyRPCError(this.endpoints.map(e => e.url));
      }
    }

    const best = this.endpoints.filter(e => e.isHealthy)[0];
    if (!best) {
      throw new NoHealthyRPCError(this.endpoints.map(e => e.url));
    }

    // Only switch if different from current
    if (this.activeEndpoint?.url !== best.url) {
      this.activeEndpoint = best;
      this.rpc = createSolanaRpc(best.url);

      if (best.wsUrl) {
        this.rpcSubscriptions = createSolanaRpcSubscriptions(best.wsUrl);
      }

      this.logger?.info('Active RPC endpoint changed', {
        name: best.name,
        url: best.url,
        latency: best.lastLatencyMs,
      });
    }
  }

  private startHealthCheckLoop(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();

        // Check if current endpoint is still healthy
        if (this.activeEndpoint && !this.activeEndpoint.isHealthy) {
          this.logger?.warn('Active endpoint became unhealthy, selecting new endpoint');
          await this.selectBestEndpoint();
        }
      } catch (error) {
        this.logger?.error('Health check loop error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.healthCheckIntervalMs);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const rpcManager = new RPCManager();

// Convenience exports
export const getRpc = () => rpcManager.getRpc();
export const getRpcSubscriptions = () => rpcManager.getRpcSubscriptions();
export const initializeRPC = () => rpcManager.initialize();
export const stopRPC = () => rpcManager.stop();

// Re-export health utilities
export * from './health.js';
