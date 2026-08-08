import type { CountdownSource, SkillConfig, SkillPresetId } from "../types";
import { clampAlertThresholdSeconds } from "./timerRules";
import {
  DEFAULT_ALERT_SOUND_ID,
  DEFAULT_ERDA_FOUNTAIN_ALERT_SOUND_ID,
  DEFAULT_SOL_JANUS_ALERT_SOUND_ID,
} from "./sounds";
import { getSkillBuffDurationTargetForPresetId } from "./skillBuffDuration/skillBuffDurationTargets";

export const REMAINING_COUNT_ALERT_THRESHOLD_MIN = 0;
export const REMAINING_COUNT_ALERT_THRESHOLD_MAX = 10;
export const DEFAULT_REMAINING_COUNT_ALERT_THRESHOLD = 3;

export type SkillPreset = {
  id: SkillPresetId;
  label: string;
  defaultName: string | null;
  iconSrc?: string;
  countdownSource: CountdownSource;
  durationSeconds: number;
  cooldownDurationSeconds?: number;
  defaultSoundId?: string;
  defaultAlertThresholdSeconds?: number;
  durationEditable: boolean;
};

export const SKILL_PRESETS: SkillPreset[] = [
  {
    id: "sol-janus-dawn-2min",
    label: "솔 야누스 : 새벽 (2분)",
    defaultName: "솔 야누스 : 새벽",
    iconSrc: "/skill-icons/sol-janus.png",
    countdownSource: "cooldown",
    durationSeconds: 120,
    cooldownDurationSeconds: 56,
    defaultSoundId: DEFAULT_SOL_JANUS_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "sol-janus-dawn-80s",
    label: "솔 야누스 : 새벽 (80초)",
    defaultName: "솔 야누스 : 새벽",
    iconSrc: "/skill-icons/sol-janus.png",
    countdownSource: "cooldown",
    durationSeconds: 80,
    cooldownDurationSeconds: 56,
    defaultSoundId: DEFAULT_SOL_JANUS_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "sol-janus-dawn-70s",
    label: "솔 야누스 : 새벽 (70초)",
    defaultName: "솔 야누스 : 새벽",
    iconSrc: "/skill-icons/sol-janus.png",
    countdownSource: "cooldown",
    durationSeconds: 70,
    cooldownDurationSeconds: 56,
    defaultSoundId: DEFAULT_SOL_JANUS_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "sol-janus-dawn-1min",
    label: "솔 야누스 : 새벽 (1분)",
    defaultName: "솔 야누스 : 새벽",
    iconSrc: "/skill-icons/sol-janus.png",
    countdownSource: "cooldown",
    durationSeconds: 60,
    cooldownDurationSeconds: 56,
    defaultSoundId: DEFAULT_SOL_JANUS_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "sol-janus-dawn-deep-v2",
    label: "솔 야누스 : 새벽 (정밀)",
    defaultName: "솔 야누스 : 새벽",
    iconSrc: "/skill-icons/sol-janus.png",
    countdownSource: "cooldown",
    durationSeconds: 120,
    cooldownDurationSeconds: 56,
    defaultSoundId: DEFAULT_SOL_JANUS_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "hologram-graffiti-barrier-vi",
    label: "홀로그램 그래피티: 역장 VI",
    defaultName: "홀로그램 그래피티: 역장 VI",
    iconSrc: "/skill-icons/hologram-graffiti-barrier-vi.png",
    countdownSource: "cooldown",
    durationSeconds: 60,
    cooldownDurationSeconds: 60,
    defaultSoundId: DEFAULT_SOL_JANUS_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "erda-fountain",
    label: "에르다 파운틴",
    defaultName: "에르다 파운틴",
    iconSrc: "/skill-icons/erda-fountain.png",
    countdownSource: "cooldown",
    durationSeconds: 60,
    cooldownDurationSeconds: 56,
    defaultSoundId: DEFAULT_ERDA_FOUNTAIN_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "erda-fountain-deep-v2",
    label: "에르다 파운틴 (정밀)",
    defaultName: "에르다 파운틴",
    iconSrc: "/skill-icons/erda-fountain.png",
    countdownSource: "cooldown",
    durationSeconds: 60,
    cooldownDurationSeconds: 56,
    defaultSoundId: DEFAULT_ERDA_FOUNTAIN_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "maehwa-yein-vi",
    label: "매화검 3초식 : 예인 VI",
    defaultName: "매화검 3초식 : 예인 VI",
    iconSrc: "/skill-icons/maehwa-yein-vi.png",
    countdownSource: "cooldown",
    durationSeconds: 28,
    cooldownDurationSeconds: 28,
    defaultAlertThresholdSeconds: DEFAULT_REMAINING_COUNT_ALERT_THRESHOLD,
    defaultSoundId: DEFAULT_ALERT_SOUND_ID,
    durationEditable: false,
  },
  {
    id: "class-install",
    label: "직업 설치기",
    defaultName: "직업 설치기",
    iconSrc: "/skill-icons/class-install.svg",
    countdownSource: "cooldown",
    durationSeconds: 60,
    cooldownDurationSeconds: 60,
    durationEditable: true,
  },
];

