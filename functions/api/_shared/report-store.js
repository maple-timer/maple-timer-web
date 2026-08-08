export const REPORT_STATUSES = new Set(["unresolved", "pending", "resolved"]);

const MAX_LIST_LIMIT = 100;
const DATA_URL_PLACEHOLDER = "[stored as report asset]";

export function isReportStoreConfigured(env) {
  return Boolean(env.REPORTS_DB && env.REPORT_ASSETS);
}

function makeId(prefix = "asset") {
  const random =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${String(random).replace(/[^a-zA-Z0-9-]/g, "")}`;
}

function truncate(value, maxLength) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sanitizeAssetName(value) {
  return truncate(value || "attachment.bin", 120).replace(/[^\w.\-가-힣()[\] ]/g, "-");
}

function sanitizeObjectKeyPart(value) {
  return sanitizeAssetName(value).replace(/\s+/g, "_");
}

function normalizeStatus(value) {
  return REPORT_STATUSES.has(value) ? value : "unresolved";
}

function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 50;
  }
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.round(numeric)));
}

function normalizeOffset(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.round(numeric));
}

function dataUrlToBytes(dataUrl, fallbackType) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return null;
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const metadata = dataUrl.slice(5, commaIndex);
  const encodedData = dataUrl.slice(commaIndex + 1);
  const metadataParts = metadata.split(";").filter(Boolean);
  const contentType =
    metadataParts.find((part) => part.includes("/")) || fallbackType || "application/octet-stream";
  const isBase64 = metadataParts.includes("base64");

  try {
    if (isBase64) {
      const binary = atob(encodedData.replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return { bytes, contentType };
    }

    return {
      bytes: new TextEncoder().encode(decodeURIComponent(encodedData)),
      contentType,
    };
  } catch {
    return null;
  }
}

function normalizeAsset(asset, reportId, now) {
  if (!asset || typeof asset !== "object") {
    return null;
  }

  const parsed = dataUrlToBytes(asset.dataUrl, asset.type);
  if (!parsed) {
    return null;
  }

  const id = makeId("asset");
  const name = sanitizeAssetName(asset.name);
  const type = truncate(parsed.contentType || asset.type || "application/octet-stream", 120);

  return {
    id,
    reportId,
    name,
    type,
    bytes: parsed.bytes,
    size: parsed.bytes.byteLength,
    blobKey: `reports/${encodeURIComponent(reportId)}/${id}-${sanitizeObjectKeyPart(name)}`,
    createdAt: now,
  };
}

function redactDataUrls(value) {
  if (typeof value === "string") {
    return value.startsWith("data:") ? DATA_URL_PLACEHOLDER : value;
  }

  if (Array.isArray(value)) {
    return value.map(redactDataUrls);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, redactDataUrls(nestedValue)]),
    );
  }

  return value;
}

function mapReportRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    message: row.message,
    contact: row.contact,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: safeJsonParse(row.metadata_json),
    assetCount: Number(row.asset_count ?? 0),
    previewAssetId: row.preview_asset_id ?? null,
    previewAssetUrl: row.preview_asset_id
      ? `/api/admin/reports/${encodeURIComponent(row.id)}/assets/${encodeURIComponent(
          row.preview_asset_id,
        )}`
      : null,
  };
}

function mapAssetRow(row) {
  return {
    id: row.id,
    reportId: row.report_id,
    name: row.name,
    type: row.type,
    size: Number(row.size ?? 0),
    createdAt: row.created_at,
    url: `/api/admin/reports/${encodeURIComponent(row.report_id)}/assets/${encodeURIComponent(
      row.id,
    )}`,
  };
}

async function putReportAsset(env, asset) {
  await env.REPORT_ASSETS.put(asset.blobKey, asset.bytes, {
    httpMetadata: {
      contentType: asset.type,
    },
    customMetadata: {
      reportId: asset.reportId,
      assetId: asset.id,
      name: asset.name,
    },
  });
}

export async function saveReport(env, input) {
  if (!isReportStoreConfigured(env)) {
    return { skipped: true, reason: "report store is not configured" };
  }

  const now = input.createdAt || new Date().toISOString();
  const id = input.id || makeId("report");
  const payloadKey = `payload:${id}`;
  const status = normalizeStatus(input.status);
  const assets = (input.assets ?? [])
    .map((asset) => normalizeAsset(asset, id, now))
    .filter(Boolean);
  const payload = {
    id,
    source: input.source,
    kind: input.kind,
    status,
    reason: input.reason ?? null,
    message: input.message ?? "",
    contact: input.contact ?? null,
    url: input.url ?? "",
    createdAt: now,
    metadata: input.metadata ?? {},
    payload: redactDataUrls(input.payload ?? null),
    assets: assets.map(({ bytes, ...asset }) => asset),
  };

  try {
    await Promise.all(assets.map((asset) => putReportAsset(env, asset)));

    await env.REPORTS_DB.prepare(
      `INSERT INTO reports (
        id, source, kind, status, reason, message, contact, url,
        created_at, updated_at, metadata_json, payload_key, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.source,
        input.kind,
        status,
        input.reason ?? null,
        truncate(input.message, 600) || null,
        input.contact ?? null,
        input.url ?? null,
        now,
        now,
        JSON.stringify(input.metadata ?? {}),
        payloadKey,
        JSON.stringify(payload),
      )
      .run();

    for (const asset of assets) {
      await env.REPORTS_DB.prepare(
        `INSERT INTO report_assets (
          id, report_id, name, type, blob_key, size, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(asset.id, id, asset.name, asset.type, asset.blobKey, asset.size, now)
        .run();
    }
  } catch (error) {
    await Promise.allSettled(assets.map((asset) => env.REPORT_ASSETS.delete(asset.blobKey)));
    throw error;
  }

  return { skipped: false, id, payloadKey, assetCount: assets.length };
}

export async function listReports(env, filters = {}) {
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.cursor);
  const where = [];
  const params = [];

  if (filters.source) {
    where.push("source = ?");
    params.push(filters.source);
  }
  if (filters.kind) {
    where.push("kind = ?");
    params.push(filters.kind);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.q) {
    where.push(
      "(LOWER(id) LIKE ? OR LOWER(kind) LIKE ? OR LOWER(reason) LIKE ? OR LOWER(message) LIKE ? OR LOWER(contact) LIKE ? OR LOWER(url) LIKE ?)",
    );
    const q = `%${String(filters.q).toLowerCase()}%`;
    params.push(q, q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT
      reports.*,
      (SELECT COUNT(*) FROM report_assets WHERE report_id = reports.id) AS asset_count,
      (SELECT id FROM report_assets WHERE report_id = reports.id ORDER BY created_at ASC LIMIT 1)
        AS preview_asset_id
    FROM reports
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  const result = await env.REPORTS_DB.prepare(sql).bind(...params, limit, offset).all();
  const rows = Array.isArray(result.results) ? result.results : [];

  return {
    reports: rows.map(mapReportRow),
    nextCursor: rows.length === limit ? String(offset + limit) : null,
  };
}

export async function getReport(env, id) {
  const reportRow = await env.REPORTS_DB.prepare("SELECT * FROM reports WHERE id = ?")
    .bind(id)
    .first();
  if (!reportRow) {
    return null;
  }

  const assetsResult = await env.REPORTS_DB.prepare(
    "SELECT * FROM report_assets WHERE report_id = ? ORDER BY created_at ASC",
  )
    .bind(id)
    .all();
  const assets = (assetsResult.results ?? []).map(mapAssetRow);
  const payload = safeJsonParse(reportRow.payload_json, null);

  return {
    ...mapReportRow({ ...reportRow, asset_count: assets.length, preview_asset_id: assets[0]?.id }),
    assets,
    payload,
  };
}

export async function updateReportStatus(env, id, status) {
  if (!REPORT_STATUSES.has(status)) {
    return { ok: false, error: "invalid status" };
  }

  const now = new Date().toISOString();
  const result = await env.REPORTS_DB.prepare(
    "UPDATE reports SET status = ?, updated_at = ? WHERE id = ?",
  )
    .bind(status, now, id)
    .run();
  const changed = result.meta?.changes ?? 0;
  return { ok: changed > 0, status, updatedAt: now };
}

export async function deleteReport(env, id) {
  const reportRow = await env.REPORTS_DB.prepare("SELECT * FROM reports WHERE id = ?")
    .bind(id)
    .first();
  if (!reportRow) {
    return false;
  }

  const assetsResult = await env.REPORTS_DB.prepare(
    "SELECT * FROM report_assets WHERE report_id = ?",
  )
    .bind(id)
    .all();
  const assets = assetsResult.results ?? [];

  await Promise.all(assets.map((asset) => env.REPORT_ASSETS.delete(asset.blob_key)));
  await env.REPORTS_DB.prepare("DELETE FROM report_assets WHERE report_id = ?").bind(id).run();
  await env.REPORTS_DB.prepare("DELETE FROM reports WHERE id = ?").bind(id).run();
  return true;
}

export async function getReportAsset(env, reportId, assetId) {
  const asset = await env.REPORTS_DB.prepare(
    "SELECT * FROM report_assets WHERE report_id = ? AND id = ?",
  )
    .bind(reportId, assetId)
    .first();
  if (!asset) {
    return null;
  }

  const object = await env.REPORT_ASSETS.get(asset.blob_key);
  if (!object) {
    return null;
  }

  return {
    ...mapAssetRow(asset),
    object,
  };
}

export function r2ObjectToResponse(asset) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${asset.name.replace(/"/g, "")}"`,
  });

  if (typeof asset.object?.writeHttpMetadata === "function") {
    asset.object.writeHttpMetadata(headers);
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", asset.type || "application/octet-stream");
  }

  return new Response(asset.object.body, { headers });
}
