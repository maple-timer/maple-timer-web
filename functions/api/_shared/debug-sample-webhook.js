import { buildDebugSampleNotificationPayload } from "./debug-sample-notification.js";
import { REPORT_NOTIFICATION_KINDS } from "./debug-sample-rate-limit.js";

export function isDiscordWebhookUrl(value) {
  return /discord(?:app)?\.com\/api\/webhooks/i.test(String(value ?? ""));
}

export function isSlackWebhookUrl(value) {
  return /hooks\.slack\.com\/services\//i.test(String(value ?? ""));
}

export function getReportWebhookUrl(env) {
  return env.REPORT_WEBHOOK_URL || env.FEEDBACK_WEBHOOK_URL || "";
}

export async function deliverReportNotification(webhookUrl, notification) {
  const content = typeof notification === "string" ? notification : notification?.content;
  if (!webhookUrl || !content) {
    return { skipped: true };
  }

  const isDiscordWebhook = isDiscordWebhookUrl(webhookUrl);
  const isSlackWebhook = isSlackWebhookUrl(webhookUrl);
  const requestBody = isSlackWebhook
    ? (notification.slack ?? { text: content })
    : isDiscordWebhook
      ? { content, allowed_mentions: { parse: [] } }
      : { text: content };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`report webhook failed with ${response.status}`);
  }

  return { skipped: false, channel: isSlackWebhook ? "slack" : isDiscordWebhook ? "discord" : "generic" };
}

export async function notifyReportWebhook({ request, env, id, key, metadata, body }) {
  if (!REPORT_NOTIFICATION_KINDS.has(metadata.kind)) {
    return { skipped: true };
  }

  const webhookUrl = getReportWebhookUrl(env);
  if (!webhookUrl) {
    return { skipped: true };
  }

  const notification = buildDebugSampleNotificationPayload({
    id,
    key,
    metadata,
    body,
    requestUrl: request.url,
  });
  return deliverReportNotification(webhookUrl, notification);
}