const SKILL_PRESET_IDS = new Set<SkillPresetId>(SKILL_PRESETS.map((preset) => preset.id));
const SOL_JANUS_PRESET_IDS = new Set<SkillPresetId>([
  "sol-janus-dawn-1min",
  "sol-janus-dawn-70s",
  "sol-janus-dawn-80s",
  "sol-janus-dawn-2min",
  "sol-janus-dawn-deep-v2",
]);
const LEGACY_SOL_JANUS_BUFF_DURATION_PRESET_IDS = new Set<SkillPresetId>([
  "sol-janus-dawn-1min",
  "sol-janus-dawn-70s",
  "sol-janus-dawn-80s",
  "sol-janus-dawn-2min",
]);
const ERDA_FOUNTAIN_PRESET_IDS = new Set<SkillPresetId>([
  "erda-fountain",
  "erda-fountain-deep-v2",
]);
const LEGACY_SOL_JANUS_PRESET_ID = "sol-janus-dawn";

function getSolJanusPresetIdByDuration(durationSeconds: number | undefined): SkillPresetId {
  if (!durationSeconds || durationSeconds >= 100) {
    return "sol-janus-dawn-2min";
  }
  if (durationSeconds >= 75) {
    return "sol-janus-dawn-80s";
  }
  if (durationSeconds >= 65) {
    return "sol-janus-dawn-70s";
  }
  return "sol-janus-dawn-1min";
}

export function isSolJanusPresetId(value: unknown): value is SkillPresetId {
  return typeof value === "string" && SOL_JANUS_PRESET_IDS.has(value as SkillPresetId);
}

export function isErdaFountainPresetId(value: unknown): value is SkillPresetId {
  return typeof value === "string" && ERDA_FOUNTAIN_PRESET_IDS.has(value as SkillPresetId);
}

export function normalizeSkillPresetId(value: unknown): SkillPresetId {
  if (value === LEGACY_SOL_JANUS_PRESET_ID) {
    return "sol-janus-dawn-2min";
  }

  return typeof value === "string" && SKILL_PRESET_IDS.has(value as SkillPresetId)
    ? (value as SkillPresetId)
    : "class-install";
}

export function normalizeLegacyBuffDurationPresetId(
  presetId: SkillPresetId,
  detectionSource: unknown,
): SkillPresetId {
  if (detectionSource !== "buff-duration") {
    return presetId;
  }

  if (LEGACY_SOL_JANUS_BUFF_DURATION_PRESET_IDS.has(presetId)) {
    return "sol-janus-dawn-deep-v2";
  }

  if (presetId === "erda-fountain") {
    return "erda-fountain-deep-v2";
  }

  return presetId;
}

export function normalizeSkillPresetIdForSkill(
  skill: { name: string; presetId?: unknown; durationSeconds?: number },
): SkillPresetId {
  if (skill.presetId === LEGACY_SOL_JANUS_PRESET_ID) {
    return getSolJanusPresetIdByDuration(skill.durationSeconds);
  }

  return inferSkillPresetId(skill);
}

