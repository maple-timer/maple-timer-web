import { afterEach, describe, expect, it, vi } from "vitest";
import { flushApiUsage, recordApiUsage } from "./api-usage-log.js";

describe("api usage logging", () => {
  afterEach(() => {
    flushApiUsage();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("flushes endpoint and method counts as a structured log", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    recordApiUsage(new Request("https://maple-timer.com/api/alert-count"), "/api/alert-count");
    vi.setSystemTime(new Date("2026-06-22T00:01:01.000Z"));
    recordApiUsage(new Request("https://maple-timer.com/api/supporters"), "/api/supporters");

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0][0]));
    expect(payload).toMatchObject({
      kind: "maple_timer_api_usage",
      counts: {
        "GET /api/alert-count": 1,
        "GET /api/supporters": 1,
      },
    });
  });
});
