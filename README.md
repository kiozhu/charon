# Charon2

**Charon2** adalah fork yang sangat ditingkatkan dari [Charon](https://github.com/yunus-0x/charon) oleh [yunus-0x](https://github.com/yunus-0x), agen trading Telegram untuk token Pump.fun di Solana.

Fork ini menambahkan **observabilitas tingkat produksi, manajemen risiko, auto-tuning, dan pengamanan** — dibangun untuk trading live berkelanjutan dengan modal nyata.

---

## ⚠️ Disclaimer

> **Codebase ini masih dalam masa testing. Developer Charon asli tidak menjamin hasil apa pun.
> Modifikasi Charon2 bersifat eksperimental. Gunakan dengan risiko Anda sendiri.**

---

## Apa itu Charon2?

Charon2 adalah **agen trading meme-coin Solana** yang:
1. Polling server sinyal untuk peluncuran token Pump.fun baru
2. Menyaring kandidat dengan gerbang strategi + pengambilan keputusan LLM
3. Eksekusi via Jupiter Ultra — dry-run, konfirmasi via Telegram, atau live
4. Memantau posisi terbuka untuk aturan TP/SL/trailing/max-hold

**Charon2 secara spesifik menambahkan:** mesin risiko, auto-tuning, observabilitas, manajemen blacklist, exit cepat saat rugi, filter zona kematian UTC, cooldown keamanan, dan alat monitoring produksi.

---

## 📁 Struktur Proyek

```
charon/
├── index.js              # Entry point dengan safe console + graceful shutdown
├── package.json
├── start.sh              # Helper startup PM2
├── dashboard2.py         # Dashboard PnL Streamlit (Python)
├── perf_chart.html       # Visualizer PnL berbasis browser
├── test/                 # Unit test (llm, risk, telegram, utils)
├── scripts/
│   ├── pnl_chart.py      # Generator grafik PnL CLI
│   └── watchdog.sh       # Script watchdog proses
└── src/
    ├── observability/
    │   └── logger.js     # Log JSON terstruktur, rotasi, redaksi rahasia
    ├── risk/
    │   ├── engine.js     # Mesin evaluasi risiko
    │   ├── guards.js     # Pengaman trading + gerbang persetujuan
    │   ├── blacklist.js  # Manajer blacklist token
    │   └── sizing.js     # Utilitas sizing posisi
    ├── security/
    │   └── telegram.js  # Validasi input Telegram
    ├── learning/
    │   ├── autoTune.js   # Auto-sesuaikan TP/SL/size dari hasil trading
    │   ├── commands.js
    │   ├── lessons.js
    │   ├── report.js
    │   └── summary.js
    ├── telegram/          # Bot, perintah, callback, menu, format, kirim, input
    ├── enrichment/        # gmgn, jupiter, twitter, wallets
    ├── signals/          # axiomSource, feeClaim, graduated, priceMonitor, serverClient, trending
    └── [file inti]      # app, config, utils, liveExecutor, positions,
                          # orchestrator, candidateBuilder, llm, connection, dll.
```

---

## Original vs Charon2 — Apa yang Ditambah/Diubah

### 🆏 Modul BARU (tidak ada di original)

| Modul | File | Deskripsi |
|---|---|---|
| **Observabilitas** | `src/observability/logger.js` | Log JSON terstruktur dengan rotasi log, redaksi rahasia, patching safe console, handler error global |
| **Mesin Risiko** | `src/risk/engine.js` | Batas risiko yang bisa dikonfigurasi (loss harian, max trade, MAX_BUY_SOL), lacak PnL/stats hari ini, evaluasi risiko beli, log risk_events |
| **Pengaman Trading** | `src/risk/guards.js` | Validasi mode trading, emergency stop, periode cooldown, ukuran posisi, cadangan wallet, blacklist token, zona kematian UTC |
| **Blacklist Token** | `src/risk/blacklist.js` | Pemblokiran token manual/auto — persisten di SQLite |
| **Sizing Posisi** | `src/risk/sizing.js` | Utilitas `clampBuySizeSol()` + `solToLamports()` |
| **Keamanan Telegram** | `src/security/telegram.js` | Validasi `chat_id`, thread topik, dan format data callback |
| **Auto-Tune** | `src/learning/autoTune.js` | Analisis trading terakhir → auto-sesuaikan target TP, trailing, SL, max_hold, max_mcap, ukuran posisi |

---

### 🔄 File Inti yang DIMODIFIKASI (dibandingkan original)

| File | Perubahan Utama |
|---|---|
| **`src/config.js`** | Ditambah helper `boolEnv()`, `numEnv()`, keamanan path traversal (`safeDbPath()`), sistem mode trading (`dry_run/confirm/live`), batas risiko (`MAX_BUY_SOL`, `DAILY_MAX_LOSS_SOL`, `MAX_TRADES_PER_DAY`), cooldown (`TOKEN_COOLDOWN_MS`, `LOSS_COOLDOWN_MS`), flag keamanan (`EMERGENCY_STOP`, `REQUIRE_CONFIRMATION_FOR_LIVE`, `ALLOW_LIVE_TRADING`), slippage Jupiter di-clamp 1–1000, timeout LLM di-clamp 5–120s |
| **`src/utils.js`** | Ditambah `redactSecrets()`, `retryWithBackoff()`, `createCircuitBreaker()` |
| **`src/app.js`** | Ditambah `stopCharon()` graceful shutdown, helper interval `every()`, `startupSummary()`, initLearningTables, logging aman |
| **`src/liveExecutor.js`** | `retryWithBackoff()` terintegrasi ke panggilan API Jupiter (order + execute) |
| **`src/execution/positions.js`** | Exit FAST_LOSS (-5% dalam 45s → exit langsung), pendingin 5 menit setelah rugi, MAX_HOLD cerdas (profit→breakeven+60s, rugi→exit langsung), TP parsial saat TP tercapai, lewati usia posisi (<30s), pelacakan PnL Jupiter, hook `onPositionClosed()` |
| **`src/pipeline/orchestrator.js`** | Evaluasi mesin risiko sebelum eksekusi, min confidence efektif = max(strat, 50), default TP→30%, SL→-20%, max_open_positions→10 |
| **`src/pipeline/candidateBuilder.js`** | Filter zona kematian UTC (13:00–18:00 UTC blokir entri karena rata-rata PnL -12% yang diamati) |
| **`src/pipeline/llm.js`** | `validateLlmDecision()` membungkus hasil, default TP→30%, SL→-20%, aksi `SKIP` ditambahkan, prompt menekankan peluang asimetris |
| **`src/db/connection.js`** | Tabel baru: `decisions`, `positions`, `intents`, `risk_events`, `pending_approvals`, `blacklist`, `daily_stats`, `lessons`, `tool_errors`. Default baru: `max_open_positions: 10`, `dry_run_buy_sol: 0.01`, `default_tp_percent: 30`, `default_sl_percent: -20` |
| **`index.js`** | `installSafeConsole()`, handler `unhandledRejection` + `uncaughtException`, graceful shutdown SIGINT/SIGTERM, `startupSummary()` |

---

### 📊 Perubahan Nilai Default

| Pengaturan | Original | Charon2 |
|---|---|---|
| `max_open_positions` | 3 | **10** |
| `dry_run_buy_sol` | 0.1 | **0.01** |
| `default_tp_percent` | 50 | **30** |
| `default_sl_percent` | -25 | **-20** |
| `llm_timeout_ms` | 60,000 | **30,000** |
| User-Agent | Berbagai | `Charon/1.0` |

---

### 🚀 Fitur Baru

1. **Observabilitas & Logging Terstruktur** — Log JSON dipisah ke `app.log`, `error.log`, `trades.log`. Rotasi otomatis di `LOG_MAX_BYTES`. Redaksi rahasia di semua tulisan.

2. **Mesin Risiko** — Pelacakan PnL harian, batas loss, kap trading, clamp MAX_BUY_SOL. Setiap keputusan risiko di-log ke SQLite.

3. **Zona Kematian UTC** — UTC 13:00–18:00 diblokir untuk entri baru (PnL rata-rata -12% yang diamati selama tekanan jual sore hari).

4. **Exit FAST_LOSS** — Loss -5% dalam 45 detik memicu exit posisi langsung (escape dump micro-cap).

5. **MAX_HOLD Cerdas** — Saat posisi kedaluwarsa: jika profit → SL→breakeven + perpanjangan 60s; jika rugi → exit langsung.

6. **Pembelajaran Auto-Tune** — Setelah setiap posisi ditutup: analisis window 4 jam → sesuaikan target TP, trailing, SL, max_hold, max_mcap, ukuran posisi.

7. **Mode Trading** — `dry_run` / `confirm` / `live` dengan flag `REQUIRE_CONFIRMATION_FOR_LIVE` dan gerbang persetujuan Telegram.

8. **Emergency Stop** — `EMERGENCY_STOP=1` hentikan semua trading secara instan.

9. **Cooldown Token** — Setelah trading rugi, cooldown 5 menit sebelum token yang sama bisa dimasuki lagi.

10. **Take-Profit Parsial** — Jual parsial berbasis strategi saat TP% tercapai.

11. **Circuit Breaker + Retry** — Retry exponential backoff saat kegagalan API Jupiter.

12. **Manajemen Blacklist** — `/blacklist add <mint>`, `/blacklist remove <mint>`, `/blacklist list`

---

## Setup

```bash
git clone git@github.com:kiozhu/charon.git
cd charon
npm install
cp .env.example .env
# Edit .env dengan kredensial Anda
npm start
```

Untuk PM2:
```bash
pm2 start index.js --name charon2
pm2 save
```

---

## Perintah Telegram

```
/menu             # Menu interaktif
/strategy         # Lihat/ubah strategi
/stratset <s> <k> <v>  # Atur param strategi
/positions        # Daftar posisi terbuka
/candidate <mint> # Cari token
/filters          # Tampilkan filter saat ini
/pnl              # Tampilkan ringkasan PnL
/learn <window>   # Jalankan analisis pembelajaran
/lessons          # Tampilkan pelajaran yang dipelajari
/blacklist add <mint>   # Tambah ke blacklist
/blacklist remove <mint> # Hapus dari blacklist
/blacklist list        # Tampilkan token yang di-blacklist
/walletadd <label> <alamat>
/wallets          # Daftar wallet yang dilacak
```

---

## Perbedaan dari Charon Asli oleh yunus-0x

| Aspek | Original (yunus) | Charon2 |
|---|---|---|
| **Logging** | console.log | File JSON terstruktur, rotasi, redaksi rahasia |
| **Manajemen Risiko** | Config dasar | Mesin risiko lengkap + pengaman + batas harian |
| **Exit Posisi** | TP/SL/max_hold | FAST_LOSS + MAX_HOLD cerdas + TP parsial |
| **Pembelajaran** | lessons.js saja | autoTune.js + lessons + report + summary |
| **Keamanan** | Tidak ada | Emergency stop, cooldown, filter zona kematian |
| **Blacklist** | Tidak ada | Blacklist token berbasis SQLite |
| **Observabilitas** | Tidak ada | Logger + handler error + safe console |
| **Resiliensi** | Retry dasar | Circuit breaker + exponential backoff |
| **Mode Trading** | dry_run/confirm/live | Sama + gerbang persetujuan + flag keamanan |
| **Timeout LLM** | 60s default | 30s default, di-clamp 5–120s |

---

## Kredit

- **Original:** [yunus-0x/charon](https://github.com/yunus-0x/charon) — agen trading dasar
- **Fork & Peningkatan:** MUFASA — mesin risiko, auto-tune, observabilitas, pengamanan, manajemen posisi cerdas

---

## Lisensi
