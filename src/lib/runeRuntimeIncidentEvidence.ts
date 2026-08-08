import type {
  RuneDetectionRuntimeError,
  RuneRuntimeIncidentEvidence,
  RuneRuntimeIncidentFrame,
  RuneRuntimeState,
  RuneSnapshotCandidate,
  RuneSnapshotDetectionDebug,
} from "../alertTypes";
import { RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS } from "../contracts/reporting/runtimeEvidenceMediaPolicy";
import { getRuneDetectionEpisodeId } from "./runeEpisodeIdentity";
import type { RuneDetectionResult } from "../recognition/rune/runeDetectionTypes";

export const RUNE_RUNTIME_INCIDENT_RETENTION_MS = 60_000;
export const RUNE_RUNTIME_INCIDENT_MAX_FRAMES = 6;
export const RUNE_RUNTIME_INCIDENT_MAX_DATA_URL_BYTES =
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS.rune;
export const RUNE_RUNTIME_INCIDENT_MAX_FRAME_BYTES = 512_000;
export const RUNE_RUNTIME_INCIDENT_NEAR_THRESHOLD_RATIO = 0.75;

const RUNE_RUNTIME_INCIDENT_MAX_SIGNAL_FRAMES = 3;
const RUNE_RUNTIME_INCIDENT_MAX_AFTER_FRAMES = 2;
const RUNE_RUNTIME_INCIDENT_SIGNAL_GAP_MS = 3_000;
const RUNE_RUNTIME_INCIDENT_PRELUDE_MAX_AGE_MS = 3_000;

export type RuneRuntimeIncidentEvidenceState = {
  preludeFrame: RuneRuntimeIncidentFrame | null;
  incident: RuneRuntimeIncidentEvidence | null;
};

export function createRuneRuntimeIncidentEvidenceState(): RuneRuntimeIncidentEvidenceState {
  return {
    preludeFrame: null,
    incident: null,
  };
}

