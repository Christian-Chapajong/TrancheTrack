// ============================================================
// Polygon.io API Key — edit this value for quick setup
// ============================================================
const API_KEY = 'JyLxpv8ycdllxRORM35xbpLqDcL1v9yU';

// ============================================================
// Firebase configuration
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
// Portfolio names
// ============================================================
const PORTFOLIOS = ['Main', 'WFK Trust', 'ELK Trust', 'GWK Taxable', 'GWK IRA', "Beth's IRA"];

// ============================================================
// Default tranches — loaded on first run or when Firestore
// is empty. Sourced from Portfolio Analysis spreadsheet (Feb 2026).
// spyAtPurchase: null = pre-2016 data not available from API;
//   app will attempt to auto-fill via Polygon.io historical endpoint.
// purchasePrice: null = price unknown; placeholder row only.
// ============================================================
const DEFAULT_TRANCHES = [

  // ── Main ────────────────────────────────────────────────────
  { id:  1, portfolio: 'Main', ticker: 'DIA',   date: '2020-07-21', purchasePrice: 269.60,  spyAtPurchase: 325.01  },
  { id:  2, portfolio: 'Main', ticker: 'GLD',   date: '2022-07-18', purchasePrice: 159.34,  spyAtPurchase: 381.95  },
  { id:  3, portfolio: 'Main', ticker: 'GLD',   date: '2025-10-13', purchasePrice: 376.73,  spyAtPurchase: 663.04  },
  { id:  4, portfolio: 'Main', ticker: 'SLV',   date: '2022-07-18', purchasePrice: 17.32,   spyAtPurchase: 381.95  },
  { id:  5, portfolio: 'Main', ticker: 'MRK',   date: '2005-07-26', purchasePrice: 29.81,   spyAtPurchase: 84.33   },
  { id:  6, portfolio: 'Main', ticker: 'MRK',   date: '2009-01-14', purchasePrice: 26.40,   spyAtPurchase: 84.37   },
  { id:  7, portfolio: 'Main', ticker: 'MRK',   date: '2025-05-27', purchasePrice: 77.12,   spyAtPurchase: 591.15  },
  { id:  8, portfolio: 'Main', ticker: 'MRK',   date: '2025-09-02', purchasePrice: 85.24,   spyAtPurchase: 640.27  },
  { id:  9, portfolio: 'Main', ticker: 'MRK',   date: '2025-12-01', purchasePrice: 105.08,  spyAtPurchase: 680.27  },
  { id: 10, portfolio: 'Main', ticker: 'GEV',   date: '2018-10-31', purchasePrice: 50.08,   spyAtPurchase: 270.63  },
  { id: 11, portfolio: 'Main', ticker: 'GEV',   date: '2018-11-20', purchasePrice: 39.12,   spyAtPurchase: 264.12  },
  { id: 12, portfolio: 'Main', ticker: 'GEV',   date: '2025-11-13', purchasePrice: 549.67,  spyAtPurchase: 672.04  },
  { id: 13, portfolio: 'Main', ticker: 'GEV',   date: '2025-12-02', purchasePrice: 597.36,  spyAtPurchase: 681.53  },
  { id: 14, portfolio: 'Main', ticker: 'GEV',   date: '2025-12-24', purchasePrice: 663.15,  spyAtPurchase: 690.38  },
  { id: 15, portfolio: 'Main', ticker: 'IBM',   date: '2025-11-25', purchasePrice: 305.11,  spyAtPurchase: 675.02  },
  { id: 16, portfolio: 'Main', ticker: 'IBM',   date: '2025-11-26', purchasePrice: 305.88,  spyAtPurchase: 679.68  },
  { id: 17, portfolio: 'Main', ticker: 'IBM',   date: '2025-12-01', purchasePrice: 304.18,  spyAtPurchase: 680.27  },
  { id: 18, portfolio: 'Main', ticker: 'TMUS',  date: '2026-02-02', purchasePrice: 195.39,  spyAtPurchase: 695.41  },
  { id: 19, portfolio: 'Main', ticker: 'BAC',   date: '2025-12-01', purchasePrice: 53.83,   spyAtPurchase: 680.27  },
  { id: 20, portfolio: 'Main', ticker: 'ALLE',  date: '2008-11-06', purchasePrice: 8.91,    spyAtPurchase: 65.72   },
  { id: 21, portfolio: 'Main', ticker: 'ALLE',  date: '2022-07-13', purchasePrice: 94.92,   spyAtPurchase: 378.83  },
  { id: 22, portfolio: 'Main', ticker: 'ALLE',  date: '2025-11-10', purchasePrice: 165.73,  spyAtPurchase: 681.44  },
  { id: 23, portfolio: 'Main', ticker: 'ALLE',  date: '2025-12-01', purchasePrice: 164.35,  spyAtPurchase: 680.27  },
  { id: 24, portfolio: 'Main', ticker: 'GWW',   date: '2025-11-28', purchasePrice: 949.38,  spyAtPurchase: 683.39  },
  { id: 25, portfolio: 'Main', ticker: 'GWW',   date: '2025-12-05', purchasePrice: 970.03,  spyAtPurchase: 685.69  },
  { id: 26, portfolio: 'Main', ticker: 'SHW',   date: '2005-03-23', purchasePrice: 14.66,   spyAtPurchase: 117.00  },
  { id: 27, portfolio: 'Main', ticker: 'SHW',   date: '2025-11-10', purchasePrice: 338.86,  spyAtPurchase: 681.44  },
  { id: 28, portfolio: 'Main', ticker: 'GEHC',  date: '2025-11-24', purchasePrice: 77.05,   spyAtPurchase: 668.75  },
  { id: 29, portfolio: 'Main', ticker: 'GEHC',  date: '2025-11-26', purchasePrice: 80.80,   spyAtPurchase: 679.68  },
  { id: 30, portfolio: 'Main', ticker: 'VNT',   date: '2025-11-25', purchasePrice: 34.83,   spyAtPurchase: 675.02  },
  { id: 31, portfolio: 'Main', ticker: 'VNT',   date: '2025-12-10', purchasePrice: 35.89,   spyAtPurchase: 687.57  },
  { id: 32, portfolio: 'Main', ticker: 'VNT',   date: '2025-12-24', purchasePrice: 37.99,   spyAtPurchase: 690.38  },
  { id: 33, portfolio: 'Main', ticker: 'CEG',   date: '2025-11-24', purchasePrice: 339.54,  spyAtPurchase: 668.73  },
  { id: 34, portfolio: 'Main', ticker: 'CEG',   date: '2025-12-02', purchasePrice: 362.52,  spyAtPurchase: 681.53  },
  { id: 35, portfolio: 'Main', ticker: 'CEG',   date: '2025-12-16', purchasePrice: 361.21,  spyAtPurchase: 678.87  },
  { id: 36, portfolio: 'Main', ticker: 'FAST',  date: '2025-11-28', purchasePrice: 40.40,   spyAtPurchase: 683.39  },
  { id: 37, portfolio: 'Main', ticker: 'FAST',  date: '2025-12-09', purchasePrice: 40.76,   spyAtPurchase: 683.04  },
  { id: 38, portfolio: 'Main', ticker: 'MSFT',  date: '2025-12-01', purchasePrice: 487.56,  spyAtPurchase: 680.27  },
  { id: 39, portfolio: 'Main', ticker: 'META',  date: '2025-11-21', purchasePrice: 610.04,  spyAtPurchase: 659.03  },
  { id: 40, portfolio: 'Main', ticker: 'META',  date: '2025-11-24', purchasePrice: 601.15,  spyAtPurchase: 668.73  },
  { id: 41, portfolio: 'Main', ticker: 'META',  date: '2025-12-09', purchasePrice: 660.67,  spyAtPurchase: 683.63  },
  { id: 42, portfolio: 'Main', ticker: 'CTAS',  date: '2025-11-24', purchasePrice: 184.02,  spyAtPurchase: 668.73  },
  { id: 43, portfolio: 'Main', ticker: 'CTAS',  date: '2025-12-10', purchasePrice: 182.94,  spyAtPurchase: 687.57  },
  { id: 44, portfolio: 'Main', ticker: 'CTAS',  date: '2025-12-16', purchasePrice: 187.81,  spyAtPurchase: 678.87  },
  { id: 45, portfolio: 'Main', ticker: 'CAVA',  date: '2025-11-24', purchasePrice: 48.58,   spyAtPurchase: 668.73  },
  { id: 46, portfolio: 'Main', ticker: 'CAVA',  date: '2025-12-02', purchasePrice: 52.24,   spyAtPurchase: 681.53  },
  { id: 47, portfolio: 'Main', ticker: 'CAVA',  date: '2025-12-09', purchasePrice: 53.13,   spyAtPurchase: 683.04  },
  { id: 48, portfolio: 'Main', ticker: 'TSCO',  date: '2008-04-07', purchasePrice: 1.95,    spyAtPurchase: 128.36  },
  { id: 49, portfolio: 'Main', ticker: 'TSCO',  date: '2008-05-15', purchasePrice: 1.73,    spyAtPurchase: 142.53  },
  { id: 50, portfolio: 'Main', ticker: 'ADP',   date: '2025-11-28', purchasePrice: 257.75,  spyAtPurchase: 683.39  },
  { id: 51, portfolio: 'Main', ticker: 'ADP',   date: '2025-12-10', purchasePrice: 256.23,  spyAtPurchase: 687.57  },
  { id: 52, portfolio: 'Main', ticker: 'PAYX',  date: '2025-10-06', purchasePrice: 123.90,  spyAtPurchase: 671.61  },
  { id: 53, portfolio: 'Main', ticker: 'PAYX',  date: '2025-11-24', purchasePrice: 110.66,  spyAtPurchase: 668.73  },
  { id: 54, portfolio: 'Main', ticker: 'PAYX',  date: '2025-12-09', purchasePrice: 112.86,  spyAtPurchase: 683.04  },

  // ── WFK Trust ───────────────────────────────────────────────
  { id: 55, portfolio: 'WFK Trust', ticker: 'RGLD',  date: '2025-06-30', purchasePrice: 177.80,  spyAtPurchase: 617.85  },
  { id: 56, portfolio: 'WFK Trust', ticker: 'RGLD',  date: '2025-07-03', purchasePrice: 177.80,  spyAtPurchase: 625.34  },
  { id: 57, portfolio: 'WFK Trust', ticker: 'IJS',   date: '2008-09-29', purchasePrice: 32.77,   spyAtPurchase: null    },
  { id: 58, portfolio: 'WFK Trust', ticker: 'IJS',   date: '2008-09-30', purchasePrice: 31.78,   spyAtPurchase: null    },
  { id: 59, portfolio: 'WFK Trust', ticker: 'IJS',   date: '2008-10-10', purchasePrice: 25.17,   spyAtPurchase: null    },
  { id: 60, portfolio: 'WFK Trust', ticker: 'NEM',   date: '2019-04-18', purchasePrice: 34.18,   spyAtPurchase: 290.02  },
  { id: 61, portfolio: 'WFK Trust', ticker: 'NEM',   date: '2023-09-28', purchasePrice: 37.04,   spyAtPurchase: 428.52  },
  { id: 62, portfolio: 'WFK Trust', ticker: 'TNA',   date: '2008-11-11', purchasePrice: 10.24,   spyAtPurchase: null    },
  { id: 63, portfolio: 'WFK Trust', ticker: 'SAA',   date: '2008-11-06', purchasePrice: 2.45,    spyAtPurchase: null    },
  { id: 64, portfolio: 'WFK Trust', ticker: 'SAA',   date: '2008-10-28', purchasePrice: 1.97,    spyAtPurchase: null    },
  { id: 65, portfolio: 'WFK Trust', ticker: 'SAA',   date: '2008-10-23', purchasePrice: 2.50,    spyAtPurchase: null    },
  { id: 66, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2008-10-08', purchasePrice: 21.80,   spyAtPurchase: null    },
  { id: 67, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2008-11-06', purchasePrice: 20.33,   spyAtPurchase: null    },
  { id: 68, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2009-01-13', purchasePrice: 10.75,   spyAtPurchase: null    },
  { id: 69, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2010-08-12', purchasePrice: 13.23,   spyAtPurchase: null    },
  { id: 70, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2010-10-21', purchasePrice: 11.41,   spyAtPurchase: null    },
  { id: 71, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2020-04-01', purchasePrice: 19.55,   spyAtPurchase: 246.15  },
  { id: 72, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2020-10-28', purchasePrice: 23.35,   spyAtPurchase: 326.66  },
  { id: 73, portfolio: 'WFK Trust', ticker: 'BAC',   date: '2023-03-15', purchasePrice: 27.88,   spyAtPurchase: 389.28  },
  { id: 74, portfolio: 'WFK Trust', ticker: 'ABBV',  date: '2020-05-11', purchasePrice: 84.22,   spyAtPurchase: 292.50  },
  { id: 75, portfolio: 'WFK Trust', ticker: 'ABBV',  date: '2023-06-28', purchasePrice: 131.09,  spyAtPurchase: 439.39  },
  { id: 76, portfolio: 'WFK Trust', ticker: 'MSFT',  date: '2025-08-11', purchasePrice: 523.25,  spyAtPurchase: 635.92  },
  { id: 77, portfolio: 'WFK Trust', ticker: 'MSFT',  date: '2025-12-01', purchasePrice: 484.97,  spyAtPurchase: 680.27  },
  { id: 78, portfolio: 'WFK Trust', ticker: 'PRG',   date: '2025-06-11', purchasePrice: 263.79,  spyAtPurchase: 601.36  },
  { id: 79, portfolio: 'WFK Trust', ticker: 'PRG',   date: '2025-09-02', purchasePrice: 247.14,  spyAtPurchase: 640.27  },
  { id: 80, portfolio: 'WFK Trust', ticker: 'PRG',   date: '2025-11-05', purchasePrice: 209.99,  spyAtPurchase: 677.58  },
  { id: 81, portfolio: 'WFK Trust', ticker: 'PRG',   date: '2026-01-27', purchasePrice: 208.30,  spyAtPurchase: 695.49  },

  // ── ELK Trust ───────────────────────────────────────────────
  { id: 82, portfolio: 'ELK Trust', ticker: 'NUE',      date: '2011-09-19', purchasePrice: 33.77,   spyAtPurchase: null    },
  { id: 83, portfolio: 'ELK Trust', ticker: 'TKR',      date: '2011-09-19', purchasePrice: 25.60,   spyAtPurchase: null    },
  { id: 84, portfolio: 'ELK Trust', ticker: 'TKR',      date: '2013-10-25', purchasePrice: 36.12,   spyAtPurchase: null    },
  { id: 85, portfolio: 'ELK Trust', ticker: 'WMT',      date: '2021-02-25', purchasePrice: 43.93,   spyAtPurchase: 382.33  },
  { id: 86, portfolio: 'ELK Trust', ticker: 'GS',       date: '2014-10-16', purchasePrice: 173.24,  spyAtPurchase: null    },
  { id: 87, portfolio: 'ELK Trust', ticker: 'GS',       date: '2018-11-13', purchasePrice: 204.68,  spyAtPurchase: 272.06  },
  { id: 88, portfolio: 'ELK Trust', ticker: 'AMZN',     date: '2022-12-28', purchasePrice: 82.47,   spyAtPurchase: 376.66  },
  { id: 89, portfolio: 'ELK Trust', ticker: 'AMZN',     date: '2025-11-26', purchasePrice: 230.46,  spyAtPurchase: 679.68  },
  { id: 90, portfolio: 'ELK Trust', ticker: 'BMY 40 C', date: '2025-08-05', purchasePrice: 9.02,    spyAtPurchase: 627.97  },

  // ── GWK Taxable ─────────────────────────────────────────────
  { id:  91, portfolio: 'GWK Taxable', ticker: 'DD',    date: '1989-06-21', purchasePrice: 4.55,    spyAtPurchase: null    },
  { id:  92, portfolio: 'GWK Taxable', ticker: 'DD',    date: '1989-10-16', purchasePrice: 4.54,    spyAtPurchase: null    },
  { id:  93, portfolio: 'GWK Taxable', ticker: 'AXP',   date: '2015-02-17', purchasePrice: 78.49,   spyAtPurchase: null    },
  { id:  94, portfolio: 'GWK Taxable', ticker: 'JPM',   date: '2000-04-25', purchasePrice: 51.94,   spyAtPurchase: null    },
  { id:  95, portfolio: 'GWK Taxable', ticker: 'JPM',   date: '2002-09-18', purchasePrice: 19.66,   spyAtPurchase: null    },
  { id:  96, portfolio: 'GWK Taxable', ticker: 'JPM',   date: '2009-12-22', purchasePrice: null,    spyAtPurchase: null    },
  { id:  97, portfolio: 'GWK Taxable', ticker: 'JPM',   date: '2025-10-01', purchasePrice: 311.93,  spyAtPurchase: 668.45  },
  { id:  98, portfolio: 'GWK Taxable', ticker: 'Q',     date: '1989-06-21', purchasePrice: 12.69,   spyAtPurchase: null    },
  { id:  99, portfolio: 'GWK Taxable', ticker: 'Q',     date: '1989-10-16', purchasePrice: 12.72,   spyAtPurchase: null    },
  { id: 100, portfolio: 'GWK Taxable', ticker: 'Q',     date: '2025-11-03', purchasePrice: 99.10,   spyAtPurchase: 893.34  },
  { id: 101, portfolio: 'GWK Taxable', ticker: 'CTVA',  date: '1989-06-21', purchasePrice: 3.55,    spyAtPurchase: null    },
  { id: 102, portfolio: 'GWK Taxable', ticker: 'CTVA',  date: '1989-10-16', purchasePrice: 3.55,    spyAtPurchase: null    },
  { id: 103, portfolio: 'GWK Taxable', ticker: 'CTVA',  date: '2023-08-04', purchasePrice: 55.01,   spyAtPurchase: 446.81  },
  { id: 104, portfolio: 'GWK Taxable', ticker: 'CTVA',  date: '2025-06-17', purchasePrice: 74.17,   spyAtPurchase: 597.53  },

  // ── GWK IRA ─────────────────────────────────────────────────
  { id: 105, portfolio: 'GWK IRA', ticker: 'BA',    date: '2025-11-12', purchasePrice: 194.75,  spyAtPurchase: 683.38  },
  { id: 106, portfolio: 'GWK IRA', ticker: 'BA',    date: '2025-12-05', purchasePrice: 201.56,  spyAtPurchase: 685.69  },
  { id: 107, portfolio: 'GWK IRA', ticker: 'LLY',   date: '2016-11-23', purchasePrice: 64.55,   spyAtPurchase: 220.70  },
  { id: 108, portfolio: 'GWK IRA', ticker: 'LLY',   date: '2025-07-23', purchasePrice: 787.08,  spyAtPurchase: 634.21  },
  { id: 109, portfolio: 'GWK IRA', ticker: 'AAPL',  date: '2010-08-12', purchasePrice: 9.00,    spyAtPurchase: null    },
  { id: 110, portfolio: 'GWK IRA', ticker: 'V',     date: '2025-11-25', purchasePrice: 330.04,  spyAtPurchase: 675.02  },
  { id: 111, portfolio: 'GWK IRA', ticker: 'V',     date: '2025-12-05', purchasePrice: 331.07,  spyAtPurchase: 685.69  },

  // ── Beth's IRA ──────────────────────────────────────────────
  { id: 112, portfolio: "Beth's IRA", ticker: 'NUE',    date: '2025-12-02', purchasePrice: 160.58,  spyAtPurchase: 681.53  },
  { id: 113, portfolio: "Beth's IRA", ticker: 'GS',     date: '2025-12-02', purchasePrice: 815.41,  spyAtPurchase: 681.53  },
  { id: 114, portfolio: "Beth's IRA", ticker: 'VIGAX',  date: '2026-01-02', purchasePrice: null,    spyAtPurchase: 683.17  },
  { id: 115, portfolio: "Beth's IRA", ticker: 'DE',     date: '2025-12-18', purchasePrice: 477.24,  spyAtPurchase: 676.47  },
  { id: 116, portfolio: "Beth's IRA", ticker: 'COR',    date: '2025-12-18', purchasePrice: 343.40,  spyAtPurchase: 676.47  },
  { id: 117, portfolio: "Beth's IRA", ticker: 'PNR',    date: '2025-11-28', purchasePrice: 105.48,  spyAtPurchase: 683.39  },
  { id: 118, portfolio: "Beth's IRA", ticker: 'PNR',    date: '2025-12-02', purchasePrice: 104.85,  spyAtPurchase: 681.53  },
  { id: 119, portfolio: "Beth's IRA", ticker: 'VWNFX',  date: '2026-01-02', purchasePrice: null,    spyAtPurchase: 683.17  },
  { id: 120, portfolio: "Beth's IRA", ticker: 'MA',     date: '2025-12-16', purchasePrice: 567.24,  spyAtPurchase: 678.87  },
  { id: 121, portfolio: "Beth's IRA", ticker: 'HD',     date: '2025-12-18', purchasePrice: 361.63,  spyAtPurchase: 676.47  },
  { id: 122, portfolio: "Beth's IRA", ticker: 'PG',     date: '2025-12-16', purchasePrice: 144.92,  spyAtPurchase: 678.87  },
  { id: 123, portfolio: "Beth's IRA", ticker: 'PG',     date: '2025-12-16', purchasePrice: 145.74,  spyAtPurchase: 678.87  },
  { id: 124, portfolio: "Beth's IRA", ticker: 'BSX',    date: '2025-12-18', purchasePrice: 96.77,   spyAtPurchase: 676.47  },
  { id: 125, portfolio: "Beth's IRA", ticker: 'BSX',    date: '2025-12-30', purchasePrice: 95.84,   spyAtPurchase: 687.01  },

];

// ============================================================
// Alert thresholds per ticker
// Oscillator: % distance from avg cost basis
// addPct  = buy signal threshold  (price this far below avg)
// trimPct = sell signal threshold (price this far above avg)
// All tickers not listed here use the default {-0.20, +0.40}
// ============================================================
const ALERT_CONFIG = {
  DIA:  { addPct: -0.20, trimPct: 0.40 },
  GLD:  { addPct: -0.20, trimPct: 0.40 },
  SLV:  { addPct: -0.20, trimPct: 0.40 },
  MRK:  { addPct: -0.20, trimPct: 0.40 },
};
