export type RecordType = "subscription" | "trial" | "appWallet";

export type BillingCycle = "weekly" | "monthly" | "quarterly" | "yearly" | "one_time" | "top_up";

export type ItemStatus = "active" | "watching" | "paused" | "cancelled";

export type SourceType = "demo" | "manual" | "ai-text" | "ocr" | "import";

export type CandidateSource = "text" | "screenshot";

export type CandidateStatus = "pending" | "confirmed" | "rejected";

export type CurrencyCode = "USD" | "SGD" | "CNY" | "HKD" | "EUR" | "GBP" | "JPY";

export interface RenewalItem {
  id: string;
  type: RecordType;
  serviceName: string;
  amount: number;
  currency: CurrencyCode;
  cycle: BillingCycle;
  nextChargeDate: string;
  trialEndsAt?: string;
  walletBalance?: number;
  walletLowThreshold?: number;
  category: string;
  paymentAccount?: string;
  cancelUrl?: string;
  notes?: string;
  reminderDays: number[];
  status: ItemStatus;
  source: SourceType;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastReviewedAt?: string;
}

export type RenewalDraft = Omit<RenewalItem, "id" | "createdAt" | "updatedAt" | "source"> & {
  source?: SourceType;
};

export interface AIExtractionCandidate {
  id: string;
  source: CandidateSource;
  rawText: string;
  ocrText?: string;
  createdAt: string;
  status: CandidateStatus;
  confidence: number;
  fields: Partial<RenewalDraft>;
  fieldConfidence: Partial<Record<keyof RenewalDraft, number>>;
  warnings: string[];
}

export interface RadarEvent {
  id: string;
  item: RenewalItem;
  eventDate: string;
  daysAway: number;
  risk: "overdue" | "today" | "soon" | "upcoming" | "clear";
  label: string;
}

export interface BackupPayload {
  app: "DuePocket";
  version: 1;
  exportedAt: string;
  items: RenewalItem[];
  candidates: AIExtractionCandidate[];
}

export interface EvaluationSample {
  id: string;
  locale: "en" | "zh";
  input: string;
  expected: {
    serviceName: string;
    amount?: number;
    currency?: CurrencyCode;
    cycle?: BillingCycle;
    nextChargeDate?: string;
    type: RecordType;
  };
}
