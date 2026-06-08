#!/usr/bin/env node
// Golden test for the deterministic half of the skill. The dates are built
// relative to "today" so the assertions stay stable over time.
// Run: node test.mjs

import assert from "node:assert/strict";
import {
  addDays,
  normalizeItem,
  buildRadarEvents,
  buildMonthlyReport,
  buildIcs,
} from "./duepocket.mjs";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// A fixed ledger, anchored to today.
const items = [
  normalizeItem({
    type: "subscription",
    serviceName: "Netflix",
    amount: 19.98,
    currency: "SGD",
    cycle: "monthly",
    nextChargeDate: addDays(new Date(), 5),
    category: "Media",
  }),
  normalizeItem({
    type: "subscription",
    serviceName: "Figma",
    amount: 144,
    currency: "USD",
    cycle: "yearly",
    nextChargeDate: addDays(new Date(), 40),
    category: "Work tools",
  }),
  normalizeItem({
    type: "trial",
    serviceName: "Notion AI",
    amount: 10,
    currency: "USD",
    cycle: "monthly",
    nextChargeDate: addDays(new Date(), 3),
    trialEndsAt: addDays(new Date(), 3),
    category: "Trial",
  }),
  normalizeItem({
    type: "appWallet",
    serviceName: "EZ-Link",
    currency: "SGD",
    walletBalance: 4,
    walletLowThreshold: 10,
    category: "Transport",
  }),
];

check("normalizeItem fills id, timestamps, and defaults", () => {
  const item = items[0];
  assert.ok(item.id, "expected an id");
  assert.ok(item.createdAt && item.updatedAt, "expected timestamps");
  assert.deepEqual(item.reminderDays, [7, 1]);
  assert.equal(item.status, "active");
  assert.equal(item.source, "ai-text");
});

check("normalizeItem rejects an unsupported currency", () => {
  assert.throws(() => normalizeItem({ serviceName: "X", currency: "AUD" }), /Unsupported currency/);
});

check("normalizeItem requires a serviceName", () => {
  assert.throws(() => normalizeItem({ type: "subscription" }), /serviceName/);
});

check("radar keeps in-window events and drops the far-off yearly one", () => {
  const events = buildRadarEvents(items, 30);
  const names = events.map((event) => event.item.serviceName);
  assert.ok(names.includes("Netflix"), "Netflix (5d) should be in the 30-day radar");
  assert.ok(names.includes("Notion AI"), "trial (3d) should be in the radar");
  assert.ok(!names.includes("Figma"), "Figma (40d) should be out of the 30-day radar");
});

check("radar sorts by date and tags risk levels", () => {
  const events = buildRadarEvents(items, 30);
  // Notion AI at 3 days comes before Netflix at 5 days.
  assert.equal(events[0].item.serviceName, "Notion AI");
  assert.equal(events[0].risk, "soon");
  const wallet = events.find((event) => event.item.serviceName === "EZ-Link");
  assert.equal(wallet.risk, "soon", "low wallet should read as soon");
  assert.equal(wallet.label, "Low wallet");
});

check("report computes per-currency monthly run-rate", () => {
  const report = buildMonthlyReport(items, []);
  // Netflix 19.98 SGD/mo; Figma 144/12 = 12 USD/mo; Notion AI 10 USD/mo; wallet = 0.
  assert.equal(Math.round(report.monthlyRunRateByCurrency.SGD * 100) / 100, 19.98);
  assert.equal(report.monthlyRunRateByCurrency.USD, 22);
  assert.equal(report.annualizedRunRateByCurrency.USD, 264);
  assert.equal(report.lowWallets, 1);
  assert.equal(report.trialsAtRisk, 1);
});

check("ics emits one VEVENT per non-cancelled item with alarms", () => {
  const ics = buildIcs(items);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.match(ics, /SUMMARY:DuePocket: Netflix/);
  assert.match(ics, /BEGIN:VALARM/);
});

console.log(`\n${passed} checks passed.`);
