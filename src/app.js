import { setDefaultResultOrder } from 'node:dns';
import { APP_NAME, SIGNAL_SERVER_URL, SIGNAL_POLL_MS, GRADUATED_POLL_MS, TRENDING_POLL_MS, POSITION_CHECK_MS, validateConfig, DB_PATH, ENABLE_LLM, GMGN_ENABLED, TRADING_MODE, ALLOW_LIVE_TRADING, EMERGENCY_STOP } from './config.js';
import { initDb } from './db/connection.js';
import { initLiveExecution } from './liveExecutor.js';
import { setupTelegram } from './telegram/commands.js';
import { monitorPositions } from './execution/positions.js';
import { initLearningTables } from './learning/autoTune.js';
import { processCandidateFromSignals, maybeProcessDegenCandidate } from './pipeline/orchestrator.js';
import { sendTelegram } from './telegram/send.js';
import { makeFailureTracker } from './utils.js';
import { safeLog } from './observability/logger.js';
import { liveWalletPubkey } from './liveExecutor.js';

setDefaultResultOrder('ipv4first');
validateConfig();

const intervals = [];
function every(fn, ms) {
  const id = setInterval(fn, ms);
  intervals.push(id);
  return id;
}

export async function stopCharon(reason = 'shutdown') {
  for (const id of intervals.splice(0)) clearInterval(id);
  safeLog(`[bot] Charon stopped (${reason})`);
}

export async function startCharon() {
  initDb();
  initLearningTables(); // auto-tune tables
  initLiveExecution();
  setupTelegram();

  if (SIGNAL_SERVER_URL) {
    // ── Server mode: fetch signals from signal server ──────────────────────
    const { fetchServerSignals, setCandidateHandler, setDegenHandler } = await import('./signals/serverClient.js');

    setCandidateHandler(processCandidateFromSignals);
    setDegenHandler(maybeProcessDegenCandidate);

    const alert = (msg) => sendTelegram(msg);
    const trackServer = makeFailureTracker('server signals', alert);
    const trackDip = makeFailureTracker('dip monitor', alert);

    await fetchServerSignals().catch(error => console.log(`[server] initial fetch failed: ${error.message}`));
    every(() => trackServer(() => fetchServerSignals()), SIGNAL_POLL_MS);

    // Price monitor for dip buy strategy
    const { monitorPriceAlerts, cleanupAlerts } = await import('./signals/priceMonitor.js');
    const { setCandidateHandler: setAlertHandler } = await import('./signals/priceMonitor.js');
    setAlertHandler(processCandidateFromSignals);
    every(() => trackDip(() => monitorPriceAlerts()), 10_000);
    every(() => cleanupAlerts(), 60 * 60 * 1000);

    safeLog(`[bot] ${APP_NAME} started (server mode)`);
    safeLog(startupSummary());
  } else {
    // ── Standalone mode: direct polling (legacy) ───────────────────────────
    const { fetchGraduatedCoins } = await import('./signals/graduated.js');
    const { fetchGmgnTrending, setDegenHandler } = await import('./signals/trending.js');
    const { startWebsocket, setCandidateHandler } = await import('./signals/feeClaim.js');

    setDegenHandler(maybeProcessDegenCandidate);
    setCandidateHandler(processCandidateFromSignals);

    await fetchGraduatedCoins().catch(error => console.log(`[graduated] initial fetch failed: ${error.message}`));
    await fetchGmgnTrending().catch(error => console.log(`[trending] initial fetch failed: ${error.message}`));

    every(() => fetchGraduatedCoins().catch(error => console.log(`[graduated] ${error.message}`)), GRADUATED_POLL_MS);
    every(() => fetchGmgnTrending().catch(error => console.log(`[trending] ${error.message}`)), TRENDING_POLL_MS);
    startWebsocket();

    safeLog(`[bot] ${APP_NAME} started (standalone mode)`);
    safeLog(startupSummary());
  }

  // Position monitoring runs in both modes
  const trackPositions = makeFailureTracker('position monitor', (msg) => sendTelegram(msg));
  every(() => trackPositions(() => monitorPositions()), POSITION_CHECK_MS);
}


function startupSummary() {
  return JSON.stringify({
    app: APP_NAME,
    mode: TRADING_MODE,
    allowLiveTrading: ALLOW_LIVE_TRADING,
    emergencyStop: EMERGENCY_STOP,
    dbPath: DB_PATH,
    llmEnabled: ENABLE_LLM,
    gmgnEnabled: GMGN_ENABLED,
    liveWallet: liveWalletPubkey() ? `${liveWalletPubkey().slice(0, 6)}...${liveWalletPubkey().slice(-4)}` : null,
  });
}
