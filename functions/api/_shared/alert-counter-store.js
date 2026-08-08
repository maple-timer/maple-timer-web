const COUNTER_ID = "site-alerts";
const MAX_INCREMENT = 50;
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
const DEFAULT_ALERT_COUNT_INITIAL_VALUE = 331_000;
const DEFAULT_ALERT_DAY_SEEDS = Object.freeze({
  "2026-05-27": 46_492,
  "2026-05-28": 51_667,
  "2026-05-29": 62_789,
  "2026-05-30": 76_863,
  "2026-05-31": 75_688,
  "2026-06-01": 17_501,
});

const ensureTablePromises = new WeakMap();

export function isAlertCounterStoreConfigured(env) {
  return Boolean(env.REPORTS_DB);
}

export function normalizeAlertCountSeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

export function normalizeAlertPeriodSeed(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return normalizeAlertCountSeed(fallback);
  }
  return Math.max(0, Math.floor(numeric));
}

export function normalizeAlertCountIncrement(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const count = Math.floor(numeric);
  if (count < 1) {
    return null;
  }

  return Math.min(MAX_INCREMENT, count);
}

export function getAlertCountPollIntervalMs() {
  return DEFAULT_POLL_INTERVAL_MS;
}

function createAlertCounterSnapshot(row, periodCounts, now) {
  const storedTotal = Number(row?.count ?? 0);
  const visibleTotal = Math.max(
    storedTotal,
    Number(periodCounts.today ?? 0),
    Number(periodCounts.last7Days ?? 0),
    Number(periodCounts.month ?? 0),
  );

  return {
    count: visibleTotal,
    counts: {
      ...periodCounts,
      total: visibleTotal,
    },
    updatedAt: row?.updated_at ?? now,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
}

async function ensureAlertCounterTable(env) {
  let ensureTablePromise = ensureTablePromises.get(env.REPORTS_DB);
  if (!ensureTablePromise) {
    ensureTablePromise = Promise.all([
      env.REPORTS_DB.prepare(
        `CREATE TABLE IF NOT EXISTS alert_counters (
          id TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      ).run(),
      env.REPORTS_DB.prepare(
        `CREATE TABLE IF NOT EXISTS alert_count_days (
          date TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      ).run(),
    ])
      .catch((error) => {
        ensureTablePromises.delete(env.REPORTS_DB);
        throw error;
      });
    ensureTablePromises.set(env.REPORTS_DB, ensureTablePromise);
  }

  await ensureTablePromise;
}

async function ensureAlertCounterRow(env, now) {
  const seed = isConfiguredValue(env.ALERT_COUNT_INITIAL_VALUE)
    ? normalizeAlertCountSeed(env.ALERT_COUNT_INITIAL_VALUE)
    : DEFAULT_ALERT_COUNT_INITIAL_VALUE;
  let row = await getAlertCounterRow(env);
  if (!row) {
    await env.REPORTS_DB.prepare(
      `INSERT OR IGNORE INTO alert_counters (
        id, count, created_at, updated_at
      ) VALUES (?, ?, ?, ?)`,
    )
      .bind(COUNTER_ID, seed, now, now)
      .run();
    row = await getAlertCounterRow(env);
  }

  const currentCount = Number(row.count ?? 0);
  if (seed > currentCount) {
    await env.REPORTS_DB.prepare(
      `UPDATE alert_counters
        SET count = ?, updated_at = ?
        WHERE id = ? AND count < ?`,
    )
      .bind(seed, now, COUNTER_ID, seed)
      .run();
    return {
      count: seed,
      updated_at: now,
    };
  }

  return row;
}

async function getAlertCounterRow(env) {
  return env.REPORTS_DB.prepare(
    `SELECT count, updated_at FROM alert_counters WHERE id = ?`,
  )
    .bind(COUNTER_ID)
    .first();
}

export async function readAlertCounter(env) {
  if (!isAlertCounterStoreConfigured(env)) {
    return { configured: false };
  }

  const now = new Date().toISOString();
  await ensureAlertCounterTable(env);
  const row = await ensureAlertCounterRow(env, now);
  const periodCounts = await readAlertPeriodCounts(env, new Date(now));
  return {
    configured: true,
    ...createAlertCounterSnapshot(row, periodCounts, now),
  };
}

export async function incrementAlertCounter(env, count) {
  const increment = normalizeAlertCountIncrement(count);
  if (increment === null) {
    return { error: "invalid-count" };
  }

  if (!isAlertCounterStoreConfigured(env)) {
    return { configured: false };
  }

  const now = new Date().toISOString();
  await ensureAlertCounterTable(env);
  await ensureAlertCounterRow(env, now);
  await incrementAlertDayCounter(env, increment, now);
  await env.REPORTS_DB.prepare(
    `UPDATE alert_counters
      SET count = count + ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(increment, now, COUNTER_ID)
    .run();

  const row = await getAlertCounterRow(env);
  const periodCounts = await readAlertPeriodCounts(env, new Date(now));
  return {
    configured: true,
    acceptedCount: increment,
    ...createAlertCounterSnapshot(row, periodCounts, now),
  };
}

async function incrementAlertDayCounter(env, increment, now) {
  const dateKey = getSeoulDateKey(new Date(now));
  await env.REPORTS_DB.prepare(
    `INSERT OR IGNORE INTO alert_count_days (
      date, count, created_at, updated_at
    ) VALUES (?, 0, ?, ?)`,
  )
    .bind(dateKey, now, now)
    .run();

  await env.REPORTS_DB.prepare(
    `UPDATE alert_count_days
      SET count = count + ?, updated_at = ?
      WHERE date = ?`,
  )
    .bind(increment, now, dateKey)
    .run();
}

async function readAlertPeriodCounts(env, nowDate) {
  const today = getSeoulDateKey(nowDate);
  const last7Start = addDaysToDateKey(today, -6);
  const last30Start = addDaysToDateKey(today, -29);
  const seeds = getAlertPeriodSeeds(env, { today, last7Start, last30Start });
  const [todayCount, last7DaysCount, monthCount] = await Promise.all([
    getAlertDaySum(env, today, today),
    getAlertDaySum(env, last7Start, today),
    getAlertDaySum(env, last30Start, today),
  ]);

  return {
    today: seeds.today + todayCount,
    last7Days: seeds.last7Days + last7DaysCount,
    month: seeds.month + monthCount,
  };
}

async function getAlertDaySum(env, startDate, endDate) {
  const row = await env.REPORTS_DB.prepare(
    `SELECT COALESCE(SUM(count), 0) AS count
      FROM alert_count_days
      WHERE date >= ? AND date <= ?`,
  )
    .bind(startDate, endDate)
    .first();
  return Number(row?.count ?? 0);
}

function getAlertPeriodSeeds(env, ranges) {
  const daySeeds = {
    today: sumDefaultAlertDaySeeds(ranges.today, ranges.today),
    last7Days: sumDefaultAlertDaySeeds(ranges.last7Start, ranges.today),
    month: sumDefaultAlertDaySeeds(ranges.last30Start, ranges.today),
  };
  const legacySharedSeed = getConfiguredAlertPeriodSeed(env.ALERT_COUNT_PERIOD_INITIAL_VALUE);
  const legacySeedDate = normalizeDateKey(env.ALERT_COUNT_PERIOD_INITIAL_DATE, ranges.today);
  const legacyLast7Seed =
    legacySharedSeed === null
      ? null
      : isDateKeyInRange(legacySeedDate, ranges.last7Start, ranges.today)
        ? legacySharedSeed
        : 0;
  const legacyMonthSeed =
    legacySharedSeed === null
      ? null
      : isDateKeyInRange(legacySeedDate, ranges.last30Start, ranges.today)
        ? legacySharedSeed
        : 0;
  return {
    today: getAlertPeriodSeed(env.ALERT_COUNT_TODAY_INITIAL_VALUE, daySeeds.today),
    last7Days: getAlertPeriodSeed(
      env.ALERT_COUNT_LAST7_INITIAL_VALUE,
      legacyLast7Seed ?? daySeeds.last7Days,
    ),
    month: getAlertPeriodSeed(env.ALERT_COUNT_MONTH_INITIAL_VALUE, legacyMonthSeed ?? daySeeds.month),
  };
}

function getConfiguredAlertPeriodSeed(value) {
  return isConfiguredValue(value) ? normalizeAlertPeriodSeed(value) : null;
}

function getAlertPeriodSeed(value, fallback) {
  return isConfiguredValue(value) ? normalizeAlertPeriodSeed(value) : fallback;
}

function isConfiguredValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function sumDefaultAlertDaySeeds(startDate, endDate) {
  let total = 0;
  for (const [dateKey, count] of Object.entries(DEFAULT_ALERT_DAY_SEEDS)) {
    if (dateKey >= startDate && dateKey <= endDate) {
      total += count;
    }
  }
  return total;
}

function getSeoulDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function normalizeDateKey(value, fallback) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function isDateKeyInRange(dateKey, startDate, endDate) {
  return dateKey >= startDate && dateKey <= endDate;
}
