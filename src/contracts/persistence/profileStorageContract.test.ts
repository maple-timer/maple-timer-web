import { describe, expect, it } from "vitest";
import {
  LEGACY_PROFILE_STORAGE_KEY,
  PROFILE_STORAGE_SCHEMA,
  PROFILE_STORAGE_VERSION,
  VERSIONED_PROFILE_STORAGE_KEY,
  createProfileStorageEnvelope,
  readProfileStorageEnvelope,
} from "./profileStorageContract";

describe("profileStorageContract", () => {
  it("keeps the legacy key and new envelope key distinct", () => {
    expect(LEGACY_PROFILE_STORAGE_KEY).toBe("maple-hunt-timer.profile.v1");
    expect(VERSIONED_PROFILE_STORAGE_KEY).toBe("maple-hunt-timer.profile.v2");
  });

  it("creates the current profile envelope", () => {
    const profile = { id: "profile", updatedAt: "2026-07-16T00:00:00.000Z" };
    expect(createProfileStorageEnvelope(profile, "2026-07-16T00:00:00.000Z")).toEqual({
      schema: PROFILE_STORAGE_SCHEMA,
      version: PROFILE_STORAGE_VERSION,
      savedAt: "2026-07-16T00:00:00.000Z",
      data: { profile },
    });
  });

  it("reads current and future versions without rejecting known profile data", () => {
    expect(
      readProfileStorageEnvelope({
        schema: PROFILE_STORAGE_SCHEMA,
        version: PROFILE_STORAGE_VERSION,
        savedAt: "2026-07-16T00:00:00.000Z",
        data: { profile: { id: "current", updatedAt: "2026-07-16T00:00:00.000Z" } },
      }),
    ).toMatchObject({ version: 1, data: { profile: { id: "current" } } });
    expect(
      readProfileStorageEnvelope({
        schema: PROFILE_STORAGE_SCHEMA,
        version: 2,
        savedAt: "2026-07-17T00:00:00.000Z",
        data: {
          profile: {
            id: "future",
            updatedAt: "2026-07-17T00:00:00.000Z",
            futureField: true,
          },
        },
      }),
    ).toMatchObject({ version: 2, data: { profile: { id: "future", futureField: true } } });
  });

  it.each([
    null,
    {},
    {
      schema: "other",
      version: 1,
      savedAt: "2026-07-16T00:00:00.000Z",
      data: { profile: { updatedAt: "2026-07-16T00:00:00.000Z" } },
    },
    {
      schema: PROFILE_STORAGE_SCHEMA,
      version: 0,
      savedAt: "2026-07-16T00:00:00.000Z",
      data: { profile: { updatedAt: "2026-07-16T00:00:00.000Z" } },
    },
    {
      schema: PROFILE_STORAGE_SCHEMA,
      version: "1",
      savedAt: "2026-07-16T00:00:00.000Z",
      data: { profile: { updatedAt: "2026-07-16T00:00:00.000Z" } },
    },
    {
      schema: PROFILE_STORAGE_SCHEMA,
      version: 1,
      data: { profile: { updatedAt: "2026-07-16T00:00:00.000Z" } },
    },
    {
      schema: PROFILE_STORAGE_SCHEMA,
      version: 1,
      savedAt: "2026-07-16T00:00:00.000Z",
      data: {},
    },
    {
      schema: PROFILE_STORAGE_SCHEMA,
      version: 1,
      savedAt: "2026-07-16T00:00:00.000Z",
      data: { profile: [] },
    },
    {
      schema: PROFILE_STORAGE_SCHEMA,
      version: 1,
      savedAt: "2026-07-16T00:00:00.000Z",
      data: { profile: {} },
    },
  ])("rejects malformed envelopes", (value) => {
    expect(readProfileStorageEnvelope(value)).toBeNull();
  });
});
