# PROMPT 2: RPC & Data Streaming Setup

## OBJECTIVE
Build the real-time data infrastructure that connects to Solana and streams Pump.fun events. This is the sensory system of your bot - everything else depends on getting clean, fast data.

## WHY THIS MATTERS
On Solana, speed = profit. If your bot sees events 500ms late, you've already lost. Public RPCs are shared by thousands of bots. Premium RPCs + gRPC streaming give you the edge.

## THREE CORE COMPONENTS

### 1. RPC CONNECTION MANAGER

**Purpose**: Reliable connection to Solana blockchain with retry logic

**Requirements**:
- Manage both HTTP and WebSocket connections
- Implement exponential backoff retry logic (3 attempts default)
- Connection health monitoring
- Handle rate limits gracefully
- Support configurable commitment levels

**Key Methods Needed**:
- `testConnection()` - Verify RPC is alive
- `getAccountInfo(pubkey)` - Fetch account data with retries
- `getMultipleAccounts(pubkeys[])` - Batch account fetching
- `getLatestBlockhash()` - For transaction building
- `getTransaction(signature)` - Transaction details
- `getBalance(pubkey)` - SOL and token balances
- `onAccountChange(pubkey, callback)` - Subscribe to account updates
- `getCurrentSlot()` - Current blockchain state

**Error Handling**:
- Throw RPCError with original cause
- Log all retry attempts
- Fail fast after max retries
- Track connection health status

### 2. YELLOWSTONE gRPC SERVICE

**Purpose**: Real-time streaming of on-chain events (faster than WebSocket)

**How gRPC Works**:
- Subscribe to specific program accounts or transactions
- Receive data as events happen (sub-second latency)
- More reliable than WebSocket subscriptions
- Can filter by program ID, account owner, etc.

**Requirements**:
- Initialize Yellowstone gRPC client with endpoint + auth token
- Build subscription requests with filters
- Handle streaming data events
- Implement automatic reconnection logic (max 10 attempts)
- Emit events for different data types (account, transaction, slot)

**Subscription Strategy**:
```
Subscribe to:
- All Pump.fun program account updates
- All transactions involving Pump.fun program
- Filter out failed transactions
- Use 'confirmed' commitment level
```

**Event Handling**:
- Parse incoming data stream
- Emit typed events (account, transaction, slot, block)
- Handle disconnects and auto-reconnect
- Track reconnection attempts

### 3. PUMP.FUN MONITOR

**Purpose**: Listen to gRPC stream and detect Pump.fun token events

**Critical Events to Detect**:

**A) Token Launch**:
- New bonding curve account created
- Extract: token address, bonding curve address
- Emit: `token:launched` event

**B) Bonding Progress**:
- Bonding curve state changes
- Calculate completion percentage (0-100%)
- Detect when curve reaches 70-95% (entry zone)
- Emit: `bonding:progress` event

**C) Migration to Raydium/PumpSwap**:
- Watch for "migrate" instruction
- Migration account: `39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg`
- Extract: token address, new liquidity pool address
- Emit: `token:migration` event (EXIT SIGNAL!)

**Architecture Pattern**:
```
gRPC Stream → Parse Event → Identify Event Type → Emit Typed Event
                                ↓
                     Track in memory/database
```

**Data Parsing Challenge**:
- Pump.fun account data is binary (Buffer)
- Need to understand account structure to parse
- May need Pump.fun IDL (Interface Definition Language)
- For now: detect events by transaction logs and instruction names

**Event Emitter Design**:
```typescript
monitor.on('token:launched', (event) => {
  // New token detected
  // Start tracking in analyzers
});

monitor.on('bonding:progress', (event) => {
  // Bonding curve updated
  // Check if in entry zone (70-95%)
});

monitor.on('token:migration', (event) => {
  // MIGRATION HAPPENING
  // Execute exit strategy immediately!
});
```

## IMPLEMENTATION APPROACH

**Step 1**: Build RPC Service
- Create class with connection management
- Implement retry logic
- Test with known Solana addresses
- Verify WebSocket subscriptions work

**Step 2**: Build gRPC Service
- Initialize Yellowstone client
- Create subscription request builder
- Handle stream events
- Implement reconnection logic
- Test that data flows

**Step 3**: Build Pump.fun Monitor
- Subscribe to Pump.fun program via gRPC
- Parse account updates and transactions
- Detect the 3 critical events
- Emit events for other components
- Track tokens in memory

**Step 4**: Wire Together
- Initialize all services in main index.ts
- Set up event listeners
- Test end-to-end data flow
- Verify graceful shutdown

## TESTING STRATEGY

**RPC Service Tests**:
- Can connect to RPC
- Can fetch account data
- Retries work on failures
- WebSocket subscriptions fire

**gRPC Service Tests**:
- Establishes connection
- Receives streaming data
- Reconnects on disconnect
- Events emit properly

**Pump.fun Monitor Tests**:
- Detects new token launches
- Tracks bonding progress
- Detects migrations
- Memory tracking works

## CRITICAL CONSIDERATIONS

**Performance**:
- gRPC is faster than WebSocket - use it!
- Keep parsing logic efficient
- Don't block the event loop
- Use async/await properly

**Reliability**:
- Always reconnect on disconnect
- Never crash on bad data
- Log everything important
- Handle edge cases (malformed data, etc.)

**Security**:
- Never log private keys (already handled in Prompt 1)
- Validate all incoming data
- Sanitize errors before logging

## VALIDATION CHECKLIST

Before Prompt 3:
- ✅ RPC service connects and fetches data
- ✅ gRPC service streams events
- ✅ Pump.fun monitor detects token launches
- ✅ Events emit correctly
- ✅ Reconnection logic works
- ✅ No memory leaks
- ✅ Logs show clear event flow

## SUCCESS CRITERIA

You're ready for Prompt 3 when:
1. Real-time event stream is flowing
2. Token launches are detected
3. Bonding progress tracked
4. Migration events captured
5. All services shutdown gracefully
6. Comprehensive logging shows what's happening

## WHAT'S NEXT

**Prompt 3** will build the analyzers that calculate momentum metrics from this streaming data (volume, holders, liquidity, safety).

## IMPORTANT NOTES

- The gRPC endpoint and token come from your provider (Helius, Triton, etc.)
- Some parsing logic will be placeholders until you get Pump.fun account structure
- Focus on getting the data pipeline working - parsing can be refined later
- Test on testnet first if possible!
