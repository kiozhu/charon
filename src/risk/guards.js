import { clampBuySizeSol } from './sizing.js';

export function validateTradingMode(mode) {
  return ['dry_run', 'confirm', 'live'].includes(String(mode)) ? String(mode) : 'dry_run';
}

export function requireApprovalForLiveTrade({ mode, requireConfirmationForLive = true, approved = false }) {
  return !(mode === 'live' && requireConfirmationForLive && !approved);
}

export function evaluateTradeRisk(input = {}) {
  const cfg = input.config || {};
  const state = input.state || {};
  const candidate = input.candidate || {};
  const metrics = candidate.metrics || {};
  const holders = candidate.holders || {};
  const chart = candidate.chart || {};
  const token = candidate.token || {};
  const mode = validateTradingMode(input.mode || cfg.TRADING_MODE || 'dry_run');
  const side = input.side || 'buy';
  const requestedSizeSol = Number(input.sizeSol ?? input.suggestedSizeSol ?? cfg.MAX_BUY_SOL ?? 0);
  const maxBuySol = Number(cfg.MAX_BUY_SOL ?? 0.02);
  const allowedSizeSol = clampBuySizeSol(requestedSizeSol, maxBuySol);
  const blocks = [];
  const warnings = [];
  let score = 100;

  const block = (code, message) => { blocks.push({ code, message }); score -= 15; };
  const warn = (code, message) => { warnings.push({ code, message }); score -= 5; };

  if (side !== 'buy') return { ok: true, mode, side, riskScore: 100, sizeSol: requestedSizeSol, blocks, warnings };
  if (cfg.EMERGENCY_STOP === true || cfg.EMERGENCY_STOP === 'true') block('emergency_stop', 'EMERGENCY_STOP=true blocks new buys.');
  if (mode === 'live' && !(cfg.ALLOW_LIVE_TRADING === true || cfg.ALLOW_LIVE_TRADING === 'true')) block('live_disabled', 'ALLOW_LIVE_TRADING=false blocks live execution.');
  if (mode === 'live' && !requireApprovalForLiveTrade({ mode, requireConfirmationForLive: cfg.REQUIRE_CONFIRMATION_FOR_LIVE !== false && cfg.REQUIRE_CONFIRMATION_FOR_LIVE !== 'false', approved: input.approved })) {
    block('live_confirmation_required', 'Live buy requires Telegram approval.');
  }
  if (!Number.isFinite(requestedSizeSol) || requestedSizeSol <= 0) block('invalid_size', 'Buy size is invalid.');
  if (requestedSizeSol > maxBuySol) block('max_buy_sol', `Requested size ${requestedSizeSol} SOL exceeds MAX_BUY_SOL ${maxBuySol}.`);
  if (allowedSizeSol <= 0) block('zero_size', 'Allowed buy size is zero.');
  if (Number(state.openPositions || 0) >= Number(cfg.MAX_OPEN_POSITIONS ?? 10)) block('max_open_positions', 'Maximum open positions reached.');
  if (Number(state.todayTrades || 0) >= Number(cfg.MAX_TRADES_PER_DAY ?? 100)) block('max_trades_per_day', 'Maximum trades per day reached.');
  if (Math.abs(Math.min(0, Number(state.todayPnlSol || 0))) >= Number(cfg.DAILY_MAX_LOSS_SOL ?? 0.3)) block('daily_loss', 'Daily max loss reached.');
  if (state.duplicateToken) block('duplicate_token', 'Token already has an open/recent position.');
  if (state.blacklisted) block('blacklisted', 'Token is blacklisted.');
  if (state.tokenCooldownActive) block('token_cooldown', 'Token cooldown is active.');
  if (state.lossCooldownActive) block('loss_cooldown', 'Loss cooldown is active.');
  if (mode === 'live' && Number(state.walletBalanceSol || 0) > 0) {
    const reserve = Number(cfg.LIVE_MIN_SOL_RESERVE ?? 0.02);
    if (Number(state.walletBalanceSol) - allowedSizeSol < reserve) block('wallet_reserve', `Wallet reserve would fall below ${reserve} SOL.`);
  }
  const slippage = Number(cfg.JUPITER_SLIPPAGE_BPS ?? 300);
  if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 1000) block('slippage_guard', 'JUPITER_SLIPPAGE_BPS must be between 1 and 1000.');

  const tokenAge = Number(metrics.tokenAgeMs ?? candidate.tokenAgeMs ?? 0);
  if (Number.isFinite(tokenAge) && tokenAge > 0 && tokenAge < 30_000) warn('very_new_token', 'Token age is under 30 seconds.');
  const liquidity = Number(metrics.liquidityUsd ?? metrics.liquidity ?? 0);
  if (Number.isFinite(liquidity) && liquidity > 0 && liquidity < 1_000) warn('low_liquidity', 'Liquidity is very low.');
  const holderCount = Number(holders.count ?? metrics.holders ?? 0);
  if (Number.isFinite(holderCount) && holderCount > 0 && holderCount < 20) warn('low_holders', 'Holder count is very low.');
  const marketCap = Number(metrics.marketCapUsd ?? metrics.graduatedMarketCapUsd ?? 0);
  if (Number.isFinite(marketCap) && marketCap > 0 && marketCap > 5_000_000) warn('large_mcap', 'Market cap may be late for trench entry.');
  const rugRatio = Number(metrics.rugRatio ?? candidate.trending?.rugRatio ?? candidate.trending?.rug_ratio ?? 0);
  if (Number.isFinite(rugRatio) && rugRatio > 0.3) block('rug_ratio', `Rug ratio ${rugRatio} exceeds safe threshold.`);
  const bundlerRate = Number(metrics.bundlerRate ?? candidate.trending?.bundlerRate ?? candidate.trending?.bundler_rate ?? 0);
  if (Number.isFinite(bundlerRate) && bundlerRate > 0.5) block('bundler_rate', `Bundler rate ${bundlerRate} exceeds safe threshold.`);
  const athDistance = Number(chart.distanceFromAthPercent ?? chart.belowRangeHighPercent ?? 0);
  if (Number.isFinite(athDistance) && athDistance > -1 && athDistance < 2) warn('near_ath', 'Entry is close to ATH/range high.');
  if (!token.mint && !candidate.mint) block('missing_mint', 'Token mint is missing.');

  return {
    ok: blocks.length === 0,
    mode,
    side,
    riskScore: Math.max(0, Math.min(100, score)),
    sizeSol: allowedSizeSol,
    requestedSizeSol,
    blocks,
    warnings,
  };
}
