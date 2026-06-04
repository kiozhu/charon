import { bot } from './bot.js';
import { TELEGRAM_CHAT_ID, DB_PATH, ENABLE_LLM, GMGN_ENABLED, ALLOW_LIVE_TRADING, REQUIRE_CONFIRMATION_FOR_LIVE } from '../config.js';
import { now, json } from '../utils.js';
import { escapeHtml, fmtPct } from '../format.js';
import { db } from '../db/connection.js';
import { numSetting, boolSetting, setSetting, activeStrategy, setActiveStrategy, strategyById, updateStrategyConfig } from '../db/settings.js';
import { candidateById, latestCandidateByMint, updateCandidateStatus } from '../db/candidates.js';
import { storeDecision, logDecisionEvent } from '../db/decisions.js';
import {
  menuKeyboard,
  filtersText,
  filtersKeyboard,
  agentText,
  agentKeyboard,
  navKeyboard,
  mainMenuText,
  walletsText,
  positionsText,
  candidateButtons,
  positionButtons,
  strategyMenuText,
  strategyKeyboard,
} from './menus.js';
import { sendTelegram, sendBatch, sendPositionOpen, sendPnlChart } from './send.js';
import { candidateSummary, formatPosition } from './format.js';
import { refreshPosition } from '../execution/positions.js';
import { executeLiveSell } from '../execution/router.js';
import { tradingMode, openPositionCount } from '../db/positions.js';
import { handleCallback, editMenuMessage } from './callbacks.js';
import { consumeNumericFilterInput } from './input.js';
import { runLearning, sendLessons } from '../learning/commands.js';
import { fetchWalletPnl } from '../enrichment/wallets.js';
import { validateTelegramUser } from '../security/telegram.js';
import { riskSummaryText } from '../risk/engine.js';
import { addToBlacklist, removeFromBlacklist, listBlacklist } from '../risk/blacklist.js';
import { executeConfirmedIntent, rejectIntent } from '../execution/router.js';
import { getLastError } from '../observability/logger.js';

// /n glitch state: stores last user message per chatId
const lastUserMsg = {};

