import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import { playAlert } from "../../../lib/alert";
import { createDefaultProfile } from "../../../lib/storage";
import type { Profile } from "../../../types";
import { useAlertPlaybackController } from "./useAlertPlaybackController";

vi.mock("../../../lib/alert", () => ({
  playAlert: vi.fn().mockResolvedValue(undefined),
}));

const playAlertMock = vi.mocked(playAlert);

function createProfileRef(partial: Partial<Profile> = {}): MutableRefObject<Profile> {
  return {
    current: {
      ...createDefaultProfile(),
      ...partial,
    },
  };
}

describe("useAlertPlaybackController", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("previews an alert sound with master volume applied", () => {
    const setMessage = vi.fn();
    const profileRef = createProfileRef({ masterVolume: 0.5 });
    const { result } = renderHook(() =>
      useAlertPlaybackController({
        profileRef,
        setMessage,
      }),
    );

    act(() => {
      result.current.previewSound("띵동띵동", 0.8);
    });

    expect(playAlertMock).toHaveBeenCalledWith("띵동띵동", 0.4);
    expect(setMessage).not.toHaveBeenCalled();
  });

  it("previews master volume with the default alert sound", () => {
    const setMessage = vi.fn();
    const profile = createDefaultProfile();
    const profileRef = createProfileRef({
      alertDefaults: { ...profile.alertDefaults, soundId: "미스터리" },
      masterVolume: 0.35,
    });
    const { result } = renderHook(() =>
      useAlertPlaybackController({
        profileRef,
        setMessage,
      }),
    );

    act(() => {
      result.current.previewMasterVolume();
    });

    expect(playAlertMock).toHaveBeenCalledWith("미스터리", 0.35);
    expect(setMessage).not.toHaveBeenCalled();
  });

  it("shows the playback error message when sound preview fails", async () => {
    const setMessage = vi.fn();
    playAlertMock.mockRejectedValueOnce(new Error("브라우저가 오디오 재생을 차단했습니다."));
    const profileRef = createProfileRef();
    const { result } = renderHook(() =>
      useAlertPlaybackController({
        profileRef,
        setMessage,
      }),
    );

    act(() => {
      result.current.previewSound("띵동띵동", 0.8);
    });

    await waitFor(() =>
      expect(setMessage).toHaveBeenCalledWith("브라우저가 오디오 재생을 차단했습니다."),
    );
  });

  it("shows the master volume fallback message when preview fails without an Error", async () => {
    const setMessage = vi.fn();
    playAlertMock.mockRejectedValueOnce("failed");
    const profileRef = createProfileRef();
    const { result } = renderHook(() =>
      useAlertPlaybackController({
        profileRef,
        setMessage,
      }),
    );

    act(() => {
      result.current.previewMasterVolume();
    });

    await waitFor(() =>
      expect(setMessage).toHaveBeenCalledWith("마스터 볼륨 미리듣기에 실패했습니다."),
    );
  });

  it("provides a mutable ref for deduplicating alert playback errors", () => {
    const setMessage = vi.fn();
    const profileRef = createProfileRef();
    const { result } = renderHook(() =>
      useAlertPlaybackController({
        profileRef,
        setMessage,
      }),
    );

    expect(result.current.lastAlertErrorRef.current).toBeNull();
    act(() => {
      result.current.lastAlertErrorRef.current = "error";
    });
    expect(result.current.lastAlertErrorRef.current).toBe("error");
  });
});
