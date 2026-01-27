# PROMPT 5: Trading Executor

## OBJECTIVE
Build the execution layer that takes trading signals and converts them into actual on-chain transactions. This is where your bot puts money at risk - speed, security, and risk management are CRITICAL.

## WHY EXECUTION MATTERS

**On Solana, execution speed decides P&L**:
- Public routing = front-run by bots = bad fills
- Jito bundles = MEV protection = fair execution
- Jupiter API = best routing across DEXs
- Priority fees = transaction inclusion guarantees

## FOUR CORE COMPONENTS

### 1. WALLET MANAGER

**Purpose**: Manage multiple wallets for distribution and redundancy

**Requirements**:
- Load all wallets from environment (already in Prompt 1)
- Track balance for each wallet
- Rotate wallets to avoid detection
- Reserve SOL for rent + fees
- Auto-fund low-balance wallets

**Wallet Rotation Strategy**:
```
Use multiple wallets to:
- Avoid being flagged as a bot
- Distribute risk
- Bypass per-wallet limits
- Provide redundancy if one fails

Rotation Logic:
- Select wallet with highest available balance
- Skip wallets below minimum threshold
- Round-robin for fairness
- Log which wallet used for each trade
```

**Balance Monitoring**:
```
For each wallet, track:
- SOL balance
- Token holdings
- Reserved amount (rent + fees)
- Available for trading

Alert if any wallet drops below threshold
```

### 2. TRANSACTION BUILDER

**Purpose**: Construct optimized Solana transactions

**Jupiter Integration**:
```
Jupiter API provides:
- Best swap routes across all Solana DEXs
- Optimal pricing
- Slippage protection
- Quote caching

Flow:
1. Request quote from Jupiter
2. Get best route + expected output
3. Build swap transaction
4. Add priority fee
5. Package in Jito bundle
```

**Transaction Components**:
```
Jito Bundle Transaction:
- Compute budget instruction (priority fee)
- Jupiter swap instruction
- Tip to Jito validator
- Signed by wallet keypair

Parameters to configure:
- Slippage tolerance (default 5% = 500 BPS)
- Priority fee (dynamic based on congestion)
- Jito tip (minimum 10,000 lamports)
```

**Priority Fee Strategy**:
```
Dynamic Calculation:
- Query recent priority fees on network
- Take 75th percentile
- Add buffer for importance
- Cap at maximum threshold

Formula:
recent_fees = getRecentPrioritizationFees()
base_fee = percentile(recent_fees, 0.75)
priority_fee = base_fee * 1.5  // 50% buffer
priority_fee = min(priority_fee, MAX_FEE)
```

### 3. POSITION SIZER

**Purpose**: Determine how much to trade based on risk parameters

**Position Sizing Algorithm**:
```
Factors:
1. Momentum score (higher = larger position)
2. Available capital
3. Risk limits (per trade, total exposure)
4. Concurrent position limits

Formula:
base_size = MAX_POSITION_SIZE_SOL
score_multiplier = momentum_score / 100

if signal_type == STRONG_BUY:
    position_size = base_size * score_multiplier
elif signal_type == BUY:
    position_size = base_size * 0.75 * score_multiplier
    
// Apply caps
position_size = min(position_size, MAX_POSITION_SIZE_SOL)
position_size = min(position_size, available_capital * 0.33)  // Max 33% of capital per trade
```

**Risk Limits to Enforce**:
- Maximum position size per trade
- Maximum concurrent positions (default: 3)
- Maximum daily loss limit (% of capital)
- Minimum balance reserved for fees

### 4. EXECUTION ENGINE

**Purpose**: Actually submit transactions and manage lifecycle

**Buy Execution Flow**:
```
1. Validate Signal
   - Check all entry conditions met
   - Verify wallet has sufficient balance
   - Confirm token not blacklisted
   
2. Calculate Position Size
   - Based on score + risk limits
   - Reserve amount from wallet

3. Build Transaction
   - Get Jupiter quote (SOL → Token)
   - Build swap instruction
   - Add priority fee
   - Package in Jito bundle

4. Execute Transaction
   - Submit to Jito block engine
   - Wait for confirmation (with timeout)
   - Verify transaction succeeded
   - Extract actual fill price

5. Record Trade
   - Log to database (trades table)
   - Create position record
   - Calculate stop-loss price
   - Set take-profit levels
   - Update wallet balance

6. Monitor Position
   - Start tracking in position manager
```

**Sell Execution Flow**:
```
1. Determine Exit Reason
   - Migration detected (URGENT)
   - Take-profit hit
   - Stop-loss hit
   - Manual override

2. Build Exit Transaction
   - Get Jupiter quote (Token → SOL)
   - Use MAX slippage if urgent
   - Build swap instruction
   - Prioritize confirmation speed

3. Execute Transaction
   - Submit to Jito
   - Confirm execution
   - Extract fill price

4. Close Position
   - Calculate realized P&L
   - Update position record (status: closed)
   - Log trade
   - Free up capital
   - Update daily P&L tracking
```

