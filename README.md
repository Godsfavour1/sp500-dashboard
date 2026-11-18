# S&P 500 Factor Lens

A static dashboard showing six metrics for every S&P 500 stock: earnings yield, FCF yield, book-to-market, ROE, debt-to-equity and 12-1 month momentum. Pick a stock, click a metric, and see its definition, formula and the worked calculation.

- `scripts/fetch_data.py` collects constituents (Wikipedia), prices and financial statements (Yahoo Finance via `yfinance`), computes the metrics and writes `docs/data/metrics.json`.
- `docs/` is the website (plain HTML/CSS/JS), served by GitHub Pages.
- `.github/workflows/refresh.yml` reruns the script every weekday at 22:30 UTC (after the US close) and commits fresh data.

## Run locally

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python scripts/fetch_data.py                # full run, ~5–15 min
.venv/Scripts/python scripts/fetch_data.py 20             # quick test on 20 stocks
python -m http.server 8000 -d docs                        # open http://localhost:8000
```

## Scripts

| Script | What it does |
|---|---|
| `scripts/fetch_data.py` | Collects data and writes `docs/data/metrics.json`. Add a number to test on fewer stocks: `fetch_data.py 20`. |
| `scripts/fetch_with_retry.sh` | Runs `fetch_data.py`, retrying every 10 minutes if Yahoo is rate-limiting (`bash scripts/fetch_with_retry.sh`). |
| `scripts/check_data.py` | Summarises the data file: missing values, negative-equity stocks, spot checks (`check_data.py AAPL MCD`). |
| `scripts/rebuild_cache.py` | Refills `data/fundamentals.json` from `metrics.json` if the cache is lost. Never removes entries. |
| `scripts/serve.sh` | Serves the dashboard at http://localhost:8000 (`bash scripts/serve.sh`). |
| `scripts/screenshot.sh` | Saves desktop and phone screenshots to `screenshots/` and checks the phone layout (server must be running). |

If a stock's price can't be downloaded on a given day, `fetch_data.py` keeps that stock's previous figures and shows a note on its page instead of dropping it.

## Publish on GitHub Pages

1. Create an empty public repo on GitHub, e.g. `sp500-dashboard`.
2. From this folder:
   ```bash
   git init -b main
   git add .
   git commit -m "Initial dashboard"
   git remote add origin https://github.com/<you>/sp500-dashboard.git
   git push -u origin main
   ```
3. Repo **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder = `/docs`. Save.
4. Repo **Settings → Actions → General → Workflow permissions**: choose *Read and write permissions*.
5. **Actions** tab → *Refresh S&P 500 data* → *Run workflow* once to test it.

Your link will be `https://<you>.github.io/sp500-dashboard/`. A single stock can be linked directly, e.g. `…/sp500-dashboard/#NVDA`.

## Metric definitions

| Metric | Formula |
|---|---|
| Earnings yield | TTM net income ÷ market cap |
| FCF yield | (TTM operating cash flow − capex) ÷ market cap |
| Book-to-market | shareholders' equity ÷ market cap |
| ROE | TTM net income ÷ average equity (now and one year earlier) |
| Debt-to-equity | total debt ÷ shareholders' equity |
| Momentum (12-1) | price 21 trading days ago ÷ price 252 trading days ago − 1 |

Market cap = latest official close × shares outstanding. TTM = sum of the last four reported quarters (falls back to the last fiscal year). Stocks with negative equity show n/a for book-to-market-based ratios that aren't meaningful.

## Fundamentals cache

Financial statements are cached in `data/fundamentals.json`. Each stock's statements are refetched every 5–9 days (staggered), and prices are refetched on every run. This keeps the daily job well under Yahoo's rate limits. Delete the file to force a full refetch.

## Caveats

`yfinance` is an unofficial, free Yahoo Finance wrapper. Fields are occasionally missing and Yahoo may rate-limit. Fundamentals change only when companies report (quarterly); price and momentum update daily. To switch to a paid data source, only `fetch_data.py` needs changing.
