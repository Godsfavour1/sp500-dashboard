"use strict";

// ---------- formatting ----------
const money = (v) => {
  if (v == null) return "n/a";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};
const count = (v) => {
  if (v == null) return "n/a";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString("en-US");
};
const usd = (v) => (v == null ? "n/a" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v) => (v == null ? "n/a" : `${(v * 100).toFixed(2)}%`);
const signedPct = (v) => (v == null ? "n/a" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)}%`);
const times = (v) => (v == null ? "n/a" : `${v.toFixed(2)}×`);
const dec = (v) => (v == null ? "n/a" : v.toFixed(3));
const date = (s) => (s ? new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "n/a");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- metric definitions ----------
// calc(s) returns rows [label, value] — the last row is the result.
const mcapRows = (s) => [
  ["Closing price", `${usd(s.price)} on ${date(s.price_date)}`],
  ["Shares outstanding", count(s.shares)],
  ["Market cap = price × shares", `${usd(s.price)} × ${count(s.shares)} = ${money(s.market_cap)}`],
];

const METRICS = {
  earnings_yield: {
    label: "Earnings yield",
    fmt: pct,
    definition: "How much profit the company earned over the last year for every dollar of its market value. It is the inverse of the P/E ratio, so a higher earnings yield means the stock is cheaper relative to its earnings.",
    formula: "Earnings yield = Net income (TTM) ÷ Market cap",
    read: (v) => `For every $100 of market value, ${v < 0 ? "the company lost" : "the company earned"} about $${Math.abs(v * 100).toFixed(2)} over the last twelve months. That is a P/E of ${v > 0 ? (1 / v).toFixed(1) : "n/a (loss-making)"}.`,
    calc: (s) => [
      ...mcapRows(s),
      ["Net income", `${money(s.inputs.net_income)} · ${s.inputs.ni_period || "period n/a"}`],
      ["Earnings yield", `${money(s.inputs.net_income)} ÷ ${money(s.market_cap)} = ${pct(s.metrics.earnings_yield)}`],
    ],
  },
  fcf_yield: {
    label: "FCF yield",
    fmt: pct,
    definition: "Free cash flow is the cash a business generates after paying for its equipment and buildings. FCF yield compares that cash to the company's market value. A higher yield means more cash generated per dollar invested in the stock.",
    formula: "FCF yield = (Operating cash flow − Capital expenditure) ÷ Market cap",
    read: (v) => `For every $100 of market value, the business ${v < 0 ? "burned" : "generated"} about $${Math.abs(v * 100).toFixed(2)} of free cash over the last twelve months.`,
    calc: (s) => [
      ...mcapRows(s),
      ["Operating cash flow", `${money(s.inputs.operating_cash_flow)} · ${s.inputs.cf_period || "period n/a"}`],
      ["Capital expenditure", money(s.inputs.capex == null ? null : Math.abs(s.inputs.capex))],
      ["Free cash flow", `${money(s.inputs.operating_cash_flow)} − ${money(s.inputs.capex == null ? null : Math.abs(s.inputs.capex))} = ${money(s.inputs.fcf)}`],
      ["FCF yield", `${money(s.inputs.fcf)} ÷ ${money(s.market_cap)} = ${pct(s.metrics.fcf_yield)}`],
    ],
  },
  book_to_market: {
    label: "Book-to-market",
    fmt: dec,
    definition: "Compares the company's accounting value (assets minus liabilities, called book value or shareholders' equity) to what the market says it is worth. A high ratio is the classic sign of a 'value' stock. A low ratio means investors pay a large premium over book value.",
    formula: "Book-to-market = Shareholders' equity ÷ Market cap",
    read: (v) => `Book value is ${(v * 100).toFixed(1)}% of market value, which means the market prices the stock at ${v > 0 ? (1 / v).toFixed(2) + "× book value" : "a negative book value"}.`,
    calc: (s) => [
      ...mcapRows(s),
      ["Shareholders' equity", `${money(s.inputs.equity)}  (balance sheet ${date(s.inputs.equity_date)})`],
      ["Book-to-market", `${money(s.inputs.equity)} ÷ ${money(s.market_cap)} = ${dec(s.metrics.book_to_market)}`],
    ],
  },
  roe: {
    label: "ROE",
    fmt: pct,
    definition: "Return on equity measures how much profit the company produces with the money shareholders have invested in it. A higher ROE means management turns each dollar of equity into more profit.",
    formula: "ROE = Net income (TTM) ÷ Average shareholders' equity",
    read: (v) => `The company earned about $${(v * 100).toFixed(1)} of profit for every $100 of shareholders' equity over the last year.`,
    calc: (s) => {
      const i = s.inputs;
      const rows = [["Net income", `${money(i.net_income)} · ${i.ni_period || "period n/a"}`]];
      if (i.equity_prior != null) {
        rows.push(["Equity now", `${money(i.equity)}  (${date(i.equity_date)})`]);
        rows.push(["Equity a year earlier", `${money(i.equity_prior)}  (${date(i.equity_prior_date)})`]);
        rows.push(["Average equity", `(${money(i.equity)} + ${money(i.equity_prior)}) ÷ 2 = ${money(i.avg_equity)}`]);
      } else {
        rows.push(["Shareholders' equity", `${money(i.equity)}  (${date(i.equity_date)}; prior-year figure unavailable, so latest is used)`]);
      }
      rows.push(["ROE", `${money(i.net_income)} ÷ ${money(i.avg_equity)} = ${pct(s.metrics.roe)}`]);
      return rows;
    },
  },
  debt_to_equity: {
    label: "Debt-to-equity",
    fmt: times,
    definition: "Shows how much the company relies on borrowed money compared with shareholders' money. A higher number means more leverage: higher potential returns, but more risk if business slows.",
    formula: "Debt-to-equity = Total debt ÷ Shareholders' equity",
    read: (v) => `The company has $${v.toFixed(2)} of debt for every $1 of shareholders' equity.`,
    calc: (s) => [
      ["Total debt", `${money(s.inputs.debt)}  (balance sheet ${date(s.inputs.equity_date)})`],
      ["Shareholders' equity", money(s.inputs.equity)],
      ["Debt-to-equity", `${money(s.inputs.debt)} ÷ ${money(s.inputs.equity)} = ${times(s.metrics.debt_to_equity)}`],
    ],
  },
  momentum: {
    label: "Momentum (12-1)",
    fmt: signedPct,
    definition: "How strongly the price has performed over the past year. Following standard practice, it measures the return from 12 months ago up to 1 month ago, skipping the latest month because very recent moves tend to reverse. Prices are adjusted for splits and dividends.",
    formula: "Momentum = Price 1 month ago ÷ Price 12 months ago − 1",
    read: (v) => `Over that 11-month window the stock ${v >= 0 ? "rose" : "fell"} ${Math.abs(v * 100).toFixed(1)}%.`,
    calc: (s) => {
      const m = s.inputs.momentum;
      if (!m) return [["Momentum", "n/a"]];
      return [
        ["Price 12 months ago", `${usd(m.price_start)}  (${date(m.date_start)})`],
        ["Price 1 month ago", `${usd(m.price_end)}  (${date(m.date_end)})`],
        ["Momentum", `${usd(m.price_end)} ÷ ${usd(m.price_start)} − 1 = ${signedPct(s.metrics.momentum)}`],
      ];
    },
  },
};
const ORDER = Object.keys(METRICS);

