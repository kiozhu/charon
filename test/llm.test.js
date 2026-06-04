import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MAX_BUY_SOL = '0.02';
const { validateLlmJson } = await import('../src/pipeline/llmValidator.js');

const row = { id: 7, candidate: { token: { mint: 'Mint111' } } };

test('LLM validator accepts strict BUY JSON and clamps suggested size', () => {
  const decision = validateLlmJson({ action: 'BUY', selected_candidate_id: 7, confidence: 120, reason: 'ok', risks: [], suggestedSizeSol: 1 }, [row], { maxBuySol: 0.02 });
  assert.equal(decision.verdict, 'BUY');
  assert.equal(decision.confidence, 100);
  assert.equal(decision.suggestedSizeSol, 0.02);
});

test('LLM validator defaults invalid action to SKIP/WATCH', () => {
  const decision = validateLlmJson({ action: 'MOON', confidence: -5 }, [row], { maxBuySol: 0.02 });
  assert.equal(decision.action, 'SKIP');
  assert.equal(decision.verdict, 'WATCH');
});
