export function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

export function adminCorsHeaders() {
  return {
    "Access-Control-Allow-Headers": "authorization,content-type,x-admin-token",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Max-Age": "86400",
  };
}

export function onAdminOptions() {
  return new Response(null, {
    status: 204,
    headers: adminCorsHeaders(),
  });
}

function getAdminTokenFromRequest(request) {
  const url = new URL(request.url);
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return (
    bearer ||
    request.headers.get("x-admin-token") ||
    url.searchParams.get("token") ||
    ""
  );
}

export function assertAdminAuthorized(request, env) {
  const configuredToken = env.ADMIN_API_TOKEN || env.DEBUG_READ_TOKEN || "";
  if (!configuredToken) {
    return json(
      { error: "ADMIN_API_TOKEN is not configured" },
      { status: 503, headers: adminCorsHeaders() },
    );
  }

  if (getAdminTokenFromRequest(request) !== configuredToken) {
    return json({ error: "unauthorized" }, { status: 401, headers: adminCorsHeaders() });
  }

  return null;
}
