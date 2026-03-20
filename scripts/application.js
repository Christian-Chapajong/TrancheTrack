// ============================================================
// Theme
// ============================================================
function initTheme() {
  if (localStorage.getItem('theme') === 'light') {
    document.documentElement.removeAttribute('data-theme');
  }
  // Dark is the default — already set on <html data-theme="dark">
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.removeItem('theme');
  }
}

initTheme();

// ============================================================
// Toast notification system
// ============================================================
const _toastActive = new Map(); // fingerprint → auto-dismiss timeout id
let _toastSeq = 0;

// Derive a stable fingerprint so identical/related errors never stack up
function _toastFingerprint(msg) {
  // 429 rate-limit — all tickers share one slot
  if (/:\s*429\b/.test(msg)) return 'rate-limit-429';
  // Other HTTP status codes (403, 500, 503…) — grouped by code
  const statusM = msg.match(/:\s*(\d{3})\b/);
  if (statusM) return `api-err-${statusM[1]}`;
  // "No price data returned for X" — one per ticker
  const noPriceM = msg.match(/No price data returned for (\S+)/);
  if (noPriceM) return `no-price-${noPriceM[1]}`;
  // Firestore / Firebase errors
  if (/firestore|firebase/i.test(msg)) return 'firestore';
  // Failed to save/update/delete
  if (/Failed to (save|update|delete)/i.test(msg)) return 'persist-error';
  // Generic fallback — first 80 chars as key
  return msg.slice(0, 80);
}

function showToast(msg, type = 'error', durationMs = 9000) {
  const fp = _toastFingerprint(msg);
  if (_toastActive.has(fp)) return;          // already visible — suppress duplicate

  const container = document.getElementById('toastContainer');
  if (!container) return;

  const id = 'tt-' + (++_toastSeq);
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.id = id;
  el.innerHTML =
    `<span class="toast-msg">${msg}</span>` +
    `<button class="toast-close" onclick="dismissToast('${id}','${fp}')">&times;</button>`;
  container.appendChild(el);

  const tid = setTimeout(() => dismissToast(id, fp), durationMs);
  _toastActive.set(fp, tid);
}

function dismissToast(id, fp) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('toast-out');
    setTimeout(() => el && el.remove(), 300);
  }
  if (_toastActive.has(fp)) {
    clearTimeout(_toastActive.get(fp));
    _toastActive.delete(fp);
  }
}

function showError(msg) {
  showToast(msg, 'error');
}

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
let lastPriceRefresh = null;
let perTickerTs = {};
let refreshLock = false;
let nextId = 1;
let expandedTickers = new Set();
let editingTickers = new Set();
let accordionsInitialized = false;
let sidebarOpen = false;
let currentFilterTicker = '';
let currentFilterPortfolio = '';
let currentSort = 'ticker';
let activeAlertTab = 'composite';
let compHiddenTickers = new Set(); // tickers unchecked in composite filter
let compFilterOpen = false;

// ============================================================
// Cache (localStorage) — prices (8h)
// ============================================================
const PRICE_CACHE_KEY     = 'tt_price_cache';
const PRICE_TTL_MS        = 8  * 60 * 60 * 1000;        // 8 hours

function savePriceCache() {
  try {
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({
      currentPrices,
      spyCurrentPrice,
      lastPriceRefresh: lastPriceRefresh ? lastPriceRefresh.toISOString() : null,
      perTickerTs
    }));
  } catch (e) { /* storage quota — not critical */ }
}

function loadPriceCache() {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return false;
    const cache = JSON.parse(raw);
    if (!cache.spyCurrentPrice) return false;
    currentPrices    = cache.currentPrices    || {};
    spyCurrentPrice  = cache.spyCurrentPrice;
    lastPriceRefresh = cache.lastPriceRefresh ? new Date(cache.lastPriceRefresh) : null;
    perTickerTs      = cache.perTickerTs       || {};
    return true;
  } catch (e) {
    return false;
  }
}

function isPriceCacheFresh() {
  return lastPriceRefresh != null && (Date.now() - lastPriceRefresh.getTime()) < PRICE_TTL_MS;
}