export function updateRuneRuntimeIncidentEvidence({
  previous,
  detection,
  runtimeState,
  runtimeStateBefore,
  sampledAt,
  previewRawDataUrl,
  createRawDataUrl,
  detectionError = null,
}: {
  previous: RuneRuntimeIncidentEvidenceState;
  detection: RuneDetectionResult | null;
  runtimeState: RuneRuntimeState;
  runtimeStateBefore?: RuneRuntimeState;
  sampledAt: number;
  previewRawDataUrl: string | null;
  createRawDataUrl: () => string | null;
  detectionError?: RuneDetectionRuntimeError | null;
}): RuneRuntimeIncidentEvidenceState {
  let incident = getRetainedIncident(previous.incident, sampledAt);
  const outcome = getFrameOutcome(detection, detectionError);
  const isSignal = outcome === "detected" || outcome === "near-threshold" || outcome === "error";

  if (isSignal) {
    const continuesIncident = Boolean(
      incident &&
      incident.sceneEpoch === (runtimeState.sceneEpoch ?? 0) &&
      sampledAt - incident.lastSignalAt <= RUNE_RUNTIME_INCIDENT_SIGNAL_GAP_MS,
    );
    const existingSignalFrames = continuesIncident
      ? incident?.frames.filter((frame) => frame.phase === "signal") ?? []
      : [];
    const shouldCaptureSignal = existingSignalFrames.length < RUNE_RUNTIME_INCIDENT_MAX_SIGNAL_FRAMES;
    const signalFrame = shouldCaptureSignal
      ? createFrame({
          phase: "signal",
          outcome,
          sampledAt,
          rawDataUrl: createRawDataUrl(),
          detection,
          runtimeState,
          runtimeStateBefore: runtimeStateBefore ?? runtimeState,
          detectionError,
        })
      : null;

    if (!continuesIncident) {
      const preludeFrame = isRecentPrelude(previous.preludeFrame, sampledAt)
        ? previous.preludeFrame
        : null;
      const frames = enforceIncidentBudget(
        [preludeFrame, signalFrame].filter(
          (frame): frame is RuneRuntimeIncidentFrame => Boolean(frame),
        ),
      );
      incident = frames.length > 0
        ? {
            schemaVersion: "rune-runtime-incident-v1",
            id: `${runtimeState.sceneEpoch ?? 0}:${sampledAt}`,
            episodeId: getRuneDetectionEpisodeId(runtimeState),
            startedAt: frames[0]?.sampledAt ?? sampledAt,
            lastSignalAt: sampledAt,
            updatedAt: sampledAt,
            expiresAt: sampledAt + RUNE_RUNTIME_INCIDENT_RETENTION_MS,
            detectorVersion:
              detection?.debug.classifier ?? runtimeState.detectorVersion ?? null,
            sceneEpoch: runtimeState.sceneEpoch ?? 0,
            frames,
          }
        : null;
    } else if (incident) {
      const framesWithoutEarlierAfter = incident.frames.filter(
        (frame) => frame.phase !== "after",
      );
      incident = {
        ...incident,
        lastSignalAt: sampledAt,
        updatedAt: sampledAt,
        expiresAt: sampledAt + RUNE_RUNTIME_INCIDENT_RETENTION_MS,
        detectorVersion:
          detection?.debug.classifier ?? incident.detectorVersion ?? runtimeState.detectorVersion ?? null,
        frames: enforceIncidentBudget(
          signalFrame ? [...framesWithoutEarlierAfter, signalFrame] : framesWithoutEarlierAfter,
        ),
      };
    }

    return {
      preludeFrame: previous.preludeFrame,
      incident,
    };
  }

  if (incident) {
    const afterFrames = incident.frames.filter((frame) => frame.phase === "after");
    const withinAfterWindow =
      sampledAt > incident.lastSignalAt &&
      sampledAt - incident.lastSignalAt <= RUNE_RUNTIME_INCIDENT_SIGNAL_GAP_MS;
    if (withinAfterWindow && afterFrames.length < RUNE_RUNTIME_INCIDENT_MAX_AFTER_FRAMES) {
      const afterFrame = createFrame({
        phase: "after",
        outcome,
        sampledAt,
        rawDataUrl: createRawDataUrl(),
        detection,
        runtimeState,
        runtimeStateBefore: runtimeStateBefore ?? runtimeState,
        detectionError,
      });
      if (afterFrame) {
        incident = {
          ...incident,
          updatedAt: sampledAt,
          expiresAt: sampledAt + RUNE_RUNTIME_INCIDENT_RETENTION_MS,
          frames: enforceIncidentBudget([...incident.frames, afterFrame]),
        };
      }
    }
  }

  const preludeFrame = previewRawDataUrl
    ? createFrame({
        phase: "before",
        outcome,
        sampledAt,
        rawDataUrl: previewRawDataUrl,
        detection,
        runtimeState,
        runtimeStateBefore: runtimeStateBefore ?? runtimeState,
        detectionError,
      })
    : previous.preludeFrame;

  return {
    preludeFrame,
    incident,
  };
}

function getFrameOutcome(
  detection: RuneDetectionResult | null,
  detectionError: RuneDetectionRuntimeError | null,
): RuneRuntimeIncidentFrame["outcome"] {
  if (detectionError) {
    return "error";
  }
  if (detection?.detected) {
    return "detected";
  }
  const score = detection?.debug.modelScore;
  const threshold = detection?.debug.modelThreshold;
  if (
    typeof score === "number" &&
    Number.isFinite(score) &&
    typeof threshold === "number" &&
    Number.isFinite(threshold) &&
    threshold > 0 &&
    score >= threshold * RUNE_RUNTIME_INCIDENT_NEAR_THRESHOLD_RATIO
  ) {
    return "near-threshold";
  }
  return "not-detected";
}

