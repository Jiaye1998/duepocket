---
name: duepocket
description: Track upcoming subscription renewals, free-trial conversions, and app-wallet balances from pasted text or screenshots. Use when the user mentions a subscription, renewal, billing date, free trial ending, app wallet / stored-value balance, 续费 / 订阅 / 试用到期 / app 余额 / 充值, or wants a renewal radar, a monthly subscription report, or a calendar reminder (.ics). You extract the details; a bundled local script stores them and computes the radar.
---

# DuePocket — local renewal radar

DuePocket catches upcoming subscriptions, trial-to-paid conversions, and low
app-wallet balances before money leaves. This skill is the headless companion to
the DuePocket PWA and shares its on-disk format, so data moves both ways.

**You are the parser.** When the user pastes a one-line note or hands you a
screenshot, you extract a structured renewal candidate. A bundled
zero-dependency Node script, `duepocket.mjs`, is the deterministic ledger engine:
it stores items and computes the radar, the monthly report, and the `.ics`
calendar. **Never compute money or dates yourself — always go through the script.**

## Privacy boundary (do not cross)

- Data is written only to a local JSON file. No network calls, no account, no bank sync.
- Never auto-cancel a subscription and never give financial advice.
- Extraction produces a *candidate*. **Always show it to the user and get their
  confirmation (or corrections) BEFORE you run `add`.** The user owns the decision
  to save. If a field is uncertain, say so rather than guessing silently.

## The loop

1. The user pastes a subscription line, or hands you a screenshot — read it.
2. Extract a candidate using the schema below. Note your confidence and any shaky fields.
3. Show the candidate to the user and ask them to confirm or correct it.
4. On confirmation, pipe the item JSON to `add`.
5. Show results with `radar` / `report`, or export a calendar with `ics`.

## Extraction schema

Map the user's text or image to these fields. Use the exact enum values.

| Field | Values / format |
| --- | --- |
| `type` | `subscription` \| `trial` \| `appWallet` |
| `serviceName` | string, e.g. `Netflix`, `ChatGPT`, `腾讯视频` |
| `amount` | number (for `appWallet` use `0` and put the balance in `walletBalance`) |
| `currency` | `USD` \| `SGD` \| `CNY` \| `HKD` \| `EUR` \| `GBP` \| `JPY` |
| `cycle` | `weekly` \| `monthly` \| `quarterly` \| `yearly` \| `one_time` \| `top_up` |
| `nextChargeDate` | `YYYY-MM-DD` |
| `trialEndsAt` | `YYYY-MM-DD` (trials only) |
| `walletBalance`, `walletLowThreshold` | number (`appWallet` only) |
| `category` | short string: `Media`, `Work tools`, `Transport`, `Trial`, ... |
| `cancelUrl`, `notes`, `paymentAccount` | optional strings |
| `reminderDays` | number array, default `[7,1]`; trials `[3,1]` |
| `status` | `active` \| `watching` \| `paused` \| `cancelled` |
| `source` | `ai-text` for pasted text, `ocr` for screenshots |
| `tags` | string array |

You only need to provide what you can read. The script fills the rest: `id`,
`createdAt`, `updatedAt`, and sensible per-type defaults for any field you omit.

## Commands

Run from this skill's directory, or use an absolute path to `duepocket.mjs`.

Add a confirmed item — the item JSON goes in on stdin:

```bash
echo '{"type":"subscription","serviceName":"Netflix","amount":19.98,"currency":"SGD","cycle":"monthly","nextChargeDate":"2026-07-01","category":"Media"}' | node duepocket.mjs add
```

On Windows PowerShell, pipe the JSON the same way:

```powershell
'{"type":"subscription","serviceName":"Netflix","amount":19.98,"currency":"SGD","cycle":"monthly","nextChargeDate":"2026-07-01","category":"Media"}' | node duepocket.mjs add
```

Other commands:

```bash
node duepocket.mjs radar [--days 30] [--json]   # upcoming renewals
node duepocket.mjs report [--json]              # monthly run-rate + recommendations
node duepocket.mjs ics --out duepocket.ics      # calendar export (stdout if no --out)
node duepocket.mjs import backup.json           # load a DuePocket backup (replaces ledger)
node duepocket.mjs export --out backup.json     # emit a backup the PWA can restore
```

`--json` makes `radar` and `report` print machine-readable JSON, which is handy
when you want to reformat the results for the user.

## Where data lives

The ledger defaults to `~/.duepocket/ledger.json`. Override it with `--ledger <path>`
on any command, or set the `DUEPOCKET_LEDGER` environment variable. The file uses
DuePocket's `BackupPayload` format (`{"app":"DuePocket","version":1,...}`), so
`export` produces a file the PWA's **Restore backup** accepts, and `import` takes a
file the PWA produced. One ledger, two front-ends.
