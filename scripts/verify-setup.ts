/**
 * Setup Verification Script
 *
 * Verifies that all components are correctly configured and working.
 * Run with: npm run verify
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment first
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Results tracking
interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: unknown;
}

const results: CheckResult[] = [];

function check(name: string, status: 'pass' | 'fail' | 'warn', message: string, details?: unknown): void {
  results.push({ name, status, message, details });

  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  console.log(`${icon} ${name}: ${message}`);

  if (details && status !== 'pass') {
    console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
  }
}

async function verifyEnvironment(): Promise<void> {
  console.log('\n📋 Verifying Environment Variables...\n');

  const requiredVars = [
    'HELIUS_RPC_URL',
    'HELIUS_WS_URL',
    'HELIUS_API_KEY',
    'WALLET_PRIVATE_KEY',
    'DATABASE_URL',
  ];

  const optionalVars = [
    'HELIUS_GRPC_URL',
    'WALLET_2_PRIVATE_KEY',
    'WALLET_3_PRIVATE_KEY',
    'DISCORD_WEBHOOK_URL',
    'TELEGRAM_BOT_TOKEN',
  ];

  for (const varName of requiredVars) {
    if (process.env[varName]) {
      check(varName, 'pass', 'Set');
    } else {
      check(varName, 'fail', 'Missing - required');
    }
  }

  for (const varName of optionalVars) {
    if (process.env[varName]) {
      check(varName, 'pass', 'Set (optional)');
    } else {
      check(varName, 'warn', 'Not set (optional)');
    }
  }
}

async function verifyDirectories(): Promise<void> {
  console.log('\n📁 Verifying Directory Structure...\n');

  const requiredDirs = [
    'src/config',
    'src/core',
    'src/infrastructure/database',
    'src/infrastructure/logger',
    'src/infrastructure/rpc',
    'src/infrastructure/wallet',
    'src/infrastructure/rate-limiter',
    'src/utils',
    'tests',
    'scripts',
  ];

  const projectRoot = path.join(__dirname, '..');

  for (const dir of requiredDirs) {
    const fullPath = path.join(projectRoot, dir);
    if (fs.existsSync(fullPath)) {
      check(dir, 'pass', 'Exists');
    } else {
      check(dir, 'fail', 'Missing');
    }
  }
}

async function verifyConfigModule(): Promise<void> {
  console.log('\n⚙️ Verifying Configuration Module...\n');

  try {
    const { getEnvConfig, getSanitizedConfig } = await import('../src/config/env.js');
    const config = getEnvConfig();

    check('Environment Validation', 'pass', 'Configuration loaded successfully');

    // Check sanitization
    const sanitized = getSanitizedConfig();
    const hasRedacted = Object.values(sanitized).some(v => v === '[REDACTED]');

    if (hasRedacted) {
      check('Sensitive Data Sanitization', 'pass', 'Sensitive values are redacted');
    } else {
      check('Sensitive Data Sanitization', 'warn', 'No sensitive values detected');
    }

    // Check specific values
    if (config.MAX_POSITION_SIZE_SOL > 0) {
      check('Trading Parameters', 'pass', `Max position: ${config.MAX_POSITION_SIZE_SOL} SOL`);
    }

    if (config.ENABLE_PAPER_TRADING) {
      check('Paper Trading', 'warn', 'Paper trading is ENABLED (no real trades)');
    } else {
      check('Paper Trading', 'warn', 'Paper trading is DISABLED (REAL MONEY MODE)');
    }

  } catch (error) {
    check('Configuration Module', 'fail', `Failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyConstants(): Promise<void> {
  console.log('\n🔧 Verifying Constants...\n');

  try {
    const constants = await import('../src/config/constants.js');

    check('Pump.fun Program ID', 'pass', constants.PUMP_FUN_PROGRAM_ID);
    check('WSOL Mint', 'pass', constants.WSOL_MINT);
    check('USDC Mint', 'pass', constants.USDC_MINT);
    check('Jito Tip Accounts', 'pass', `${constants.JITO_TIP_ACCOUNTS.length} accounts configured`);

  } catch (error) {
    check('Constants Module', 'fail', `Failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyLogger(): Promise<void> {
  console.log('\n📝 Verifying Logger...\n');

  try {
    const { initializeLogger, info, error, getComponentLogger } = await import('../src/infrastructure/logger/index.js');

    initializeLogger();

    // Test basic logging
    info('Verification test log', { test: true });

    // Test component logger
    const componentLogger = getComponentLogger('verification');
    componentLogger.info('Component logger test');

    check('Logger Initialization', 'pass', 'Logger initialized successfully');

    // Check log directory
    const logDir = process.env.LOG_DIR ?? './data/logs';
    if (fs.existsSync(logDir)) {
      check('Log Directory', 'pass', `Exists at ${logDir}`);
    } else {
      check('Log Directory', 'warn', `Not created yet at ${logDir}`);
    }

  } catch (error) {
    check('Logger Module', 'fail', `Failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyErrorClasses(): Promise<void> {
  console.log('\n🚨 Verifying Error Classes...\n');

  try {
    const errors = await import('../src/core/errors.js');

    // Test creating each error type
    const testErrors = [
      new errors.ConfigurationError('Test config error'),
      new errors.RPCError('Test RPC error'),
      new errors.TransactionError('Test tx error'),
      new errors.SlippageError(100, 95, 500),
      new errors.SafetyCheckError('mint_authority', 'Test safety failure'),
      new errors.KillSwitchError('Test reason', 'manual'),
    ];

    for (const err of testErrors) {
      if (err.code && err.message && err.toJSON) {
        check(err.name, 'pass', 'Error class working');
      }
    }

    // Test error utilities
    const wrapped = errors.wrapError(new Error('Test'));
    if (errors.isBotError(wrapped)) {
      check('Error Utilities', 'pass', 'wrapError and isBotError working');
    }

  } catch (error) {
    check('Error Classes', 'fail', `Failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyKillSwitch(): Promise<void> {
  console.log('\n🛑 Verifying Kill Switch...\n');

  try {
    const { initializeKillSwitch, isKillSwitchActive, getKillSwitchState } = await import('../src/core/kill-switch.js');

    initializeKillSwitch();

    const state = getKillSwitchState();

    if (!state.active) {
      check('Kill Switch State', 'pass', 'Not active (ready)');
    } else {
      check('Kill Switch State', 'warn', `Active: ${state.reason}`);
    }

  } catch (error) {
    check('Kill Switch', 'fail', `Failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyRateLimiter(): Promise<void> {
  console.log('\n⏱️ Verifying Rate Limiter...\n');

  try {
    const { initializeRateLimiter, getRateLimiterStats, tryAcquireRateLimit } = await import('../src/infrastructure/rate-limiter/index.js');

    initializeRateLimiter();

    const stats = getRateLimiterStats();

    if (stats.length > 0) {
      check('Rate Limiters', 'pass', `${stats.length} limiters configured`);

      for (const stat of stats) {
        check(`  ${stat.name}`, 'pass', `${stat.availableTokens}/${stat.maxTokens} tokens available`);
      }
    }

    // Test acquiring
    const acquired = tryAcquireRateLimit('jupiter');
    check('Token Acquisition', acquired ? 'pass' : 'fail', acquired ? 'Can acquire tokens' : 'Failed to acquire');

  } catch (error) {
    check('Rate Limiter', 'fail', `Failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function printSummary(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                    VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warn').length;

  console.log(`Total Checks: ${results.length}`);
  console.log(`  ✅ Passed:   ${passed}`);
  console.log(`  ❌ Failed:   ${failed}`);
  console.log(`  ⚠️  Warnings: ${warnings}`);

  if (failed > 0) {
    console.log('\n🔴 VERIFICATION FAILED - Please fix the above issues before proceeding.\n');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('\n🟡 VERIFICATION PASSED WITH WARNINGS - Review warnings above.\n');
  } else {
    console.log('\n🟢 ALL CHECKS PASSED - Ready to proceed!\n');
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           SOLANA MOMENTUM BOT - SETUP VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════');

  await verifyEnvironment();
  await verifyDirectories();
  await verifyConfigModule();
  await verifyConstants();
  await verifyLogger();
  await verifyErrorClasses();
  await verifyKillSwitch();
  await verifyRateLimiter();

  await printSummary();
}

main().catch(error => {
  console.error('\n❌ Verification script failed:', error);
  process.exit(1);
});
