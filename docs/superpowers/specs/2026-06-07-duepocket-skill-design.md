# DuePocket Claude Code Skill — Design

Date: 2026-06-07
Status: Approved (pending spec review)

## Goal

Ship a self-contained, zero-dependency Claude Code Skill that turns DuePocket
into a headless renewal radar, plus a README install entry.

The Skill mirrors DuePocket's own architecture:

- **Claude is the parser.** The user pastes a one-line subscription note or hands
  Claude a screenshot; Claude extracts a structured renewal candidate. This is the
  AI-candidate half. (The PWA uses a local regex parser in `src/lib/aiParser.ts`
  for offline/privacy; the Skill uses Claude instead — both produce the same
  candidate shape.)
- **A bundled Node script is the ledger engine.** Persistence, the 30-day radar,
  the monthly report, and `.ics` export are deterministic — money and dates must
  not be left to a model. This is the human-confirmation / deterministic half.

The Skill and the browser PWA share the same on-disk format
(`BackupPayload`), so data flows both ways: a PWA backup imports into the Skill,
and the Skill exports a file the PWA can restore.

## Non-Goals (YAGNI)

- No editing/deleting items by id in v1 (edit the JSON or use the PWA).
- No multi-ledger management.
- No marketplace / plugin packaging (possible v2).
- No bank sync, account login, auto-cancellation, or financial advice — same
  privacy boundary as the app.

## Deliverables

### 1. `skills/duepocket/SKILL.md`

The skill definition.

- **Frontmatter:** `name: duepocket`, plus a `description` whose trigger surface
  covers: subscription / renewal radar, free-trial conversion, app-wallet balance,
  续费 / 试用到期 / app 余额 / 订阅提醒.
- **Extraction contract:** instructions for mapping free text or screenshot text
  to the `RenewalItem` field set, with enums aligned exactly to the schema below
  (`type`, `cycle`, `currency`, `status`). Claude emits a candidate object plus a
  confidence score and warnings list, matching the spirit of
  `AIExtractionCandidate`.
- **Privacy + confirmation boundary (the core story):** Claude must present the
  extracted candidate and get the user's confirmation (or edits) BEFORE calling
  `add`. Writes go only to a local file; no network calls; never bank sync or
  auto-cancel.
- **Screenshot flow:** the user can hand Claude an image; Claude reads it
  (the Skill's analogue of the PWA's `tesseract.js` OCR) and produces the same
  candidate. Items from this path use `source: "ocr"`; text path uses
  `source: "ai-text"`.
- **Command reference:** how and when to call `duepocket.mjs` for each operation.

### 2. `skills/duepocket/duepocket.mjs`

A zero-dependency Node CLI (Node's built-in `crypto.randomUUID`, `fs`, `path`,
`os` only). Pure domain logic is ported verbatim from the TypeScript source:

- from `src/lib/date.ts`: `startOfDay`, `toDateInputValue`, `addDays`,
  `daysBetween`, `formatDate`, `eventDateForItem`, `buildRadarEvents`,
  `isThisMonth` (and helpers they need)
- from `src/lib/report.ts`: `buildMonthlyReport`, `monthlyContribution`,
  `multiplyCurrencyTotals`, `buildRecommendations`
- from `src/lib/exporters.ts`: `buildIcs`, `formatMoney`, `escapeIcs`,
  `reminderDaysFor`, and the `parseBackup` validation check
- from `src/lib/id.ts`: `createId`

**Commands:**

| Command | Behavior |
| --- | --- |
| `add` | Read a confirmed item as JSON from stdin; assign `id`, `createdAt`, `updatedAt`, fill missing defaults (e.g. `reminderDays`, `tags`, `status`); append to the ledger's `items`. |
| `radar [--days 30]` | Print the radar events from `buildRadarEvents`, sorted by date with risk level and human distance. |
| `report` | Print the monthly report: run-rate per currency, annualized run-rate, trials at risk, low wallets, recommendations. |
| `ics [--out <file>]` | Write a `.ics` calendar via `buildIcs` (stdout if no `--out`). |
| `import <backup.json>` | Validate and load a DuePocket backup; replace the current ledger. |
| `export [--out <file>]` | Emit the current ledger as a `BackupPayload` the PWA can restore. |

**Ledger path resolution (in priority order):** `--ledger <path>` flag →
`DUEPOCKET_LEDGER` env var → default `~/.duepocket/ledger.json`. The file is
created on first write with an empty `BackupPayload`.

### 3. README — "Use as a Claude Code Skill" section

The install entry the user asked for:

- One-line pitch: Claude becomes the parser; the Skill shares the PWA's data model.
- Install: copy `skills/duepocket/` to `~/.claude/skills/duepocket/` (personal) or
  keep it as a project skill under `.claude/skills/`. Provide both PowerShell and
  bash one-liners.
- One usage example: paste a subscription line → confirm → radar.
- Interop note: import/export with the PWA backup JSON.

## Shared Data Format

The ledger file is exactly DuePocket's `BackupPayload` (from `src/types.ts`):

```json
{ "app": "DuePocket", "version": 1, "exportedAt": "<iso>", "items": [], "candidates": [] }
```

`import` validates with the same rule as `parseBackup`: reject unless
`app === "DuePocket" && version === 1 && Array.isArray(items)`.

A persisted `RenewalItem`:

```ts
{
  id, type: "subscription" | "trial" | "appWallet",
  serviceName, amount, currency: "USD"|"SGD"|"CNY"|"HKD"|"EUR"|"GBP"|"JPY",
  cycle: "weekly"|"monthly"|"quarterly"|"yearly"|"one_time"|"top_up",
  nextChargeDate, trialEndsAt?, walletBalance?, walletLowThreshold?,
  category, paymentAccount?, cancelUrl?, notes?,
  reminderDays: number[], status: "active"|"watching"|"paused"|"cancelled",
  source: "ai-text"|"ocr"|"manual"|"import", tags: string[],
  createdAt, updatedAt, lastReviewedAt?
}
```

## Data Flow

```
paste text / screenshot
  -> Claude extracts candidate (RenewalItem fields + confidence + warnings)
  -> Claude shows candidate, user confirms/edits
  -> duepocket.mjs add  (writes ~/.duepocket/ledger.json, BackupPayload format)
  -> duepocket.mjs radar | report | ics  for outputs

interop: PWA "Export backup" JSON  <->  duepocket.mjs import / export
```

## Testing

The deterministic script is the half that must not drift, so it gets a golden
test: `skills/duepocket/test.mjs` feeds a fixed ledger and asserts the shape and
key numbers of `radar`, `report`, and `ics` output (run with `node test.mjs`,
zero deps). Claude's extraction half is governed by the contract in `SKILL.md`
and is not unit-tested.

## Decisions Locked In

- Distribution: bundled in this repo, zero-dependency script, copy-to-install
  (chosen over tsx-importing the repo source, and over marketplace packaging).
- Default ledger location: `~/.duepocket/ledger.json` (user-level, shared across
  projects).
- `add` takes the item as JSON on stdin (cleaner than many `--flag`s; lets Claude
  pass a full candidate in one shot).
