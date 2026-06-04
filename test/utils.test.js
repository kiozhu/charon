import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN = '1234567890:ABCDEFabcdefABCDEFabcdefABCDEFabc';
process.env.LLM_API_KEY = 'sk-test-secret-key-value';

const { redactSecrets } = await import('../src/utils.js');

test('redactSecrets hides known secret patterns and env secrets', () => {
  const input = `token=${process.env.TELEGRAM_BOT_TOKEN} key=${process.env.LLM_API_KEY} url=https://x.test/?api-key=heliusSecret`;
  const out = redactSecrets(input);
  assert.equal(out.includes(process.env.TELEGRAM_BOT_TOKEN), false);
  assert.equal(out.includes(process.env.LLM_API_KEY), false);
  assert.match(out, /REDACTED/);
});
