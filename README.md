# Charon2

**Charon2** is a heavily enhanced fork of [Charon](https://github.com/yunus-0x/charon) by [yunus-0x](https://github.com/yunus-0x), a Telegram trading agent for Pump.fun tokens on Solana.

This fork adds **production-grade observability, risk management, auto-tuning, and safety guards** — built for sustained live trading with real capital.

---

## ⚠️ Disclaimer

> **This codebase is on testing-period. The original Charon developer doesn't guarantee any result.
> Charon2 modifications are experimental. Use at your own risk.**

---

## What is Charon2?

Charon2 is a **Solana meme-coin trading agent** that:
1. Polls a signal server for new Pump.fun token launches
2. Screens candidates with strategy gates + LLM decision-making
3. Executes via Jupiter Ultra — dry-run, confirm via Telegram, or live
4. Monitors open positions for TP/SL/trailing/max-hold rules

**Charon2 specifically adds:** risk engine, auto-tuning, observability, blacklist management, fast-loss early exits, UTC death zone filter, safety cooldowns, and production monitoring tools.

---

## 📁 Project Structure

```
charon/
├── index.js              # Entry point with safe console + graceful shutdown
├── package.json
├── start.sh              # PM2 startup helper
├── dashboard2.py         # Streamlit PnL dashboard (Python)
├── perf_chart.html       # Browser-based PnL visualizer
├── test/                 # Unit tests (llm, risk, telegram, utils)
├── scripts/
│   ├── pnl_chart.py      # CLI PnL chart generator
│   └── watchdog.sh       # Process watchdog script
└── src/
    ├── observability/
    │   └── logger.js     # Structured JSON logs, rotation, secret redaction
    ├── risk/
    │   ├── engine.js     # Risk evaluation engine
    │   ├── guards.js     # Trade risk guards + approval gate
    │   ├── blacklist.js  # Token blacklist manager
    │   └── sizing.js     # Position sizing utilities
    ├── security/
    │   └── telegram.js  # Telegram input validation
    ├── learning/
    │   ├── autoTune.js   # Auto-adjust TP/SL/size from trade outcomes
    │   ├── commands.js
    │   ├── lessons.js
    │   ├── report.js
    │   └── summary.js
    ├── telegram/          # Bot, commands, callbacks, menus, format, send, input
    ├── enrichment/        # gmgn, jupiter, twitter, wallets
    ├── signals/          # axiomSource, feeClaim, graduated, priceMonitor, serverClient, trending
    └── [core files]      # app, config, utils, liveExecutor, positions,
                          # orchestrator, candidateBuilder, llm, connection, etc.
```

---

## Original vs Charon2 — What Was Added/Changed

### 🆕 NEW Modules (not in original)

| Module | File | Description |
|---|---|---|
| **Observability** | `src/observability/logger.js` | JSON structured logs with log rotation, secret redaction, safe console patching, global error handlers |
| **Risk Engine** | `src/risk/engine.js` | Configurable risk limits (daily loss, max trades, MAX_BUY_SOL), tracks today's PnL/stats, evaluates buy risk, logs risk_events |
| **Trade Guards** | `src/risk/guards.js` | Validates trading mode, emergency stop, cooldown periods, position size, wallet reserve, token blacklist, UTC death zone |
| **Token Blacklist** | `src/risk/blacklist.js` | Manual/auto token blocking — persisted in SQLite |
| **Position Sizing** | `src/risk/sizing.js` | `clampBuySizeSol()` + `solToLamports()` utility |
| **Telegram Security** | `src/security/telegram.js` | Validates `chat_id`, topic thread, and callback data format |
| **Auto-Tune** | `src/learning/autoTune.js` | Analyzes recent trades → auto-adjusts TP target, trailing, SL, max_hold, max_mcap, position size |

---

### 🔄 MODIFIED Core Files (compared to original)

| File | Key Changes |
|---|---|
| **`src/config.js`** | Added `boolEnv()`, `numEnv()` helpers, path traversal security (`safeDbPath()`), trading mode system (`dry_run/confirm/live`), risk limits (`MAX_BUY_SOL`, `DAILY_MAX_LOSS_SOL`, `MAX_TRADES_PER_DAY`), cooldowns (`TOKEN_COOLDOWN_MS`, `LOSS_COOLDOWN_MS`), safety flags (`EMERGENCY_STOP`, `REQUIRE_CONFIRMATION_FOR_LIVE`, `ALLOW_LIVE_TRADING`), Jupiter slippage clamped 1–1000, LLM timeout clamped 5–120s |
| **`src/utils.js`** | Added `redactSecrets()`, `retryWithBackoff()`, `createCircuitBreaker()` |
| **`src/app.js`** | Added `stopCharon()` graceful shutdown, `every()` interval helper, `startupSummary()`, initLearningTables, safe logging |
| **`src/liveExecutor.js`** | `retryWithBackoff()` integrated into Jupiter API calls (order + execute) |
| **`src/execution/positions.js`** | FAST_LOSS exit (-5% within 45s → immediate exit), 5-min cooling after loss, smart MAX_HOLD (profitable→breakeven+60s, loss→exit), partial TP on TP hit, position age skip (<30s), Jupiter PnL tracking, `onPositionClosed()` hook |
| **`src/pipeline/orchestrator.js`** | Risk engine evaluation before execution, effective min confidence = max(strat, 50), default TP→30%, SL→-20%, max_open_positions→10 |
| **`src/pipeline/candidateBuilder.js`** | UTC death zone filter (13:00–18:00 UTC blocks entries due to observed -12% avg PnL) |
| **`src/pipeline/llm.js`** | `validateLlmDecision()` wraps result, default TP→30%, SL→-20%, `SKIP` action added, prompt emphasizes asymmetric opportunities |
| **`src/db/connection.js`** | New tables: `decisions`, `positions`, `intents`, `risk_events`, `pending_approvals`, `blacklist`, `daily_stats`, `lessons`, `tool_errors`. New defaults: `max_open_positions: 10`, `dry_run_buy_sol: 0.01`, `default_tp_percent: 30`, `default_sl_percent: -20` |
| **`index.js`** | `installSafeConsole()`, `unhandledRejection` + `uncaughtException` handlers, SIGINT/SIGTERM graceful shutdown, `startupSummary()` |

---

### 📊 Default Value Changes

| Setting | Original | Charon2 |
|---|---|---|
| `max_open_positions` | 3 | **10** |
| `dry_run_buy_sol` | 0.1 | **0.01** |
| `default_tp_percent` | 50 | **30** |
| `default_sl_percent` | -25 | **-20** |
| `llm_timeout_ms` | 60,000 | **30,000** |
| User-Agent | Various | `Charon/1.0` |

---

### 🚀 New Features

1. **Observability & Structured Logging** — JSON logs split into `app.log`, `error.log`, `trades.log`. Auto-rotation at `LOG_MAX_BYTES`. Secret redaction on all writes.

2. **Risk Engine** — Daily PnL tracking, loss limits, trade caps, MAX_BUY_SOL clamp. Every risk decision logged to SQLite.

3. **UTC Death Zone** — UTC 13:00–18:00 blocked for new entries (observed -12% avg PnL during afternoon selling pressure).

4. **FAST_LOSS Exit** — -5% loss within 45 seconds triggers immediate position exit (micro-cap dump escape).

5. **Smart MAX_HOLD** — On position expiry: if profitable → SL→breakeven + 60s extension; if at loss → exit immediately.

6. **Auto-Tune Learning** — After each position close: analyzes 4-hour window → adjusts TP target, trailing, SL, max_hold, max_mcap, position size.

7. **Trading Modes** — `dry_run` / `confirm` / `live` with `REQUIRE_CONFIRMATION_FOR_LIVE` flag and Telegram approval gate.

8. **Emergency Stop** — `EMERGENCY_STOP=1` halts all trading instantly.

9. **Token Cooldowns** — After losing trade, 5-minute cooldown before same token can be re-entered.

10. **Partial Take-Profit** — Strategy-based partial sells when TP% is hit.

11. **Circuit Breaker + Retry** — Exponential backoff retry on Jupiter API failures.

12. **Blacklist Management** — `/blacklist add <mint>`, `/blacklist remove <mint>`, `/blacklist list`

---

## Setup

```bash
git clone git@github.com:kiozhu/charon.git
cd charon
npm install
cp .env.example .env
# Edit .env with your credentials
npm start
```

For PM2:
```bash
pm2 start index.js --name charon2
pm2 save
```

---

## Telegram Commands

```
/menu             # Interactive menu
/strategy         # View/change strategy
/stratset <s> <k> <v>  # Set strategy param
/positions        # List open positions
/candidate <mint> # Lookup token
/filters          # Show current filters
/pnl              # Show PnL summary
/learn <window>   # Run learning analysis
/lessons          # Show learned lessons
/blacklist add <mint>   # Add to blacklist
/blacklist remove <mint> # Remove from blacklist
/blacklist list        # Show blacklisted tokens
/walletadd <label> <address>
/wallets          # List tracked wallets
```

---

## Differences from Original Charon by yunus-0x

| Aspect | Original (yunus) | Charon2 |
|---|---|---|
| **Logging** | console.log | Structured JSON files, rotation, secret redaction |
| **Risk Management** | Basic config | Full risk engine + guards + daily limits |
| **Position Exit** | TP/SL/max_hold | FAST_LOSS + smart MAX_HOLD + partial TP |
| **Learning** | lessons.js only | autoTune.js + lessons + report + summary |
| **Safety** | None | Emergency stop, cooldowns, death zone filter |
| **Blacklist** | None | SQLite-backed token blacklist |
| **Observability** | None | Logger + error handlers + safe console |
| **Resilience** | Basic retries | Circuit breaker + exponential backoff |
| **Trading Modes** | dry_run/confirm/live | Same + approval gate + safety flags |
| **LLM Timeout** | 60s default | 30s default, clamped 5–120s |

---

## Credit

- **Original:** [yunus-0x/charon](https://github.com/yunus-0x/charon) — base trading agent
- **Fork & Enhancements:** MUFASA — risk engine, auto-tune, observability, safety guards, smart position management

---

## License

MIT — same as original Charon project.