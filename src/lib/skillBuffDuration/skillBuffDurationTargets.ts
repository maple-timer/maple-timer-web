import type { SkillConfig, SkillPresetId } from "../../types";

export type SkillBuffDurationTargetSkillId =
  | "janusDeepV2"
  | "hologramGraffitiBarrierVi"
  | "fountainDeepV2"
  | "maehwaYeinDeepV1";

export type SkillBuffDurationMatcherEngine = "prototype" | "skill-bundle-v1";
export type SkillBuffDurationValueKind = "countdown" | "remaining-count";

export type SkillBuffDurationTarget = {
  skillId: SkillBuffDurationTargetSkillId;
  detectorId: string;
  matcherEngine?: SkillBuffDurationMatcherEngine;
  matcherSkillId?: string;
  presetIds: readonly SkillPresetId[];
  displayName: string;
  shortName: string;
  iconSrc: string;
  maxBuffRowIndex: number;
  maxTrustedCountdownSecondsExclusive?: number;
  quickslotSupported: boolean;
  valueKind?: SkillBuffDurationValueKind;
};

export const SKILL_BUFF_DURATION_TARGETS: readonly SkillBuffDurationTarget[] = [
  {
    skillId: "janusDeepV2",
    detectorId: "skill-deep-v2:janus",
    matcherEngine: "skill-bundle-v1",
    matcherSkillId: "janus",
    presetIds: ["sol-janus-dawn-deep-v2"],
    displayName: "솔 야누스 : 새벽 (정밀)",
    shortName: "새벽",
    iconSrc: "/skill-icons/sol-janus.png",
    maxBuffRowIndex: 1,
    quickslotSupported: false,
    valueKind: "countdown",
  },
  {
    skillId: "hologramGraffitiBarrierVi",
    detectorId: "hologramGraffitiBarrierVi",
    matcherEngine: "skill-bundle-v1",
    matcherSkillId: "barrier",
    presetIds: ["hologram-graffiti-barrier-vi"],
    displayName: "홀로그램 그래피티: 역장 VI",
    shortName: "역장",
    iconSrc: "/skill-icons/hologram-graffiti-barrier-vi.png",
    maxBuffRowIndex: 1,
    quickslotSupported: false,
    valueKind: "countdown",
  },
  {
    skillId: "fountainDeepV2",
    detectorId: "skill-deep-v2:fountain",
    matcherEngine: "skill-bundle-v1",
    matcherSkillId: "fountain",
    presetIds: ["erda-fountain-deep-v2"],
    displayName: "에르다 파운틴 (정밀)",
    shortName: "파운틴",
    iconSrc: "/skill-icons/erda-fountain.png",
    maxBuffRowIndex: 1,
    maxTrustedCountdownSecondsExclusive: 60,
    quickslotSupported: false,
    valueKind: "countdown",
  },
  {
    skillId: "maehwaYeinDeepV1",
    detectorId: "skill-maehwa-yein-deep-v1",
    matcherEngine: "skill-bundle-v1",
    matcherSkillId: "maehwaYein",
    presetIds: ["maehwa-yein-vi"],
    displayName: "매화검 3초식 : 예인 VI",
    shortName: "예인",
    iconSrc: "/skill-icons/maehwa-yein-vi.png",
    maxBuffRowIndex: 1,
    quickslotSupported: false,
    valueKind: "remaining-count",
  },
];

export const SKILL_BUFF_DURATION_PRESET_IDS = new Set<SkillPresetId>(
  SKILL_BUFF_DURATION_TARGETS.flatMap((target) => [...target.presetIds]),
);

export function isSkillBuffDurationPresetId(value: unknown): value is SkillPresetId {
  return typeof value === "string" && SKILL_BUFF_DURATION_PRESET_IDS.has(value as SkillPresetId);
}

export function getSkillBuffDurationTargetForPresetId(
  presetId: unknown,
): SkillBuffDurationTarget | null {
  return SKILL_BUFF_DURATION_TARGETS.find((target) =>
    target.presetIds.includes(presetId as SkillPresetId),
  ) ?? null;
}

export function getSkillBuffDurationTargetForSkill(
  skill: Pick<SkillConfig, "presetId" | "detectionSource">,
): SkillBuffDurationTarget | null {
  const target = getSkillBuffDurationTargetForPresetId(skill.presetId);
  if (!target) {
    return null;
  }

  if (!target.quickslotSupported) {
    return target;
  }

  return (skill.detectionSource ?? "quickslot") === "buff-duration" ? target : null;
}

export function isSkillBuffDurationRemainingCountTarget(
  target: Pick<SkillBuffDurationTarget, "valueKind"> | null | undefined,
): boolean {
  return target?.valueKind === "remaining-count";
}

export function isSkillRemainingCountPresetId(value: unknown): value is SkillPresetId {
  const target = getSkillBuffDurationTargetForPresetId(value);
  return isSkillBuffDurationRemainingCountTarget(target);
}