// ---------- state ----------
let DATA = null, BY_TICKER = new Map(), current = null, currentMetric = ORDER[0];
const $ = (id) => document.getElementById(id);

async function load() {
  try {
    const res = await fetch("data/metrics.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (e) {
    $("asof").textContent = "Data unavailable";
    $("error").hidden = false;
    $("error").textContent = `Could not load data/metrics.json (${e.message}). Run scripts/fetch_data.py to generate it.`;
    return;
  }
  DATA.stocks.forEach((s) => BY_TICKER.set(s.ticker, s));
  $("asof").textContent = `${DATA.count} stocks · prices as of market close ${date(DATA.as_of)}`;
  $("source").textContent = `${DATA.source} Updated ${new Date(DATA.generated_at).toLocaleString()}.`;
  fromHash();
  window.addEventListener("hashchange", fromHash);
}

function fromHash() {
  const t = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  const s = BY_TICKER.get(t) || BY_TICKER.get("AAPL") || DATA.stocks[0];
  if (s !== current) show(s);
}

// ---------- rendering ----------
function show(s) {
  current = s;
  $("stock").hidden = false;
  $("s-ticker").textContent = s.ticker;
  $("s-name").textContent = s.name;
  $("s-sector").textContent = s.sector;
  $("s-price").textContent = usd(s.price);
  $("s-mcap").textContent = money(s.market_cap);
  $("s-shares").textContent = count(s.shares);
  renderTrend();
  document.title = `${s.ticker} · S&P 500 Factor Lens`;

  $("metrics").innerHTML = ORDER.map((k) => {
    const m = METRICS[k], v = s.metrics[k], p = s.percentiles?.[k];
    return `<button class="metric" role="tab" id="tab-${k}" data-k="${k}" aria-selected="${k === currentMetric}">
      <span class="m-label">${m.label}</span>
      <span class="m-value ${v == null ? "na" : ""}">${v == null ? "n/a" : m.fmt(v)}</span>
      <span class="m-rank">${p == null ? "No rank" : `<span class="bar"><i style="width:${p}%"></i></span><span class="num">${p}th pct</span>`}</span>
    </button>`;
  }).join("");

  $("notes").innerHTML = (s.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  renderDetail();
}

function renderDetail() {
  const s = current, k = currentMetric, m = METRICS[k], v = s.metrics[k], p = s.percentiles?.[k];
  document.querySelectorAll(".metric").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === k));
  const rows = m.calc(s);
  const n = DATA.stocks.filter((x) => x.metrics[k] != null).length;
  $("detail").setAttribute("aria-labelledby", `tab-${k}`);
  $("detail").innerHTML = `
    <h3>${m.label}</h3>
    <p class="d-def">${m.definition}</p>
    <div class="d-block"><h4>Formula</h4><code class="formula">${m.formula}</code></div>
    <div class="d-block"><h4>Calculation for ${esc(s.ticker)}</h4>
      <ul class="calc">${rows.map((r, i) => `<li class="${i === rows.length - 1 ? "result" : ""}"><span class="c-k">${r[0]}</span><span class="c-v">${esc(r[1])}</span></li>`).join("")}</ul>
    </div>
    ${v != null ? `<div class="d-block"><h4>What it means</h4><p class="read">${m.read(v)}${p != null ? ` This is higher than ${p}% of the ${n} S&amp;P 500 stocks with this figure.` : ""}</p></div>` : `<div class="d-block"><h4>What it means</h4><p class="read">This metric could not be calculated for ${esc(s.ticker)} because an input is missing or not meaningful.</p></div>`}
  `;
}

