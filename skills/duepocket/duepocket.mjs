#!/usr/bin/env node
// DuePocket — zero-dependency ledger engine for the Claude Code skill.
// Pure domain logic is ported verbatim from the PWA's src/lib so the skill and
// the browser app stay interoperable through the shared BackupPayload format.
//
// Usage:
//   echo '<item json>' | node duepocket.mjs add
//   node duepocket.mjs radar [--days 30] [--json]
//   node duepocket.mjs report [--json]
//   node duepocket.mjs ics [--out file]
//   node duepocket.mjs import <backup.json>
//   node duepocket.mjs export [--out file]
//
// Ledger path: --ledger <path>  >  $DUEPOCKET_LEDGER  >  ~/.duepocket/ledger.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// id (from src/lib/id.ts)
// ---------------------------------------------------------------------------

export function createId(prefix = "dp") {
  if (typeof randomUUID === "function") return randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// dates (from src/lib/date.ts)
// ---------------------------------------------------------------------------

const dayMs = 24 * 60 * 60 * 1000;

export function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function toDateInputValue(date) {
  const copy = startOfDay(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

export function addDays(value, amount) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}

export function daysBetween(date, reference = new Date()) {
  return Math.round((startOfDay(date).getTime() - startOfDay(reference).getTime()) / dayMs);
}

export function formatDate(date, options = { month: "short", day: "numeric" }) {
  return startOfDay(date).toLocaleDateString(undefined, options);
}

export function eventDateForItem(item) {
  if (item.type === "trial" && item.trialEndsAt) return item.trialEndsAt;
  return item.nextChargeDate;
}

export function buildRadarEvents(items, days = 30) {
  return items
    .filter((item) => item.status !== "cancelled")
    .map((item) => {
      const eventDate = eventDateForItem(item);
      const daysAway = daysBetween(eventDate);
      const lowWallet =
        item.type === "appWallet" &&
        typeof item.walletBalance === "number" &&
        typeof item.walletLowThreshold === "number" &&
        item.walletBalance <= item.walletLowThreshold;
      const risk =
        daysAway < 0
          ? "overdue"
          : daysAway === 0
            ? "today"
            : daysAway <= 7 || lowWallet
              ? "soon"
              : daysAway <= days
                ? "upcoming"
                : "clear";
      const label =
        item.type === "trial"
          ? "Trial conversion"
          : item.type === "appWallet"
            ? lowWallet
              ? "Low wallet"
              : "Wallet check"
            : "Renewal";
      return { id: `${item.id}-${eventDate}`, item, eventDate, daysAway, risk, label };
    })
    .filter((event) => event.daysAway <= days || event.risk === "overdue")
    .sort((a, b) => startOfDay(a.eventDate).getTime() - startOfDay(b.eventDate).getTime());
}

export function humanDistance(daysAway) {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway === -1) return "1 day overdue";
  if (daysAway < 0) return `${Math.abs(daysAway)} days overdue`;
  return `in ${daysAway} days`;
}

export function isThisMonth(date, reference = new Date()) {
  if (!date) return false;
  const target = startOfDay(date);
  return target.getFullYear() === reference.getFullYear() && target.getMonth() === reference.getMonth();
}

// ---------------------------------------------------------------------------
// money + .ics (from src/lib/exporters.ts)
// ---------------------------------------------------------------------------

export function formatMoney(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 ? 2 : 0,
  }).format(amount || 0);
}

function escapeIcs(value) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function reminderDaysFor(item) {
  const days = item.reminderDays?.length ? item.reminderDays : [1];
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day > 0 && day <= 365))).sort((a, b) => b - a);
}

