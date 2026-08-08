import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("globalAlertCounter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches the public alert count snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          count: 12345,
          counts: {
            today: 123,
            last7Days: 4567,
            month: 8901,
            total: 12345,
          },
          updatedAt: "2026-06-01T00:00:00.000Z",
          pollIntervalMs: 10000,
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGlobalAlertCount } = await import("./globalAlertCounter");

    await expect(fetchGlobalAlertCount()).resolves.toEqual({
      available: true,
      count: 12345,
      counts: {
        today: 123,
        last7Days: 4567,
        month: 8901,
        total: 12345,
      },
      updatedAt: "2026-06-01T00:00:00.000Z",
      pollIntervalMs: 60000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.maple-timer.com/v1/alert-count",
      {
        method: "GET",
        signal: undefined,
      },
    );
  });

  it("uses a local fallback when the dev server returns the app shell", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<!doctype html><html></html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGlobalAlertCount } = await import("./globalAlertCounter");

    await expect(fetchGlobalAlertCount()).resolves.toMatchObject({
      available: true,
      count: 334773,
      counts: {
        today: 21270,
        last7Days: 334773,
        month: 334773,
        total: 334773,
      },
      updatedAt: null,
      pollIntervalMs: 60000,
    });
  });

  it("batches real alert playback increments without awaiting the request", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ available: true }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { recordGlobalAlertPlayed } = await import("./globalAlertCounter");

    recordGlobalAlertPlayed();
    recordGlobalAlertPlayed();
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.maple-timer.com/v1/alert-count/increment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ count: 2 }),
        keepalive: true,
      }),
    );
  });

  it("adds jitter to playback increment flushes", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ available: true }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { recordGlobalAlertPlayed } = await import("./globalAlertCounter");

    recordGlobalAlertPlayed();

    await vi.advanceTimersByTimeAsync(60 * 1000 + 9_999);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens a circuit breaker when playback increment posts fail", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ available: true }), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { recordGlobalAlertPlayed } = await import("./globalAlertCounter");

    recordGlobalAlertPlayed();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    recordGlobalAlertPlayed();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    recordGlobalAlertPlayed();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.maple-timer.com/v1/alert-count/increment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ count: 1 }),
        keepalive: true,
      }),
    );
  });

  it("opens a circuit breaker when playback increment posts return the app shell", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<!doctype html><html></html>", {
          headers: { "content-type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ available: true }), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { recordGlobalAlertPlayed } = await import("./globalAlertCounter");

    recordGlobalAlertPlayed();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    recordGlobalAlertPlayed();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    recordGlobalAlertPlayed();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
