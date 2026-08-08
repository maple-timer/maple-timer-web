import type { RuntimeParserFailureEvidence } from "../../../contracts/reporting/runtimeReportEvidence";
import {
  getBuffSlotTopRightQuadrant,
  type BuffSlotVideoFrameSample,
} from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import {
  type SpecialCoreRuntimeState,
  type SpecialCoreSampleResponse,
  type SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile } from "../../../types";
import { getBuffRowGroups } from "../../../runtime/special-core/analysis/specialCoreAnalysisProcessor";
import type {
  SpecialCoreIncidentFrameSource,
  SpecialCoreIncidentParser,
  SpecialCoreIncidentRuntimeFailure,
} from "../../../runtime/special-core/evidence/specialCoreIncidentEvidenceTypes";
import {
  createSpecialCoreSourceGeometryRevision,
  recordSpecialCoreIncidentRuntimeSample,
  type SpecialCoreIncidentRuntimeRecorder,
} from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type {
  SharedBuffSlotAnalysisResult,
  SharedBuffSlotFrameSample,
} from "./useSharedBuffSlotAnalysis";

export function recordSpecialCoreMonitoringIncident({
  previous,
  config,
  masterVolume,
  sampledAt,
  parserRuntimeGeneration,
  context,
  evidenceFrame,
  sharedBuffSlotAnalysis,
  analysis,
  stateBefore,
  stateAfter,
  snapshot,
  runtimeFailure,
  recordFrame = true,
  unavailableAction = null,
}: {
  previous: SpecialCoreIncidentRuntimeRecorder;
  config: NonNullable<Profile["specialCoreAlert"]>;
  masterVolume: number;
  sampledAt: number;
  parserRuntimeGeneration: string | undefined;
  context: MonitoringFrameContext | null;
  evidenceFrame: BuffSlotVideoFrameSample | SharedBuffSlotFrameSample | null;
  sharedBuffSlotAnalysis: SharedBuffSlotAnalysisResult | null;
  analysis: SpecialCoreSampleResponse | null;
  stateBefore: SpecialCoreRuntimeState;
  stateAfter: SpecialCoreRuntimeState;
  snapshot: SpecialCoreSnapshot;
  runtimeFailure: SpecialCoreIncidentRuntimeFailure | null;
  recordFrame?: boolean;
  unavailableAction?: string | null;
}): SpecialCoreIncidentRuntimeRecorder {
  const sharedBoxes = sharedBuffSlotAnalysis?.analysis.boxes ?? [];
  const parsedBoxes = analysis?.parsedBoxes ?? sharedBoxes.map(toIncidentBox);
  const rowGroups = analysis?.rowGroups ?? getBuffRowGroups(sharedBoxes);
  const eligibleBoxIndexes =
    analysis?.eligibleBoxIndexes ??
    rowGroups.filter((row) => row.eligible).flatMap((row) => row.boxIndexes);
  const parserRuntime =
    analysis?.parserRuntime ?? sharedBuffSlotAnalysis?.analysis.runtime ?? null;
  const sourceSize = evidenceFrame?.sourceSize ?? getContextSourceSize(context);
  const captureSize =
    evidenceFrame?.captureSize ??
    (context?.video.videoWidth && context.video.videoHeight
      ? {
          width: context.video.videoWidth,
          height: context.video.videoHeight,
        }
      : null);
  const sourceRegion =
    evidenceFrame?.sourceRegion ??
    context?.gameViewport?.region ??
    (captureSize
      ? { x: 0, y: 0, width: captureSize.width, height: captureSize.height }
      : null);
  const coordinateSpace =
    evidenceFrame?.coordinateSpace ??
    (context?.gameViewport?.mode === "calibrated"
      ? "game-viewport-pixels"
      : "capture-pixels");
  const storedMediaRegion =
    evidenceFrame?.roi ??
    (sourceSize
      ? getBuffSlotTopRightQuadrant(sourceSize.width, sourceSize.height)
      : null);
  const source = createSpecialCoreIncidentSource({
    sourceSize,
    storedMediaRegion,
    regionLabel: evidenceFrame?.regionLabel ?? null,
    shared: sharedBuffSlotAnalysis !== null,
    runtimeFailure,
    captureSize,
    sourceRegion,
    coordinateSpace,
  });
  const parser = createSpecialCoreIncidentParser({
    engine:
      analysis?.parserEngine ?? sharedBuffSlotAnalysis?.analysis.engine ?? null,
    version:
      analysis?.parserVersion ??
      sharedBuffSlotAnalysis?.analysis.parserVersion ??
      null,
    fallbackReason:
      analysis?.parserFallbackReason ??
      sharedBuffSlotAnalysis?.analysis.fallbackReason ??
      null,
    runtime: parserRuntime,
  });
  const sourceGeometryRevision = sourceSize
    ? createSpecialCoreSourceGeometryRevision({
        width: sourceSize.width,
        height: sourceSize.height,
        roi: storedMediaRegion,
      })
    : previous.boundary?.resetEpoch.continuity.sourceGeometryRevision ??
      "unavailable";
  const layoutKey =
    context?.gameFrameLayoutKey ??
    previous.boundary?.resetEpoch.continuity.layoutKey ??
    (sourceSize ? `${sourceSize.width}x${sourceSize.height}` : "unavailable");

  return recordSpecialCoreIncidentRuntimeSample({
    previous,
    input: {
      sampledAt,
      configuration: {
        enabled: config.enabled,
        cooldownSeconds: config.cooldownSeconds,
        alertLeadSeconds: config.alertLeadSeconds,
        soundId: config.soundId,
        featureVolume: config.volume,
        masterVolume,
        effectiveVolume: applyMasterVolume(config.volume, masterVolume),
      },
      parserRuntimeGeneration:
        parserRuntimeGeneration ?? createParserRuntimeGeneration(parserRuntime),
      layoutKey,
      sourceGeometryRevision,
      stateBefore,
      stateAfter,
      snapshot,
      source,
      parser,
      parsedBoxes,
      rowGroups,
      eligibleBoxIndexes,
      timings: createSpecialCoreIncidentTimings({
        analysis,
        sharedBuffSlotAnalysis,
      }),
      runtimeFailure,
      media: evidenceFrame?.rawPreviewUrl
        ? { imageDataUrl: evidenceFrame.rawPreviewUrl }
        : null,
      recordFrame,
      unavailableAction,
    },
  });
}

