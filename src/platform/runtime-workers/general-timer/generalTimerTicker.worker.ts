import type {
  GeneralTimerTickerRequest,
  GeneralTimerTickerResponse,
} from "./generalTimerTickerWorkerTypes";

const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 1000;

let timeoutId: number | null = null;
let intervalMs = 250;
let nextTickAt = 0;

self.onmessage = (event: MessageEvent<GeneralTimerTickerRequest>) => {
  const request = event.data;
  if (request.type === "stop") {
    stopTicker();
    return;
  }

  intervalMs = normalizeIntervalMs(request.intervalMs);
  startTicker();
};

function normalizeIntervalMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 250;
  }
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value)));
}

function startTicker(): void {
  stopTicker();
  const now = Date.now();
  postTick(now);
  nextTickAt = now + intervalMs;
  scheduleNextTick();
}

function stopTicker(): void {
  if (timeoutId === null) {
    return;
  }

  self.clearTimeout(timeoutId);
  timeoutId = null;
}

function scheduleNextTick(): void {
  const delayMs = Math.max(0, nextTickAt - Date.now());
  timeoutId = self.setTimeout(runTick, delayMs);
}

function runTick(): void {
  const now = Date.now();
  postTick(now);

  do {
    nextTickAt += intervalMs;
  } while (nextTickAt <= now);

  scheduleNextTick();
}

function postTick(now: number): void {
  const response: GeneralTimerTickerResponse = { type: "tick", now };
  self.postMessage(response);
}
