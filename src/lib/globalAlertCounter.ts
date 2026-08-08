import { appBuildInfo } from "../platform/runtime-build/currentAppBuildInfo";
import { createMapleTimerApiUrl } from "./mapleTimerApi";

const ALERT_COUNT_API_URL = createMapleTimerApiUrl("/v1/alert-count");
const ALERT_COUNT_INCREMENT_API_URL = createMapleTimerApiUrl("/v1/alert-count/increment");
const FLUSH_INTERVAL_MS = 60 * 1000;
const FLUSH_JITTER_MS = 20 * 1000;
const FAILURE_CIRCUIT_BREAKER_MS = 30 * 60 * 1000;
const CIRCUIT_BREAKER_STORAGE_KEY = "mapleTimer.alertCountCircuitBreakerUntil";
const ALERT_COUNT_MIN_POLL_INTERVAL_MS = 60 * 1000;
const ALERT_COUNT_MAX_POLL_INTERVAL_MS = 10 * 60 * 1000;
const MAX_PENDING_COUNT = 1_000;
const LOCAL_FALLBACK_ALERT_COUNT = 334_773;
const LOCAL_FALLBACK_TODAY_ALERT_COUNT = 21_270;

export type GlobalAlertCountSnapshot = {
  available: boolean;
  count: number;
  counts: {
    today: number;
    last7Days: number;
    month: number;
    total: number;
  };
  updatedAt: string | null;
  pollIntervalMs: number;
};

let pendingCount = 0;
let flushTimer: number | null = null;
let lifecycleInstalled = false;
let circuitBreakerUntilMs = 0;

export function recordGlobalAlertPlayed() {
  if (!canUseBrowserCounter()) {
    return;
  }

  installFlushLifecycle();
  if (isAlertCountCircuitBreakerActive()) {
    return;
  }

  pendingCount = Math.min(MAX_PENDING_COUNT, pendingCount + 1);
  scheduleFlush();
}

export async function fetchGlobalAlertCount(signal?: AbortSignal): Promise<GlobalAlertCountSnapshot> {
  const response = await fetch(ALERT_COUNT_API_URL, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    if (appBuildInfo.channel === "local") {
      return createLocalFallbackAlertCountSnapshot();
    }
    throw new Error("alert-count-unavailable");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (appBuildInfo.channel === "local") {
      return createLocalFallbackAlertCountSnapshot();
    }
    throw new Error("alert-count-unavailable");
  }

  const body = await response.json();
  const count = Number(body?.count);
  const counts = normalizeGlobalAlertCounts(body?.counts, count);
  const pollIntervalMs = Number(body?.pollIntervalMs);
  if (!body?.available || !Number.isFinite(count)) {
    throw new Error("alert-count-unavailable");
  }

  return {
    available: true,
    count: Math.max(0, Math.floor(count)),
    counts,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
    pollIntervalMs: Number.isFinite(pollIntervalMs)
      ? Math.max(
          ALERT_COUNT_MIN_POLL_INTERVAL_MS,
          Math.min(ALERT_COUNT_MAX_POLL_INTERVAL_MS, Math.floor(pollIntervalMs)),
        )
      : ALERT_COUNT_MIN_POLL_INTERVAL_MS,
  };
}

function createLocalFallbackAlertCountSnapshot(): GlobalAlertCountSnapshot {
  return {
    available: true,
    count: LOCAL_FALLBACK_ALERT_COUNT,
    counts: {
      today: LOCAL_FALLBACK_TODAY_ALERT_COUNT,
      last7Days: LOCAL_FALLBACK_ALERT_COUNT,
      month: LOCAL_FALLBACK_ALERT_COUNT,
      total: LOCAL_FALLBACK_ALERT_COUNT,
    },
    updatedAt: null,
    pollIntervalMs: ALERT_COUNT_MIN_POLL_INTERVAL_MS,
  };
}

