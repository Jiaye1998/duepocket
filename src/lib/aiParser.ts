import type {
  AIExtractionCandidate,
  BillingCycle,
  CandidateSource,
  CurrencyCode,
  RecordType,
  RenewalDraft,
} from "../types";
import { addDays, toDateInputValue } from "./date";
import { createId } from "./id";

const knownServices = [
  "ChatGPT",
  "OpenAI",
  "Netflix",
  "Spotify",
  "YouTube Premium",
  "Figma",
  "Adobe",
  "Notion",
  "iCloud",
  "Google One",
  "GitHub",
  "Grab",
  "moomoo",
  "EZ-Link",
  "Canva Pro",
  "Dropbox",
  "Linear",
  "Apple Developer Program",
  "Slack",
  "AWS credits",
  "Zoom Pro",
  "Todoist",
  "1Password",
  "HBO Max",
  "Kindle Unlimited",
  "Transit card",
  "腾讯视频",
  "爱奇艺",
  "美团",
  "滴滴",
  "支付宝",
  "微信读书",
  "网易云音乐",
  "WPS",
  "B站",
  "Keep",
  "百度网盘",
  "夸克网盘",
  "小红书",
  "饿了么",
  "滴答清单",
  "飞书",
  "喜马拉雅",
  "知乎盐选",
  "剪映",
  "高德打车",
  "淘宝88VIP",
  "京东Plus",
  "多邻国",
  "幕布",
  "公交卡",
];

const currencyMap: Record<string, CurrencyCode> = {
  "$": "USD",
  "US$": "USD",
  USD: "USD",
  "S$": "SGD",
  SGD: "SGD",
  CNY: "CNY",
  RMB: "CNY",
  "¥": "CNY",
  "￥": "CNY",
  HKD: "HKD",
  EUR: "EUR",
  "€": "EUR",
  GBP: "GBP",
  "£": "GBP",
  JPY: "JPY",
};

export function parseRenewalText(rawText: string, source: CandidateSource): AIExtractionCandidate {
  const text = rawText.trim();
  const normalized = text.replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();
  const warnings: string[] = [];
  const fieldConfidence: AIExtractionCandidate["fieldConfidence"] = {};

  const serviceName = extractServiceName(normalized);
  const amountResult = extractAmount(normalized);
  const dateResult = extractDate(normalized);
  const cycle = extractCycle(lower);
  const type = extractType(lower, serviceName);
  const cancelUrl = normalized.match(/https?:\/\/[^\s)]+/i)?.[0];
  const walletBalance = type === "appWallet" ? extractWalletBalance(normalized) ?? amountResult?.amount : undefined;

  if (!serviceName) warnings.push("Service name needs review.");
  if (!amountResult && type !== "appWallet") warnings.push("Amount was not found.");
  if (!dateResult) warnings.push("Next date was not found.");
  if (!cycle) warnings.push("Billing cycle needs confirmation.");
  if (type === "appWallet" && walletBalance === undefined) warnings.push("Wallet balance needs confirmation.");

  const fields: Partial<RenewalDraft> = {
    type,
    serviceName: serviceName || "Unknown service",
    amount: type === "appWallet" ? 0 : amountResult?.amount ?? 0,
    currency: amountResult?.currency ?? "USD",
    cycle: type === "appWallet" ? "top_up" : cycle ?? "monthly",
    nextChargeDate: dateResult ?? addDays(new Date(), 7),
    trialEndsAt: type === "trial" ? dateResult ?? addDays(new Date(), 7) : undefined,
    walletBalance,
    walletLowThreshold: type === "appWallet" ? Math.max(10, Math.round((walletBalance ?? 20) * 0.35)) : undefined,
    category: inferCategory(type, serviceName, lower),
    cancelUrl,
    notes: source === "screenshot" ? "Parsed from local OCR screenshot text." : "Parsed from one-line intake.",
    reminderDays: type === "trial" ? [3, 1] : [7, 1],
    status: type === "trial" || type === "appWallet" ? "watching" : "active",
    tags: buildTags(type, lower),
  };

  if (serviceName) fieldConfidence.serviceName = 0.86;
  if (amountResult) {
    fieldConfidence.amount = 0.82;
    fieldConfidence.currency = amountResult.currencyToken ? 0.86 : 0.64;
  }
  if (dateResult) fieldConfidence.nextChargeDate = 0.8;
  if (cycle) fieldConfidence.cycle = 0.82;
  fieldConfidence.type = type === "subscription" ? 0.7 : 0.84;

  const confidence = clamp(
    0.42 +
      (serviceName ? 0.13 : 0) +
      (amountResult || type === "appWallet" ? 0.13 : 0) +
      (dateResult ? 0.14 : 0) +
      (cycle || type === "appWallet" ? 0.1 : 0) +
      (warnings.length ? -warnings.length * 0.04 : 0),
    0.2,
    0.96
  );

  return {
    id: createId("candidate"),
    source,
    rawText: text,
    ocrText: source === "screenshot" ? text : undefined,
    createdAt: new Date().toISOString(),
    status: "pending",
    confidence: Number(confidence.toFixed(2)),
    fields,
    fieldConfidence,
    warnings,
  };
}

