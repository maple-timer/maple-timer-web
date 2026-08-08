import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProfileRepository } from "../../application/profile/profileRepository";
import {
  createDefaultBuffExpiryAlert,
  createDefaultGeneralTimer,
  createDefaultHuntStallAlert,
  createDefaultProfile,
  createDefaultRuneAlert,
  createSkill,
} from "../../lib/storage";
import { STORAGE_KEY } from "../../lib/profileStorageConstants";
import { VERSIONED_PROFILE_STORAGE_KEY } from "../../contracts/persistence/profileStorageContract";
import type { Profile } from "../../types";
import { useProfileState } from "./useProfileState";

const profileRepository = createProfileRepository({
  getStorage: () => localStorage,
});

function storeProfile(profile: Profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function readStoredProfile(): Profile {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new Error("stored profile is missing");
  }
  return JSON.parse(raw) as Profile;
}

function renderProfileState(initialProfile: Profile = createDefaultProfile()) {
  storeProfile(initialProfile);
  return renderHook(() => useProfileState(profileRepository));
}

describe("useProfileState", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("loads the stored profile and keeps storage synchronized after the first effect", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
    const profile = {
      ...createDefaultProfile(),
      id: "profile_stored",
      name: "저장된 프로필",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };

    const { result } = renderProfileState(profile);

    expect(result.current.profile).toMatchObject({
      id: "profile_stored",
      name: "저장된 프로필",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(result.current.profileRef.current).toMatchObject({
      id: "profile_stored",
      name: "저장된 프로필",
    });

    expect(readStoredProfile()).toMatchObject({
      id: "profile_stored",
      name: "저장된 프로필",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
    expect(JSON.parse(localStorage.getItem(VERSIONED_PROFILE_STORAGE_KEY) ?? "null")).toMatchObject({
      schema: "maple-timer.profile",
      version: 1,
      savedAt: "2026-01-02T03:04:05.000Z",
      data: {
        profile: {
          id: "profile_stored",
          name: "저장된 프로필",
          updatedAt: "2026-01-02T03:04:05.000Z",
        },
      },
    });
  });

  it("updates profile data, updatedAt, storage, and profileRef together", () => {
    vi.useFakeTimers();
    const profile = createDefaultProfile();
    const { result } = renderProfileState({
      ...profile,
      name: "변경 전",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-02-03T04:05:06.000Z"));
    act(() => {
      result.current.updateProfile((current) => ({
        ...current,
        name: "변경 후",
        masterVolume: 0.42,
      }));
    });

    expect(result.current.profile).toMatchObject({
      name: "변경 후",
      masterVolume: 0.42,
      updatedAt: "2026-02-03T04:05:06.000Z",
    });
    expect(result.current.profileRef.current).toMatchObject({
      name: "변경 후",
      masterVolume: 0.42,
      updatedAt: "2026-02-03T04:05:06.000Z",
    });
    expect(readStoredProfile()).toMatchObject({
      name: "변경 후",
      masterVolume: 0.42,
      updatedAt: "2026-02-03T04:05:06.000Z",
    });
  });

  it("patches only the requested skill", async () => {
    const firstSkill = createSkill({ id: "skill_first", name: "첫 스킬", enabled: true });
    const secondSkill = createSkill({ id: "skill_second", name: "둘째 스킬", enabled: true });
    const { result } = renderProfileState({
      ...createDefaultProfile(),
      skills: [firstSkill, secondSkill],
    });

    act(() => {
      result.current.updateSkill("skill_first", {
        enabled: false,
        alertThresholdSeconds: 5,
      });
    });

    await waitFor(() =>
      expect(result.current.profile.skills).toEqual([
        expect.objectContaining({
          id: "skill_first",
          enabled: false,
          alertThresholdSeconds: 5,
        }),
        expect.objectContaining({
          id: "skill_second",
          enabled: true,
          alertThresholdSeconds: secondSkill.alertThresholdSeconds,
        }),
      ]),
    );
  });

  it("merges rune alert patches with defaults and existing values", async () => {
    const existingRuneAlert = {
      ...createDefaultRuneAlert(),
      enabled: false,
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      soundId: "미스터리",
      volume: 0.35,
    };
    const { result } = renderProfileState({
      ...createDefaultProfile(),
      runeAlert: existingRuneAlert,
    });

    act(() => {
      result.current.updateRuneAlert({
        enabled: true,
        volume: 0.7,
      });
    });

    await waitFor(() =>
      expect(result.current.profile.runeAlert).toEqual({
        ...existingRuneAlert,
        enabled: true,
        volume: 0.7,
      }),
    );
  });

  it("merges hunt stall alert patches with defaults and existing values", async () => {
    const existingHuntStallAlert = {
      ...createDefaultHuntStallAlert(),
      enabled: true,
      stallThresholdSeconds: 15,
      soundId: "띵동띵동",
      volume: 0.25,
    };
    const { result } = renderProfileState({
      ...createDefaultProfile(),
      huntStallAlert: existingHuntStallAlert,
    });

    act(() => {
      result.current.updateHuntStallAlert({
        enabled: false,
        stallThresholdSeconds: 9,
      });
    });

    await waitFor(() =>
      expect(result.current.profile.huntStallAlert).toEqual({
        ...existingHuntStallAlert,
        enabled: false,
        stallThresholdSeconds: 9,
      }),
    );
  });

  it("merges buff expiry alert patches with defaults and existing values", async () => {
    const existingBuffExpiryAlert = {
      ...createDefaultBuffExpiryAlert(),
      enabled: true,
      alertLeadSeconds: 20,
      soundId: "띵동띵동",
      volume: 0.4,
    };
    const { result } = renderProfileState({
      ...createDefaultProfile(),
      buffExpiryAlert: existingBuffExpiryAlert,
    });

    act(() => {
      result.current.updateBuffExpiryAlert({
        enabled: false,
        alertLeadSeconds: 15,
      });
    });

    await waitFor(() =>
      expect(result.current.profile.buffExpiryAlert).toEqual({
        ...existingBuffExpiryAlert,
        enabled: false,
        alertLeadSeconds: 15,
      }),
    );
  });

  it("adds, updates, and removes general timers", async () => {
    const existingTimer = createDefaultGeneralTimer({ id: "timer_existing", presetId: "20m" });
    const { result } = renderProfileState({
      ...createDefaultProfile(),
      generalTimers: [existingTimer],
    });

    let newTimerId = "";
    act(() => {
      newTimerId = result.current.addGeneralTimer();
    });

    await waitFor(() =>
      expect(result.current.profile.generalTimers).toEqual([
        expect.objectContaining({ id: "timer_existing", presetId: "20m" }),
        expect.objectContaining({ id: newTimerId }),
      ]),
    );

    act(() => {
      result.current.updateGeneralTimer(newTimerId, {
        presetId: "10m",
        volume: 0.55,
      });
    });

    await waitFor(() =>
      expect(result.current.profile.generalTimers).toEqual([
        expect.objectContaining({ id: "timer_existing", presetId: "20m" }),
        expect.objectContaining({ id: newTimerId, presetId: "10m", volume: 0.55 }),
      ]),
    );

    act(() => {
      result.current.removeGeneralTimer("timer_existing");
    });

    await waitFor(() =>
      expect(result.current.profile.generalTimers).toEqual([
        expect.objectContaining({ id: newTimerId, presetId: "10m", volume: 0.55 }),
      ]),
    );
  });

  it("handles legacy profiles without generalTimers in timer actions", async () => {
    const { result } = renderProfileState();

    act(() => {
      result.current.setProfile((current) => ({
        ...current,
        generalTimers: undefined,
      }));
    });

    await waitFor(() => expect(result.current.profile.generalTimers).toBeUndefined());

    let newTimerId = "";
    act(() => {
      newTimerId = result.current.addGeneralTimer();
    });

    await waitFor(() =>
      expect(result.current.profile.generalTimers).toEqual([
        expect.objectContaining({ id: newTimerId }),
      ]),
    );

    act(() => {
      result.current.updateGeneralTimer("missing_timer", { volume: 0.1 });
    });

    await waitFor(() =>
      expect(result.current.profile.generalTimers).toEqual([
        expect.objectContaining({ id: newTimerId }),
      ]),
    );

    act(() => {
      result.current.removeGeneralTimer(newTimerId);
    });

    await waitFor(() => expect(result.current.profile.generalTimers).toEqual([]));
  });
});
