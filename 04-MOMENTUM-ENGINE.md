# PROMPT 4: Momentum Scoring Engine

## OBJECTIVE
Build the brain of your bot - the algorithm that combines all analyzer metrics into a single momentum score and generates actionable trading signals (BUY, SELL, HOLD).

## THE CORE ALGORITHM

**Input**: Metrics from all 4 analyzers
**Output**: Momentum score (0-100) + Trading signal

**Why Scoring Matters**:
- Most Pump.fun tokens fail (>50% go to zero)
- You need to filter noise and find real momentum
- Multi-factor analysis beats any single indicator
- Higher score = higher confidence = larger position size

## WEIGHTED SCORING SYSTEM

**Total Score = 100 points distributed as**:

### 1. VOLUME SCORE (30 points max)

**What it measures**: Trading activity and acceleration

**Sub-components**:
- Volume velocity (15 pts): Is volume accelerating?
- Buy ratio (10 pts): More buying than selling?
- Volume spike (5 pts): Recent spike detected?

**Calculation Logic**:
```
Volume Velocity Points:
if velocity > 2.0 (200% increase):    15 points
if velocity > 1.0 (100% increase):    10 points
if velocity > 0.5 (50% increase):     5 points
if velocity < 0 (decreasing):         0 points

Buy Ratio Points:
if buy_ratio > 0.7 (70% buys):        10 points
if buy_ratio > 0.6 (60% buys):        7 points
if buy_ratio > 0.5 (balanced):        3 points
if buy_ratio < 0.5 (more sells):      0 points

Volume Spike Points:
if spike in last 5 minutes:           5 points
else:                                  0 points

volume_score = velocity_pts + buy_ratio_pts + spike_pts
```

### 2. HOLDER SCORE (25 points max)

**What it measures**: Wallet distribution health and growth

**Sub-components**:
- Holder velocity (10 pts): Growing fast?
- Concentration safety (10 pts): Well distributed?
- Unique holder count (5 pts): Critical mass?

**Calculation Logic**:
```
Holder Velocity Points:
if holders_per_minute > 10:           10 points
if holders_per_minute > 5:            7 points
if holders_per_minute > 2:            3 points
if holders_per_minute < 0 (losing):   0 points

Concentration Points:
if top10_percentage < 20%:            10 points
if top10_percentage < 30%:            7 points
if top10_percentage < 40%:            3 points
if top10_percentage >= 40%:           0 points

Holder Count Points:
if total_holders > 500:               5 points
if total_holders > 200:               3 points
if total_holders > 50:                1 point
else:                                  0 points

holder_score = velocity_pts + concentration_pts + count_pts
```

### 3. LIQUIDITY SCORE (20 points max)

**What it measures**: Bonding curve position and depth

**Sub-components**:
- Bonding progress (15 pts): In the entry zone?
- Liquidity depth (5 pts): Enough liquidity?

**Calculation Logic**:
```
Bonding Progress Points (CRITICAL):
if 80-90% complete:                   15 points  // SWEET SPOT
if 70-80% or 90-95% complete:         10 points  // ACCEPTABLE
if 60-70% or 95-100% complete:        5 points   // RISKY
if < 60% or > 100% (migrated):        0 points   // NO TRADE

Liquidity Depth Points:
if liquidity > $50k:                  5 points
if liquidity > $20k:                  3 points
if liquidity > $10k:                  1 point
else:                                  0 points

liquidity_score = progress_pts + depth_pts
```

### 4. SOCIAL SCORE (15 points max)

**What it measures**: Community and marketing presence

**Sub-components**:
- Social links present (10 pts)
- Community growth indicators (5 pts)

**Calculation Logic**:
```
Social Links Points:
if has_website + has_twitter + has_telegram:  10 points
if has 2 of 3:                                7 points
if has 1 of 3:                                3 points
if has none:                                   0 points

Growth Indicators (if available):
if telegram_members > 500:            5 points
if telegram_members > 100:            3 points
else:                                  0 points

social_score = links_pts + growth_pts
```

### 5. SAFETY SCORE (10 points max)

**What it measures**: Rug pull risk level

**Calculation Logic**:
```
safety_score = (safety_analyzer_score / 10) * 10

Must have minimum safety_score >= 7 to trade
```

## MOMENTUM SCORE CALCULATION

```
total_momentum_score = 
    volume_score +     // 0-30
    holder_score +     // 0-25
    liquidity_score +  // 0-20
    social_score +     // 0-15
    safety_score       // 0-10

Range: 0-100
```

