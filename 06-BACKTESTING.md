# PROMPT 6: Backtesting & Analytics

## OBJECTIVE
Build a framework to validate your trading strategy using historical data BEFORE risking real money. This is how you optimize thresholds, test edge cases, and build confidence in your system.

## WHY BACKTESTING MATTERS

**The Hard Truth**:
- 90% of trading bots lose money
- Most fail because they weren't tested properly
- Historical validation doesn't guarantee future success
- But NO historical validation = guaranteed failure

**What Backtesting Reveals**:
- Which thresholds work best
- How often signals occur
- Win rate and profit expectations
- Maximum drawdown (worst-case losses)
- Which market conditions favor your strategy

## BACKTESTING ARCHITECTURE

### 1. HISTORICAL DATA COLLECTOR

**Purpose**: Gather real Pump.fun token data for testing

**Data to Collect**:
```
For each historical token launch:
- Token address and metadata
- Bonding curve timeline (progress over time)
- Price history (every minute)
- Volume history (every minute)
- Holder count over time
- Top holder distribution
- Migration timestamp
- Final outcome (rug, success, neutral)
```

**Collection Methods**:
```
Option A: Query Solana archives
- Use historical RPC calls
- Expensive but accurate
- Get actual on-chain state

Option B: Use third-party APIs
- Birdeye API
- DexScreener API
- Pump.fun API (if available)
- Faster but may have gaps

Option C: Scrape from explorers
- Solscan, Solana Beach
- Manual but free
- Time-consuming
```

**Storage**:
```
Store in database tables:
- historical_tokens
- historical_metrics (time series)
- historical_outcomes

File Format:
- CSV for price/volume data
- JSON for metadata
- Parquet for large datasets
```

### 2. BACKTEST ENGINE

**Purpose**: Simulate bot behavior on historical data

**Simulation Flow**:
```
For each historical token:
    1. Start from launch time
    2. Replay events chronologically
    3. Calculate metrics at each timestamp
    4. Generate momentum scores
    5. Check if signal would trigger
    6. Simulate trade execution
    7. Track position over time
    8. Apply stop-loss/take-profit
    9. Calculate final P&L
    10. Record results
```

**Time Simulation**:
```
Replay Timeline:
- Start at token launch (T=0)
- Progress in 30-second increments
- At each step:
  * Update metrics with historical data
  * Calculate momentum score
  * Check entry/exit conditions
  * Update positions

Critical: Don't use future data (no look-ahead bias)
```

**Trade Simulation**:
```
When BUY signal generated:
- Check: Would we have capital available?
- Check: Would position limits allow?
- Calculate: Position size based on score
- Assume: Entry at next available price
- Apply: Realistic slippage (1-3%)
- Record: Entry details

While position open:
- Track unrealized P&L
- Check stop-loss each step
- Check take-profit each step
- Exit on migration or signal

When EXIT triggered:
- Assume: Exit at next price
- Apply: Realistic slippage
- Calculate: Realized P&L
- Record: Trade details
```

**Realistic Assumptions**:
```
Include Real-World Friction:
- Slippage: 2-5% on entry, 3-7% on exit
- Failed transactions: 5-10% failure rate
- Execution delay: 1-5 seconds
- Gas fees: 0.001 SOL per trade
- Jito tips: 0.0001 SOL per trade

Don't assume perfect execution:
- Some signals missed due to lag
- Some trades fail due to network
- Prices move while building transaction
```

### 3. PARAMETER OPTIMIZATION

**Purpose**: Find best threshold values

**Parameters to Tune**:
```
Momentum Thresholds:
- BUY threshold (current: 75)
- STRONG_BUY threshold (current: 85)
- SELL threshold (current: 50)

Scoring Weights:
- Volume score weight (current: 30%)
- Holder score weight (current: 25%)
- Liquidity score weight (current: 20%)
- Social score weight (current: 15%)
- Safety score weight (current: 10%)

Risk Management:
- Stop-loss multiplier (current: 1.5)
- Take-profit levels (current: 2x, 3x, 5x)
- Take-profit percentages (current: 25%, 25%, 50%)
- Max position size
- Max concurrent positions

Bonding Curve:
- Min bonding % (current: 70%)
- Max bonding % (current: 95%)
- Optimal zone (current: 80-90%)
```

**Optimization Strategy**:
```
Grid Search:
1. Define parameter ranges
   BUY_threshold: [70, 72, 75, 78, 80]
   STOP_loss_mult: [1.0, 1.5, 2.0, 2.5]
   
2. Test all combinations
   Total runs = combinations of all parameters
   
3. For each combination:
   - Run full backtest
   - Calculate performance metrics
   - Store results

4. Select best based on:
   - Highest Sharpe ratio
   - Or highest total P&L
   - Or highest win rate
   - Or lowest drawdown

Warning: Don't overfit! Test on separate validation set.
```

