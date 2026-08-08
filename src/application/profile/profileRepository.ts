import type { KeyValueStorage } from "../../contracts/persistence/keyValueStorage";
import {
  LEGACY_PROFILE_STORAGE_KEY,
  VERSIONED_PROFILE_STORAGE_KEY,
  createProfileStorageEnvelope,
  readProfileStorageEnvelope,
} from "../../contracts/persistence/profileStorageContract";
import type { Profile } from "../../types";
import { createDefaultProfile } from "../../lib/profileFactory";
import { normalizeStoredProfile } from "../../lib/profileMigration";

export type ProfileRepository = {
  load: () => Profile;
  save: (profile: Profile) => void;
};

export function createProfileRepository({
  getStorage,
  now = () => new Date().toISOString(),
}: {
  getStorage: () => KeyValueStorage | null;
  now?: () => string;
}): ProfileRepository {
  return {
    load() {
      const storage = getStorage();
      if (!storage) {
        return createDefaultProfile();
      }

      const versionedProfile = readVersionedStoredProfile(
        storage.getItem(VERSIONED_PROFILE_STORAGE_KEY),
      );
      const legacyProfile = readLegacyStoredProfile(
        storage.getItem(LEGACY_PROFILE_STORAGE_KEY),
      );
      return (
        selectNewestStoredProfile(versionedProfile, legacyProfile) ??
        createDefaultProfile()
      );
    },

    save(profile) {
      const storage = getStorage();
      if (!storage) {
        return;
      }

      const savedAt = now();
      const storedProfile: Profile = {
        ...profile,
        updatedAt: savedAt,
      };
      const previousVersionedValue = storage.getItem(
        VERSIONED_PROFILE_STORAGE_KEY,
      );

      storage.setItem(
        VERSIONED_PROFILE_STORAGE_KEY,
        JSON.stringify(createProfileStorageEnvelope(storedProfile, savedAt)),
      );

      try {
        storage.setItem(
          LEGACY_PROFILE_STORAGE_KEY,
          JSON.stringify(storedProfile),
        );
      } catch (error) {
        restoreVersionedProfile(storage, previousVersionedValue);
        throw error;
      }
    },
  };
}

function readVersionedStoredProfile(raw: string | null): Profile | null {
  if (!raw) {
    return null;
  }

  try {
    const envelope = readProfileStorageEnvelope(JSON.parse(raw));
    return envelope
      ? normalizeStoredProfile(envelope.data.profile as Profile)
      : null;
  } catch {
    return null;
  }
}

function readLegacyStoredProfile(raw: string | null): Profile | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizeStoredProfile(JSON.parse(raw) as Profile);
  } catch {
    return null;
  }
}

function selectNewestStoredProfile(
  versionedProfile: Profile | null,
  legacyProfile: Profile | null,
): Profile | null {
  if (!versionedProfile) {
    return legacyProfile;
  }
  if (!legacyProfile) {
    return versionedProfile;
  }

  const versionedUpdatedAt = Date.parse(versionedProfile.updatedAt);
  const legacyUpdatedAt = Date.parse(legacyProfile.updatedAt);
  if (Number.isFinite(legacyUpdatedAt) && !Number.isFinite(versionedUpdatedAt)) {
    return legacyProfile;
  }
  if (Number.isFinite(legacyUpdatedAt) && legacyUpdatedAt > versionedUpdatedAt) {
    return legacyProfile;
  }
  return versionedProfile;
}

function restoreVersionedProfile(
  storage: KeyValueStorage,
  previousValue: string | null,
): void {
  try {
    if (previousValue === null) {
      storage.removeItem(VERSIONED_PROFILE_STORAGE_KEY);
      return;
    }
    storage.setItem(VERSIONED_PROFILE_STORAGE_KEY, previousValue);
  } catch {
    // Preserve the original storage error when best-effort rollback also fails.
  }
}
