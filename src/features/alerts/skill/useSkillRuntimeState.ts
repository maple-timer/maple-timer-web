import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { SkillSnapshot } from "../../../alertTypes";
import type { AlertDisableSnapshot } from "../../../lib/alertDisableSnapshot";
import { getSkillRuntimeConfigKey } from "../../../lib/skillRuntimeConfig";
import { createSkill } from "../../../lib/storage";
import { createRuntimeState } from "../../../lib/timer";
import {
  createSkillIncidentRuntimeRecorder,
  resetSkillIncidentRuntimeRecorder,
} from "../../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import type { Profile, SkillRuntimeState } from "../../../types";

export function useSkillRuntimeState({
  profile,
  profileRef,
  alertDisableSnapshotRef,
  updateProfile,
}: {
  profile: Profile;
  profileRef: MutableRefObject<Profile>;
  alertDisableSnapshotRef: MutableRefObject<AlertDisableSnapshot | null>;
  updateProfile: (updater: (current: Profile) => Profile) => void;
}) {
  const [selectedSkillId, setSelectedSkillId] = useState(() => profile.skills[0]?.id ?? "");
  const [expandedSkillIds, setExpandedSkillIds] = useState<string[]>([]);
  const [runtimeStates, setRuntimeStates] = useState<Record<string, SkillRuntimeState>>(() =>
    Object.fromEntries(profile.skills.map((skill) => [skill.id, createRuntimeState(skill.id)])),
  );
  const runtimeRef = useRef(runtimeStates);
  const runtimeConfigKeyRef = useRef(
    Object.fromEntries(profile.skills.map((skill) => [skill.id, getSkillRuntimeConfigKey(skill)])),
  );
  const skillIncidentRecorderRef = useRef(
    createSkillIncidentRuntimeRecorder(),
  );
  const [snapshots, setSnapshots] = useState<Record<string, SkillSnapshot>>({});

  const selectedSkill = useMemo(
    () => profile.skills.find((skill) => skill.id === selectedSkillId) ?? profile.skills[0] ?? null,
    [profile.skills, selectedSkillId],
  );

  useEffect(() => {
    runtimeRef.current = runtimeStates;
  }, [runtimeStates]);

  useEffect(() => {
    setRuntimeStates((previous) => {
      const next: Record<string, SkillRuntimeState> = {};
      const nextConfigKeys: Record<string, string> = {};
      for (const skill of profile.skills) {
        const configKey = getSkillRuntimeConfigKey(skill);
        const previousConfigKey = runtimeConfigKeyRef.current[skill.id];
        nextConfigKeys[skill.id] = configKey;
        next[skill.id] =
          previous[skill.id] && previousConfigKey === configKey
            ? previous[skill.id]
            : createRuntimeState(skill.id);
      }
      runtimeConfigKeyRef.current = nextConfigKeys;
      runtimeRef.current = next;
      return next;
    });

    if (!profile.skills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(profile.skills[0]?.id ?? "");
    }

    setExpandedSkillIds((current) =>
      current.filter((skillId) => profile.skills.some((skill) => skill.id === skillId)),
    );
  }, [profile.skills, selectedSkillId]);

  const addSkill = useCallback(() => {
    const nextNumber =
      profileRef.current.skills.filter((skill) => skill.presetId === "class-install").length + 1;
    const skill = createSkill({
      presetId: "class-install",
      name: `직업 설치기 ${nextNumber}`,
      enabled: !alertDisableSnapshotRef.current,
    });
    updateProfile((current) => ({ ...current, skills: [...current.skills, skill] }));
    setSelectedSkillId(skill.id);
    setExpandedSkillIds((current) => [...current, skill.id]);
  }, [alertDisableSnapshotRef, profileRef, updateProfile]);

  const removeSkill = useCallback(
    (skillId: string) => {
      updateProfile((current) => ({
        ...current,
        skills: current.skills.filter((skill) => skill.id !== skillId),
      }));
      setRuntimeStates((previous) => {
        const next = { ...previous };
        delete next[skillId];
        delete runtimeConfigKeyRef.current[skillId];
        runtimeRef.current = next;
        return next;
      });
      setSnapshots((previous) => {
        const next = { ...previous };
        delete next[skillId];
        return next;
      });
      setExpandedSkillIds((current) => current.filter((id) => id !== skillId));
    },
    [updateProfile],
  );

  const selectRegionPickerSkill = useCallback(
    (skillId: string) => {
      setSelectedSkillId(skillId);
      setExpandedSkillIds((current) =>
        current.includes(skillId) ? current : [...current, skillId],
      );
    },
    [],
  );

  const toggleExpandedSkill = useCallback((skillId: string) => {
    setExpandedSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId],
    );
  }, []);

  const resetSkillRuntime = useCallback((nextProfile: Profile) => {
    skillIncidentRecorderRef.current = resetSkillIncidentRuntimeRecorder({
      previous: skillIncidentRecorderRef.current,
      reason: "profile-replaced",
    });
    const nextRuntimeStates = Object.fromEntries(
      nextProfile.skills.map((skill) => [skill.id, createRuntimeState(skill.id)]),
    );
    const nextConfigKeys = Object.fromEntries(
      nextProfile.skills.map((skill) => [skill.id, getSkillRuntimeConfigKey(skill)]),
    );

    runtimeConfigKeyRef.current = nextConfigKeys;
    runtimeRef.current = nextRuntimeStates;
    setSelectedSkillId(nextProfile.skills[0]?.id ?? "");
    setExpandedSkillIds([]);
    setRuntimeStates(nextRuntimeStates);
    setSnapshots({});
  }, []);

  return {
    selectedSkillId,
    setSelectedSkillId,
    selectedSkill,
    expandedSkillIds,
    setExpandedSkillIds,
    runtimeStates,
    setRuntimeStates,
    runtimeRef,
    skillIncidentRecorderRef,
    snapshots,
    setSnapshots,
    addSkill,
    removeSkill,
    selectRegionPickerSkill,
    toggleExpandedSkill,
    resetSkillRuntime,
  };
}
