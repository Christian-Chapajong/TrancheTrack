// ============================================================
// Theme
// ============================================================
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
}

initTheme();

// ============================================================
// Firebase / Firestore init
// ============================================================
let db = null;
let useFirestore = false;

try {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
  useFirestore = true;
} catch (e) {
  console.warn('Firebase init failed, using localStorage fallback:', e.message);
}

// ============================================================
// State
// ============================================================
let tranches = [];
let currentPrices = {};
let spyCurrentPrice = null;
let lastRefreshTime = null;
let nextId = 1;
let expandedTickers = new Set();
let editingTickers = new Set();
let historicalData = {};
let indicators = {};
let accordionsInitialized = false;
let sidebarOpen = false;
let currentFilterTicker = '';
let currentSort = 'ticker';

// ============================================================
// Data persistence — Firestore with localStorage fallback
// ============================================================
async function loadTranches() {
  if (useFirestore) {
    try {
      const snapshot = await db.collection('tranches').get();
      if (snapshot.empty) {
        const batch = db.batch();
        for (const t of DEFAULT_TRANCHES) {
          const ref = db.collection('tranches').doc();
          batch.set(ref, {
            ticker: t.ticker,
            date: t.date,
            purchasePrice: t.purchasePrice,
            spyAtPurchase: t.spyAtPurchase
          });
        }
        await batch.commit();
        const seeded = await db.collection('tranches').get();
        tranches = seeded.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } else {
        tranches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
      nextId = tranches.length + 1;
      return tranches;
    } catch (e) {
      console.warn('Firestore read failed, falling back to localStorage:', e.message);
      showError('Firestore unavailable — using local data. ' + e.message);
      useFirestore = false;
    }
  }

  const saved = localStorage.getItem('portfolio_tranches');
  if (saved) {
    try { tranches = JSON.parse(saved); } catch (e) { tranches = []; }
  }
  if (tranches.length === 0) {
    tranches = JSON.parse(JSON.stringify(DEFAULT_TRANCHES));
    localStorage.setItem('portfolio_tranches', JSON.stringify(tranches));
  }
  nextId = tranches.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1;
  return tranches;
}

function saveToLocalStorage() {
  localStorage.setItem('portfolio_tranches', JSON.stringify(tranches));
}

function showError(msg) {
  document.getElementById('errorMsg').innerHTML =
    `<div class="error-msg">${msg}</div>`;
}

function getApiKey() {
  const override = localStorage.getItem('polygon_api_key_override');
  return override || API_KEY;
}

// ============================================================
// Polygon.io Price API
// ============================================================
async function fetchPrice(ticker) {
  const key = getApiKey();
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${key}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API error for ${ticker}: ${resp.status} — ${body}`);
  }
  const data = await resp.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`No price data returned for ${ticker}`);
  }
  return data.results[0].c;
}

async function fetchHistorical(ticker) {
  const key = getApiKey();
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&apiKey=${key}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  if (!data.results) return [];
  return data.results.map(r => ({ date: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
}

// ============================================================
// Technical Indicators
// ============================================================
function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(closes, period) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcStochastic(highs, lows, closes, kPeriod, dPeriod) {
  if (closes.length < kPeriod) return { k: null, d: null };
  const kValues = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const sliceH = highs.slice(i - kPeriod + 1, i + 1);
    const sliceL = lows.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...sliceH);
    const ll = Math.min(...sliceL);
    const k = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    kValues.push(k);
  }
  const latestK = kValues[kValues.length - 1];
  let latestD = null;
  if (kValues.length >= dPeriod) {
    latestD = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  }
  return { k: latestK, d: latestD };
}

function calcParabolicSAR(highs, lows, closes) {
  if (closes.length < 5) return null;
  const af0 = 0.02, afMax = 0.20;
  let bull = true;
  let sar = lows[0];
  let ep = highs[0];
  let af = af0;

  for (let i = 1; i < closes.length; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (bull) {
      sar = Math.min(sar, lows[Math.max(0, i - 1)], lows[Math.max(0, i - 2)]);
      if (lows[i] < sar) {
        bull = false;
        sar = ep;
        ep = lows[i];
        af = af0;
      } else {
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + af0, afMax);
        }
      }
    } else {
      sar = Math.max(sar, highs[Math.max(0, i - 1)], highs[Math.max(0, i - 2)]);
      if (highs[i] > sar) {
        bull = true;
        sar = ep;
        ep = highs[i];
        af = af0;
      } else {
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + af0, afMax);
        }
      }
    }
  }
  return { value: sar, trend: bull ? 'Bullish' : 'Bearish' };
}

function calcFractals(highs, lows) {
  if (!highs || !lows || highs.length < 5 || lows.length < 5) {
    return { up: null, down: null };
  }
  let upIndex = null;
  let downIndex = null;

  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
      upIndex = i;
    }
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
      downIndex = i;
    }
  }

  return {
    up: upIndex != null ? { index: upIndex, price: highs[upIndex] } : null,
    down: downIndex != null ? { index: downIndex, price: lows[downIndex] } : null
  };
}

function calcIndicators(bars) {
  if (!bars || bars.length < 14) return null;
  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);

  return {
    ema20: calcEMA(closes, 20),
    rsi14: calcRSI(closes, 14),
    stochK: calcStochastic(highs, lows, closes, 14, 3).k,
    stochD: calcStochastic(highs, lows, closes, 14, 3).d,
    sar: calcParabolicSAR(highs, lows, closes),
    fractals: calcFractals(highs, lows)
  };
}

// ============================================================
// Refresh prices + historical data
// ============================================================
async function refreshPrices() {
  const btn = document.getElementById('refreshBtn');
  const loadingEl = document.getElementById('loadingMsg');
  const errorEl = document.getElementById('errorMsg');

  btn.disabled = true;
  btn.textContent = 'Loading…';
  errorEl.innerHTML = '';
  loadingEl.innerHTML = '<span class="spinner"></span> Fetching prices from Polygon.io…';

  const tickers = [...new Set(tranches.map(t => t.ticker))];
  if (!tickers.includes('SPY')) tickers.push('SPY');

  const errors = [];

  for (const ticker of tickers) {
    try {
      const price = await fetchPrice(ticker);
      if (ticker === 'SPY') {
        spyCurrentPrice = price;
      } else {
        currentPrices[ticker] = price;
      }
    } catch (e) {
      errors.push(e.message);
    }
  }

  // Fetch historical data for indicators
  loadingEl.innerHTML = '<span class="spinner"></span> Calculating indicators…';
  for (const ticker of tickers) {
    if (ticker === 'SPY') continue;
    try {
      const bars = await fetchHistorical(ticker);
      if (bars.length > 0) {
        historicalData[ticker] = bars;
        indicators[ticker] = calcIndicators(bars);
      }
    } catch (e) {
      // Non-critical
    }
  }

  loadingEl.innerHTML = '';
  btn.disabled = false;
  btn.textContent = 'Refresh Prices';

  if (errors.length > 0) {
    errorEl.innerHTML = '<div class="error-msg">' + errors.join('<br>') + '</div>';
  }

  if (spyCurrentPrice !== null) {
    lastRefreshTime = new Date();
    document.getElementById('lastRefresh').textContent =
      'Last refresh: ' + lastRefreshTime.toLocaleString();
  }

  renderTable();
  renderAlerts();
}

// ============================================================
// Calculations — matches client Excel formulas exactly
// ============================================================
function calcTranche(t) {
  const today = new Date();
  const purchaseDate = new Date(t.date + 'T00:00:00');
  const days = Math.floor((today - purchaseDate) / (1000 * 60 * 60 * 24));
  const currentPrice = currentPrices[t.ticker];
  const spyNow = spyCurrentPrice;

  if (currentPrice == null || spyNow == null) {
    return { days, currentPrice: null, spyNow: null };
  }

  const pnl = currentPrice - t.purchasePrice;
  const pctPnl = pnl / t.purchasePrice;
  const annPctPnl = days > 0 ? pctPnl / (days / 365) : 0;

  const spyPnl = spyNow - t.spyAtPurchase;
  const spyPctPnl = spyPnl / t.spyAtPurchase;
  const spyAnnPctPnl = days > 0 ? spyPctPnl / (days / 365) : 0;

  const alpha = (annPctPnl - spyAnnPctPnl) * 100;

  return { days, currentPrice, spyNow, pnl, pctPnl, annPctPnl, spyPnl, spyPctPnl, spyAnnPctPnl, alpha };
}

// ============================================================
// Sidebar
// ============================================================
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  const sidebar = document.getElementById('alertsSidebar');
  const btn = document.getElementById('alertsBtn');
  if (sidebarOpen) {
    sidebar.classList.add('open');
    btn.classList.add('active');
  } else {
    sidebar.classList.remove('open');
    btn.classList.remove('active');
  }
}

// ============================================================
// Sort / Filter
// ============================================================
function applyFilters() {
  currentFilterTicker = document.getElementById('filterTicker').value;
  currentSort = document.getElementById('sortField').value;
  renderTable();
}

function updateFilterOptions() {
  const select = document.getElementById('filterTicker');
  const tickers = [...new Set(tranches.map(t => t.ticker))];
  const current = select.value;
  select.innerHTML = '<option value="">All</option>';
  for (const t of tickers) {
    select.innerHTML += `<option value="${t}" ${t === current ? 'selected' : ''}>${t}</option>`;
  }
}

function getFilteredSortedTranches() {
  let filtered = tranches;
  if (currentFilterTicker) {
    filtered = filtered.filter(t => t.ticker === currentFilterTicker);
  }

  if (currentSort === 'ticker') {
    // Default: group by ticker, within each group sort by date descending (newest first)
    return filtered;
  }

  // For non-default sorts, return a flat sorted copy
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    const ca = calcTranche(a);
    const cb = calcTranche(b);
    switch (currentSort) {
      case 'date-desc': return b.date.localeCompare(a.date);
      case 'date-asc': return a.date.localeCompare(b.date);
      case 'price-desc': return b.purchasePrice - a.purchasePrice;
      case 'price-asc': return a.purchasePrice - b.purchasePrice;
      case 'pnl-desc': return (cb.pnl || 0) - (ca.pnl || 0);
      case 'pnl-asc': return (ca.pnl || 0) - (cb.pnl || 0);
      case 'alpha-desc': return (cb.alpha || 0) - (ca.alpha || 0);
      case 'alpha-asc': return (ca.alpha || 0) - (cb.alpha || 0);
      case 'days-desc': return cb.days - ca.days;
      case 'days-asc': return ca.days - cb.days;
      default: return 0;
    }
  });
  return sorted;
}

// ============================================================
// Rendering
// ============================================================
function fmt(val, decimals = 2) {
  if (val == null) return '—';
  return val.toFixed(decimals);
}

function fmtPct(val) {
  if (val == null) return '—';
  return (val * 100).toFixed(2) + '%';
}

function fmtAlpha(val) {
  if (val == null) return '—';
  return val.toFixed(2);
}

function colorClass(val) {
  if (val == null) return '';
  return val >= 0 ? 'positive' : 'negative';
}

// ============================================================
// Alert config — defaults from ALERT_CONFIG, overridden by localStorage
// ============================================================
function getAlertConfig() {
  const saved = localStorage.getItem('alert_thresholds');
  let overrides = {};
  if (saved) {
    try { overrides = JSON.parse(saved); } catch (e) { /* ignore */ }
  }
  const config = {};
  const tickers = [...new Set(tranches.map(t => t.ticker))];
  for (const ticker of tickers) {
    const defaults = ALERT_CONFIG[ticker] || { addPct: -0.20, trimPct: 0.40 };
    const over = overrides[ticker] || {};
    config[ticker] = {
      addPct: over.addPct != null ? over.addPct : defaults.addPct,
      trimPct: over.trimPct != null ? over.trimPct : defaults.trimPct
    };
  }
  return config;
}

// ============================================================
// Oscillator — % distance from avg cost basis per ticker
// ============================================================
let avgCostCache = {};

function rebuildAvgCostCache() {
  avgCostCache = {};
  const grouped = {};
  for (const t of tranches) {
    if (!grouped[t.ticker]) grouped[t.ticker] = [];
    grouped[t.ticker].push(t);
  }
  for (const ticker in grouped) {
    const arr = grouped[ticker];
    avgCostCache[ticker] = arr.reduce((s, t) => s + t.purchasePrice, 0) / arr.length;
  }
}

function calcOscillator(ticker) {
  const price = currentPrices[ticker];
  const avgCost = avgCostCache[ticker];
  if (price == null || avgCost == null || avgCost === 0) return null;
  return (price - avgCost) / avgCost;
}

function oscColorClass(ticker) {
  const osc = calcOscillator(ticker);
  if (osc == null) return '';
  const config = getAlertConfig();
  const cfg = config[ticker] || { addPct: -0.20, trimPct: 0.40 };
  if (osc <= cfg.addPct) return 'positive';  // Buy zone = green
  if (osc >= cfg.trimPct) return 'negative';  // Trim zone = red
  return 'osc-hold';
}

function fmtOsc(ticker) {
  const osc = calcOscillator(ticker);
  if (osc == null) return '—';
  return (osc >= 0 ? '+' : '') + (osc * 100).toFixed(1) + '%';
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

function toggleAccordion(ticker) {
  if (expandedTickers.has(ticker)) {
    expandedTickers.delete(ticker);
    editingTickers.delete(ticker);
  } else {
    expandedTickers.add(ticker);
  }
  renderTable();
}

function toggleEdit(ticker, event) {
  event.stopPropagation();
  if (editingTickers.has(ticker)) {
    editingTickers.delete(ticker);
  } else {
    editingTickers.add(ticker);
  }
  renderTable();
}

function rsiClass(val) {
  if (val == null) return '';
  if (val >= 70) return 'negative';
  if (val <= 30) return 'positive';
  return '';
}

function rsiLabel(val) {
  if (val == null) return '';
  if (val >= 70) return 'Overbought';
  if (val <= 30) return 'Oversold';
  return 'Neutral';
}

function renderIndicatorRow(ticker, curPrice) {
  const ind = indicators[ticker];
  if (!ind) return '';

  const sarTrend = ind.sar ? ind.sar.trend : null;
  const sarVal = ind.sar ? ind.sar.value : null;
  const fractals = ind.fractals || {};
  const upFractal = fractals.up;
  const downFractal = fractals.down;

  return `<tr class="indicators-row">
    <td colspan="15">
      <div class="indicators-grid">
        <div class="indicator">
          <span class="indicator-label">EMA (20)</span>
          <span class="indicator-value">${ind.ema20 != null ? '$' + fmt(ind.ema20) : '—'}</span>
          ${ind.ema20 != null && curPrice != null ? `<span class="indicator-note ${curPrice > ind.ema20 ? 'positive' : 'negative'}">${curPrice > ind.ema20 ? 'Above' : 'Below'}</span>` : ''}
        </div>
        <div class="indicator">
          <span class="indicator-label">RSI (14)</span>
          <span class="indicator-value ${rsiClass(ind.rsi14)}">${ind.rsi14 != null ? fmt(ind.rsi14, 1) : '—'}</span>
          ${ind.rsi14 != null ? `<span class="indicator-note ${rsiClass(ind.rsi14)}">${rsiLabel(ind.rsi14)}</span>` : ''}
        </div>
        <div class="indicator">
          <span class="indicator-label">Stoch %K / %D</span>
          <span class="indicator-value">${ind.stochK != null ? fmt(ind.stochK, 1) : '—'} / ${ind.stochD != null ? fmt(ind.stochD, 1) : '—'}</span>
          ${ind.stochK != null ? `<span class="indicator-note ${ind.stochK >= 80 ? 'negative' : ind.stochK <= 20 ? 'positive' : ''}">${ind.stochK >= 80 ? 'Overbought' : ind.stochK <= 20 ? 'Oversold' : 'Neutral'}</span>` : ''}
        </div>
        <div class="indicator">
          <span class="indicator-label">Parabolic SAR</span>
          <span class="indicator-value">${sarVal != null ? '$' + fmt(sarVal) : '—'}</span>
          ${sarTrend ? `<span class="indicator-note ${sarTrend === 'Bullish' ? 'positive' : 'negative'}">${sarTrend}</span>` : ''}
        </div>
        <div class="indicator">
          <span class="indicator-label">Fractals</span>
          <span class="indicator-value">
            ${upFractal ? '&#9650; $' + fmt(upFractal.price) : '&#9650; —'}
            &nbsp;
            ${downFractal ? '&#9660; $' + fmt(downFractal.price) : '&#9660; —'}
          </span>
        </div>
      </div>
    </td>
  </tr>`;
}

function renderTrancheRow(t, c, isEditing) {
  const priceCell = isEditing
    ? `<input class="inline-input" type="number" step="0.01" value="${t.purchasePrice}" onchange="updateTranche('${t.id}','purchasePrice',this.value)">`
    : `$${fmt(t.purchasePrice)}`;

  const spyCell = isEditing
    ? `<input class="inline-input" type="number" step="0.01" value="${t.spyAtPurchase}" onchange="updateTranche('${t.id}','spyAtPurchase',this.value)">`
    : `$${fmt(t.spyAtPurchase)}`;

  const dateCell = isEditing
    ? `<input class="inline-input inline-input-date" type="text" value="${fmtDate(t.date)}" onchange="updateTrancheDate('${t.id}',this.value)" placeholder="MM/DD/YYYY">`
    : fmtDate(t.date);

  return `<tr class="tranche-row">
    <td>${t.ticker}</td>
    <td>${dateCell}</td>
    <td class="num">${priceCell}</td>
    <td class="num">${c.currentPrice != null ? '$' + fmt(c.currentPrice) : '—'}</td>
    <td class="num">${c.days}</td>
    <td class="num ${colorClass(c.pnl)}">${c.pnl != null ? '$' + fmt(c.pnl) : '—'}</td>
    <td class="num ${colorClass(c.pctPnl)}">${fmtPct(c.pctPnl)}</td>
    <td class="num ${colorClass(c.annPctPnl)}">${fmtPct(c.annPctPnl)}</td>
    <td class="num">${spyCell}</td>
    <td class="num">${c.spyNow != null ? '$' + fmt(c.spyNow) : '—'}</td>
    <td class="num ${colorClass(c.spyPctPnl)}">${fmtPct(c.spyPctPnl)}</td>
    <td class="num ${colorClass(c.spyAnnPctPnl)}">${fmtPct(c.spyAnnPctPnl)}</td>
    <td class="num ${colorClass(c.alpha)}">${fmtAlpha(c.alpha)}</td>
    <td class="num osc-cell ${oscColorClass(t.ticker)}">${fmtOsc(t.ticker)}</td>
    <td>${isEditing ? `<button class="delete-btn" onclick="deleteTranche('${t.id}')" title="Remove tranche">&#10005;</button>` : ''}</td>
  </tr>`;
}

function renderTable() {
  const tbody = document.getElementById('tableBody');
  updateFilterOptions();
  rebuildAvgCostCache();

  if (tranches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="no-data">No tranches — click <strong>+ Add Tranche</strong> to get started.</td></tr>';
    return;
  }

  const items = getFilteredSortedTranches();

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="no-data">No tranches match the current filter.</td></tr>';
    return;
  }

  // For default sort ("ticker"), render grouped accordion view
  if (currentSort === 'ticker') {
    const grouped = {};
    const tickerOrder = [];
    for (const t of items) {
      if (!grouped[t.ticker]) {
        grouped[t.ticker] = [];
        tickerOrder.push(t.ticker);
      }
      grouped[t.ticker].push(t);
    }

    // Sort within each group by date descending (newest first)
    for (const ticker of tickerOrder) {
      grouped[ticker].sort((a, b) => b.date.localeCompare(a.date));
    }

    // On first render, expand all
    if (!accordionsInitialized) {
      for (const ticker of tickerOrder) {
        expandedTickers.add(ticker);
      }
      accordionsInitialized = true;
    }

    let html = '';

    for (const ticker of tickerOrder) {
      const group = grouped[ticker];
      const calcs = group.map(t => ({ tranche: t, calc: calcTranche(t) }));
      const isExpanded = expandedTickers.has(ticker);
      const isEditing = editingTickers.has(ticker);

      const n = group.length;
      const avgCost = group.reduce((s, t) => s + t.purchasePrice, 0) / n;
      const curPrice = currentPrices[ticker];
      const alphaVals = calcs.filter(c => c.calc.alpha != null).map(c => c.calc.alpha);
      const avgAlpha = alphaVals.length > 0 ? alphaVals.reduce((a, b) => a + b, 0) / alphaVals.length : null;

      const chevron = isExpanded ? '&#9660;' : '&#9654;';
      html += `<tr class="group-header" onclick="toggleAccordion('${ticker}')">
        <td colspan="12">
          <span class="accordion-chevron">${chevron}</span>
          <span class="accordion-ticker">${ticker}</span>
          <span class="accordion-meta">${n} tranche${n > 1 ? 's' : ''} · Avg: $${fmt(avgCost)} · Current: ${curPrice != null ? '$' + fmt(curPrice) : '—'}</span>
        </td>
        <td class="num ${colorClass(avgAlpha)}">${avgAlpha != null ? fmtAlpha(avgAlpha) : '—'}</td>
        <td class="num osc-cell ${oscColorClass(ticker)}">${fmtOsc(ticker)}</td>
        <td>
          <button class="edit-btn ${isEditing ? 'editing' : ''}" onclick="toggleEdit('${ticker}', event)" title="${isEditing ? 'Done editing' : 'Edit tranches'}">
            ${isEditing ? '&#10003;' : '&#9998;'}
          </button>
        </td>
      </tr>`;

      if (isExpanded) {
        for (const { tranche: t, calc: c } of calcs) {
          html += renderTrancheRow(t, c, isEditing);
        }

        // Summary row
        html += `<tr class="summary-row">
          <td colspan="2">${ticker} Summary</td>
          <td class="num">Avg: $${fmt(avgCost)}</td>
          <td class="num">${curPrice != null ? '$' + fmt(curPrice) : '—'}</td>
          <td colspan="8"></td>
          <td class="num ${colorClass(avgAlpha)}">${avgAlpha != null ? fmtAlpha(avgAlpha) : '—'}</td>
          <td class="num osc-cell ${oscColorClass(ticker)}">${fmtOsc(ticker)}</td>
          <td></td>
        </tr>`;

        // Indicators row
        html += renderIndicatorRow(ticker, curPrice);
      }
    }

    tbody.innerHTML = html;
  } else {
    // Flat sorted view (no accordions)
    let html = '';
    for (const t of items) {
      const c = calcTranche(t);
      html += renderTrancheRow(t, c, false);
    }
    tbody.innerHTML = html;
  }
}

function renderOscGauge(pctFromAvg, config) {
  // Gauge range: -50% to +60%
  const gaugeMin = -0.50, gaugeMax = 0.60;
  const range = gaugeMax - gaugeMin;
  const buyEnd = (config.addPct - gaugeMin) / range * 100;
  const trimStart = (config.trimPct - gaugeMin) / range * 100;
  const holdWidth = trimStart - buyEnd;
  const trimWidth = 100 - trimStart;
  const needlePct = Math.max(0, Math.min(100, (pctFromAvg - gaugeMin) / range * 100));

  let needleColor;
  if (pctFromAvg <= config.addPct) needleColor = 'var(--green)';
  else if (pctFromAvg >= config.trimPct) needleColor = 'var(--red)';
  else needleColor = 'var(--text-heading)';

  const readingClass = pctFromAvg <= config.addPct ? 'positive' : pctFromAvg >= config.trimPct ? 'negative' : '';
  const oscStr = (pctFromAvg >= 0 ? '+' : '') + (pctFromAvg * 100).toFixed(1) + '%';

  return `<div class="osc-gauge">
    <div class="osc-gauge-bar">
      <div class="osc-zone osc-zone-buy" style="width:${buyEnd.toFixed(1)}%"></div>
      <div class="osc-zone osc-zone-hold" style="width:${holdWidth.toFixed(1)}%"></div>
      <div class="osc-zone osc-zone-trim" style="width:${trimWidth.toFixed(1)}%"></div>
      <div class="osc-needle" style="left:${needlePct.toFixed(1)}%;background:${needleColor}"></div>
    </div>
    <div class="osc-gauge-labels">
      <span>Buy &le; ${(config.addPct * 100).toFixed(0)}%</span>
      <span class="osc-gauge-reading ${readingClass}">${oscStr}</span>
      <span>Trim &ge; +${(config.trimPct * 100).toFixed(0)}%</span>
    </div>
  </div>`;
}

function renderAlerts() {
  const container = document.getElementById('alertsContainer');
  if (spyCurrentPrice === null || Object.keys(currentPrices).length === 0) {
    container.innerHTML = '<div class="sidebar-empty">Click <strong>Refresh Prices</strong> to generate alerts.</div>';
    return;
  }

  rebuildAvgCostCache();
  const alertConfig = getAlertConfig();
  const alertTickers = Object.keys(avgCostCache);

  // Categorize alerts
  const buyAlerts = [];
  const sellAlerts = [];
  const holdAlerts = [];
  const indicatorAlerts = [];

  for (const ticker of alertTickers) {
    const price = currentPrices[ticker];
    if (price == null) continue;

    const avgCost = avgCostCache[ticker];
    const config = alertConfig[ticker] || { addPct: -0.20, trimPct: 0.40 };
    const pctFromAvg = (price - avgCost) / avgCost;
    const pctStr = (pctFromAvg >= 0 ? '+' : '') + (pctFromAvg * 100).toFixed(1) + '% from avg';
    const gauge = renderOscGauge(pctFromAvg, config);

    if (pctFromAvg < config.addPct) {
      buyAlerts.push({ ticker, price, avgCost, pctStr, gauge, isMRK: ticker === 'MRK' });
    } else if (pctFromAvg > config.trimPct) {
      sellAlerts.push({ ticker, price, avgCost, pctStr, gauge, isMRK: ticker === 'MRK' });
    } else {
      holdAlerts.push({ ticker, price, avgCost, pctStr, gauge, isMRK: ticker === 'MRK' });
    }

    // Indicator-based alerts
    const ind = indicators[ticker];
    if (ind) {
      if (ind.rsi14 != null && ind.rsi14 >= 70) {
        indicatorAlerts.push({ ticker, type: 'caution', msg: `RSI at ${fmt(ind.rsi14, 1)} — Overbought` });
      } else if (ind.rsi14 != null && ind.rsi14 <= 30) {
        indicatorAlerts.push({ ticker, type: 'opportunity', msg: `RSI at ${fmt(ind.rsi14, 1)} — Oversold` });
      }
      if (ind.stochK != null && ind.stochK >= 80) {
        indicatorAlerts.push({ ticker, type: 'caution', msg: `Stoch %K at ${fmt(ind.stochK, 1)} — Overbought` });
      } else if (ind.stochK != null && ind.stochK <= 20) {
        indicatorAlerts.push({ ticker, type: 'opportunity', msg: `Stoch %K at ${fmt(ind.stochK, 1)} — Oversold` });
      }
      if (ind.sar && ind.sar.trend === 'Bearish') {
        indicatorAlerts.push({ ticker, type: 'caution', msg: `SAR trend is Bearish` });
      }
      if (ind.ema20 != null && currentPrices[ticker] != null && currentPrices[ticker] < ind.ema20) {
        indicatorAlerts.push({ ticker, type: 'caution', msg: `Price below EMA(20): $${fmt(currentPrices[ticker])} < $${fmt(ind.ema20)}` });
      }
    }
  }

  let html = '';

  // Buy signals
  html += `<div class="alert-category">
    <div class="alert-category-header alert-cat-buy">
      <span class="alert-cat-icon">&#9650;</span> Buy Signals
      <span class="alert-cat-count">${buyAlerts.length}</span>
    </div>`;
  if (buyAlerts.length === 0) {
    html += '<div class="alert-cat-empty">No buy signals</div>';
  }
  for (const a of buyAlerts) {
    html += `<div class="alert alert-add ${a.isMRK ? 'alert-mrk' : ''}">
      <div class="alert-main"><strong>${a.ticker}</strong> — Potential Add</div>
      <div class="alert-detail">Current: $${fmt(a.price)} · Avg Cost: $${fmt(a.avgCost)}</div>
      ${a.gauge}
      <div class="alert-pct">${a.pctStr}</div>
    </div>`;
  }
  html += '</div>';

  // Sell signals
  html += `<div class="alert-category">
    <div class="alert-category-header alert-cat-sell">
      <span class="alert-cat-icon">&#9660;</span> Sell / Trim Signals
      <span class="alert-cat-count">${sellAlerts.length}</span>
    </div>`;
  if (sellAlerts.length === 0) {
    html += '<div class="alert-cat-empty">No sell signals</div>';
  }
  for (const a of sellAlerts) {
    html += `<div class="alert alert-trim ${a.isMRK ? 'alert-mrk' : ''}">
      <div class="alert-main"><strong>${a.ticker}</strong> — Consider Trim</div>
      <div class="alert-detail">Current: $${fmt(a.price)} · Avg Cost: $${fmt(a.avgCost)}</div>
      ${a.gauge}
      <div class="alert-pct">${a.pctStr}</div>
    </div>`;
  }
  html += '</div>';

  // Hold
  html += `<div class="alert-category">
    <div class="alert-category-header alert-cat-hold">
      <span class="alert-cat-icon">&#9632;</span> Hold / Monitor
      <span class="alert-cat-count">${holdAlerts.length}</span>
    </div>`;
  if (holdAlerts.length === 0) {
    html += '<div class="alert-cat-empty">No positions in hold range</div>';
  }
  for (const a of holdAlerts) {
    html += `<div class="alert alert-neutral">
      <div class="alert-main"><strong>${a.ticker}</strong> — Within Range</div>
      <div class="alert-detail">Current: $${fmt(a.price)} · Avg Cost: $${fmt(a.avgCost)}</div>
      ${a.gauge}
      <div class="alert-pct">${a.pctStr}</div>
    </div>`;
  }
  html += '</div>';

  // Indicator alerts
  if (indicatorAlerts.length > 0) {
    html += `<div class="alert-category">
      <div class="alert-category-header alert-cat-indicator">
        <span class="alert-cat-icon">&#9881;</span> Technical Signals
        <span class="alert-cat-count">${indicatorAlerts.length}</span>
      </div>`;
    for (const a of indicatorAlerts) {
      const cls = a.type === 'caution' ? 'alert-indicator-caution' : 'alert-indicator-opportunity';
      html += `<div class="alert ${cls}">
        <div class="alert-main"><strong>${a.ticker}</strong></div>
        <div class="alert-detail">${a.msg}</div>
      </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Update badge on alerts button
  const totalActionable = buyAlerts.length + sellAlerts.length + indicatorAlerts.length;
  const btn = document.getElementById('alertsBtn');
  if (totalActionable > 0) {
    btn.textContent = `Alerts (${totalActionable})`;
    btn.classList.add('has-alerts');
  } else {
    btn.textContent = 'Alerts';
    btn.classList.remove('has-alerts');
  }
}

// ============================================================
// Settings
// ============================================================
function openSettings() {
  const overlay = document.getElementById('settingsOverlay');
  const input = document.getElementById('apiKeyInput');
  const status = document.getElementById('keyStatus');

  const override = localStorage.getItem('polygon_api_key_override');
  input.value = override || '';

  if (override) {
    status.className = 'key-status override';
    status.textContent = 'Currently using: User-supplied override key';
  } else {
    status.className = 'key-status hardcoded';
    status.textContent = 'Currently using: default key';
  }

  document.getElementById('themeToggle').checked =
    document.documentElement.getAttribute('data-theme') === 'dark';

  renderThresholdInputs();
  overlay.classList.add('open');
}

function renderThresholdInputs() {
  const container = document.getElementById('thresholdInputs');
  const config = getAlertConfig();
  const tickers = [...new Set(tranches.map(t => t.ticker))];
  let html = '';
  for (const ticker of tickers) {
    const cfg = config[ticker] || { addPct: -0.20, trimPct: 0.40 };
    html += `<div class="threshold-row">
      <span class="threshold-ticker">${ticker}</span>
      <span class="threshold-label">Buy &le;</span>
      <input type="number" class="threshold-input" id="thresh_buy_${ticker}" step="1" value="${(cfg.addPct * 100).toFixed(0)}">
      <span class="threshold-label">%</span>
      <span class="threshold-label" style="margin-left:8px">Trim &ge;</span>
      <input type="number" class="threshold-input" id="thresh_trim_${ticker}" step="1" value="${(cfg.trimPct * 100).toFixed(0)}">
      <span class="threshold-label">%</span>
    </div>`;
  }
  container.innerHTML = html;
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
}

function saveSettings() {
  // Save API key
  const val = document.getElementById('apiKeyInput').value.trim();
  if (val) {
    localStorage.setItem('polygon_api_key_override', val);
  } else {
    localStorage.removeItem('polygon_api_key_override');
  }

  // Save alert thresholds
  const tickers = [...new Set(tranches.map(t => t.ticker))];
  const thresholds = {};
  for (const ticker of tickers) {
    const buyEl = document.getElementById(`thresh_buy_${ticker}`);
    const trimEl = document.getElementById(`thresh_trim_${ticker}`);
    if (buyEl && trimEl) {
      thresholds[ticker] = {
        addPct: parseFloat(buyEl.value) / 100,
        trimPct: parseFloat(trimEl.value) / 100
      };
    }
  }
  localStorage.setItem('alert_thresholds', JSON.stringify(thresholds));

  closeSettings();
  renderTable();
  renderAlerts();
}

function resetApiKey() {
  localStorage.removeItem('polygon_api_key_override');
  document.getElementById('apiKeyInput').value = '';
  const status = document.getElementById('keyStatus');
  status.className = 'key-status hardcoded';
  status.textContent = 'Currently using: default key';
}

function resetThresholds() {
  localStorage.removeItem('alert_thresholds');
  renderThresholdInputs();
}

// ============================================================
// Add / Delete / Update Tranches
// ============================================================
function openAddTranche() {
  document.getElementById('addTrancheOverlay').classList.add('open');
  document.getElementById('inputTicker').value = '';
  document.getElementById('inputDate').value = '';
  document.getElementById('inputPrice').value = '';
  document.getElementById('inputSpyPrice').value = '';
}

function closeAddTranche() {
  document.getElementById('addTrancheOverlay').classList.remove('open');
}

function parseDate(input) {
  const match = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const mm = match[1].padStart(2, '0');
  const dd = match[2].padStart(2, '0');
  const yyyy = match[3];
  return `${yyyy}-${mm}-${dd}`;
}

async function addTranche() {
  const ticker = document.getElementById('inputTicker').value.trim().toUpperCase();
  const rawDate = document.getElementById('inputDate').value;
  const date = parseDate(rawDate);
  const price = parseFloat(document.getElementById('inputPrice').value);
  const spyPrice = parseFloat(document.getElementById('inputSpyPrice').value);

  if (!ticker || !date || isNaN(price) || isNaN(spyPrice)) {
    alert('Please fill in all fields with valid values.\nDate format: MM/DD/YYYY');
    return;
  }

  const trancheData = { ticker, date, purchasePrice: price, spyAtPurchase: spyPrice };

  if (useFirestore) {
    try {
      const docRef = await db.collection('tranches').add(trancheData);
      tranches.push({ id: docRef.id, ...trancheData });
    } catch (e) {
      showError('Failed to save tranche: ' + e.message);
      return;
    }
  } else {
    const id = nextId++;
    tranches.push({ id, ...trancheData });
    saveToLocalStorage();
  }

  closeAddTranche();
  renderTable();
  renderAlerts();
}

async function deleteTranche(id) {
  if (!confirm('Remove this tranche?')) return;

  if (useFirestore) {
    try {
      await db.collection('tranches').doc(String(id)).delete();
    } catch (e) {
      showError('Failed to delete tranche: ' + e.message);
      return;
    }
  }

  tranches = tranches.filter(t => String(t.id) !== String(id));

  if (!useFirestore) {
    saveToLocalStorage();
  }

  renderTable();
  renderAlerts();
}

async function updateTranche(id, field, value) {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return;

  const t = tranches.find(t => String(t.id) === String(id));
  if (!t) return;

  t[field] = num;

  if (useFirestore) {
    try {
      await db.collection('tranches').doc(String(id)).update({ [field]: num });
    } catch (e) {
      showError('Failed to update tranche: ' + e.message);
    }
  } else {
    saveToLocalStorage();
  }

  renderTable();
  renderAlerts();
}

async function updateTrancheDate(id, value) {
  const date = parseDate(value);
  if (!date) {
    alert('Invalid date format. Use MM/DD/YYYY');
    return;
  }

  const t = tranches.find(t => String(t.id) === String(id));
  if (!t) return;

  t.date = date;

  if (useFirestore) {
    try {
      await db.collection('tranches').doc(String(id)).update({ date });
    } catch (e) {
      showError('Failed to update tranche: ' + e.message);
    }
  } else {
    saveToLocalStorage();
  }

  renderTable();
  renderAlerts();
}

// ============================================================
// Initial load — auto-refresh prices on first load
// ============================================================
loadTranches().then(() => {
  renderTable();
  refreshPrices();
});
