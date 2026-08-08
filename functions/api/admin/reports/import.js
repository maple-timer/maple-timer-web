import {
  adminCorsHeaders,
  assertAdminAuthorized,
  json,
  onAdminOptions,
} from "../../_shared/admin-auth.js";
import { getReport, isReportStoreConfigured, saveReport } from "../../_shared/report-store.js";

const ALLOWED_SOURCES = new Set(["feedback", "issue"]);
const ALLOWED_ISSUE_KINDS = new Set([
  "skill-issue",
  "rune-issue",
  "hunt-stall-issue",
  "ultima-raid-equipment-issue",
  "ultima-raid-boss-issue",
]);
const ALLOWED_FEEDBACK_KINDS = new Set(["bug", "suggestion", "other"]);

export function onRequestOptions() {
  return onAdminOptions();
}

function isValidReportInput(input) {
  if (!input || typeof input !== "object") {
    return false;
  }
  if (!input.id || typeof input.id !== "string") {
    return false;
  }
  if (!ALLOWED_SOURCES.has(input.source)) {
    return false;
  }
  if (input.source === "feedback") {
    return ALLOWED_FEEDBACK_KINDS.has(input.kind);
  }
  return ALLOWED_ISSUE_KINDS.has(input.kind);
}

export async function onRequestPost({ request, env }) {
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

  const input = await request.json().catch(() => null);
  if (!isValidReportInput(input)) {
    return json({ error: "invalid report import payload" }, { status: 400, headers: adminCorsHeaders() });
  }

  const existing = await getReport(env, input.id);
  if (existing) {
    return json({ ok: true, skipped: true, reason: "duplicate", id: input.id }, { headers: adminCorsHeaders() });
  }

  const result = await saveReport(env, {
    ...input,
    status: input.status || "unresolved",
  });

  return json({ ok: true, skipped: false, id: result.id, assetCount: result.assetCount }, { headers: adminCorsHeaders() });
}