export function buildIcs(items) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const events = items
    .filter((item) => item.status !== "cancelled")
    .map((item) => {
      const sourceDate = eventDateForItem(item);
      const eventDate = sourceDate.replace(/-/g, "");
      const summary = escapeIcs(`DuePocket: ${item.serviceName}`);
      const description = escapeIcs(
        [
          `${item.type} · ${item.cycle}`,
          `${formatMoney(item.amount, item.currency)}`,
          item.cancelUrl ? `Cancel: ${item.cancelUrl}` : "",
          item.notes || "",
        ]
          .filter(Boolean)
          .join("\\n")
      );
      const alarms = reminderDaysFor(item).flatMap((days) => [
        "BEGIN:VALARM",
        `TRIGGER:-P${days}D`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeIcs(`${item.serviceName} due ${formatDate(sourceDate)}`)}`,
        "END:VALARM",
      ]);
      return [
        "BEGIN:VEVENT",
        `UID:${item.id}@duepocket.local`,
        `DTSTAMP:${timestamp}`,
        `DTSTART;VALUE=DATE:${eventDate}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        ...alarms,
        "END:VEVENT",
      ].join("\r\n");
    })
    .join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DuePocket//Renewal Radar//EN",
    "CALSCALE:GREGORIAN",
    events,
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

// ---------------------------------------------------------------------------
// monthly report (from src/lib/report.ts)
// ---------------------------------------------------------------------------

function monthlyContribution(item) {
  if (item.type === "appWallet") return 0;
  if (item.cycle === "weekly") return item.amount * 4.33;
  if (item.cycle === "monthly") return item.amount;
  if (item.cycle === "quarterly") return item.amount / 3;
  if (item.cycle === "yearly") return item.amount / 12;
  return 0;
}

function multiplyCurrencyTotals(totals, multiplier) {
  return Object.fromEntries(Object.entries(totals).map(([currency, amount]) => [currency, (amount || 0) * multiplier]));
}

function pluralize(label, count) {
  return count === 1 ? label : `${label}s`;
}

function buildRecommendations(items, trialsAtRisk, lowWallets, pendingCount) {
  const recommendations = [];
  const annual = items.filter((item) => item.cycle === "yearly" && !isThisMonth(item.nextChargeDate));
  const media = items.filter((item) => item.category.toLowerCase().includes("media"));

  if (trialsAtRisk) recommendations.push(`${trialsAtRisk} ${pluralize("trial item", trialsAtRisk)} should be reviewed before conversion.`);
  if (lowWallets) {
    recommendations.push(`${lowWallets} ${pluralize("app wallet balance", lowWallets)} ${lowWallets === 1 ? "is" : "are"} below the local threshold.`);
  }
  if (annual.length) recommendations.push("Annual renewals are visible early; compare usage before the charge date.");
  if (media.length > 1) recommendations.push("Multiple media subscriptions detected; consider rotating or pausing one plan.");
  if (pendingCount) {
    recommendations.push(`${pendingCount} ${pluralize("AI candidate", pendingCount)} ${pendingCount === 1 ? "is" : "are"} waiting for manual confirmation.`);
  }
  if (!recommendations.length) recommendations.push("No urgent savings action this month.");

  return recommendations;
}

export function buildMonthlyReport(items, candidates) {
  const active = items.filter((item) => item.status !== "cancelled");
  const monthlyRunRateByCurrency = active.reduce((totals, item) => {
    const amount = monthlyContribution(item);
    if (amount === 0) return totals;
    totals[item.currency] = (totals[item.currency] || 0) + amount;
    return totals;
  }, {});
  const annualizedRunRateByCurrency = multiplyCurrencyTotals(monthlyRunRateByCurrency, 12);
  const radar = buildRadarEvents(items, 30);
  const trialsAtRisk = radar.filter((event) => event.item.type === "trial" && event.daysAway <= 7).length;
  const lowWallets = items.filter(
    (item) =>
      item.type === "appWallet" &&
      typeof item.walletBalance === "number" &&
      typeof item.walletLowThreshold === "number" &&
      item.walletBalance <= item.walletLowThreshold
  ).length;
  const pending = candidates.filter((candidate) => candidate.status === "pending");
  const averageConfidence = candidates.length
    ? candidates.reduce((total, candidate) => total + candidate.confidence, 0) / candidates.length
    : 0;

  return {
    openRenewals: radar.filter((event) => event.daysAway <= 30).length,
    monthlyRunRateByCurrency,
    annualizedRunRateByCurrency,
    trialsAtRisk,
    lowWallets,
    aiPending: pending.length,
    averageConfidence,
    recommendations: buildRecommendations(items, trialsAtRisk, lowWallets, pending.length),
  };
}

