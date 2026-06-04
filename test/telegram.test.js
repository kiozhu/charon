import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_CHAT_ID = '12345';
const { validateTelegramUser } = await import('../src/security/telegram.js');

test('Telegram unauthorized chat is rejected', () => {
  assert.equal(validateTelegramUser({ chat: { id: 999 } }), false);
});

test('Telegram authorized chat is accepted', () => {
  assert.equal(validateTelegramUser({ chat: { id: 12345 } }), true);
});
