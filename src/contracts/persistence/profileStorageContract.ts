export const PROFILE_STORAGE_SCHEMA = "maple-timer.profile";
export const PROFILE_STORAGE_VERSION = 1;
export const VERSIONED_PROFILE_STORAGE_KEY = "maple-hunt-timer.profile.v2";
export const LEGACY_PROFILE_STORAGE_KEY = "maple-hunt-timer.profile.v1";

export type ProfileStorageEnvelope<TProfile> = {
  schema: typeof PROFILE_STORAGE_SCHEMA;
  version: number;
  savedAt: string;
  data: {
    profile: TProfile;
  };
};

export function createProfileStorageEnvelope<TProfile>(
  profile: TProfile,
  savedAt: string,
): ProfileStorageEnvelope<TProfile> {
  return {
    schema: PROFILE_STORAGE_SCHEMA,
    version: PROFILE_STORAGE_VERSION,
    savedAt,
    data: { profile },
  };
}

export function readProfileStorageEnvelope(
  value: unknown,
): ProfileStorageEnvelope<Record<string, unknown>> | null {
  if (!isRecord(value) || value.schema !== PROFILE_STORAGE_SCHEMA) {
    return null;
  }

  const version = value.version;
  const savedAt = value.savedAt;
  const data = isRecord(value.data) ? value.data : null;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1 ||
    typeof savedAt !== "string" ||
    !savedAt.trim() ||
    !data ||
    !isRecord(data.profile) ||
    typeof data.profile.updatedAt !== "string" ||
    !data.profile.updatedAt.trim()
  ) {
    return null;
  }

  return {
    schema: PROFILE_STORAGE_SCHEMA,
    version,
    savedAt,
    data: { profile: data.profile },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
