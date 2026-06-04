import { db } from '../db/connection.js';
import { now, json } from '../utils.js';
import { activeStrategy, strategyById, updateStrategyConfig } from '../db/settings.js';

/**
 * Called automatically by monitorPositions() whenever a dry-run position closes.
 * Records the trade in rolling window and auto-tunes strategy if needed.
 */
export function onPositionClosed(position) {
  const strat = strategyById(position.strategy_id);
  if (!strat) return;

  const pnl = Number(position.pnl_sol || 0);
  const exitReason = position.exit_reason;
  const isWin = pnl > 0;
  const windowMs = 4 * 3600 * 1000; // 4-hour rolling window

  // Record in rolling trade log
  db.prepare(`
    INSERT INTO learning_trade_log (position_id, strategy_id, symbol, pnl_sol, pnl_percent,
      exit_reason, tp_percent, sl_percent, entry_mcap, exit_mcap, closed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    position.id,
    strat.id,
    position.symbol,
    pnl,
    Number(position.pnl_percent || 0),
    exitReason,
    position.tp_percent,
    position.sl_percent,
    position.entry_mcap,
    position.exit_mcap,
    position.closed_at_ms || now()
  );

  // Auto-tune strategy every N closed trades
  const windowCutoff = now() - windowMs;
  const recentClosed = db.prepare(`
    SELECT * FROM learning_trade_log
    WHERE strategy_id = ? AND closed_at_ms >= ?
  `).all(strat.id, windowCutoff);

  if (recentClosed.length < 5) return; // Need at least 5 trades before adjusting

  const wins = recentClosed.filter(t => Number(t.pnl_sol) > 0);
  const winRate = wins.length / recentClosed.length;
  const totalPnl = recentClosed.reduce((s, t) => s + Number(t.pnl_sol || 0), 0);

  // Count exit reasons
  const slCount = recentClosed.filter(t => t.exit_reason === 'SL').length;
  const maxHoldCount = recentClosed.filter(t => t.exit_reason === 'MAX_HOLD').length;
  const trailingTpCount = recentClosed.filter(t => t.exit_reason === 'TRAILING_TP').length;
  const fastLossCount = recentClosed.filter(t => t.exit_reason === 'FAST_LOSS').length;

  let didUpdate = false;
  const newConfig = { ...strat };

  // === WIN ANALYSIS ===
  if (isWin) {
    const avgTpOnWins = wins.reduce((s, t) => s + Number(t.tp_percent || 0), 0) / wins.length;
    // If wins use 8-15% TP targets, that's the sweet spot — note it
    if (avgTpOnWins >= 5 && avgTpOnWins <= 15 && strat.tp_percent !== Math.round(avgTpOnWins)) {
      const newTp = Math.max(5, Math.min(15, Math.round(avgTpOnWins)));
      newConfig.tp_percent = newTp;
      didUpdate = true;
      console.log(`[learn] WIN insight: avg TP on wins=${avgTpOnWins.toFixed(1)}%, adjusting tp_percent to ${newTp}`);
    }
    if (trailingTpCount >= 2 && !strat.trailing_enabled) {
      newConfig.trailing_enabled = true;
      didUpdate = true;
      console.log(`[learn] WIN insight: trailing TP is working, enabling trailing`);
    }
  }

  // === LOSS ANALYSIS ===
  if (!isWin) {
    // SL losses: tighten SL if too many SL hits
    if (slCount >= 2) {
      const slLosses = recentClosed.filter(t => t.exit_reason === 'SL');
      const avgSlLoss = slLosses.reduce((s, t) => s + Number(t.pnl_sol || 0), 0) / slLosses.length;
      if (strat.sl_percent > -15) {
        newConfig.sl_percent = Math.max(-15, strat.sl_percent - 2);
        didUpdate = true;
        console.log(`[learn] SL losses (${slCount}x, avg=${avgSlLoss.toFixed(4)} SOL): tightening sl_percent to ${newConfig.sl_percent}`);
      }
    }
    // MAX_HOLD losses: reduce max_hold_ms drastically
    if (maxHoldCount >= 1 && strat.max_hold_ms > 600000) {
      newConfig.max_hold_ms = Math.min(strat.max_hold_ms, 600000);
      didUpdate = true;
      console.log(`[learn] MAX_HOLD loss detected: reducing max_hold_ms to ${newConfig.max_hold_ms / 60000}min`);
    }
    // High mcap entry losses: tighten mcap ceiling
    const highMcapLosses = recentClosed.filter(t =>
      t.exit_reason === 'SL' && Number(t.entry_mcap) > 80000
    );
    if (highMcapLosses.length >= 1 && strat.max_mcap_usd > 80000) {
      newConfig.max_mcap_usd = Math.max(50000, strat.max_mcap_usd - 20000);
      didUpdate = true;
      console.log(`[learn] High-mcap entry SL (${highMcapLosses.length}x): reducing max_mcap_usd to ${newConfig.max_mcap_usd}`);
    }
    // FAST_LOSS pattern: too many fast dumps → tighten SL further
    if (fastLossCount >= 2) {
      const newSl = Math.max(-6, strat.sl_percent + 1); // move SL closer to zero (less strict)
      newConfig.sl_percent = newSl;
      didUpdate = true;
      console.log(`[learn] FAST_LOSS pattern (${fastLossCount}x): adjusting sl_percent to ${newSl}`);
    }
  }

  // === OVERALL PERFORMANCE GATE ===
  // If overall PnL is negative and win rate below 40%, get more conservative
  if (winRate < 0.40 && totalPnl < 0) {
    if (strat.position_size_sol > 0.02) {
      newConfig.position_size_sol = Math.max(0.02, strat.position_size_sol - 0.01);
      didUpdate = true;
      console.log(`[learn] Poor WR (${(winRate*100).toFixed(0)}%) + neg PnL: reducing position_size to ${newConfig.position_size_sol}`);
    }
  }

  if (didUpdate) {
    updateStrategyConfig(strat.id, newConfig);
    console.log(`[learn] Strategy ${strat.id} auto-tuned from ${recentClosed.length} recent trades (WR=${(winRate*100).toFixed(0)}%, PnL=${totalPnl.toFixed(4)} SOL)`);
  }

  // === SEND LOSS ANALYSIS TELEGRAM ===
  if (!isWin && position.symbol) {
    const lossMsg = [
      `📉 <b>LOSS ANALYSIS</b>`,
      `Symbol: <b>${position.symbol}</b>`,
      `Entry mcap: <b>$${Number(position.entry_mcap || 0).toFixed(0)}</b>`,
      `Exit: <b>${exitReason}</b>`,
      `Hold: <b>${((position.closed_at_ms || now()) - position.opened_at_ms) / 1000}s</b>`,
      `PnL: <b>${Number(position.pnl_percent || 0).toFixed(2)}%</b>`,
      `Entry hour UTC: <b>${new Date(position.opened_at_ms).getUTCHours()}</b>`,
      ``,
      `💡 Auto-tuned: ${didUpdate ? 'YES ✅' : 'no (within tolerance)'}`,
    ].join('\n');
    sendTelegram(lossMsg).catch(() => {});
  }
}

export function initLearningTables() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS learning_trade_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER,
      strategy_id TEXT,
      symbol TEXT,
      pnl_sol REAL,
      pnl_percent REAL,
      exit_reason TEXT,
      tp_percent REAL,
      sl_percent REAL,
      entry_mcap REAL,
      exit_mcap REAL,
      closed_at_ms INTEGER
    )
  `).run();

  // Create index for fast recent-window queries
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_learning_trade_log_strategy_closed
    ON learning_trade_log(strategy_id, closed_at_ms)
  `).run();
}