export async function handleMessage(msg) {
  if (!validateTelegramUser(msg)) return;
  const text = (msg.text || '').trim();
  const chatId = msg.chat.id;

  // Store non-command user messages for /n
  if (!text.startsWith('/')) {
    lastUserMsg[chatId] = { text, msg_id: msg.message_id };
    return;
  }

  if (await consumeNumericFilterInput(chatId, text, msg.message_id)) return;
  if (text.startsWith('/start')) return bot.sendMessage(chatId, helpText(), { parse_mode: 'HTML', disable_web_page_preview: true });
  if (text.startsWith('/n')) {
    const input = text.replace('/n', '').trim();
    const prev = lastUserMsg[chatId];
    const targetText = input || (prev ? prev.text : null);
    if (!targetText) return bot.sendMessage(chatId, 'Kirim teks dulu, baru ketik /n untuk glitch.').catch(() => {});
    const glitched = glitchText(targetText);
    if (prev && prev.msg_id) {
      await bot.editMessageText(glitched, { chat_id: chatId, message_id: prev.msg_id }).catch(() => {});
    } else {
      await bot.sendMessage(chatId, glitched).catch(() => {});
    }
    delete lastUserMsg[chatId];
    return;
  }
  if (text.startsWith('/help')) return bot.sendMessage(chatId, helpText(), { parse_mode: 'HTML', disable_web_page_preview: true });
  if (text.startsWith('/status')) return sendStatus(chatId);
  if (text.startsWith('/mode')) return bot.sendMessage(chatId, `Current mode: <b>${tradingMode()}</b>`, { parse_mode: 'HTML' });
  if (text.startsWith('/setmode')) return setModeCommand(chatId, text);
  if (text.startsWith('/risk')) return bot.sendMessage(chatId, riskSummaryText(), { parse_mode: 'HTML' });
  if (text.startsWith('/settings')) return bot.sendMessage(chatId, `${agentText()}

${riskSummaryText()}`, { parse_mode: 'HTML', disable_web_page_preview: true });
  if (text.startsWith('/emergency_on')) { setSetting('emergency_stop', 'true'); return bot.sendMessage(chatId, '🛑 Emergency stop ON. New buys are blocked. Sells for risk reduction can still run.'); }
  if (text.startsWith('/emergency_off')) { setSetting('emergency_stop', 'false'); return bot.sendMessage(chatId, '✅ Emergency stop OFF. Guardrails still apply.'); }
  if (text.startsWith('/blacklist')) return blacklistCommand(chatId, text);
  if (text.startsWith('/unblacklist')) return unblacklistCommand(chatId, text);
  if (text.startsWith('/approve')) return approveRejectCommand(chatId, text, true);
  if (text.startsWith('/reject')) return approveRejectCommand(chatId, text, false);
  if (text.startsWith('/report')) return runLearning(chatId, text.split(/\s+/)[1] || '12h');
  if (text.startsWith('/menu')) return sendMenu(chatId);
  if (text.startsWith('/positions')) return sendPositions(chatId);
  if (text.startsWith('/filters')) return bot.sendMessage(chatId, filtersText(), { parse_mode: 'HTML' });
  if (text.startsWith('/strategy')) {
    const parts = text.split(/\s+/);
    const id = parts[1];
    if (!id) {
      return bot.sendMessage(chatId, strategyMenuText(), { parse_mode: 'HTML', ...strategyKeyboard() });
    }
    const valid = ['sniper', 'dip_buy', 'smart_money', 'degen'];
    if (!valid.includes(id)) {
      return bot.sendMessage(chatId, `Unknown strategy. Valid: ${valid.join(', ')}`);
    }
    setActiveStrategy(id);
    return bot.sendMessage(chatId, strategyMenuText(), { parse_mode: 'HTML', ...strategyKeyboard() });
  }
  if (text.startsWith('/stratset')) {
    const parts = text.split(/\s+/);
    const [, id, key, ...rest] = parts;
    const value = rest.join(' ');
    if (!id || !key || !value) {
      return bot.sendMessage(chatId, 'Usage: /stratset <strategy_id> <key> <value>\n\nExample: /stratset sniper tp_percent 75\n\nKeys: tp_percent, sl_percent, position_size_sol, max_open_positions, min_mcap_usd, max_mcap_usd, min_holders, trailing_enabled, trailing_percent, partial_tp, partial_tp_at_percent, partial_tp_sell_percent, max_hold_ms, use_llm, llm_min_confidence, min_source_count, require_fee_claim, min_fee_claim_sol, min_gmgn_total_fee_sol, max_ath_distance_pct');
    }
    const strat = strategyById(id);
    if (!strat) return bot.sendMessage(chatId, `Strategy "${id}" not found.`);
    const numKeys = new Set(['tp_percent', 'sl_percent', 'position_size_sol', 'max_open_positions', 'min_mcap_usd', 'max_mcap_usd', 'min_holders', 'max_top20_holder_percent', 'trailing_percent', 'partial_tp_at_percent', 'partial_tp_sell_percent', 'max_hold_ms', 'llm_min_confidence', 'min_source_count', 'min_fee_claim_sol', 'min_gmgn_total_fee_sol', 'max_ath_distance_pct', 'token_age_max_ms', 'trending_min_volume_usd', 'trending_min_swaps', 'trending_max_rug_ratio', 'trending_max_bundler_rate', 'min_saved_wallet_holders', 'min_graduated_volume_usd']);
    const boolKeys = new Set(['trailing_enabled', 'partial_tp', 'use_llm', 'require_fee_claim']);
    const newConfig = { ...strat };
    delete newConfig.id;
    delete newConfig.name;
    if (numKeys.has(key)) {
      newConfig[key] = Number(value);
    } else if (boolKeys.has(key)) {
      newConfig[key] = value === 'true' || value === '1' || value === 'yes';
    } else {
      newConfig[key] = value;
    }
    updateStrategyConfig(id, newConfig);
    return bot.sendMessage(chatId, `Updated ${id}.${key} = ${value}\n\n${strategyMenuText()}`, { parse_mode: 'HTML' });
  }
  if (text.startsWith('/pnl')) return sendPnl(chatId);
  if (text.startsWith('/learn')) {
    const windowArg = text.split(/\s+/)[1] || '12h';
    return runLearning(chatId, windowArg);
  }
  if (text.startsWith('/lessons')) return sendLessons(chatId);
  if (text.startsWith('/candidate')) {
    const mint = text.split(/\s+/)[1];
    if (!mint) return bot.sendMessage(chatId, 'Usage: /candidate <mint>');
    const row = latestCandidateByMint(mint);
    if (!row) return bot.sendMessage(chatId, 'Candidate not found.');
    return sendCandidate(chatId, row.id);
  }
  if (text.startsWith('/walletadd')) {
    const [, label, address] = text.split(/\s+/);
    if (!label || !address) return bot.sendMessage(chatId, 'Usage: /walletadd <label> <address>');
    db.prepare(`
      INSERT INTO saved_wallets (label, address, created_at_ms) VALUES (?, ?, ?)
      ON CONFLICT(label) DO UPDATE SET address = excluded.address
    `).run(label, address, now());
    return bot.sendMessage(chatId, `Saved wallet ${label}.`);
  }
  if (text.startsWith('/walletremove')) {
    const label = text.split(/\s+/)[1];
    if (!label) return bot.sendMessage(chatId, 'Usage: /walletremove <label>');
    db.prepare('DELETE FROM saved_wallets WHERE label = ?').run(label);
    return bot.sendMessage(chatId, `Removed ${label}.`);
  }
  if (text.startsWith('/wallets')) return handleCallback({ id: 'manual', data: 'menu:wallets', message: { chat: { id: chatId } } });
  if (text.startsWith('/setfilter')) {
    const { key, value } = parseSetFilter(text);
    const valid = new Set([
      'min_fee_claim_sol',
      'min_mcap_usd',
      'max_mcap_usd',
      'min_gmgn_total_fee_sol',
      'min_graduated_volume_usd',
      'max_top20_holder_percent',
      'min_saved_wallet_holders',
      'trending_enabled',
      'trending_source',
      'trending_allow_degen',
      'trending_interval',
      'trending_limit',
      'trending_order_by',
      'trending_min_volume_usd',
      'trending_min_swaps',
      'trending_max_rug_ratio',
      'trending_max_bundler_rate',
      'trading_mode',
      'llm_min_confidence',
      'llm_candidate_pick_count',
      'llm_candidate_max_age_ms',
      'max_open_positions',
      'dry_run_buy_sol',
      'default_tp_percent',
      'default_sl_percent',
      'default_trailing_enabled',
      'default_trailing_percent',
    ]);
    if (!valid.has(key) || value == null) {
      return bot.sendMessage(chatId, `Usage: /setfilter &lt;name&gt; &lt;value&gt;\n\n${filtersText()}`, { parse_mode: 'HTML' });
    }
    setSetting(key, value === 'off' ? '0' : value);
    return bot.sendMessage(chatId, filtersText(), { parse_mode: 'HTML' });
  }
}

