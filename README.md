# Solana Momentum Trading Bot

A high-performance trading bot that detects momentum in newly launched tokens on Pump.fun **before** they migrate to Raydium/PumpSwap, entering positions at 70-95% bonding curve completion and exiting during migration pumps.

## Overview

This bot targets the "graduation window" - the period when a Pump.fun token approaches its bonding curve completion threshold (~$69k market cap) and migrates to Raydium. Historical data shows tokens can experience 2-10x price increases during this migration event.

### Key Features

- **Real-time Detection**: Yellowstone gRPC streaming for sub-second token discovery
- **Momentum Scoring**: Multi-factor analysis (volume, holders, velocity, social signals)
- **Safety Analysis**: Automated rug detection (authority checks, LP analysis, holder distribution)
- **MEV Protection**: Jito bundle submission for protected transactions
- **Risk Management**: Position limits, daily loss limits, kill switch, automatic stop-losses
- **Backtesting**: Historical validation with parameter optimization
- **Paper Trading**: Test strategies without risking real capital
- **CLI Dashboard**: Real-time terminal status display

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Solana Momentum Trading Bot v1.0                        │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│   Data Layer    │ Analysis Layer  │ Execution Layer │   Orchestration       │
├─────────────────┼─────────────────┼─────────────────┼───────────────────────┤
│ • gRPC stream   │ • Volume        │ • Jupiter API   │ • TradingBot class    │
│ • Pump.fun mon  │ • Holder        │ • Jito bundles  │ • Health monitor      │
│ • Helius DAS    │ • Liquidity     │ • Position mgr  │ • State management    │
│ • Price feeds   │ • Safety        │ • Risk manager  │ • CLI dashboard       │
│                 │ • Momentum eng  │                 │ • Graceful shutdown   │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │           Infrastructure           │
                  ├────────────────────────────────────┤
                  │ • RPC Manager (health/failover)    │
                  │ • Wallet Manager (multi-wallet)    │
                  │ • Logger (structured JSON)         │
                  │ • Database (PostgreSQL)            │
                  │ • Rate Limiter                     │
                  │ • Circuit Breaker                  │
                  └────────────────────────────────────┘
```

## Development Status

All phases are complete and tested:

- [x] **Phase 1**: Project Setup & Infrastructure ✅
- [x] **Phase 2**: gRPC Data Streaming ✅
- [x] **Phase 3**: Data Analyzers ✅
- [x] **Phase 4**: Momentum Engine ✅
- [x] **Phase 5**: Trade Executor ✅
- [x] **Phase 6**: Backtesting System ✅
- [x] **Phase 7**: Main Orchestration ✅

## Prerequisites

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 14
- **Helius Account** with API key (RPC + gRPC access)
- **Solana Wallet** with SOL for trading

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd sol-trading-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# (See Configuration section below)

# Build the project
npm run build

# Run tests
npm test

# Start bot (paper trading mode by default)
npm start
```

## Configuration

### Required Environment Variables

```bash
# Network
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_API_KEY=your-helius-api-key

# Wallet (Base58 encoded private key)
WALLET_PRIVATE_KEY=your-base58-private-key

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/trading_bot
```

### Trading Parameters

```bash
# Position Sizing
MAX_POSITION_SIZE_SOL=0.5      # Max SOL per trade
MAX_CONCURRENT_POSITIONS=3      # Max open positions

# Risk Limits
DAILY_LOSS_LIMIT_PERCENT=10    # Stop trading if daily loss exceeds 10%
MAX_SLIPPAGE_BPS=300           # Max 3% slippage

# Entry Criteria
BONDING_CURVE_MIN_PERCENT=70   # Min bonding curve completion
BONDING_CURVE_MAX_PERCENT=95   # Max bonding curve completion
MIN_MOMENTUM_SCORE=65          # Min score to enter

# Exit Strategy
TAKE_PROFIT_LEVELS=25,50,100   # Take profit at +25%, +50%, +100%
TAKE_PROFIT_PERCENTAGES=30,40,30  # Sell 30%, 40%, 30% at each level
STOP_LOSS_PERCENT=15           # Exit if down 15%

# Safety Features
ENABLE_PAPER_TRADING=true      # No real transactions (START HERE!)
ENABLE_KILL_SWITCH=true        # Emergency stop capability
ENABLE_SAFETY_CHECKS=true      # Rug detection
```

## Usage

### Development Mode

```bash
# Run with hot reload
npm run dev

# Run all tests
npm test

# Run specific test suite
npm test -- --testPathPattern="backtesting"
npm test -- --testPathPattern="orchestrator"

# Run linting
npm run lint
```

### Production Mode

```bash
# Build
npm run build

# Start bot
npm start

# Or use PM2
pm2 start dist/index.js --name trading-bot
```

## Project Structure

