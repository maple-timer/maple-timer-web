import { recordApiUsage } from "./_shared/api-usage-log.js";

const ALLOWED_HOSTS = new Set(["maple-timer.com", "preview.maple-timer.pages.dev"]);

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

function validateDebugSampleUrl(value) {
  if (!value) {
    return { error: "url is required" };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: "invalid url" };
  }

  if (url.protocol !== "https:") {
    return { error: "only https urls are allowed" };
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    return { error: "host is not allowed" };
  }
  if (url.pathname !== "/api/debug-samples") {
    return { error: "path is not allowed" };
  }
  if (!url.searchParams.get("id")) {
    return { error: "sample id is required" };
  }

  return { url };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestGet({ request }) {
  recordApiUsage(request, "/api/debug-sample-proxy");
  const requestUrl = new URL(request.url);
  const validation = validateDebugSampleUrl(requestUrl.searchParams.get("url"));
  if (validation.error) {
    return json({ error: validation.error }, { status: 400 });
  }

  const response = await fetch(validation.url, {
    headers: {
      Accept: "application/json",
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    return json(
      { error: `upstream returned ${response.status}` },
      { status: response.status },
    );
  }
  if (!contentType.includes("application/json")) {
    return json({ error: "upstream did not return json" }, { status: 502 });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