function createFrame({
  phase,
  outcome,
  sampledAt,
  rawDataUrl,
  detection,
  runtimeState,
  runtimeStateBefore,
  detectionError,
}: {
  phase: RuneRuntimeIncidentFrame["phase"];
  outcome: RuneRuntimeIncidentFrame["outcome"];
  sampledAt: number;
  rawDataUrl: string | null;
  detection: RuneDetectionResult | null;
  runtimeState: RuneRuntimeState;
  runtimeStateBefore: RuneRuntimeState;
  detectionError: RuneDetectionRuntimeError | null;
}): RuneRuntimeIncidentFrame | null {
  if (!rawDataUrl || getStringByteLength(rawDataUrl) > RUNE_RUNTIME_INCIDENT_MAX_FRAME_BYTES) {
    return null;
  }
  const trace = [...(runtimeState.recentSamples ?? [])]
    .reverse()
    .find((sample) => sample.sampledAt === sampledAt) ?? null;
  const candidate = detection?.candidates[0] ?? detection?.debug.modelCandidate ?? null;
  return {
    source: "runtime",
    phase,
    outcome,
    sampledAt,
    detectorVersion: detection?.debug.classifier ?? runtimeState.detectorVersion ?? null,
    detectionDebug: detection ? toDetectionDebug(detection) : null,
    detectionError,
    rawDataUrl,
    detected: Boolean(detection?.detected),
    confidence: detection?.confidence ?? 0,
    candidateCount: detection?.candidates.length ?? 0,
    candidate: toSnapshotCandidate(candidate),
    status: runtimeState.status,
    stableCount: runtimeState.stableCount,
    firstDetectedAt: runtimeState.firstDetectedAt,
    stableDurationMs: trace?.stableDurationMs ?? 0,
    confirmationSatisfied: trace?.confirmationSatisfied ?? false,
    confirmationSatisfiedBy: trace?.confirmationSatisfiedBy ?? null,
    shouldAlert: trace?.shouldAlert ?? false,
    reason: trace?.reason ?? runtimeState.lastDecisionReason ?? (detectionError ? "detector-error" : "waiting"),
    sceneEpoch: runtimeState.sceneEpoch ?? 0,
    sceneChanged: trace?.sceneChanged ?? false,
    sceneChangeScore: trace?.sceneChangeScore ?? runtimeState.sceneChangeScore ?? null,
    stateBefore: toRuneRuntimeIncidentFrameState(runtimeStateBefore),
    stateAfter: toRuneRuntimeIncidentFrameState(runtimeState),
  };
}

function toRuneRuntimeIncidentFrameState(state: RuneRuntimeState) {
  return {
    status: state.status,
    stableCount: state.stableCount,
    consecutiveMissCount: state.consecutiveMissCount ?? 0,
    firstDetectedAt: state.firstDetectedAt,
    alertedAt: state.alertedAt,
    lastRepeatedAlertAt: state.lastRepeatedAlertAt,
    repeatedAlertCount: state.repeatedAlertCount,
    sceneEpoch: state.sceneEpoch ?? 0,
    lastDecisionReason: state.lastDecisionReason ?? null,
  };
}

function toDetectionDebug(
  detection: RuneDetectionResult,
): RuneSnapshotDetectionDebug {
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

function toSnapshotCandidate(
  candidate: RuneDetectionResult["candidates"][number] | null,
): RuneSnapshotCandidate | null {
  if (!candidate) {
    return null;
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    confidence: candidate.confidence,
    source: candidate.source ?? null,
  };
}

function getRetainedIncident(
  incident: RuneRuntimeIncidentEvidence | null,
  sampledAt: number,
) {
  return incident && sampledAt <= incident.expiresAt ? incident : null;
}

function isRecentPrelude(
  frame: RuneRuntimeIncidentFrame | null,
  sampledAt: number,
) {
  return Boolean(
    frame &&
    frame.sampledAt < sampledAt &&
    sampledAt - frame.sampledAt <= RUNE_RUNTIME_INCIDENT_PRELUDE_MAX_AGE_MS,
  );
}

function enforceIncidentBudget(
  frames: RuneRuntimeIncidentFrame[],
): RuneRuntimeIncidentFrame[] {
  const next = [...frames]
    .sort((left, right) => left.sampledAt - right.sampledAt)
    .slice(-RUNE_RUNTIME_INCIDENT_MAX_FRAMES);
  while (
    next.length > 0 &&
    next.reduce((total, frame) => total + getStringByteLength(frame.rawDataUrl), 0) >
      RUNE_RUNTIME_INCIDENT_MAX_DATA_URL_BYTES
  ) {
    const removableIndex = next.findIndex((frame) => frame.phase === "before");
    if (removableIndex >= 0) {
      next.splice(removableIndex, 1);
      continue;
    }
    const afterIndex = next.findIndex((frame) => frame.phase === "after");
    if (afterIndex >= 0) {
      next.splice(afterIndex, 1);
      continue;
    }
    next.shift();
  }
  return next;
}

function getStringByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
