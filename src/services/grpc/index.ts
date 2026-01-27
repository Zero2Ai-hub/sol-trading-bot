/**
 * Yellowstone gRPC Service
 *
 * Real-time streaming of Solana blockchain events via Yellowstone gRPC.
 * Provides sub-second latency for Pump.fun token detection.
 */

import Client, {
  type SubscribeRequest,
  type SubscribeUpdate,
} from '@triton-one/yellowstone-grpc';
import { getEnvConfig } from '../../config/env.js';
import { GRPCError, GRPCConnectionError, GRPCStreamError } from '../../core/errors.js';
import {
  createEventEmitter,
  type PumpFunEventEmitter,
  type StreamConnectedEvent,
  type StreamDisconnectedEvent,
  type StreamErrorEvent,
} from '../../core/events.js';
import { getComponentLogger, type ComponentLogger } from '../../infrastructure/logger/index.js';
import { CircuitBreaker, createGrpcCircuitBreaker, CircuitState } from './circuit-breaker.js';
import { BackpressureQueue, createBackpressureQueue } from './backpressure.js';
import { buildPumpFunSubscription, type SubscriptionConfig } from './subscriptions.js';

// =============================================================================
// TYPES
// =============================================================================

export interface GrpcServiceConfig {
  /** gRPC endpoint URL */
  endpoint: string;

  /** Authentication token */
  authToken?: string;

  /** Maximum reconnection attempts */
  maxReconnectAttempts: number;

  /** Base delay between reconnection attempts (ms) */
  reconnectBaseDelayMs: number;

  /** Maximum reconnection delay (ms) */
  reconnectMaxDelayMs: number;

  /** Ping interval to keep connection alive (ms) */
  pingIntervalMs: number;

  /** Connection timeout (ms) */
  connectionTimeoutMs: number;
}

export interface GrpcServiceStats {
  isConnected: boolean;
  reconnectAttempts: number;
  messagesReceived: number;
  lastMessageAt: Date | null;
  uptime: number;
  circuitState: CircuitState;
  queueSize: number;
}

export type UpdateHandler = (update: SubscribeUpdate) => void | Promise<void>;

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: Omit<GrpcServiceConfig, 'endpoint'> = {
  maxReconnectAttempts: 10,
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  pingIntervalMs: 30000,
  connectionTimeoutMs: 10000,
};

// =============================================================================
// GRPC SERVICE CLASS
// =============================================================================

class GrpcService {
  private config: GrpcServiceConfig | null = null;
  private client: Client | null = null;
  private stream: AsyncGenerator<SubscribeUpdate> | null = null;
  private logger: ComponentLogger | null = null;
  private circuitBreaker: CircuitBreaker | null = null;
  private backpressureQueue: BackpressureQueue | null = null;
  private eventEmitter: PumpFunEventEmitter | null = null;
  private updateHandler: UpdateHandler | null = null;

