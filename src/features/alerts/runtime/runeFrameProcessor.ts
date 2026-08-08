import type {
  RuneDetectionRuntimeError,
  RuneRuntimeState,
  RuneSnapshot,
} from "../../../alertTypes";
import {
  cropRuneCandidateToImageData,
  cropRuneCandidateToUrl,
  imageDataToUrl,
} from "../../../lib/imageData";
import { cloneImageDataSnapshot } from "../../../lib/imageDataSnapshot";
import { getSkillRegionForLayout, hasUsableRegion } from "../../../lib/regions";
import {
  attachRuneAlertPlaybackDetails,
  markRuneDetectorUnavailable,
  updateRuneRuntimeState,
} from "../../../lib/runeAlert";
import { updateRuneAlertTriggerEvidence } from "../../../lib/runeAlertTriggerEvidence";
import { RUNE_REQUIRED_STABLE_FRAMES } from "../../../lib/runeAlertPolicy";
import {
  createRuneRuntimeIncidentEvidenceState,
  updateRuneRuntimeIncidentEvidence,
  type RuneRuntimeIncidentEvidenceState,
} from "../../../lib/runeRuntimeIncidentEvidence";
import { createRuneMaskPreview } from "../../../lib/runeDetection";
import { getRuneDetectionEvidenceCandidate } from "../../../recognition/rune/runeOnnxContract";
import type { RuneDetectionResult } from "../../../recognition/rune/runeDetectionTypes";
import { getRuneDetectionWorkerErrorDetails } from "../../../platform/runtime-workers/rune/runeDetectionWorkerClient";
import { createDefaultRuneAlert } from "../../../lib/storage";
import {
  createRuneSceneTrackerState,
  type RuneSceneTrackerState,
  updateRuneSceneTracker,
} from "../../../lib/runeSceneIdentity";
import type { Profile } from "../../../types";
import {
  applyMasterVolume,
  clampAlertVolume,
  clampMasterVolume,
} from "../../../lib/volume";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import { updateRuneEvidenceArchive } from "../../../lib/runeEvidenceArchive";

const RUNE_LIVE_PREVIEW_INTERVAL_MS = 2000;
const RUNE_SAMPLE_PREVIEW_MAX_WIDTH = 420;
const RUNE_CANVAS_ERROR_MESSAGE = "룬 감지용 캔버스를 준비하지 못했습니다.";

export type RuneFramePreviewState = {
  lastPreviewAt: number;
  rawPreviewUrl: string | null;
  rawPreviewImageData: RuneSnapshot["rawPreviewImageData"];
  maskPreviewUrl: string | null;
  maskPreviewImageData: RuneSnapshot["maskPreviewImageData"];
  sceneTracker: RuneSceneTrackerState;
  runtimeIncidentEvidence: RuneRuntimeIncidentEvidenceState;
};

export type RuneFrameProcessResult = {
  state: RuneRuntimeState;
  snapshot: RuneSnapshot | null;
  previewState: RuneFramePreviewState;
  shouldAlert: boolean;
  alertDecision: "initial" | "repeat" | null;
  alertCycleStartedAt: number | null;
  alertPlaybackId: string | null;
  soundId: string;
  volume: number;
  errorMessage: string | null;
  detectorOutcome: "inactive" | "success" | "error" | "frame-error";
  detectionError: RuneDetectionRuntimeError | null;
};

export type RuneDetectionRunner = {
  detect: (imageData: ImageData) => RuneDetectionResult | Promise<RuneDetectionResult>;
};

export function createRuneFramePreviewState(): RuneFramePreviewState {
  return {
    lastPreviewAt: 0,
    rawPreviewUrl: null,
    rawPreviewImageData: null,
    maskPreviewUrl: null,
    maskPreviewImageData: null,
    sceneTracker: createRuneSceneTrackerState(),
    runtimeIncidentEvidence: createRuneRuntimeIncidentEvidenceState(),
  };
}

