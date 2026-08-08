import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSnapshot } from "../../../alertTypes";
import type { AlertDisableSnapshot } from "../../../lib/alertDisableSnapshot";
import { trackFeatureToggle } from "../../../lib/analyticsEvents";
import {
  createDefaultBuffExpiryAlert,
  createDefaultBoosterExpiryAlert,
  createDefaultGeneralTimer,
  createDefaultHuntStallAlert,
  createDefaultProfile,
  createDefaultRuneAlert,
  createDefaultSpecialCoreAlert,
  createDefaultUltimaRaidEquipmentAlert,
  createSkill,
} from "../../../lib/storage";
import { createRuntimeState } from "../../../lib/timer";
import type { Profile, SkillRuntimeState } from "../../../types";
import { useAlertControlsController } from "./useAlertControlsController";

vi.mock("../../../lib/analyticsEvents", () => ({
  trackFeatureToggle: vi.fn(),
}));

type HookApi = ReturnType<typeof useAlertControlsController>;

type HarnessApi = HookApi & {
  profileRef: MutableRefObject<Profile>;
  runtimeRef: MutableRefObject<Record<string, SkillRuntimeState>>;
  snapshotsRef: MutableRefObject<Record<string, SkillSnapshot>>;
  alertDisableSnapshotRef: MutableRefObject<AlertDisableSnapshot | null>;
  resetRuneDetection: ReturnType<typeof vi.fn>;
  resetUltimaRaidEquipmentDetection: ReturnType<typeof vi.fn>;
  resetHuntStallDetection: ReturnType<typeof vi.fn>;
  resetBuffExpiryDetection: ReturnType<typeof vi.fn>;
  resetBoosterExpiryDetection: ReturnType<typeof vi.fn>;
  resetSpecialCoreDetection: ReturnType<typeof vi.fn>;
  retimeSpecialCoreDetection: ReturnType<typeof vi.fn>;
  messagesRef: MutableRefObject<string[]>;
};

const trackFeatureToggleMock = vi.mocked(trackFeatureToggle);

function createSnapshot(): SkillSnapshot {
  return {
    result: {
      value: 10,
      confidence: 0.9,
    },
    sampledAt: 1_000,
    rawPreviewUrl: "raw",
    previewUrl: "processed",
    regionLabel: "10x10",
  };
}

function createRunningRuntime(skillId: string): SkillRuntimeState {
  return {
    ...createRuntimeState(skillId),
    observedRemainingSeconds: 20,
    observedAt: 1_000,
    estimatedExpiresAt: 21_000,
    confidence: 0.95,
    status: "running",
    lastAlertCycleStartedAt: 1_000,
  };
}

function createAlertedRuntime(skillId: string): SkillRuntimeState {
  return {
    ...createRunningRuntime(skillId),
    status: "alerted",
    alertedAt: 2_000,
    lastRepeatedAlertAt: null,
  };
}

function getHookApi(apiRef: { current: HarnessApi | null }): HarnessApi {
  if (!apiRef.current) {
    throw new Error("hook api is not ready");
  }
  return apiRef.current;
}