export async function runLocalOcr(file: File, onProgress?: (message: string, progress: number) => void): Promise<string> {
  const tesseract = await import("tesseract.js");
  onProgress?.("Loading English + Simplified Chinese OCR models", 0);
  const worker = await tesseract.createWorker(["chi_sim", "eng"], 1, {
    logger: (event: { status?: string; progress?: number }) => {
      onProgress?.(event.status || "ocr", event.progress || 0);
    },
  });
  try {
    const result = await worker.recognize(file);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

function extractServiceName(text: string): string | undefined {
  const known = knownServices.find((service) => text.toLowerCase().includes(service.toLowerCase()));
  if (known) return known;
  const quoted = text.match(/["'“”]([^"'“”]{2,40})["'“”]/)?.[1];
  if (quoted) return quoted.trim();
  const leading = text.match(/^([A-Z][A-Za-z0-9+.\- ]{2,34}?)(?:\s+(?:renews|renewal|trial|charges|will|每|于|在)|\s+\d|\s+[$S¥￥])/);
  if (leading) return leading[1].trim();
  const chinese = text.match(/([\u4e00-\u9fa5A-Za-z0-9+.\-]{2,20})(?:会员|订阅|试用|余额|充值)/);
  return chinese?.[1]?.trim();
}

function extractAmount(text: string): { amount: number; currency: CurrencyCode; currencyToken?: string } | undefined {
  const prefixed = text.match(/(US\$|S\$|USD|SGD|CNY|RMB|HKD|EUR|GBP|JPY|[$¥￥€£])\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (prefixed) {
    const token = prefixed[1].toUpperCase();
    return {
      amount: Number(prefixed[2]),
      currency: currencyMap[prefixed[1]] || currencyMap[token] || "USD",
      currencyToken: prefixed[1],
    };
  }
  const suffixed = text.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*(USD|SGD|CNY|RMB|HKD|EUR|GBP|JPY|美元|新币|人民币|元)/i);
  if (suffixed) {
    const token = suffixed[2].toUpperCase();
    const currency = token === "美元" ? "USD" : token === "新币" ? "SGD" : token === "人民币" || token === "元" ? "CNY" : currencyMap[token] || "USD";
    return { amount: Number(suffixed[1]), currency, currencyToken: suffixed[2] };
  }
  return undefined;
}

function extractWalletBalance(text: string): number | undefined {
  const balance = text.match(/(?:balance|wallet|余额|剩余|available)\D{0,12}([0-9]+(?:\.[0-9]{1,2})?)/i);
  return balance ? Number(balance[1]) : undefined;
}

function extractDate(text: string): string | undefined {
  const iso = text.match(/\b(20[0-9]{2})[-/.](1[0-2]|0?[1-9])[-/.](3[01]|[12][0-9]|0?[1-9])\b/);
  if (iso) return normalizeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = text.match(/\b(1[0-2]|0?[1-9])[/](3[01]|[12][0-9]|0?[1-9])(?:[/](20[0-9]{2}))?\b/);
  if (slash) return inferYearDate(Number(slash[1]), Number(slash[2]), slash[3] ? Number(slash[3]) : undefined);

  const zh = text.match(/(?:(20[0-9]{2})年)?\s*(1[0-2]|0?[1-9])月\s*(3[01]|[12][0-9]|0?[1-9])日?/);
  if (zh) return inferYearDate(Number(zh[2]), Number(zh[3]), zh[1] ? Number(zh[1]) : undefined);

  const monthName = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(3[01]|[12][0-9]|0?[1-9])(?:,\s*(20[0-9]{2}))?\b/i
  );
  if (monthName) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      monthName[1].slice(0, 3).toLowerCase()
    ) + 1;
    return inferYearDate(month, Number(monthName[2]), monthName[3] ? Number(monthName[3]) : undefined);
  }

  const relative = text.match(/(?:in|after|还有|剩余)\s*(\d{1,3})\s*(?:days?|天)/i);
  if (relative) return addDays(new Date(), Number(relative[1]));

  return undefined;
}

function extractCycle(text: string): BillingCycle | undefined {
  if (/annual|yearly|per year|year\b|每年|年付|年费|一年/.test(text)) return "yearly";
  if (/quarter|每季|季度/.test(text)) return "quarterly";
  if (/weekly|per week|每周|周付/.test(text)) return "weekly";
  if (/monthly|per month|every month|每月|月付|一个月/.test(text)) return "monthly";
  if (/one[- ]?time|一次性|单次/.test(text)) return "one_time";
  return undefined;
}

function extractType(text: string, serviceName?: string): RecordType {
  if (/trial|free trial|试用|体验|convert|转付费/.test(text)) return "trial";
  if (/wallet|balance|top.?up|stored value|余额|充值|交通卡/.test(text)) return "appWallet";
  if (serviceName && /grab|moomoo|ez-link/i.test(serviceName)) return "appWallet";
  return "subscription";
}

function inferCategory(type: RecordType, serviceName: string | undefined, text: string): string {
  if (type === "trial") return "Trial";
  if (type === "appWallet") return /grab|交通|commute|ez-link|滴滴/.test(text) ? "Transport" : "App wallet";
  if (/chatgpt|openai|github|notion|figma|adobe|ai/.test(`${serviceName || ""} ${text}`.toLowerCase())) return "Work tools";
  if (/netflix|spotify|youtube|腾讯|爱奇艺/.test(`${serviceName || ""} ${text}`.toLowerCase())) return "Media";
  return "Subscription";
}

function buildTags(type: RecordType, text: string): string[] {
  const tags: string[] = [type];
  if (/ai|chatgpt|openai/.test(text)) tags.push("ai");
  if (/trial|试用/.test(text)) tags.push("trial");
  if (/wallet|余额/.test(text)) tags.push("wallet");
  return Array.from(new Set(tags));
}

function inferYearDate(month: number, day: number, year?: number): string {
  const today = new Date();
  let candidateYear = year ?? today.getFullYear();
  let date = new Date(candidateYear, month - 1, day);
  if (!year && date < startToday()) {
    candidateYear += 1;
    date = new Date(candidateYear, month - 1, day);
  }
  return toDateInputValue(date);
}

function normalizeDate(year: number, month: number, day: number): string {
  return toDateInputValue(new Date(year, month - 1, day));
}

function startToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