// ---------------------------------------------------------------------------
// backup envelope (from src/lib/exporters.ts)
// ---------------------------------------------------------------------------

export function createBackup(items, candidates) {
  return { app: "DuePocket", version: 1, exportedAt: new Date().toISOString(), items, candidates };
}

export function parseBackup(text) {
  const payload = JSON.parse(text);
  if (payload.app !== "DuePocket" || payload.version !== 1 || !Array.isArray(payload.items)) {
    throw new Error("This file is not a DuePocket backup.");
  }
  if (!Array.isArray(payload.candidates)) payload.candidates = [];
  return payload;
}

// ---------------------------------------------------------------------------
// item normalization — fill defaults for a confirmed candidate
// ---------------------------------------------------------------------------

const CURRENCIES = ["USD", "SGD", "CNY", "HKD", "EUR", "GBP", "JPY"];
const TYPES = ["subscription", "trial", "appWallet"];
const CYCLES = ["weekly", "monthly", "quarterly", "yearly", "one_time", "top_up"];

function defaultCategory(type) {
  if (type === "trial") return "Trial";
  if (type === "appWallet") return "App wallet";
  return "Subscription";
}

export function normalizeItem(input) {
  if (!input || typeof input !== "object") throw new Error("Item must be a JSON object.");
  const type = TYPES.includes(input.type) ? input.type : "subscription";
  if (!input.serviceName) throw new Error("Item is missing serviceName.");
  if (input.currency && !CURRENCIES.includes(input.currency)) {
    throw new Error(`Unsupported currency "${input.currency}". Use one of: ${CURRENCIES.join(", ")}.`);
  }
  if (input.cycle && !CYCLES.includes(input.cycle)) {
    throw new Error(`Unsupported cycle "${input.cycle}". Use one of: ${CYCLES.join(", ")}.`);
  }
  const now = new Date().toISOString();
  const reminderDays = Array.isArray(input.reminderDays) && input.reminderDays.length
    ? input.reminderDays
    : type === "trial"
      ? [3, 1]
      : [7, 1];
  return {
    id: input.id || createId("item"),
    type,
    serviceName: input.serviceName,
    amount: typeof input.amount === "number" ? input.amount : 0,
    currency: input.currency || "USD",
    cycle: input.cycle || (type === "appWallet" ? "top_up" : "monthly"),
    nextChargeDate: input.nextChargeDate || addDays(new Date(), 7),
    trialEndsAt: input.trialEndsAt || (type === "trial" ? input.nextChargeDate || addDays(new Date(), 7) : undefined),
    walletBalance: typeof input.walletBalance === "number" ? input.walletBalance : undefined,
    walletLowThreshold: typeof input.walletLowThreshold === "number" ? input.walletLowThreshold : undefined,
    category: input.category || defaultCategory(type),
    paymentAccount: input.paymentAccount,
    cancelUrl: input.cancelUrl,
    notes: input.notes,
    reminderDays,
    status: input.status || (type === "subscription" ? "active" : "watching"),
    source: input.source || "ai-text",
    tags: Array.isArray(input.tags) && input.tags.length ? input.tags : [type],
    createdAt: input.createdAt || now,
    updatedAt: now,
    lastReviewedAt: input.lastReviewedAt,
  };
}

// ---------------------------------------------------------------------------
// ledger persistence
// ---------------------------------------------------------------------------

function ledgerPath(flags) {
  if (flags.ledger) return resolve(flags.ledger);
  if (process.env.DUEPOCKET_LEDGER) return resolve(process.env.DUEPOCKET_LEDGER);
  return join(homedir(), ".duepocket", "ledger.json");
}

function loadLedger(path) {
  if (!existsSync(path)) return { app: "DuePocket", version: 1, exportedAt: new Date().toISOString(), items: [], candidates: [] };
  return parseBackup(readFileSync(path, "utf8"));
}

