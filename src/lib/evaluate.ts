import samples from "../../data/ai-eval-samples.json";
import { parseRenewalText } from "./aiParser";
import type { BillingCycle, CurrencyCode, RecordType, RenewalDraft } from "../types";

type ExpectedFields = {
  serviceName: string;
  amount?: number;
  currency?: CurrencyCode;
  cycle?: BillingCycle;
  nextChargeDate?: string;
  type: RecordType;
};

type EvalSample = {
  id: string;
  locale: "en" | "zh";
  input: string;
  expected: ExpectedFields;
};

export type EvaluationFailure = {
  id: string;
  locale: "en" | "zh";
  input: string;
  field: keyof ExpectedFields;
  expected: string;
  actual: string;
};

export type EvaluationResult = {
  datasetSize: number;
  fieldAccuracy: Record<string, number>;
  overallPassRate: number;
  averageConfidence: number;
  failures: EvaluationFailure[];
};

type FieldName = keyof ExpectedFields;

const fieldOrder: FieldName[] = ["serviceName", "amount", "currency", "cycle", "nextChargeDate", "type"];

export function runEvaluation(): EvaluationResult {
  const typedSamples = samples as EvalSample[];
  const totals = new Map<FieldName, { passed: number; total: number }>();
  const failures: EvaluationFailure[] = [];
  let passingSamples = 0;
  let confidenceTotal = 0;

  typedSamples.forEach((sample) => {
    const candidate = parseRenewalText(sample.input, "text");
    confidenceTotal += candidate.confidence;

    const sampleFailures: EvaluationFailure[] = [];
    fieldOrder.forEach((field) => {
      const expected = sample.expected[field];
      if (expected === undefined) return;
      const actual = actualFieldValue(candidate.fields, field);
      const passed = fieldMatches(field, expected, actual);
      const current = totals.get(field) || { passed: 0, total: 0 };
      totals.set(field, { passed: current.passed + (passed ? 1 : 0), total: current.total + 1 });

      if (!passed) {
        sampleFailures.push({
          id: sample.id,
          locale: sample.locale,
          input: sample.input,
          field,
          expected: String(expected),
          actual: actual === undefined ? "missing" : String(actual),
        });
      }
    });

    if (sampleFailures.length === 0) passingSamples += 1;
    failures.push(...sampleFailures);
  });

  return {
    datasetSize: typedSamples.length,
    fieldAccuracy: Object.fromEntries(
      Array.from(totals.entries()).map(([field, result]) => [field, result.total ? result.passed / result.total : 0])
    ),
    overallPassRate: typedSamples.length ? passingSamples / typedSamples.length : 0,
    averageConfidence: typedSamples.length ? confidenceTotal / typedSamples.length : 0,
    failures,
  };
}

function actualFieldValue(fields: Partial<RenewalDraft>, field: FieldName): string | number | undefined {
  if (field === "amount" && fields.type === "appWallet") return fields.walletBalance;
  return fields[field] as string | number | undefined;
}

function fieldMatches(field: FieldName, expected: string | number, actual: string | number | undefined): boolean {
  if (actual === undefined) return false;
  if (field === "serviceName") {
    const expectedText = normalizeText(String(expected));
    const actualText = normalizeText(String(actual));
    return actualText.includes(expectedText) || expectedText.includes(actualText);
  }
  if (field === "amount") {
    return Math.abs(Number(expected) - Number(actual)) < 0.01;
  }
  return String(actual) === String(expected);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