export function flushGlobalAlertCount(options: { preferBeacon?: boolean } = {}) {
  if (!canUseBrowserCounter() || pendingCount <= 0) {
    return;
  }

  if (isAlertCountCircuitBreakerActive()) {
    pendingCount = 0;
    return;
  }

  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

  const count = pendingCount;
  pendingCount = 0;
  const body = JSON.stringify({ count });

  if (options.preferBeacon && trySendBeacon(body)) {
    return;
  }

  void fetch(ALERT_COUNT_INCREMENT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).then(async (response) => {
    if (!(await isSuccessfulAlertCountPostResponse(response))) {
      openAlertCountCircuitBreaker();
    }
  }).catch(() => {
    openAlertCountCircuitBreaker();
  });
}

function canUseBrowserCounter() {
  return typeof window !== "undefined" && typeof fetch === "function";
}

function scheduleFlush() {
  if (flushTimer !== null) {
    return;
  }

  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushGlobalAlertCount();
  }, createFlushDelayMs());
}

function createFlushDelayMs() {
  return FLUSH_INTERVAL_MS + Math.floor(Math.random() * FLUSH_JITTER_MS);
}

async function isSuccessfulAlertCountPostResponse(response: Response) {
  if (!response.ok) {
    return false;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return false;
  }

  try {
    const body = await response.json();
    return body?.available === true;
  } catch {
    return false;
  }
}

function isAlertCountCircuitBreakerActive(now = Date.now()) {
  const until = getAlertCountCircuitBreakerUntilMs();
  if (until <= now) {
    clearAlertCountCircuitBreaker();
    return false;
  }
  return true;
}

function openAlertCountCircuitBreaker(now = Date.now()) {
  pendingCount = 0;
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

  circuitBreakerUntilMs = now + FAILURE_CIRCUIT_BREAKER_MS;
  try {
    window.sessionStorage?.setItem(
      CIRCUIT_BREAKER_STORAGE_KEY,
      String(circuitBreakerUntilMs),
    );
  } catch {
    // Ignore storage failures; the in-memory breaker still protects this page.
  }
}

function getAlertCountCircuitBreakerUntilMs() {
  if (circuitBreakerUntilMs > 0) {
    return circuitBreakerUntilMs;
  }

  try {
    const raw = window.sessionStorage?.getItem(CIRCUIT_BREAKER_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      circuitBreakerUntilMs = parsed;
      return parsed;
    }
  } catch {
    // Ignore storage failures; fall back to the in-memory breaker.
  }

  return 0;
}

function clearAlertCountCircuitBreaker() {
  if (circuitBreakerUntilMs === 0) {
    return;
  }

  circuitBreakerUntilMs = 0;
  try {
    window.sessionStorage?.removeItem(CIRCUIT_BREAKER_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function trySendBeacon(body: string) {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
    return false;
  }

  try {
    return navigator.sendBeacon(
      ALERT_COUNT_INCREMENT_API_URL,
      new Blob([body], { type: "application/json" }),
    );
  } catch {
    return false;
  }
}

function installFlushLifecycle() {
  if (lifecycleInstalled || typeof window === "undefined") {
    return;
  }

  lifecycleInstalled = true;
  window.addEventListener("pagehide", () => {
    flushGlobalAlertCount({ preferBeacon: true });
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushGlobalAlertCount({ preferBeacon: true });
      }
    });
  }
}

function normalizeGlobalAlertCounts(
  value: unknown,
  fallbackTotal: number,
): GlobalAlertCountSnapshot["counts"] {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const total = normalizeCountValue(source.total, fallbackTotal);
  return {
    today: normalizeCountValue(source.today, 0),
    last7Days: normalizeCountValue(source.last7Days, 0),
    month: normalizeCountValue(source.month, 0),
    total,
  };
}

function normalizeCountValue(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.floor(fallback));
  }
  return Math.max(0, Math.floor(numeric));
}
