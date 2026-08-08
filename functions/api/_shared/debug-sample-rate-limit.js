import { REPORT_KIND_LABELS } from "./debug-sample-format.js";

export const FALSE_REPORT_RATE_LIMIT = 10;
export const RATE_LIMIT_TTL_SECONDS = 60 * 60 + 120;
export const RATE_LIMITED_REPORT_KINDS = new Set([
  "rune-false-positive",
  "skill-misread",
  "rune-issue",
  "skill-issue",
  "hunt-stall-issue",
  "buff-expiry-issue",
  "booster-expiry-issue",
  "special-core-issue",
  "ultima-raid-equipment-issue",
  "ultima-raid-boss-issue",
]);
export const REPORT_NOTIFICATION_KINDS = new Set(RATE_LIMITED_REPORT_KINDS);

export function sanitizeRateLimitKey(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_.:-]/g, "-")
    .slice(0, 120);
}

export async function enforceFalseReportRateLimit({ request, env, body, now = new Date() }) {
  if (!RATE_LIMITED_REPORT_KINDS.has(body?.kind)) {
    return null;
  }

  const clientId = sanitizeRateLimitKey(
    body.clientId || request.headers.get("CF-Connecting-IP") || "unknown-client",
  );
  const hour = now.toISOString().slice(0, 13);
  const key = `rate:${body.kind}:${clientId}:${hour}`;
  const current = Number((await env.DEBUG_SAMPLES.get(key)) ?? 0);

  if (Number.isFinite(current) && current >= FALSE_REPORT_RATE_LIMIT) {
    const label = REPORT_KIND_LABELS[body.kind] ?? "감지 제보";
    return {
      status: 429,
      body: { error: `${label}는 브라우저 기준 1시간에 10회까지만 보낼 수 있습니다.` },
    };
  }

  await env.DEBUG_SAMPLES.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
    metadata: {
      clientId,
      kind: `${body.kind}-rate-limit`,
      hour,
    },
  });

  return null;
}
