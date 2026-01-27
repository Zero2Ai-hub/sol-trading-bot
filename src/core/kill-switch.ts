/**
 * Kill Switch
 *
 * Emergency stop system that can halt all trading immediately.
 * Critical for risk management and error recovery.
 */

import { getComponentLogger, type ComponentLogger } from '../infrastructure/logger/index.js';
import { KillSwitchError } from './errors.js';
import type { KillSwitchState } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

export type KillSwitchTrigger =
  | 'manual'
  | 'daily_loss_limit'
  | 'max_drawdown'
  | 'error_threshold'
  | 'rpc_failure'
  | 'system_error';

export interface KillSwitchCallback {
  name: string;
  callback: (state: KillSwitchState) => Promise<void>;
  priority: number;
}

// =============================================================================
// KILL SWITCH CLASS
// =============================================================================

class KillSwitch {
  private state: KillSwitchState = {
    active: false,
    reason: null,
    triggeredBy: null,
    triggeredAt: null,
  };

  private callbacks: KillSwitchCallback[] = [];
  private logger: ComponentLogger | null = null;
  private initialized = false;

  /**
   * Initializes the kill switch.
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.logger = getComponentLogger('kill-switch');
    this.initialized = true;
    this.logger?.info('Kill switch initialized');
  }

  /**
   * Gets the current kill switch state.
   */
  getState(): KillSwitchState {
    return { ...this.state };
  }

  /**
   * Checks if the kill switch is active.
   */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * Throws an error if the kill switch is active.
   * Call this before any trading operation.
   */
  assertNotActive(): void {
    if (this.state.active) {
      throw new KillSwitchError(
        this.state.reason ?? 'Unknown reason',
        this.state.triggeredBy ?? 'unknown'
      );
    }
  }

  /**
   * Activates the kill switch.
   * This will stop all trading immediately.
   */
  async activate(reason: string, triggeredBy: KillSwitchTrigger): Promise<void> {
    if (this.state.active) {
      this.logger?.warn('Kill switch already active', {
        existingReason: this.state.reason,
        newReason: reason,
      });
      return;
    }

    const triggeredAt = new Date();
    this.state = {
      active: true,
      reason,
      triggeredBy,
      triggeredAt,
    };

    this.logger?.error('KILL SWITCH ACTIVATED', {
      reason,
      triggeredBy,
      timestamp: triggeredAt.toISOString(),
    });

    // Execute callbacks in priority order
    await this.executeCallbacks();
  }

  /**
   * Deactivates the kill switch.
   * Should only be called after thorough investigation.
   */
  async deactivate(acknowledgedBy: string): Promise<void> {
    if (!this.state.active) {
      this.logger?.warn('Kill switch not active, nothing to deactivate');
      return;
    }

    const previousState = { ...this.state };

    this.state = {
      active: false,
      reason: null,
      triggeredBy: null,
      triggeredAt: null,
    };

    this.logger?.warn('Kill switch deactivated', {
      acknowledgedBy,
      previousReason: previousState.reason,
      activeDurationMs: previousState.triggeredAt
        ? Date.now() - previousState.triggeredAt.getTime()
        : null,
    });
  }

  /**
   * Registers a callback to be executed when kill switch activates.
   * Callbacks are executed in priority order (lower = earlier).
   *
   * @example
   * killSwitch.registerCallback({
   *   name: 'close-positions',
   *   priority: 0,
   *   callback: async () => { await closeAllPositions(); }
   * });
   */
  registerCallback(config: KillSwitchCallback): void {
    this.callbacks.push(config);
    this.callbacks.sort((a, b) => a.priority - b.priority);

    this.logger?.debug('Kill switch callback registered', {
      name: config.name,
      priority: config.priority,
      totalCallbacks: this.callbacks.length,
    });
  }

  /**
   * Unregisters a callback by name.
   */
  unregisterCallback(name: string): boolean {
    const index = this.callbacks.findIndex(c => c.name === name);
    if (index >= 0) {
      this.callbacks.splice(index, 1);
      this.logger?.debug('Kill switch callback unregistered', { name });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private async executeCallbacks(): Promise<void> {
    this.logger?.info('Executing kill switch callbacks', {
      count: this.callbacks.length,
    });

    for (const { name, callback, priority } of this.callbacks) {
      try {
        this.logger?.debug(`Executing callback: ${name}`, { priority });
        await callback(this.state);
        this.logger?.debug(`Callback completed: ${name}`);
      } catch (error) {
        // Log but don't throw - we want to execute all callbacks
        this.logger?.error(`Callback failed: ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger?.info('All kill switch callbacks executed');
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Triggers kill switch if a condition is met.
 */
export function killSwitchIf(
  condition: boolean,
  reason: string,
  trigger: KillSwitchTrigger
): void {
  if (condition && !killSwitch.isActive()) {
    killSwitch.activate(reason, trigger);
  }
}

/**
 * Decorator to wrap a function with kill switch check.
 */
export function withKillSwitchCheck<T extends (...args: unknown[]) => unknown>(
  fn: T
): T {
  return ((...args: unknown[]) => {
    killSwitch.assertNotActive();
    return fn(...args);
  }) as T;
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const killSwitch = new KillSwitch();

// Export convenience methods
export const initializeKillSwitch = () => killSwitch.initialize();
export const isKillSwitchActive = () => killSwitch.isActive();
export const activateKillSwitch = (reason: string, trigger: KillSwitchTrigger) =>
  killSwitch.activate(reason, trigger);
export const deactivateKillSwitch = (acknowledgedBy: string) =>
  killSwitch.deactivate(acknowledgedBy);
export const getKillSwitchState = () => killSwitch.getState();
export const assertKillSwitchNotActive = () => killSwitch.assertNotActive();
export const registerKillSwitchCallback = (config: KillSwitchCallback) =>
  killSwitch.registerCallback(config);
