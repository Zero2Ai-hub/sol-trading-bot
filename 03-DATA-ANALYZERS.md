# PROMPT 3: On-Chain Data Collectors

## OBJECTIVE
Build specialized analyzers that transform raw blockchain data into actionable momentum indicators. These are the "smart sensors" that tell you which tokens are building real momentum vs. which are dead on arrival.

## THE BIG PICTURE

Raw Data → Analyzers → Metrics → Momentum Score → Trading Signal

Each analyzer focuses on one aspect:
- **Volume Analyzer**: Is trading activity accelerating?
- **Holder Analyzer**: Are unique holders growing fast?
- **Liquidity Analyzer**: How far along is the bonding curve?
- **Safety Analyzer**: Is this a rug pull waiting to happen?

## ANALYZER 1: VOLUME ANALYZER

**Core Question**: Is volume accelerating or decelerating?

**Metrics to Track**:
- Volume in different time windows (5min, 15min, 1hr)
- Volume velocity (rate of change)
- Buy vs Sell volume ratio
- Volume spikes (>3x average)

**Data Collection Method**:
- Listen to DEX swap events (Raydium, PumpSwap)
- Record each trade: timestamp, amount, type (buy/sell)
- Store in rolling window (keep last 2 hours)
- Clean old data periodically

**Calculation Logic**:

*Volume Windows*:
```
volume_5m = sum of trades in last 5 minutes
volume_1h = sum of trades in last hour
avg_volume_per_5min = volume_1h / 12
```

*Volume Velocity*:
```
velocity = (volume_5m - avg_volume_per_5min) / avg_volume_per_5min
Positive = accelerating, Negative = slowing down
```

*Buy Ratio*:
```
buy_ratio = buy_volume / (buy_volume + sell_volume)
>0.6 = strong buying, <0.4 = strong selling
```

*Volume Spike Detection*:
```
if volume_5m > (avg_volume_per_5min * 3):
    SPIKE DETECTED
```

**Output**: VolumeMetrics object with all calculated values

## ANALYZER 2: HOLDER ANALYZER

**Core Question**: Are unique holders growing rapidly?

**Metrics to Track**:
- Total holder count
- New holders per minute (velocity)
- Top 10 holder concentration (%)
- Developer wallet percentage
- Holder growth rate

**Data Collection Method**:
- Query all token accounts for the token mint
- Track holder addresses over time
- Take snapshots every X minutes
- Calculate deltas between snapshots

**Calculation Logic**:

*Holder Velocity*:
```
new_holders = current_holders - holders_5min_ago
holder_velocity = new_holders / 5  // per minute
```

*Top Holder Concentration*:
```
top10_percentage = (sum of top 10 balances / total_supply) * 100
SAFE if < 30%, WARNING if > 30%
```

*Developer Holdings Check*:
```
dev_percentage = dev_wallet_balance / total_supply * 100
SAFE if < 20%, WARNING if > 20%
```

*Growth Rate*:
```
growth = (current_holders - holders_1hr_ago) / holders_1hr_ago * 100
```

**Red Flags**:
- Top 10 holders >30% → Whale dump risk
- Dev holds >20% → Rug pull risk  
- Holder growth negative → Dying token

**Output**: HolderMetrics object

## ANALYZER 3: LIQUIDITY ANALYZER

**Core Question**: How close to migration? How deep is liquidity?

**Metrics to Track**:
- Bonding curve completion % (0-100)
- Whether curve is complete (migration ready)
- Total liquidity in SOL
- Estimated slippage for typical trade
- Liquidity lock status

**Data Collection Method**:
- Fetch bonding curve account data
- Parse curve state (reserves, completion flag)
- Calculate position on curve

**Bonding Curve Math**:
```
Pump.fun uses a bonding curve where:
- Price increases as more tokens are bought
- Curve "completes" at ~$69k market cap
- At completion, liquidity migrates to Raydium

completion_percent = (current_progress / target_mcap) * 100

TARGET ENTRY ZONE: 70-95%
```

**Slippage Estimation**:
```
For a typical trade size:
slippage = (price_after_trade - price_before_trade) / price_before_trade

High slippage (>5%) = low liquidity = risky
```

**Liquidity Lock Check**:
```
Query if LP tokens are locked
Locked = SAFER, Unlocked = RUG RISK
```

**Output**: LiquidityMetrics object

## ANALYZER 4: SAFETY ANALYZER

**Core Question**: Is this token safe to trade or a scam?

**Safety Checks** (Pass/Fail each):

1. **Mint Authority Revoked**:
   - If NOT revoked → Dev can mint infinite tokens → RUG
   
2. **Freeze Authority Revoked**:
   - If NOT revoked → Dev can freeze your tokens → RUG
   
3. **Top Holder Distribution**:
   - If top 10 hold >30% → DUMP RISK
   
4. **Dev Holdings**:
   - If dev holds >20% → RUG RISK
   
5. **Social Links Present**:
   - Has website? Has Twitter? Has Telegram?
   - No links = likely scam
   
6. **Contract Age**:
   - Brand new (<5 min) → RISKY
   - Some age (>30 min) → SAFER

**Scoring System**:
```
Each check = 0-10 points
- Mint revoked: 10 points
- Freeze revoked: 10 points
- Top holders OK: 10 points
- Dev holdings OK: 10 points
- Has socials: 10 points
- Age check: 10 points

Total = 0-60 points
Normalize to 0-10: safety_score = total / 6

Minimum to trade: safety_score >= 7
```

**Output**: SafetyMetrics object with score + warnings array

## DATA STORAGE STRATEGY

**In-Memory** (Fast access):
- Current metrics for all tracked tokens
- Recent history (last 2 hours)

**Database** (Persistent):
- All metrics timestamped
- Historical analysis
- Backtesting data

**Update Frequency**:
- Volume: Calculate every 30 seconds
- Holders: Update every 1 minute
- Liquidity: Check every 30 seconds
- Safety: Check once at launch, then if triggered

## INTEGRATION WITH MONITORS

```
Pump.fun Monitor emits: token:launched
    ↓
All Analyzers: Start tracking this token
    ↓
Every 30s: Update metrics
    ↓
Store to database
    ↓
Pass to Momentum Engine (Prompt 4)
```

## IMPLEMENTATION STRATEGY

**For Each Analyzer**:
1. Create class with tracking logic
2. Implement metric calculation methods
3. Add memory management (clean old data)
4. Store metrics to database
5. Provide getter methods
6. Handle errors gracefully

**Memory Management**:
- Only keep data for active tokens
- Remove data for migrated/dead tokens
- Limit history to what's needed (2 hours)
- Clean periodically

## VALIDATION CHECKLIST

Before Prompt 4:
- ✅ Volume analyzer tracks trades and calculates metrics
- ✅ Holder analyzer monitors wallet distribution
- ✅ Liquidity analyzer tracks bonding curve
- ✅ Safety analyzer performs all checks
- ✅ Metrics update in real-time
- ✅ Database storage works
- ✅ Memory cleanup prevents leaks

## SUCCESS CRITERIA

Ready for Prompt 4 when:
1. All 4 analyzers operational
2. Real-time metrics flowing
3. Data stored to database
4. Metrics accessible via getters
5. No performance bottlenecks
6. Logging shows metric updates

## WHAT'S NEXT

**Prompt 4** will combine these metrics into a single momentum score and generate trading signals (BUY/SELL).

## CRITICAL NOTES

- **Accuracy > Speed** for analyzers (but still optimize)
- **Validate all on-chain data** (don't trust anything)
- **Handle missing data gracefully** (not all tokens have socials)
- **Test with real token data** from Pump.fun
