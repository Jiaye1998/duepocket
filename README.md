# DuePocket / 防扣费雷达

DuePocket is an **AI-powered local-first renewal and app-wallet radar**. It helps people catch upcoming subscriptions, trial conversions, and low app-wallet balances without requiring bank sync or an account.

This repository is built as a portfolio-grade PWA demo for AI product engineering: product framing, privacy boundaries, AI workflow design, frontend engineering, local persistence, export flows, and extraction evaluation.

## Demo Scope

- 30-day renewal radar for subscriptions, trials, and app-wallet balances
- Local-first IndexedDB ledger with demo data
- AI-assisted one-line intake with structured extraction candidates
- Screenshot OCR flow through local `tesseract.js`
- Human confirmation before AI candidates enter the ledger
- Calendar `.ics` export
- JSON backup and restore
- Monthly savings report with per-currency run-rate totals
- Offline app shell via service worker

## Tech Stack

- Vite
- React
- TypeScript
- Tailwind CSS
- IndexedDB through `idb`
- PWA manifest and service worker
- `tesseract.js` for local OCR demo

## Run Locally

```powershell
npm.cmd install --cache .\.npm-cache
npm.cmd run dev
```

Open the local URL printed by Vite, usually `http://127.0.0.1:5173/`.

## Build

```powershell
npm.cmd run build
```

## Privacy Boundary

DuePocket intentionally does **not** include bank sync, account login, automatic cancellation, investment analysis, or financial advice. Screenshots and AI candidates remain local by default. The AI parser creates candidates only; users must confirm the structured fields before data is saved.

## Evaluation

The demo includes a 50-sample bilingual extraction dataset in `data/ai-eval-samples.json`. The app runs the current parser against those samples at runtime, then displays real field accuracy, average confidence, and failure cases.

## 中文说明

DuePocket / 防扣费雷达不是传统记账 App，而是一个本地优先的续费、试用转付费和 App 余额提醒工具。第一版重点展示 AI 产品工程能力：隐私边界、AI 候选确认流程、评测意识、PWA 工程化和可演示的完整闭环。
