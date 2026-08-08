import type { ResolvedGameViewport } from "../../contracts/geometry/frameSource";
import type { RelativeRegion } from "../../types";
import {
  sampleBuffSlotVideoFrame,
  type BuffSlotVideoFrameSample,
} from "../../lib/buffSlotParser/buffSlotFrameCapture";
import {
  sampleSkill as sampleSkillRegion,
  sampleVideoRegion as sampleVideoRegionFromVideo,
} from "../../lib/capture";
import { getFullCapturePixelRegion } from "../../lib/gameViewport";
import { captureSizeToLayoutKey } from "../../lib/regions";
import {
  sampleGameViewportSkill,
  sampleGameViewportVideoRegion,
} from "../../platform/frame-capture/gameViewportSampling";

export type MonitoringFrameContext = {
  sampledAt: number;
  video: HTMLVideoElement;
  captureFrameLayoutKey: string | null;
  gameFrameLayoutKey: string | null;
  gameViewport: ResolvedGameViewport | null;
  /** @deprecated Capture-space compatibility key. Use the explicit space key. */
  frameLayoutKey: string | null;
  masterVolume: number;
  sampleSkill: (
    region: RelativeRegion,
    includePreview: boolean,
  ) => ReturnType<typeof sampleSkillRegion>;
  sampleVideoRegion: (
    region: RelativeRegion,
    includePreview: boolean,
    maxPreviewWidth?: number,
  ) => ReturnType<typeof sampleVideoRegionFromVideo>;
  sampleGameVideoRegion: (
    region: RelativeRegion,
    includePreview: boolean,
    maxPreviewWidth?: number,
  ) => ReturnType<typeof sampleVideoRegionFromVideo>;
  sampleBuffSlotFrame: (options?: {
    includePreview?: boolean;
  }) => BuffSlotVideoFrameSample;
};

export type BuffSlotPhysicalSampleDecorator = (
  sample: () => BuffSlotVideoFrameSample,
  context: Readonly<{
    replacedSample: BuffSlotVideoFrameSample | null;
    sampledAt: number;
  }>,
) => BuffSlotVideoFrameSample;

export function createMonitoringFrameContext({
  decorateBuffSlotPhysicalSample,
  gameViewport,
  masterVolume,
  sampledAt,
  video,
}: {
  decorateBuffSlotPhysicalSample?: BuffSlotPhysicalSampleDecorator;
  gameViewport?: ResolvedGameViewport | null;
  masterVolume: number;
  sampledAt: number;
  video: HTMLVideoElement;
}): MonitoringFrameContext {
  let buffSlotFrame: BuffSlotVideoFrameSample | null = null;
  const captureSize = {
    width: video.videoWidth,
    height: video.videoHeight,
  };
  const captureFrameLayoutKey = captureSizeToLayoutKey(captureSize);
  const resolvedGameViewport =
    gameViewport === undefined
      ? {
          mode: "legacy-passthrough" as const,
          sourceSize: captureSize,
          gameResolution: captureSize,
          region: getFullCapturePixelRegion(captureSize),
          layoutKey:
            captureFrameLayoutKey ??
            `${captureSize.width}x${captureSize.height}`,
          revision: 0,
        }
      : gameViewport;

  const requireGameViewport = () => {
    if (!resolvedGameViewport) {
      throw new Error("game-viewport-unavailable");
    }
    return resolvedGameViewport;
  };

  return {
    sampledAt,
    video,
    captureFrameLayoutKey,
    gameFrameLayoutKey: resolvedGameViewport?.layoutKey ?? null,
    gameViewport: resolvedGameViewport,
    frameLayoutKey: captureFrameLayoutKey,
    masterVolume,
    sampleSkill: (region, includePreview) =>
      sampleGameViewportSkill(
        video,
        requireGameViewport(),
        region,
        includePreview,
      ),
    sampleVideoRegion: (region, includePreview, maxPreviewWidth) =>
      sampleVideoRegionFromVideo(
        video,
        region,
        includePreview,
        maxPreviewWidth,
      ),
    sampleGameVideoRegion: (region, includePreview, maxPreviewWidth) =>
      sampleGameViewportVideoRegion(
        video,
        requireGameViewport(),
        region,
        includePreview,
        maxPreviewWidth,
      ),
    sampleBuffSlotFrame: (options) => {
      const includePreview = options?.includePreview ?? true;
      const viewport = requireGameViewport();
      if (!buffSlotFrame || (includePreview && !buffSlotFrame.rawPreviewUrl)) {
        const replacedSample = buffSlotFrame;
        const samplePhysicalFrame = () =>
          viewport.mode === "legacy-passthrough"
            ? sampleBuffSlotVideoFrame(video, { includePreview })
            : sampleBuffSlotVideoFrame(video, {
                includePreview,
                sourceRegion: viewport.region,
              });
        buffSlotFrame = decorateBuffSlotPhysicalSample
          ? decorateBuffSlotPhysicalSample(samplePhysicalFrame, {
              replacedSample,
              sampledAt,
            })
          : samplePhysicalFrame();
      }
      return buffSlotFrame;
    },
  };
}

export function isVideoReadyForMonitoring(
  video: HTMLVideoElement | null | undefined,
): video is HTMLVideoElement {
  return Boolean(
    video &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth &&
    video.videoHeight,
  );
}
