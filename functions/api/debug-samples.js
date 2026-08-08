import {
  getDebugSampleAssets,
  hasRequiredSampleImages,
  metadataFromSample,
  recordDebugSampleAssetFailure,
} from "./_shared/debug-sample-record.js";
import { recordApiUsage } from "./_shared/api-usage-log.js";
import {
  loadDebugSampleReport,
  saveDebugSampleReport,
} from "./_shared/debug-sample-report-storage.js";
import { enforceFalseReportRateLimit } from "./_shared/debug-sample-rate-limit.js";
import { notifyReportWebhook } from "./_shared/debug-sample-webhook.js";

export {
  buildDebugSampleLinks,
  buildDebugSampleNotificationContent,
  buildDebugSampleSlackNotificationPayload,
} from "./_shared/debug-sample-notification.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const SAMPLE_TTL_SECONDS = 60 * 60 * 24 * 7;

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Access-Control-Allow-Headers": "content-type,x-debug-token",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

function getReadToken(request) {
  const url = new URL(request.url);
  return request.headers.get("x-debug-token") ?? url.searchParams.get("token") ?? "";
}

function isAuthorized(request, env) {
  if (!env.DEBUG_READ_TOKEN) {
    return true;
  }

  return getReadToken(request) === env.DEBUG_READ_TOKEN;
}

function makeId() {
  const random =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return random.replace(/[^a-zA-Z0-9-]/g, "");
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "content-type,x-debug-token",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestPost({ request, env }) {
  recordApiUsage(request, "/api/debug-samples");
  if (!env.DEBUG_SAMPLES) {
    return json({ error: "DEBUG_SAMPLES binding is missing" }, { status: 500 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "sample is too large" }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 });
  }

  if (!hasRequiredSampleImages(body)) {
    return json({ error: "missing sample images" }, { status: 400 });
  }

  const rateLimitResult = await enforceFalseReportRateLimit({ request, env, body });
  if (rateLimitResult) {
    return json(rateLimitResult.body, { status: rateLimitResult.status });
  }

  const id = makeId();
  const now = new Date().toISOString();
  const reverseTime = String(9999999999999 - Date.now()).padStart(13, "0");
  const key = `sample:${reverseTime}:${id}`;
  const metadata = metadataFromSample(id, body, now);

  await env.DEBUG_SAMPLES.put(
    key,
    JSON.stringify({
      id,
      key,
      storedAt: now,
      body,
    }),
    {
      expirationTtl: SAMPLE_TTL_SECONDS,
      metadata,
    },
  );

  const reportStorage = await saveDebugSampleReport(env, {
    id,
    key,
    metadata,
    body,
    storedAt: now,
  });
  if (reportStorage.error === "storage failed") {
    for (const asset of getDebugSampleAssets(body)) {
      recordDebugSampleAssetFailure(body, asset.name, "asset-persist-failed");
    }
    await env.DEBUG_SAMPLES.put(
      key,
      JSON.stringify({ id, key, storedAt: now, body }),
      {
        expirationTtl: SAMPLE_TTL_SECONDS,
        metadata,
      },
    );
  }

  let notification = { skipped: true };
  try {
    notification = await notifyReportWebhook({ request, env, id, key, metadata, body });
  } catch (error) {
    console.warn(
      error instanceof Error ? error.message : "report webhook notification failed",
    );
  }

  return json({
    id,
    key,
    expiresInSeconds: SAMPLE_TTL_SECONDS,
    url: `/api/debug-samples?id=${encodeURIComponent(id)}`,
    stored: !reportStorage.skipped,
    notification,
  });
}

export async function onRequestGet({ request, env }) {
  recordApiUsage(request, "/api/debug-samples");
  if (!env.DEBUG_SAMPLES) {
    return json({ error: "DEBUG_SAMPLES binding is missing" }, { status: 500 });
  }

  if (!isAuthorized(request, env)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const list = await env.DEBUG_SAMPLES.list({ prefix: "sample:", limit: 50 });

  if (!id) {
    return json({
      samples: list.keys.map((item) => ({
        key: item.name,
        ...(item.metadata ?? {}),
      })),
    });
  }

  const target = list.keys.find((item) => item.metadata?.id === id || item.name.endsWith(`:${id}`));
  if (target) {
    const sample = await env.DEBUG_SAMPLES.get(target.name, "json");
    if (sample) {
      return json(sample);
    }
  }

  try {
    const storedReport = await loadDebugSampleReport(env, id);
    if (storedReport) {
      return json(storedReport);
    }
  } catch (error) {
    console.warn(error instanceof Error ? error.message : "debug sample retrieval failed");
    return json({ error: "debug sample retrieval failed" }, { status: 500 });
  }

  return json({ error: "not found" }, { status: 404 });
}
