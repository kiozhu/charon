#!/home/ubuntu/.hermes/venv/bin/python3
"""
Generates PnL chart from Charon2 SQLite DB.
Outputs to /home/ubuntu/charon2/scripts/pnl_chart.png
"""
import sys
import os
import sqlite3
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime, timedelta, UTC
import numpy as np

DB_PATH = '/home/ubuntu/charon2/charon.sqlite'
OUT_PATH = '/home/ubuntu/charon2/scripts/pnl_chart.png'
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

con = sqlite3.connect(DB_PATH)
con.row_factory = sqlite3.Row

# Get last 30 days of closed positions
since = datetime.now(UTC) - timedelta(days=30)
since_ms = int(since.timestamp() * 1000)

rows = con.execute("""
    SELECT closed_at_ms, pnl_sol, pnl_percent, exit_reason, symbol, mint
    FROM dry_run_positions
    WHERE status = 'closed' AND pnl_sol IS NOT NULL AND closed_at_ms >= ?
    ORDER BY closed_at_ms ASC
""", (since_ms,)).fetchall()

if not rows:
    print("No closed positions in last 30 days — skip chart")
    sys.exit(0)

dates = [datetime.fromtimestamp(r['closed_at_ms'] / 1000) for r in rows]
pnl_sol = [float(r['pnl_sol']) for r in rows]
pnl_cum = np.cumsum(pnl_sol)

wins = [p for p in pnl_sol if p >= 0]
losses = [p for p in pnl_sol if p < 0]

total_pnl = sum(pnl_sol)
win_rate = len(wins) / len(pnl_sol) * 100 if pnl_sol else 0

fig, axes = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={'height_ratios': [3, 1]})
fig.patch.set_facecolor('#0d1117')
for ax in axes:
    ax.set_facecolor('#161b22')
    ax.tick_params(colors='#c9d1d9', labelsize=9)
    ax.spines['bottom'].set_color('#30363d')
    ax.spines['left'].set_color('#30363d')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.yaxis.label.set_color('#c9d1d9')
    ax.xaxis.label.set_color('#c9d1d9')
    ax.title.set_color('#e6edf3')

# --- Top: Cumulative PnL ---
ax = axes[0]
ax.plot(dates, pnl_cum, color='#58a6ff', linewidth=2, label='Cumulative PnL (SOL)')
ax.fill_between(dates, pnl_cum, 0, where=(np.array(pnl_cum) >= 0), color='#238636', alpha=0.3)
ax.fill_between(dates, pnl_cum, 0, where=(np.array(pnl_cum) < 0), color='#da3633', alpha=0.3)
ax.axhline(0, color='#30363d', linewidth=1)

# scatter winners / losers
for i, (d, p) in enumerate(zip(dates, pnl_sol)):
    color = '#238636' if p >= 0 else '#da3633'
    ax.scatter([d], [pnl_cum[i]], color=color, s=30, zorder=5)

ax.set_title(f'Charon2 PnL — Last 30 Days  |  Total: {'+' if total_pnl >= 0 else ''}{total_pnl:.4f} SOL  |  WR: {win_rate:.0f}%', fontsize=12, fontweight='bold')
ax.set_ylabel('PnL (SOL)', fontsize=10)
ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
ax.xaxis.set_major_locator(mdates.DayLocator(interval=5))
ax.legend(facecolor='#21262d', edgecolor='#30363d', labelcolor='#c9d1d9')
ax.grid(True, alpha=0.1, color='#30363d')

# --- Bottom: Daily PnL bar ---
ax = axes[1]
daily = {}
for d, p in zip(dates, pnl_sol):
    day = d.strftime('%Y-%m-%d')
    daily[day] = daily.get(day, 0) + p

days = sorted(daily.keys())
vals = [daily[d] for d in days]
colors = ['#238636' if v >= 0 else '#da3633' for v in vals]
day_dates = [datetime.strptime(d, '%Y-%m-%d') for d in days]

ax.bar(day_dates, vals, color=colors, width=0.8, alpha=0.8)
ax.axhline(0, color='#30363d', linewidth=1)
ax.set_title('Daily PnL', fontsize=10)
ax.set_ylabel('SOL', fontsize=10)
ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d'))
ax.xaxis.set_major_locator(mdates.DayLocator(interval=5))
ax.grid(True, alpha=0.1, color='#30363d', axis='y')

plt.tight_layout(pad=1.5)
plt.savefig(OUT_PATH, dpi=120, bbox_inches='tight', facecolor=fig.get_facecolor())
plt.close()
print(f"Chart saved: {OUT_PATH}")