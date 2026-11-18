"""Rebuild data/fundamentals.json from docs/data/metrics.json.

Use this if the cache file is lost or incomplete but metrics.json is fine,
so the next fetch doesn't have to download every company's statements
again (which can trigger Yahoo rate limits). Existing cache entries are
kept; only stocks missing from the cache are added. Anything still
missing is refetched on the next run of fetch_data.py.

Usage:
  python scripts/rebuild_cache.py
"""

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METRICS = ROOT / "docs" / "data" / "metrics.json"
CACHE = ROOT / "data" / "fundamentals.json"


def main() -> None:
    d = json.loads(METRICS.read_text(encoding="utf-8"))
    # Mark entries with the date the metrics were generated, so they age normally.
    fetched = d.get("generated_at", str(date.today()))[:10]
    # Merge into any existing cache: entries already there are never removed.
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    before = len(cache)
    for s in d["stocks"]:
        i = s["inputs"]
        if i["equity"] is None or i["net_income"] is None or not s["shares"]:
            continue
        key = s["ticker"].replace(".", "-")
        if key in cache:
            continue
        cache[key] = {
            "net_income": i["net_income"], "ni_period": i["ni_period"],
            "ocf": i["operating_cash_flow"], "capex": i["capex"], "cf_period": i["cf_period"],
            "equity": i["equity"], "equity_date": i["equity_date"],
            "equity_prior": i["equity_prior"], "equity_prior_date": i["equity_prior_date"],
            "debt": i["debt"], "shares": s["shares"], "shares_src": s["shares_src"],
            "fetched": fetched,
        }
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    print(f"Cache now has {len(cache)} stocks ({len(cache) - before} added from metrics.json): {CACHE}")


if __name__ == "__main__":
    main()
