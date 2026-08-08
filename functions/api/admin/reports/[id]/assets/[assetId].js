import {
  adminCorsHeaders,
  assertAdminAuthorized,
  json,
  onAdminOptions,
} from "../../../../_shared/admin-auth.js";
import {
  getReportAsset,
  isReportStoreConfigured,
  r2ObjectToResponse,
} from "../../../../_shared/report-store.js";

export function onRequestOptions() {
  return onAdminOptions();
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

  const asset = await getReportAsset(env, String(params?.id ?? ""), String(params?.assetId ?? ""));
  if (!asset) {
    return json({ error: "not found" }, { status: 404, headers: adminCorsHeaders() });
  }

  const response = r2ObjectToResponse(asset);
  const headers = new Headers(response.headers);
  Object.entries(adminCorsHeaders()).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
