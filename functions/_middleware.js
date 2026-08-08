const MEMORY_LAB_PATH = "/memory-lab";
const ISOLATED_PREVIEW_RESOURCE_PREFIXES = [
  "/assets/",
  "/fonts/",
  "/models/",
  "/vendor/",
];

function isPreviewHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "preview.maple-timer.pages.dev" ||
    hostname.endsWith(".maple-timer.pages.dev")
  );
}

export function shouldApplyMemoryLabHeaders(requestUrl) {
  const url = new URL(requestUrl);
  return (
    (url.pathname === MEMORY_LAB_PATH || url.pathname === `${MEMORY_LAB_PATH}/`) &&
    isPreviewHost(url.hostname)
  );
}

export function shouldApplyIsolatedPreviewResourceHeaders(requestUrl) {
  const url = new URL(requestUrl);
  return (
    isPreviewHost(url.hostname) &&
    ISOLATED_PREVIEW_RESOURCE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  );
}

export function shouldApplyIsolatedPreviewWorkerHeaders(requestUrl) {
  const url = new URL(requestUrl);
  return (
    isPreviewHost(url.hostname) &&
    url.pathname.startsWith("/assets/") &&
    /\.worker-[^/]+\.js$/.test(url.pathname)
  );
}

export async function onRequest(context) {
  const response = await context.next();
  const shouldIsolateMemoryLab = shouldApplyMemoryLabHeaders(context.request.url);
  const shouldMarkResource = shouldApplyIsolatedPreviewResourceHeaders(context.request.url);
  const shouldMarkWorker = shouldApplyIsolatedPreviewWorkerHeaders(context.request.url);
  if (!shouldIsolateMemoryLab && !shouldMarkResource) {
    return response;
  }

  const headers = new Headers(response.headers);
  if (shouldIsolateMemoryLab || shouldMarkWorker) {
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  }
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
