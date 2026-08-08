import {
  getDebugSampleAssets,
  recordDebugSampleAssetFailure,
  rehydrateDebugSampleAsset,
} from "./debug-sample-record.js";
import { REPORT_NOTIFICATION_KINDS } from "./debug-sample-rate-limit.js";
import { isReportStoreConfigured, saveReport } from "./report-store.js";

export async function saveDebugSampleReport(env, { id, key, metadata, body, storedAt }) {
  try {
    return await saveReport(env, {
      id,
      source: REPORT_NOTIFICATION_KINDS.has(metadata.kind) ? "issue" : "debug",
      kind: metadata.kind,
      status: "unresolved",
      reason: metadata.issueLabel ?? metadata.issueReason ?? null,
      message: body?.reportIssue?.note ?? "",
      contact: null,
      url: body?.url ?? "",
      createdAt: body?.submittedAt || storedAt,
      metadata: {
        ...metadata,
        debugSampleKey: key,
      },
      payload: {
        id,
        key,
        storedAt,
        body,
      },
      assets: getDebugSampleAssets(body),
    });
  } catch (error) {
    console.warn(error instanceof Error ? error.message : "debug sample report storage failed");
    return { skipped: true, error: "storage failed" };
  }
}

export async function loadDebugSampleReport(env, id) {
  if (!isReportStoreConfigured(env)) {
    return null;
  }

  const report = await env.REPORTS_DB.prepare(
    "SELECT source, payload_json FROM reports WHERE id = ?",
  )
    .bind(id)
    .first();
  if (!report || !["issue", "debug"].includes(report.source)) {
    return null;
  }

  const reportPayload = safeJsonParse(report.payload_json);
  const storedSample = isRecord(reportPayload?.payload) ? reportPayload.payload : null;
  if (!storedSample) {
    return null;
  }
  if (isRecord(storedSample.body) && storedSample.id && storedSample.id !== id) {
    return null;
  }

  const assetsResult = await env.REPORTS_DB.prepare(
    "SELECT name, type, blob_key FROM report_assets WHERE report_id = ?",
  )
    .bind(id)
    .all();
  const assets = Array.isArray(assetsResult.results) ? assetsResult.results : [];
  const hydratedAssets = await Promise.all(
    assets.map(async (asset) => {
      const object = await env.REPORT_ASSETS.get(asset.blob_key);
      if (!object) {
        recordDebugSampleAssetFailure(storedSample, asset.name, "asset-missing");
        return null;
      }

      return {
        name: asset.name,
        dataUrl: await r2ObjectToDataUrl(object, asset.type),
      };
    }),
  );

  for (const asset of hydratedAssets) {
    if (asset) {
      rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl);
    }
  }

  return storedSample;
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function r2ObjectToDataUrl(object, fallbackType) {
  const arrayBuffer =
    typeof object.arrayBuffer === "function"
      ? await object.arrayBuffer()
      : await new Response(object.body).arrayBuffer();
  const contentType = object.httpMetadata?.contentType || fallbackType || "application/octet-stream";
  return `data:${contentType};base64,${bytesToBase64(new Uint8Array(arrayBuffer))}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
