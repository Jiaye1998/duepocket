import type { BillingCycle, RadarEvent, RenewalItem } from "../types";

const dayMs = 24 * 60 * 60 * 1000;

export function startOfDay(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function toDateInputValue(date: Date): string {
  const copy = startOfDay(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

export function addDays(value: Date | string, amount: number): string {
  const date = startOfDay(value);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}

export function addCycle(value: string, cycle: BillingCycle): string {
  const date = startOfDay(value);
  if (cycle === "weekly") date.setDate(date.getDate() + 7);
  else if (cycle === "quarterly") date.setMonth(date.getMonth() + 3);
  else if (cycle === "yearly") date.setFullYear(date.getFullYear() + 1);
  else date.setMonth(date.getMonth() + 1);
  return toDateInputValue(date);
}

export function daysBetween(date: string, reference = new Date()): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(reference).getTime()) / dayMs);
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return startOfDay(date).toLocaleDateString(undefined, options);
}

export function eventDateForItem(item: RenewalItem): string {
  if (item.type === "trial" && item.trialEndsAt) return item.trialEndsAt;
  return item.nextChargeDate;
}

export function buildRadarEvents(items: RenewalItem[], days = 30): RadarEvent[] {
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
      const risk: RadarEvent["risk"] =
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

export function humanDistance(daysAway: number): string {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway === -1) return "1 day overdue";
  if (daysAway < 0) return `${Math.abs(daysAway)} days overdue`;
  return `in ${daysAway} days`;
}

export function isThisMonth(date?: string, reference = new Date()): boolean {
  if (!date) return false;
  const target = startOfDay(date);
  return target.getFullYear() === reference.getFullYear() && target.getMonth() === reference.getMonth();
}

export function monthKey(date: string): string {
  const target = startOfDay(date);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
}