$("metrics").addEventListener("click", (e) => {
  const b = e.target.closest(".metric");
  if (!b) return;
  currentMetric = b.dataset.k;
  renderDetail();
});
$("metrics").addEventListener("keydown", (e) => {
  if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
  const i = ORDER.indexOf(currentMetric) + (e.key === "ArrowRight" ? 1 : -1);
  currentMetric = ORDER[(i + ORDER.length) % ORDER.length];
  renderDetail();
  $(`tab-${currentMetric}`).focus();
});

// ---------- search ----------
const q = $("q"), list = $("results");
let hits = [], active = 0;

function search(term) {
  term = term.trim().toLowerCase();
  if (!term) return [];
  const scored = [];
  for (const s of DATA.stocks) {
    const t = s.ticker.toLowerCase(), n = s.name.toLowerCase();
    let score = -1;
    if (t === term) score = 0;
    else if (t.startsWith(term)) score = 1;
    else if (n.startsWith(term)) score = 2;
    else if (n.includes(term)) score = 3;
    if (score >= 0) scored.push([score, s]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].ticker.localeCompare(b[1].ticker)).slice(0, 10).map((x) => x[1]);
}

function renderResults() {
  const open = q.value.trim() !== "";
  list.hidden = !open;
  $("search-box").setAttribute("aria-expanded", open);
  if (!open) return;
  list.innerHTML = hits.length
    ? hits.map((s, i) => `<li role="option" data-t="${esc(s.ticker)}" aria-selected="${i === active}"><span class="r-t">${esc(s.ticker)}</span><span class="r-n">${esc(s.name)}</span><span class="r-s">${esc(s.sector)}</span></li>`).join("")
    : `<li class="empty">No S&amp;P 500 match</li>`;
}

function pick(t) {
  q.value = "";
  hits = [];
  renderResults();
  q.blur();
  if (location.hash.slice(1) === t) fromHash();
  else location.hash = t;
}

q.addEventListener("input", () => { if (!DATA) return; hits = search(q.value); active = 0; renderResults(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { active = Math.min(active + 1, hits.length - 1); renderResults(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); renderResults(); e.preventDefault(); }
  else if (e.key === "Enter" && hits[active]) pick(hits[active].ticker);
  else if (e.key === "Escape") { q.value = ""; renderResults(); }
});
list.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-t]");
  if (li) { e.preventDefault(); pick(li.dataset.t); }
});
q.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 100));
q.addEventListener("focus", () => { if (q.value) renderResults(); });

