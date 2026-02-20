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
// State
// ============================================================
let tranches = loadTranches();
let currentPrices = {};
let spyCurrentPrice = null;
let lastRefreshTime = null;
let nextId = tranches.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1;

// ============================================================
// localStorage persistence
// ============================================================
function loadTranches() {
  const saved = localStorage.getItem('portfolio_tranches');
  if (saved) {
    try { return JSON.parse(saved); } catch (e) { /* fall through */ }
  }
  // First run — seed from defaults and persist
  const defaults = JSON.parse(JSON.stringify(DEFAULT_TRANCHES));
  localStorage.setItem('portfolio_tranches', JSON.stringify(defaults));
  return defaults;
}

function saveTranches() {
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
//
// Days since trade     = today − purchase date
// P&L                  = current price − purchase price
// % P&L                = P&L ÷ purchase price
// Ann. % P&L           = % P&L ÷ (days ÷ 365)
// SPY P&L              = SPY today − SPY at purchase
// SPY % P&L            = SPY P&L ÷ SPY at purchase
// SPY Ann. % P&L       = SPY % P&L ÷ (days ÷ 365)
// Annualized alpha     = (Ann. % P&L − SPY Ann. % P&L) × 100
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

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

function renderTable() {
  const tbody = document.getElementById('tableBody');

  if (tranches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="no-data">No tranches — click <strong>+ Add Tranche</strong> to get started.</td></tr>';
    return;
  }

  // Group by ticker, preserve order of first appearance
  const grouped = {};
  const tickerOrder = [];
  for (const t of tranches) {
    if (!grouped[t.ticker]) {
      grouped[t.ticker] = [];
      tickerOrder.push(t.ticker);
    }
    grouped[t.ticker].push(t);
  }

  let html = '';

  for (const ticker of tickerOrder) {
    const group = grouped[ticker];
    const calcs = group.map(t => ({ tranche: t, calc: calcTranche(t) }));

    const n = group.length;
    const avgCost = group.reduce((s, t) => s + t.purchasePrice, 0) / n;
    const curPrice = currentPrices[ticker];
    const alphaVals = calcs.filter(c => c.calc.alpha != null).map(c => c.calc.alpha);
    const avgAlpha = alphaVals.length > 0 ? alphaVals.reduce((a, b) => a + b, 0) / alphaVals.length : null;

    html += `<tr class="group-header"><td colspan="14">${ticker}</td></tr>`;

    for (let i = 0; i < calcs.length; i++) {
      const { tranche: t, calc: c } = calcs[i];
      html += `<tr class="tranche-row">
        <td>${t.ticker}</td>
        <td>${fmtDate(t.date)}</td>
        <td class="num"><input class="inline-input" type="number" step="0.01" value="${t.purchasePrice}" onchange="updateTranche(${t.id},'purchasePrice',this.value)"></td>
        <td class="num">${c.currentPrice != null ? '$' + fmt(c.currentPrice) : '—'}</td>
        <td class="num">${c.days}</td>
        <td class="num ${colorClass(c.pnl)}">${c.pnl != null ? '$' + fmt(c.pnl) : '—'}</td>
        <td class="num ${colorClass(c.pctPnl)}">${fmtPct(c.pctPnl)}</td>
        <td class="num ${colorClass(c.annPctPnl)}">${fmtPct(c.annPctPnl)}</td>
        <td class="num"><input class="inline-input" type="number" step="0.01" value="${t.spyAtPurchase}" onchange="updateTranche(${t.id},'spyAtPurchase',this.value)"></td>
        <td class="num">${c.spyNow != null ? '$' + fmt(c.spyNow) : '—'}</td>
        <td class="num ${colorClass(c.spyPctPnl)}">${fmtPct(c.spyPctPnl)}</td>
        <td class="num ${colorClass(c.spyAnnPctPnl)}">${fmtPct(c.spyAnnPctPnl)}</td>
        <td class="num ${colorClass(c.alpha)}">${fmtAlpha(c.alpha)}</td>
        <td><button class="delete-btn" onclick="deleteTranche(${t.id})" title="Remove tranche">✕</button></td>
      </tr>`;
    }

    html += `<tr class="summary-row">
      <td colspan="2">${ticker} Summary (${n} tranche${n > 1 ? 's' : ''})</td>
      <td class="num">Avg: $${fmt(avgCost)}</td>
      <td class="num">${curPrice != null ? '$' + fmt(curPrice) : '—'}</td>
      <td colspan="8"></td>
      <td class="num ${colorClass(avgAlpha)}">${avgAlpha != null ? fmtAlpha(avgAlpha) : '—'}</td>
      <td></td>
    </tr>`;
  }

  tbody.innerHTML = html;
}

function renderAlerts() {
  const container = document.getElementById('alertsContainer');
  if (spyCurrentPrice === null || Object.keys(currentPrices).length === 0) {
    container.innerHTML = '';
    return;
  }

  // Calculate avg cost basis from actual tranches
  const avgCostByTicker = {};
  const grouped = {};
  for (const t of tranches) {
    if (!grouped[t.ticker]) grouped[t.ticker] = [];
    grouped[t.ticker].push(t);
  }
  for (const ticker in grouped) {
    const arr = grouped[ticker];
    avgCostByTicker[ticker] = arr.reduce((s, t) => s + t.purchasePrice, 0) / arr.length;
  }

  // MRK first (most active position)
  const alertTickers = Object.keys(avgCostByTicker);
  alertTickers.sort((a, b) => (a === 'MRK' ? -1 : b === 'MRK' ? 1 : 0));

  let html = '';

  for (const ticker of alertTickers) {
    const price = currentPrices[ticker];
    if (price == null) continue;

    const avgCost = avgCostByTicker[ticker];
    const config = ALERT_CONFIG[ticker] || { addPct: -0.20, trimPct: 0.40 };
    const pctFromAvg = (price - avgCost) / avgCost;
    const isMRK = ticker === 'MRK';

    let cls, label;
    if (pctFromAvg < config.addPct) {
      cls = 'alert-add';
      label = `${ticker} — Potential Add Signal — Current: $${fmt(price)}, Avg Cost: $${fmt(avgCost)}`;
    } else if (pctFromAvg > config.trimPct) {
      cls = 'alert-trim';
      label = `${ticker} — Consider Trim — Current: $${fmt(price)}, Avg Cost: $${fmt(avgCost)}`;
    } else {
      cls = 'alert-neutral';
      label = `${ticker} — Within Normal Range — Current: $${fmt(price)}, Avg Cost: $${fmt(avgCost)}`;
    }

    const pctStr = (pctFromAvg >= 0 ? '+' : '') + (pctFromAvg * 100).toFixed(1) + '% from avg';

    html += `<div class="alert ${cls} ${isMRK ? 'alert-mrk' : ''}">
      <span>${label}</span>
      <span class="pct">${pctStr}</span>
    </div>`;
  }

  container.innerHTML = html;
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

  overlay.classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.remove('open');
}

function saveApiKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (val) {
    localStorage.setItem('polygon_api_key_override', val);
  } else {
    localStorage.removeItem('polygon_api_key_override');
  }
  closeSettings();
}

