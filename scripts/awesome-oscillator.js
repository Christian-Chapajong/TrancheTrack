// ============================================================
// awesome-oscillator.js
// Awesome Oscillator page logic — calculations, signal detection,
// chart rendering (Lightweight Charts v4), and data management.
// ============================================================

// ============================================================
// 1. CONFIG & STATE
// ============================================================
const AO_BARS_CACHE_KEY = 'tt_ao_bars';
const AO_BARS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let aoBarsCache = {}; // ticker → bars[]
let spyBarsCache = []; // SPY bars
let currentTicker = null;
let priceChart = null;
let aoChart = null;
let currentTimeRangeDays = 365;
let fetchLock = false;

// ============================================================
// 2. UTILITY
// ============================================================

/**
 * Returns the active API key — checks localStorage override first,
 * then falls back to the API_KEY constant from constants.js.
 */
function getApiKey() {
  return localStorage.getItem('polygon_api_key_override') || API_KEY;
}

/**
 * Restores dark/light theme from localStorage.
 * Dark is the default (set via <html data-theme="dark">).
 * If the user previously chose light, remove the attribute.
 */
function initTheme() {
  if (localStorage.getItem('theme') === 'light') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

/**
 * Toggles between dark and light theme and persists the choice.
 */
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.removeItem('theme');
  }

  // Re-render charts in new theme if one is active
  if (currentTicker && aoBarsCache[currentTicker]) {
    renderCharts(currentTicker, aoBarsCache[currentTicker]);
  }
}

// ============================================================
// 3. CACHE (localStorage)
// ============================================================

/**
 * Saves aoBarsCache + spyBarsCache + timestamp to localStorage.
 */
