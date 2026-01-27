/**
 * Health Monitor
 *
 * Monitors service health, implements circuit breaker pattern,
 * and handles auto-recovery.
 */

import { EventEmitter } from 'events';
import { getComponentLogger } from '../infrastructure/logger/index.js';
import { db } from '../infrastructure/database/index.js';
import {
  type ServiceHealth,
  type ServiceHealthMap,
  HealthStatus,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const logger = getComponentLogger('HealthMonitor');

const DEFAULT_HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MS = 60_000; // 1 minute

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, reject calls
  HALF_OPEN = 'HALF_OPEN', // Testing recovery
}

/**
 * Circuit breaker for a service
 */
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private lastFailure: number = 0;
  private readonly threshold: number;
  private readonly resetTimeout: number;

  constructor(threshold = MAX_CONSECUTIVE_FAILURES, resetTimeout = CIRCUIT_BREAKER_RESET_MS) {
    this.threshold = threshold;
    this.resetTimeout = resetTimeout;
  }

  /**
   * Records a successful call
   */
  recordSuccess(): void {
    this.failures = 0;
    this.state = CircuitState.CLOSED;
  }

  /**
   * Records a failed call
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Checks if calls should be allowed
   */
  canProceed(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailure >= this.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        return true;
      }
      return false;
    }

    // HALF_OPEN: Allow one test call
    return true;
  }

  /**
   * Gets current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Gets failure count
   */
  getFailures(): number {
    return this.failures;
  }
}

// =============================================================================
// HEALTH CHECK FUNCTIONS
// =============================================================================

type HealthCheckFn = () => Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;

// =============================================================================
// HEALTH MONITOR CLASS
// =============================================================================

/**
 * Health Monitor Events
 */
export interface HealthMonitorEvents {
  /** Health status changed */
  'health:changed': (service: string, health: ServiceHealth) => void;

  /** All services healthy */
  'health:allHealthy': () => void;

  /** Critical service unhealthy */
  'health:critical': (service: string, health: ServiceHealth) => void;

  /** Service recovered */
  'health:recovered': (service: string) => void;
}

/**
 * Health Monitor
 */
export class HealthMonitor extends EventEmitter {
  private checks: Map<string, HealthCheckFn> = new Map();
  private health: Map<string, ServiceHealth> = new Map();
  private breakers: Map<string, CircuitBreaker> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private isRunning: boolean = false;

  constructor(intervalMs = DEFAULT_HEALTH_CHECK_INTERVAL) {
    super();
    this.intervalMs = intervalMs;
  }

  // ===========================================================================
  // REGISTRATION
  // ===========================================================================

  /**
   * Registers a health check for a service
   */
  registerCheck(name: string, checkFn: HealthCheckFn): void {
    this.checks.set(name, checkFn);
    this.breakers.set(name, new CircuitBreaker());
    this.health.set(name, {
      name,
      status: HealthStatus.UNKNOWN,
      lastCheck: 0,
      consecutiveFailures: 0,
    });

    logger.debug('Registered health check', { service: name });
  }

