import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sampleSkill,
  sampleSkillPixelRegion,
  sampleVideoPixelRegion,
  sampleVideoRegion,
} from "../../lib/capture";
import { sampleBuffSlotVideoFrame } from "../../lib/buffSlotParser/buffSlotFrameCapture";
import { createMonitoringFrameContext } from "./monitoringFrameContext";

vi.mock("../../lib/capture", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/capture")>(
      "../../lib/capture",
    );
  return {
    ...actual,
    sampleSkill: vi.fn(() => ({ kind: "legacy-skill" })),
    sampleSkillPixelRegion: vi.fn(() => ({ kind: "pixel-skill" })),
    sampleVideoRegion: vi.fn(() => ({ kind: "legacy-video" })),
    sampleVideoPixelRegion: vi.fn(() => ({ kind: "pixel-video" })),
  };
});

vi.mock("../../lib/buffSlotParser/buffSlotFrameCapture", () => ({
  sampleBuffSlotVideoFrame: vi.fn(() => ({
    imageData: {},
    rawPreviewUrl: null,
    regionLabel: "mock",
    sourceSize: { width: 1, height: 1 },
    roi: { x: 0, y: 0, width: 1, height: 1 },
  })),
}));

const sampleSkillMock = vi.mocked(sampleSkill);
const sampleSkillPixelRegionMock = vi.mocked(sampleSkillPixelRegion);
const sampleVideoRegionMock = vi.mocked(sampleVideoRegion);
const sampleVideoPixelRegionMock = vi.mocked(sampleVideoPixelRegion);
const sampleBuffSlotVideoFrameMock = vi.mocked(sampleBuffSlotVideoFrame);

