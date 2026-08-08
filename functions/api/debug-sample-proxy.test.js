import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestOptions } from "./debug-sample-proxy.js";

describe("debug sample proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("proxies allowed debug sample JSON with CORS headers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "sample-1" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const target = "https://maple-timer.com/api/debug-samples?id=sample-1";
    const request = new Request(
      `https://preview.maple-timer.pages.dev/api/debug-sample-proxy?url=${encodeURIComponent(target)}`,
      {
        method: "GET",
      },
    );

    const response = await onRequestGet({ request });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(data).toEqual({ id: "sample-1" });
    expect(fetchMock).toHaveBeenCalledWith(new URL(target), {
      headers: {
        Accept: "application/json",
      },
    });
  });

  it("rejects non-debug-sample URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const target = "https://example.com/private";
    const request = new Request(
      `https://preview.maple-timer.pages.dev/api/debug-sample-proxy?url=${encodeURIComponent(target)}`,
      {
        method: "GET",
      },
    );

    const response = await onRequestGet({ request });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("host is not allowed");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns CORS headers for preflight", async () => {
    const response = await onRequestOptions();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