function saveAOBarsCache() {
  try {
    const payload = {
      ts: Date.now(),
      tickers: aoBarsCache,
      spy: spyBarsCache,
    };
    localStorage.setItem(AO_BARS_CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('AO cache save failed (quota?):', e.message);
  }
}

/**
 * Loads cache from localStorage.
 * Returns true if the cache exists and is fresh (< 24 hours old).
 * Populates aoBarsCache and spyBarsCache from stored data.
 */
function loadAOBarsCache() {
  try {
    const raw = localStorage.getItem(AO_BARS_CACHE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload || !payload.ts) return false;
    const age = Date.now() - payload.ts;
    if (age > AO_BARS_TTL_MS) return false;

    aoBarsCache = payload.tickers || {};
    spyBarsCache = payload.spy || [];
    return true;
  } catch (e) {
    console.warn('AO cache load failed:', e.message);
    return false;
  }
}

// ============================================================
// 4. DATA FETCHING
// ============================================================

/**
 * Fetches ~450 calendar days of daily bars from Polygon.io for a given ticker.
 * URL: /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}?adjusted=true&sort=asc&limit=500
 * Returns array of {date: 'YYYY-MM-DD', o, h, l, c, v} or [] on failure.
 *
 * @param {string} ticker
 * @returns {Promise<Array>}
 */
async function fetchHistoricalLong(ticker) {
  try {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 450);

    const fmt = d => d.toISOString().slice(0, 10);
    const from = fmt(fromDate);
    const to = fmt(toDate);
    const key = getApiKey();

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
      `/range/1/day/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=500&apiKey=${key}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`fetchHistoricalLong(${ticker}): HTTP ${resp.status}`);
      return [];
    }

    const data = await resp.json();
    if (!data.results || data.results.length === 0) {
      console.warn(`fetchHistoricalLong(${ticker}): no results`);
      return [];
    }

    return data.results.map(r => ({
      date: new Date(r.t).toISOString().slice(0, 10),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
    }));
  } catch (e) {
    console.error(`fetchHistoricalLong(${ticker}) error:`, e.message);
    return [];
  }
}

// ============================================================
// 5. PURE CALCULATION FUNCTIONS
// ============================================================

/**
 * Calculates the Awesome Oscillator series for an array of bars.
 * AO = SMA(5) of midpoints - SMA(34) of midpoints
 * where midpoint = (high + low) / 2
 *
 * Returns an array the same length as bars.
 * The first 33 elements are null (insufficient data for SMA34).
 *
 * @param {Array} bars - Array of {h, l, ...} bar objects
 * @returns {Array<number|null>}
 */
function calcAOSeries(bars) {
  if (!bars || bars.length === 0) return [];

  const midpoints = bars.map(b => (b.h + b.l) / 2);
  const sma5 = calcSMALine(midpoints, 5);
  const sma34 = calcSMALine(midpoints, 34);

  return bars.map((_, i) => {
    if (sma5[i] === null || sma34[i] === null) return null;
    return sma5[i] - sma34[i];
  });
}

/**
 * Calculates a Simple Moving Average line for an array of values.
 * Returns an array the same length as values.
 * The first (period - 1) elements are null.
 *
 * @param {Array<number>} values
 * @param {number} period
 * @returns {Array<number|null>}
 */
function calcSMALine(values, period) {
  if (!values || values.length === 0) return [];
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j];
    }
    result[i] = sum / period;
  }
  return result;
}

/**
 * Full state-machine analysis of the Awesome Oscillator.
 *
 * States: 'out' | 't1' | 't2' | 'riding' | 'sell-watch'
 *
 * Buy signals:
 *   'buy-t1'  — negative AO inflects upward (was declining, now rising)
 *   'buy-t2'  — AO reaches peakNeg/2 (halfway back to zero) from negative
 *   'buy-t3'  — AO crosses zero from below
 *
 * Sell signals:
 *   'sell-neg'  — AO turns negative while in 'riding' state
 *   'sell-peak' — positive AO inflects downward (was rising, now falling)
 *
 * @param {Array} bars - Array of {date, h, l, ...} bar objects
 * @returns {{
 *   aoValues: Array<number|null>,
 *   signals: Array<{i, date, type, label, ao, peakNeg?}>,
 *   state: string,
 *   peakNeg: number|null,
 *   latestAO: number|null,
 *   prevAO: number|null
 * }}
 */
function analyzeAO(bars) {
  const empty = {
    aoValues: [],
    signals: [],
    state: 'out',
    peakNeg: null,
    latestAO: null,
    prevAO: null,
  };

  if (!bars || bars.length < 35) return empty;

  const aoValues = calcAOSeries(bars);
  const signals = [];

  let state = 'out';
  let peakNeg = null; // most negative AO seen while negative (a negative number)

  // We need three consecutive AO values to detect inflection points.
  // Start from index 34 (first valid AO value) but we need index-2 to be valid too,
  // so effective start is index 35 (index 34 has sma5 but prev-prev may be null).
  // We'll track prevAO and prevPrevAO manually.
  let prevAO = null;
  let prevPrevAO = null;

  for (let i = 0; i < aoValues.length; i++) {
    const ao = aoValues[i];
    if (ao === null) {
      prevPrevAO = prevPrevAO; // keep old
      // shift
      prevPrevAO = prevAO;
      prevAO = ao;
      continue;
    }

    // ── State: 'out' ──────────────────────────────────────────
    if (state === 'out') {
      // Track most negative AO
      if (ao < 0) {
        if (peakNeg === null || ao < peakNeg) peakNeg = ao;
      }

      // Check for T1: was declining (prevAO <= prevPrevAO), now rising (ao > prevAO)
      // All three must be negative for a classic T1
      if (
        prevAO !== null &&
        prevPrevAO !== null &&
        prevAO < 0 &&
        ao < 0 &&
        ao > prevAO &&
        prevAO <= prevPrevAO
      ) {
        // T1 signal — first upward inflection while negative
        signals.push({
          i,
          date: bars[i].date,
          type: 'buy-t1',
          label: 'T1 Buy',
          ao,
          peakNeg,
        });
        state = 't1';
      } else if (ao >= 0) {
        // AO crossed zero without a T1 — transition directly to riding
        state = 'riding';
      }
    }

    // ── State: 't1' ───────────────────────────────────────────
    else if (state === 't1') {
      if (ao < 0 && peakNeg !== null && ao < peakNeg) {
        // Fell below previous low — T1 was a false start, reset
        peakNeg = ao;
        state = 'out';
      } else if (ao >= 0) {
        // Zero cross — T3 signal
        signals.push({
          i,
          date: bars[i].date,
          type: 'buy-t3',
          label: 'T3 Buy (zero cross)',
          ao,
        });
        state = 'riding';
      } else if (peakNeg !== null && ao >= peakNeg / 2) {
        // Halfway back to zero — T2 signal
        signals.push({
          i,
          date: bars[i].date,
          type: 'buy-t2',
          label: 'T2 Buy',
          ao,
          peakNeg,
        });
        state = 't2';
      }
    }

    // ── State: 't2' ───────────────────────────────────────────
    else if (state === 't2') {
      if (ao < 0 && peakNeg !== null && ao < peakNeg) {
        // New low — reset entirely
        peakNeg = ao;
        state = 'out';
      } else if (ao >= 0) {
        // Zero cross — T3 signal
        signals.push({
          i,
          date: bars[i].date,
          type: 'buy-t3',
          label: 'T3 Buy (zero cross)',
          ao,
        });
        state = 'riding';
      }
    }

    // ── State: 'riding' ───────────────────────────────────────
    else if (state === 'riding') {
      if (ao < 0) {
        // AO went negative — sell immediately
        signals.push({
          i,
          date: bars[i].date,
          type: 'sell-neg',
          label: 'Sell (went negative)',
          ao,
        });
        peakNeg = ao;
        state = 'out';
      } else if (
        prevAO !== null &&
        prevAO > 0 &&
        ao < prevAO &&
        (prevPrevAO === null || prevAO >= prevPrevAO)
      ) {
        // Positive AO peaked and is now declining — sell alert
        signals.push({
          i,
          date: bars[i].date,
          type: 'sell-peak',
          label: 'Sell Alert',
          ao,
        });
        state = 'sell-watch';
      }
    }

    // ── State: 'sell-watch' ───────────────────────────────────
    else if (state === 'sell-watch') {
      if (ao < 0) {
        // Confirmed decline — go back to out
        peakNeg = ao;
        state = 'out';
      } else if (prevAO !== null && ao > prevAO) {
        // False alarm — AO is rising again, stay in trade
        state = 'riding';
      }
    }

    // Advance sliding window
    prevPrevAO = prevAO;
    prevAO = ao;
  }

  // Extract final AO and previous AO for display purposes
  const validValues = aoValues.filter(v => v !== null);
  const latestAO = validValues.length > 0 ? validValues[validValues.length - 1] : null;
  const prevAOFinal = validValues.length > 1 ? validValues[validValues.length - 2] : null;

  return {
    aoValues,
    signals,
    state,
    peakNeg,
    latestAO,
    prevAO: prevAOFinal,
  };
}

// ============================================================
// 6. PHASE DISPLAY HELPERS
// ============================================================

/**
 * Returns a human-readable phase description with a direction arrow.
 * @param {string} state
 * @param {number|null} latestAO
 * @param {number|null} prevAO
 * @returns {string}
 */
function phaseLabel(state, latestAO, prevAO) {
  const arrow =
    latestAO !== null && prevAO !== null
      ? latestAO > prevAO
        ? ' ↑'
        : latestAO < prevAO
        ? ' ↓'
        : ' →'
      : '';

  switch (state) {
    case 'out':        return 'Watching' + arrow;
    case 't1':         return 'T1 Bought' + arrow;
    case 't2':         return 'T1+T2 Bought' + arrow;
    case 'riding':     return 'Riding (all 3)' + arrow;
    case 'sell-watch': return 'Sell Alert' + arrow;
    default:           return state + arrow;
  }
}

/**
 * Returns a CSS class string for a given state.
 * @param {string} state
 * @returns {string}
 */
function phaseClass(state) {
  switch (state) {
    case 'out':        return 'phase-out';
    case 't1':         return 'phase-t1';
    case 't2':         return 'phase-t2';
    case 'riding':     return 'phase-riding';
    case 'sell-watch': return 'phase-sell-watch';
    default:           return '';
  }
}

/**
 * Returns the label of the most recent signal, or '—' if none.
 * @param {Array} signals
 * @returns {string}
 */
function lastSignalLabel(signals) {
  if (!signals || signals.length === 0) return '—';
  return signals[signals.length - 1].label;
}

/**
 * Returns a CSS class for the most recent signal type.
 * @param {Array} signals
 * @returns {string}
 */
function lastSignalClass(signals) {
  if (!signals || signals.length === 0) return '';
  const type = signals[signals.length - 1].type;
  if (type.startsWith('buy')) return 'signal-buy';
  if (type === 'sell-neg') return 'signal-sell-neg';
  if (type === 'sell-peak') return 'signal-sell-peak';
  return '';
}

// ============================================================
// 7. SPY NORMALIZATION
// ============================================================

/**
 * Builds a normalized SPY SMA200 overlay scaled to the ticker's price range.
 * Finds the first common date between SPY and ticker bars, then scales the
 * SPY SMA200 so it equals the ticker's close price on that date.
 *
 * @param {Array} spyBars  - SPY bars [{date, c, h, l, ...}]
 * @param {Array} tickerBars - Ticker bars [{date, c, ...}]
 * @returns {Array<{time: string, value: number}>|null}
 */
function buildSpySMAOverlay(spyBars, tickerBars) {
  if (!spyBars || spyBars.length === 0 || !tickerBars || tickerBars.length === 0) {
    return null;
  }

  // Calculate SPY SMA200
  const spyCloses = spyBars.map(b => b.c);
  const spySMA200 = calcSMALine(spyCloses, 200);

  // Build a date → index map for ticker bars
  const tickerDateMap = {};
  tickerBars.forEach((b, i) => { tickerDateMap[b.date] = i; });

  // Find the first common date where SPY SMA200 is valid
  let scaleFactor = null;
  let firstCommonDate = null;

  for (let i = 0; i < spyBars.length; i++) {
    if (spySMA200[i] === null) continue;
    const date = spyBars[i].date;
    if (tickerDateMap[date] !== undefined) {
      const tickerClose = tickerBars[tickerDateMap[date]].c;
      if (tickerClose && spySMA200[i]) {
        scaleFactor = tickerClose / spySMA200[i];
        firstCommonDate = date;
        break;
      }
    }
  }

  if (scaleFactor === null) return null;

  // Build overlay series (only dates present in ticker bars range)
  const tickerStart = tickerBars[0].date;
  const tickerEnd = tickerBars[tickerBars.length - 1].date;

  const overlay = [];
  for (let i = 0; i < spyBars.length; i++) {
    if (spySMA200[i] === null) continue;
    const date = spyBars[i].date;
    if (date < tickerStart || date > tickerEnd) continue;
    overlay.push({
      time: date,
      value: spySMA200[i] * scaleFactor,
    });
  }

  return overlay.length > 0 ? overlay : null;
}

// ============================================================
// 8. CHART RENDERING
// ============================================================

/**
 * Determines chart color options based on the current theme.
 */
function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    background: isDark ? '#0f1117' : '#f4f3ef',
    textColor:  isDark ? '#c9d1d9' : '#24292e',
    gridColor:  isDark ? '#2e3348' : '#d4d0c8',
    borderColor: isDark ? '#2e3348' : '#d4d0c8',
  };
}

/**
 * Renders the two-panel chart: candlestick + SMAs (top) and AO histogram (bottom).
 * Destroys any previously rendered charts before creating new ones.
 * Adds signal markers to the AO histogram.
 * Bidirectionally syncs the two charts' time scales.
 *
 * @param {string} ticker
 * @param {Array}  bars - [{date, o, h, l, c, v}, ...]
 */
function renderCharts(ticker, bars) {
  if (!bars || bars.length === 0) return;

  const priceEl = document.getElementById('priceChart');
  const aoEl    = document.getElementById('aoChart');
  if (!priceEl || !aoEl) return;

  // Destroy existing chart instances
  if (priceChart) {
    try { priceChart.remove(); } catch (e) {}
    priceChart = null;
  }
  if (aoChart) {
    try { aoChart.remove(); } catch (e) {}
    aoChart = null;
  }

  const colors = getChartColors();

  const baseChartOpts = {
    layout: {
      background:  { color: colors.background },
      textColor:   colors.textColor,
    },
    grid: {
      vertLines: { color: colors.gridColor },
      horzLines: { color: colors.gridColor },
    },
    rightPriceScale: {
      borderColor: colors.borderColor,
    },
    timeScale: {
      borderColor:     colors.borderColor,
      timeVisible:     true,
      secondsVisible:  false,
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    handleScroll:  true,
    handleScale:   true,
  };

  // ── Price chart ──────────────────────────────────────────────
  priceChart = LightweightCharts.createChart(priceEl, {
    ...baseChartOpts,
    width:  priceEl.clientWidth,
    height: priceEl.clientHeight || 400,
  });

  // Candlestick series
  const candleSeries = priceChart.addCandlestickSeries({
    upColor:          '#34d399',
    downColor:        '#f87171',
    borderUpColor:    '#34d399',
    borderDownColor:  '#f87171',
    wickUpColor:      '#34d399',
    wickDownColor:    '#f87171',
  });

  candleSeries.setData(bars.map(b => ({
    time:  b.date,
    open:  b.o,
    high:  b.h,
    low:   b.l,
    close: b.c,
  })));

  // SMA10
  const closes = bars.map(b => b.c);
  const sma10Values = calcSMALine(closes, 10);
  const sma10Series = priceChart.addLineSeries({
    color:       '#60a5fa',
    lineWidth:   1,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'SMA10',
  });
  sma10Series.setData(
    bars
      .map((b, i) => ({ time: b.date, value: sma10Values[i] }))
      .filter(d => d.value !== null)
  );

  // SMA50
  const sma50Values = calcSMALine(closes, 50);
  const sma50Series = priceChart.addLineSeries({
    color:       '#fbbf24',
    lineWidth:   1,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'SMA50',
  });
  sma50Series.setData(
    bars
      .map((b, i) => ({ time: b.date, value: sma50Values[i] }))
      .filter(d => d.value !== null)
  );

  // SMA200
  const sma200Values = calcSMALine(closes, 200);
  const sma200Series = priceChart.addLineSeries({
    color:       '#f87171',
    lineWidth:   1,
    priceLineVisible: false,
    lastValueVisible: false,
    title: 'SMA200',
  });
  sma200Series.setData(
    bars
      .map((b, i) => ({ time: b.date, value: sma200Values[i] }))
      .filter(d => d.value !== null)
  );

  // SPY SMA200 normalized overlay
  if (spyBarsCache && spyBarsCache.length > 0) {
    const spyOverlay = buildSpySMAOverlay(spyBarsCache, bars);
    if (spyOverlay && spyOverlay.length > 0) {
      const spySeries = priceChart.addLineSeries({
        color:            '#a78bfa',
        lineWidth:        1,
        lineStyle:        LightweightCharts.LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        title: 'SPY SMA200 (norm.)',
      });
      spySeries.setData(spyOverlay);
    }
  }

  // ── AO chart ─────────────────────────────────────────────────
  aoChart = LightweightCharts.createChart(aoEl, {
    ...baseChartOpts,
    width:  aoEl.clientWidth,
    height: aoEl.clientHeight || 180,
  });

  const { aoValues, signals } = analyzeAO(bars);

  // AO histogram series
  const aoSeries = aoChart.addHistogramSeries({
    priceLineVisible: false,
    lastValueVisible: true,
  });

  const aoData = bars
    .map((b, i) => ({
      time:  b.date,
      value: aoValues[i],
      color: aoValues[i] !== null
        ? (aoValues[i] >= 0 ? '#34d399' : '#f87171')
        : 'transparent',
    }))
    .filter(d => d.value !== null);

  aoSeries.setData(aoData);

  // Zero line reference
  const zeroSeries = aoChart.addLineSeries({
    color:            colors.gridColor,
    lineWidth:        1,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  if (aoData.length > 0) {
    zeroSeries.setData([
      { time: aoData[0].time,                value: 0 },
      { time: aoData[aoData.length - 1].time, value: 0 },
    ]);
  }

  // Signal markers on the AO chart
  if (signals && signals.length > 0) {
    const markers = signals.map(sig => {
      let color, shape, position, text;

      switch (sig.type) {
        case 'buy-t1':
          color    = '#34d399';
          shape    = 'arrowUp';
          position = 'belowBar';
          text     = 'T1';
          break;
        case 'buy-t2':
          color    = '#34d399';
          shape    = 'arrowUp';
          position = 'belowBar';
          text     = 'T2';
          break;
        case 'buy-t3':
          color    = '#34d399';
          shape    = 'arrowUp';
          position = 'belowBar';
          text     = 'T3';
          break;
        case 'sell-neg':
          color    = '#f87171';
          shape    = 'arrowDown';
          position = 'aboveBar';
          text     = 'Sell';
          break;
        case 'sell-peak':
          color    = '#fbbf24';
          shape    = 'arrowDown';
          position = 'aboveBar';
          text     = 'Sell Alert';
          break;
        default:
          color    = '#c9d1d9';
          shape    = 'circle';
          position = 'inBar';
          text     = sig.type;
      }

      return { time: sig.date, position, color, shape, text };
    });

    // Sort markers by time (required by LightweightCharts)
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    aoSeries.setMarkers(markers);
  }

  // ── Bidirectional time-scale sync ─────────────────────────────
  let _syncingPrice = false;
  let _syncingAO    = false;

  priceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (_syncingPrice || !range) return;
    _syncingAO = true;
    try { aoChart.timeScale().setVisibleLogicalRange(range); } catch (e) {}
    _syncingAO = false;
  });

  aoChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (_syncingAO || !range) return;
    _syncingPrice = true;
    try { priceChart.timeScale().setVisibleLogicalRange(range); } catch (e) {}
    _syncingPrice = false;
  });

  // Apply current time range after a brief delay (charts need to settle)
  setTimeout(() => setTimeRange(currentTimeRangeDays), 50);

  // Responsive resize
  const ro = new ResizeObserver(() => {
    if (priceChart) priceChart.resize(priceEl.clientWidth, priceEl.clientHeight || 400);
    if (aoChart)    aoChart.resize(aoEl.clientWidth,    aoEl.clientHeight || 180);
  });
  ro.observe(priceEl);
  ro.observe(aoEl);
}

/**
 * Sets the visible time range on both charts.
 * @param {number} days - Number of calendar days to show (7, 14, 21, 28, or 365)
 */
function setTimeRange(days) {
  if (!priceChart && !aoChart) return;

  const now   = new Date();
  const from  = new Date();
  from.setDate(from.getDate() - days);

  const toStr   = now.toISOString().slice(0, 10);
  const fromStr = from.toISOString().slice(0, 10);

  const range = { from: fromStr, to: toStr };

  try {
    if (priceChart) priceChart.timeScale().setVisibleRange(range);
  } catch (e) {}
  try {
    if (aoChart) aoChart.timeScale().setVisibleRange(range);
  } catch (e) {}
}

// ============================================================
// 9. SIGNAL TABLE
// ============================================================

/**
 * Returns a numeric sort priority for a given state.
 * Lower = shown first in the table.
 */
function stateSortOrder(state) {
  switch (state) {
    case 'sell-watch': return 0;
    case 'riding':     return 1;
    case 't2':         return 2;
    case 't1':         return 3;
    case 'out':        return 4;
    default:           return 5;
  }
}

/**
 * Renders the overview table of all unique tickers from DEFAULT_TRANCHES.
 * Columns: Ticker | Latest AO | Phase | Last Signal | Action
 * Sorted: sell-watch → riding → t1/t2 → out
 * Uses aoBarsCache for computed data; shows '—' for tickers not yet loaded.
 */
function renderSignalTable() {
  const tbody = document.getElementById('signalTableBody');
  if (!tbody) return;

  // Collect unique tickers from DEFAULT_TRANCHES
  const seenTickers = new Set();
  const tickers = [];
  for (const t of DEFAULT_TRANCHES) {
    const sym = t.ticker;
    // Skip tickers with spaces (e.g. options rows like 'BMY 40 C')
    if (!sym || sym.includes(' ')) continue;
    if (!seenTickers.has(sym)) {
      seenTickers.add(sym);
      tickers.push(sym);
    }
  }

  // Build row data for each ticker
  const rows = tickers.map(ticker => {
    const bars = aoBarsCache[ticker];
    if (!bars || bars.length === 0) {
      return {
        ticker,
        latestAO: null,
        state: 'out',
        signals: [],
        sortKey: stateSortOrder('out') * 1000 + tickers.indexOf(ticker),
        hasData: false,
      };
    }

    const { state, signals, latestAO, prevAO } = analyzeAO(bars);
    return {
      ticker,
      latestAO,
      prevAO,
      state,
      signals,
      sortKey: stateSortOrder(state) * 1000 + tickers.indexOf(ticker),
      hasData: true,
    };
  });

  // Sort
  rows.sort((a, b) => a.sortKey - b.sortKey);

  // Render
  tbody.innerHTML = rows.map(row => {
    const aoDisplay = row.latestAO !== null
      ? row.latestAO.toFixed(3)
      : '—';
    const aoClass = row.latestAO !== null
      ? (row.latestAO >= 0 ? 'ao-positive' : 'ao-negative')
      : '';

    const phase   = phaseLabel(row.state, row.latestAO, row.prevAO || null);
    const pClass  = phaseClass(row.state);
    const sigLbl  = lastSignalLabel(row.signals);
    const sigCls  = lastSignalClass(row.signals);

    const isActive = row.ticker === currentTicker ? ' row-active' : '';

    return `<tr class="signal-row${isActive}" onclick="loadTicker('${row.ticker}')">
      <td class="ticker-cell">${row.ticker}</td>
      <td class="ao-cell ${aoClass}">${aoDisplay}</td>
      <td class="phase-cell"><span class="${pClass}">${phase}</span></td>
      <td class="signal-cell"><span class="${sigCls}">${sigLbl}</span></td>
      <td class="action-cell"><button class="btn-load" onclick="event.stopPropagation();loadTicker('${row.ticker}')">Chart</button></td>
    </tr>`;
  }).join('');
}

// ============================================================
// 10. BATCH FETCH (with rate limiting)
// ============================================================

/**
 * Fetches data for all unique tickers in DEFAULT_TRANCHES plus SPY.
 * Rate-limited: 5 requests per batch, with a 61-second window between batches.
 * Updates element id='fetchStatus' with progress.
 * Calls renderSignalTable() after each batch completes.
 */
async function fetchAllTickersData() {
  if (fetchLock) {
    console.warn('fetchAllTickersData already running');
    return;
  }
  fetchLock = true;

  const statusEl = document.getElementById('fetchStatus');
  const setStatus = msg => { if (statusEl) statusEl.textContent = msg; };

  // Collect unique tickers (no options rows)
  const seenTickers = new Set();
  const tickers = [];
  for (const t of DEFAULT_TRANCHES) {
    const sym = t.ticker;
    if (!sym || sym.includes(' ')) continue;
    if (!seenTickers.has(sym)) {
      seenTickers.add(sym);
      tickers.push(sym);
    }
  }

  // Include SPY for the overlay
  const allSymbols = ['SPY', ...tickers.filter(t => t !== 'SPY')];
  const total = allSymbols.length;
  let completed = 0;

  const BATCH_SIZE = 5;
  const WINDOW_MS  = 61_000;

  for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
    const batch = allSymbols.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(total / BATCH_SIZE);

    setStatus(`Fetching batch ${batchNum}/${totalBatches}: ${batch.join(', ')}…`);

    const batchStart_ms = Date.now();

    const promises = batch.map(async sym => {
      const bars = await fetchHistoricalLong(sym);
      if (bars && bars.length > 0) {
        if (sym === 'SPY') {
          spyBarsCache = bars;
        } else {
          aoBarsCache[sym] = bars;
        }
      }
      completed++;
      setStatus(`Fetched ${completed}/${total} tickers…`);
    });

    await Promise.all(promises);

    // Update table and save cache after each batch
    renderSignalTable();
    saveAOBarsCache();

    // If there are more batches to fetch, wait out the remaining window
    if (batchStart + BATCH_SIZE < total) {
      const elapsed = Date.now() - batchStart_ms;
      const waitMs  = Math.max(0, WINDOW_MS - elapsed);

      if (waitMs > 0) {
        // Countdown display
        const endTime = Date.now() + waitMs;
        await new Promise(resolve => {
          const interval = setInterval(() => {
            const remaining = Math.ceil((endTime - Date.now()) / 1000);
            if (remaining <= 0) {
              clearInterval(interval);
              resolve();
            } else {
              setStatus(`Rate-limit pause: ${remaining}s before next batch…`);
            }
          }, 1000);
        });
      }
    }
  }

  setStatus(`Done — ${total} tickers loaded.`);
  fetchLock = false;
}

// ============================================================
// 11. SINGLE TICKER LOAD
// ============================================================

/**
 * Loads bar data for a single ticker (and SPY if not cached),
 * then renders the charts and highlights the ticker's row in the signal table.
 *
 * @param {string} ticker
 */
async function loadTicker(ticker) {
  if (!ticker) return;

  currentTicker = ticker;

  // Update table highlight immediately
  renderSignalTable();

  // Update the ticker display label if present
  const tickerLabel = document.getElementById('currentTickerLabel');
  if (tickerLabel) tickerLabel.textContent = ticker;

  // Show a loading indicator on the chart areas
  const priceEl = document.getElementById('priceChart');
  const aoEl    = document.getElementById('aoChart');

  // Fetch SPY if not cached
  if (!spyBarsCache || spyBarsCache.length === 0) {
    const spyBars = await fetchHistoricalLong('SPY');
    if (spyBars && spyBars.length > 0) {
      spyBarsCache = spyBars;
      saveAOBarsCache();
    }
  }

  // Fetch ticker bars if not cached
  if (!aoBarsCache[ticker] || aoBarsCache[ticker].length === 0) {
    const bars = await fetchHistoricalLong(ticker);
    if (bars && bars.length > 0) {
      aoBarsCache[ticker] = bars;
      saveAOBarsCache();
    }
  }

  const bars = aoBarsCache[ticker];
  if (!bars || bars.length === 0) {
    if (priceEl) priceEl.innerHTML = `<p class="chart-empty">No data available for ${ticker}.</p>`;
    if (aoEl)    aoEl.innerHTML = '';
    return;
  }

  // Render AO analysis summary card
  renderAnalysisSummary(ticker, bars);

  // Render charts
  renderCharts(ticker, bars);

  // Re-render table to reflect updated state
  renderSignalTable();
}

/**
 * Renders an analysis summary card for the currently loaded ticker.
 * @param {string} ticker
 * @param {Array}  bars
 */
function renderAnalysisSummary(ticker, bars) {
  const summaryEl = document.getElementById('analysisSummary');
  if (!summaryEl) return;

  const { state, signals, latestAO, prevAO, peakNeg } = analyzeAO(bars);

  const phase  = phaseLabel(state, latestAO, prevAO);
  const pClass = phaseClass(state);
  const aoFmt  = latestAO !== null ? latestAO.toFixed(4) : '—';
  const aoClass = latestAO !== null ? (latestAO >= 0 ? 'ao-positive' : 'ao-negative') : '';

  const recentSignals = signals.slice(-5).reverse();
  const sigHtml = recentSignals.length > 0
    ? recentSignals.map(s => {
        const cls = s.type.startsWith('buy') ? 'signal-buy'
                  : s.type === 'sell-neg' ? 'signal-sell-neg'
                  : 'signal-sell-peak';
        return `<li class="${cls}">${s.date} — ${s.label} (AO: ${s.ao.toFixed(4)})</li>`;
      }).join('')
    : '<li class="no-signals">No signals detected in this period</li>';

  summaryEl.innerHTML = `
    <div class="summary-header">
      <span class="summary-ticker">${ticker}</span>
      <span class="summary-ao ${aoClass}">AO: ${aoFmt}</span>
      <span class="summary-phase ${pClass}">${phase}</span>
    </div>
    <div class="summary-signals">
      <h4>Recent Signals</h4>
      <ul>${sigHtml}</ul>
    </div>
  `;
}

// ============================================================
// 12. TIME RANGE BUTTONS
// ============================================================

/**
 * Sets the active time range for the charts and updates button highlights.
 * @param {number} days
 */
function setRange(days) {
  currentTimeRangeDays = days;
  setTimeRange(days);

  // Update active button state
  document.querySelectorAll('.range-btn').forEach(btn => {
    const btnDays = parseInt(btn.getAttribute('data-days'), 10);
    btn.classList.toggle('active', btnDays === days);
  });
}

// ============================================================
// 13. INIT
// ============================================================

/**
 * Entry point — called on DOMContentLoaded.
 * - Applies saved theme
 * - Loads cached bar data
 * - Renders signal table
 * - If cache is fresh, renders chart for the first ticker that has data
 */
function init() {
  initTheme();

  const cacheLoaded = loadAOBarsCache();

  // Render the table immediately (will show '—' for uncached tickers)
  renderSignalTable();

  if (cacheLoaded) {
    // Find the first ticker with cached bars and render its chart
    const seenTickers = new Set();
    for (const t of DEFAULT_TRANCHES) {
      const sym = t.ticker;
      if (!sym || sym.includes(' ')) continue;
      if (seenTickers.has(sym)) continue;
      seenTickers.add(sym);

      if (aoBarsCache[sym] && aoBarsCache[sym].length > 0) {
        loadTicker(sym);
        break;
      }
    }
  }

  // Wire up the fetch-all button if present
  const fetchBtn = document.getElementById('fetchAllBtn');
  if (fetchBtn) {
    fetchBtn.addEventListener('click', () => {
      if (!fetchLock) fetchAllTickersData();
    });
  }

  // Wire up theme toggle button if present
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }

  // Wire up range buttons
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.getAttribute('data-days'), 10);
      if (!isNaN(days)) setRange(days);
    });
  });

  // Set the default range button as active
  const defaultRangeBtn = document.querySelector(`.range-btn[data-days="${currentTimeRangeDays}"]`);
  if (defaultRangeBtn) defaultRangeBtn.classList.add('active');
}

document.addEventListener('DOMContentLoaded', init);