## SIGNAL GENERATION LOGIC

**Entry Signals**:

```
STRONG_BUY Signal (Highest Conviction):
- momentum_score >= 85
- bonding_progress 80-95%
- safety_score >= 8
- volume_velocity > 1.0
→ Position size: MAX allowed

BUY Signal (Good Opportunity):
- momentum_score >= 75
- bonding_progress 70-95%
- safety_score >= 7
- volume_velocity > 0.5
→ Position size: 75% of MAX

NO_SIGNAL:
- momentum_score < 75
- OR bonding_progress outside 70-95%
- OR safety_score < 7
→ Don't trade
```

**Exit Signals**:

```
SELL Signal (Exit Immediately):
- token_migrated = true (migration detected)
- OR momentum_score drops below 50
- OR safety_score drops below 5
- OR stop-loss hit
- OR take-profit hit

HOLD Signal:
- Position open
- momentum_score still >= 60
- No migration detected
→ Keep position, update stop-loss
```

## RANKING SYSTEM

**Purpose**: Track top opportunities in real-time

**Implementation**:
- Maintain sorted list of tracked tokens by momentum score
- Update rankings every 30 seconds
- Keep top 20 tokens visible
- Emit events when new token enters top 10

```
Ranking Updates:
1. Calculate score for all tracked tokens
2. Sort by momentum_score DESC
3. Store top 20
4. Compare with previous rankings
5. Emit events for significant changes
```

## SIGNAL PERSISTENCE

**Store Every Signal Generated**:
- Token address
- Signal type (BUY, STRONG_BUY, SELL)
- Momentum score breakdown
- Timestamp
- Whether it was executed

**Benefits**:
- Historical analysis
- Backtesting validation
- Performance optimization
- Pattern recognition

## ADAPTIVE THRESHOLDS (Advanced)

**Future Enhancement**: Adjust thresholds based on market conditions

```
If market is hot (many tokens pumping):
    Increase BUY threshold from 75 to 80
    
If market is cold (few opportunities):
    Decrease BUY threshold from 75 to 70
    
Track:
- Average momentum scores across all tokens
- Success rate of signals
- Market volatility
```

## IMPLEMENTATION ARCHITECTURE

**Momentum Engine Class**:
```
MomentumEngine:
    - calculateVolumeScore(volumeMetrics)
    - calculateHolderScore(holderMetrics)
    - calculateLiquidityScore(liquidityMetrics)
    - calculateSocialScore(tokenData)
    - calculateSafetyScore(safetyMetrics)
    - calculateTotalScore(allMetrics)
    - generateSignal(score, metrics)
    - updateRankings()
    - getRankings()
```

**Signal Generator Class**:
```
SignalGenerator:
    - shouldBuy(score, metrics)
    - shouldSell(score, position, metrics)
    - determinePositionSize(score, signal_type)
    - logSignal(signal)
```

## TESTING STRATEGY

**Unit Tests**:
- Each scoring function independently
- Edge cases (missing data, extreme values)
- Threshold boundaries

**Integration Tests**:
- Full scoring pipeline
- Signal generation logic
- Ranking updates

**Historical Validation**:
- Use real token data
- Calculate what scores would have been
- Verify signals match actual outcomes

## VALIDATION CHECKLIST

Before Prompt 5:
- ✅ Scoring algorithm calculates correctly
- ✅ Signals generate based on thresholds
- ✅ Rankings update and sort properly
- ✅ Signals stored to database
- ✅ Edge cases handled
- ✅ Performance is acceptable (<50ms per token)

## SUCCESS CRITERIA

Ready for Prompt 5 when:
1. Momentum scores calculate accurately
2. Signal generation logic works
3. Rankings track top tokens
4. All scores persist to database
5. Logic handles missing/invalid data
6. Comprehensive logging shows decisions

## WHAT'S NEXT

**Prompt 5** will build the trade executor that takes these signals and actually executes transactions on Solana with Jito bundles and Jupiter routing.

## CRITICAL INSIGHTS

**Why This Scoring Works**:
- Multi-factor reduces false positives
- Bonding progress timing is critical (70-95% zone)
- Safety filters eliminate 90% of rugs
- Volume confirms real interest vs. manipulation

**Common Pitfalls to Avoid**:
- Don't ignore safety score (it's mandatory)
- Don't trade outside bonding progress zone
- Don't over-optimize on historical data
- Always leave room for iteration

**Remember**: This is a starting point. You'll refine thresholds based on backtesting and live performance.