**Walk-Forward Testing**:
```
More robust than grid search:

1. Split historical data into windows
   Training: Jan-Mar
   Validation: Apr
   Repeat monthly

2. Optimize on training data
3. Test on validation data (never seen)
4. If validation performs well, parameters are robust
5. If not, parameters are overfit
```

### 4. PERFORMANCE ANALYTICS

**Metrics to Calculate**:

**Win Rate Metrics**:
```
total_trades = wins + losses
win_rate = wins / total_trades * 100

Target: 35-45% win rate
Minimum acceptable: 30%
```

**Profit Metrics**:
```
average_win = sum(winning_trades) / num_wins
average_loss = sum(losing_trades) / num_losses
profit_factor = total_wins / total_losses

Target: profit_factor > 2.0
(Wins must be 2x larger than losses)
```

**Risk Metrics**:
```
sharpe_ratio = (avg_return - risk_free_rate) / std_dev_returns
Target: > 1.5

max_drawdown = largest peak-to-trough decline
Target: < 20% of capital

calmar_ratio = annual_return / max_drawdown
Target: > 3.0
```

**Trade Distribution**:
```
Analyze:
- Distribution of returns (histogram)
- Largest winning trade
- Largest losing trade
- Average holding time
- Longest winning streak
- Longest losing streak
```

### 5. SCENARIO TESTING

**Test Edge Cases**:
```
Scenario 1: Market Crash
- Simulate all tokens dumping simultaneously
- Check: Do stop-losses protect?
- Check: Does daily loss limit trigger?

Scenario 2: No Opportunities
- Period with no tokens meeting criteria
- Check: Bot stays dormant correctly

Scenario 3: High Volatility
- Rapid price swings
- Check: Stop-loss doesn't get whipsawed
- Check: Take-profit captures runs

Scenario 4: Network Congestion
- Simulate failed transactions
- Check: Retry logic works
- Check: No double executions

Scenario 5: Rug Pull Detection
- Known rug pull tokens
- Check: Safety score catches them
- Check: Emergency exit works
```

### 6. REPORTING & VISUALIZATION

**Generate Reports**:
```
Summary Report:
- Total trades executed
- Win rate
- Total P&L
- Sharpe ratio
- Max drawdown
- Best/worst trades

Daily P&L Chart:
- Line graph of cumulative returns
- Show drawdown periods
- Mark major wins/losses

Signal Distribution:
- How many signals generated
- Signal quality (score distribution)
- Which signals were most profitable

Token Analysis:
- Which token characteristics led to wins
- Common patterns in losses
- Bonding % distribution at entry
```

**Export for Analysis**:
```
CSV Exports:
- All trades with details
- Daily P&L
- Signal history
- Parameter test results

Use for:
- Excel analysis
- Python notebooks
- Further optimization
```

## IMPLEMENTATION STRATEGY

**Phase 1**: Data Collection
- Build historical data collector
- Populate database with 100+ tokens
- Include both successes and failures

**Phase 2**: Basic Backtest
- Implement simulation engine
- Run on small dataset
- Verify logic is correct

**Phase 3**: Full Backtest
- Run on full historical dataset
- Generate performance report
- Analyze results

**Phase 4**: Optimization
- Implement parameter tuner
- Test different configurations
- Select optimal parameters

**Phase 5**: Validation
- Test on unseen data
- Verify performance holds
- Adjust if needed

## VALIDATION CHECKLIST

Before Prompt 7:
- ✅ Historical data collected
- ✅ Backtest engine simulates accurately
- ✅ Performance metrics calculated
- ✅ Optimization framework works
- ✅ Results look realistic (not too good)
- ✅ Edge cases tested
- ✅ Reports generated

## SUCCESS CRITERIA

Ready for Prompt 7 when:
1. Backtest shows positive expectancy
2. Win rate 30-50%
3. Sharpe ratio > 1.0
4. Max drawdown acceptable (<30%)
5. Parameters optimized
6. Confidence in strategy validated

## WHAT'S NEXT

**Prompt 7** will tie everything together - the main orchestration that runs all components in production.

## CRITICAL INSIGHTS

**Backtesting Traps**:
- ❌ Overfitting to historical data
- ❌ Using future data (look-ahead bias)
- ❌ Ignoring transaction costs
- ❌ Assuming perfect execution
- ❌ Testing on too little data

**Best Practices**:
- ✅ Test on 100+ tokens minimum
- ✅ Include failed tokens (not just winners)
- ✅ Use realistic slippage
- ✅ Validate on separate data
- ✅ Be conservative with estimates

**Reality Check**:
```
If backtest shows:
- 90%+ win rate → Probably wrong
- 10x returns in a month → Too optimistic
- Zero losses → Missing something
- Perfect entries → Unrealistic

Realistic expectations:
- 35-45% win rate
- 2-5x on winners, -50-80% on losers
- Net positive over 100+ trades
- Drawdowns happen
```