function resetApiKey() {
  localStorage.removeItem('polygon_api_key_override');
  document.getElementById('apiKeyInput').value = '';
  const status = document.getElementById('keyStatus');
  status.className = 'key-status hardcoded';
  status.textContent = 'Currently using: Hardcoded default key';
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
  // Accept MM/DD/YYYY and convert to YYYY-MM-DD for storage
  const match = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const mm = match[1].padStart(2, '0');
  const dd = match[2].padStart(2, '0');
  const yyyy = match[3];
  return `${yyyy}-${mm}-${dd}`;
}

function addTranche() {
  const ticker = document.getElementById('inputTicker').value.trim().toUpperCase();
  const rawDate = document.getElementById('inputDate').value;
  const date = parseDate(rawDate);
  const price = parseFloat(document.getElementById('inputPrice').value);
  const spyPrice = parseFloat(document.getElementById('inputSpyPrice').value);

  if (!ticker || !date || isNaN(price) || isNaN(spyPrice)) {
    alert('Please fill in all fields with valid values.\nDate format: MM/DD/YYYY');
    return;
  }

  const id = nextId++;
  tranches.push({ id, ticker, date, purchasePrice: price, spyAtPurchase: spyPrice });
  saveTranches();
  closeAddTranche();
  renderTable();
  renderAlerts();
}

function deleteTranche(id) {
  if (!confirm('Remove this tranche?')) return;
  tranches = tranches.filter(t => t.id !== id);
  saveTranches();
  renderTable();
  renderAlerts();
}

function updateTranche(id, field, value) {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return;
  const t = tranches.find(t => t.id === id);
  if (t) {
    t[field] = num;
    saveTranches();
    renderTable();
    renderAlerts();
  }
}

// ============================================================
// Initial render
// ============================================================
renderTable();
