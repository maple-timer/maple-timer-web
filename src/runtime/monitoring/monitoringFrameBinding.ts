import {
  createMonitoringFrameContext,
  isVideoReadyForMonitoring,
  type BuffSlotPhysicalSampleDecorator,
  type MonitoringFrameContext,
} from "./monitoringFrameContext";
import type { ResolvedGameViewport } from "../../contracts/geometry/frameSource";

export type MonitoringFrameBinding = {
  getFrameContext: (sampledAt: number) => MonitoringFrameContext | null;
  reset: () => void;
};

export type MonitoringFrameRequest = {
  sampledAt: number;
  context: MonitoringFrameContext | null;
};

type CachedFrameContext = {
  sampledAt: number;
  video: HTMLVideoElement;
  videoWidth: number;
  videoHeight: number;
  gameViewportKey: string;
  context: MonitoringFrameContext;
};

export function createMonitoringFrameBinding({
  decorateBuffSlotPhysicalSample,
  getVideo,
  getMasterVolume,
  getGameViewport,
}: {
  decorateBuffSlotPhysicalSample?: BuffSlotPhysicalSampleDecorator;
  getVideo: () => HTMLVideoElement | null;
  getMasterVolume: () => number;
  getGameViewport?: () => ResolvedGameViewport | null | undefined;
}): MonitoringFrameBinding {
  let cached: CachedFrameContext | null = null;

  return {
    getFrameContext(sampledAt) {
      const video = getVideo();
      if (!isVideoReadyForMonitoring(video)) {
        cached = null;
        return null;
      }

      const gameViewport = getGameViewport?.();
      const gameViewportKey =
        gameViewport === undefined
          ? "default"
          : gameViewport === null
            ? "unavailable"
            : [
                gameViewport.mode,
                gameViewport.revision,
                gameViewport.layoutKey,
                gameViewport.region.x,
                gameViewport.region.y,
                gameViewport.region.width,
                gameViewport.region.height,
              ].join(":");
      if (
        cached &&
        cached.sampledAt === sampledAt &&
        cached.video === video &&
        cached.videoWidth === video.videoWidth &&
        cached.videoHeight === video.videoHeight &&
        cached.gameViewportKey === gameViewportKey
      ) {
        return cached.context;
      }

      const context = createMonitoringFrameContext({
        decorateBuffSlotPhysicalSample,
        gameViewport,
        sampledAt,
        video,
        masterVolume: getMasterVolume(),
      });
      cached = {
        sampledAt,
        video,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        gameViewportKey,
        context,
      };
      return context;
    },
    reset() {
      cached = null;
    },
  };
}
