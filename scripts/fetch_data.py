"""Collect S&P 500 data and compute factor metrics.

Writes docs/data/metrics.json, which the dashboard reads.

Metrics
  Earnings yield   = TTM net income / market cap
  FCF yield        = TTM free cash flow / market cap
  Book-to-market   = shareholders' equity / market cap
  ROE              = TTM net income / average shareholders' equity
  Debt-to-equity   = total debt / shareholders' equity
  Momentum (12-1)  = price 1 month ago / price 12 months ago - 1

Market cap uses the latest official close (the previous session's close
when the dashboard is viewed the next day).
"""

from __future__ import annotations

import io
import json
import math
import sys
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data" / "metrics.json"
CACHE = ROOT / "data" / "fundamentals.json"
WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
NY = ZoneInfo("America/New_York")
MIN_OK = 450          # refuse to overwrite good data with a bad run
WORKERS = 4
SKIP_DAYS = 21        # ~1 trading month
LOOKBACK_DAYS = 252   # ~12 trading months

METRIC_KEYS = ["earnings_yield", "fcf_yield", "book_to_market", "roe", "debt_to_equity", "momentum"]


# ---------------------------------------------------------------- universe
def get_constituents() -> pd.DataFrame:
    html = requests.get(WIKI_URL, headers={"User-Agent": "Mozilla/5.0 (sp500-dashboard)"}, timeout=30).text
    table = pd.read_html(io.StringIO(html), attrs={"id": "constituents"})[0]
    df = pd.DataFrame({
        "symbol": table["Symbol"].astype(str).str.strip(),
        "name": table["Security"].astype(str).str.strip(),
        "sector": table["GICS Sector"].astype(str).str.strip(),
    })
    df["yahoo"] = df["symbol"].str.replace(".", "-", regex=False)
    return df


