"""Summarise docs/data/metrics.json and spot-check a few tickers.

Usage:
  python scripts/check_data.py                 # summary + default tickers
  python scripts/check_data.py AAPL NVDA MCD   # summary + chosen tickers
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data" / "metrics.json"


def fmt(v):
    return "n/a" if v is None else f"{v:.4f}"


def main(tickers: list[str]) -> int:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    stocks = d["stocks"]
    print(f"Prices as of {d['as_of']} | {d['count']} stocks | generated {d['generated_at']}")

    print("\nMissing values per metric:")
    for k in stocks[0]["metrics"]:
        missing = [s["ticker"] for s in stocks if s["metrics"][k] is None]
        sample = ", ".join(missing[:8]) + (" ..." if len(missing) > 8 else "")
        print(f"  {k:<16} {len(missing):>3}  {sample}")

    no_fund = [s["ticker"] for s in stocks if s["inputs"]["net_income"] is None or not s["shares"]]
    neg_eq = [s["ticker"] for s in stocks if (s["inputs"]["equity"] or 0) <= 0 and s["inputs"]["equity"] is not None]
    print(f"\nNo fundamentals: {len(no_fund)} {no_fund[:15]}")
    print(f"Negative equity: {len(neg_eq)} {neg_eq[:15]}")

    by = {s["ticker"]: s for s in stocks}
    print("\nSpot checks:")
    for t in tickers:
        s = by.get(t.upper())
        if not s:
            print(f"  {t}: not found")
            continue
        mcap = f"${s['market_cap'] / 1e9:,.1f}B" if s["market_cap"] else "n/a"
        m = "  ".join(f"{k}={fmt(v)}" for k, v in s["metrics"].items())
        print(f"  {s['ticker']:<6} close ${s['price']:,.2f}  mcap {mcap}\n         {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["AAPL", "JPM", "GOOGL", "BRK.B", "NVDA", "MCD"]))