export function createSpecialCoreIncidentRuntimeFailure({
  parserFailure,
  error,
}: {
  parserFailure: RuntimeParserFailureEvidence | null;
  error: unknown;
}): SpecialCoreIncidentRuntimeFailure {
  const diagnosticDetails = parserFailure?.diagnostic?.details;
  const technicalMessage =
    parserFailure?.technicalMessage ??
    (error instanceof Error ? error.message : "special-core-sample-failed");
  return {
    stage: parserFailure ? "shared-parser" : "matcher-worker",
    code:
      parserFailure?.diagnostic?.code ??
      parserFailure?.reason ??
      (error instanceof Error
        ? error.name || "special-core-error"
        : "unknown-error"),
    technicalMessage,
    details: {
      parserFailureReason: parserFailure?.reason ?? null,
      parserFailureStage: parserFailure?.diagnostic?.stage ?? null,
      parserFailureCode: parserFailure?.diagnostic?.code ?? null,
      executionProvider:
        typeof diagnosticDetails?.executionProvider === "string"
          ? diagnosticDetails.executionProvider
          : null,
      remoteFailurePhase:
        typeof diagnosticDetails?.remoteFailurePhase === "string"
          ? diagnosticDetails.remoteFailurePhase
          : null,
      remoteFailureCode:
        typeof diagnosticDetails?.remoteFailureCode === "string"
          ? diagnosticDetails.remoteFailureCode
          : null,
    },
  };
}

export function createSpecialCoreIdleSnapshot(
  sampledAt: number,
): SpecialCoreSnapshot {
  return {
    sampledAt,
    error: null,
    parserEngine: null,
    parserVersion: null,
    parserFallbackReason: null,
    boxCount: 0,
    detectedCount: 0,
    detectedIcon: null,
    candidateIcons: [],
    performance: {
      totalMs: 0,
      detectMs: 0,
      matchMs: 0,
      boxCount: 0,
    },
  };
}

