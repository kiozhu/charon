import test from 'node:test';
import assert from 'node:assert/strict';

const { evaluateTradeRisk } = await import('../src/risk/guards.js');

const candidate = { token: { mint: 'Mint111' }, metrics: { liquidityUsd: 5000, marketCapUsd: 100000 }, holders: { count: 100 }, chart: { distanceFromAthPercent: -20 } };

test('risk engine blocks live when ALLOW_LIVE_TRADING=false', () => {
  const result = evaluateTradeRisk({ candidate, mode: 'live', approved: true, sizeSol: 0.01, config: { ALLOW_LIVE_TRADING: false, MAX_BUY_SOL: 0.02, MAX_OPEN_POSITIONS: 3, JUPITER_SLIPPAGE_BPS: 300 }, state: {} });
  assert.equal(result.ok, false);
  assert.equal(result.blocks.some(b => b.code === 'live_disabled'), true);
});

test('risk engine blocks emergency stop', () => {
  const result = evaluateTradeRisk({ candidate, mode: 'dry_run', sizeSol: 0.01, config: { EMERGENCY_STOP: true, MAX_BUY_SOL: 0.02, MAX_OPEN_POSITIONS: 3, JUPITER_SLIPPAGE_BPS: 300 }, state: {} });
  assert.equal(result.blocks.some(b => b.code === 'emergency_stop'), true);
});

test('risk engine blocks max buy amount', () => {
  const result = evaluateTradeRisk({ candidate, mode: 'dry_run', sizeSol: 0.5, config: { MAX_BUY_SOL: 0.02, MAX_OPEN_POSITIONS: 3, JUPITER_SLIPPAGE_BPS: 300 }, state: {} });
  assert.equal(result.blocks.some(b => b.code === 'max_buy_sol'), true);
});

test('risk engine blocks duplicate token cooldown', () => {
  const result = evaluateTradeRisk({ candidate, mode: 'dry_run', sizeSol: 0.01, config: { MAX_BUY_SOL: 0.02, MAX_OPEN_POSITIONS: 3, JUPITER_SLIPPAGE_BPS: 300 }, state: { duplicateToken: true } });
  assert.equal(result.blocks.some(b => b.code === 'duplicate_token'), true);
});
