# PROMPT 1: Project Setup & Infrastructure

## OBJECTIVE
Set up a professional TypeScript project with proper architecture for a production trading bot. This includes folder structure, dependencies, database schema, logging infrastructure, and security utilities.

## FOLDER STRUCTURE REQUIREMENTS

Create a modular architecture with clear separation of concerns:

```
solana-momentum-bot/
├── src/
│   ├── config/           # Configuration constants
│   ├── services/         # Core services (RPC, gRPC, Database)
│   ├── monitors/         # Event listeners (Pump.fun, Raydium)
│   ├── analyzers/        # Data analyzers (Volume, Holders, etc)
│   ├── engine/           # Momentum scoring and signals
│   ├── executors/        # Trade execution and wallet management
│   ├── utils/            # Utilities (logger, errors, helpers)
│   ├── types/            # TypeScript interfaces
│   └── index.ts          # Main entry point
├── tests/                # Unit and integration tests
├── data/                 # Historical data and logs
├── scripts/              # Database setup and utilities
```

## KEY DEPENDENCIES NEEDED

**Solana Interaction**:
- @solana/web3.js - Blockchain interaction
- @coral-xyz/anchor - Program interaction
- @jup-ag/api - Jupiter swap aggregator
- jito-ts - Jito bundle transactions

**Data Streaming**:
- @triton-one/yellowstone-grpc - Real-time on-chain data

**Infrastructure**:
- winston + winston-daily-rotate-file - Production logging
- pg - PostgreSQL driver
- dotenv - Environment management
- decimal.js - Precise decimal math
- bs58 - Base58 encoding

**Development**:
- TypeScript, ts-node, nodemon
- Jest for testing
- ESLint + Prettier for code quality

## DATABASE SCHEMA

Design a PostgreSQL schema to track:

**Tokens Table**:
- Token address, name, symbol
- Bonding curve address
- Creation timestamp
- Migration status and timestamp

**Token Metrics Table** (time series):
- Token address + timestamp (indexed)
- Volume metrics (5m, 1h)
- Holder count and velocity
- Bonding progress percentage
- Liquidity depth
- Momentum score and safety score

**Signals Table**:
- Token address
- Signal type (BUY, STRONG_BUY, SELL)
- Momentum score at signal time
- Timestamp
- Execution status

**Trades Table**:
- Token address
- Trade type (BUY/SELL)
- Amounts (SOL and tokens)
- Price at execution
- Wallet used
- Transaction signature
- P&L

**Positions Table** (open positions):
- Token address
- Entry price and current price
- Token amount and cost basis
- Unrealized P&L
- Stop-loss and take-profit levels (JSON)
- Status (open, partial_close, closed)

## LOGGING INFRASTRUCTURE

Set up Winston logger with:
- **Console output**: Colorized, human-readable
- **File rotation**: Daily rotation, separate error logs
- **Component loggers**: Separate logs for RPC, gRPC, Trading, Signals
- **Trade logs**: Special 90-day retention for analysis
- **Log levels**: Configurable via environment

## ENVIRONMENT VARIABLES

Create comprehensive .env configuration:

**RPC Configuration**:
- RPC_ENDPOINT (HTTP)
- RPC_WEBSOCKET_ENDPOINT (WSS)
- GRPC_ENDPOINT and GRPC_TOKEN

**Wallet Management** (CRITICAL SECURITY):
- PRIVATE_KEY (main wallet, base58 encoded)
- WALLET_2_PRIVATE_KEY, WALLET_3_PRIVATE_KEY (optional)

**Trading Parameters**:
- MAX_POSITION_SIZE_SOL
- MIN_MOMENTUM_SCORE
- MAX_CONCURRENT_POSITIONS
- DAILY_LOSS_LIMIT_PERCENT

**Risk Management**:
- STOP_LOSS_MULTIPLIER (ATR-based)
- TAKE_PROFIT_LEVELS (comma-separated)
- TAKE_PROFIT_PERCENTAGES

**Execution Settings**:
- JITO_TIP_LAMPORTS
- MAX_SLIPPAGE_BPS
- PRIORITY_FEE_LAMPORTS

**Development**:
- NODE_ENV
- ENABLE_PAPER_TRADING
- LOG_LEVEL

## SECURITY UTILITIES NEEDED

**Wallet Manager**:
- Load multiple wallets from environment
- NEVER log private keys (create sanitization function)
- Validate all wallets on initialization
- Provide methods to get wallet by name or rotate wallets

**Environment Validation**:
- Check all required environment variables on startup
- Fail fast with clear error messages
- Validate RPC endpoints are accessible

## CUSTOM ERROR CLASSES

Create specific error types for better debugging:
- RPCError
- GRPCError
- TransactionError
- InsufficientFundsError
- SlippageError
- SafetyCheckError
- DatabaseError
- ConfigurationError

## CONSTANTS CONFIGURATION

Define critical constants:
- Pump.fun program ID: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- Migration account: `39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg`
- Raydium Liquidity Pool V4 program
- WSOL and USDC mint addresses
- Bonding curve thresholds (70-95% for entry)
- Momentum score thresholds

## TYPESCRIPT CONFIGURATION

Set up strict TypeScript with:
- Path aliases (@config/*, @services/*, etc.)
- Strict mode enabled
- Source maps for debugging
- Declaration files for library code

## TESTING SETUP

Configure Jest for:
- TypeScript support (ts-jest)
- Path alias resolution
- Coverage thresholds (70%+)
- Separate unit and integration tests

## TASKS TO COMPLETE

1. ✅ Create complete folder structure
2. ✅ Initialize npm project with all dependencies
3. ✅ Create comprehensive .env.example
4. ✅ Design and create database schema SQL
5. ✅ Implement Winston logger with rotation
6. ✅ Create custom error classes
7. ✅ Build secure wallet manager
8. ✅ Set up environment validation
9. ✅ Define all constants
10. ✅ Configure TypeScript with path aliases
11. ✅ Set up Jest testing
12. ✅ Create .gitignore (NEVER commit .env!)
13. ✅ Write basic README

## VALIDATION CHECKLIST

Before moving to Prompt 2:
- ✅ `npm install` completes without errors
- ✅ TypeScript compiles: `npm run build`
- ✅ Database schema creates successfully
- ✅ Logger writes to files in data/logs/
- ✅ Wallet manager loads wallets from .env
- ✅ Environment validation catches missing vars
- ✅ Simple test passes

## SUCCESS CRITERIA

The project is ready when:
1. Clean folder structure with all directories
2. All dependencies installed and configured
3. Database schema created in PostgreSQL
4. Logger working with file rotation
5. Wallet manager securely loads keys
6. No compilation errors
7. Foundation ready for building services

## NEXT PROMPT

Once this infrastructure is solid, **Prompt 2** will build the real-time data streaming layer (RPC and gRPC services).
