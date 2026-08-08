const DEFAULT_FLUSH_INTERVAL_MS = 60 * 1000;

const usageCounts = new Map();
let nextFlushAt = 0;
let windowStartedAt = 0;

export function recordApiUsage(request, endpoint) {
  const now = Date.now();
  const method = typeof request?.method === "string" ? request.method : "UNKNOWN";
  const path = endpoint || getRequestPath(request) || "unknown";
  const key = `${method} ${path}`;

  if (usageCounts.size === 0) {
    windowStartedAt = now;
    nextFlushAt = now + DEFAULT_FLUSH_INTERVAL_MS;
  }

  usageCounts.set(key, (usageCounts.get(key) || 0) + 1);

  if (now >= nextFlushAt) {
    flushApiUsage(now);
  }
}

export function flushApiUsage(now = Date.now()) {
  if (usageCounts.size === 0) {
    nextFlushAt = now + DEFAULT_FLUSH_INTERVAL_MS;
    windowStartedAt = now;
    return;
  }

  const counts = Object.fromEntries([...usageCounts.entries()].sort());
  console.info(
    JSON.stringify({
      kind: "maple_timer_api_usage",
      startedAt: new Date(windowStartedAt).toISOString(),
      flushedAt: new Date(now).toISOString(),
      windowMs: Math.max(0, now - windowStartedAt),
      counts,
    }),
  );

  usageCounts.clear();
  windowStartedAt = now;
  nextFlushAt = now + DEFAULT_FLUSH_INTERVAL_MS;
}

function getRequestPath(request) {
  try {
    return request?.url ? new URL(request.url).pathname : "";
  } catch {
    return "";
  }
}
