import {
  compactReportPayload,
  getReportPayloadByteLength,
  REPORT_PAYLOAD_RETRY_LIMIT_BYTES,
} from "./reportPayloadBudget";

const REPORT_CLIENT_ID_STORAGE_KEY = "maple-timer.report.client-id";
const LEGACY_RUNE_REPORT_CLIENT_ID_STORAGE_KEY = "maple-timer.rune-report.client-id";
const DEBUG_SAMPLE_FULL_FRAME_DROP_THRESHOLD_BYTES = 3_750_000;

export type ReportResponseData = {
  id?: unknown;
  error?: unknown;
};

export function getOrCreateReportClientId(): string {
  if (typeof localStorage === "undefined") {
    return "unknown-client";
  }

  const stored =
    localStorage.getItem(REPORT_CLIENT_ID_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_RUNE_REPORT_CLIENT_ID_STORAGE_KEY);
  if (stored) {
    localStorage.setItem(REPORT_CLIENT_ID_STORAGE_KEY, stored);
    return stored;
  }

  const next =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `client-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem(REPORT_CLIENT_ID_STORAGE_KEY, next);
  return next;
}

export async function postDebugSample(
  payload: unknown,
  fallbackErrorMessage: string,
): Promise<ReportResponseData> {
  const initialPayload = compactReportPayload(
    createInitialDebugSamplePayload(stripDebugSampleImageData(payload)),
  );
  const response = await sendDebugSamplePayload(initialPayload);
  const data = await response.json().catch(() => ({}));

  if (
    !response.ok &&
    isSampleTooLargeError(data) &&
    canRetryWithReducedPayload(initialPayload)
  ) {
    const retryResponse = await sendDebugSamplePayload(
      compactReportPayload(createReducedDebugSamplePayload(initialPayload), {
        targetBytes: REPORT_PAYLOAD_RETRY_LIMIT_BYTES,
        aggressive: true,
      }),
    );
    const retryData = await retryResponse.json().catch(() => ({}));
    if (retryResponse.ok) {
      return retryData;
    }
    throw new Error(
      typeof retryData.error === "string" ? retryData.error : fallbackErrorMessage,
    );
  }

  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : fallbackErrorMessage,
    );
  }

  return data;
}

async function sendDebugSamplePayload(payload: unknown): Promise<Response> {
  return fetch("/api/debug-samples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function isSampleTooLargeError(data: unknown): boolean {
  return isRecord(data) && data.error === "sample is too large";
}

function canRetryWithReducedPayload(
  payload: unknown,
): payload is Record<string, unknown> & { sample: Record<string, unknown> } {
  return isRecord(payload) && isRecord(payload.sample);
}

function createInitialDebugSamplePayload(payload: unknown): unknown {
  if (
    canRetryWithReducedPayload(payload) &&
    typeof payload.sample.fullFrameDataUrl === "string" &&
    getDebugSamplePayloadByteLength(payload) > DEBUG_SAMPLE_FULL_FRAME_DROP_THRESHOLD_BYTES
  ) {
    return createReducedDebugSamplePayload(payload);
  }
  return payload;
}

function createReducedDebugSamplePayload(payload: unknown): unknown {
  const cloned = JSON.parse(JSON.stringify(payload)) as unknown;
  if (
    isRecord(cloned) &&
    isRecord(cloned.sample) &&
    typeof cloned.sample.fullFrameDataUrl === "string"
  ) {
    cloned.sample.fullFrameDataUrl = null;
    cloned.sample.fullFrameDataUrlDropped = true;
  }
  return cloned;
}

function getDebugSamplePayloadByteLength(payload: unknown): number {
  return getReportPayloadByteLength(payload);
}

function stripDebugSampleImageData(payload: unknown): unknown {
  const serialized = JSON.stringify(payload, (key, value) => {
    if (key.endsWith("ImageData")) {
      return undefined;
    }
    return value;
  });
  return typeof serialized === "string" ? JSON.parse(serialized) : payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatReportSuccessMessage(
  data: ReportResponseData,
  withIdMessage: (id: string) => string,
  fallbackMessage: string,
): string {
  return typeof data.id === "string" ? withIdMessage(data.id) : fallbackMessage;
}
