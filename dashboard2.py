# =========================================================
# ENVO TRADING BOT - ULTRA PROFESSIONAL DASHBOARD
# OPTIMIZED LOW MEMORY VERSION
# POWERED BY CHARON
# =========================================================

import streamlit as st
import pandas as pd
import sqlite3
import plotly.graph_objects as go
import calendar
from datetime import datetime
import pytz
import gc

# =========================================================
# CONFIG
# =========================================================

DB_PATH = "charon.sqlite"
SOL_TO_IDR = 2500000
WIB = pytz.timezone("Asia/Jakarta")
MAX_DB_ROWS = 1000

# =========================================================
# PAGE CONFIG
# =========================================================

st.set_page_config(
    page_title="Envo Trading Bot",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# =========================================================
# CSS
# =========================================================

st.markdown("""
<style>

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', sans-serif;
}

.stApp {
    background:
    radial-gradient(circle at top left, #132238 0%, transparent 30%),
    radial-gradient(circle at top right, #0D1A2B 0%, transparent 30%),
    linear-gradient(135deg, #050816 0%, #07111F 100%);
    color: white;
}

/* =========================================================
SIDEBAR
========================================================= */

section[data-testid="stSidebar"] {
    background: rgba(5,8,22,0.96);
    border-right: 1px solid rgba(255,255,255,0.05);
    min-width: 260px !important;
}

section[data-testid="stSidebar"] > div {
    padding-top: 1rem;
}

/* =========================================================
MAIN LAYOUT
========================================================= */

.main .block-container {
    padding-top: 2rem;
    padding-left: 2.5rem;
    padding-right: 2.5rem;
    padding-bottom: 2rem;
    max-width: 1600px;
}

/* =========================================================
CARDS
========================================================= */

.metric-card {
    background: rgba(17,25,40,0.78);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 24px;
    padding: 24px;
    backdrop-filter: blur(6px);
    transition: 0.25s;
    min-height: 150px;
}

.metric-card:hover {
    transform: translateY(-4px);
    border: 1px solid rgba(0,255,170,0.25);
}

.metric-title {
    color: #94A3B8;
    font-size: 14px;
    margin-top: 12px;
}

.metric-value {
    font-size: 28px;
    font-weight: 800;
    margin-top: 10px;
    line-height: 1.2;
}

/* =========================================================
SECTION BOX
========================================================= */

.section-box {
    background: rgba(17,25,40,0.72);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 24px;
    padding: 28px;
    margin-top: 24px;
    backdrop-filter: blur(4px);
}

/* =========================================================
CALENDAR
========================================================= */

.calendar-day {
    background: rgba(255,255,255,0.03);
    border-radius: 20px;
    padding: 16px;
    min-height: 120px;
    border: 1px solid rgba(255,255,255,0.05);
    transition: 0.2s;
    margin-bottom: 12px;
}

.calendar-day:hover {
    transform: scale(1.02);
}

.green-day {
    background: linear-gradient(
        135deg,
        rgba(0,255,170,0.22),
        rgba(0,180,120,0.12)
    );
    border: 1px solid rgba(0,255,170,0.35);
    box-shadow: 0 0 16px rgba(0,255,170,0.10);
}

.red-day {
    background: linear-gradient(
        135deg,
        rgba(255,0,80,0.20),
        rgba(180,0,40,0.12)
    );
    border: 1px solid rgba(255,0,80,0.30);
    box-shadow: 0 0 16px rgba(255,0,80,0.08);
}

.day-number {
    font-size: 16px;
    font-weight: 700;
    color: white;
}

.day-pnl {
    font-size: 16px;
    font-weight: 800;
    margin-top: 16px;
    line-height: 1.5;
}

.weekday {
    text-align: center;
    color: #94A3B8;
    margin-bottom: 14px;
    font-weight: 700;
}

/* =========================================================
DATAFRAME
========================================================= */

[data-testid="stDataFrame"] {
    border-radius: 20px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.05);
}

/* =========================================================
PLOTLY
========================================================= */

.js-plotly-plot {
    border-radius: 20px;
    overflow: hidden;
}

/* =========================================================
TOP SPACING
========================================================= */

h1, h2, h3 {
    margin-top: 0.5rem !important;
}

</style>
""", unsafe_allow_html=True)

# =========================================================
# HELPERS
# =========================================================

def format_sol(value):

    try:
        value = float(value)
    except:
        value = 0

    idr = value * SOL_TO_IDR

    return f"{value:.4f} SOL (Rp {idr:,.0f})"

# =========================================================
# DATABASE
# =========================================================

@st.cache_data(ttl=60)
def load_database():

    conn = sqlite3.connect(DB_PATH)

    tables = pd.read_sql(
        "SELECT name FROM sqlite_master WHERE type='table';",
        conn
    )

    db = {}

    for table in tables['name']:

        try:

            query = f"""
            SELECT * FROM {table}
            ORDER BY ROWID DESC
            LIMIT {MAX_DB_ROWS}
            """

            db[table] = pd.read_sql(query, conn)

        except:
            pass

    conn.close()

    gc.collect()

    return db

# =========================================================
# LOAD DB
# =========================================================

db = load_database()

# =========================================================
# FIND TABLE
# =========================================================

positions_df = None

possible_tables = [
    "dry_run_positions",
    "dry_run_trades",
    "trade_intents",
    "positions",
    "trades"
]

for t in possible_tables:

    if t in db:
        positions_df = db[t]
        break

if positions_df is None:

    st.error("Trade table tidak ditemukan")
    st.write(list(db.keys()))
    st.stop()

# =========================================================
# DETECT COLUMNS
# =========================================================

pnl_col = None
status_col = None
date_col = None

for c in positions_df.columns:

    cl = c.lower()

    if "pnl" in cl:
        pnl_col = c

    if "status" in cl:
        status_col = c

    if (
        "closed" in cl or
        "created" in cl or
        "time" in cl or
        "date" in cl
    ):
        date_col = c

# =========================================================
# CLEAN
# =========================================================

positions_df[pnl_col] = pd.to_numeric(
    positions_df[pnl_col],
    errors='coerce'
).fillna(0)

# =========================================================
# DATE
# =========================================================

if date_col:

    try:

        positions_df["trade_date"] = pd.to_datetime(
            positions_df[date_col],
            unit="ms",
            errors="coerce"
        )

    except:

        positions_df["trade_date"] = pd.to_datetime(
            positions_df[date_col],
            errors="coerce"
        )

# =========================================================
# STATS
# =========================================================

trades = len(positions_df)

wins = len(
    positions_df[
        positions_df[pnl_col] > 0
    ]
)

winrate = (
    wins / trades * 100
    if trades > 0 else 0
)

total_pnl = positions_df[pnl_col].sum()

best_trade = positions_df[pnl_col].max()
worst_trade = positions_df[pnl_col].min()

pnl_curve = positions_df[pnl_col].cumsum()

# =========================================================
# SIDEBAR
# =========================================================

with st.sidebar:

    st.markdown("# ⚡ ENVO")
    st.caption("Powered by Charon")

    pages = [
        "Dashboard",
        "Trades",
        "Positions",
        "Analytics",
        "Database"
    ]

    selected_page = st.radio(
        "Navigation",
        pages
    )

    st.markdown("---")

    st.success("● LIVE")

    st.metric("Trades", trades)
    st.metric("Win Rate", f"{winrate:.1f}%")
    st.metric("PnL", format_sol(total_pnl))

# =========================================================
# DASHBOARD
# =========================================================

if selected_page == "Dashboard":

    st.title("⚡ Dasbor Perdagangan Envo")
    st.caption("Professional AI Trading Analytics")

    st.markdown("<br>", unsafe_allow_html=True)

    cols = st.columns(5, gap="large")

    cards = [
        ("💰","Total PnL",format_sol(total_pnl)),
        ("🎯","Win Rate",f"{winrate:.1f}%"),
        ("📊","Trades",trades),
        ("🚀","Best Trade",format_sol(best_trade)),
        ("📉","Worst Trade",format_sol(worst_trade))
    ]

    for col,card in zip(cols,cards):

        icon,title,value = card

        with col:

            st.markdown(f"""
            <div class='metric-card'>
            <div style='font-size:32px'>{icon}</div>
            <div class='metric-title'>{title}</div>
            <div class='metric-value'>{value}</div>
            </div>
            """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    # =========================================================
    # PNL CURVE
    # =========================================================

    st.markdown("## 📈 Kurva Laba Rugi")

    fig = go.Figure()

    fig.add_trace(
        go.Scatter(
            y=pnl_curve,
            mode='lines',
            line=dict(
                color='#00FFA3',
                width=4
            ),
            fill='tozeroy',
            fillcolor='rgba(0,255,163,0.08)'
        )
    )

    fig.update_layout(
        template='plotly_dark',
        height=460,
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=10, r=10, t=10, b=10),
        xaxis=dict(showgrid=False),
        yaxis=dict(
            showgrid=True,
            gridcolor='rgba(255,255,255,0.05)'
        )
    )

    st.plotly_chart(
        fig,
        use_container_width=True
    )

    # =========================================================
    # CALENDAR
    # =========================================================

    st.markdown("## 📅 Kalender PNL")

    if date_col:

        calendar_df = positions_df.copy()

        calendar_df["day"] = (
            calendar_df["trade_date"]
            .dt.day
        )

        calendar_df["month"] = (
            calendar_df["trade_date"]
            .dt.month
        )

        calendar_df["year"] = (
            calendar_df["trade_date"]
            .dt.year
        )

        now = datetime.now(WIB)

        current_month = now.month
        current_year = now.year

        month_df = calendar_df[
            (calendar_df["month"] == current_month) &
            (calendar_df["year"] == current_year)
        ]

        daily_pnl = (
            month_df
            .groupby("day")[pnl_col]
            .sum()
            .to_dict()
        )

        month_name = calendar.month_name[current_month]

        st.markdown(
            f"### {month_name} {current_year}"
        )

        weekdays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

        cols = st.columns(7)

        for i,d in enumerate(weekdays):
            cols[i].markdown(
                f"<div class='weekday'>{d}</div>",
                unsafe_allow_html=True
            )

        cal = calendar.monthcalendar(
            current_year,
            current_month
        )

        for week in cal:

            cols = st.columns(7, gap="small")

            for i,day in enumerate(week):

                if day == 0:

                    cols[i].markdown(" ")

                else:

                    pnl = daily_pnl.get(day, 0)

                    color_class = (
                        "green-day"
                        if pnl >= 0
                        else "red-day"
                    )

                    cols[i].markdown(f"""
                    <div class='calendar-day {color_class}'>

                    <div class='day-number'>
                    {day}
                    </div>

                    <div class='day-pnl'>
                    {pnl:.4f} SOL
                    <br>

                    <span style='font-size:12px;color:#CBD5E1'>
                    (Rp {(pnl * SOL_TO_IDR):,.0f})
                    </span>

                    </div>

                    </div>
                    """, unsafe_allow_html=True)

    # =========================================================
    # RECENT TRADES
    # =========================================================

    st.markdown("## 📜 Recent Trades")

    st.dataframe(
        positions_df.tail(50),
        use_container_width=True,
        height=520
    )

# =========================================================
# FOOTER
# =========================================================

current_wib = datetime.now(WIB).strftime("%d %B %Y • %H:%M:%S WIB")

st.markdown("---")

st.caption(
    f"Envo Trading Bot • Powered by Charon • {current_wib}"
)