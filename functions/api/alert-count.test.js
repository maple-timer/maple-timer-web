import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestPost } from "./alert-count.js";
import {
  normalizeAlertCountIncrement,
  normalizeAlertCountSeed,
  normalizeAlertPeriodSeed,
} from "./_shared/alert-counter-store.js";

function createD1Mock() {
  const tables = {
    alertCounters: new Map(),
    alertCountDays: new Map(),
  };

  return {
    tables,
    prepare(sql) {
      return {
        bind(...values) {
          return createStatement(sql, values, tables);
        },
        run() {
          return createStatement(sql, [], tables).run();
        },
        first() {
          return createStatement(sql, [], tables).first();
        },
      };
    },
  };
}

function createStatement(sql, values, tables) {
  return {
    async run() {
      if (sql.includes("CREATE TABLE IF NOT EXISTS alert_counters")) {
        return { success: true };
      }

      if (sql.includes("CREATE TABLE IF NOT EXISTS alert_count_days")) {
        return { success: true };
      }

      if (sql.includes("INSERT OR IGNORE INTO alert_counters")) {
        const [id, count, createdAt, updatedAt] = values;
        if (tables.alertCounters.has(id)) {
          return { success: true };
        }
        tables.alertCounters.set(id, {
          id,
          count,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return { success: true };
      }

      if (sql.includes("INSERT OR IGNORE INTO alert_count_days")) {
        const [date, createdAt, updatedAt] = values;
        if (tables.alertCountDays.has(date)) {
          return { success: true };
        }
        tables.alertCountDays.set(date, {
          date,
          count: 0,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return { success: true };
      }

      if (sql.includes("SET count = count + ?")) {
        const [increment, updatedAt, id] = values;
        const table = sql.includes("alert_count_days") ? tables.alertCountDays : tables.alertCounters;
        const row = table.get(id);
        if (row) {
          row.count += increment;
          row.updated_at = updatedAt;
        }
        return { success: true };
      }

      if (sql.includes("SET count = ?, updated_at = ?")) {
        const [count, updatedAt, id, threshold] = values;
        const row = tables.alertCounters.get(id);
        if (row && row.count < threshold) {
          row.count = count;
          row.updated_at = updatedAt;
        }
        return { success: true };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async first() {
      if (sql.includes("SELECT count, updated_at FROM alert_counters")) {
        const [id] = values;
        return tables.alertCounters.get(id) ?? null;
      }

      if (sql.includes("SELECT COALESCE(SUM(count), 0) AS count")) {
        const [startDate, endDate] = values;
        let count = 0;
        for (const row of tables.alertCountDays.values()) {
          if (row.date >= startDate && row.date <= endDate) {
            count += row.count;
          }
        }
        return { count };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

async function readJson(response) {
  return response.json();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("alert count API", () => {
  it("normalizes seed and increment values", () => {
    expect(normalizeAlertCountSeed("1234")).toBe(1234);
    expect(normalizeAlertCountSeed("-4")).toBe(0);
    expect(normalizeAlertCountSeed("nope")).toBe(0);

    expect(normalizeAlertCountIncrement(3)).toBe(3);
    expect(normalizeAlertCountIncrement(1000)).toBe(50);
    expect(normalizeAlertCountIncrement(0)).toBeNull();
    expect(normalizeAlertCountIncrement("bad")).toBeNull();

    expect(normalizeAlertPeriodSeed("313499")).toBe(313499);
    expect(normalizeAlertPeriodSeed("bad", 7)).toBe(7);
  });

  it("reports unavailable when the D1 binding is missing", async () => {
    const response = await onRequestGet({ env: {} });

    expect(response.status).toBe(503);
    await expect(readJson(response)).resolves.toMatchObject({
      available: false,
      pollIntervalMs: 60000,
    });
  });

  it("initializes from the configured seed and increments in batches", async () => {
    const env = {
      REPORTS_DB: createD1Mock(),
      ALERT_COUNT_INITIAL_VALUE: "1200",
      ALERT_COUNT_PERIOD_INITIAL_VALUE: "0",
      ALERT_COUNT_TODAY_INITIAL_VALUE: "0",
    };

    const initial = await onRequestGet({ env });
    expect(initial.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=120");
    await expect(readJson(initial)).resolves.toMatchObject({
      available: true,
      count: 1200,
      pollIntervalMs: 60000,
      counts: {
        total: 1200,
        today: 0,
        last7Days: 0,
        month: 0,
      },
    });

    const incremented = await onRequestPost({
      env,
      request: new Request("https://maple-timer.com/api/alert-count", {
        method: "POST",
        body: JSON.stringify({ count: 7 }),
      }),
    });

    expect(incremented.status).toBe(200);
    await expect(readJson(incremented)).resolves.toMatchObject({
      available: true,
      acceptedCount: 7,
      count: 1207,
      pollIntervalMs: 60000,
      counts: {
        total: 1207,
        today: 7,
        last7Days: 7,
        month: 7,
      },
    });
  });

  it("includes configurable GA period seeds in period counts", async () => {
    const env = {
      REPORTS_DB: createD1Mock(),
      ALERT_COUNT_INITIAL_VALUE: "1200",
      ALERT_COUNT_TODAY_INITIAL_VALUE: "3",
      ALERT_COUNT_LAST7_INITIAL_VALUE: "313499",
      ALERT_COUNT_MONTH_INITIAL_VALUE: "313499",
    };

    const initial = await onRequestGet({ env });
    await expect(readJson(initial)).resolves.toMatchObject({
      available: true,
      count: 313499,
      counts: {
        total: 313499,
        today: 3,
        last7Days: 313499,
        month: 313499,
      },
    });

    const incremented = await onRequestPost({
      env,
      request: new Request("https://maple-timer.com/api/alert-count", {
        method: "POST",
        body: JSON.stringify({ count: 2 }),
      }),
    });

    await expect(readJson(incremented)).resolves.toMatchObject({
      count: 313501,
      counts: {
        total: 313501,
        today: 5,
        last7Days: 313501,
        month: 313501,
      },
    });
  });

  it("includes GA export day seeds in default period counts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T13:00:00.000Z"));

    const env = {
      REPORTS_DB: createD1Mock(),
    };

    const initial = await onRequestGet({ env });
    await expect(readJson(initial)).resolves.toMatchObject({
      available: true,
      count: 331000,
      counts: {
        total: 331000,
        today: 17501,
        last7Days: 331000,
        month: 331000,
      },
    });
  });

  it("keeps the visible total at least as large as seeded period counts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));

    const db = createD1Mock();
    db.tables.alertCounters.set("site-alerts", {
      id: "site-alerts",
      count: 331000,
      created_at: "2026-06-12T11:59:59.000Z",
      updated_at: "2026-06-12T11:59:59.000Z",
    });
    db.tables.alertCountDays.set("2026-06-12", {
      date: "2026-06-12",
      count: 5,
      created_at: "2026-06-12T12:00:00.000Z",
      updated_at: "2026-06-12T12:00:00.000Z",
    });

    const response = await onRequestGet({ env: { REPORTS_DB: db } });

    await expect(readJson(response)).resolves.toMatchObject({
      available: true,
      count: 331005,
      counts: {
        total: 331005,
        today: 5,
        last7Days: 5,
        month: 331005,
      },
    });
  });

  it("keeps the post response total aligned when day counts are ahead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));

    const db = createD1Mock();
    db.tables.alertCounters.set("site-alerts", {
      id: "site-alerts",
      count: 331000,
      created_at: "2026-06-12T11:59:59.000Z",
      updated_at: "2026-06-12T11:59:59.000Z",
    });
    db.tables.alertCountDays.set("2026-06-12", {
      date: "2026-06-12",
      count: 5,
      created_at: "2026-06-12T12:00:00.000Z",
      updated_at: "2026-06-12T12:00:00.000Z",
    });

    const response = await onRequestPost({
      env: { REPORTS_DB: db },
      request: new Request("https://maple-timer.com/api/alert-count", {
        method: "POST",
        body: JSON.stringify({ count: 2 }),
      }),
    });

    await expect(readJson(response)).resolves.toMatchObject({
      available: true,
      acceptedCount: 2,
      count: 331007,
      counts: {
        total: 331007,
        today: 7,
        last7Days: 7,
        month: 331007,
      },
    });
  });

  it("drops GA period seeds when their seed date leaves the requested range", async () => {
    const env = {
      REPORTS_DB: createD1Mock(),
      ALERT_COUNT_INITIAL_VALUE: "1200",
      ALERT_COUNT_PERIOD_INITIAL_VALUE: "313499",
      ALERT_COUNT_PERIOD_INITIAL_DATE: "2026-05-01",
      ALERT_COUNT_TODAY_INITIAL_VALUE: "0",
    };

    const initial = await onRequestGet({ env });
    await expect(readJson(initial)).resolves.toMatchObject({
      counts: {
        total: 1200,
        today: 0,
        last7Days: 0,
        month: 0,
      },
    });
  });

  it("raises an existing lower count when the GA seed is configured later", async () => {
    const env = {
      REPORTS_DB: createD1Mock(),
      ALERT_COUNT_INITIAL_VALUE: "0",
      ALERT_COUNT_PERIOD_INITIAL_VALUE: "0",
    };

    await onRequestPost({
      env,
      request: new Request("https://maple-timer.com/api/alert-count", {
        method: "POST",
        body: JSON.stringify({ count: 4 }),
      }),
    });

    env.ALERT_COUNT_INITIAL_VALUE = "1200";
    const seeded = await onRequestGet({ env });
    await expect(readJson(seeded)).resolves.toMatchObject({
      count: 1200,
    });

    env.ALERT_COUNT_INITIAL_VALUE = "900";
    const lowerSeed = await onRequestGet({ env });
    await expect(readJson(lowerSeed)).resolves.toMatchObject({
      count: 1200,
    });
  });

  it("rejects invalid increments", async () => {
    const response = await onRequestPost({
      env: { REPORTS_DB: createD1Mock() },
      request: new Request("https://maple-timer.com/api/alert-count", {
        method: "POST",
        body: JSON.stringify({ count: 0 }),
      }),
    });

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({ error: "invalid-count" });
  });

  it("keeps concurrent first reads from failing duplicate initialization", async () => {
    const db = createD1Mock();
    let selectCount = 0;
    const env = {
      REPORTS_DB: {
        ...db,
        prepare(sql) {
          const statement = db.prepare(sql);
          if (sql.includes("SELECT count, updated_at FROM alert_counters")) {
            return {
              bind(...values) {
                const bound = statement.bind(...values);
                return {
                  ...bound,
                  async first() {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    selectCount += 1;
                    if (selectCount <= 2) {
                      return null;
                    }
                    return bound.first();
                  },
                };
              },
            };
          }
          return statement;
        },
      },
      ALERT_COUNT_INITIAL_VALUE: "12",
      ALERT_COUNT_PERIOD_INITIAL_VALUE: "0",
    };

    const [first, second] = await Promise.all([
      onRequestGet({ env }),
      onRequestGet({ env }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(readJson(first)).resolves.toMatchObject({ count: 12 });
    await expect(readJson(second)).resolves.toMatchObject({ count: 12 });
  });
});
