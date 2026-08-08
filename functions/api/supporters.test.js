import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./supporters.js";
import {
  SUPPORTERS_KV_KEY,
  normalizeSupportersPayload,
} from "./_shared/supporters-store.js";

function createSupportersBinding(value) {
  return {
    get: vi.fn(async (key) => (key === SUPPORTERS_KV_KEY ? value : null)),
  };
}

async function readJson(response) {
  return response.json();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("supporters API", () => {
  it("reports unavailable when the KV binding is missing", async () => {
    const response = await onRequestGet({ env: {} });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toEqual({
      available: false,
      supporters: [],
    });
  });

  it("normalizes supporter data from KV", async () => {
    const env = {
      SUPPORTERS: createSupportersBinding(
        JSON.stringify({
          updatedAt: "2026-06-06T00:00:00.000Z",
          supporters: [
            { worldId: "scania", nickname: "흉폭션" },
            { worldId: "bera", nickname: "부둘" },
          ],
        }),
      ),
    };

    const response = await onRequestGet({ env });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
    await expect(readJson(response)).resolves.toEqual({
      available: true,
      updatedAt: "2026-06-06T00:00:00.000Z",
      supporters: [
        { worldId: "scania", worldName: "스카니아", nickname: "흉폭션" },
        { worldId: "bera", worldName: "베라", nickname: "부둘" },
      ],
    });
  });

  it("rejects invalid supporter data", () => {
    expect(normalizeSupportersPayload({ supporters: [{ worldId: "unknown", nickname: "테스트" }] }))
      .toEqual({ error: "invalid-supporter" });
    expect(normalizeSupportersPayload({ supporters: [
      { worldId: "scania", nickname: "흉폭션" },
      { worldId: "scania", nickname: "흉폭션" },
    ] })).toEqual({ error: "duplicate-supporter" });
  });

  it("returns unavailable for invalid JSON in KV", async () => {
    const response = await onRequestGet({
      env: {
        SUPPORTERS: createSupportersBinding("{"),
      },
    });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      available: false,
      supporters: [],
      error: "invalid-json",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves cached supporter data without reading KV", async () => {
    const cachedResponse = Response.json({
      available: true,
      updatedAt: "2026-06-06T00:00:00.000Z",
      supporters: [{ worldId: "luna", worldName: "루나", nickname: "캐시" }],
    });
    const cache = {
      match: vi.fn(async () => cachedResponse),
      put: vi.fn(),
    };
    vi.stubGlobal("caches", { default: cache });
    const env = {
      SUPPORTERS: createSupportersBinding(JSON.stringify({ supporters: [] })),
    };

    const response = await onRequestGet({
      request: new Request("https://maple-timer.com/api/supporters?cacheBust=1"),
      env,
    });

    expect(cache.match).toHaveBeenCalledWith(expect.any(Request));
    expect(cache.put).not.toHaveBeenCalled();
    expect(env.SUPPORTERS.get).not.toHaveBeenCalled();
    await expect(readJson(response)).resolves.toMatchObject({
      supporters: [{ nickname: "캐시" }],
    });
  });
});