# ---------------------------------------------------------------- prices
def get_prices(tickers: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (close, adj_close) daily frames, one column per ticker.

    close     = actual traded close (split-adjusted only). Used for the price
                shown, market cap and the monthly-average chart.
    adj_close = also adjusted for dividends. Used for momentum (total return).
    """
    data = yf.download(tickers, period="14mo", interval="1d", auto_adjust=False,
                       progress=False, threads=True, group_by="column")
    multi = isinstance(data.columns, pd.MultiIndex)
    close = (data["Close"] if multi else data[["Close"]]).sort_index().dropna(axis=1, how="all")
    adj = (data["Adj Close"] if multi else data[["Adj Close"]]).sort_index().reindex(columns=close.columns)
    if close.shape[1] < len(tickers) * 0.5:
        raise SystemExit(f"Price download failed for most tickers ({close.shape[1]}/{len(tickers)} ok). "
                         "Yahoo is probably rate-limiting this machine; try again later.")
    # Retry tickers whose batch download failed (rate limits / cache locks).
    missing = [t for t in tickers if t not in close.columns or close[t].dropna().empty]
    for t in missing:
        for attempt in range(3):
            try:
                h = yf.Ticker(t).history(period="14mo", interval="1d", auto_adjust=False)
                if len(h):
                    h.index = h.index.tz_localize(None).normalize()
                    close[t] = h["Close"].reindex(close.index)
                    adj[t] = h["Adj Close"].reindex(close.index)
                    break
            except Exception:
                pass
            time.sleep(2 + attempt * 3)
    # Drop a partial bar if run while today's session is still open.
    now_ny = datetime.now(NY)
    last = close.index[-1].date()
    if last == now_ny.date() and (now_ny.hour, now_ny.minute) < (16, 30):
        close, adj = close.iloc[:-1], adj.iloc[:-1]
    return close, adj


def monthly_averages(s: pd.Series, months: int = 12) -> list[dict]:
    """Average daily close per calendar month for the last `months` months.

    The latest month is flagged partial when trading days remain in it.
    """
    s = s.dropna()
    if s.empty:
        return []
    g = s.groupby(s.index.to_period("M"))
    avg, days = g.mean(), g.size()
    lo, hi = g.min(), g.max()
    out = [{"month": str(p), "avg": round(float(avg[p]), 2), "days": int(days[p]),
            "low": round(float(lo[p]), 2), "high": round(float(hi[p]), 2)} for p in avg.index[-months:]]
    last_date = s.index[-1]
    next_bday = last_date + pd.offsets.BDay(1)
    if next_bday.to_period("M") == last_date.to_period("M"):
        out[-1]["partial"] = True
        out[-1]["through"] = str(last_date.date())
    return out


# ---------------------------------------------------------------- fundamentals
def _row(df: pd.DataFrame | None, names: list[str]) -> pd.Series | None:
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            s = df.loc[n]
            if isinstance(s, pd.DataFrame):
                s = s.iloc[0]
            s = pd.to_numeric(s, errors="coerce")
            # columns are period-end dates; newest first
            s = s[sorted(s.index, reverse=True)]
            return s
    return None


def _ttm(q: pd.Series | None, a: pd.Series | None):
    """Sum of last 4 quarters; fall back to latest fiscal year."""
    if q is not None:
        last4 = q.iloc[:4]
        if len(last4) == 4 and last4.notna().all():
            return float(last4.sum()), "last 4 quarters to %s" % last4.index[0].date()
    if a is not None:
        a = a.dropna()
        if len(a):
            return float(a.iloc[0]), "Fiscal year ending %s" % a.index[0].date()
    return None, None


def _latest(s: pd.Series | None):
    if s is None:
        return None, None
    s = s.dropna()
    if not len(s):
        return None, None
    return float(s.iloc[0]), str(s.index[0].date())


def get_fundamentals(ticker: str) -> dict:
    last_err = None
    for attempt in range(3):
        try:
            t = yf.Ticker(ticker)
            qi, ai = t.quarterly_income_stmt, t.income_stmt
            qc, ac = t.quarterly_cashflow, t.cashflow
            qb, ab = t.quarterly_balance_sheet, t.balance_sheet
            # Yahoo throttling shows up as silently empty statements: retry.
            if (qi is None or qi.empty) and (ai is None or ai.empty) or (qb is None or qb.empty) and (ab is None or ab.empty):
                raise RuntimeError("empty financial statements (likely rate-limited)")

            ni_names = ["Net Income Common Stockholders", "Net Income", "Net Income Including Noncontrolling Interests"]
            net_income, ni_period = _ttm(_row(qi, ni_names), _row(ai, ni_names))

            ocf_n = ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"]
            capex_n = ["Capital Expenditure"]
            q_ocf, q_capex = _row(qc, ocf_n), _row(qc, capex_n)
            a_ocf, a_capex = _row(ac, ocf_n), _row(ac, capex_n)
            ocf, ocf_period = _ttm(q_ocf, a_ocf)
            capex, _ = _ttm(q_capex, a_capex)
            if ocf is not None and capex is None:
                capex = 0.0  # some financials report no capex line

            eq_names = ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"]
            q_eq = _row(qb, eq_names)
            if q_eq is None or q_eq.dropna().empty:
                q_eq = _row(ab, eq_names)
            equity, bs_date = _latest(q_eq)
            equity_prior, equity_prior_date = None, None
            if q_eq is not None:
                eqd = q_eq.dropna()
                if len(eqd) >= 5:
                    equity_prior, equity_prior_date = float(eqd.iloc[4]), str(eqd.index[4].date())

            debt_row = _row(qb, ["Total Debt"])
            if debt_row is None or debt_row.dropna().empty:
                debt_row = _row(ab, ["Total Debt"])
            debt, _ = _latest(debt_row)
            if debt is None:
                debt = 0.0 if equity is not None else None

            shares, shares_src = _latest(_row(qb, ["Ordinary Shares Number", "Share Issued"]))
            shares_src = "balance sheet %s" % shares_src if shares else None
            try:
                fi_shares = t.fast_info.get("shares")
            except Exception:
                fi_shares = None
            if fi_shares and (not shares or abs(fi_shares - shares) / shares > 0.25 and fi_shares > shares):
                shares, shares_src = float(fi_shares), "Yahoo shares outstanding"
            if not shares and fi_shares:
                shares, shares_src = float(fi_shares), "Yahoo shares outstanding"

            return {
                "net_income": net_income, "ni_period": ni_period,
                "ocf": ocf, "capex": capex, "cf_period": ocf_period,
                "equity": equity, "equity_date": bs_date,
                "equity_prior": equity_prior, "equity_prior_date": equity_prior_date,
                "debt": debt, "shares": shares, "shares_src": shares_src,
            }
        except Exception as e:  # rate limits, transient HTTP errors
            last_err = e
            time.sleep(5 + attempt * 10)
    raise RuntimeError(f"{ticker}: {last_err}")


# ---------------------------------------------------------------- metrics
def ratio(a, b):
    if a is None or b is None or b == 0 or any(map(lambda x: isinstance(x, float) and math.isnan(x), (a, b))):
        return None
    return a / b


def build_record(row, closes: pd.Series, adj_closes: pd.Series, f: dict) -> dict:
    notes = []
    c = closes.dropna()
    price = float(c.iloc[-1]) if len(c) else None
    price_date = str(c.index[-1].date()) if len(c) else None

    # Momentum uses dividend-adjusted prices (total return); fall back to raw.
    s = adj_closes.dropna()
    if len(s) < len(c):
        s = c
    mom = None
    mom_inputs = None
    if len(s) > LOOKBACK_DAYS:
        p_end, p_start = float(s.iloc[-1 - SKIP_DAYS]), float(s.iloc[-1 - LOOKBACK_DAYS])
        mom = p_end / p_start - 1
        mom_inputs = {"price_start": p_start, "date_start": str(s.index[-1 - LOOKBACK_DAYS].date()),
                      "price_end": p_end, "date_end": str(s.index[-1 - SKIP_DAYS].date())}
    elif price is None:
        notes.append("No recent price data, so price-based metrics are not available.")
    else:
        notes.append("Less than 12 months of price history, so momentum is not available.")

    mcap = price * f["shares"] if price and f["shares"] else None
    fcf = f["ocf"] + f["capex"] if f["ocf"] is not None and f["capex"] is not None else None
    eq = f["equity"]
    avg_eq = (eq + f["equity_prior"]) / 2 if eq is not None and f["equity_prior"] is not None else eq

    if eq is not None and eq <= 0:
        notes.append("Shareholders' equity is negative, so book-to-market, ROE and debt-to-equity are not meaningful.")

    metrics = {
        "earnings_yield": ratio(f["net_income"], mcap),
        "fcf_yield": ratio(fcf, mcap),
        "book_to_market": ratio(eq, mcap) if eq and eq > 0 else None,
        "roe": ratio(f["net_income"], avg_eq) if avg_eq and avg_eq > 0 else None,
        "debt_to_equity": ratio(f["debt"], eq) if eq and eq > 0 else None,
        "momentum": mom,
    }
    return {
        "ticker": row.symbol, "name": row.name, "sector": row.sector,
        "price": price, "price_date": price_date,
        "shares": f["shares"], "shares_src": f["shares_src"], "market_cap": mcap,
        "inputs": {
            "net_income": f["net_income"], "ni_period": f["ni_period"],
            "operating_cash_flow": f["ocf"], "capex": f["capex"], "fcf": fcf, "cf_period": f["cf_period"],
            "equity": eq, "equity_date": f["equity_date"],
            "equity_prior": f["equity_prior"], "equity_prior_date": f["equity_prior_date"],
            "avg_equity": avg_eq, "debt": f["debt"],
            "momentum": mom_inputs,
        },
        "metrics": metrics,
        "monthly": monthly_averages(closes),
        "notes": notes,
    }


def add_percentiles(stocks: list[dict]) -> None:
    for k in METRIC_KEYS:
        vals = sorted(v for v in (s["metrics"][k] for s in stocks) if v is not None)
        n = len(vals)
        for s in stocks:
            v = s["metrics"][k]
            if v is None or n < 2:
                s.setdefault("percentiles", {})[k] = None
                continue
            below = sum(1 for x in vals if x < v)
            s.setdefault("percentiles", {})[k] = round(100 * below / (n - 1))


def clean(o):
    if isinstance(o, float):
        return None if math.isnan(o) or math.isinf(o) else round(o, 6)
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    return o


# ---------------------------------------------------------------- fundamentals cache
# Statements change only when companies report, so each ticker is refetched
# every 5-9 days (staggered by ticker) instead of daily. This keeps the daily
# job well under Yahoo's rate limits.
def load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(clean(cache), indent=0, sort_keys=True), encoding="utf-8")


def is_stale(ticker: str, entry: dict | None, today) -> bool:
    if not entry or entry.get("equity") is None or entry.get("net_income") is None or not entry.get("shares"):
        return True
    age = (today - datetime.strptime(entry["fetched"], "%Y-%m-%d").date()).days
    return age >= 5 + zlib.crc32(ticker.encode()) % 5


# ---------------------------------------------------------------- main
def main(limit: int | None = None) -> int:
    cons = get_constituents()
    if limit:
        cons = cons.head(limit)
    tickers = cons["yahoo"].tolist()
    print(f"{len(tickers)} constituents")

    closes, adj_closes = get_prices(tickers)
    as_of = str(closes.index[-1].date())
    print(f"prices to {as_of}")

    cache = load_cache()
    today = datetime.now(timezone.utc).date()
    todo = [t for t in tickers if is_stale(t, cache.get(t), today)]
    print(f"fundamentals: {len(tickers) - len(todo)} cached, {len(todo)} to fetch")

    failed = []
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(get_fundamentals, t): t for t in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            t = futs[fut]
            try:
                cache[t] = {**fut.result(), "fetched": str(today)}
            except Exception as e:
                failed.append(t)
                print("  failed", e, file=sys.stderr)
            if i % 50 == 0:
                print(f"  fundamentals {i}/{len(todo)}")

    # Second, slower pass for anything that failed (usually rate limiting).
    if failed:
        print(f"retrying {len(failed)} tickers slowly")
        time.sleep(30)
        still = []
        for t in failed:
            try:
                cache[t] = {**get_fundamentals(t), "fetched": str(today)}
            except Exception as e:
                still.append(t)
                print("  failed again", e, file=sys.stderr)
            time.sleep(1)
        failed = still
    save_cache(cache)
    fund = {t: cache[t] for t in tickers if t in cache}
    print(f"{len(failed)} could not be refreshed" + (" (older cached figures kept where available)" if failed else ""))

    # Previous output, used when a stock's price can't be downloaded today.
    previous = {}
    if OUT.exists():
        try:
            previous = {s["ticker"]: s for s in json.loads(OUT.read_text(encoding="utf-8"))["stocks"]}
        except Exception:
            pass

    stocks, stale, dropped = [], [], []
    for row in cons.itertuples(index=False):
        if row.yahoo in fund and row.yahoo in closes.columns:
            stocks.append(build_record(row, closes[row.yahoo], adj_closes[row.yahoo], fund[row.yahoo]))
        elif row.symbol in previous:
            old = previous[row.symbol]
            note = f"Today's price could not be downloaded, so these figures use the close on {old.get('price_date')}."
            old["notes"] = [n for n in old.get("notes", []) if not n.startswith("Today's price")] + [note]
            stocks.append(old)
            stale.append(row.symbol)
        else:
            dropped.append(row.symbol)
    add_percentiles(stocks)
    stocks.sort(key=lambda s: s["ticker"])

    print(f"{len(stocks)} stocks written")
    if stale:
        print(f"  {len(stale)} kept from the previous run (no price today): {', '.join(stale)}")
    if dropped:
        print(f"  {len(dropped)} left out (no price and no previous data): {', '.join(dropped)}")
    need = MIN_OK if not limit else max(1, int(limit * 0.8))
    if len(stocks) < need:
        print(f"Only {len(stocks)} stocks succeeded (need {need}); not writing output.", file=sys.stderr)
        return 1

    out = {
        "as_of": as_of,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Prices and financial statements from Yahoo Finance via yfinance; constituents from Wikipedia.",
        "count": len(stocks),
        "stocks": stocks,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(clean(out), separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    lim = int(sys.argv[1]) if len(sys.argv) > 1 else None
    sys.exit(main(lim))