export async function processRuneFrameSample({
  context,
  detector,
  previewState,
  profile,
  previousState,
  previousSnapshot,
  showDebugColumns,
  detectorRetryCount = 0,
}: {
  context: MonitoringFrameContext;
  detector?: RuneDetectionRunner;
  previewState: RuneFramePreviewState;
  profile: Profile;
  previousState: RuneRuntimeState;
  previousSnapshot: RuneSnapshot | null;
  showDebugColumns: boolean;
  detectorRetryCount?: number;
}): Promise<RuneFrameProcessResult> {
  const { frameLayoutKey, sampledAt } = context;
  const runeConfig = profile.runeAlert ?? createDefaultRuneAlert();
  const runeRegion = getSkillRegionForLayout(runeConfig, frameLayoutKey);
  const hasRegion = hasUsableRegion(runeRegion);

  if (!runeConfig.enabled || !hasRegion) {
    const update = updateRuneRuntimeState({
      previous: previousState,
      detection: null,
      now: sampledAt,
      enabled: runeConfig.enabled,
      hasStream: true,
      hasRegion,
      config: runeConfig,
    });
    return {
      state: update.state,
      snapshot: null,
      previewState: {
        ...previewState,
        sceneTracker: createRuneSceneTrackerState(),
        runtimeIncidentEvidence: createRuneRuntimeIncidentEvidenceState(),
      },
      shouldAlert: false,
      alertDecision: null,
      alertCycleStartedAt: null,
      alertPlaybackId: null,
      soundId: runeConfig.soundId,
      volume: runeConfig.volume,
      errorMessage: null,
      detectorOutcome: "inactive",
      detectionError: null,
    };
  }

  let detectorStarted = false;
  let nextSceneTracker = previewState.sceneTracker;
  let frameSample: ReturnType<MonitoringFrameContext["sampleVideoRegion"]> | null = null;
  let shouldRefreshLivePreview = false;
  try {
    shouldRefreshLivePreview = shouldIncludeRuneLivePreview({
      previewState,
      sampledAt,
    });
    const sample = context.sampleVideoRegion(
      runeRegion,
      shouldRefreshLivePreview,
      RUNE_SAMPLE_PREVIEW_MAX_WIDTH,
    );
    frameSample = sample;
    const sceneUpdate = updateRuneSceneTracker(
      previewState.sceneTracker,
      sample.imageData,
      sampledAt,
    );
    nextSceneTracker = sceneUpdate.state;
    if (!detector) {
      detectorStarted = true;
      throw new Error("rune-detection-worker-unavailable");
    }
    detectorStarted = true;
    const detection = await detector.detect(sample.imageData);
    const bestCandidate = detection.candidates[0] ?? null;
    const evidenceCandidate = getRuneDetectionEvidenceCandidate(detection);
    const update = updateRuneRuntimeState({
      previous: previousState,
      detection,
      now: sampledAt,
      enabled: runeConfig.enabled,
      hasStream: true,
      hasRegion: true,
      config: runeConfig,
      scene: sceneUpdate.observation,
    });
    const alertPlaybackId = update.shouldAlert
      ? update.state.lastAlertPlayback?.cycleId ?? null
      : null;
    const runtimeState = alertPlaybackId
      ? attachRuneAlertPlaybackDetails(update.state, alertPlaybackId, {
          soundId: runeConfig.soundId,
          alertVolume: clampAlertVolume(runeConfig.volume),
          masterVolume: clampMasterVolume(context.masterVolume),
          effectiveVolume: applyMasterVolume(runeConfig.volume, context.masterVolume),
        })
      : update.state;
    const alertedCandidate = update.shouldAlert ? bestCandidate : null;
    const needsAlertEvidence = Boolean(alertedCandidate);
    const shouldCaptureTriggerFrame =
      detection.detected && runtimeState.stableCount <= RUNE_REQUIRED_STABLE_FRAMES;
    let currentRawDataUrl = sample.rawPreviewUrl;
    const getCurrentRawDataUrl = () => {
      currentRawDataUrl ??= imageDataToUrl(sample.imageData);
      return currentRawDataUrl;
    };
    const triggerRawDataUrl = shouldCaptureTriggerFrame
      ? getCurrentRawDataUrl()
      : null;
    const alertRawDataUrl = needsAlertEvidence
      ? triggerRawDataUrl ?? getCurrentRawDataUrl()
      : null;
    const runtimeIncidentEvidence = updateRuneRuntimeIncidentEvidence({
      previous: previewState.runtimeIncidentEvidence,
      detection,
      runtimeState,
      runtimeStateBefore: previousState,
      sampledAt,
      previewRawDataUrl: shouldRefreshLivePreview ? sample.rawPreviewUrl : null,
      createRawDataUrl: getCurrentRawDataUrl,
    });
    const rawPreviewUrl =
      shouldRefreshLivePreview
        ? sample.rawPreviewUrl
        : needsAlertEvidence
          ? alertRawDataUrl
          : previewState.rawPreviewUrl;
    const rawPreviewImageData =
      shouldRefreshLivePreview || needsAlertEvidence
        ? cloneImageDataSnapshot(sample.imageData)
        : previewState.rawPreviewImageData ?? null;
    const shouldBuildMaskPreview =
      needsAlertEvidence || (showDebugColumns && shouldRefreshLivePreview);
    const maskPreviewImageData =
      shouldBuildMaskPreview
        ? createRuneMaskPreview(
            sample.imageData,
            evidenceCandidate ? [evidenceCandidate] : [],
          )
        : null;
    const maskPreviewUrl =
      maskPreviewImageData
        ? imageDataToUrl(maskPreviewImageData)
        : previewState.maskPreviewUrl;
    const nextPreviewState =
      shouldRefreshLivePreview || needsAlertEvidence || maskPreviewImageData
        ? {
            lastPreviewAt: sampledAt,
            rawPreviewUrl,
            rawPreviewImageData,
            maskPreviewUrl,
            maskPreviewImageData:
              cloneImageDataSnapshot(maskPreviewImageData) ??
              previewState.maskPreviewImageData ??
              null,
            sceneTracker: nextSceneTracker,
            runtimeIncidentEvidence,
          }
        : {
            ...previewState,
            sceneTracker: nextSceneTracker,
            runtimeIncidentEvidence,
          };
    const candidatePreviewUrl =
      alertedCandidate
        ? cropRuneCandidateToUrl(sample.imageData, alertedCandidate) ??
          previousSnapshot?.candidatePreviewUrl ??
          null
        : previousSnapshot?.candidatePreviewUrl ?? null;
    const candidatePreviewImageData =
      alertedCandidate
        ? cloneImageDataSnapshot(cropRuneCandidateToImageData(sample.imageData, alertedCandidate)) ??
          previousSnapshot?.candidatePreviewImageData ??
          null
        : previousSnapshot?.candidatePreviewImageData ?? null;
    const candidateRawPreviewUrl = alertedCandidate
      ? rawPreviewUrl
      : previousSnapshot?.candidateRawPreviewUrl ?? null;
    const candidateRawPreviewImageData = alertedCandidate
      ? rawPreviewImageData
      : previousSnapshot?.candidateRawPreviewImageData ?? null;
    const candidateMaskPreviewUrl = alertedCandidate
      ? maskPreviewUrl
      : previousSnapshot?.candidateMaskPreviewUrl ?? null;
    const candidateMaskPreviewImageData = alertedCandidate
      ? nextPreviewState.maskPreviewImageData
      : previousSnapshot?.candidateMaskPreviewImageData ?? null;
    const candidateRegionLabel = alertedCandidate
      ? `${alertedCandidate.width}x${alertedCandidate.height}`
      : previousSnapshot?.candidateRegionLabel ?? null;
    const candidateSampledAt = alertedCandidate
      ? sampledAt
      : previousSnapshot?.candidateSampledAt ?? null;
    const candidate = alertedCandidate
      ? {
          x: alertedCandidate.x,
          y: alertedCandidate.y,
          width: alertedCandidate.width,
          height: alertedCandidate.height,
          confidence: alertedCandidate.confidence,
          source: alertedCandidate.source ?? null,
        }
      : previousSnapshot?.candidate ?? null;
    const triggerEvidence = updateRuneAlertTriggerEvidence({
      previousSnapshot,
      detection,
      state: runtimeState,
      sampledAt,
      rawDataUrl: triggerRawDataUrl,
      alertPlaybackId,
      alertDecision: update.alertDecision,
    });
    const archivedEvidence = updateRuneEvidenceArchive({
      previousArchive: previousSnapshot?.evidenceArchive,
      runtimeIncident: runtimeIncidentEvidence.incident,
      pendingAlertTriggerFrames: triggerEvidence.pendingFrames,
      lastAlertTrigger: triggerEvidence.lastAlertTrigger,
      sampledAt,
    });
    const boundedPreviewState = {
      ...nextPreviewState,
      runtimeIncidentEvidence: {
        ...runtimeIncidentEvidence,
        incident: archivedEvidence.runtimeIncident,
      },
    };

    return {
      state: runtimeState,
      snapshot: {
        sampledAt,
        detectorVersion: detection.debug.classifier ?? null,
        detectionDebug: toRuneSnapshotDetectionDebug(detection),
        detectionError: null,
        rawPreviewUrl,
        rawPreviewImageData,
        maskPreviewUrl,
        maskPreviewImageData:
          nextPreviewState.maskPreviewImageData ??
          previousSnapshot?.maskPreviewImageData ??
          null,
        candidatePreviewUrl,
        candidatePreviewImageData,
        candidateRawPreviewUrl,
        candidateRawPreviewImageData,
        candidateMaskPreviewUrl,
        candidateMaskPreviewImageData,
        candidateRegionLabel,
        candidateSampledAt,
        candidate,
        detected: detection.detected,
        confidence: detection.confidence,
        candidateCount: detection.candidates.length,
        runtimeIncident: archivedEvidence.runtimeIncident,
        pendingAlertTriggerFrames: archivedEvidence.pendingAlertTriggerFrames,
        lastAlertTrigger: archivedEvidence.lastAlertTrigger,
        evidenceMediaBudget: archivedEvidence.archive?.mediaBudget ?? null,
        evidenceArchive: archivedEvidence.archive,
      },
      previewState: boundedPreviewState,
      shouldAlert: update.shouldAlert,
      alertDecision: update.alertDecision,
      alertCycleStartedAt: runtimeState.alertedAt,
      alertPlaybackId,
      soundId: runeConfig.soundId,
      volume: runeConfig.volume,
      errorMessage: null,
      detectorOutcome: "success",
      detectionError: null,
    };
  } catch (error) {
    if (detectorStarted) {
      const details = getRuneDetectionWorkerErrorDetails(error);
      const isUnavailableDetector =
        details.code === "rune-detection-worker-runtime-failed" &&
        details.message === "rune-detection-worker-unavailable";
      const detectionError: RuneDetectionRuntimeError = {
        ...details,
        code: isUnavailableDetector ? "rune-detection-worker-unavailable" : details.code,
        phase: isUnavailableDetector ? "worker-unavailable" : details.phase,
        occurredAt: sampledAt,
        retryCount: detectorRetryCount,
      };
      const runtimeState = markRuneDetectorUnavailable({
        previous: previousState,
        error: detectionError,
      });
      let currentRawDataUrl = frameSample?.rawPreviewUrl ?? null;
      const getCurrentRawDataUrl = () => {
        if (!currentRawDataUrl && frameSample) {
          currentRawDataUrl = imageDataToUrl(frameSample.imageData);
        }
        return currentRawDataUrl;
      };
      const runtimeIncidentEvidence = updateRuneRuntimeIncidentEvidence({
        previous: previewState.runtimeIncidentEvidence,
        detection: null,
        runtimeState,
        runtimeStateBefore: previousState,
        sampledAt,
        previewRawDataUrl:
          shouldRefreshLivePreview ? frameSample?.rawPreviewUrl ?? null : null,
        createRawDataUrl: getCurrentRawDataUrl,
        detectionError,
      });
      const archivedEvidence = updateRuneEvidenceArchive({
        previousArchive: previousSnapshot?.evidenceArchive,
        runtimeIncident: runtimeIncidentEvidence.incident,
        pendingAlertTriggerFrames:
          previousSnapshot?.pendingAlertTriggerFrames ?? [],
        lastAlertTrigger: previousSnapshot?.lastAlertTrigger ?? null,
        sampledAt,
      });
      return {
        state: runtimeState,
        snapshot: {
          sampledAt,
          detectorVersion: previousSnapshot?.detectorVersion ?? null,
          detectionDebug: previousSnapshot?.detectionDebug ?? null,
          detectionError,
          rawPreviewUrl: previewState.rawPreviewUrl,
          rawPreviewImageData: previewState.rawPreviewImageData,
          maskPreviewUrl: previewState.maskPreviewUrl,
          maskPreviewImageData: previewState.maskPreviewImageData,
          candidatePreviewUrl: previousSnapshot?.candidatePreviewUrl ?? null,
          candidatePreviewImageData: previousSnapshot?.candidatePreviewImageData ?? null,
          candidateRawPreviewUrl: previousSnapshot?.candidateRawPreviewUrl ?? null,
          candidateRawPreviewImageData: previousSnapshot?.candidateRawPreviewImageData ?? null,
          candidateMaskPreviewUrl: previousSnapshot?.candidateMaskPreviewUrl ?? null,
          candidateMaskPreviewImageData: previousSnapshot?.candidateMaskPreviewImageData ?? null,
          candidateRegionLabel: previousSnapshot?.candidateRegionLabel ?? null,
          candidateSampledAt: previousSnapshot?.candidateSampledAt ?? null,
          candidate: previousSnapshot?.candidate ?? null,
          detected: false,
          confidence: 0,
          candidateCount: 0,
          runtimeIncident: archivedEvidence.runtimeIncident,
          pendingAlertTriggerFrames: archivedEvidence.pendingAlertTriggerFrames,
          lastAlertTrigger: archivedEvidence.lastAlertTrigger,
          evidenceMediaBudget: archivedEvidence.archive?.mediaBudget ?? null,
          evidenceArchive: archivedEvidence.archive,
        },
        previewState: {
          ...previewState,
          sceneTracker: nextSceneTracker,
          runtimeIncidentEvidence: {
            ...runtimeIncidentEvidence,
            incident: archivedEvidence.runtimeIncident,
          },
        },
        shouldAlert: false,
        alertDecision: null,
        alertCycleStartedAt: null,
        alertPlaybackId: null,
        soundId: runeConfig.soundId,
        volume: runeConfig.volume,
        errorMessage: null,
        detectorOutcome: "error",
        detectionError,
      };
    }
    const update = updateRuneRuntimeState({
      previous: previousState,
      detection: null,
      now: sampledAt,
      enabled: runeConfig.enabled,
      hasStream: true,
      hasRegion: true,
      config: runeConfig,
    });
    const runtimeIncidentEvidence = updateRuneRuntimeIncidentEvidence({
      previous: previewState.runtimeIncidentEvidence,
      detection: null,
      runtimeState: update.state,
      runtimeStateBefore: previousState,
      sampledAt,
      previewRawDataUrl: null,
      createRawDataUrl: () => null,
    });
    const archivedEvidence = updateRuneEvidenceArchive({
      previousArchive: previousSnapshot?.evidenceArchive,
      runtimeIncident: runtimeIncidentEvidence.incident,
      pendingAlertTriggerFrames:
        previousSnapshot?.pendingAlertTriggerFrames ?? [],
      lastAlertTrigger: previousSnapshot?.lastAlertTrigger ?? null,
      sampledAt,
    });
    return {
      state: update.state,
      snapshot: {
        sampledAt,
        detectorVersion: previousSnapshot?.detectorVersion ?? null,
        detectionDebug: previousSnapshot?.detectionDebug ?? null,
        detectionError: null,
        rawPreviewUrl: previewState.rawPreviewUrl,
        rawPreviewImageData: previewState.rawPreviewImageData,
        maskPreviewUrl: previewState.maskPreviewUrl,
        maskPreviewImageData: previewState.maskPreviewImageData,
        candidatePreviewUrl: previousSnapshot?.candidatePreviewUrl ?? null,
        candidatePreviewImageData: previousSnapshot?.candidatePreviewImageData ?? null,
        candidateRawPreviewUrl: previousSnapshot?.candidateRawPreviewUrl ?? null,
        candidateRawPreviewImageData: previousSnapshot?.candidateRawPreviewImageData ?? null,
        candidateMaskPreviewUrl: previousSnapshot?.candidateMaskPreviewUrl ?? null,
        candidateMaskPreviewImageData: previousSnapshot?.candidateMaskPreviewImageData ?? null,
        candidateRegionLabel: previousSnapshot?.candidateRegionLabel ?? null,
        candidateSampledAt: previousSnapshot?.candidateSampledAt ?? null,
        candidate: previousSnapshot?.candidate ?? null,
        detected: false,
        confidence: 0,
        candidateCount: 0,
        runtimeIncident: archivedEvidence.runtimeIncident,
        pendingAlertTriggerFrames: archivedEvidence.pendingAlertTriggerFrames,
        lastAlertTrigger: archivedEvidence.lastAlertTrigger,
        evidenceMediaBudget: archivedEvidence.archive?.mediaBudget ?? null,
        evidenceArchive: archivedEvidence.archive,
      },
      previewState: {
        ...previewState,
        sceneTracker: nextSceneTracker,
        runtimeIncidentEvidence: {
          ...runtimeIncidentEvidence,
          incident: archivedEvidence.runtimeIncident,
        },
      },
      shouldAlert: false,
      alertDecision: null,
      alertCycleStartedAt: null,
      alertPlaybackId: null,
      soundId: runeConfig.soundId,
      volume: runeConfig.volume,
      errorMessage:
        error instanceof Error && error.message === "canvas-context-unavailable"
          ? RUNE_CANVAS_ERROR_MESSAGE
          : null,
      detectorOutcome: "frame-error",
      detectionError: null,
    };
  }
}

