# TrancheTrack

> Automated securities tranche performance tracker with dynamic oscillator analysis and buy/sell signal generation.

---

## Overview

TrancheTrack is a financial analytics application built for sophisticated securities investors who manage multiple tranches of securities purchases. It replaces a manually maintained Excel workflow with an automated, scalable system that grows cleanly as the number of tranches increases.

At its core, the app does three things: tracks how each individual tranche is performing relative to a benchmark index (default: S&P 500) over the same holding period, calculates a designated technical oscillator dynamically, and generates buy/sell recommendations based on investor-defined formulas.

---

## Features

- **Tranche-level performance tracking** — compares each purchase lot against a configurable benchmark (e.g., S&P 500, custom index) over the identical time window
- **Dynamic oscillator calculation** — formula-driven, configurable per investor preference
- **Buy/sell signal engine** — rule-based recommendations derived from oscillator readings and relative performance thresholds
- **Scalable data input** — eliminates the manual data entry burden that grows with each new tranche
- **Dashboard view** — at-a-glance portfolio summary with per-tranche drill-down
- **Export** — output to Excel/CSV for record-keeping and reporting

---

## Background

This project originated from a battle-tested Excel spreadsheet model used to manage and evaluate a growing portfolio of securities tranches. The logic is proven; the bottleneck was time. As the number of tranches scaled, manual data entry became unsustainable. This application automates the data pipeline while preserving the integrity of the underlying investment methodology.

---

## Tech Stack

> To be finalized during scoping — candidates include:

- **Backend:** Python (pandas, yfinance or broker API) or Node.js
- **Frontend:** React dashboard or Electron desktop app
- **Data:** Live market feed integration + local portfolio database
- **Export:** openpyxl / xlsx for Excel compatibility

---

## Legal

All contributors must execute a **Non-Disclosure Agreement (NDA)** and an **Assignment of Rights** transferring full ownership of any code produced to the client prior to beginning work.

---

## Roadmap

This is Phase 1 of a planned multi-project engagement. Successful delivery opens the door to additional tools in the investor's broader technology stack.

---

## Status

🔧 In active development — first draft in progress.