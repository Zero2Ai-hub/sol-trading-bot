/**
 * Circuit Breaker Pattern
 *
 * Prevents cascading failures in gRPC streaming by tracking failures
 * and temporarily stopping reconnection attempts when the service is unhealthy.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Too many failures, requests are rejected immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

import { getComponentLogger, type ComponentLogger } from '../../infrastructure/logger/index.js';

// =============================================================================
// TYPES
// =============================================================================

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;

  /** Time in ms before attempting recovery (OPEN -> HALF_OPEN) */
  resetTimeoutMs: number;

  /** Number of successful requests needed to close circuit */
  successThreshold: number;

  /** Time window in ms for counting failures */
  failureWindowMs: number;

  /** Name for logging */
  name: string;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  lastStateChangeAt: Date;
  totalFailures: number;
  totalSuccesses: number;
  totalStateChanges: number;
}

type StateChangeCallback = (
  oldState: CircuitState,
  newState: CircuitState,
  stats: CircuitBreakerStats
) => void;

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  successThreshold: 3,
  failureWindowMs: 60000,
  name: 'circuit-breaker',
};

// =============================================================================
// CIRCUIT BREAKER CLASS
// =============================================================================

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastStateChangeAt: Date = new Date();
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private totalStateChanges: number = 0;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private failureTimestamps: number[] = [];
  private logger: ComponentLogger | null = null;
  private stateChangeCallbacks: StateChangeCallback[] = [];

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initializes the circuit breaker with logging
   */
  initialize(): void {
    this.logger = getComponentLogger(`circuit-breaker:${this.config.name}`);
    this.logger.info('Circuit breaker initialized', {
      config: this.config,
      state: this.state,
    });
  }

  /**
   * Gets the current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Checks if requests can be made
   */
  canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.HALF_OPEN:
        return true; // Allow test requests
      case CircuitState.OPEN:
        return false;
      default:
        return false;
    }
  }

  /**
   * Records a successful operation
   */
  recordSuccess(): void {
    this.successes++;
    this.totalSuccesses++;
    this.lastSuccessAt = new Date();

    this.logger?.debug('Success recorded', {
      state: this.state,
      successes: this.successes,
      successThreshold: this.config.successThreshold,
    });

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in closed state
      this.failures = 0;
      this.failureTimestamps = [];
    }
  }

  /**
   * Records a failed operation
   */
  recordFailure(error?: Error | string): void {
    const now = Date.now();
    this.failures++;
    this.totalFailures++;
    this.lastFailureAt = new Date();
    this.failureTimestamps.push(now);

    // Clean old failures outside the window
    const windowStart = now - this.config.failureWindowMs;
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts > windowStart);

    this.logger?.warn('Failure recorded', {
      state: this.state,
      failures: this.failures,
      recentFailures: this.failureTimestamps.length,
      failureThreshold: this.config.failureThreshold,
      error: error instanceof Error ? error.message : error,
    });

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open goes back to open
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we've hit threshold within the window
      if (this.failureTimestamps.length >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Forces the circuit to a specific state (for manual intervention)
   */
  forceState(state: CircuitState): void {
    this.logger?.warn('Circuit state forced', {
      from: this.state,
      to: state,
    });
    this.transitionTo(state);
  }

  /**
   * Resets the circuit breaker to initial state
   */
  reset(): void {
    this.clearResetTimer();
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.failureTimestamps = [];
    this.lastStateChangeAt = new Date();

    this.logger?.info('Circuit breaker reset', {
      state: this.state,
    });
  }

  /**
   * Gets current statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      lastStateChangeAt: this.lastStateChangeAt,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalStateChanges: this.totalStateChanges,
    };
  }

  /**
   * Registers a callback for state changes
   */
  onStateChange(callback: StateChangeCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Executes a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      const error = new CircuitBreakerOpenError(
        `Circuit breaker is ${this.state}`,
        this.getStats()
      );
      throw error;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error : String(error));
      throw error;
    }
  }

  /**
   * Cleans up resources
   */
  destroy(): void {
    this.clearResetTimer();
    this.stateChangeCallbacks = [];
    this.logger?.info('Circuit breaker destroyed');
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) {
      return;
    }

    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeAt = new Date();
    this.totalStateChanges++;

    // Reset counters on state change
    this.failures = 0;
    this.successes = 0;

    this.logger?.info('Circuit state changed', {
      from: oldState,
      to: newState,
      totalStateChanges: this.totalStateChanges,
    });

    // Handle state-specific logic
    if (newState === CircuitState.OPEN) {
      this.scheduleReset();
    } else {
      this.clearResetTimer();
    }

    // Notify callbacks
    const stats = this.getStats();
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(oldState, newState, stats);
      } catch (error) {
        this.logger?.error('State change callback error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private scheduleReset(): void {
    this.clearResetTimer();

    this.logger?.info('Scheduling circuit reset', {
      resetTimeoutMs: this.config.resetTimeoutMs,
    });

    this.resetTimer = setTimeout(() => {
      this.logger?.info('Reset timeout reached, transitioning to HALF_OPEN');
      this.transitionTo(CircuitState.HALF_OPEN);
    }, this.config.resetTimeoutMs);
  }

  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}

// =============================================================================
// CIRCUIT BREAKER ERROR
// =============================================================================

export class CircuitBreakerOpenError extends Error {
  public readonly stats: CircuitBreakerStats;

  constructor(message: string, stats: CircuitBreakerStats) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.stats = stats;
    Error.captureStackTrace(this, this.constructor);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Creates a circuit breaker with gRPC-optimized defaults
 */
export function createGrpcCircuitBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({
    name,
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    successThreshold: 3,
    failureWindowMs: 60000,
  });
}

/**
 * Creates a circuit breaker with aggressive recovery (for critical streams)
 */
export function createCriticalCircuitBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({
    name,
    failureThreshold: 3,
    resetTimeoutMs: 10000, // Faster recovery
    successThreshold: 2,
    failureWindowMs: 30000,
  });
}