  /**
   * Registers default checks for core services
   */
  registerDefaultChecks(): void {
    // Database health check
    this.registerCheck('database', async () => {
      const start = Date.now();
      try {
        await db.query('SELECT 1');
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (error) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    // RPC health check (placeholder - will be connected to actual RPC)
    this.registerCheck('rpc', async () => {
      // This will be replaced with actual RPC health check
      return { healthy: true, latencyMs: 0 };
    });

    // gRPC health check (placeholder)
    this.registerCheck('grpc', async () => {
      return { healthy: true, latencyMs: 0 };
    });

    // Pump monitor health check (placeholder)
    this.registerCheck('pumpMonitor', async () => {
      return { healthy: true, latencyMs: 0 };
    });

    // Momentum engine health check (placeholder)
    this.registerCheck('momentumEngine', async () => {
      return { healthy: true, latencyMs: 0 };
    });

    // Trade executor health check (placeholder)
    this.registerCheck('tradeExecutor', async () => {
      return { healthy: true, latencyMs: 0 };
    });
  }

  // ===========================================================================
  // HEALTH CHECKS
  // ===========================================================================

  /**
   * Runs all health checks
   */
  async checkAll(): Promise<ServiceHealthMap> {
    const results: Partial<ServiceHealthMap> = {};

    for (const [name, checkFn] of this.checks) {
      const health = await this.checkService(name, checkFn);
      results[name as keyof ServiceHealthMap] = health;
    }

    return results as ServiceHealthMap;
  }

  /**
   * Runs health check for a single service
   */
  async checkService(name: string, checkFn?: HealthCheckFn): Promise<ServiceHealth> {
    const fn = checkFn ?? this.checks.get(name);
    if (!fn) {
      return {
        name,
        status: HealthStatus.UNKNOWN,
        lastCheck: Date.now(),
        consecutiveFailures: 0,
      };
    }

    const breaker = this.breakers.get(name);
    const previousHealth = this.health.get(name);
    const previousStatus = previousHealth?.status ?? HealthStatus.UNKNOWN;

    // Check circuit breaker
    if (breaker && !breaker.canProceed()) {
      const health: ServiceHealth = {
        name,
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        lastError: 'Circuit breaker open',
        consecutiveFailures: breaker.getFailures(),
      };
      this.health.set(name, health);
      return health;
    }

    try {
      const result = await fn();
      const health: ServiceHealth = {
        name,
        status: result.healthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        latencyMs: result.latencyMs,
        lastError: result.error,
        consecutiveFailures: result.healthy ? 0 : (previousHealth?.consecutiveFailures ?? 0) + 1,
      };

      // Update circuit breaker
      if (breaker) {
        if (result.healthy) {
          breaker.recordSuccess();
        } else {
          breaker.recordFailure();
        }
      }

      // Check for status change
      if (previousStatus !== health.status) {
        this.emit('health:changed', name, health);

        if (health.status === HealthStatus.HEALTHY && previousStatus === HealthStatus.UNHEALTHY) {
          this.emit('health:recovered', name);
          logger.info('Service recovered', { service: name });
        }

        if (health.status === HealthStatus.UNHEALTHY) {
          this.emit('health:critical', name, health);
          logger.error('Service unhealthy', { service: name, error: health.lastError });
        }
      }

      this.health.set(name, health);
      return health;
    } catch (error) {
      const health: ServiceHealth = {
        name,
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        lastError: error instanceof Error ? error.message : String(error),
        consecutiveFailures: (previousHealth?.consecutiveFailures ?? 0) + 1,
      };

      if (breaker) {
        breaker.recordFailure();
      }

      if (previousStatus !== HealthStatus.UNHEALTHY) {
        this.emit('health:changed', name, health);
        this.emit('health:critical', name, health);
      }

      this.health.set(name, health);
      return health;
    }
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Starts periodic health checks
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;

    // Run initial check
    this.checkAll().catch((err) => {
      logger.error('Initial health check failed', { error: err });
    });

    // Start periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAll()
        .then(() => {
          // Check if all healthy
          const allHealthy = Array.from(this.health.values()).every(
            (h) => h.status === HealthStatus.HEALTHY
          );
          if (allHealthy) {
            this.emit('health:allHealthy');
          }
        })
        .catch((err) => {
          logger.error('Periodic health check failed', { error: err });
        });
    }, this.intervalMs);

    logger.info('Health monitor started', { intervalMs: this.intervalMs });
  }

  /**
   * Stops periodic health checks
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    logger.info('Health monitor stopped');
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  /**
   * Gets health status for a service
   */
  getHealth(name: string): ServiceHealth | undefined {
    return this.health.get(name);
  }

  /**
   * Gets all health statuses
   */
  getAllHealth(): ServiceHealthMap {
    const result: Partial<ServiceHealthMap> = {};
    for (const [name, health] of this.health) {
      result[name as keyof ServiceHealthMap] = health;
    }
    return result as ServiceHealthMap;
  }

  /**
   * Checks if a specific service is healthy
   */
  isHealthy(name: string): boolean {
    const health = this.health.get(name);
    return health?.status === HealthStatus.HEALTHY;
  }

  /**
   * Checks if all services are healthy
   */
  isAllHealthy(): boolean {
    for (const health of this.health.values()) {
      if (health.status !== HealthStatus.HEALTHY) {
        return false;
      }
    }
    return true;
  }

  /**
   * Gets list of unhealthy services
   */
  getUnhealthyServices(): string[] {
    const unhealthy: string[] = [];
    for (const [name, health] of this.health) {
      if (health.status !== HealthStatus.HEALTHY) {
        unhealthy.push(name);
      }
    }
    return unhealthy;
  }

  /**
   * Gets overall system health status
   */
  getOverallStatus(): HealthStatus {
    const statuses = Array.from(this.health.values()).map((h) => h.status);

    if (statuses.every((s) => s === HealthStatus.HEALTHY)) {
      return HealthStatus.HEALTHY;
    }

    if (statuses.some((s) => s === HealthStatus.UNHEALTHY)) {
      // Check if critical services are down
      const criticalServices = ['database', 'rpc'];
      for (const critical of criticalServices) {
        const health = this.health.get(critical);
        if (health?.status === HealthStatus.UNHEALTHY) {
          return HealthStatus.UNHEALTHY;
        }
      }
      return HealthStatus.DEGRADED;
    }

    return HealthStatus.DEGRADED;
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const healthMonitor = new HealthMonitor();

// Convenience exports
export const registerHealthCheck = (name: string, fn: HealthCheckFn) =>
  healthMonitor.registerCheck(name, fn);

export const checkAllHealth = () => healthMonitor.checkAll();

export const isServiceHealthy = (name: string) => healthMonitor.isHealthy(name);

export const isSystemHealthy = () => healthMonitor.isAllHealthy();