describe("createMonitoringFrameContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the exact legacy sampling path when no viewport is supplied", () => {
    const video = createVideo(1920, 1080);
    const region = { x: 0.1, y: 0.2, width: 0.05, height: 0.08 };
    const context = createMonitoringFrameContext({
      sampledAt: 1_000,
      video,
      masterVolume: 80,
    });

    context.sampleSkill(region, true);
    context.sampleVideoRegion(region, false, 400);
    context.sampleGameVideoRegion(region, true, 300);
    context.sampleBuffSlotFrame({ includePreview: true });

    expect(context).toMatchObject({
      captureFrameLayoutKey: "1920x1080",
      gameFrameLayoutKey: "1920x1080",
      frameLayoutKey: "1920x1080",
      gameViewport: {
        mode: "legacy-passthrough",
        region: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    });
    expect(sampleSkillMock).toHaveBeenCalledWith(video, region, true);
    expect(sampleSkillPixelRegionMock).not.toHaveBeenCalled();
    expect(sampleVideoRegionMock).toHaveBeenNthCalledWith(
      1,
      video,
      region,
      false,
      400,
    );
    expect(sampleVideoRegionMock).toHaveBeenNthCalledWith(
      2,
      video,
      region,
      true,
      300,
    );
    expect(sampleVideoPixelRegionMock).not.toHaveBeenCalled();
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledWith(video, {
      includePreview: true,
    });
  });

  it("maps only game-space samplers into the calibrated source rectangle", () => {
    const video = createVideo(1766, 968);
    const viewport = {
      mode: "calibrated" as const,
      sourceSize: { width: 1766, height: 968 },
      gameResolution: { width: 1366, height: 768 },
      region: { x: 200, y: 100, width: 1366, height: 768 },
      layoutKey: "game:1366x768",
      revision: 4,
    };
    const context = createMonitoringFrameContext({
      sampledAt: 2_000,
      video,
      masterVolume: 100,
      gameViewport: viewport,
    });
    const captureRegion = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const gameRegion = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
    const squareGameRegion = {
      x: 0.1,
      y: 0.2,
      width: (0.1 * 768) / 1366,
      height: 0.1,
    };

    context.sampleVideoRegion(captureRegion, false);
    context.sampleGameVideoRegion(gameRegion, true, 500);
    context.sampleSkill(squareGameRegion, true);
    context.sampleBuffSlotFrame();

    expect(context.captureFrameLayoutKey).toBe("1766x968");
    expect(context.frameLayoutKey).toBe("1766x968");
    expect(context.gameFrameLayoutKey).toBe("game:1366x768");
    expect(sampleVideoRegionMock).toHaveBeenCalledWith(
      video,
      captureRegion,
      false,
      undefined,
    );
    expect(sampleVideoPixelRegionMock).toHaveBeenCalledWith(
      video,
      { x: 542, y: 484, width: 683, height: 192 },
      true,
      500,
    );
    expect(sampleSkillPixelRegionMock).toHaveBeenCalledWith(
      video,
      { x: 337, y: 254, width: 77, height: 77 },
      true,
    );
    expect(sampleSkillMock).not.toHaveBeenCalled();
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledWith(video, {
      includePreview: true,
      sourceRegion: viewport.region,
    });
  });

  it("decorates only physical buff-slot samples and re-runs for a preview upgrade", () => {
    const video = createVideo(1920, 1080);
    const decorateBuffSlotPhysicalSample = vi.fn(
      (
        sample: () => ReturnType<typeof sampleBuffSlotVideoFrame>,
        _context: {
          replacedSample: ReturnType<typeof sampleBuffSlotVideoFrame> | null;
          sampledAt: number;
        },
      ) => sample(),
    );
    sampleBuffSlotVideoFrameMock
      .mockReturnValueOnce(createBuffSlotSample(null))
      .mockReturnValueOnce(
        createBuffSlotSample("data:image/webp;base64,preview"),
      );
    const context = createMonitoringFrameContext({
      decorateBuffSlotPhysicalSample,
      sampledAt: 2_500,
      video,
      masterVolume: 100,
    });

    const first = context.sampleBuffSlotFrame({ includePreview: false });
    const cached = context.sampleBuffSlotFrame({ includePreview: false });
    const upgraded = context.sampleBuffSlotFrame({ includePreview: true });
    const cachedUpgrade = context.sampleBuffSlotFrame({ includePreview: true });

    expect(cached).toBe(first);
    expect(cachedUpgrade).toBe(upgraded);
    expect(decorateBuffSlotPhysicalSample).toHaveBeenCalledTimes(2);
    expect(decorateBuffSlotPhysicalSample.mock.calls[0]?.[1]).toEqual({
      replacedSample: null,
      sampledAt: 2_500,
    });
    expect(decorateBuffSlotPhysicalSample.mock.calls[1]?.[1]).toEqual({
      replacedSample: first,
      sampledAt: 2_500,
    });
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(2);
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenNthCalledWith(1, video, {
      includePreview: false,
    });
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenNthCalledWith(2, video, {
      includePreview: true,
    });
  });

  it("preserves a physical buff-slot sampler error through the decorator", () => {
    const video = createVideo(1920, 1080);
    const samplerError = new Error("physical-sample-failed");
    const decorateBuffSlotPhysicalSample = vi.fn(
      (sample: () => ReturnType<typeof sampleBuffSlotVideoFrame>) => sample(),
    );
    sampleBuffSlotVideoFrameMock.mockImplementationOnce(() => {
      throw samplerError;
    });
    const context = createMonitoringFrameContext({
      decorateBuffSlotPhysicalSample,
      sampledAt: 2_750,
      video,
      masterVolume: 100,
    });

    let thrown: unknown;
    try {
      context.sampleBuffSlotFrame();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(samplerError);
    expect(decorateBuffSlotPhysicalSample).toHaveBeenCalledTimes(1);
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(1);
  });

  it("keeps capture-space sampling available while a game viewport is stale", () => {
    const video = createVideo(1766, 968);
    const context = createMonitoringFrameContext({
      sampledAt: 3_000,
      video,
      masterVolume: 100,
      gameViewport: null,
    });
    const region = { x: 0.2, y: 0.3, width: 0.2, height: 0.2 };

    expect(() => context.sampleVideoRegion(region, false)).not.toThrow();
    expect(() => context.sampleSkill(region, false)).toThrow(
      "game-viewport-unavailable",
    );
    expect(() => context.sampleGameVideoRegion(region, false)).toThrow(
      "game-viewport-unavailable",
    );
    expect(() => context.sampleBuffSlotFrame()).toThrow(
      "game-viewport-unavailable",
    );
    expect(context.gameFrameLayoutKey).toBeNull();
    expect(sampleVideoRegionMock).toHaveBeenCalledTimes(1);
  });
});

function createVideo(
  videoWidth: number,
  videoHeight: number,
): HTMLVideoElement {
  return {
    videoWidth,
    videoHeight,
  } as HTMLVideoElement;
}

function createBuffSlotSample(rawPreviewUrl: string | null) {
  return {
    imageData: {} as ImageData,
    rawPreviewUrl,
    regionLabel: "mock",
    sourceSize: { width: 1, height: 1 },
    roi: { x: 0, y: 0, width: 1, height: 1 },
  };
}