export async function sendCandidate(chatId, id) {
  const row = candidateById(id);
  if (!row) return bot.sendMessage(chatId, 'Candidate not found.');
  const decision = db.prepare('SELECT * FROM llm_decisions WHERE candidate_id = ? ORDER BY id DESC LIMIT 1').get(id);
  await bot.sendMessage(chatId, candidateSummary(row.candidate, decision), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...candidateButtons(id, decision),
  });
}

export async function sendPositions(chatId) {
  const rows = allPositions(12);
  const text = rows.length ? rows.map(formatPosition).join('\n\n') : 'No dry-run positions yet.';
  await bot.sendMessage(chatId, `📍 <b>Positions</b>\n\n${text}`, { parse_mode: 'HTML', disable_web_page_preview: true });
}

export async function sendPosition(chatId, id, query = null) {
  let row = db.prepare('SELECT * FROM dry_run_positions WHERE id = ?').get(id);
  if (!row) return bot.sendMessage(chatId, 'Position not found.');
  if (row.status === 'open') {
    const refreshed = await refreshPosition(row, { autoExit: row.execution_mode !== 'live' }).catch((err) => {
      console.log(`[position] refresh ${id} ${err.message}`);
      return null;
    });
    if (refreshed) row = { ...row, ...refreshed };
  }
  const buttons = row.status === 'open' ? positionButtons(id) : {};
  if (query) return editMenuMessage(query, formatPosition(row), buttons);
  await bot.sendMessage(chatId, formatPosition(row), { parse_mode: 'HTML', disable_web_page_preview: true, ...buttons });
}

