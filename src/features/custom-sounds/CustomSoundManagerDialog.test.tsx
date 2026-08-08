import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomSoundManagerDialog } from "./CustomSoundManagerDialog";
import {
  decodeAudioBlob,
  deleteCustomAlertSound,
  getCustomAlertSoundRecord,
  saveCustomAlertSound,
  updateCustomAlertSound,
  type CustomAlertSoundMetadata,
} from "../../lib/customSounds";
import { playAudioSourceSegment, type AudioSegmentPlaybackOptions } from "../../lib/audioPlayback";

vi.mock("../../lib/customSounds", async () => {
  const actual = await vi.importActual<typeof import("../../lib/customSounds")>(
    "../../lib/customSounds",
  );
  return {
    ...actual,
    buildWaveformPeaks: vi.fn().mockReturnValue([0.3, 0.7, 0.4]),
    decodeAudioBlob: vi.fn().mockResolvedValue({ duration: 1.2 } as AudioBuffer),
    deleteCustomAlertSound: vi.fn().mockResolvedValue(true),
    getCustomAlertSoundRecord: vi.fn(),
    saveCustomAlertSound: vi.fn().mockResolvedValue({
      id: "saved-sound",
      name: "저장된 알림음",
      mimeType: "audio/wav",
      size: 1024,
      durationMs: 1200,
      trimStartMs: 0,
      trimEndMs: 1200,
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
    }),
    updateCustomAlertSound: vi.fn().mockResolvedValue({
      id: "sound-1",
      name: "테스트 알림음",
      mimeType: "audio/wav",
      size: 1024,
      durationMs: 1200,
      trimStartMs: 0,
      trimEndMs: 1200,
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
    }),
  };
});

vi.mock("../../lib/audioPlayback", () => ({
  playAudioSourceSegment: vi.fn((_source: string, _volume?: number, options?: AudioSegmentPlaybackOptions) => {
    options?.onRelease?.();
    return Promise.resolve();
  }),
}));

const deleteCustomAlertSoundMock = vi.mocked(deleteCustomAlertSound);
const decodeAudioBlobMock = vi.mocked(decodeAudioBlob);
const getCustomAlertSoundRecordMock = vi.mocked(getCustomAlertSoundRecord);
const playAudioSourceSegmentMock = vi.mocked(playAudioSourceSegment);
const saveCustomAlertSoundMock = vi.mocked(saveCustomAlertSound);
const updateCustomAlertSoundMock = vi.mocked(updateCustomAlertSound);

