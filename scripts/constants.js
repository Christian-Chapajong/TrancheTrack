// ============================================================
// Polygon.io API Key — edit this value for quick setup
// ============================================================
const API_KEY = 'QjYcLnaPWvwJPvw0de2fMqrp7RfWs_Dp';

// ============================================================
// Firebase configuration — fill in from Firebase Console
// Project Settings → General → Your apps → Web app
// ============================================================
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBIvcofHybULhTl6uViGvFRSR6SCrxWvZA",
    authDomain: "tranchetrack.firebaseapp.com",
    projectId: "tranchetrack",
    storageBucket: "tranchetrack.firebasestorage.app",
    messagingSenderId: "371319607265",
    appId: "1:371319607265:web:904a86f49bb46a0c6f4ca0"
  };

// ============================================================
// Default tranches — loaded on first run or when localStorage
// is cleared. Matches the client's Excel spreadsheet.
// ============================================================
const DEFAULT_TRANCHES = [
  { id: 1,  ticker: 'DIA', date: '2020-07-21', purchasePrice: 269.60, spyAtPurchase: 325.01 },
  { id: 2,  ticker: 'GLD', date: '2022-07-18', purchasePrice: 159.34, spyAtPurchase: 381.95 },
  { id: 3,  ticker: 'GLD', date: '2025-10-13', purchasePrice: 376.73, spyAtPurchase: 663.04 },
  { id: 4,  ticker: 'SLV', date: '2022-07-18', purchasePrice: 17.32, spyAtPurchase: 381.95 },
  { id: 5,  ticker: 'MRK', date: '2005-07-26', purchasePrice: 29.81, spyAtPurchase: 84.33 },
  { id: 6,  ticker: 'MRK', date: '2009-01-14', purchasePrice: 26.40, spyAtPurchase: 84.37 },
  { id: 7,  ticker: 'MRK', date: '2025-05-27', purchasePrice: 77.12, spyAtPurchase: 591.15 },
  { id: 8,  ticker: 'MRK', date: '2025-09-02', purchasePrice: 85.24, spyAtPurchase: 640.27 },
  { id: 9,  ticker: 'MRK', date: '2025-12-01', purchasePrice: 105.08, spyAtPurchase: 680.27 },
];

// ============================================================
// Alert thresholds per ticker
// Oscillator: % distance from avg cost basis
// addPct  = buy signal threshold  (price this far below avg)
// trimPct = sell signal threshold (price this far above avg)
// ============================================================
const ALERT_CONFIG = {
  DIA: { addPct: -0.20, trimPct: 0.40 },
  GLD: { addPct: -0.20, trimPct: 0.40 },
  SLV: { addPct: -0.20, trimPct: 0.40 },
  MRK: { addPct: -0.20, trimPct: 0.40 },
};
