import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlertDisableSnapshot } from "../../../lib/alertDisableSnapshot";
import { createDefaultProfile, createSkill } from "../../../lib/profileFactory";
import { createRuntimeState } from "../../../lib/timer";
import type { Profile, SkillRuntimeState } from "../../../types";
import { useSkillRuntimeState } from "./useSkillRuntimeState";

type HookApi = ReturnType<typeof useSkillRuntimeState>;

function createProfileWithSkill(skill: Profile["skills"][number]): Profile {
  return {
    ...createDefaultProfile(),
    skills: [skill],
  };
}

function createRunningState(skillId: string): SkillRuntimeState {
  return {
    ...createRuntimeState(skillId),
    observedRemainingSeconds: 60,
    observedAt: 1_000,
    estimatedExpiresAt: 61_000,
    confidence: 0.95,
    status: "running",
    lastAlertCycleStartedAt: 1_000,
  };
}

function RuntimeHarness({
  profile,
  onReady,
}: {
  profile: Profile;
  onReady: (api: HookApi) => void;
}) {
  const profileRef = useRef(profile);
  const alertDisableSnapshotRef = useRef<AlertDisableSnapshot | null>(null);
  profileRef.current = profile;

  const api = useSkillRuntimeState({
    profile,
    profileRef,
    alertDisableSnapshotRef,
    updateProfile: vi.fn(),
  });

  useEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

describe("useSkillRuntimeState", () => {
  afterEach(() => {
    cleanup();
  });

  it("preserves runtime when alert, sound, or volume settings change", async () => {
    const skill = createSkill({
      id: "skill_sol",
      presetId: "sol-janus-dawn-2min",
      alertThresholdSeconds: 10,
      soundId: "야누스 랜덤",
      volume: 1,
    });
    let api: HookApi | null = null;
    const onReady = (next: HookApi) => {
      api = next;
    };

    const { rerender } = render(
      <RuntimeHarness profile={createProfileWithSkill(skill)} onReady={onReady} />,
    );

    act(() => {
      api?.setRuntimeStates({ [skill.id]: createRunningState(skill.id) });
    });

    await waitFor(() => {
      expect(api?.runtimeRef.current[skill.id]?.estimatedExpiresAt).toBe(61_000);
    });

    rerender(
      <RuntimeHarness
        profile={createProfileWithSkill({
          ...skill,
          alertThresholdSeconds: 30,
          soundId: "띵동",
          volume: 0.4,
        })}
        onReady={onReady}
      />,
    );

    await waitFor(() => {
      expect(api?.runtimeRef.current[skill.id]?.estimatedExpiresAt).toBe(61_000);
      expect(api?.runtimeRef.current[skill.id]?.status).toBe("running");
    });
  });

  it("resets runtime when the timer calculation basis changes", async () => {
    const skill = createSkill({
      id: "skill_sol",
      presetId: "sol-janus-dawn-1min",
    });
    let api: HookApi | null = null;
    const onReady = (next: HookApi) => {
      api = next;
    };

    const { rerender } = render(
      <RuntimeHarness profile={createProfileWithSkill(skill)} onReady={onReady} />,
    );

    act(() => {
      api?.setRuntimeStates({ [skill.id]: createRunningState(skill.id) });
    });

    await waitFor(() => {
      expect(api?.runtimeRef.current[skill.id]?.estimatedExpiresAt).toBe(61_000);
    });

    rerender(
      <RuntimeHarness
        profile={createProfileWithSkill({
          ...skill,
          presetId: "sol-janus-dawn-2min",
          durationSeconds: 120,
        })}
        onReady={onReady}
      />,
    );

    await waitFor(() => {
      expect(api?.runtimeRef.current[skill.id]?.estimatedExpiresAt).toBeNull();
      expect(api?.runtimeRef.current[skill.id]?.status).toBe("idle");
    });
  });

  it("selects and expands a skill as the region picker target", async () => {
    const firstSkill = createSkill({
      id: "skill_first",
      presetId: "sol-janus-dawn-1min",
    });
    const secondSkill = createSkill({
      id: "skill_second",
      presetId: "erda-fountain",
    });
    let api: HookApi | null = null;
    const onReady = (next: HookApi) => {
      api = next;
    };

    render(
      <RuntimeHarness
        profile={{
          ...createDefaultProfile(),
          skills: [firstSkill, secondSkill],
        }}
        onReady={onReady}
      />,
    );

    act(() => {
      api?.selectRegionPickerSkill(secondSkill.id);
    });

    await waitFor(() => {
      expect(api?.selectedSkillId).toBe(secondSkill.id);
      expect(api?.selectedSkill?.id).toBe(secondSkill.id);
      expect(api?.expandedSkillIds).toContain(secondSkill.id);
    });
  });
});