// ---------- 12-month trend chart ----------
const SVG_NS = "http://www.w3.org/2000/svg";
const monthName = (m, withYear) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 15));
  return d.toLocaleString("en-US", { month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
};
const shortDay = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthLabel = (p, withYear = true) => `${monthName(p.month, withYear)}${p.partial ? ` (to ${shortDay(p.through)})` : ""}`;

function niceStep(raw) {
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function el(name, attrs = {}, text) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function renderTrend() {
  const panel = $("trend"), btn = $("trend-btn");
  const data = (current && current.monthly) || [];
  btn.hidden = data.length < 2;
  if (data.length < 2) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  if (panel.hidden) return;

  // Summary
  const first = data[0], last = data[data.length - 1];
  const chg = last.avg / first.avg - 1;
  $("trend-title").textContent = data.length >= 12 ? "Monthly average price, last 12 months" : `Monthly average price, last ${data.length} months`;
  $("trend-summary").innerHTML =
    `<strong class="${chg >= 0 ? "pos" : "neg"}">${signedPct(chg)}</strong>` +
    `${monthName(first.month, true)} ${usd(first.avg)} → ${monthName(last.month, true)} ${usd(last.avg)}` +
    (last.partial ? ` <span class="muted">(to ${shortDay(last.through)})</span>` : "");

  // Geometry
  const box = $("trend-chart");
  box.innerHTML = "";
  const W = Math.max(280, Math.round(box.clientWidth || 600));
  const narrow = W < 520;
  const H = narrow ? 220 : 260;
  const m = { t: 22, r: 12, b: 28, l: 56 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, n = data.length, band = pw / n;

  const lo = Math.min(...data.map((d) => d.low ?? d.avg)), hi = Math.max(...data.map((d) => d.high ?? d.avg));
  const step = niceStep((hi - lo || hi * 0.1) / 4);
  const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  const x = (i) => m.l + band * (i + 0.5);
  const y = (v) => m.t + ph - ((v - y0) / (y1 - y0)) * ph;
  const dp = Number.isInteger(step) ? 0 : step * 10 === Math.round(step * 10) ? 1 : 2;
  const tickFmt = (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: dp === 1 ? 2 : dp, maximumFractionDigits: dp === 1 ? 2 : dp })}`;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Monthly average closing price of ${current.ticker}: ` + data.map((d) => `${monthLabel(d)} ${usd(d.avg)}`).join(", ") });

  // Grid + y labels
  for (let v = y0; v <= y1 + step / 2; v += step) {
    svg.append(el("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(el("text", { class: "axis-t", x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, tickFmt(v)));
  }
  // Monthly low-high ranges
  data.forEach((d, i) => {
    if (d.low != null && d.high != null) svg.append(el("line", { class: "range", x1: x(i), x2: x(i), y1: y(d.low), y2: y(d.high) }));
  });
  // Area + line
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.avg).toFixed(1)}`);
  svg.append(el("path", { class: "area", d: `M${x(0)},${m.t + ph} L${pts.join(" L")} L${x(n - 1)},${m.t + ph} Z` }));
  svg.append(el("path", { class: "line", d: `M${pts.join(" L")}` }));
  // Dots
  data.forEach((d, i) => {
    const isLast = i === n - 1;
    svg.append(el("circle", { class: `dot${isLast ? " last" : ""}${d.partial ? " partial" : ""}`, cx: x(i), cy: y(d.avg), r: isLast ? 5 : 3.5 }));
  });
  // End label
  if (!narrow) {
    svg.append(el("text", { class: "end-t", x: x(n - 1), y: y(last.high ?? last.avg) - 9, "text-anchor": "middle" }, usd(last.avg)));
  }
  // X labels (year shown on the first month and on January)
  const every = band < 38 ? 2 : 1;
  data.forEach((d, i) => {
    if ((n - 1 - i) % every) return;
    const [yr, mo] = d.month.split("-");
    const label = i === 0 || mo === "01" ? `${monthName(d.month)} '${yr.slice(2)}` : monthName(d.month);
    svg.append(el("text", { class: "axis-t", x: x(i), y: H - 8, "text-anchor": "middle" }, label));
  });

  // Hover / tap
  const guide = el("line", { class: "guide", x1: 0, x2: 0, y1: m.t, y2: m.t + ph, visibility: "hidden" });
  svg.append(guide);
  svg.append(el("rect", { class: "hit", x: m.l, y: m.t, width: pw, height: ph }));
  box.append(svg);
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  box.append(tip);

  const showTip = (ev) => {
    const r = svg.getBoundingClientRect(), k = r.width / W;
    const i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) / k - m.l) / band)));
    const d = data[i];
    guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i)); guide.setAttribute("visibility", "visible");
    tip.innerHTML = `<span class="tip-m">${esc(monthLabel(d))}</span><b>${usd(d.avg)}</b>` +
      (d.low != null ? `Range ${usd(d.low)} – ${usd(d.high)}<br>` : "") + `${d.days} trading days`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x(i) * k + 12;
    if (left + tw > r.width) left = x(i) * k - tw - 12;
    let top = y(d.avg) * k - th / 2;
    top = Math.max(0, Math.min(top, r.height - th));
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${top}px`;
  };
  svg.addEventListener("pointermove", showTip);
  svg.addEventListener("pointerdown", showTip);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; guide.setAttribute("visibility", "hidden"); });
}

$("trend-btn").addEventListener("click", () => {
  const panel = $("trend");
  panel.hidden = !panel.hidden;
  $("trend-btn").setAttribute("aria-expanded", String(!panel.hidden));
  renderTrend();
});
let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued || $("trend").hidden) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; renderTrend(); });
});

load();
