# PROMPT 7: Main Orchestration & Production Deployment

## OBJECTIVE
Wire all components together into a cohesive, production-ready trading bot that runs 24/7, handles errors gracefully, and provides real-time monitoring.

## THE BIG PICTURE

You've built 6 major systems:
1. ✅ Infrastructure (DB, logging, config)
2. ✅ Data Streaming (RPC, gRPC, Pump.fun monitor)
3. ✅ Data Analyzers (Volume, Holders, Liquidity, Safety)
4. ✅ Momentum Engine (Scoring, signals)
5. ✅ Trade Executor (Buying, selling, risk management)
6. ✅ Backtesting (Historical validation)

Now: **Make them work together seamlessly**

## MAIN CONTROL FLOW

```
Startup Sequence:
1. Load environment & validate
2. Initialize wallet manager
3. Connect RPC service
4. Connect gRPC service  
5. Initialize database connection
6. Start all analyzers
7. Initialize momentum engine
8. Initialize trade executor
9. Start Pump.fun monitor
10. Begin main event loop

Main Event Loop (runs continuously):
1. Monitor for new token launches
2. Track metrics for all active tokens
3. Calculate momentum scores
4. Generate signals
5. Execute trades on valid signals
6. Monitor open positions
7. Update database
8. Check risk limits
9. Log status

Shutdown Sequence:
1. Stop accepting new signals
2. Close all open positions (or alert)
3. Stop monitors
4. Disconnect services
5. Close database connections
6. Save state
7. Final logs
```

## EVENT-DRIVEN ARCHITECTURE

**Event Flow**:
```
Pump.fun Monitor emits → token:launched
    ↓
All Analyzers → Start tracking token
    ↓
Every 30s → Update metrics
    ↓
Momentum Engine → Calculate score
    ↓
Signal Generator → Check thresholds
    ↓
If BUY signal → Trade Executor → Execute
    ↓
Position Manager → Track position
    ↓
Every 5s → Check exit conditions
    ↓
If EXIT trigger → Trade Executor → Sell
    ↓
Log to Database → Update analytics
```

**Event Listeners to Set Up**:
```
Pump.fun Monitor:
- token:launched → trackNewToken()
- bonding:progress → updateBondingMetrics()
- token:migration → emergencyExit()

Momentum Engine:
- signal:generated → evaluateSignal()
- ranking:updated → logTopTokens()

Position Manager:
- position:opened → startMonitoring()
- stop_loss:hit → executeSell()
- take_profit:hit → executePartialSell()
- position:closed → recordTrade()

System:
- SIGINT (Ctrl+C) → gracefulShutdown()
- SIGTERM → gracefulShutdown()
- uncaughtException → emergencyShutdown()
```

## STATE MANAGEMENT

**Track Bot State**:
```
BotState {
  status: 'initializing' | 'running' | 'paused' | 'shutting_down' | 'error'
  start_time: timestamp
  tracked_tokens_count: number
  open_positions_count: number
  signals_generated_today: number
  trades_executed_today: number
  daily_pnl: number
  capital_deployed: number
  capital_available: number
  last_trade_time: timestamp
  errors_count: number
}

Update state in real-time
Log state changes
Expose via API or dashboard
```

**Persistence**:
```
Save critical state to database:
- Active tracked tokens
- Open positions
- Risk limit counters
- Daily P&L

On restart:
- Reload open positions
- Resume monitoring
- Validate state consistency
```

## ERROR HANDLING STRATEGY

**Levels of Failures**:

**Level 1 - Recoverable Errors**:
```
Examples:
- Single RPC call fails
- Transaction temporarily rejected
- Data parsing error for one token

Strategy:
- Log error
- Retry with backoff
- Continue operation
- Track error rate
```

**Level 2 - Service Degradation**:
```
Examples:
- RPC disconnected (reconnecting)
- gRPC stream dropped (reconnecting)
- Database query timeout

Strategy:
- Pause trading signals
- Keep monitoring active
- Alert operator
- Auto-recovery when service restored
```