## RISK MANAGEMENT SYSTEM

### ATR-Based Stop-Loss

**ATR (Average True Range)** = Volatility measure

```
Calculate ATR:
- Track price range over last N periods
- ATR = average of (high - low) per period

Set Stop-Loss:
stop_loss_price = entry_price - (ATR * STOP_LOSS_MULTIPLIER)

Default multiplier: 1.5
Tighter for low volatility, wider for high volatility
```

### Laddered Take-Profit

**Strategy**: Exit in stages to capture profit while letting winners run

```
Default Levels (configurable):
- Take 25% profit at 2x (100% gain)
- Take 25% profit at 3x (200% gain)  
- Take 50% profit at 5x (400% gain)

Implementation:
When price hits level:
1. Calculate token amount to sell (percentage)
2. Execute partial sell
3. Update position (reduce size)
4. Adjust stop-loss (trail upward)
5. Mark level as executed
```

### Position Monitoring

**Real-Time Tracking**:
```
Every 5 seconds for each open position:
1. Fetch current token price
2. Calculate unrealized P&L
3. Check stop-loss condition
4. Check take-profit conditions
5. Update database
6. Emit position update event

If stop-loss hit:
    Trigger immediate sell
If take-profit hit:
    Execute ladder sell
If migration detected:
    Emergency exit
```

### Daily Loss Limit

**Circuit Breaker**:
```
Track cumulative P&L for the day
If daily_loss > (DAILY_LOSS_LIMIT_PERCENT * capital):
    STOP ALL TRADING
    Close all positions
    Alert operator
    Pause bot until next day or manual override
```

## ERROR HANDLING

**Transaction Failures**:
```
Reasons transactions fail:
- Insufficient balance
- Slippage exceeded
- Network congestion
- Validator rejection

Strategy:
1. Log failure reason
2. Don't retry immediately (wait 30s)
3. Check if conditions still valid
4. Retry with adjusted parameters
5. Max 3 retries, then abort
```

**Network Issues**:
```
If RPC/gRPC disconnects during trade:
- Assume transaction may have succeeded
- Query transaction signature
- Verify state on-chain
- Never double-execute
```

## EXECUTION ANALYTICS

**Track Performance Metrics**:
```
Per Trade:
- Entry price vs expected
- Slippage (expected vs actual)
- Time to confirmation
- Gas fees paid
- P&L

Aggregate:
- Win rate
- Average win size
- Average loss size
- Best/worst trades
- Sharpe ratio
- Maximum drawdown
```

## IMPLEMENTATION ARCHITECTURE

**TradeExecutor Class**:
```
Methods:
- executeBuy(signal, token, score)
- executeSell(position, reason)
- executePartialSell(position, percentage, reason)
- buildSwapTransaction(input, output, amount, slippage)
- submitJitoBundle(transaction, tip)
- waitForConfirmation(signature, timeout)
```

**PositionManager Class**:
```
Methods:
- createPosition(token, entry_price, amount)
- updatePosition(token, current_price)
- checkStopLoss(position, current_price)
- checkTakeProfit(position, current_price)
- closePosition(position, exit_price, reason)
- getOpenPositions()
- getPositionPnL(position)
```

## TESTING STRATEGY

**Paper Trading Mode**:
```
Enable via: ENABLE_PAPER_TRADING=true

Simulates trades without real execution:
- Log what would be traded
- Track simulated P&L
- Validate logic without risk
- Test on mainnet safely
```

**Unit Tests**:
- Position sizing logic
- Risk calculations
- Stop-loss/take-profit triggers
- Transaction building

**Integration Tests**:
- End-to-end buy flow
- End-to-end sell flow
- Position lifecycle
- Risk limit enforcement

## VALIDATION CHECKLIST

Before Prompt 6:
- ✅ Buy execution works (paper trading)
- ✅ Sell execution works (paper trading)
- ✅ Position tracking accurate
- ✅ Stop-loss triggers correctly
- ✅ Take-profit ladders work
- ✅ Risk limits enforced
- ✅ Jito bundles submit successfully
- ✅ P&L calculations correct

## SUCCESS CRITERIA

Ready for Prompt 6 when:
1. Can execute buys via Jupiter + Jito
2. Can execute sells with proper routing
3. Position management tracks P&L
4. Risk management prevents over-trading
5. Paper trading mode validated
6. All trades logged to database

## WHAT'S NEXT

**Prompt 6** will build the backtesting framework to validate the strategy using historical data before going live.

## CRITICAL WARNINGS

⚠️ **Never Execute Without Validation**:
- Test extensively on testnet first
- Use paper trading mode initially
- Start with tiny position sizes
- Monitor every trade closely

⚠️ **Security**:
- Private keys NEVER in logs
- Transactions signed only when ready
- Always verify before sending
- Implement kill switch

⚠️ **Speed vs Safety**:
- Fast execution is important
- But correct execution is critical
- Don't sacrifice security for speed
- Better to miss a trade than lose funds