export function getSkillPreset(id: unknown): SkillPreset {
  const normalizedId = normalizeSkillPresetId(id);
  return SKILL_PRESETS.find((preset) => preset.id === normalizedId) ?? SKILL_PRESETS[0];
}

export function inferSkillPresetId(skill: { name: string; presetId?: unknown }): SkillPresetId {
  if (skill.presetId) {
    return normalizeSkillPresetId(skill.presetId);
  }

  const normalizedName = skill.name.replace(/\s+/g, "").toLowerCase();
  if (
    (normalizedName.includes("솔야누스") || normalizedName.includes("janus")) &&
    (normalizedName.includes("1분") || normalizedName.includes("60"))
  ) {
    return "sol-janus-dawn-1min";
  }
  if (
    (normalizedName.includes("솔야누스") || normalizedName.includes("janus")) &&
    normalizedName.includes("70")
  ) {
    return "sol-janus-dawn-70s";
  }
  if (
    (normalizedName.includes("솔야누스") || normalizedName.includes("janus")) &&
    normalizedName.includes("80")
  ) {
    return "sol-janus-dawn-80s";
  }
  if (normalizedName.includes("솔야누스") || normalizedName.includes("janus")) {
    return "sol-janus-dawn-2min";
  }
  if (
    normalizedName.includes("매화검3초식") ||
    normalizedName.includes("예인") ||
    normalizedName.includes("maehwa") ||
    normalizedName.includes("yein")
  ) {
    return "maehwa-yein-vi";
  }
  if (
    normalizedName.includes("홀로그램그래피티") ||
    normalizedName.includes("역장") ||
    normalizedName.includes("hologram")
  ) {
    return "hologram-graffiti-barrier-vi";
  }
  if (
    (normalizedName.includes("에르다파운틴") || normalizedName.includes("fountain")) &&
    (normalizedName.includes("정밀") || normalizedName.includes("deep"))
  ) {
    return "erda-fountain-deep-v2";
  }
  if (normalizedName.includes("에르다파운틴") || normalizedName.includes("fountain")) {
    return "erda-fountain";
  }
  return "class-install";
}

export function buildSkillPresetPatch(
  presetId: SkillPresetId,
  currentSkill: Pick<SkillConfig, "name" | "durationSeconds" | "alertThresholdSeconds">,
): Partial<SkillConfig> {
  const preset = getSkillPreset(presetId);
  const target = getSkillBuffDurationTargetForPresetId(preset.id);
  const patch: Partial<SkillConfig> = {
    presetId: preset.id,
    countdownSource: preset.countdownSource,
    durationSeconds: preset.durationSeconds,
    cooldownDurationSeconds: preset.cooldownDurationSeconds,
    alertThresholdSeconds: target?.valueKind === "remaining-count"
      ? clampRemainingCountAlertThreshold(
          preset.defaultAlertThresholdSeconds ?? DEFAULT_REMAINING_COUNT_ALERT_THRESHOLD,
        )
      : clampAlertThresholdSeconds(currentSkill.alertThresholdSeconds, {
          presetId: preset.id,
        }),
  };
  const buffDurationTarget = target;
  patch.detectionSource = buffDurationTarget ? "buff-duration" : "quickslot";

  patch.name = preset.defaultName ?? currentSkill.name;
  if (preset.defaultSoundId) {
    patch.soundId = preset.defaultSoundId;
  }
  return patch;
}

export function isRemainingCountSkillPresetId(value: unknown): value is SkillPresetId {
  const target = getSkillBuffDurationTargetForPresetId(value);
  return target?.valueKind === "remaining-count";
}

export function clampRemainingCountAlertThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REMAINING_COUNT_ALERT_THRESHOLD;
  }
  return Math.min(
    REMAINING_COUNT_ALERT_THRESHOLD_MAX,
    Math.max(REMAINING_COUNT_ALERT_THRESHOLD_MIN, Math.round(value)),
  );
}