export async function closePosition(chatId, id, reason) {
  const row = db.prepare('SELECT * FROM dry_run_positions WHERE id = ?').get(id);
  if (!row || row.status !== 'open') return bot.sendMessage(chatId, 'Open position not found.');
  const result = await refreshPosition(row, { autoExit: false });
  const price = result?.price ?? row.high_water_price ?? row.entry_price;
  const mcap = result?.mcap ?? row.high_water_mcap ?? row.entry_mcap;
  const pnlPercent = row.entry_mcap ? (Number(mcap) / Number(row.entry_mcap) - 1) * 100 : 0;
  const pnlSol = Number(row.size_sol) * pnlPercent / 100;
  let sell = null;
  if (row.execution_mode === 'live') sell = await executeLiveSell(row, reason);
  db.prepare(`
    UPDATE dry_run_positions
    SET status = 'closed', closed_at_ms = ?, exit_price = ?, exit_mcap = ?, exit_reason = ?,
        pnl_percent = ?, pnl_sol = ?, exit_signature = ?
    WHERE id = ?
  `).run(now(), price, mcap, reason, pnlPercent, pnlSol, sell?.signature || null, id);
  db.prepare(`
    INSERT INTO dry_run_trades (position_id, mint, side, at_ms, price, mcap, size_sol, token_amount_est, reason, payload_json)
    VALUES (?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, row.mint, now(), price, mcap, row.size_sol, row.token_amount_est, reason, json({ pnlPercent, pnlSol, sell }));
  const label = row.execution_mode === 'live' ? 'Closed live position' : 'Closed dry-run position';
  await bot.sendMessage(chatId, `${label} #${id}: ${escapeHtml(reason)} ${fmtPct(pnlPercent)}`, { parse_mode: 'HTML' });
}

export async function updatePositionRule(chatId, id, field, nextValue, query = null) {
  if (!Number.isFinite(nextValue)) return bot.sendMessage(chatId, 'Invalid value.');
  db.prepare(`UPDATE dry_run_positions SET ${field} = ? WHERE id = ?`).run(nextValue, id);
  const row = db.prepare('SELECT * FROM dry_run_positions WHERE id = ?').get(id);
  if (row) {
    db.prepare(`
      INSERT INTO tp_sl_rules (position_id, tp_percent, sl_percent, trailing_enabled, trailing_percent, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(position_id) DO UPDATE SET
        tp_percent = excluded.tp_percent,
        sl_percent = excluded.sl_percent,
        trailing_enabled = excluded.trailing_enabled,
        trailing_percent = excluded.trailing_percent,
        updated_at_ms = excluded.updated_at_ms
    `).run(id, row.tp_percent, row.sl_percent, row.trailing_enabled, row.trailing_percent, now());
  }
  await sendPosition(chatId, id, query);
}

export async function toggleTrailing(chatId, id, query = null) {
  const row = db.prepare('SELECT * FROM dry_run_positions WHERE id = ?').get(id);
  if (!row) return bot.sendMessage(chatId, 'Position not found.');
  const next = row.trailing_enabled ? 0 : 1;
  db.prepare('UPDATE dry_run_positions SET trailing_enabled = ? WHERE id = ?').run(next, id);
  db.prepare(`
    INSERT INTO tp_sl_rules (position_id, tp_percent, sl_percent, trailing_enabled, trailing_percent, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(position_id) DO UPDATE SET
      tp_percent = excluded.tp_percent,
      sl_percent = excluded.sl_percent,
      trailing_enabled = excluded.trailing_enabled,
      trailing_percent = excluded.trailing_percent,
      updated_at_ms = excluded.updated_at_ms
  `).run(id, row.tp_percent, row.sl_percent, next, row.trailing_percent, now());
  await sendPosition(chatId, id, query);
}

export function setupTelegram() {
  bot.setMyCommands([
    { command: 'start', description: 'Start/help' },
    { command: 'help', description: 'Show help' },
    { command: 'status', description: 'Runtime and risk status' },
    { command: 'mode', description: 'Show trading mode' },
    { command: 'setmode', description: 'Set mode: dry_run/confirm/live' },
    { command: 'risk', description: 'Show risk guardrails' },
    { command: 'emergency_on', description: 'Block new buys' },
    { command: 'emergency_off', description: 'Allow new buys again' },
    { command: 'blacklist', description: 'Blacklist token mint' },
    { command: 'unblacklist', description: 'Remove token blacklist' },
    { command: 'approve', description: 'Approve pending trade intent' },
    { command: 'reject', description: 'Reject pending trade intent' },
    { command: 'settings', description: 'Show settings' },
    { command: 'report', description: 'Run learning report' },
    { command: 'menu', description: 'Open Charon menu' },
    { command: 'strategy', description: 'Show/switch strategy' },
    { command: 'stratset', description: 'Set strategy config (stratset id key value)' },
    { command: 'positions', description: 'Show dry-run positions' },
    { command: 'candidate', description: 'Show candidate by mint' },
    { command: 'filters', description: 'Show filters' },
    { command: 'pnl', description: 'Show saved-wallet PnL' },
    { command: 'learn', description: 'Run manual learning report' },
    { command: 'n', description: 'Glitch text miring' },
    { command: 'lessons', description: 'Show active screening lessons' },
    { command: 'setfilter', description: 'Set a filter value' },
    { command: 'walletadd', description: 'Save wallet for exposure/PnL' },
    { command: 'walletremove', description: 'Remove saved wallet' },
    { command: 'wallets', description: 'List saved wallets' },
  ]).catch(err => console.log(`[telegram] commands ${err.message}`));

  bot.on('callback_query', query => {
    if (!validateTelegramUser(query.message)) return bot.answerCallbackQuery(query.id, { text: 'Unauthorized' }).catch(() => {});
    return handleCallback(query).catch(err => console.log(`[callback] ${err.message}`));
  });
  bot.on('message', msg => handleMessage(msg).catch(err => console.log(`[message] ${err.message}`)));
  bot.on('polling_error', err => console.log(`[telegram] polling ${err.message}`));
}

async function sendMenu(chatId = TELEGRAM_CHAT_ID) {
  const { TELEGRAM_TOPIC_ID } = await import('../config.js');
  await bot.sendMessage(chatId, mainMenuText(), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(TELEGRAM_TOPIC_ID ? { message_thread_id: Number(TELEGRAM_TOPIC_ID) } : {}),
    ...menuKeyboard(),
  });
}