function createCustomSound(overrides: Partial<CustomAlertSoundMetadata> = {}) {
  const now = "2026-05-26T00:00:00.000Z";
  return {
    id: "sound-1",
    name: "테스트 알림음",
    mimeType: "audio/wav",
    size: 1024,
    durationMs: 1200,
    trimStartMs: 0,
    trimEndMs: 1200,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("CustomSoundManagerDialog", () => {
  beforeEach(() => {
    decodeAudioBlobMock.mockResolvedValue({ duration: 1.2 } as AudioBuffer);
    playAudioSourceSegmentMock.mockImplementation(
      (_source: string, _volume?: number, options?: AudioSegmentPlaybackOptions) => {
        options?.onRelease?.();
        return Promise.resolve();
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("previews saved custom sounds from the list", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:custom-sound"),
      revokeObjectURL,
    });
    const sound = createCustomSound({ trimStartMs: 100, trimEndMs: 900 });
    getCustomAlertSoundRecordMock.mockResolvedValueOnce({
      ...sound,
      blob: new Blob(["audio"], { type: "audio/wav" }),
    });

    render(
      <CustomSoundManagerDialog
        customSounds={[sound]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "테스트 알림음 재생" }));

    await waitFor(() => {
      expect(getCustomAlertSoundRecordMock).toHaveBeenCalledWith("sound-1");
    });
    expect(playAudioSourceSegmentMock).toHaveBeenCalledWith(
      "blob:custom-sound",
      1,
      expect.objectContaining({
        startTimeSeconds: 0.1,
        endTimeSeconds: 0.9,
      }),
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:custom-sound");
  });

  it("cancels the current saved preview when another saved sound is played", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi
        .fn()
        .mockReturnValueOnce("blob:first-sound")
        .mockReturnValueOnce("blob:second-sound"),
      revokeObjectURL: vi.fn(),
    });
    const firstSound = createCustomSound({ id: "sound-1", name: "첫 번째 알림음" });
    const secondSound = createCustomSound({ id: "sound-2", name: "두 번째 알림음" });
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;
    getCustomAlertSoundRecordMock
      .mockResolvedValueOnce({
        ...firstSound,
        blob: new Blob(["first"], { type: "audio/wav" }),
      })
      .mockResolvedValueOnce({
        ...secondSound,
        blob: new Blob(["second"], { type: "audio/wav" }),
      });
    playAudioSourceSegmentMock.mockImplementation(
      (_source: string, _volume?: number, options?: AudioSegmentPlaybackOptions) => {
        if (!firstSignal) {
          firstSignal = options?.signal;
        } else {
          secondSignal = options?.signal;
        }
        return Promise.resolve();
      },
    );

    render(
      <CustomSoundManagerDialog
        customSounds={[firstSound, secondSound]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "첫 번째 알림음 재생" }));
    await waitFor(() => {
      expect(firstSignal).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "두 번째 알림음 재생" }));
    await waitFor(() => {
      expect(secondSignal).toBeDefined();
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
    expect(playAudioSourceSegmentMock).toHaveBeenCalledTimes(2);
  });

  it("turns the active saved preview button into a stop button", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:custom-sound"),
      revokeObjectURL: vi.fn(),
    });
    const sound = createCustomSound();
    let previewSignal: AbortSignal | undefined;
    getCustomAlertSoundRecordMock.mockResolvedValueOnce({
      ...sound,
      blob: new Blob(["audio"], { type: "audio/wav" }),
    });
    playAudioSourceSegmentMock.mockImplementationOnce(
      (_source: string, _volume?: number, options?: AudioSegmentPlaybackOptions) => {
        previewSignal = options?.signal;
        return Promise.resolve();
      },
    );

    render(
      <CustomSoundManagerDialog
        customSounds={[sound]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "테스트 알림음 재생" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "테스트 알림음 재생 중지" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "테스트 알림음 재생 중지" }));

    expect(previewSignal?.aborted).toBe(true);
    expect(playAudioSourceSegmentMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "테스트 알림음 재생" })).toBeInTheDocument();
    });
  });

  it("stops saved sound preview when the dialog unmounts", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:custom-sound"),
      revokeObjectURL: vi.fn(),
    });
    const sound = createCustomSound({ trimStartMs: 100, trimEndMs: 900 });
    let previewSignal: AbortSignal | undefined;
    getCustomAlertSoundRecordMock.mockResolvedValueOnce({
      ...sound,
      blob: new Blob(["audio"], { type: "audio/wav" }),
    });
    playAudioSourceSegmentMock.mockImplementationOnce(
      (_source: string, _volume?: number, options?: AudioSegmentPlaybackOptions) => {
        previewSignal = options?.signal;
        return Promise.resolve();
      },
    );

    const { unmount } = render(
      <CustomSoundManagerDialog
        customSounds={[sound]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "테스트 알림음 재생" }));

    await waitFor(() => {
      expect(previewSignal).toBeDefined();
    });
    expect(previewSignal?.aborted).toBe(false);

    unmount();

    expect(previewSignal?.aborted).toBe(true);
  });

  it("stops draft preview when adding a custom sound", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:draft-sound"),
      revokeObjectURL: vi.fn(),
    });
    let previewSignal: AbortSignal | undefined;
    playAudioSourceSegmentMock.mockImplementationOnce(
      (_source: string, _volume?: number, options?: AudioSegmentPlaybackOptions) => {
        previewSignal = options?.signal;
        return Promise.resolve();
      },
    );
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <CustomSoundManagerDialog
        customSounds={[]}
        onClose={vi.fn()}
        onChanged={onChanged}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["audio"], "custom.wav", { type: "audio/wav" })],
      },
    });

    await waitFor(() => {
      expect(decodeAudioBlob).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: "미리듣기" }));
    await waitFor(() => {
      expect(previewSignal).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    expect(previewSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(saveCustomAlertSoundMock).toHaveBeenCalled();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("rejects decoded audio that is too short to use", async () => {
    decodeAudioBlobMock.mockResolvedValueOnce({ duration: 0.2 } as AudioBuffer);
    const { container } = render(
      <CustomSoundManagerDialog
        customSounds={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["audio"], "short.wav", { type: "audio/wav" })],
      },
    });

    expect(await screen.findByText("알림음은 최소 0.50초 이상이어야 합니다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).not.toBeInTheDocument();
    expect(saveCustomAlertSoundMock).not.toHaveBeenCalled();
  });

  it("edits a saved custom sound using the existing trim range", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const sound = createCustomSound({
      name: "편집할 알림음",
      trimStartMs: 120,
      trimEndMs: 980,
    });
    getCustomAlertSoundRecordMock.mockResolvedValueOnce({
      ...sound,
      blob: new Blob(["audio"], { type: "audio/wav" }),
    });

    render(
      <CustomSoundManagerDialog
        customSounds={[sound]}
        onClose={vi.fn()}
        onChanged={onChanged}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "편집할 알림음 편집" }));

    const nameInput = await screen.findByLabelText("이름");
    expect(nameInput).toHaveValue("편집할 알림음");
    expect(screen.getByText(/선택 0.86초 \(0.12초 - 0.98초\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(updateCustomAlertSoundMock).toHaveBeenCalledWith("sound-1", {
        name: "편집할 알림음",
        trimStartMs: 120,
        trimEndMs: 980,
      });
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft open and reports save failures", async () => {
    saveCustomAlertSoundMock.mockRejectedValueOnce(new Error("저장 실패"));
    const { container } = render(
      <CustomSoundManagerDialog
        customSounds={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["audio"], "custom.wav", { type: "audio/wav" })],
      },
    });
    await screen.findByLabelText("이름");

    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    expect(await screen.findByText("저장 실패")).toBeInTheDocument();
    expect(screen.getByLabelText("이름")).toBeInTheDocument();
  });

  it("uses an app dialog for deleting custom sounds", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const onSoundDeleted = vi.fn().mockReturnValue(2);
    const onMessage = vi.fn();

    render(
      <CustomSoundManagerDialog
        customSounds={[createCustomSound()]}
        onClose={vi.fn()}
        onChanged={onChanged}
        onSoundDeleted={onSoundDeleted}
        onMessage={onMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "테스트 알림음 삭제" }));

    const dialog = screen.getByRole("dialog", { name: "사용자 알림음 삭제" });
    expect(dialog).toHaveTextContent('"테스트 알림음" 파일을 이 브라우저에서 삭제합니다.');
    expect(dialog).toHaveTextContent("나중에 적용할 때 없는 사용자 알림음은 기본 알림음으로 바뀝니다.");
    expect(screen.getByRole("button", { name: "유지" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    await waitFor(() => {
      expect(deleteCustomAlertSoundMock).toHaveBeenCalledWith("sound-1");
    });
    expect(onSoundDeleted).toHaveBeenCalledWith("custom:sound-1");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      "사용자 알림음을 삭제하고 현재 설정의 연결 항목을 기본 알림음으로 변경했습니다.",
    );
  });

  it("keeps the delete dialog open and reports delete failures", async () => {
    deleteCustomAlertSoundMock.mockRejectedValueOnce(new Error("삭제 실패"));

    render(
      <CustomSoundManagerDialog
        customSounds={[createCustomSound()]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
        onSoundDeleted={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "테스트 알림음 삭제" }));
    const dialog = screen.getByRole("dialog", { name: "사용자 알림음 삭제" });
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    expect(await screen.findByText("삭제 실패")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "사용자 알림음 삭제" })).toBeInTheDocument();
  });
});
