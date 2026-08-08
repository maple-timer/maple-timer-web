import {
  buildWaveformPeaks,
  MAX_CUSTOM_SOUND_TRIM_MS,
  MIN_CUSTOM_SOUND_TRIM_MS,
  normalizeCustomSoundName,
  normalizeCustomSoundTrim,
  type CustomAlertSoundMetadata,
  type SaveCustomAlertSoundInput,
} from "../../lib/customSounds";
import { formatCustomSoundDurationMs } from "./customSoundDialogViewModel";

export type DraftSound = {
  mode: "new" | "edit";
  id: string | null;
  name: string;
  blob: Blob;
  fileName?: string;
  mimeType: string;
  size: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  peaks: number[];
};

export type DragHandle = "start" | "end";

export type PreviewPlaybackState = {
  token: number;
  trimStartMs: number;
  trimEndMs: number;
  progressMs: number;
};

export type BuildCustomSoundDraftResult =
  | {
      ok: true;
      draft: DraftSound;
    }
  | {
      ok: false;
      status: string;
    };

export function buildCustomSoundDraft({
  audioBuffer,
  blob,
  fileName,
  name,
  metadata,
  mode,
}: {
  audioBuffer: AudioBuffer;
  blob: Blob;
  fileName?: string;
  name?: string;
  metadata?: CustomAlertSoundMetadata;
  mode: DraftSound["mode"];
}): BuildCustomSoundDraftResult {
  const durationMs = Math.round(audioBuffer.duration * 1000);
  if (durationMs < MIN_CUSTOM_SOUND_TRIM_MS) {
    return {
      ok: false,
      status: `알림음은 최소 ${formatCustomSoundDurationMs(MIN_CUSTOM_SOUND_TRIM_MS)} 이상이어야 합니다.`,
    };
  }

  const trim = normalizeCustomSoundTrim(
    durationMs,
    metadata?.trimStartMs ?? 0,
    metadata?.trimEndMs ?? Math.min(durationMs, MAX_CUSTOM_SOUND_TRIM_MS),
  );

  return {
    ok: true,
    draft: {
      mode,
      id: metadata?.id ?? null,
      name: normalizeCustomSoundName(name ?? metadata?.name, fileName),
      blob,
      fileName,
      mimeType: metadata?.mimeType ?? blob.type,
      size: metadata?.size ?? blob.size,
      durationMs,
      trimStartMs: trim.trimStartMs,
      trimEndMs: trim.trimEndMs,
      peaks: buildWaveformPeaks(audioBuffer),
    },
  };
}

export function buildCustomSoundSaveInput(draft: DraftSound): SaveCustomAlertSoundInput {
  return {
    blob: draft.blob,
    fileName: draft.fileName,
    name: draft.name,
    mimeType: draft.mimeType,
    size: draft.size,
    durationMs: draft.durationMs,
    trimStartMs: draft.trimStartMs,
    trimEndMs: draft.trimEndMs,
  };
}

export function buildCustomSoundUpdatePatch(
  draft: DraftSound,
): Pick<CustomAlertSoundMetadata, "name" | "trimStartMs" | "trimEndMs"> {
  return {
    name: draft.name,
    trimStartMs: draft.trimStartMs,
    trimEndMs: draft.trimEndMs,
  };
}

export function getCustomSoundDeleteSuccessMessage(replacedCount: number): string {
  return replacedCount > 0
    ? "사용자 알림음을 삭제하고 현재 설정의 연결 항목을 기본 알림음으로 변경했습니다."
    : "사용자 알림음을 삭제했습니다. 저장된 프리셋의 알림음 선택은 유지됩니다.";
}