function toRuneSnapshotDetectionDebug(
  detection: RuneDetectionResult,
): NonNullable<RuneSnapshot["detectionDebug"]> {
  return {
    detectorKind: detection.debug.detectorKind ?? null,
    classifier: detection.debug.classifier ?? null,
    proposalCount: detection.debug.proposalCount ?? null,
    proposalScore: detection.debug.proposalScore ?? null,
    selectedProposalRank: detection.debug.selectedProposalRank ?? null,
    shapeScore: detection.debug.shapeScore ?? null,
    shapeThreshold: detection.debug.shapeThreshold ?? null,
    shapePass: detection.debug.shapePass ?? null,
    appearanceScore: detection.debug.appearanceScore ?? null,
    appearanceThreshold: detection.debug.appearanceThreshold ?? null,
    appearancePass: detection.debug.appearancePass ?? null,
    modelScore: detection.debug.modelScore ?? null,
    modelThreshold: detection.debug.modelThreshold ?? null,
    proposalInferenceMs: detection.debug.proposalInferenceMs ?? null,
    gateInferenceMs: detection.debug.gateInferenceMs ?? null,
    inferenceMs: detection.debug.inferenceMs ?? null,
    reason: detection.debug.reason ?? null,
  };
}

function shouldIncludeRuneLivePreview({
  previewState,
  sampledAt,
}: {
  previewState: RuneFramePreviewState;
  sampledAt: number;
}) {
  return (
    !previewState.rawPreviewUrl ||
    sampledAt - previewState.lastPreviewAt >= RUNE_LIVE_PREVIEW_INTERVAL_MS
  );
}