```
sol-trading-bot/
├── src/
│   ├── config/           # Configuration management
│   │   ├── env.ts        # Environment validation (Zod)
│   │   ├── constants.ts  # Program IDs, thresholds
│   │   └── networks.ts   # Network configurations
│   │
│   ├── core/             # Core functionality
│   │   ├── errors.ts     # Custom error classes
│   │   ├── types.ts      # TypeScript interfaces
│   │   └── kill-switch.ts # Emergency stop system
│   │
│   ├── infrastructure/   # Infrastructure layer
│   │   ├── database/     # PostgreSQL connection
│   │   ├── logger/       # Structured JSON logging
│   │   ├── rpc/          # RPC manager with failover
│   │   ├── wallet/       # Secure wallet management
│   │   └── rate-limiter/ # API rate limiting
│   │
│   ├── monitors/         # Data streaming
│   │   └── pump-fun/     # Pump.fun gRPC monitor
│   │
│   ├── analyzers/        # Analysis modules
│   │   ├── volume.ts     # Volume velocity scoring
│   │   ├── holders.ts    # Holder analysis
│   │   ├── liquidity.ts  # Liquidity scoring
│   │   ├── safety.ts     # Rug detection
│   │   └── momentum.ts   # Momentum aggregator
│   │
│   ├── engine/           # Momentum engine
│   │   ├── scoring.ts    # Score calculation
│   │   ├── signals.ts    # Signal generation
│   │   ├── rankings.ts   # Token rankings
│   │   └── persistence.ts # Database storage
│   │
│   ├── executor/         # Trade execution
│   │   ├── jupiter.ts    # Jupiter swap client
│   │   ├── jito.ts       # Jito bundle submission
│   │   ├── positions.ts  # Position management
│   │   ├── executor.ts   # Trade executor
│   │   └── risk.ts       # Risk management
│   │
│   ├── backtesting/      # Backtesting framework
│   │   ├── collector.ts  # Historical data collection
│   │   ├── engine.ts     # Backtest simulation
│   │   ├── optimizer.ts  # Parameter optimization
│   │   ├── analytics.ts  # Performance analytics
│   │   └── reporter.ts   # Report generation
│   │
│   ├── orchestrator/     # Main orchestration
│   │   ├── bot.ts        # TradingBot class
│   │   ├── health.ts     # Health monitoring
│   │   ├── dashboard.ts  # CLI dashboard
│   │   └── types.ts      # Orchestrator types
│   │
│   ├── utils/            # Utilities
│   │   ├── retry.ts      # Exponential backoff
│   │   └── formatting.ts # Address/amount formatting
│   │
│   └── index.ts          # Main entry point
│
├── tests/
│   └── unit/             # Unit tests
│       ├── config.test.ts
│       ├── backtesting.test.ts
│       └── orchestrator.test.ts
│
└── data/
    └── logs/             # Log files (gitignored)
```

## Modules Overview

### Analyzers (Phase 3)

| Module | Purpose | Score Weight |
|--------|---------|--------------|
| Volume | Trade velocity, buy pressure | 30% |
| Holders | Distribution, growth rate | 25% |
| Liquidity | Pool depth, stability | 20% |
| Safety | Rug detection, authority checks | 15% |
| Social | Community signals | 10% |

### Momentum Engine (Phase 4)

- **Scoring**: Combines all analyzer scores into momentum score (0-100)
- **Signals**: Generates BUY/STRONG_BUY/SELL/HOLD signals
- **Rankings**: Maintains real-time token leaderboard
- **Persistence**: Stores signals and metrics to database

### Trade Executor (Phase 5)

- **Jupiter Integration**: Best-route swaps across DEXs
- **Jito Bundles**: MEV-protected transactions
- **Position Manager**: Stop-loss, take-profit, partial exits
- **Risk Manager**: Daily limits, position sizing

### Backtesting (Phase 6)

- **Historical Data**: Collect from Birdeye/DexScreener APIs
- **Simulation**: Replay with realistic slippage/fees
- **Optimization**: Grid search, walk-forward testing
- **Reports**: CSV exports, performance analytics

### Orchestrator (Phase 7)

- **TradingBot**: Central controller
- **Health Monitor**: Circuit breaker, auto-recovery
- **Dashboard**: Terminal-based status display
- **Lifecycle**: Graceful startup/shutdown

## Safety & Risk Management

### Kill Switch

Emergency stop system that:
- Immediately halts all trading
- Cancels pending orders
- Can close all positions
- Sends alerts via configured channels

### Position Limits

- **Per-trade**: Configurable max SOL per position
- **Concurrent**: Max number of open positions
- **Daily**: Stop trading after loss limit

### Rug Detection

Automated safety checks before entry:
- ✅ Mint authority revoked
- ✅ Freeze authority revoked
- ✅ LP burned or locked
- ✅ Holder distribution (top 10 < 40%)
- ✅ Creator wallet analysis

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/unit/backtesting.test.ts

# Run tests in watch mode
npm test -- --watch
```

## Tech Stack

- **Runtime**: Node.js 18+ / TypeScript 5.7
- **Solana SDK**: @solana/kit (modern, tree-shakeable)
- **Streaming**: @triton-one/yellowstone-grpc
- **RPC**: Helius
- **Execution**: Jupiter REST API + Jito bundles
- **Database**: PostgreSQL + pg
- **Logging**: Winston with daily rotation
- **Validation**: Zod
- **Testing**: Jest

## Security Notes

- **Never commit `.env`** - Contains private keys
- **Use paper trading first** - Test strategies safely
- **Set conservative limits** - Start small
- **Monitor actively** - Don't run unattended initially
- **Backup wallet** - Keep recovery phrase secure

## Troubleshooting

### Common Issues

**"Configuration validation failed"**
- Check all required env vars are set
- Verify format (especially arrays like TAKE_PROFIT_LEVELS)

**"RPC connection failed"**
- Check Helius API key is valid
- Verify URL includes api-key parameter
- Check rate limits not exceeded

**"Database connection failed"**
- Verify PostgreSQL is running
- Check DATABASE_URL format

**"Wallet initialization failed"**
- Verify WALLET_PRIVATE_KEY is valid Base58
- Check key is 64 bytes (full keypair)

### Getting Help

1. Check logs: `data/logs/combined-*.log`
2. Run tests: `npm test`
3. Enable debug logging: `LOG_LEVEL=debug npm start`

## License

MIT

## Disclaimer

This software is for educational purposes only. Trading cryptocurrencies involves substantial risk of loss. Past performance does not guarantee future results. Always start with paper trading and never risk more than you can afford to lose.
