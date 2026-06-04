import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '../utils.js';

const LOG_DIR = process.env.LOG_DIR || './logs';
const MAX_BYTES = Number(process.env.LOG_MAX_BYTES || 2_000_000);
let installed = false;
let lastError = null;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateIfLarge(file) {
  try {
    if (!fs.existsSync(file)) return;
    const stat = fs.statSync(file);
    if (stat.size < MAX_BYTES) return;
    const rotated = `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(file, rotated);
  } catch {
    // logging must never crash the bot
  }
}

function write(fileName, level, args) {
  try {
    ensureLogDir();
    const file = path.join(LOG_DIR, fileName);
    rotateIfLarge(file);
    const text = args.map(value => {
      if (value instanceof Error) return `${value.message}\n${value.stack || ''}`;
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    }).join(' ');
    const line = JSON.stringify({ at: new Date().toISOString(), level, msg: redactSecrets(text) }) + '\n';
    fs.appendFileSync(file, line);
    if (level === 'error') lastError = redactSecrets(text).slice(0, 1000);
  } catch {
    // ignore logging failures
  }
}

export function safeLog(...args) {
  write('app.log', 'info', args);
  process.stdout.write(`${redactSecrets(args.map(String).join(' '))}\n`);
}

export function safeError(...args) {
  write('error.log', 'error', args);
  process.stderr.write(`${redactSecrets(args.map(value => value instanceof Error ? value.stack || value.message : String(value)).join(' '))}\n`);
}

export function tradeLog(event, payload = {}) {
  write('trades.log', 'trade', [event, payload]);
}

export function getLastError() {
  return lastError;
}

export function installSafeConsole() {
  if (installed) return;
  installed = true;
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  console.log = (...args) => {
    write('app.log', 'info', args);
    originalLog(...args.map(arg => typeof arg === 'string' ? redactSecrets(arg) : arg));
  };
  console.error = (...args) => {
    write('error.log', 'error', args);
    originalError(...args.map(arg => typeof arg === 'string' ? redactSecrets(arg) : arg));
  };
}
