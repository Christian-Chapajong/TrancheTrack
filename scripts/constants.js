// ============================================================
// Polygon.io API Key — edit this value for quick setup
// ============================================================
const API_KEY = 'YOUR_KEY_HERE';

// ============================================================
// Default portfolio data
// ============================================================
const DEFAULT_TRANCHES = [
  { ticker: 'DIA', date: '2020-07-21', purchasePrice: 269.60, spyAtPurchase: 325.01 },
  { ticker: 'GLD', date: '2022-07-18', purchasePrice: 159.34, spyAtPurchase: 381.95 },
  { ticker: 'GLD', date: '2025-10-13', purchasePrice: 376.73, spyAtPurchase: 663.04 },
  { ticker: 'SLV', date: '2022-07-18', purchasePrice: 17.32, spyAtPurchase: 381.95 },
  { ticker: 'MRK', date: '2005-07-26', purchasePrice: 29.81, spyAtPurchase: 84.33 },
  { ticker: 'MRK', date: '2009-01-14', purchasePrice: 26.40, spyAtPurchase: 84.37 },
  { ticker: 'MRK', date: '2025-05-27', purchasePrice: 77.12, spyAtPurchase: 591.15 },
  { ticker: 'MRK', date: '2025-09-02', purchasePrice: 85.24, spyAtPurchase: 640.27 },
  { ticker: 'MRK', date: '2025-12-01', purchasePrice: 105.08, spyAtPurchase: 680.27 },
];

// Alert thresholds per ticker
const ALERT_CONFIG = {
  DIA: { avgCost: 269.60, addPct: -0.20, trimPct: 0.40 },
  GLD: { avgCost: 268.04, addPct: -0.20, trimPct: 0.40 },
  SLV: { avgCost: 17.32,  addPct: -0.20, trimPct: 0.40 },
  MRK: { avgCost: 64.73,  addPct: -0.20, trimPct: 0.40 },
};