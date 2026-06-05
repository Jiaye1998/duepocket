import type { AIExtractionCandidate, BackupPayload, RenewalItem } from "../types";
import { eventDateForItem, formatDate } from "./date";

export function createBackup(items: RenewalItem[], candidates: AIExtractionCandidate[]): BackupPayload {
  return {
    app: "DuePocket",
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
    candidates,
  };
}

export function parseBackup(text: string): BackupPayload {
  const payload = JSON.parse(text) as BackupPayload;
  if (payload.app !== "DuePocket" || payload.version !== 1 || !Array.isArray(payload.items)) {
    throw new Error("This file is not a DuePocket backup.");
  }
  return payload;
}

export function downloadText(filename: string, text: string, type = "text/plain;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildIcs(items: RenewalItem[]): string {
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

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 ? 2 : 0,
  }).format(amount || 0);
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function reminderDaysFor(item: RenewalItem): number[] {
  const days = item.reminderDays?.length ? item.reminderDays : [1];
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day > 0 && day <= 365))).sort((a, b) => b - a);
}