function createSpecialCoreIncidentSource({
  sourceSize,
  storedMediaRegion,
  regionLabel,
  shared,
  runtimeFailure,
  captureSize,
  sourceRegion,
  coordinateSpace,
}: {
  sourceSize: { width: number; height: number } | null;
  storedMediaRegion: { x: number; y: number; width: number; height: number } | null;
  regionLabel: string | null;
  shared: boolean;
  runtimeFailure: SpecialCoreIncidentRuntimeFailure | null;
  captureSize: { width: number; height: number } | null;
  sourceRegion: { x: number; y: number; width: number; height: number } | null;
  coordinateSpace: "capture-pixels" | "game-viewport-pixels";
}): SpecialCoreIncidentFrameSource | null {
  if (!sourceSize) return null;
  return {
    kind: runtimeFailure
      ? "runtime-error"
      : shared
        ? "normal-shared-parser"
        : "normal-direct-parser",
    parserInputMode: "fullFrame",
    coordinateSpace,
    sourceDimensions: { ...sourceSize },
    captureDimensions: captureSize ? { ...captureSize } : null,
    sourceRegion: sourceRegion ? { ...sourceRegion } : null,
    parserInputRegion: {
      x: 0,
      y: 0,
      width: sourceSize.width,
      height: sourceSize.height,
    },
    storedMediaKind: storedMediaRegion
      ? "buff-slot-top-right-quadrant-v1"
      : null,
    storedMediaRegion: storedMediaRegion ? { ...storedMediaRegion } : null,
    regionLabel,
  };
}

function createSpecialCoreIncidentParser({
  engine,
  version,
  fallbackReason,
  runtime,
}: {
  engine: "rule" | "dl" | null;
  version: string | null;
  fallbackReason: string | null;
  runtime: NonNullable<SpecialCoreSampleResponse["parserRuntime"]> | null;
}): SpecialCoreIncidentParser | null {
  if (!engine && !version && !runtime) return null;
  return {
    engine,
    version,
    fallbackReason,
    runtime: runtime ? { ...runtime } : null,
  };
}

function createSpecialCoreIncidentTimings({
  analysis,
  sharedBuffSlotAnalysis,
}: {
  analysis: SpecialCoreSampleResponse | null;
  sharedBuffSlotAnalysis: SharedBuffSlotAnalysisResult | null;
}) {
  const analysisPerformance = analysis?.performance ?? null;
  const sharedPerformance = sharedBuffSlotAnalysis?.performance ?? null;
  if (!analysisPerformance && !sharedPerformance) return null;
  return {
    totalMs: analysisPerformance?.totalMs ?? sharedPerformance?.totalMs ?? 0,
    detectMs: analysisPerformance?.detectMs ?? sharedPerformance?.detectMs ?? 0,
    matchMs: analysisPerformance?.matchMs ?? 0,
    sharedParserTotalMs: sharedPerformance?.totalMs ?? null,
    sharedParserDetectMs: sharedPerformance?.detectMs ?? null,
    resultAgeMs: sharedPerformance?.resultAgeMs ?? null,
    droppedSampleCount: sharedPerformance?.droppedSampleCount ?? null,
  };
}

function getContextSourceSize(
  context: MonitoringFrameContext | null,
): { width: number; height: number } | null {
  if (context?.gameViewport) {
    return {
      width: context.gameViewport.region.width,
      height: context.gameViewport.region.height,
    };
  }
  if (!context?.video.videoWidth || !context.video.videoHeight) return null;
  return {
    width: context.video.videoWidth,
    height: context.video.videoHeight,
  };
}

function toIncidentBox(box: {
  x: number;
  y: number;
  size: number;
  confidence: number;
  score: number;
}) {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    size: Math.round(box.size),
    confidence: box.confidence,
    score: box.score,
  };
}

function createParserRuntimeGeneration(
  runtime: NonNullable<SpecialCoreSampleResponse["parserRuntime"]> | null,
): string {
  if (!runtime) return "unavailable";
  return `${runtime.executionProvider}:${runtime.selectionSource}:${runtime.modelId}`;
}
