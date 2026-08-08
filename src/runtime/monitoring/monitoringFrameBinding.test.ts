import { describe, expect, it, vi } from "vitest";
import { sampleBuffSlotVideoFrame } from "../../lib/buffSlotParser/buffSlotFrameCapture";
import { createMonitoringFrameBinding } from "./monitoringFrameBinding";
import type { BuffSlotPhysicalSampleDecorator } from "./monitoringFrameContext";

vi.mock("../../lib/buffSlotParser/buffSlotFrameCapture", () => ({
  sampleBuffSlotVideoFrame: vi.fn(() => ({
    imageData: {},
    rawPreviewUrl: null,
    regionLabel: "mock",
    sourceSize: { width: 1, height: 1 },
    roi: { x: 0, y: 0, width: 1, height: 1 },
  })),
}));

const sampleBuffSlotVideoFrameMock = vi.mocked(sampleBuffSlotVideoFrame);

describe("createMonitoringFrameBinding", () => {
  it("returns one frame context for every consumer in the same scheduler tick", () => {
    const video = createReadyVideo(1280, 720);
    const getVideo = vi.fn(() => video);
    const getMasterVolume = vi.fn(() => 82);
    const binding = createMonitoringFrameBinding({ getVideo, getMasterVolume });

    const first = binding.getFrameContext(1_000);
    const second = binding.getFrameContext(1_000);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(first).toMatchObject({
      sampledAt: 1_000,
      video,
      masterVolume: 82,
    });
  });

  it("passes the physical buff-slot sample decorator into created contexts", () => {
    const video = createReadyVideo(1280, 720);
    const decorateBuffSlotPhysicalSample = vi.fn(
      (
        sample: () => ReturnType<typeof sampleBuffSlotVideoFrame>,
        _context: Parameters<BuffSlotPhysicalSampleDecorator>[1],
      ) => sample(),
    );
    const binding = createMonitoringFrameBinding({
      decorateBuffSlotPhysicalSample,
      getVideo: () => video,
      getMasterVolume: () => 100,
    });

    const context = binding.getFrameContext(1_000);
    context?.sampleBuffSlotFrame({ includePreview: false });

    expect(decorateBuffSlotPhysicalSample).toHaveBeenCalledTimes(1);
    expect(decorateBuffSlotPhysicalSample.mock.calls[0]?.[1]).toEqual({
      replacedSample: null,
      sampledAt: 1_000,
    });
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledWith(video, {
      includePreview: false,
    });
  });

  it("starts a new frame context for a new tick, video, or explicit reset", () => {
    const firstVideo = createReadyVideo(1280, 720);
    const secondVideo = createReadyVideo(1920, 1080);
    let video = firstVideo;
    const binding = createMonitoringFrameBinding({
      getVideo: () => video,
      getMasterVolume: () => 100,
    });

    const first = binding.getFrameContext(1_000);
    const nextTick = binding.getFrameContext(2_000);
    video = secondVideo;
    const nextVideo = binding.getFrameContext(2_000);
    binding.reset();
    const afterReset = binding.getFrameContext(2_000);

    expect(nextTick).not.toBe(first);
    expect(nextVideo).not.toBe(nextTick);
    expect(afterReset).not.toBe(nextVideo);
  });

  it("does not create a context until the video has current frame data", () => {
    const binding = createMonitoringFrameBinding({
      getVideo: () =>
        createVideo({
          readyState: HTMLMediaElement.HAVE_METADATA,
          videoWidth: 1280,
          videoHeight: 720,
        }),
      getMasterVolume: () => 100,
    });

    expect(binding.getFrameContext(1_000)).toBeNull();
  });

  it("starts a new same-tick context when the game viewport revision changes", () => {
    const video = createReadyVideo(1766, 968);
    let revision = 1;
    const binding = createMonitoringFrameBinding({
      getVideo: () => video,
      getMasterVolume: () => 100,
      getGameViewport: () => ({
        mode: "calibrated",
        sourceSize: { width: 1766, height: 968 },
        gameResolution: { width: 1366, height: 768 },
        region: { x: 200, y: 100, width: 1366, height: 768 },
        layoutKey: "game:1366x768",
        revision,
      }),
    });

    const first = binding.getFrameContext(1_000);
    revision = 2;
    const recalibrated = binding.getFrameContext(1_000);

    expect(recalibrated).not.toBe(first);
    expect(recalibrated?.gameViewport?.revision).toBe(2);
  });
});

function createReadyVideo(videoWidth: number, videoHeight: number) {
  return createVideo({
    readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    videoWidth,
    videoHeight,
  });
}

function createVideo({
  readyState,
  videoWidth,
  videoHeight,
}: {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
}): HTMLVideoElement {
  return {
    readyState,
    videoWidth,
    videoHeight,
  } as HTMLVideoElement;
}
