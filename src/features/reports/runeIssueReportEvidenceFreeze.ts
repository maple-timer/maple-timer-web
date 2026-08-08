import type { RuneRuntimeState, RuneSnapshot } from "../../alertTypes";
import type { RelativeRegion, RuneAlertConfig } from "../../types";

export type FrozenRuneIssueReportEvidence = {
  capturedAt: number;
  frameLayoutKey: string | null;
  currentRegion: RelativeRegion | null;
  runeConfig: RuneAlertConfig;
  runtimeState: RuneRuntimeState;
  snapshot: RuneSnapshot | null;
};

export function createFrozenRuneIssueReportEvidence({
  capturedAt,
  frameLayoutKey,
  currentRegion,
  runeConfig,
  runtimeState,
  snapshot,
}: FrozenRuneIssueReportEvidence): FrozenRuneIssueReportEvidence {
  return {
    capturedAt,
    frameLayoutKey,
    currentRegion: cloneRegion(currentRegion),
    runeConfig: cloneRuneConfig(runeConfig),
    runtimeState: cloneRuneRuntimeState(runtimeState),
    snapshot: cloneRuneSnapshotMetadata(snapshot),
  };
}

function cloneRuneConfig(config: RuneAlertConfig): RuneAlertConfig {
  return {
    ...config,
    region: cloneRegion(config.region),
    regionsByLayout: config.regionsByLayout
      ? Object.fromEntries(
          Object.entries(config.regionsByLayout).map(([key, region]) => [
            key,
            cloneRegion(region)!,
          ]),
        )
      : undefined,
  };
}

function cloneRuneRuntimeState(state: RuneRuntimeState): RuneRuntimeState {
  return {
    ...state,
    lastDetectedCandidate: state.lastDetectedCandidate
      ? { ...state.lastDetectedCandidate }
      : null,
    alertedCandidate: state.alertedCandidate ? { ...state.alertedCandidate } : null,
    lastAlertPlayback: state.lastAlertPlayback ? { ...state.lastAlertPlayback } : null,
    lastDetectionError: state.lastDetectionError ? { ...state.lastDetectionError } : null,
    recentSamples: state.recentSamples?.map((sample) => ({
      ...sample,
      candidate: sample.candidate ? { ...sample.candidate } : null,
      error: sample.error ? { ...sample.error } : null,
    })),
  };
}

function cloneRuneSnapshotMetadata(snapshot: RuneSnapshot | null): RuneSnapshot | null {
  if (!snapshot) {
    return null;
  }
  return {
    ...snapshot,
    detectionDebug: snapshot.detectionDebug ? { ...snapshot.detectionDebug } : null,
    detectionError: snapshot.detectionError ? { ...snapshot.detectionError } : null,
    candidate: snapshot.candidate ? { ...snapshot.candidate } : null,
    runtimeIncident: snapshot.runtimeIncident
      ? cloneRuntimeIncident(snapshot.runtimeIncident)
      : null,
    pendingAlertTriggerFrames: snapshot.pendingAlertTriggerFrames?.map((frame) => ({
      ...frame,
      detectionDebug: frame.detectionDebug ? { ...frame.detectionDebug } : null,
      candidate: frame.candidate ? { ...frame.candidate } : null,
    })),
    lastAlertTrigger: snapshot.lastAlertTrigger
      ? cloneAlertTrigger(snapshot.lastAlertTrigger)
      : null,
    evidenceMediaBudget: snapshot.evidenceMediaBudget
      ? {
          ...snapshot.evidenceMediaBudget,
          retainedFrameIds: [...snapshot.evidenceMediaBudget.retainedFrameIds],
        }
      : null,
    evidenceArchive: snapshot.evidenceArchive
      ? {
          ...snapshot.evidenceArchive,
          runtimeIncidents: snapshot.evidenceArchive.runtimeIncidents.map(
            cloneRuntimeIncident,
          ),
          alertTriggers: snapshot.evidenceArchive.alertTriggers.map(
            cloneAlertTrigger,
          ),
          mediaBudget: {
            ...snapshot.evidenceArchive.mediaBudget,
            retainedFrameIds: [
              ...snapshot.evidenceArchive.mediaBudget.retainedFrameIds,
            ],
          },
        }
      : null,
  };
}

function cloneRuntimeIncident(
  incident: NonNullable<RuneSnapshot["runtimeIncident"]>,
) {
  return {
    ...incident,
    frames: incident.frames.map((frame) => ({
      ...frame,
      detectionDebug: frame.detectionDebug ? { ...frame.detectionDebug } : null,
      detectionError: frame.detectionError ? { ...frame.detectionError } : null,
      candidate: frame.candidate ? { ...frame.candidate } : null,
      stateBefore: frame.stateBefore ? { ...frame.stateBefore } : undefined,
      stateAfter: frame.stateAfter ? { ...frame.stateAfter } : undefined,
    })),
  };
}

function cloneAlertTrigger(
  trigger: NonNullable<RuneSnapshot["lastAlertTrigger"]>,
) {
  return {
    ...trigger,
    frames: trigger.frames.map((frame) => ({
      ...frame,
      detectionDebug: frame.detectionDebug ? { ...frame.detectionDebug } : null,
      candidate: frame.candidate ? { ...frame.candidate } : null,
    })),
  };
}

function cloneRegion(region: RelativeRegion | null): RelativeRegion | null {
  return region ? { ...region } : null;
}