async function sendPnl(chatId, query = null) {
  // Pull real stats directly from dry_run_positions table
  const closed = db.prepare(`
    SELECT id, pnl_sol, pnl_percent, exit_reason, exit_price, entry_price,
           size_sol, opened_at_ms, closed_at_ms, symbol, mint
    FROM dry_run_positions
    WHERE status = 'closed' AND pnl_sol IS NOT NULL
    ORDER BY closed_at_ms DESC
  `).all();

  const open = db.prepare(`
    SELECT id, pnl_sol, pnl_percent, tp_percent, sl_percent,
           size_sol, opened_at_ms, symbol, mint
    FROM dry_run_positions
    WHERE status = 'open'
    ORDER BY opened_at_ms DESC
  `).all();

  const wins = closed.filter(p => Number(p.pnl_sol) > 0);
  const losses = closed.filter(p => Number(p.pnl_sol) < 0);
  // Exclude zero-pnl closes from realized stats — these are stale-price false exits
  const realized = closed.filter(p => Number(p.pnl_sol) !== 0);
  const breakeven = closed.filter(p => Number(p.pnl_sol) === 0);
  const totalPnl = realized.reduce((s, p) => s + Number(p.pnl_sol || 0), 0);
  const wr = realized.length > 0 ? (wins.length / realized.length) * 100 : 0;

  const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
  const todayTrades = closed.filter(p => Number(p.closed_at_ms) >= todayStart);
  const todayRealized = todayTrades.filter(p => Number(p.pnl_sol) !== 0);
  const todayPnl = todayRealized.reduce((s, p) => s + Number(p.pnl_sol || 0), 0);

  let text = [
    `📊 <b>PnL</b>`,
    ``,
    `⚡ <b>All Time</b>`,
    `Realized: ${realized.length} (${wins.length}W / ${losses.length}L) · WR ${wr.toFixed(0)}%`,
    `P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)} SOL`,
    breakeven.length > 0 ? `Zero-PnL: ${breakeven.length} (not counted)` : ``,
    `Total closed: ${closed.length} positions`,
    ``,
    `📅 <b>Today (WIB ${new Date().toLocaleTimeString('id-ID', {timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'})})</b>`,
    `Trades: ${todayRealized.length} · P&L: ${todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(4)} SOL`,
    ``,
    `🔓 <b>Open (${open.length})</b>`,
  ];

  if (open.length === 0) {
    text.push('  none');
  } else {
    for (const p of open.slice(0, 5)) {
      const pnl = Number(p.pnl_sol || 0);
      const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);
      text.push(`  ${p.symbol || p.mint?.slice(0, 6)} · ${pnlStr} SOL · TP ${p.tp_percent}%`);
    }
    if (open.length > 5) text.push(`  ...+${open.length - 5} more`);
  }

  text.push('');
  text.push(`📕 <b>Last 5 Closed</b>`);
  if (closed.length === 0) {
    text.push('  none');
  } else {
    for (const p of closed.slice(0, 5)) {
      const pnl = Number(p.pnl_sol);
      const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);
      const reason = p.exit_reason || 'close';
      text.push(`  ${p.symbol || p.mint?.slice(0, 6)} · ${pnlStr} SOL · ${reason}`);
    }
  }

  const msg = query ? editMenuMessage(query, text.join('\n'), navKeyboard()) : bot.sendMessage(chatId, text.join('\n'), { parse_mode: 'HTML' });

  // Generate and send PnL chart
  const { spawn } = await import('child_process');
  const chartPath = '/home/ubuntu/charon2/scripts/pnl_chart.png';
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('/home/ubuntu/.hermes/venv/bin/python3', ['/home/ubuntu/charon2/scripts/pnl_chart.py'], { timeout: 30000 });
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Chart exit ${code}`)));
      child.on('error', reject);
    });
    await sendPnlChart(chartPath);
  } catch (e) {
    console.error('[pnl] chart error:', e.message);
  }

  return msg;
}


function helpText() {
  return [
    '🛶 <b>Charon</b>',
    'Trading safety first. LLM recommends only; deterministic risk engine decides.',
    '',
    '<b>Core</b>: /status /mode /setmode dry_run|confirm|live /positions /pnl',
    '<b>Risk</b>: /risk /emergency_on /emergency_off /blacklist &lt;mint&gt; /unblacklist &lt;mint&gt;',
    '<b>Approval</b>: /approve &lt;id&gt; /reject &lt;id&gt;',
    '<b>Learning</b>: /lessons /report',
    '<b>Menu</b>: /menu /settings',
  ].join('\n');
}

async function sendStatus(chatId) {
  const uptime = Math.floor(process.uptime());
  const lastSignal = db.prepare('SELECT MAX(at_ms) AS at FROM signal_events').get()?.at || null;
  const stats = db.prepare("SELECT COUNT(*) AS count FROM dry_run_trades WHERE side = 'buy' AND at_ms >= ?").get(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime());
  const pnl = db.prepare("SELECT COALESCE(SUM(pnl_sol), 0) AS pnl FROM dry_run_positions WHERE status = 'closed' AND closed_at_ms >= ?").get(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime());
  const text = [
    '📡 <b>Status</b>',
    `Uptime: <b>${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m</b>`,
    `Mode: <b>${tradingMode()}</b>`,
    `ALLOW_LIVE_TRADING: <b>${ALLOW_LIVE_TRADING}</b>`,
    `REQUIRE_CONFIRMATION_FOR_LIVE: <b>${REQUIRE_CONFIRMATION_FOR_LIVE}</b>`,
    `Emergency stop: <b>${boolSetting('emergency_stop', false)}</b>`,
    `Open positions: <b>${openPositionCount()}</b>`,
    `Today trades: <b>${stats.count}</b>`,
    `Today PnL: <b>${Number(pnl.pnl || 0).toFixed(4)} SOL</b>`,
    `Last signal: <b>${lastSignal ? new Date(lastSignal).toISOString() : 'none'}</b>`,
    `Last error: <code>${escapeHtml(getLastError() || 'none')}</code>`,
    `DB path: <code>${escapeHtml(DB_PATH)}</code>`,
    `LLM enabled: <b>${ENABLE_LLM}</b>`,
    `GMGN enabled: <b>${GMGN_ENABLED}</b>`,
  ].join('\n');
  return bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
}

function setModeCommand(chatId, text) {
  const mode = text.split(/\s+/)[1];
  if (!['dry_run', 'confirm', 'live'].includes(mode)) return bot.sendMessage(chatId, 'Usage: /setmode dry_run|confirm|live');
  setSetting('trading_mode', mode);
  const warning = mode === 'live' && !ALLOW_LIVE_TRADING ? '\n⚠️ ALLOW_LIVE_TRADING=false, so risk engine will block live buys until .env is changed and app restarted.' : '';
  return bot.sendMessage(chatId, `Mode set to <b>${mode}</b>${warning}`, { parse_mode: 'HTML' });
}

function blacklistCommand(chatId, text) {
  const [, mint, ...reasonParts] = text.split(/\s+/);
  if (!mint) {
    const rows = listBlacklist(20);
    return bot.sendMessage(chatId, rows.length ? rows.map(row => `• <code>${escapeHtml(row.mint)}</code> — ${escapeHtml(row.reason || '')}`).join('\n') : 'Blacklist is empty.', { parse_mode: 'HTML' });
  }
  addToBlacklist(mint, reasonParts.join(' ') || 'manual');
  return bot.sendMessage(chatId, `Blacklisted <code>${escapeHtml(mint)}</code>.`, { parse_mode: 'HTML' });
}

function unblacklistCommand(chatId, text) {
  const mint = text.split(/\s+/)[1];
  if (!mint) return bot.sendMessage(chatId, 'Usage: /unblacklist <mint>');
  removeFromBlacklist(mint);
  return bot.sendMessage(chatId, `Removed <code>${escapeHtml(mint)}</code> from blacklist.`, { parse_mode: 'HTML' });
}

function approveRejectCommand(chatId, text, approve) {
  const id = Number(text.split(/\s+/)[1]);
  if (!Number.isInteger(id) || id <= 0) return bot.sendMessage(chatId, `Usage: /${approve ? 'approve' : 'reject'} <id>`);
  return approve ? executeConfirmedIntent(chatId, id) : rejectIntent(chatId, id);
}

function parseSetFilter(text) {
  const parts = text.trim().split(/\s+/);
  return { key: parts[1], value: parts[2] };
}

function allPositions(limit = 10) {
  return db.prepare('SELECT * FROM dry_run_positions ORDER BY id DESC LIMIT ?').all(limit);
}

function glitchText(text) {
  // Normalize spaces first, then apply character-level glitch
  const normalized = text.replace(/\s+/g, ' ');
  let result = '';
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    const r = Math.random();
    if (r < 0.2) {
      // Insert a random glitch char
      const glitchChars = ['\u200B', '\u200C', '\u180E', '\u200D', '\u00AD'];
      result += glitchChars[Math.floor(Math.random() * glitchChars.length)];
    } else if (r < 0.5) {
      // Toggle case
      result += char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();
    } else {
      result += char;
    }
    i++;
  }
  // Normalize multiple spaces that may have formed
  return result.replace(/  +/g, ' ').trim();
}

function savedWallets() {
  return db.prepare('SELECT * FROM saved_wallets ORDER BY label').all();
}
