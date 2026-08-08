import { readSupporters } from "./_shared/supporters-store.js";
import { recordApiUsage } from "./_shared/api-usage-log.js";

const SUCCESS_CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const ERROR_CACHE_CONTROL = "no-store";

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": ERROR_CACHE_CONTROL,
      ...init.headers,
    },
  });
}

function getSupportersCache(request) {
  if (!request || typeof caches === "undefined" || !caches.default) {
    return null;
  }

  const url = new URL(request.url);
  url.search = "";
  return {
    cache: caches.default,
    key: new Request(url.toString(), { method: "GET" }),
  };
}

export async function onRequestGet({ request, env, waitUntil }) {
  recordApiUsage(request, "/api/supporters");
  const cacheEntry = getSupportersCache(request);
  const cachedResponse = cacheEntry ? await cacheEntry.cache.match(cacheEntry.key) : null;
  if (cachedResponse) {
    return cachedResponse;
  }

  const result = await readSupporters(env);
  if (!result.configured) {
    return json({ available: false, supporters: [] }, { status: 503 });
  }

  if (result.error) {
    return json({ available: false, supporters: [], error: result.error }, { status: 503 });
  }

  const response = json(
    {
      available: true,
      supporters: result.supporters,
      updatedAt: result.updatedAt,
    },
    {
      headers: {
        "Cache-Control": SUCCESS_CACHE_CONTROL,
      },
    },
  );

  if (cacheEntry) {
    const write = cacheEntry.cache.put(cacheEntry.key, response.clone());
    if (typeof waitUntil === "function") {
      waitUntil(write);
    } else {
      await write;
    }
  }

  return response;
}
