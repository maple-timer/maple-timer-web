import type {
  BoosterExpiryRuntimeState,
  BoosterExpiryWorkerPerformance,
  BoosterExpiryWorkerResult,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import { BOOSTER_EXPIRY_MAX_CAPTURE_WIDTH } from "../../../lib/boosterExpiry/boosterExpiryCapture";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile } from "../../../types";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { BoosterExpiryIncidentRuntimeFailure } from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceTypes";
import {
  createBoosterExpirySourceGeometryRevision,
  recordBoosterExpiryIncidentRuntimeSample,
  type BoosterExpiryIncidentRuntimeRecorder,
} from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import type { BoosterExpiryVideoSample } from "./boosterExpirySampleProcessorState";

export function recordBoosterExpiryMonitoringIncident({
  previous,
  config,
  masterVolume,
  sampledAt,
  context,
  sample,
  stateBefore,
  stateAfter,
  result,
  performance,
  runtimeFailure,
  mediaImageDataUrl = null,
  recordFrame = true,
  unavailableAction = null,
}: {
  previous: BoosterExpiryIncidentRuntimeRecorder;
  config: NonNullable<Profile["boosterExpiryAlert"]>;
  masterVolume: number;
  sampledAt: number;
  context: MonitoringFrameContext | null;
  sample: BoosterExpiryVideoSample | null;
  stateBefore: BoosterExpiryRuntimeState;
  stateAfter: BoosterExpiryRuntimeState;
  result: BoosterExpiryWorkerResult | null;
  performance: BoosterExpiryWorkerPerformance | null;
  runtimeFailure: BoosterExpiryIncidentRuntimeFailure | null;
  mediaImageDataUrl?: string | null;
  recordFrame?: boolean;
  unavailableAction?: string | null;
}): BoosterExpiryIncidentRuntimeRecorder {
  const sourceSize = getSourceSize(context, sample);
  const sampledRegion = getSampledRegion(context, sample);
  const sourceGeometryRevision = sourceSize
    ? createBoosterExpirySourceGeometryRevision({
        width: sourceSize.width,
        height: sourceSize.height,
        region: sampledRegion,
      })
    : (previous.boundary?.resetEpoch.continuity.sourceGeometryRevision ?? "unavailable");
  const layoutKey =
    context?.gameFrameLayoutKey ??
    previous.boundary?.resetEpoch.continuity.layoutKey ??
    (sourceSize ? `${sourceSize.width}x${sourceSize.height}` : "unavailable");

  return recordBoosterExpiryIncidentRuntimeSample({
    previous,
    input: {
      sampledAt,
      configuration: createBoosterExpiryIncidentConfiguration(config, masterVolume),
      monitoringGeneration: previous.boundary?.resetEpoch.continuity.monitoringGeneration ?? 1,
      layoutKey,
      sourceGeometryRevision,
      stateBefore,
      stateAfter,
      result,
      performance,
      source:
        sourceSize && sampledRegion
          ? {
              kind: runtimeFailure ? "runtime-error" : "normal-monitoring-top-quarter",
              coordinateSpace:
                context?.gameViewport?.mode === "calibrated"
                  ? "game-viewport-pixels"
                  : "capture-pixels",
              sourceDimensions: { ...sourceSize },
              ...(context?.video.videoWidth && context.video.videoHeight
                ? {
                    captureDimensions: {
                      width: context.video.videoWidth,
                      height: context.video.videoHeight,
                    },
                  }
                : {}),
              ...(context?.gameViewport
                ? { sourceRegion: { ...context.gameViewport.region } }
                : {}),
              sampledRegion: { ...sampledRegion },
              maxCaptureWidth: BOOSTER_EXPIRY_MAX_CAPTURE_WIDTH,
              regionLabel: sample
                ? `${sample.imageData.width}x${sample.imageData.height}`
                : `${sampledRegion.width}x${sampledRegion.height}`,
            }
          : null,
      runtimeFailure,
      media: mediaImageDataUrl ? { imageDataUrl: mediaImageDataUrl } : null,
      recordFrame,
      unavailableAction,
    },
  });
}

export function createBoosterExpiryIncidentRuntimeFailure({
  failure,
  error,
  workerRequestStarted = false,
}: {
  failure: {
    stage: string;
    code: string;
    technicalMessage: string;
  } | null;
  error: unknown;
  workerRequestStarted?: boolean;
}): BoosterExpiryIncidentRuntimeFailure {
  const technicalMessage =
    failure?.technicalMessage ?? (error instanceof Error ? error.message : "booster-expiry-sample-failed");
  const code = workerRequestStarted
    ? getWorkerFailureCode(technicalMessage)
    : (failure?.code ?? (error instanceof Error ? error.name || "booster-expiry-error" : "unknown-error"));
  return {
    stage: getFailureStage(failure?.stage ?? null, code),
    code,
    technicalMessage,
  };
}

export function createBoosterExpiryIncidentConfiguration(
  config: NonNullable<Profile["boosterExpiryAlert"]>,
  masterVolume: number,
) {
  return {
    enabled: config.enabled,
    alertLeadSeconds: config.alertLeadSeconds,
    soundId: config.soundId,
    featureVolume: config.volume,
    masterVolume,
    effectiveVolume: applyMasterVolume(config.volume, masterVolume),
  };
}

function getFailureStage(stage: string | null, code: string): BoosterExpiryIncidentRuntimeFailure["stage"] {
  if (stage === "frame-capture") return "capture";
  if (code === "worker-timeout") return "worker-timeout";
  if (code === "worker-create-failed" || code === "worker-unsupported") {
    return "worker-create";
  }
  if (code === "worker-post-failed") return "worker-post";
  if (code.startsWith("worker-") || code.includes("worker")) {
    return "worker-runtime";
  }
  if (stage === "recognizer") return "recognition";
  return "unknown";
}

function getWorkerFailureCode(message: string): string {
  if (message.includes("timeout")) return "worker-timeout";
  if (message.includes("post")) return "worker-post-failed";
  if (message.includes("unsupported")) return "worker-unsupported";
  if (message.includes("create") || message.includes("시작하지 못")) {
    return "worker-create-failed";
  }
  return "worker-runtime-failed";
}

function getSourceSize(
  context: MonitoringFrameContext | null,
  sample: BoosterExpiryVideoSample | null,
): { width: number; height: number } | null {
  if (context?.gameViewport) {
    return {
      width: context.gameViewport.region.width,
      height: context.gameViewport.region.height,
    };
  }
  if (context?.video.videoWidth && context.video.videoHeight) {
    return {
      width: context.video.videoWidth,
      height: context.video.videoHeight,
    };
  }
  if (!sample) return null;
  return {
    width: Math.max(sample.region.x + sample.region.width, sample.region.width),
    height: Math.max(sample.region.y + sample.region.height, sample.region.height * 4),
  };
}

function getSampledRegion(
  context: MonitoringFrameContext | null,
  sample: BoosterExpiryVideoSample | null,
): BoosterExpiryVideoSample["region"] | null {
  if (!sample) return null;
  if (context?.gameViewport?.mode !== "calibrated") {
    return sample.region;
  }
  return {
    x: sample.region.x - context.gameViewport.region.x,
    y: sample.region.y - context.gameViewport.region.y,
    width: sample.region.width,
    height: sample.region.height,
  };
}