function AlertControlsHarness({
  initialProfile,
  initialRuntimeStates = {},
  initialSnapshots = {},
  onReady,
}: {
  initialProfile: Profile;
  initialRuntimeStates?: Record<string, SkillRuntimeState>;
  initialSnapshots?: Record<string, SkillSnapshot>;
  onReady: (api: HarnessApi) => void;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const [runtimeStates, setRuntimeStatesState] = useState(initialRuntimeStates);
  const runtimeRef = useRef(runtimeStates);
  runtimeRef.current = runtimeStates;

  const [snapshots, setSnapshotsState] = useState(initialSnapshots);
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  const alertDisableSnapshotRef = useRef<AlertDisableSnapshot | null>(null);
  const messagesRef = useRef<string[]>([]);
  const resetRuneDetection = useRef(vi.fn()).current;
  const resetUltimaRaidEquipmentDetection = useRef(vi.fn()).current;
  const resetHuntStallDetection = useRef(vi.fn()).current;
  const resetBuffExpiryDetection = useRef(vi.fn()).current;
  const resetBoosterExpiryDetection = useRef(vi.fn()).current;
  const resetSpecialCoreDetection = useRef(vi.fn()).current;
  const retimeSpecialCoreDetection = useRef(vi.fn()).current;

  const updateProfile = useCallback((updater: (current: Profile) => Profile) => {
    setProfile((current) => {
      const next = updater(current);
      profileRef.current = next;
      return next;
    });
  }, []);

  const updateSkill = useCallback(
    (skillId: string, patch: Partial<Profile["skills"][number]>) => {
      updateProfile((current) => ({
        ...current,
        skills: current.skills.map((skill) =>
          skill.id === skillId ? { ...skill, ...patch } : skill,
        ),
      }));
    },
    [updateProfile],
  );

  const updateRuneAlert = useCallback(
    (patch: Partial<NonNullable<Profile["runeAlert"]>>) => {
      updateProfile((current) => ({
        ...current,
        runeAlert: {
          ...createDefaultRuneAlert(),
          ...(current.runeAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateUltimaRaidEquipmentAlert = useCallback(
    (
      patch: Partial<
        NonNullable<Profile["ultimaRaidEquipmentAlert"]>
      >,
    ) => {
      updateProfile((current) => ({
        ...current,
        ultimaRaidEquipmentAlert: {
          ...createDefaultUltimaRaidEquipmentAlert(),
          ...(current.ultimaRaidEquipmentAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateHuntStallAlert = useCallback(
    (patch: Partial<NonNullable<Profile["huntStallAlert"]>>) => {
      updateProfile((current) => ({
        ...current,
        huntStallAlert: {
          ...createDefaultHuntStallAlert(),
          ...(current.huntStallAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateBuffExpiryAlert = useCallback(
    (patch: Partial<NonNullable<Profile["buffExpiryAlert"]>>) => {
      updateProfile((current) => ({
        ...current,
        buffExpiryAlert: {
          ...createDefaultProfile().buffExpiryAlert!,
          ...(current.buffExpiryAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateBoosterExpiryAlert = useCallback(
    (patch: Partial<NonNullable<Profile["boosterExpiryAlert"]>>) => {
      updateProfile((current) => ({
        ...current,
        boosterExpiryAlert: {
          ...createDefaultBoosterExpiryAlert(),
          ...(current.boosterExpiryAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateSpecialCoreAlert = useCallback(
    (patch: Partial<NonNullable<Profile["specialCoreAlert"]>>) => {
      updateProfile((current) => ({
        ...current,
        specialCoreAlert: {
          ...createDefaultSpecialCoreAlert(),
          ...(current.specialCoreAlert ?? {}),
          ...patch,
        },
      }));
    },
    [updateProfile],
  );

  const updateGeneralTimer = useCallback(
    (timerId: string, patch: Partial<NonNullable<Profile["generalTimers"]>[number]>) => {
      updateProfile((current) => ({
        ...current,
        generalTimers: (current.generalTimers ?? []).map((timer) =>
          timer.id === timerId ? { ...timer, ...patch } : timer,
        ),
      }));
    },
    [updateProfile],
  );

  const setRuntimeStates: Dispatch<SetStateAction<Record<string, SkillRuntimeState>>> =
    useCallback((updater) => {
      setRuntimeStatesState((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        runtimeRef.current = next;
        return next;
      });
    }, []);

  const setSnapshots: Dispatch<SetStateAction<Record<string, SkillSnapshot>>> =
    useCallback((updater) => {
      setSnapshotsState((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        snapshotsRef.current = next;
        return next;
      });
    }, []);

  const activateAlertDisableSnapshot = useCallback((snapshot: AlertDisableSnapshot) => {
    alertDisableSnapshotRef.current = snapshot;
  }, []);

  const clearAlertDisableSnapshotState = useCallback(() => {
    alertDisableSnapshotRef.current = null;
  }, []);

  const setMessage = useCallback((message: string) => {
    messagesRef.current.push(message);
  }, []);

  const api = useAlertControlsController({
    profileRef,
    alertDisableSnapshotRef,
    activateAlertDisableSnapshot,
    clearAlertDisableSnapshotState,
    updateProfile,
    updateSkill,
    updateRuneAlert,
    updateUltimaRaidEquipmentAlert,
    updateHuntStallAlert,
    updateBuffExpiryAlert,
    updateBoosterExpiryAlert,
    updateSpecialCoreAlert,
    updateGeneralTimer,
    runtimeRef,
    setRuntimeStates,
    setSnapshots,
    resetRuneDetection,
    resetUltimaRaidEquipmentDetection,
    resetHuntStallDetection,
    resetBuffExpiryDetection,
    resetBoosterExpiryDetection,
    resetSpecialCoreDetection,
    retimeSpecialCoreDetection,
    setMessage,
  });

  useEffect(() => {
    onReady({
      ...api,
      profileRef,
      runtimeRef,
      snapshotsRef,
      alertDisableSnapshotRef,
      resetRuneDetection,
      resetUltimaRaidEquipmentDetection,
      resetHuntStallDetection,
      resetBuffExpiryDetection,
      resetBoosterExpiryDetection,
      resetSpecialCoreDetection,
      retimeSpecialCoreDetection,
      messagesRef,
    });
  }, [
    api,
    alertDisableSnapshotRef,
    messagesRef,
    onReady,
    profileRef,
    resetHuntStallDetection,
    resetBuffExpiryDetection,
    resetBoosterExpiryDetection,
    resetSpecialCoreDetection,
    retimeSpecialCoreDetection,
    resetRuneDetection,
    resetUltimaRaidEquipmentDetection,
    runtimeRef,
    snapshotsRef,
  ]);

  return null;
}

describe("useAlertControlsController", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("resets skill runtime, clears snapshots, and tracks enabled changes", async () => {
    const skill = createSkill({ id: "skill_fountain", enabled: true });
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{ ...createDefaultProfile(), skills: [skill] }}
        initialRuntimeStates={{ [skill.id]: createRunningRuntime(skill.id) }}
        initialSnapshots={{ [skill.id]: createSnapshot() }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).changeSkill(skill.id, { enabled: false });
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).profileRef.current.skills[0].enabled).toBe(false);
      expect(getHookApi(apiRef).runtimeRef.current[skill.id]?.status).toBe("idle");
      expect(getHookApi(apiRef).runtimeRef.current[skill.id]?.estimatedExpiresAt).toBeNull();
      expect(getHookApi(apiRef).snapshotsRef.current[skill.id]).toBeUndefined();
    });
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("skill", false);
  });

  it("marks repeat alert timing dirty when repeat settings change after an alert", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));

    const skill = createSkill({ id: "skill_repeat", enabled: true });
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{ ...createDefaultProfile(), skills: [skill] }}
        initialRuntimeStates={{ [skill.id]: createAlertedRuntime(skill.id) }}
        initialSnapshots={{ [skill.id]: createSnapshot() }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).changeSkill(skill.id, { repeatAlertEnabled: true });
    });

    expect(getHookApi(apiRef).runtimeRef.current[skill.id]?.lastRepeatedAlertAt).toBe(
      Date.now(),
    );
    expect(getHookApi(apiRef).snapshotsRef.current[skill.id]).toBeDefined();
  });

  it("routes feature, general timer, and volume setting updates", async () => {
    const timer = createDefaultGeneralTimer({ id: "timer_1", enabled: true });
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{
          ...createDefaultProfile(),
          runeAlert: { ...createDefaultRuneAlert(), enabled: true },
          ultimaRaidEquipmentAlert: {
            ...createDefaultUltimaRaidEquipmentAlert(),
            enabled: true,
          },
          huntStallAlert: { ...createDefaultHuntStallAlert(), enabled: false },
          buffExpiryAlert: { ...createDefaultBuffExpiryAlert(), enabled: true },
          boosterExpiryAlert: { ...createDefaultBoosterExpiryAlert(), enabled: true },
          generalTimers: [timer],
          masterVolume: 1,
          alertDefaults: {
            ...createDefaultProfile().alertDefaults,
            volume: 1,
          },
        }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).changeRuneAlert({ enabled: false });
      getHookApi(apiRef).changeUltimaRaidEquipmentAlert({ enabled: false });
      getHookApi(apiRef).changeHuntStallAlert({ enabled: true });
      getHookApi(apiRef).changeBuffExpiryAlert({ enabled: false, alertLeadSeconds: 20 });
      getHookApi(apiRef).changeBoosterExpiryAlert({ enabled: false, alertLeadSeconds: 12 });
      getHookApi(apiRef).changeGeneralTimer(timer.id, { enabled: false });
      getHookApi(apiRef).updateMasterVolume(2);
      getHookApi(apiRef).updateDefaultAlertVolume(0.3);
    });

    await waitFor(() => {
      const profile = getHookApi(apiRef).profileRef.current;
      expect(profile.runeAlert?.enabled).toBe(false);
      expect(profile.ultimaRaidEquipmentAlert?.enabled).toBe(false);
      expect(profile.huntStallAlert?.enabled).toBe(true);
      expect(profile.buffExpiryAlert?.enabled).toBe(false);
      expect(profile.buffExpiryAlert?.alertLeadSeconds).toBe(20);
      expect(profile.boosterExpiryAlert?.enabled).toBe(false);
      expect(profile.boosterExpiryAlert?.alertLeadSeconds).toBe(12);
      expect(profile.generalTimers?.[0]?.enabled).toBe(false);
      expect(profile.masterVolume).toBe(1);
      expect(profile.alertDefaults.volume).toBe(0.3);
    });
    expect(getHookApi(apiRef).resetRuneDetection).toHaveBeenCalledTimes(1);
    expect(
      getHookApi(apiRef).resetUltimaRaidEquipmentDetection,
    ).toHaveBeenCalledTimes(1);
    expect(getHookApi(apiRef).resetHuntStallDetection).toHaveBeenCalledTimes(1);
    expect(getHookApi(apiRef).resetHuntStallDetection).toHaveBeenCalledWith("enabled");
    expect(getHookApi(apiRef).resetBuffExpiryDetection).toHaveBeenCalledTimes(1);
    expect(getHookApi(apiRef).resetBoosterExpiryDetection).toHaveBeenCalledTimes(1);
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("rune", false);
    expect(trackFeatureToggleMock).toHaveBeenCalledWith(
      "ultima_raid_equipment",
      false,
    );
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("hunt_stall", true);
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("buff_expiry", false);
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("booster_expiry", false);
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("general_timer", false);
  });

  it("preserves both Ultima Squad runtime states for sound and volume changes", async () => {
    const apiRef: { current: HarnessApi | null } = { current: null };
    const ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      bossAlert: {
        ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
        enabled: true,
      },
    };

    render(
      <AlertControlsHarness
        initialProfile={{
          ...createDefaultProfile(),
          ultimaRaidEquipmentAlert,
        }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).changeUltimaRaidEquipmentAlert({
        ...ultimaRaidEquipmentAlert,
        soundId: "equipment-sound",
        volume: 0.7,
      });
    });

    await waitFor(() => {
      expect(
        getHookApi(apiRef).profileRef.current.ultimaRaidEquipmentAlert
          ?.soundId,
      ).toBe("equipment-sound");
    });

    const currentBossAlert =
      getHookApi(apiRef).profileRef.current.ultimaRaidEquipmentAlert!
        .bossAlert;
    act(() => {
      getHookApi(apiRef).changeUltimaRaidEquipmentAlert({
        bossAlert: {
          ...currentBossAlert,
          soundId: "boss-sound",
          volume: 0.6,
        },
      });
    });

    await waitFor(() => {
      expect(
        getHookApi(apiRef).profileRef.current.ultimaRaidEquipmentAlert
          ?.bossAlert.soundId,
      ).toBe("boss-sound");
    });
    expect(
      getHookApi(apiRef).resetUltimaRaidEquipmentDetection,
    ).not.toHaveBeenCalled();
    expect(trackFeatureToggleMock).not.toHaveBeenCalledWith(
      "ultima_raid_equipment",
      true,
    );
    expect(trackFeatureToggleMock).not.toHaveBeenCalledWith(
      "ultima_raid_boss",
      true,
    );
  });

  it("does not reset buff expiry detection when only the alert lead changes", async () => {
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{
          ...createDefaultProfile(),
          buffExpiryAlert: { ...createDefaultBuffExpiryAlert(), enabled: true, alertLeadSeconds: 30 },
        }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).changeBuffExpiryAlert({ alertLeadSeconds: 12 });
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).profileRef.current.buffExpiryAlert?.alertLeadSeconds).toBe(12);
    });
    expect(getHookApi(apiRef).resetBuffExpiryDetection).not.toHaveBeenCalled();
  });

  it("retimes special core detection when timing inputs change", async () => {
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{
          ...createDefaultProfile(),
          specialCoreAlert: {
            ...createDefaultSpecialCoreAlert(),
            enabled: true,
            cooldownSeconds: 30,
            alertLeadSeconds: 5,
          },
        }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).changeSpecialCoreAlert({ cooldownSeconds: 45 });
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).profileRef.current.specialCoreAlert?.cooldownSeconds).toBe(45);
    });
    expect(getHookApi(apiRef).resetSpecialCoreDetection).not.toHaveBeenCalled();
    expect(getHookApi(apiRef).retimeSpecialCoreDetection).toHaveBeenCalledWith(
      expect.objectContaining({
        cooldownSeconds: 45,
        alertLeadSeconds: 5,
      }),
    );

    act(() => {
      getHookApi(apiRef).changeSpecialCoreAlert({ enabled: false });
    });

    expect(getHookApi(apiRef).resetSpecialCoreDetection).toHaveBeenCalledTimes(1);
    expect(getHookApi(apiRef).retimeSpecialCoreDetection).toHaveBeenCalledTimes(1);
  });

  it("disables and restores all alerts from a snapshot", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-20T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    const enabledSkill = createSkill({ id: "skill_enabled", enabled: true });
    const disabledSkill = createSkill({ id: "skill_disabled", enabled: false });
    const endedTimer = createDefaultGeneralTimer({
      id: "timer_ended",
      enabled: true,
      endsAt: now - 1_000,
      alertedAt: null,
    });
    const disabledTimer = createDefaultGeneralTimer({
      id: "timer_disabled",
      enabled: false,
      endsAt: now + 10_000,
      alertedAt: null,
    });
    const runningTimer = createDefaultGeneralTimer({
      id: "timer_running",
      enabled: true,
      startedAt: now - 5_000,
      endsAt: now + 75_000,
      alertedAt: null,
    });
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{
          ...createDefaultProfile(),
          skills: [enabledSkill, disabledSkill],
          runeAlert: { ...createDefaultRuneAlert(), enabled: true },
          ultimaRaidEquipmentAlert: {
            ...createDefaultUltimaRaidEquipmentAlert(),
            enabled: true,
          },
          huntStallAlert: { ...createDefaultHuntStallAlert(), enabled: true },
          buffExpiryAlert: { ...createDefaultBuffExpiryAlert(), enabled: true },
          boosterExpiryAlert: { ...createDefaultBoosterExpiryAlert(), enabled: true },
          specialCoreAlert: { ...createDefaultSpecialCoreAlert(), enabled: true },
          generalTimers: [endedTimer, disabledTimer, runningTimer],
        }}
        initialRuntimeStates={{
          [enabledSkill.id]: createRunningRuntime(enabledSkill.id),
          [disabledSkill.id]: createRunningRuntime(disabledSkill.id),
        }}
        initialSnapshots={{ [enabledSkill.id]: createSnapshot() }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).setAllAlertsDisabled(true);
    });

    const disabledApi = getHookApi(apiRef);
    expect(disabledApi.profileRef.current.skills.map((skill) => skill.enabled)).toEqual([
      false,
      false,
    ]);
    expect(disabledApi.profileRef.current.runeAlert?.enabled).toBe(false);
    expect(
      disabledApi.profileRef.current.ultimaRaidEquipmentAlert?.enabled,
    ).toBe(false);
    expect(disabledApi.profileRef.current.huntStallAlert?.enabled).toBe(false);
    expect(disabledApi.profileRef.current.buffExpiryAlert?.enabled).toBe(false);
    expect(disabledApi.profileRef.current.boosterExpiryAlert?.enabled).toBe(false);
    expect(disabledApi.profileRef.current.specialCoreAlert?.enabled).toBe(false);
    expect(disabledApi.profileRef.current.generalTimers?.map((timer) => timer.enabled)).toEqual([
      false,
      false,
      false,
    ]);
    expect(disabledApi.profileRef.current.generalTimers?.[2]).toEqual(
      expect.objectContaining({
        endsAt: null,
        remainingSecondsAtPause: 75,
      }),
    );
    expect(disabledApi.alertDisableSnapshotRef.current?.skills).toEqual({
      [enabledSkill.id]: true,
      [disabledSkill.id]: false,
    });
    expect(disabledApi.alertDisableSnapshotRef.current?.generalTimerRunning).toEqual({
      timer_ended: false,
      timer_disabled: false,
      timer_running: true,
    });
    expect(disabledApi.runtimeRef.current[enabledSkill.id]?.status).toBe("paused");
    expect(disabledApi.snapshotsRef.current).toEqual({});
    expect(disabledApi.resetRuneDetection).toHaveBeenCalledTimes(1);
    expect(
      disabledApi.resetUltimaRaidEquipmentDetection,
    ).toHaveBeenCalledTimes(1);
    expect(disabledApi.resetHuntStallDetection).toHaveBeenCalledTimes(1);
    expect(disabledApi.resetHuntStallDetection).toHaveBeenLastCalledWith("global-disabled");
    expect(disabledApi.resetBuffExpiryDetection).toHaveBeenCalledTimes(1);
    expect(disabledApi.resetBoosterExpiryDetection).toHaveBeenCalledTimes(1);
    expect(disabledApi.resetBoosterExpiryDetection).toHaveBeenLastCalledWith(
      "global-disabled",
    );
    expect(disabledApi.resetSpecialCoreDetection).toHaveBeenCalledTimes(1);
    expect(disabledApi.messagesRef.current).toContain("모든 알림을 비활성화했습니다.");
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("all_alerts", false);

    const restoredAt = now + 20_000;
    vi.setSystemTime(restoredAt);

    act(() => {
      getHookApi(apiRef).setAllAlertsDisabled(false);
    });

    const restoredApi = getHookApi(apiRef);
    const restoredProfile = restoredApi.profileRef.current;
    expect(restoredProfile.skills.map((skill) => skill.enabled)).toEqual([true, false]);
    expect(restoredProfile.runeAlert?.enabled).toBe(true);
    expect(restoredProfile.ultimaRaidEquipmentAlert?.enabled).toBe(true);
    expect(restoredProfile.huntStallAlert?.enabled).toBe(true);
    expect(restoredProfile.buffExpiryAlert?.enabled).toBe(true);
    expect(restoredProfile.boosterExpiryAlert?.enabled).toBe(true);
    expect(restoredProfile.specialCoreAlert?.enabled).toBe(true);
    expect(restoredProfile.generalTimers?.map((timer) => timer.enabled)).toEqual([
      true,
      false,
      true,
    ]);
    expect(restoredProfile.generalTimers?.[0]?.alertedAt).toBe(restoredAt);
    // The disable paused this timer with 75s left, so re-enabling resumes it
    // from that remaining time instead of leaving it paused.
    expect(restoredProfile.generalTimers?.[2]).toEqual(
      expect.objectContaining({
        enabled: true,
        startedAt: restoredAt,
        endsAt: restoredAt + 75_000,
        remainingSecondsAtPause: null,
        alertedAt: null,
      }),
    );
    expect(restoredApi.alertDisableSnapshotRef.current).toBeNull();
    expect(restoredApi.runtimeRef.current[enabledSkill.id]?.status).toBe("idle");
    expect(restoredApi.resetRuneDetection).toHaveBeenCalledTimes(2);
    expect(
      restoredApi.resetUltimaRaidEquipmentDetection,
    ).toHaveBeenCalledTimes(2);
    expect(restoredApi.resetHuntStallDetection).toHaveBeenCalledTimes(2);
    expect(restoredApi.resetHuntStallDetection).toHaveBeenLastCalledWith("enabled");
    expect(restoredApi.resetBuffExpiryDetection).toHaveBeenCalledTimes(2);
    expect(restoredApi.resetBoosterExpiryDetection).toHaveBeenCalledTimes(2);
    expect(restoredApi.resetBoosterExpiryDetection).toHaveBeenLastCalledWith(
      "enabled",
    );
    expect(restoredApi.resetSpecialCoreDetection).toHaveBeenCalledTimes(2);
    expect(restoredApi.messagesRef.current).toContain("비활성화 전 상태로 복구했습니다.");
    expect(trackFeatureToggleMock).toHaveBeenCalledWith("all_alerts", true);
  });

  it("resumes only the general timers the disable paused", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-20T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    const runningTimer = createDefaultGeneralTimer({
      id: "timer_running",
      enabled: true,
      startedAt: now - 5_000,
      endsAt: now + 60_000,
      alertedAt: null,
    });
    const manuallyPausedTimer = createDefaultGeneralTimer({
      id: "timer_paused",
      enabled: true,
      startedAt: now - 30_000,
      endsAt: null,
      remainingSecondsAtPause: 42,
      alertedAt: null,
    });
    const idleTimer = createDefaultGeneralTimer({
      id: "timer_idle",
      enabled: true,
      startedAt: null,
      endsAt: null,
      alertedAt: null,
    });
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{
          ...createDefaultProfile(),
          skills: [],
          generalTimers: [runningTimer, manuallyPausedTimer, idleTimer],
        }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).setAllAlertsDisabled(true);
    });

    const restoredAt = now + 600_000;
    vi.setSystemTime(restoredAt);
    act(() => {
      getHookApi(apiRef).setAllAlertsDisabled(false);
    });

    const timers = getHookApi(apiRef).profileRef.current.generalTimers ?? [];
    // Running before the disable: resumes with the time it had left, and the
    // ten minutes spent disabled do not count against it.
    expect(timers[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        startedAt: restoredAt,
        endsAt: restoredAt + 60_000,
        remainingSecondsAtPause: null,
      }),
    );
    // Paused by the user beforehand: stays paused, keeping its remaining time.
    expect(timers[1]).toEqual(
      expect.objectContaining({
        enabled: true,
        endsAt: null,
        remainingSecondsAtPause: 42,
      }),
    );
    // Never started: stays idle.
    expect(timers[2]).toEqual(
      expect.objectContaining({
        enabled: true,
        startedAt: null,
        endsAt: null,
        remainingSecondsAtPause: null,
      }),
    );
  });

  it("keeps a general timer paused when it was disabled before the global switch", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-20T00:00:00.000Z").getTime();
    vi.setSystemTime(now);

    const offTimer = createDefaultGeneralTimer({
      id: "timer_off",
      enabled: false,
      startedAt: now - 5_000,
      endsAt: now + 30_000,
      alertedAt: null,
    });
    const apiRef: { current: HarnessApi | null } = { current: null };

    render(
      <AlertControlsHarness
        initialProfile={{
          ...createDefaultProfile(),
          skills: [],
          generalTimers: [offTimer],
        }}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).setAllAlertsDisabled(true);
    });
    vi.setSystemTime(now + 10_000);
    act(() => {
      getHookApi(apiRef).setAllAlertsDisabled(false);
    });

    expect(getHookApi(apiRef).profileRef.current.generalTimers?.[0]).toEqual(
      expect.objectContaining({ enabled: false, endsAt: now + 30_000 }),
    );
  });
});
