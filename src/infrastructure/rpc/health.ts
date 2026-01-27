/**
 * RPC Health Check
 *
 * Utilities for checking RPC endpoint health and latency.
 */

import { createSolanaRpc } from '@solana/kit';
import { RPCTimeoutError } from '../../core/errors.js';

// =============================================================================
// TYPES
// =============================================================================

export interface HealthCheckResult {
  endpoint: string;
  isHealthy: boolean;
  latencyMs: number;
  currentSlot: bigint | null;
  errorMessage: string | null;
  checkedAt: Date;
}

export interface HealthCheckOptions {
  timeoutMs?: number;
  maxLatencyMs?: number;
}

const DEFAULT_OPTIONS: Required<HealthCheckOptions> = {
  timeoutMs: 5000,
  maxLatencyMs: 500,
};

// =============================================================================
// HEALTH CHECK FUNCTIONS
// =============================================================================

/**
 * Performs a health check on an RPC endpoint.
 */
export async function checkEndpointHealth(
  endpoint: string,
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const checkedAt = new Date();
  const startTime = Date.now();

  try {
    const rpc = createSolanaRpc(endpoint);

    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new RPCTimeoutError(endpoint, opts.timeoutMs));
      }, opts.timeoutMs);
    });

    // Race between the actual request and timeout
    const slot = await Promise.race([
      rpc.getSlot().send(),
      timeoutPromise,
    ]);

    const latencyMs = Date.now() - startTime;
    const isHealthy = latencyMs <= opts.maxLatencyMs;

    return {
      endpoint,
      isHealthy,
      latencyMs,
      currentSlot: slot,
      errorMessage: isHealthy ? null : `Latency ${latencyMs}ms exceeds max ${opts.maxLatencyMs}ms`,
      checkedAt,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      endpoint,
      isHealthy: false,
      latencyMs,
      currentSlot: null,
      errorMessage,
      checkedAt,
    };
  }
}

/**
 * Checks multiple endpoints and returns all results.
 */
export async function checkMultipleEndpoints(
  endpoints: string[],
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult[]> {
  const results = await Promise.all(
    endpoints.map(endpoint => checkEndpointHealth(endpoint, options))
  );
  return results;
}

/**
 * Finds the healthiest endpoint from a list.
 * Returns the healthy endpoint with the lowest latency.
 */
export async function findBestEndpoint(
  endpoints: string[],
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult | null> {
  const results = await checkMultipleEndpoints(endpoints, options);

  const healthyEndpoints = results
    .filter(r => r.isHealthy)
    .sort((a, b) => a.latencyMs - b.latencyMs);

  return healthyEndpoints[0] ?? null;
}

/**
 * Calculates health statistics for multiple endpoints.
 */
export function calculateHealthStats(results: HealthCheckResult[]): {
  totalEndpoints: number;
  healthyCount: number;
  unhealthyCount: number;
  averageLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
} {
  const healthy = results.filter(r => r.isHealthy);
  const latencies = results.map(r => r.latencyMs);

  return {
    totalEndpoints: results.length,
    healthyCount: healthy.length,
    unhealthyCount: results.length - healthy.length,
    averageLatencyMs: latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0,
    minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
    maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
  };
}
