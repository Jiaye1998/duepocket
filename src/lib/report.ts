import type { AIExtractionCandidate, CurrencyCode, RenewalItem } from "../types";
import { buildRadarEvents, isThisMonth } from "./date";

export type CurrencyTotals = Partial<Record<CurrencyCode, number>>;

export interface MonthlyReport {
  openRenewals: number;
  monthlyRunRateByCurrency: CurrencyTotals;
  annualizedRunRateByCurrency: CurrencyTotals;
  trialsAtRisk: number;
  lowWallets: number;
  aiPending: number;
  averageConfidence: number;
  recommendations: string[];
}

export function buildMonthlyReport(items: RenewalItem[], candidates: AIExtractionCandidate[]): MonthlyReport {
  const active = items.filter((item) => item.status !== "cancelled");
  const monthlyRunRateByCurrency = active.reduce<CurrencyTotals>((totals, item) => {
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

function monthlyContribution(item: RenewalItem): number {
  if (item.type === "appWallet") return 0;
  if (item.cycle === "weekly") return item.amount * 4.33;
  if (item.cycle === "monthly") return item.amount;
  if (item.cycle === "quarterly") return item.amount / 3;
  if (item.cycle === "yearly") return item.amount / 12;
  return 0;
}

function multiplyCurrencyTotals(totals: CurrencyTotals, multiplier: number): CurrencyTotals {
  return Object.fromEntries(Object.entries(totals).map(([currency, amount]) => [currency, (amount || 0) * multiplier])) as CurrencyTotals;
}

function buildRecommendations(items: RenewalItem[], trialsAtRisk: number, lowWallets: number, pendingCount: number): string[] {
  const recommendations: string[] = [];
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

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}
