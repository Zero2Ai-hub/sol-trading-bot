# SOLANA MOMENTUM TRADING BOT - PROJECT KICKOFF

## OVERVIEW
You are building a sophisticated Solana trading bot that detects momentum in newly launched tokens on Pump.fun BEFORE they migrate to Raydium/PumpSwap. The bot analyzes on-chain data in real-time to identify tokens building momentum and executes trades automatically.

## CORE STRATEGY
**The Most Profitable Window**: Tokens on Pump.fun use a bonding curve mechanism. When they reach ~$69k market cap (70-95% bonding curve completion), they "graduate" and migrate to Raydium/PumpSwap. This migration moment creates massive volatility and volume spikes.

**Your Bot's Edge**: 
- Enter positions BEFORE migration (at 70-95% bonding completion)
- Exit DURING the migration pump when retail rushes in
- Use on-chain momentum signals to identify which tokens will actually pump

## PROJECT GOALS
1. Detect early momentum through multi-factor on-chain analysis
2. Enter positions at optimal timing (70-95% bonding curve)
3. Execute trades with institutional speed (Jito bundles, priority fees)
4. Implement robust risk management (stop-loss, position sizing, daily limits)
5. Target 35-45% win rate with 3-10x gains on winners

## TECHNICAL STACK
- **Language**: TypeScript (Node.js)
- **Blockchain**: Solana
- **Data Streaming**: Yellowstone gRPC / Geyser plugin
- **RPC**: Premium node (Helius, QuickNode, or Chainstack)
- **Execution**: Jito bundles for MEV protection
- **Routing**: Jupiter API for optimal swaps
- **Database**: PostgreSQL for metrics storage

## SEQUENTIAL BUILD APPROACH
We'll build this in 7 phases, each with a dedicated prompt:

**Phase 1: Project Setup** - Infrastructure, dependencies, database schema
**Phase 2: Data Streaming** - RPC connections, gRPC streaming, Pump.fun event monitoring
**Phase 3: Data Collectors** - Volume, holder, liquidity, and safety analyzers
**Phase 4: Momentum Engine** - Scoring algorithm and signal generation
**Phase 5: Trade Executor** - Transaction building, execution, position management
**Phase 6: Backtesting** - Historical validation and optimization
**Phase 7: Orchestration** - Main bot controller and monitoring

## YOUR APPROACH
For each prompt:
1. **Read the entire prompt first** - Understand the big picture
2. **Ask clarifying questions** - If anything is unclear
3. **Design before coding** - Plan your architecture
4. **Implement incrementally** - Build and test each component
5. **Validate thoroughly** - Ensure everything works before moving on

## WHAT MAKES THIS DIFFERENT
- **Speed**: Milliseconds matter. Public RPCs = missed trades
- **Safety**: Most tokens are scams. Rigorous safety checks are mandatory
- **Risk**: Never risk more than you can afford to lose per trade
- **Data Quality**: Garbage in = garbage out. Validate everything

## CRITICAL PRINCIPLES
🔒 **Security First**: Private keys never in logs, always encrypted
⚡ **Performance**: Optimize for low latency at every layer
🛡️ **Risk Management**: Protect capital - survival > profit
📊 **Data Driven**: Every decision based on metrics, not hunches
🔄 **Resilience**: Auto-reconnect, graceful failures, comprehensive logging

## READY?
Confirm you understand:
- The trading strategy (pre-migration momentum detection)
- The technical approach (TypeScript, gRPC streaming, Jito execution)
- The sequential workflow (7 prompts building on each other)
- The priorities (security, speed, risk management)

Once confirmed, we'll proceed to **Prompt 1: Project Setup & Infrastructure**.

If you have questions about:
- Pump.fun mechanics
- Bonding curves
- Solana transaction execution
- The overall architecture

...ask now before we start building! 🚀