**Level 3 - Critical Failures**:
```
Examples:
- All RPCs unavailable
- gRPC won't reconnect
- Database unreachable
- Wallet compromised

Strategy:
- Emergency: Close all positions
- Stop all trading
- Save state
- Alert operator URGENTLY
- Shutdown gracefully
```

**Error Recovery**:
```
For each service:
- Implement health check
- Auto-reconnect logic
- Circuit breaker pattern
- Fallback mechanisms

Example: RPC Failover
Primary RPC fails →
  Try backup RPC #1 →
    Try backup RPC #2 →
      If all fail → Pause trading
```

## MONITORING & OBSERVABILITY

**Real-Time Dashboard** (Terminal UI or Web):
```
┌─ Solana Momentum Bot ─────────────────────┐
│ Status: RUNNING                           │
│ Uptime: 2h 34m                           │
│ Capital: $10,000 (98% available)         │
├───────────────────────────────────────────┤
│ Today's Performance:                      │
│   Signals: 12                             │
│   Trades: 3                               │
│   Win Rate: 66.67%                        │
│   P&L: +$234.50 (+2.35%)                 │
├───────────────────────────────────────────┤
│ Open Positions (2):                       │
│   TOKEN1: +45% ($0.23 → $0.33)          │
│   TOKEN2: -12% ($0.50 → $0.44)          │
├───────────────────────────────────────────┤
│ Top Momentum Tokens:                      │
│   1. TOKEN3: Score 87  ⚡ BUY            │
│   2. TOKEN4: Score 82  ⚡ BUY            │
│   3. TOKEN5: Score 76  ⚡ BUY            │
├───────────────────────────────────────────┤
│ System Health:                            │
│   RPC: ✅ Healthy                         │
│   gRPC: ✅ Streaming                      │
│   Database: ✅ Connected                  │
│   Tracked Tokens: 47                      │
└───────────────────────────────────────────┘
```

**Logging Strategy**:
```
Log Levels:
- DEBUG: Internal state, calculations
- INFO: Signals, trades, positions
- WARN: Retries, degraded service
- ERROR: Failures, exceptions

Separate Logs:
- trades.log (all trading activity)
- signals.log (all signals generated)
- errors.log (all errors/warnings)
- system.log (startup/shutdown/health)

Retention:
- Trade logs: 90 days
- Error logs: 30 days
- System logs: 14 days
```

**Alerts** (Optional but Recommended):
```
Telegram Bot Integration:
- Send alert on trade execution
- Send alert on position closed
- Send alert on errors
- Send daily performance summary

Critical Alerts:
- Daily loss limit hit
- Wallet balance low
- Service disconnection
- Unhandled exception
```

## CONFIGURATION MANAGEMENT

**Runtime Configuration**:
```
Allow dynamic config changes without restart:
- Pause/Resume trading
- Adjust position size limits
- Change momentum thresholds
- Blacklist tokens
- Update risk parameters

Implementation:
- Config file that's watched
- Database config table
- Admin API endpoints
- Never require restart for config changes
```

**Testing Modes**:
```
Paper Trading Mode:
- ENABLE_PAPER_TRADING=true
- Simulate all trades
- Log what would happen
- Track simulated P&L
- Zero risk testing

Dry Run Mode:
- Generate signals
- Don't execute trades
- Validate logic
- Test monitoring

Production Mode:
- ENABLE_PAPER_TRADING=false
- Real trades
- Real money
- Maximum caution
```

## PERFORMANCE OPTIMIZATION

**Critical Paths to Optimize**:
```
1. Metric Calculations (every 30s):
   - Batch database queries
   - Cache frequently accessed data
   - Use efficient data structures

2. Signal Generation (every 30s):
   - Pre-compute scoring components
   - Only recalculate changed values
   - Use memoization

3. Position Monitoring (every 5s):
   - Parallel checks for all positions
   - Batch price fetches
   - Optimize database updates

4. Transaction Execution (<1s):
   - Pre-build transaction templates
   - Cache Jupiter quotes (15s)
   - Minimize RPC calls
```

