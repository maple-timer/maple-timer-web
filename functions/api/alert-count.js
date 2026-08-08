import {
  getAlertCountPollIntervalMs,
  incrementAlertCounter,
  readAlertCounter,
} from "./_shared/alert-counter-store.js";
import { recordApiUsage } from "./_shared/api-usage-log.js";

const MAX_BODY_BYTES = 2048;
const ALERT_COUNT_GET_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
};

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { error: "body-too-large" };
  }

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: "invalid-json" };
  }
}

export async function onRequestGet({ request, env }) {
  recordApiUsage(request, "/api/alert-count");
  const result = await readAlertCounter(env);
  if (!result.configured) {
    return json(
      {
        available: false,
        pollIntervalMs: getAlertCountPollIntervalMs(),
      },
      { status: 503 },
    );
  }

  return json({
    available: true,
    count: result.count,
    counts: result.counts,
    updatedAt: result.updatedAt,
    pollIntervalMs: result.pollIntervalMs,
  }, { headers: ALERT_COUNT_GET_CACHE_HEADERS });
}

export async function onRequestPost({ request, env }) {
  recordApiUsage(request, "/api/alert-count");
  const body = await readJsonBody(request);
  if (body.error) {
    return json({ error: body.error }, { status: 400 });
  }

  const result = await incrementAlertCounter(env, body.count);
  if (result.error) {
    return json({ error: result.error }, { status: 400 });
  }

  if (!result.configured) {
    return json(
      {
        available: false,
        pollIntervalMs: getAlertCountPollIntervalMs(),
      },
      { status: 503 },
    );
  }

  return json({
    available: true,
    acceptedCount: result.acceptedCount,
    count: result.count,
    counts: result.counts,
    updatedAt: result.updatedAt,
    pollIntervalMs: result.pollIntervalMs,
  });
}
