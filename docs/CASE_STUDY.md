# How I Built an AI Renewal Radar That Respects Privacy

DuePocket started from a simple product question: many people do not need another budgeting app, but they do need a practical way to catch renewals, free-trial conversions, and app-wallet balances before money leaves.

The product direction became an AI-powered local-first renewal radar. The first version avoids bank sync and account aggregation. Instead, it focuses on fast manual capture, one-line AI parsing, screenshot OCR, human confirmation, local storage, calendar export, and backups.

## Product Decisions

1. The main surface is a 30-day radar, not a ledger.
2. AI never writes directly to the source of truth.
3. The data model separates subscriptions, trials, app wallets, and AI extraction candidates.
4. Privacy is a feature boundary, not a settings page.
5. The demo includes evaluation metrics so extraction quality can be discussed concretely.

## AI Workflow

```mermaid
flowchart LR
  A["One-line text or screenshot"] --> B["Local OCR when needed"]
  B --> C["Structured extraction"]
  A --> C
  C --> D["AIExtractionCandidate"]
  D --> E["Human confirmation"]
  E --> F["IndexedDB ledger"]
  F --> G["30-day radar, report, calendar export"]
```

## Data Model

- `Subscription`: recurring membership or bill.
- `Trial`: free trial that may convert into paid renewal.
- `AppWallet`: stored-value app balance, such as Grab, moomoo, transit cards, or delivery apps.
- `AIExtractionCandidate`: extracted fields, confidence, warnings, and raw text.

## Privacy Design

DuePocket has no account system, no bank connection, and no default image upload. The local OCR path is meant to demonstrate a privacy-preserving first pass. If a future hosted AI parser is added, it should be opt-in, clearly labeled, and compatible with local API-key storage.

## Evaluation Plan

The extraction task is evaluated by field accuracy:

- Service name
- Amount
- Currency
- Billing cycle
- Next charge date or trial end date
- Record type

The current app surfaces a 50-sample bilingual evaluation summary and representative failure cases.