function isMarketOpen() {
  const now = new Date();
  // Convert to US Eastern time
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etStr);
  const day = et.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const hour = et.getHours();
  const min  = et.getMinutes();
  const mins = hour * 60 + min;
  return mins >= 570 && mins < 960; // 9:30am–4:00pm ET
}

function marketStatusLabel() {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etStr);
  const day = et.getDay();
  if (day === 0) return 'Market Closed (Sunday)';
  if (day === 6) return 'Market Closed (Saturday)';
  const hour = et.getHours();
  const min  = et.getMinutes();
  const mins = hour * 60 + min;
  if (mins < 570) return 'Market Not Yet Open';
  if (mins >= 960) return 'Market Closed (After Hours)';
  return 'Market Open';
}

async function trySnapshotFetch(tickers) {
  const key = getApiKey();
  const joined = tickers.join(',');
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${joined}&apiKey=${key}`;
  try {
    const resp = await fetch(url);
    if (resp.status === 403) return null; // free-tier — no access
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.tickers) return null;
    const prices = {};
    for (const t of data.tickers) {
      const price = t.day?.c || t.prevDay?.c;
      if (price) prices[t.ticker] = price;
    }
    return prices;
  } catch (e) {
    return null;
  }
}

function toggleCompFilter(ticker) {
  if (compHiddenTickers.has(ticker)) {
    compHiddenTickers.delete(ticker);
  } else {
    compHiddenTickers.add(ticker);
  }
  renderAlerts();
}

function toggleCompFilterDropdown(e) {
  e.stopPropagation();
  compFilterOpen = !compFilterOpen;
  renderAlerts();
}

// Canonical key used for duplicate detection across all tranche operations
function trancheKey(t) {
  return `${t.ticker}|${t.date}|${parseFloat(t.purchasePrice).toFixed(2)}`;
}

// ============================================================
// Data persistence — Firestore with localStorage fallback
// ============================================================
async function loadTranches() {
  if (useFirestore) {
    try {
      const snapshot = await db.collection('tranches').get();
      tranches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Seed any default tranches not yet present, identified by key
      const existingKeys = new Set(tranches.map(trancheKey));
      const missing = DEFAULT_TRANCHES.filter(t => !existingKeys.has(trancheKey(t)));
      if (missing.length > 0) {
        const batch = db.batch();
        for (const t of missing) {
          const ref = db.collection('tranches').doc();
          const doc = {
            ticker: t.ticker,
            date: t.date,
            purchasePrice: t.purchasePrice ?? null,
            spyAtPurchase: t.spyAtPurchase ?? null,
            portfolio: t.portfolio || 'Main',
          };
          if (t.shares != null) doc.shares = t.shares;
          batch.set(ref, doc);
        }
        await batch.commit();
        const refreshed = await db.collection('tranches').get();
        tranches = refreshed.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
  // Seed any missing defaults in localStorage too
  const existingKeys = new Set(tranches.map(trancheKey));
  const missing = DEFAULT_TRANCHES.filter(t => !existingKeys.has(trancheKey(t)));
  if (missing.length > 0) {
    let id = tranches.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1;
    for (const t of missing) {
      tranches.push({ id: id++, ...t });
    }
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

// ============================================================
// Fetch SPY close on (or nearest trading day before) a given date
// Used to auto-fill spyAtPurchase for historical tranches.
// ============================================================
async function fetchSpyAtDate(dateStr) {
  const key = getApiKey();
  // Look back up to 7 calendar days to skip weekends / holidays
  const to = dateStr;
  const fromDate = new Date(dateStr + 'T00:00:00');
  fromDate.setDate(fromDate.getDate() - 7);
  const from = fromDate.toISOString().split('T')[0];
  const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=1&apiKey=${key}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return null;
    return data.results[0].c;
  } catch (e) {
    return null;
  }
}

async function fillMissingSpyPrices() {
  const missing = tranches.filter(t => t.spyAtPurchase == null);
  if (missing.length === 0) return;

  // Group by date to avoid redundant API calls
  const byDate = {};
  for (const t of missing) {
    if (!byDate[t.date]) byDate[t.date] = [];
    byDate[t.date].push(t);
  }

  let filled = 0;
  for (const [date, group] of Object.entries(byDate)) {
    const spy = await fetchSpyAtDate(date);
    if (spy == null) continue;
    for (const t of group) {
      t.spyAtPurchase = spy;
      if (useFirestore) {
        try {
          await db.collection('tranches').doc(String(t.id)).update({ spyAtPurchase: spy });
        } catch (e) { /* ignore individual failures */ }
      }
      filled++;
    }
  }

  if (!useFirestore && filled > 0) saveToLocalStorage();
  if (filled > 0) {
    showToast(`Auto-filled SPY price for ${filled} tranche${filled > 1 ? 's' : ''} using historical data.`, 'success', 7000);
    renderTable();
  }
}

// ============================================================
// Refresh prices
// ============================================================

// Quick refresh — prices only, skips if cache is fresh or market is closed
async function quickRefreshPrices() {
  if (refreshLock) return;

  // Market-hours guard
  if (!isMarketOpen() && isPriceCacheFresh()) {
    showToast(`${marketStatusLabel()} — prices are up to date.`, 'success', 5000);
    return;
  }

  // Per-ticker staleness: only fetch tickers older than PRICE_TTL_MS
  const allTickers = [...new Set(tranches.map(t => t.ticker))];
  if (!allTickers.includes('SPY')) allTickers.push('SPY');
  const now = Date.now();
  const stale = allTickers.filter(ticker => {
    const ts = perTickerTs[ticker];
    return !ts || (now - new Date(ts).getTime()) >= PRICE_TTL_MS;
  });

  if (stale.length === 0) {
    showToast('All prices are up to date.', 'success', 4000);
    return;
  }

  refreshLock = true;
  const btn       = document.getElementById('refreshBtn');
  const loadingEl = document.getElementById('loadingMsg');
  btn.disabled    = true;
  btn.textContent = 'Loading…';

  // Try snapshot endpoint first (~1 API call)
  const snapshotPrices = await trySnapshotFetch(stale);
  if (snapshotPrices) {
    for (const ticker of stale) {
      const price = snapshotPrices[ticker];
      if (price == null) continue;
      if (ticker === 'SPY') spyCurrentPrice = price;
      else currentPrices[ticker] = price;
      perTickerTs[ticker] = new Date().toISOString();
    }
    lastPriceRefresh = new Date();
    document.getElementById('lastRefresh').textContent =
      'Last refresh: ' + lastPriceRefresh.toLocaleString();
    savePriceCache();
    renderTable();
    renderAlerts();
    btn.disabled    = false;
    btn.textContent = 'Refresh Prices';
    loadingEl.innerHTML = '';
    refreshLock = false;
    return;
  }

  // Fallback: batched /prev calls (5/min rate limit)
  const BATCH  = 5;
  const WINDOW = 61000;
  const total  = stale.length;
  let   done   = 0;
  const rateLimitTickers = [];
  const otherErrors      = [];

  for (let i = 0; i < total; i += BATCH) {
    const batch      = stale.slice(i, i + BATCH);
    const batchStart = Date.now();

    loadingEl.innerHTML =
      `<span class="spinner"></span> Fetching ${done + 1}–${Math.min(done + BATCH, total)} of ${total} tickers…`;

    await Promise.all(batch.map(async ticker => {
      try {
        const price = await fetchPrice(ticker);
        if (ticker === 'SPY') spyCurrentPrice = price;
        else currentPrices[ticker] = price;
        perTickerTs[ticker] = new Date().toISOString();
      } catch (e) {
        console.error('[TrancheTrack] Fetch failed for', ticker, ':', e.message);
        if (/:\s*429\b/.test(e.message)) rateLimitTickers.push(ticker);
        else otherErrors.push(e.message);
      }
    }));

    done += batch.length;
    if (spyCurrentPrice !== null) renderTable();

    if (done < total) {
      const wait = WINDOW - (Date.now() - batchStart);
      if (wait > 0) {
        const until = Date.now() + wait;
        await new Promise(resolve => {
          const tick = setInterval(() => {
            const secs = Math.ceil((until - Date.now()) / 1000);
            loadingEl.innerHTML =
              `<span class="spinner"></span> Rate limit — next batch in ${secs}s &nbsp;(${done} / ${total} done)`;
            if (Date.now() >= until) { clearInterval(tick); resolve(); }
          }, 500);
        });
      }
    }
  }

  loadingEl.innerHTML = '';
  btn.disabled        = false;
  btn.textContent     = 'Refresh Prices';
  refreshLock         = false;

  if (rateLimitTickers.length > 0) {
    showToast(
      `Rate limit (429) hit for: ${rateLimitTickers.join(', ')}. Some prices may be missing.`,
      'error', 12000
    );
  }
  for (const msg of otherErrors) showToast(msg, 'error');

  if (spyCurrentPrice !== null) {
    lastPriceRefresh = new Date();
    document.getElementById('lastRefresh').textContent =
      'Last refresh: ' + lastPriceRefresh.toLocaleString();
    savePriceCache();
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

  // Tranche with unknown purchase price — can only show current price & days
  if (t.purchasePrice == null) {
    return { days, currentPrice, spyNow, missingPrice: true };
  }

  const pnl = currentPrice - t.purchasePrice;
  const pctPnl = pnl / t.purchasePrice;
  const annPctPnl = days > 0 ? pctPnl / (days / 365) : 0;

  // SPY comparison — only if spyAtPurchase is available
  let spyPnl = null, spyPctPnl = null, spyAnnPctPnl = null, alpha = null;
  if (t.spyAtPurchase != null && t.spyAtPurchase > 0) {
    spyPnl = spyNow - t.spyAtPurchase;
    spyPctPnl = spyPnl / t.spyAtPurchase;
    spyAnnPctPnl = days > 0 ? spyPctPnl / (days / 365) : 0;
    alpha = (annPctPnl - spyAnnPctPnl) * 100;
  }

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
  currentFilterPortfolio = document.getElementById('filterPortfolio').value;
  currentSort = document.getElementById('sortField').value;
  renderTable();
}

function updateFilterOptions() {
  // Portfolio filter
  const portSel = document.getElementById('filterPortfolio');
  if (portSel) {
    const portfolios = [...new Set(tranches.map(t => t.portfolio || 'Main'))].sort();
    const curPort = portSel.value;
    portSel.innerHTML = '<option value="">All Portfolios</option>';
    for (const p of portfolios) {
      portSel.innerHTML += `<option value="${p}" ${p === curPort ? 'selected' : ''}>${p}</option>`;
    }
  }

  // Ticker filter
  const tickerSel = document.getElementById('filterTicker');
  const tickers = [...new Set(tranches.map(t => t.ticker))].sort();
  const curTicker = tickerSel.value;
  tickerSel.innerHTML = '<option value="">All</option>';
  for (const t of tickers) {
    tickerSel.innerHTML += `<option value="${t}" ${t === curTicker ? 'selected' : ''}>${t}</option>`;
  }

  // Portfolio selector in Add Tranche form
  const inputPort = document.getElementById('inputPortfolio');
  if (inputPort && inputPort.options.length === 0) {
    for (const p of (typeof PORTFOLIOS !== 'undefined' ? PORTFOLIOS : portfolios || [])) {
      inputPort.innerHTML += `<option value="${p}">${p}</option>`;
    }
  }
}

function getFilteredSortedTranches() {
  let filtered = tranches;
  if (currentFilterPortfolio) {
    filtered = filtered.filter(t => (t.portfolio || 'Main') === currentFilterPortfolio);
  }
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
    const arr = grouped[ticker].filter(t => t.purchasePrice != null);
    if (arr.length === 0) continue;
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

// ============================================================
// Composite Signal — combines oscillator (±2) + technicals (±1 each)
// ============================================================
function calcCompositeScore(ticker) {
  const osc = calcOscillator(ticker);
  const alertConfig = getAlertConfig();
  const cfg = alertConfig[ticker] || { addPct: -0.20, trimPct: 0.40 };
  let score = 0;

  if (osc != null) {
    if (osc <= cfg.addPct) score += 2;
    else if (osc >= cfg.trimPct) score -= 2;
  }

  let label, cssClass, icon;
  if (score >= 2)       { label = 'Buy';   cssClass = 'buy';  icon = 'fa-arrow-up';           }
  else if (score === 0) { label = 'Hold';  cssClass = 'hold'; icon = 'fa-pause';              }
  else                  { label = 'Sell';  cssClass = 'sell'; icon = 'fa-circle-exclamation'; }

  return { score, label, cssClass, icon };
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

function renderTrancheRow(t, c, isEditing) {
  const priceCell = isEditing
    ? `<input class="inline-input" type="number" step="0.01" value="${t.purchasePrice ?? ''}" placeholder="?" onchange="updateTranche('${t.id}','purchasePrice',this.value)">`
    : (t.purchasePrice != null ? `$${fmt(t.purchasePrice)}` : '—');

  const spyCell = isEditing
    ? `<input class="inline-input" type="number" step="0.01" value="${t.spyAtPurchase ?? ''}" placeholder="?" onchange="updateTranche('${t.id}','spyAtPurchase',this.value)">`
    : (t.spyAtPurchase != null ? `$${fmt(t.spyAtPurchase)}` : '—');

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
    <td>${isEditing ? `<button class="delete-btn" onclick="deleteTranche('${t.id}')" title="Remove tranche">&#10005;</button>` : ''}</td>
  </tr>`;
}

function renderTable() {
  const tbody = document.getElementById('tableBody');
  updateFilterOptions();
  rebuildAvgCostCache();

  if (tranches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="no-data">No tranches — click <strong>+ Add Tranche</strong> to get started.</td></tr>';
    return;
  }

  const items = getFilteredSortedTranches();

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="no-data">No tranches match the current filter.</td></tr>';
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
      const pricedGroup = group.filter(t => t.purchasePrice != null);
      const avgCost = pricedGroup.length > 0 ? pricedGroup.reduce((s, t) => s + t.purchasePrice, 0) / pricedGroup.length : null;
      const curPrice = currentPrices[ticker];
      const alphaVals = calcs.filter(c => c.calc.alpha != null).map(c => c.calc.alpha);
      const avgAlpha = alphaVals.length > 0 ? alphaVals.reduce((a, b) => a + b, 0) / alphaVals.length : null;

      const chevron = isExpanded ? '&#9660;' : '&#9654;';
      const sig = calcCompositeScore(ticker);
      html += `<tr class="group-header" onclick="toggleAccordion('${ticker}')">
        <td colspan="12">
          <span class="accordion-chevron">${chevron}</span>
          <span class="accordion-ticker">${ticker}</span>
          <span class="accordion-meta">${n} tranche${n > 1 ? 's' : ''} · Avg: ${avgCost != null ? '$' + fmt(avgCost) : '—'} · Current: ${curPrice != null ? '$' + fmt(curPrice) : '—'}</span>
          <span class="signal-badge signal-${sig.cssClass}"><i class="fa-solid ${sig.icon}"></i> ${sig.label}</span>
        </td>
        <td class="num ${colorClass(avgAlpha)}">${avgAlpha != null ? fmtAlpha(avgAlpha) : '—'}</td>
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
          <td class="num">${avgCost != null ? 'Avg: $' + fmt(avgCost) : '—'}</td>
          <td class="num">${curPrice != null ? '$' + fmt(curPrice) : '—'}</td>
          <td colspan="8"></td>
          <td class="num ${colorClass(avgAlpha)}">${avgAlpha != null ? fmtAlpha(avgAlpha) : '—'}</td>
          <td></td>
        </tr>`;

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

function setAlertTab(tab) {
  activeAlertTab = tab;
  renderAlerts();
}

function renderAlerts() {
  const tabsEl = document.getElementById('alertsTabs');
  const container = document.getElementById('alertsContainer');

  if (spyCurrentPrice === null || Object.keys(currentPrices).length === 0) {
    tabsEl.innerHTML = '';
    container.innerHTML = '<div class="sidebar-empty">Click <strong>Refresh Prices</strong> to generate alerts.</div>';
    return;
  }

  rebuildAvgCostCache();
  const alertConfig = getAlertConfig();
  const alertTickers = Object.keys(avgCostCache);

  // Build all category data
  const buyAlerts = [];
  const sellAlerts = [];
  const holdAlerts = [];

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

  }

  // Composite scores ranked
  const compTickers = alertTickers.filter(t => currentPrices[t] != null);
  const ranked = compTickers
    .map(t => ({ ticker: t, ...calcCompositeScore(t) }))
    .sort((a, b) => b.score - a.score);

  // ── Tab bar ──
  const tabDefs = [
    { id: 'composite', label: 'Composite',  count: null               },
    { id: 'buy',       label: 'Buy',         count: buyAlerts.length   },
    { id: 'sell',      label: 'Sell',        count: sellAlerts.length  },
    { id: 'hold',      label: 'Hold',        count: holdAlerts.length  },
  ];
  tabsEl.innerHTML = tabDefs.map(t =>
    `<button class="sidebar-tab${activeAlertTab === t.id ? ' active' : ''}" onclick="setAlertTab('${t.id}')">
      ${t.label}${t.count != null ? `<span class="tab-count">${t.count}</span>` : ''}
    </button>`
  ).join('');

  // ── Active pane ──
  let html = '';

  if (activeAlertTab === 'composite') {
    if (ranked.length === 0) {
      html = '<div class="sidebar-empty">No price data available.</div>';
    } else {
      // Dropdown filter
      const filterLabel = compHiddenTickers.size === 0
        ? 'All tickers'
        : `${ranked.length - compHiddenTickers.size} / ${ranked.length} tickers`;
      html = `<div class="comp-filter-wrap">
        <button class="comp-filter-btn" onclick="toggleCompFilterDropdown(event)">
          <span>${filterLabel}</span>
          <span class="comp-filter-chevron">${compFilterOpen ? '&#9650;' : '&#9660;'}</span>
        </button>
        ${compFilterOpen ? `<div class="comp-filter-dropdown">
          ${ranked.map(r => {
            const checked = !compHiddenTickers.has(r.ticker) ? 'checked' : '';
            return `<label class="comp-filter-option">
              <input type="checkbox" ${checked} onchange="toggleCompFilter('${r.ticker}')">
              <span>${r.ticker}</span>
            </label>`;
          }).join('')}
        </div>` : ''}
      </div>`;

      // Number-line rows (filtered)
      const visible = ranked.filter(r => !compHiddenTickers.has(r.ticker));
      if (visible.length === 0) {
        html += '<div class="sidebar-empty">No tickers selected.</div>';
      } else {
        html += '<div class="comp-list">';
        for (const r of visible) {
          const needlePct = ((r.score + 6) / 12 * 100).toFixed(1);
          const scoreStr = r.score > 0 ? `+${r.score}` : `${r.score}`;
          html += `<div class="comp-row">
            <div class="comp-row-top">
              <span class="comp-ticker">${r.ticker}</span>
              <span class="signal-badge signal-${r.cssClass}"><i class="fa-solid ${r.icon}"></i> ${r.label}</span>
              <span class="comp-score signal-${r.cssClass}">${scoreStr}</span>
            </div>
            <div class="comp-nl">
              <div class="comp-nl-zone comp-nl-strong-sell"></div>
              <div class="comp-nl-zone comp-nl-sell"></div>
              <div class="comp-nl-zone comp-nl-hold"></div>
              <div class="comp-nl-zone comp-nl-buy"></div>
              <div class="comp-nl-zone comp-nl-strong-buy"></div>
              <div class="comp-nl-needle" style="left:${needlePct}%"></div>
            </div>
            <div class="comp-nl-labels">
              <span>-6</span><span>-3</span><span>0</span><span>+3</span><span>+6</span>
            </div>
          </div>`;
        }
        html += '</div>';
      }
    }

  } else if (activeAlertTab === 'buy') {
    if (buyAlerts.length === 0) {
      html = '<div class="sidebar-empty">No buy signals at current thresholds.</div>';
    }
    for (const a of buyAlerts) {
      html += `<div class="alert alert-add ${a.isMRK ? 'alert-mrk' : ''}">
        <div class="alert-main"><strong>${a.ticker}</strong> — Potential Add</div>
        <div class="alert-detail">Current: $${fmt(a.price)} · Avg Cost: $${fmt(a.avgCost)}</div>
        ${a.gauge}
        <div class="alert-pct">${a.pctStr}</div>
      </div>`;
    }

  } else if (activeAlertTab === 'sell') {
    if (sellAlerts.length === 0) {
      html = '<div class="sidebar-empty">No sell signals at current thresholds.</div>';
    }
    for (const a of sellAlerts) {
      html += `<div class="alert alert-trim ${a.isMRK ? 'alert-mrk' : ''}">
        <div class="alert-main"><strong>${a.ticker}</strong> — Consider Trim</div>
        <div class="alert-detail">Current: $${fmt(a.price)} · Avg Cost: $${fmt(a.avgCost)}</div>
        ${a.gauge}
        <div class="alert-pct">${a.pctStr}</div>
      </div>`;
    }

  } else if (activeAlertTab === 'hold') {
    if (holdAlerts.length === 0) {
      html = '<div class="sidebar-empty">No positions in hold range.</div>';
    }
    for (const a of holdAlerts) {
      html += `<div class="alert alert-neutral">
        <div class="alert-main"><strong>${a.ticker}</strong> — Within Range</div>
        <div class="alert-detail">Current: $${fmt(a.price)} · Avg Cost: $${fmt(a.avgCost)}</div>
        ${a.gauge}
        <div class="alert-pct">${a.pctStr}</div>
      </div>`;
    }

  }

  container.innerHTML = html;

  // Update badge on alerts button
  const totalActionable = buyAlerts.length + sellAlerts.length;
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

  const portfolioVal = (document.getElementById('inputPortfolio') || {}).value || 'Main';
  const trancheData = { ticker, date, purchasePrice: price, spyAtPurchase: spyPrice, portfolio: portfolioVal };

  // Block exact duplicates (same ticker + date + purchase price)
  if (tranches.some(t => trancheKey(t) === trancheKey(trancheData))) {
    alert(`A tranche for ${ticker} on ${rawDate} at $${price.toFixed(2)} already exists.`);
    return;
  }

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
  const t = tranches.find(t => String(t.id) === String(id));
  if (!t) return;

  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return;
  const stored = num;

  t[field] = stored;

  if (useFirestore) {
    try {
      const update = stored === null
        ? { [field]: firebase.firestore.FieldValue.delete() }
        : { [field]: stored };
      await db.collection('tranches').doc(String(id)).update(update);
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
// Deduplicate — remove exact duplicates (same ticker+date+price),
// keeping whichever copy has shares data; runs once on startup.
// ============================================================
async function deduplicateTranches() {
  const best = new Map();   // key → tranche to keep
  const toDelete = [];      // ids to remove

  for (const t of tranches) {
    const key = trancheKey(t);
    if (!best.has(key)) {
      best.set(key, t);
    } else {
      const existing = best.get(key);
      // Prefer the copy that already has a shares value
      if (t.shares != null && existing.shares == null) {
        best.set(key, t);
        toDelete.push(existing.id);
      } else {
        toDelete.push(t.id);
      }
    }
  }

  if (toDelete.length === 0) return;

  tranches = tranches.filter(t => !toDelete.includes(t.id));

  if (useFirestore) {
    const batch = db.batch();
    for (const id of toDelete) {
      batch.delete(db.collection('tranches').doc(String(id)));
    }
    await batch.commit();
  } else {
    saveToLocalStorage();
  }

  console.log(`deduplicateTranches: removed ${toDelete.length} duplicate(s)`);
}

// ============================================================
// Global click-outside handler — closes composite filter dropdown
// ============================================================
document.addEventListener('click', function(e) {
  if (compFilterOpen && !e.target.closest('.comp-filter-wrap')) {
    compFilterOpen = false;
    renderAlerts();
  }
});

// ============================================================
// Initial load — restore cached prices or fetch fresh on first-ever load
// ============================================================
loadTranches().then(async () => {
  await deduplicateTranches();

  if (loadPriceCache()) {
    const refreshEl = document.getElementById('lastRefresh');
    if (refreshEl && lastPriceRefresh) {
      refreshEl.textContent = 'Last refresh: ' + lastPriceRefresh.toLocaleString();
    }

    renderTable();
    renderAlerts();

    if (!isPriceCacheFresh()) {
      quickRefreshPrices();
    }
  } else {
    renderTable();
    quickRefreshPrices();
  }

  fillMissingSpyPrices();
});
