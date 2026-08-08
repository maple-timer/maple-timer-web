import {
  adminCorsHeaders,
  assertAdminAuthorized,
  json,
  onAdminOptions,
} from "../../_shared/admin-auth.js";
import {
  deleteReport,
  getReport,
  isReportStoreConfigured,
  updateReportStatus,
} from "../../_shared/report-store.js";

export function onRequestOptions() {
  return onAdminOptions();
}

function getReportId(params) {
  return String(params?.id ?? "").trim();
}

export async function onRequestGet({ request, env, params }) {
  const authResponse = assertAdminAuthorized(request, env);
  if (authResponse) {
    return authResponse;
  }

  if (!isReportStoreConfigured(env)) {
    return json(
      { error: "report store bindings are missing" },
      { status: 500, headers: adminCorsHeaders() },
    );
  }

  const report = await getReport(env, getReportId(params));
  if (!report) {
    return json({ error: "not found" }, { status: 404, headers: adminCorsHeaders() });
  }

  return json({ report }, { headers: adminCorsHeaders() });
}

export async function onRequestPatch({ request, env, params }) {
  const authResponse = assertAdminAuthorized(request, env);
  if (authResponse) {
    return authResponse;
  }

  if (!isReportStoreConfigured(env)) {
    return json(
      { error: "report store bindings are missing" },
      { status: 500, headers: adminCorsHeaders() },
    );
  }

  const body = await request.json().catch(() => ({}));
  const result = await updateReportStatus(env, getReportId(params), body.status);
  if (!result.ok) {
    return json(
      { error: result.error || "not found" },
      { status: result.error ? 400 : 404, headers: adminCorsHeaders() },
    );
  }

  return json(result, { headers: adminCorsHeaders() });
}

export async function onRequestDelete({ request, env, params }) {
  const authResponse = assertAdminAuthorized(request, env);
  if (authResponse) {
    return authResponse;
  }

  if (!isReportStoreConfigured(env)) {
    return json(
      { error: "report store bindings are missing" },
      { status: 500, headers: adminCorsHeaders() },
    );
  }

  const deleted = await deleteReport(env, getReportId(params));
  if (!deleted) {
    return json({ error: "not found" }, { status: 404, headers: adminCorsHeaders() });
  }

  return json({ ok: true }, { headers: adminCorsHeaders() });
}
