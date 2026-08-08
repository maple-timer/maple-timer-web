import { describe, expect, it } from "vitest";
import {
  buildCustomSoundDraft,
  buildCustomSoundSaveInput,
  buildCustomSoundUpdatePatch,
  getCustomSoundDeleteSuccessMessage,
  type DraftSound,
} from "./customSoundDialogControllerModel";

function makeAudioBuffer(duration: number): AudioBuffer {
  return {
    duration,
    length: 4,
    numberOfChannels: 1,
    sampleRate: 44_100,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
    getChannelData: () => new Float32Array([0, 0.25, -0.5, 1]),
  } as AudioBuffer;
}

function makeDraft(overrides: Partial<DraftSound> = {}): DraftSound {
  const blob = new Blob(["audio"], { type: "audio/wav" });
  return {
    mode: "new",
    id: null,
    name: "테스트 알림음",
    blob,
    fileName: "test.wav",
    mimeType: "audio/wav",
    size: blob.size,
    durationMs: 1_200,
    trimStartMs: 100,
    trimEndMs: 900,
    peaks: [0.2, 1],
    ...overrides,
  };
}

describe("customSoundDialogControllerModel", () => {
  it("rejects decoded audio shorter than the minimum trim duration", () => {
    expect(
      buildCustomSoundDraft({
        audioBuffer: makeAudioBuffer(0.2),
        blob: new Blob(["audio"], { type: "audio/wav" }),
        fileName: "short.wav",
        mode: "new",
      }),
    ).toEqual({
      ok: false,
      status: "알림음은 최소 0.50초 이상이어야 합니다.",
    });
  });

  it("builds a new draft from decoded audio and file metadata", () => {
    const blob = new Blob(["audio"], { type: "audio/wav" });

    const result = buildCustomSoundDraft({
      audioBuffer: makeAudioBuffer(2.4),
      blob,
      fileName: "custom-name.wav",
      mode: "new",
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        mode: "new",
        id: null,
        name: "custom-name",
        blob,
        fileName: "custom-name.wav",
        mimeType: "audio/wav",
        size: blob.size,
        durationMs: 2_400,
        trimStartMs: 0,
        trimEndMs: 2_400,
      },
    });
    expect(result.ok && result.draft.peaks.length).toBeGreaterThan(0);
  });

  it("builds an edit draft from saved metadata and preserves trim boundaries", () => {
    const blob = new Blob(["audio"], { type: "audio/wav" });

    const result = buildCustomSoundDraft({
      audioBuffer: makeAudioBuffer(3.2),
      blob,
      name: "저장된 이름",
      metadata: {
        id: "sound-1",
        name: "메타 이름",
        mimeType: "audio/mpeg",
        size: 4096,
        durationMs: 3_200,
        trimStartMs: 250,
        trimEndMs: 1_500,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      mode: "edit",
    });

    expect(result).toMatchObject({
      ok: true,
      draft: {
        mode: "edit",
        id: "sound-1",
        name: "저장된 이름",
        blob,
        mimeType: "audio/mpeg",
        size: 4096,
        durationMs: 3_200,
        trimStartMs: 250,
        trimEndMs: 1_500,
      },
    });
  });

  it("builds save and update payloads from a draft", () => {
    const draft = makeDraft();

    expect(buildCustomSoundSaveInput(draft)).toEqual({
      blob: draft.blob,
      fileName: "test.wav",
      name: "테스트 알림음",
      mimeType: "audio/wav",
      size: draft.size,
      durationMs: 1_200,
      trimStartMs: 100,
      trimEndMs: 900,
    });
    expect(buildCustomSoundUpdatePatch(draft)).toEqual({
      name: "테스트 알림음",
      trimStartMs: 100,
      trimEndMs: 900,
    });
  });

  it("formats delete success messages by replacement count", () => {
    expect(getCustomSoundDeleteSuccessMessage(2)).toBe(
      "사용자 알림음을 삭제하고 현재 설정의 연결 항목을 기본 알림음으로 변경했습니다.",
    );
    expect(getCustomSoundDeleteSuccessMessage(0)).toBe(
      "사용자 알림음을 삭제했습니다. 저장된 프리셋의 알림음 선택은 유지됩니다.",
    );
  });
});
