import {
  MAX_CUSTOM_SOUND_TRIM_MS,
  MIN_CUSTOM_SOUND_TRIM_MS,
} from "../../lib/customSounds";

type CustomSoundTrimRange = {
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
};

type CustomSoundPreviewProgress = {
  trimEndMs: number;
  progressMs: number;
} | null;

export type CustomSoundWaveformViewModel = {
  selectedPercentStart: number;
  selectedPercentEnd: number;
  previewPercent: number | null;
  selectionStyle: {
    left: string;
    right: string;
  };
  previewStyle: {
    left: string;
  } | null;
  startHandleStyle: {
    left: string;
  };
  endHandleStyle: {
    left: string;
  };
};

export function formatCustomSoundDurationMs(durationMs: number): string {
  const seconds = Math.max(0, durationMs / 1000);
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}초`;
}

export function formatCustomSoundFileSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

export function getCustomSoundWaveformViewModel(
  draft: CustomSoundTrimRange | null,
  previewPlayback: CustomSoundPreviewProgress,
): CustomSoundWaveformViewModel {
  const selectedPercentStart = draft ? (draft.trimStartMs / draft.durationMs) * 100 : 0;
  const selectedPercentEnd = draft ? (draft.trimEndMs / draft.durationMs) * 100 : 100;
  const previewPercent =
    draft && previewPlayback
      ? (Math.min(previewPlayback.trimEndMs, previewPlayback.progressMs) / draft.durationMs) * 100
      : null;

  return {
    selectedPercentStart,
    selectedPercentEnd,
    previewPercent,
    selectionStyle: {
      left: `${selectedPercentStart}%`,
      right: `${100 - selectedPercentEnd}%`,
    },
    previewStyle: previewPercent === null ? null : { left: `${previewPercent}%` },
    startHandleStyle: { left: `${selectedPercentStart}%` },
    endHandleStyle: { left: `${selectedPercentEnd}%` },
  };
}

export function getCustomSoundTrimFromRatio({
  current,
  handle,
  ratio,
}: {
  current: CustomSoundTrimRange;
  handle: "start" | "end";
  ratio: number;
}): Pick<CustomSoundTrimRange, "trimStartMs" | "trimEndMs"> {
  const targetMs = Math.round(current.durationMs * Math.min(1, Math.max(0, ratio)));
  if (handle === "start") {
    const minStart = Math.max(0, current.trimEndMs - MAX_CUSTOM_SOUND_TRIM_MS);
    const maxStart = current.trimEndMs - MIN_CUSTOM_SOUND_TRIM_MS;
    return {
      trimStartMs: Math.min(maxStart, Math.max(minStart, targetMs)),
      trimEndMs: current.trimEndMs,
    };
  }

  const minEnd = current.trimStartMs + MIN_CUSTOM_SOUND_TRIM_MS;
  const maxEnd = Math.min(current.durationMs, current.trimStartMs + MAX_CUSTOM_SOUND_TRIM_MS);
  return {
    trimStartMs: current.trimStartMs,
    trimEndMs: Math.max(minEnd, Math.min(maxEnd, targetMs)),
  };
}
