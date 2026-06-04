import { db } from '../db/connection.js';
import { now, json } from '../utils.js';
import { setting, numSetting, boolSetting, activeStrategy } from '../db/settings.js';
import { openPositionCount, tradingMode } from '../db/positions.js';
import { liveWalletBalanceLamports } from '../liveExecutor.js';
import { LIVE_MIN_SOL_RESERVE, MAX_BUY_SOL, DAILY_MAX_LOSS_SOL, MAX_TRADES_PER_DAY, TOKEN_COOLDOWN_MS, LOSS_COOLDOWN_MS, EMERGENCY_STOP, REQUIRE_CONFIRMATION_FOR_LIVE, ALLOW_LIVE_TRADING, JUPITER_SLIPPAGE_BPS } from '../config.js';
import { isBlacklisted } from './blacklist.js';
import { evaluateTradeRisk } from './guards.js';

export function riskConfigFromEnvAndSettings() {
  return {
    TRADING_MODE: tradingMode(),
    MAX_OPEN_POSITIONS: numSetting('max_open_positions', Number(process.env.MAX_OPEN_POSITIONS || 10)),
    MAX_BUY_SOL,
    DAILY_MAX_LOSS_SOL,
    MAX_TRADES_PER_DAY,
    TOKEN_COOLDOWN_MS,
    LOSS_COOLDOWN_MS,
    EMERGENCY_STOP: boolSetting('emergency_stop', EMERGENCY_STOP),
    REQUIRE_CONFIRMATION_FOR_LIVE,
    ALLOW_LIVE_TRADING,
    LIVE_MIN_SOL_RESERVE,
    JUPITER_SLIPPAGE_BPS,
  };
}

export function todayStats() {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT * FROM daily_stats WHERE day = ?').get(day);
  const trades = db.prepare("SELECT COUNT(*) AS count FROM dry_run_trades WHERE side = 'buy' AND at_ms >= ?").get(new Date(`${day}T00:00:00.000Z`).getTime()).count;
  const pnl = db.prepare("SELECT COALESCE(SUM(pnl_sol), 0) AS pnl FROM dry_run_positions WHERE status = 'closed' AND closed_at_ms >= ?").get(new Date(`${day}T00:00:00.000Z`).getTime()).pnl;
  return { day, todayTrades: row?.trades ?? trades, todayPnlSol: row?.pnl_sol ?? pnl };
}

function latestLossAt() {
  const row = db.prepare("SELECT closed_at_ms FROM dry_run_positions WHERE status = 'closed' AND pnl_sol < 0 ORDER BY closed_at_ms DESC LIMIT 1").get();
  return row?.closed_at_ms || 0;
}

function hasRecentTokenActivity(mint, cooldownMs) {
  if (!mint || cooldownMs <= 0) return false;
  const cutoff = now() - cooldownMs;
  const row = db.prepare(`
    SELECT id FROM dry_run_positions
    WHERE mint = ? AND (status = 'open' OR opened_at_ms >= ? OR COALESCE(closed_at_ms, 0) >= ?)
    LIMIT 1
  `).get(mint, cutoff, cutoff);
  return Boolean(row);
}

export async function evaluateBuyRisk({ candidate, decision = {}, mode = tradingMode(), approved = false, side = 'buy' } = {}) {
  const cfg = riskConfigFromEnvAndSettings();
  const strat = activeStrategy();
  const mint = candidate?.token?.mint || candidate?.mint;
  const stats = todayStats();
  let walletBalanceSol = 0;
  if (mode === 'live') {
    try { walletBalanceSol = Number(await liveWalletBalanceLamports()) / 1_000_000_000; } catch { walletBalanceSol = 0; }
  }
  const state = {
    openPositions: openPositionCount(),
    todayTrades: Number(stats.todayTrades || 0),
    todayPnlSol: Number(stats.todayPnlSol || 0),
    duplicateToken: hasRecentTokenActivity(mint, Number(cfg.TOKEN_COOLDOWN_MS || 0)),
    tokenCooldownActive: hasRecentTokenActivity(mint, Number(cfg.TOKEN_COOLDOWN_MS || 0)),
    lossCooldownActive: now() - latestLossAt() < Number(cfg.LOSS_COOLDOWN_MS || 0),
    blacklisted: isBlacklisted(mint),
    walletBalanceSol,
  };
  const sizeSol = Number(decision.suggestedSizeSol ?? decision.suggested_size_sol ?? strat.position_size_sol ?? numSetting('dry_run_buy_sol', 0.1));
  const result = evaluateTradeRisk({ config: cfg, state, candidate, mode, approved, side, sizeSol });
  db.prepare(`
    INSERT INTO risk_events (mint, created_at_ms, side, mode, ok, risk_score, blocks_json, warnings_json, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mint || null, now(), side, mode, result.ok ? 1 : 0, result.riskScore, json(result.blocks), json(result.warnings), json({ cfg, state, result }));
  return result;
}

export function riskSummaryText() {
  const cfg = riskConfigFromEnvAndSettings();
  const stats = todayStats();
  return [
    '🛡️ <b>Risk</b>',
    `Mode: <b>${cfg.TRADING_MODE}</b>`,
    `ALLOW_LIVE_TRADING: <b>${cfg.ALLOW_LIVE_TRADING}</b>`,
    `REQUIRE_CONFIRMATION_FOR_LIVE: <b>${cfg.REQUIRE_CONFIRMATION_FOR_LIVE}</b>`,
    `EMERGENCY_STOP: <b>${cfg.EMERGENCY_STOP}</b>`,
    `MAX_BUY_SOL: <b>${cfg.MAX_BUY_SOL}</b>`,
    `DAILY_MAX_LOSS_SOL: <b>${cfg.DAILY_MAX_LOSS_SOL}</b>`,
    `MAX_TRADES_PER_DAY: <b>${cfg.MAX_TRADES_PER_DAY}</b>`,
    `Open positions: <b>${openPositionCount()}/${cfg.MAX_OPEN_POSITIONS}</b>`,
    `Today trades: <b>${stats.todayTrades}</b>`,
    `Today PnL: <b>${Number(stats.todayPnlSol || 0).toFixed(4)} SOL</b>`,
  ].join('\n');
}