function saveLedger(path, ledger) {
  mkdirSync(dirname(path), { recursive: true });
  const payload = createBackup(ledger.items, ledger.candidates ?? []);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function renderRadar(events) {
  if (!events.length) return "Radar is clear — nothing due in the window.";
  const lines = events.map((event) => {
    const money = event.item.type === "appWallet"
      ? `balance ${formatMoney(event.item.walletBalance ?? 0, event.item.currency)}`
      : formatMoney(event.item.amount, event.item.currency);
    return `  [${event.risk}] ${event.item.serviceName} — ${event.label} · ${money} · ${humanDistance(event.daysAway)} (${event.eventDate})`;
  });
  return [`Radar (${events.length} ${pluralize("event", events.length)}):`, ...lines].join("\n");
}

function renderReport(report) {
  const fmtTotals = (totals) => {
    const entries = Object.entries(totals);
    if (!entries.length) return "none";
    return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(", ");
  };
  return [
    "Monthly report:",
    `  Open renewals (<=30d): ${report.openRenewals}`,
    `  Monthly run-rate: ${fmtTotals(report.monthlyRunRateByCurrency)}`,
    `  Annualized run-rate: ${fmtTotals(report.annualizedRunRateByCurrency)}`,
    `  Trials at risk: ${report.trialsAtRisk}`,
    `  Low wallets: ${report.lowWallets}`,
    `  AI candidates pending: ${report.aiPending}`,
    `  Average confidence: ${report.averageConfidence.toFixed(2)}`,
    "  Recommendations:",
    ...report.recommendations.map((line) => `    - ${line}`),
  ].join("\n");
}

async function main(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  const path = ledgerPath(flags);

  switch (command) {
    case "add": {
      const raw = await readStdin();
      if (!raw) throw new Error("No item JSON received on stdin.");
      const item = normalizeItem(JSON.parse(raw));
      const ledger = loadLedger(path);
      ledger.items.push(item);
      saveLedger(path, ledger);
      console.log(`Added ${item.serviceName} (${item.id}). Ledger now holds ${ledger.items.length} ${pluralize("item", ledger.items.length)}.`);
      console.log(`Ledger: ${path}`);
      break;
    }
    case "radar": {
      const days = flags.days ? Number(flags.days) : 30;
      const ledger = loadLedger(path);
      const events = buildRadarEvents(ledger.items, days);
      if (flags.json) console.log(JSON.stringify(events, null, 2));
      else console.log(renderRadar(events));
      break;
    }
    case "report": {
      const ledger = loadLedger(path);
      const report = buildMonthlyReport(ledger.items, ledger.candidates ?? []);
      if (flags.json) console.log(JSON.stringify(report, null, 2));
      else console.log(renderReport(report));
      break;
    }
    case "ics": {
      const ledger = loadLedger(path);
      const ics = buildIcs(ledger.items);
      if (flags.out) {
        writeFileSync(resolve(flags.out), ics, "utf8");
        console.log(`Wrote calendar to ${resolve(flags.out)}`);
      } else {
        console.log(ics);
      }
      break;
    }
    case "import": {
      const file = positional[0];
      if (!file) throw new Error("Usage: import <backup.json>");
      const payload = parseBackup(readFileSync(resolve(file), "utf8"));
      saveLedger(path, payload);
      console.log(`Imported ${payload.items.length} ${pluralize("item", payload.items.length)} into ${path}.`);
      break;
    }
    case "export": {
      const ledger = loadLedger(path);
      const payload = createBackup(ledger.items, ledger.candidates ?? []);
      const text = `${JSON.stringify(payload, null, 2)}\n`;
      if (flags.out) {
        writeFileSync(resolve(flags.out), text, "utf8");
        console.log(`Exported ${payload.items.length} ${pluralize("item", payload.items.length)} to ${resolve(flags.out)}`);
      } else {
        process.stdout.write(text);
      }
      break;
    }
    default:
      console.log(
        [
          "DuePocket ledger engine",
          "",
          "Commands:",
          "  add                       append a confirmed item (JSON on stdin)",
          "  radar [--days 30] [--json]  upcoming renewals",
          "  report [--json]           monthly run-rate + recommendations",
          "  ics [--out file]          export .ics calendar",
          "  import <backup.json>      load a DuePocket backup (replaces ledger)",
          "  export [--out file]       emit a DuePocket backup for the PWA",
          "",
          "Ledger: --ledger <path> > $DUEPOCKET_LEDGER > ~/.duepocket/ledger.json",
        ].join("\n")
      );
      if (command && command !== "help" && command !== "--help") process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
