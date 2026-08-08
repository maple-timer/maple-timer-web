import {
  adminCorsHeaders,
  assertAdminAuthorized,
  json,
  onAdminOptions,
} from "../_shared/admin-auth.js";
import { isReportStoreConfigured, listReports } from "../_shared/report-store.js";

export function onRequestOptions() {
  return onAdminOptions();
}

export async function onRequestGet({ request, env }) {
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

  const url = new URL(request.url);
  const result = await listReports(env, {
    source: url.searchParams.get("source") || "",
    kind: url.searchParams.get("kind") || "",
    status: url.searchParams.get("status") || "",
    q: url.searchParams.get("q") || "",
    cursor: url.searchParams.get("cursor") || "",
    limit: url.searchParams.get("limit") || "",
  });

  return json(result, { headers: adminCorsHeaders() });
}
