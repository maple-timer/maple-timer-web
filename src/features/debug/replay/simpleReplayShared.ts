import type { DebugReplayCause } from "./buffExpiryPrecisionReplay";

export type SimpleAlertReplayEngine =
  | "rune"
  | "hunt-stall"
  | "skill"
  | "skill-buff-duration"
  | "special-core";

export type SimpleAlertReplayResult = {
  engine: SimpleAlertReplayEngine;
  supported: boolean;
  reason: string | null;
  sampledAt: number;
  status: string;
  shouldAlert: boolean;
  decisionReason: string;
  causes: DebugReplayCause[];
  metrics: Record<string, string | number | boolean | null>;
};

export type UnknownRecord = Record<string, unknown>;

export type AnalyzeOptions = {
  now?: number;
};

export function createSimpleReplayResult({
  engine,
  supported,
  reason,
  sampledAt,
  status,
  shouldAlert,
  decisionReason,
  causes,
  metrics,
}: SimpleAlertReplayResult): SimpleAlertReplayResult {
  return {
    engine,
    supported,
    reason,
    sampledAt,
    status,
    shouldAlert,
    decisionReason,
    causes,
    metrics,
  };
}

export function unsupportedCauses(name: string): DebugReplayCause[] {
  return [
    {
      status: "info",
      title: `${name} 샘플 아님`,
      detail: "다른 알림 유형은 별도 replay adapter가 필요합니다.",
    },
  ];
}

export function getSampleBody(sample: unknown): UnknownRecord {
  const root = asRecord(sample);
  const body = asRecord(root.body);
  return Object.keys(body).length ? body : root;
}

export function getHasStream(body: UnknownRecord): boolean {
  const capture = asRecord(asRecord(body.diagnostics).capture);
  return capture.hasStream !== false;
}

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function pickTimestamp(...values: unknown[]): number {
  return pickTimestampOrNull(...values) ?? Date.now();
}

export function pickTimestampOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function firstMetricValue(
  ...values: unknown[]
): string | number | boolean | null {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean") return value;
  }
  return null;
}

export function pickPositiveNumber(...values: unknown[]): number | null {
  const numeric = pickNumber(...values);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = pickNumber(value);
  if (numeric === null) return fallback;
  return Math.max(min, Math.min(max, numeric));
}
