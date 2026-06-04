import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function numEnv(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function safeDbPath(value) {
  const raw = String(value || './charon.sqlite').trim();
  if (raw.includes('\0')) throw new Error('DB_PATH contains a null byte.');
  const resolved = path.resolve(raw);
  const cwd = path.resolve(process.cwd());
  if (!resolved.startsWith(cwd) && !resolved.startsWith('/mnt/data')) {
    throw new Error('DB_PATH must stay inside the project directory or /mnt/data.');
  }
  return raw;
}

export const APP_NAME = 'Charon';
export const DB_PATH = safeDbPath(process.env.DB_PATH || './charon.sqlite');
export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const DISC_DIST_FEES = Buffer.from('a537817004b3ca28', 'hex');
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOL_MINT = 'So11111111111111111111111111111111111111111';

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
export const TELEGRAM_TOPIC_ID = process.env.TELEGRAM_TOPIC_ID;
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
export const GMGN_API_KEY = process.env.GMGN_API_KEY;
export const GMGN_ENABLED = process.env.GMGN_ENABLED !== 'false';
export const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';
export const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY || ''}`;
export const SOLANA_WS_URL = process.env.SOLANA_WS_URL || `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY || ''}`;
export const JUPITER_SWAP_BASE_URL = process.env.JUPITER_SWAP_BASE_URL || 'https://api.jup.ag/swap/v2';
export const JUPITER_SLIPPAGE_BPS = numEnv('JUPITER_SLIPPAGE_BPS', 300, { min: 1, max: 1000 });
export const LIVE_MIN_SOL_RESERVE = numEnv('LIVE_MIN_SOL_RESERVE', 0.02, { min: 0 });
export const LIVE_MIN_SOL_RESERVE_LAMPORTS = Math.floor(LIVE_MIN_SOL_RESERVE * 1_000_000_000);
export const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.minimax.io/v1';
export const LLM_API_KEY = process.env.LLM_API_KEY || '';
export const LLM_MODEL = process.env.LLM_MODEL || 'MiniMax-M2.7';

export const TRADING_MODE = process.env.TRADING_MODE || 'dry_run';
export const MAX_BUY_SOL = numEnv('MAX_BUY_SOL', 0.02, { min: 0 });
export const DAILY_MAX_LOSS_SOL = numEnv('DAILY_MAX_LOSS_SOL', 0.05, { min: 0 });
export const MAX_TRADES_PER_DAY = numEnv('MAX_TRADES_PER_DAY', 5, { min: 0 });
export const TOKEN_COOLDOWN_MS = numEnv('TOKEN_COOLDOWN_MS', 3_600_000, { min: 0 });
export const LOSS_COOLDOWN_MS = numEnv('LOSS_COOLDOWN_MS', 1_800_000, { min: 0 });
export const EMERGENCY_STOP = boolEnv('EMERGENCY_STOP', false);
export const REQUIRE_CONFIRMATION_FOR_LIVE = boolEnv('REQUIRE_CONFIRMATION_FOR_LIVE', true);
export const ALLOW_LIVE_TRADING = boolEnv('ALLOW_LIVE_TRADING', false);

export const GRADUATED_POLL_MS = numEnv('GRADUATED_POLL_MS', 30_000, { min: 5_000 });
export const GRADUATED_LOOKBACK_MS = numEnv('GRADUATED_LOOKBACK_MS', 2 * 60 * 60 * 1000, { min: 60_000 });
export const TRENDING_POLL_MS = numEnv('TRENDING_POLL_MS', 60_000, { min: 10_000 });
export const TRENDING_LOOKBACK_MS = numEnv('TRENDING_LOOKBACK_MS', 10 * 60 * 1000, { min: 60_000 });
export const GMGN_CACHE_TTL_MS = numEnv('GMGN_CACHE_TTL_MS', 5 * 60 * 1000, { min: 10_000 });
export const POSITION_CHECK_MS = numEnv('POSITION_CHECK_MS', 10_000, { min: 5_000 });
export const LLM_TIMEOUT_MS = numEnv('LLM_TIMEOUT_MS', 30_000, { min: 5_000, max: 120_000 });
export const ENABLE_LLM = process.env.ENABLE_LLM !== 'false';
export const SIGNAL_SERVER_URL = process.env.SIGNAL_SERVER_URL || 'http://localhost:3456';
export const SIGNAL_SERVER_KEY = process.env.SIGNAL_SERVER_KEY || '';
export const SIGNAL_POLL_MS = numEnv('SIGNAL_POLL_MS', 30_000, { min: 5_000 });

export const JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (compatible; Charon/1.0; +https://local)',
};

export function validateTradingMode(mode = TRADING_MODE) {
  if (!['dry_run', 'confirm', 'live'].includes(String(mode))) return 'dry_run';
  return String(mode);
}

export function validateConfig() {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required.');
  if (!TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID is required.');
  if (!['dry_run', 'confirm', 'live'].includes(validateTradingMode(TRADING_MODE))) throw new Error('TRADING_MODE must be dry_run, confirm, or live.');
  if (MAX_BUY_SOL <= 0) throw new Error('MAX_BUY_SOL must be greater than 0.');
  if (JUPITER_SLIPPAGE_BPS < 1 || JUPITER_SLIPPAGE_BPS > 1000) throw new Error('JUPITER_SLIPPAGE_BPS must be 1..1000.');
  if (!HELIUS_API_KEY && (!process.env.SOLANA_RPC_URL || !process.env.SOLANA_WS_URL)) {
    throw new Error('HELIUS_API_KEY is required unless SOLANA_RPC_URL and SOLANA_WS_URL are set.');
  }
  if (GMGN_ENABLED && !GMGN_API_KEY) throw new Error('GMGN_API_KEY is required unless GMGN_ENABLED=false.');
  if (TRADING_MODE === 'live' && !ALLOW_LIVE_TRADING) {
    console.log('[risk] TRADING_MODE=live but ALLOW_LIVE_TRADING=false; buys will be blocked by risk engine.');
  }
}
