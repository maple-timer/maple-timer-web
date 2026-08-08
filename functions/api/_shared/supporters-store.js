export const SUPPORTERS_KV_KEY = "supporters:list";

export const SUPPORTER_WORLDS = Object.freeze({
  scania: "스카니아",
  bera: "베라",
  luna: "루나",
  zenith: "제니스",
  croa: "크로아",
  union: "유니온",
  elysium: "엘리시움",
  enosis: "이노시스",
  red: "레드",
  aurora: "오로라",
  arcane: "아케인",
  nova: "노바",
  eos: "에오스",
  helios: "헬리오스",
  burning: "버닝",
  challengers: "챌린저스",
});

const MAX_SUPPORTERS = 80;
const MAX_NICKNAME_LENGTH = 24;

export function isSupportersStoreConfigured(env) {
  return Boolean(env.SUPPORTERS);
}

export function normalizeSupportersPayload(input) {
  const payload = Array.isArray(input) ? { supporters: input } : input;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "invalid-payload" };
  }

  if (!Array.isArray(payload.supporters)) {
    return { error: "invalid-supporters" };
  }

  if (payload.supporters.length > MAX_SUPPORTERS) {
    return { error: "too-many-supporters" };
  }

  const supporters = [];
  const seen = new Set();
  for (const rawSupporter of payload.supporters) {
    const supporter = normalizeSupporter(rawSupporter);
    if (!supporter) {
      return { error: "invalid-supporter" };
    }

    const key = `${supporter.worldId}:${supporter.nickname}`;
    if (seen.has(key)) {
      return { error: "duplicate-supporter" };
    }
    seen.add(key);
    supporters.push(supporter);
  }

  return {
    supporters,
    updatedAt: normalizeUpdatedAt(payload.updatedAt),
  };
}

export async function readSupporters(env) {
  if (!isSupportersStoreConfigured(env)) {
    return { configured: false };
  }

  const rawValue = await env.SUPPORTERS.get(SUPPORTERS_KV_KEY);
  if (!rawValue) {
    return {
      configured: true,
      supporters: [],
      updatedAt: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return { configured: true, error: "invalid-json" };
  }

  const normalized = normalizeSupportersPayload(parsed);
  if (normalized.error) {
    return { configured: true, error: normalized.error };
  }

  return {
    configured: true,
    supporters: normalized.supporters,
    updatedAt: normalized.updatedAt,
  };
}

function normalizeSupporter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const worldId = String(input.worldId ?? "").trim();
  const worldName = SUPPORTER_WORLDS[worldId];
  const nickname = String(input.nickname ?? "").trim();

  if (!worldName || !nickname || nickname.length > MAX_NICKNAME_LENGTH) {
    return null;
  }

  return {
    worldId,
    worldName,
    nickname,
  };
}

function normalizeUpdatedAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}
