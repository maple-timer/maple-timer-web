import { afterEach, describe, expect, it, vi } from "vitest";
import { playAlert } from "./alert";
import { getCustomAlertSoundRecord } from "./customSounds";

vi.mock("./customSounds", async () => {
  const actual = await vi.importActual<typeof import("./customSounds")>("./customSounds");
  return {
    ...actual,
    getCustomAlertSoundRecord: vi.fn(),
  };
});

const getCustomAlertSoundRecordMock = vi.mocked(getCustomAlertSoundRecord);

class FakeAudio {
  static instances: FakeAudio[] = [];

  src: string;
  volume = 1;
  currentTime = 0;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  listeners = new Map<string, Array<() => void>>();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((item) => item !== listener),
    );
  }

  dispatch(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

describe("playAlert", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    getCustomAlertSoundRecordMock.mockReset();
    FakeAudio.instances = [];
  });

  it("does not stop an existing alert when another alert starts", async () => {
    vi.stubGlobal("Audio", FakeAudio);

    await playAlert("띵동띵동", 0.4);
    await playAlert("미스터리", 0.7);

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances[1].play).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances[0].pause).not.toHaveBeenCalled();
    expect(FakeAudio.instances[1].pause).not.toHaveBeenCalled();
    expect(FakeAudio.instances[0].volume).toBe(0.4);
    expect(FakeAudio.instances[1].volume).toBe(0.7);
  });

  it("cleans up finished alerts without touching other playing alerts", async () => {
    vi.stubGlobal("Audio", FakeAudio);

    await playAlert("띵동띵동", 1);
    await playAlert("미스터리", 1);
    FakeAudio.instances[0].dispatch("ended");

    expect(FakeAudio.instances[0].pause).not.toHaveBeenCalled();
    expect(FakeAudio.instances[1].pause).not.toHaveBeenCalled();
  });

  it("resolves random alert groups before playback", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(Math, "random").mockReturnValue(0.4);

    await playAlert("야누스 랜덤", 0.5);

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe("/sounds/야누스 꺼져가요.m4a");
    expect(FakeAudio.instances[0].volume).toBe(0.5);
  });

  it("caps the raw audio element volume when boosted volume is requested", async () => {
    vi.stubGlobal("Audio", FakeAudio);

    await playAlert("띵동띵동", 1.8);

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].volume).toBe(1);
  });

  it("plays custom alert sounds from their trimmed range", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Audio", FakeAudio);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:custom-alert"),
      revokeObjectURL,
    });
    getCustomAlertSoundRecordMock.mockResolvedValueOnce({
      id: "custom-1",
      name: "보스 알림",
      mimeType: "audio/mpeg",
      size: 1024,
      durationMs: 5_000,
      trimStartMs: 1_200,
      trimEndMs: 2_700,
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
    });

    await playAlert("custom:custom-1", 0.6);

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe("blob:custom-alert");
    expect(FakeAudio.instances[0].currentTime).toBe(1.2);
    expect(FakeAudio.instances[0].volume).toBe(0.6);

    vi.advanceTimersByTime(1_500);

    expect(FakeAudio.instances[0].pause).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:custom-alert");
  });

  it("falls back to the default sound when a custom sound file is missing", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    getCustomAlertSoundRecordMock.mockResolvedValueOnce(null);

    await playAlert("custom:missing", 0.4);

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe("/sounds/띵동띵동.m4a");
  });
});
