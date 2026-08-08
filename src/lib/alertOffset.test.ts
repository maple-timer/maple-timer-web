import { afterEach, describe, expect, it, vi } from "vitest";
import { playAudioBufferSegment, preloadAudioBufferSources } from "./audioPlayback";
import { playAlertFromOffset, preloadAlertFromOffset } from "./alert";

vi.mock("./audioPlayback", async () => {
  const actual = await vi.importActual<typeof import("./audioPlayback")>("./audioPlayback");
  return {
    ...actual,
    playAudioBufferSegment: vi.fn().mockResolvedValue(undefined),
    preloadAudioBufferSources: vi.fn().mockResolvedValue(undefined),
  };
});

const playAudioBufferSegmentMock = vi.mocked(playAudioBufferSegment);
const preloadAudioBufferSourcesMock = vi.mocked(preloadAudioBufferSources);

describe("playAlertFromOffset", () => {
  afterEach(() => {
    playAudioBufferSegmentMock.mockClear();
    preloadAudioBufferSourcesMock.mockClear();
  });

  it("keeps offset playback alive until the countdown segment ends", async () => {
    const controller = new AbortController();

    await playAlertFromOffset("여성 카운트다운", 0.8, 5, {
      signal: controller.signal,
    });

    expect(playAudioBufferSegmentMock).toHaveBeenCalledWith(
      "/sounds/special-core-countdown-female.m4a",
      0.8,
      {
        startTimeSeconds: 5,
        waitUntilEnded: true,
        signal: controller.signal,
      },
    );
  });

  it("forwards browser playback acceptance for offset alerts", async () => {
    const onStarted = vi.fn();

    await playAlertFromOffset("여성 카운트다운", 0.8, 5, { onStarted });

    expect(playAudioBufferSegmentMock).toHaveBeenCalledWith(
      "/sounds/special-core-countdown-female.m4a",
      0.8,
      {
        startTimeSeconds: 5,
        waitUntilEnded: true,
        onStarted,
      },
    );
  });

  it("preloads countdown alert audio sources before offset playback", async () => {
    await preloadAlertFromOffset("여성 카운트다운");

    expect(preloadAudioBufferSourcesMock).toHaveBeenCalledWith([
      "/sounds/special-core-countdown-female.m4a",
      "/sounds/special-core-countdown-female.mp3",
    ]);
  });
});