  private isConnected = false;
  private isShuttingDown = false;
  private reconnectAttempts = 0;
  private messagesReceived = 0;
  private lastMessageAt: Date | null = null;
  private connectedAt: Date | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  /**
   * Initializes the gRPC service
   */
  async initialize(): Promise<void> {
    this.logger = getComponentLogger('grpc');

    try {
      const env = getEnvConfig();

      if (!env.HELIUS_GRPC_URL) {
        throw new GRPCError('HELIUS_GRPC_URL not configured');
      }

      this.config = {
        ...DEFAULT_CONFIG,
        endpoint: env.HELIUS_GRPC_URL,
        authToken: env.HELIUS_API_KEY,
      };

      // Initialize circuit breaker
      this.circuitBreaker = createGrpcCircuitBreaker('grpc-stream');
      this.circuitBreaker.initialize();
      this.circuitBreaker.onStateChange((oldState, newState, stats) => {
        this.logger?.warn('Circuit breaker state changed', {
          from: oldState,
          to: newState,
          totalFailures: stats.totalFailures,
        });

        if (newState === CircuitState.OPEN) {
          this.eventEmitter?.emit('stream:error', {
            streamType: 'grpc',
            error: 'Circuit breaker opened - too many failures',
            details: {
              state: stats.state,
              failures: stats.failures,
              totalFailures: stats.totalFailures,
            },
            timestamp: Date.now(),
          });
        }
      });

      // Initialize event emitter
      this.eventEmitter = createEventEmitter();

      // Initialize backpressure queue
      this.backpressureQueue = createBackpressureQueue();

      this.logger.info('gRPC service initialized', {
        endpoint: this.config.endpoint,
        maxReconnectAttempts: this.config.maxReconnectAttempts,
      });
    } catch (error) {
      this.logger?.error('Failed to initialize gRPC service', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Connects to gRPC and starts streaming
   */
  async connect(subscriptionConfig?: Partial<SubscriptionConfig>): Promise<void> {
    if (!this.config) {
      throw new GRPCError('gRPC service not initialized');
    }

    if (this.isConnected) {
      this.logger?.warn('Already connected');
      return;
    }

    this.abortController = new AbortController();

    await this.establishConnection(subscriptionConfig);
  }

  /**
   * Disconnects from gRPC
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;
    this.logger?.info('Disconnecting gRPC service');

    // Stop ping timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Abort any ongoing operations
    this.abortController?.abort();

    // Drain the backpressure queue
    if (this.backpressureQueue) {
      await this.backpressureQueue.drain(5000);
      this.backpressureQueue.stop();
    }

    // Close client
    if (this.client) {
      try {
        this.client.close();
      } catch {
        // Ignore close errors
      }
      this.client = null;
    }

    this.stream = null;
    this.isConnected = false;

    this.logger?.info('gRPC service disconnected');
  }

  /**
   * Sets the handler for stream updates
   */
  setUpdateHandler(handler: UpdateHandler): void {
    this.updateHandler = handler;

    // Initialize backpressure queue with handler
    if (this.backpressureQueue) {
      this.backpressureQueue.initialize(async (eventName, payload) => {
        // This processes queued events - for raw updates, we call handler directly
        this.eventEmitter?.emit(eventName, payload);
      });
      this.backpressureQueue.start();
    }
  }

  /**
   * Gets the event emitter for subscribing to typed events
   */
  getEventEmitter(): PumpFunEventEmitter {
    if (!this.eventEmitter) {
      throw new GRPCError('gRPC service not initialized');
    }
    return this.eventEmitter;
  }

  /**
   * Gets current service statistics
   */
  getStats(): GrpcServiceStats {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      messagesReceived: this.messagesReceived,
      lastMessageAt: this.lastMessageAt,
      uptime: this.connectedAt ? Date.now() - this.connectedAt.getTime() : 0,
      circuitState: this.circuitBreaker?.getState() ?? CircuitState.CLOSED,
      queueSize: this.backpressureQueue?.getStats().queueSize ?? 0,
    };
  }

  /**
   * Checks if service is healthy
   */
  isHealthy(): boolean {
    return (
      this.isConnected &&
      this.circuitBreaker?.getState() !== CircuitState.OPEN &&
      (this.lastMessageAt === null ||
        Date.now() - this.lastMessageAt.getTime() < 60000) // Received message in last minute
    );
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private async establishConnection(
    subscriptionConfig?: Partial<SubscriptionConfig>
  ): Promise<void> {
    if (!this.config || !this.circuitBreaker) {
      throw new GRPCError('Service not initialized');
    }

    // Check circuit breaker
    if (!this.circuitBreaker.canExecute()) {
      throw new GRPCConnectionError('Circuit breaker is open');
    }

    try {
      this.logger?.info('Establishing gRPC connection', {
        endpoint: this.config.endpoint,
        attempt: this.reconnectAttempts + 1,
      });

      // Create client
      this.client = new Client(
        this.config.endpoint,
        this.config.authToken,
        undefined
      );

      // Build subscription request
      const subscriptionRequest = buildPumpFunSubscription(subscriptionConfig);

      // Subscribe
      this.stream = await this.client.subscribe();

      // Send subscription request
      const subscribeStream = this.stream as AsyncGenerator<SubscribeUpdate> & {
        write: (request: SubscribeRequest) => Promise<void>;
      };

      if (typeof subscribeStream.write === 'function') {
        await subscribeStream.write(subscriptionRequest);
      }

      this.isConnected = true;
      this.connectedAt = new Date();
      this.reconnectAttempts = 0;
      this.circuitBreaker.recordSuccess();

      this.logger?.info('gRPC connection established');

      // Emit connected event
      const connectedEvent: StreamConnectedEvent = {
        streamType: 'grpc',
        timestamp: Date.now(),
        reconnectAttempt: this.reconnectAttempts,
      };
      this.eventEmitter?.emit('stream:connected', connectedEvent);

      // Start ping timer
      this.startPingTimer();

      // Start consuming stream
      this.consumeStream().catch(error => {
        this.handleStreamError(error);
      });
    } catch (error) {
      this.circuitBreaker.recordFailure(error instanceof Error ? error : undefined);
      throw new GRPCConnectionError(
        `Failed to establish connection: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async consumeStream(): Promise<void> {
    if (!this.stream) {
      return;
    }

    try {
      for await (const update of this.stream) {
        if (this.isShuttingDown) {
          break;
        }

        this.messagesReceived++;
        this.lastMessageAt = new Date();

        // Process update
        try {
          await this.updateHandler?.(update);
        } catch (error) {
          this.logger?.error('Error processing update', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      if (!this.isShuttingDown) {
        throw error;
      }
    }
  }

  private handleStreamError(error: unknown): void {
    if (this.isShuttingDown) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger?.error('Stream error', { error: errorMessage });

    this.isConnected = false;
    this.circuitBreaker?.recordFailure(error instanceof Error ? error : undefined);

    // Emit disconnected event
    const disconnectedEvent: StreamDisconnectedEvent = {
      streamType: 'grpc',
      reason: errorMessage,
      timestamp: Date.now(),
      willReconnect: this.shouldReconnect(),
    };
    this.eventEmitter?.emit('stream:disconnected', disconnectedEvent);

    // Emit error event
    const errorEvent: StreamErrorEvent = {
      streamType: 'grpc',
      error: errorMessage,
      timestamp: Date.now(),
    };
    this.eventEmitter?.emit('stream:error', errorEvent);

    // Attempt reconnection
    if (this.shouldReconnect()) {
      this.scheduleReconnect();
    }
  }

  private shouldReconnect(): boolean {
    if (this.isShuttingDown) {
      return false;
    }

    if (!this.config) {
      return false;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.logger?.error('Max reconnection attempts reached', {
        attempts: this.reconnectAttempts,
      });
      return false;
    }

    if (this.circuitBreaker?.getState() === CircuitState.OPEN) {
      this.logger?.warn('Circuit breaker is open, waiting for reset');
      return false;
    }

    return true;
  }

  private scheduleReconnect(): void {
    if (!this.config) {
      return;
    }

    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const baseDelay = this.config.reconnectBaseDelayMs;
    const maxDelay = this.config.reconnectMaxDelayMs;
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts - 1),
      maxDelay
    );
    const jitter = Math.random() * 0.3 * exponentialDelay;
    const delay = Math.floor(exponentialDelay + jitter);

    this.logger?.info('Scheduling reconnection', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.establishConnection().catch(error => {
          this.handleStreamError(error);
        });
      }
    }, delay);
  }

  private startPingTimer(): void {
    if (!this.config || this.pingTimer) {
      return;
    }

    this.pingTimer = setInterval(() => {
      if (this.isConnected && this.stream) {
        this.logger?.debug('Sending ping');
        // Yellowstone handles keep-alive internally, but we track activity
        if (this.lastMessageAt) {
          const timeSinceLastMessage = Date.now() - this.lastMessageAt.getTime();
          if (timeSinceLastMessage > this.config!.pingIntervalMs * 2) {
            this.logger?.warn('No messages received recently', {
              timeSinceLastMessageMs: timeSinceLastMessage,
            });
          }
        }
      }
    }, this.config.pingIntervalMs);
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const grpcService = new GrpcService();

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Initializes the gRPC service
 */
export async function initializeGrpc(): Promise<void> {
  await grpcService.initialize();
}

/**
 * Connects to gRPC stream
 */
export async function connectGrpc(
  subscriptionConfig?: Partial<SubscriptionConfig>
): Promise<void> {
  await grpcService.connect(subscriptionConfig);
}

/**
 * Disconnects from gRPC stream
 */
export async function disconnectGrpc(): Promise<void> {
  await grpcService.disconnect();
}

/**
 * Gets the gRPC event emitter
 */
export function getGrpcEventEmitter(): PumpFunEventEmitter {
  return grpcService.getEventEmitter();
}

/**
 * Gets gRPC service stats
 */
export function getGrpcStats(): GrpcServiceStats {
  return grpcService.getStats();
}

/**
 * Checks if gRPC service is healthy
 */
export function isGrpcHealthy(): boolean {
  return grpcService.isHealthy();
}

// Re-export types and utilities
export { CircuitBreaker, CircuitState } from './circuit-breaker.js';
export { BackpressureQueue, type BackpressureConfig } from './backpressure.js';
export {
  buildPumpFunSubscription,
  buildMigrationSubscription,
  type SubscriptionConfig,
} from './subscriptions.js';
