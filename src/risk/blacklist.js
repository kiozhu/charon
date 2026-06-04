import { db } from '../db/connection.js';
import { now } from '../utils.js';

export function normalizeMint(mint) {
  return String(mint || '').trim();
}

export function isBlacklisted(mint) {
  const value = normalizeMint(mint);
  if (!value) return false;
  const row = db.prepare('SELECT mint FROM blacklist WHERE mint = ? LIMIT 1').get(value);
  return Boolean(row);
}

export function addToBlacklist(mint, reason = 'manual') {
  const value = normalizeMint(mint);
  if (!value) throw new Error('mint is required');
  db.prepare(`
    INSERT INTO blacklist (mint, reason, created_at_ms) VALUES (?, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET reason = excluded.reason
  `).run(value, reason, now());
}

export function removeFromBlacklist(mint) {
  db.prepare('DELETE FROM blacklist WHERE mint = ?').run(normalizeMint(mint));
}

export function listBlacklist(limit = 20) {
  return db.prepare('SELECT * FROM blacklist ORDER BY created_at_ms DESC LIMIT ?').all(limit);
}