**Resource Management**:
```
Monitor:
- Memory usage (track leaks)
- CPU usage (optimize hot paths)
- Network bandwidth
- Database connections
- Open file handles

Set limits:
- Max memory threshold
- Max concurrent operations
- Max database pool size
- Connection timeouts
```

## DEPLOYMENT CHECKLIST

**Pre-Deployment**:
- ✅ All tests pass
- ✅ Backtesting shows positive results
- ✅ Paper trading validated
- ✅ Error handling tested
- ✅ Logging verified
- ✅ Database schema deployed
- ✅ Environment variables configured
- ✅ Wallets funded (testnet first!)
- ✅ RPC/gRPC credentials valid
- ✅ Kill switch tested

**Initial Deployment**:
```
Day 1: Testnet
- Run on Solana testnet/devnet
- Verify all services work
- Test edge cases
- No real money risk

Day 2-7: Mainnet Paper Trading
- Connect to mainnet
- Paper trade for 1 week
- Validate signals quality
- Check performance matches backtest

Day 8+: Live with Tiny Sizes
- Enable real trading
- Use 10% of target position sizes
- Monitor every trade manually
- Build confidence slowly

Week 2+: Gradual Scale Up
- Increase position sizes 25% per week
- Monitor performance closely
- Stop if anything unusual
- Never skip validation
```

**Ongoing Operations**:
```
Daily:
- Check performance dashboard
- Review trade logs
- Verify system health
- Check error logs

Weekly:
- Analyze win rate trends
- Review parameter effectiveness
- Check for market regime changes
- Optimize thresholds if needed

Monthly:
- Full performance review
- Backtest on recent data
- Update strategy if needed
- Audit security
```

## PRODUCTION BEST PRACTICES

**Security**:
- Use environment variables, never hardcode
- Rotate API keys regularly
- Monitor wallet for unauthorized access
- Use separate wallets for different strategies
- Never run as root

**Reliability**:
- Use process manager (PM2, systemd)
- Auto-restart on crashes
- Health check endpoints
- Redundant RPC providers
- Database backups

**Monitoring**:
- Set up uptime monitoring
- Track key metrics
- Alert on anomalies
- Keep audit trail
- Regular performance reviews

## SUCCESS CRITERIA

Bot is production-ready when:
1. ✅ Runs 24/7 without manual intervention
2. ✅ Handles all error scenarios gracefully
3. ✅ Monitoring provides full visibility
4. ✅ Performance matches backtest expectations
5. ✅ Risk limits prevent blowups
6. ✅ Logging enables debugging
7. ✅ Can be deployed/redeployed easily

## FINAL VALIDATION

Run through this checklist:
- [ ] Bot starts successfully
- [ ] All services connect
- [ ] Tokens are detected and tracked
- [ ] Metrics calculate correctly
- [ ] Signals generate appropriately
- [ ] Trades execute successfully (paper mode)
- [ ] Positions track properly
- [ ] Stop-loss/take-profit work
- [ ] Risk limits enforced
- [ ] Graceful shutdown works
- [ ] Recovery from crash works
- [ ] Logs are comprehensive
- [ ] Dashboard shows status
- [ ] Paper trading P&L is positive

## YOU'RE DONE!

Congratulations! You've built a complete, production-grade Solana momentum trading bot.

**Next Steps**:
1. Test extensively on testnet
2. Paper trade on mainnet
3. Start with small real positions
4. Monitor and optimize continuously
5. Scale gradually based on performance

**Remember**:
- Start small
- Monitor everything
- Trust but verify
- Never risk more than you can afford to lose
- Markets change - adapt or die

Good luck, and trade responsibly! 🚀
