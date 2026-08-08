import type { GeneralTimerConfig, GeneralTimerPresetId } from "../../types";
import { DEFAULT_ALERT_VOLUME } from "../../lib/profileStorageConstants";
import { DEFAULT_ALERT_SOUND_ID, normalizeAlertSoundId } from "../../lib/sounds";
import { normalizePositiveSeconds, normalizeVolume } from "../../lib/profileNormalization";

export type GeneralTimerPreset = {
  id: GeneralTimerPresetId;
  label: string;
  durationSeconds: number;
  iconLabel: string;
  iconPaths: string[];
  custom: boolean;
};

export type GeneralTimerStatus = "idle" | "running" | "paused" | "done" | "disabled";

export const GENERAL_TIMER_PRESETS: GeneralTimerPreset[] = [
  {
    id: "30m",
    label: "30분",
    durationSeconds: 30 * 60,
    iconLabel: "30",
    iconPaths: [
      "/timer-icons/timer-30-small-wealth.png",
      "/timer-icons/timer-30-exp-accumulation.png",
    ],
    custom: false,
  },
  {
    id: "20m",
    label: "20분",
    durationSeconds: 20 * 60,
    iconLabel: "20",
    iconPaths: [
      "/timer-icons/timer-20-union-wealth.png",
      "/timer-icons/timer-20-union-luck.png",
    ],
    custom: false,
  },
  {
    id: "10m",
    label: "10분",
    durationSeconds: 10 * 60,
    iconLabel: "10",
    iconPaths: [
      "/timer-icons/timer-10-union-wealth.png",
      "/timer-icons/timer-10-union-luck.png",
    ],
    custom: false,
  },
  {
    id: "2h",
    label: "2시간",
    durationSeconds: 2 * 60 * 60,
    iconLabel: "2h",
    iconPaths: ["/timer-icons/timer-2h-wealth.png", "/timer-icons/timer-2h-exp.png"],
    custom: false,
  },
  {
    id: "custom",
    label: "사용자 입력",
    durationSeconds: 30 * 60,
    iconLabel: "직접",
    iconPaths: [],
    custom: true,
  },
];

export const DEFAULT_GENERAL_TIMER_PRESET_ID: GeneralTimerPresetId = "30m";
export const MIN_GENERAL_TIMER_SECONDS = 1;
export const MAX_GENERAL_TIMER_SECONDS = 24 * 60 * 60;
export const MAX_GENERAL_TIMER_NAME_LENGTH = 8;

export function getGeneralTimerPreset(presetId: unknown): GeneralTimerPreset {
  return (
    GENERAL_TIMER_PRESETS.find((preset) => preset.id === presetId) ??
    GENERAL_TIMER_PRESETS.find((preset) => preset.id === DEFAULT_GENERAL_TIMER_PRESET_ID) ??
    GENERAL_TIMER_PRESETS[0]
  );
}

export function createGeneralTimer(
  partial: Partial<GeneralTimerConfig> = {},
): GeneralTimerConfig {
  const preset = getGeneralTimerPreset(partial.presetId);
  return {
    id: partial.id ?? createGeneralTimerId(),
    name: normalizeGeneralTimerName(partial.name),
    presetId: preset.id,
    customDurationSeconds: normalizeTimerDurationSeconds(partial.customDurationSeconds) ?? undefined,
    soundId: normalizeAlertSoundId(partial.soundId ?? DEFAULT_ALERT_SOUND_ID),
    volume: normalizeVolume(partial.volume, DEFAULT_ALERT_VOLUME),
    autoRestartEnabled: partial.autoRestartEnabled === true,
    enabled: partial.enabled ?? true,
    startedAt: normalizeTimestamp(partial.startedAt),
    endsAt: normalizeTimestamp(partial.endsAt),
    remainingSecondsAtPause: normalizeTimerDurationSeconds(partial.remainingSecondsAtPause),
    alertedAt: normalizeTimestamp(partial.alertedAt),
  };
}

function createGeneralTimerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `timer_${crypto.randomUUID()}`;
  }
  return `timer_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function createDefaultGeneralTimers(): GeneralTimerConfig[] {
  return [createGeneralTimer({ presetId: DEFAULT_GENERAL_TIMER_PRESET_ID })];
}

export function normalizeGeneralTimers(value: unknown): GeneralTimerConfig[] {
  if (!Array.isArray(value)) {
    return createDefaultGeneralTimers();
  }

  const now = Date.now();
  return value
    .filter((timer): timer is Partial<GeneralTimerConfig> =>
      Boolean(timer && typeof timer === "object" && !Array.isArray(timer)),
    )
    .map((timer) => pauseRunningTimerOnLoad(createGeneralTimer(timer), now));
}

function pauseRunningTimerOnLoad(timer: GeneralTimerConfig, now: number): GeneralTimerConfig {
  if (!timer.enabled || timer.endsAt === null) {
    return timer;
  }

  const remainingSeconds = getGeneralTimerRemainingSeconds(timer, now);
  if (remainingSeconds <= 0) {
    return timer;
  }

  return {
    ...timer,
    endsAt: null,
    remainingSecondsAtPause: remainingSeconds,
  };
}

export function getGeneralTimerDurationSeconds(timer: GeneralTimerConfig): number {
  if (timer.presetId === "custom") {
    return timer.customDurationSeconds ?? getGeneralTimerPreset("custom").durationSeconds;
  }

  return getGeneralTimerPreset(timer.presetId).durationSeconds;
}

export function getGeneralTimerNextAutoRestartRange(
  timer: GeneralTimerConfig,
  now: number,
): {
  startedAt: number;
  endsAt: number;
} {
  const durationMs = getGeneralTimerDurationSeconds(timer) * 1000;
  let startedAt = timer.endsAt ?? now;

  if (durationMs > 0 && startedAt + durationMs <= now) {
    const skippedCycles = Math.floor((now - startedAt) / durationMs);
    startedAt += skippedCycles * durationMs;
  }

  return {
    startedAt,
    endsAt: startedAt + durationMs,
  };
}

export function getGeneralTimerRemainingSeconds(
  timer: GeneralTimerConfig,
  now: number,
): number {
  if (timer.endsAt !== null) {
    return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  }

  if (timer.remainingSecondsAtPause !== null) {
    return Math.max(0, timer.remainingSecondsAtPause);
  }

  if (timer.alertedAt !== null) {
    return 0;
  }

  return getGeneralTimerDurationSeconds(timer);
}

export function getGeneralTimerStatus(
  timer: GeneralTimerConfig,
  now: number,
): GeneralTimerStatus {
  if (!timer.enabled) {
    return "disabled";
  }

  const remainingSeconds = getGeneralTimerRemainingSeconds(timer, now);
  if (timer.endsAt !== null && remainingSeconds > 0) {
    return "running";
  }
  if (timer.endsAt !== null || timer.alertedAt !== null) {
    return "done";
  }
  if (timer.remainingSecondsAtPause !== null) {
    return "paused";
  }
  return "idle";
}

export function formatGeneralTimerTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function normalizeGeneralTimerName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().slice(0, MAX_GENERAL_TIMER_NAME_LENGTH);
  return trimmed || undefined;
}

export function normalizeTimerDurationSeconds(value: unknown): number | null {
  const seconds = normalizePositiveSeconds(value);
  if (seconds === undefined) {
    return null;
  }

  return Math.min(MAX_GENERAL_TIMER_SECONDS, Math.max(MIN_GENERAL_TIMER_SECONDS, seconds));
}

function normalizeTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}
