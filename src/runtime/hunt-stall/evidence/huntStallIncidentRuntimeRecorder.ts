import type { HuntStallRuntimeState } from "../../../alertTypes";
import {
  acceptHuntStallIncidentActivity,
  createHuntStallIncidentBoundary,
  getHuntStallIncidentContinuityResetReason,
  recordHuntStallIncidentAlertDecision,
  recordHuntStallIncidentFrame,
  recordHuntStallIncidentObservation,
  requestHuntStallIncidentPlayback,
  resetHuntStallIncidentBoundary,
  reviseHuntStallIncidentConfiguration,
  transitionHuntStallIncidentPlayback,
} from "./huntStallIncidentBoundary";
import {
  createHuntStallIncidentEvidenceArchive,
  updateHuntStallIncidentEvidenceArchive,
  type HuntStallIncidentEvidencePatch,
} from "./huntStallIncidentEvidenceArchive";
import type {
  HuntStallIncidentActivityReason,
  HuntStallIncidentBoundaryRejectReason,
  HuntStallIncidentBoundaryState,
  HuntStallIncidentConfiguration,
  HuntStallIncidentContinuity,
  HuntStallIncidentEvidenceArchive,
  HuntStallIncidentEvidenceOmission,
  HuntStallIncidentFrame,
  HuntStallIncidentFrozenState,
  HuntStallIncidentLifecycleEvent,
  HuntStallIncidentMediaFrame,
  HuntStallIncidentMediaReason,
  HuntStallIncidentObservation,
  HuntStallIncidentRecognition,
  HuntStallIncidentRecognizerProvenance,
  HuntStallIncidentRegion,
  HuntStallIncidentResetReason,
  HuntStallIncidentRuntimeFailure,
} from "./huntStallIncidentEvidenceTypes";

type PendingReset = {
  reason: Exclude<HuntStallIncidentResetReason, "initialized">;
  requestedAt: number;
};

export type HuntStallIncidentRuntimeRecorder = {
  boundary: HuntStallIncidentBoundaryState | null;
  archive: HuntStallIncidentEvidenceArchive;
  captureGeneration: number;
  featureGeneration: number;
  workerGeneration: number;
  lifecycleSequence: number;
  presentationSequence: number;
  latestPresentationRevision: string | null;
  latestMediaAt: number | null;
  pendingReset: PendingReset | null;
};

export type HuntStallIncidentRuntimeSampleInput = {
  sampledAt: number;
  configuration: HuntStallIncidentConfiguration;
  mode: HuntStallIncidentContinuity["mode"];
  layoutKey: string;
  regionRevision: string;
  recordFrame?: boolean;
  source?: HuntStallIncidentFrame["source"];
  sourceDimensions?: HuntStallIncidentFrame["sourceDimensions"];
  region?: HuntStallIncidentRegion | null;
  sourceToCrop?: HuntStallIncidentFrame["sourceToCrop"];
  stateBefore: HuntStallRuntimeState;
  stateAfter: HuntStallRuntimeState;
  recognition?: HuntStallIncidentRecognition | null;
  recognizer?: HuntStallIncidentRecognizerProvenance | null;
  runtimeFailure?: HuntStallIncidentRuntimeFailure | null;
  timings?: HuntStallIncidentFrame["timings"];
  shouldAlert: boolean;
  alertDecisionKind?: "initial" | "repeat" | null;
  media?: {
    rawDataUrl: string | null;
    processedDataUrl: string | null;
  } | null;
  unavailableAction?: string | null;
};

export type HuntStallIncidentPlaybackRecordResult = {
  recorder: HuntStallIncidentRuntimeRecorder;
  attemptId: string | null;
  rejectedReason: HuntStallIncidentBoundaryRejectReason | null;
};

export function createHuntStallIncidentRuntimeRecorder(
  now = Date.now(),
): HuntStallIncidentRuntimeRecorder {
  return {
    boundary: null,
    archive: createHuntStallIncidentEvidenceArchive(now),
    captureGeneration: 1,
    featureGeneration: 1,
    workerGeneration: 1,
    lifecycleSequence: 0,
    presentationSequence: 0,
    latestPresentationRevision: null,
    latestMediaAt: null,
    pendingReset: null,
  };
}

export function requestHuntStallIncidentRuntimeReset({
  previous,
  reason,
  requestedAt = Date.now(),
}: {
  previous: HuntStallIncidentRuntimeRecorder;
  reason: Exclude<HuntStallIncidentResetReason, "initialized">;
  requestedAt?: number;
}): HuntStallIncidentRuntimeRecorder {
  const next = { ...previous };
  if (reason === "stream-replaced") {
    next.captureGeneration += 1;
  } else if (reason === "worker-reset") {
    next.workerGeneration += 1;
  } else {
    next.featureGeneration += 1;
  }
  next.pendingReset = { reason, requestedAt };
  return next;
}

export function recordHuntStallIncidentSample({
  previous,
  input,
}: {
  previous: HuntStallIncidentRuntimeRecorder;
  input: HuntStallIncidentRuntimeSampleInput;
}): HuntStallIncidentRuntimeRecorder {
  let recorder = synchronizeBoundary(previous, input);
  let boundary = recorder.boundary;
  if (!boundary) return recorder;

  if (!input.configuration.enabled || input.recordFrame === false) {
    if (input.unavailableAction) {
      recorder = appendLifecycleEvent(recorder, {
        occurredAt: input.sampledAt,
        category: input.runtimeFailure ? "runtime-error" : "lifecycle",
        action: input.unavailableAction,
        details: input.runtimeFailure
          ? {
              stage: input.runtimeFailure.stage,
              code: input.runtimeFailure.code,
            }
          : {},
      });
    }
    return recorder;
  }

  const previousObservation = boundary.latestObservation;
  const frameResult = recordHuntStallIncidentFrame({
    previous: boundary,
    sampledAt: input.sampledAt,
  });
  if (!frameResult.accepted) {
    return appendBoundaryRejection(recorder, input.sampledAt, frameResult.reason, {
      operation: "record-frame",
    });
  }
  const frame: HuntStallIncidentFrame = {
    ...frameResult.value,
    source: input.source ?? (input.runtimeFailure ? "runtime-error" : "runtime"),
    sourceDimensions: input.sourceDimensions ?? null,
    region: input.region ?? null,
    sourceToCrop: input.sourceToCrop ?? null,
    stateBefore: toIncidentStateSnapshot(
      input.stateBefore,
      input.sampledAt,
      input.mode,
      input.configuration.enabled,
    ),
    stateAfter: toIncidentStateSnapshot(
      input.stateAfter,
      input.sampledAt,
      input.mode,
      input.configuration.enabled,
    ),
    recognizer: input.recognizer ?? null,
    runtimeFailure: input.runtimeFailure ?? null,
    timings: input.timings ?? null,
  };
  boundary = { ...frameResult.state, latestFrame: frame };

  const observationResult = recordHuntStallIncidentObservation({
    previous: boundary,
    frame,
  });
  if (!observationResult.accepted) {
    return appendBoundaryRejection(recorder, input.sampledAt, observationResult.reason, {
      operation: "record-observation",
      frameId: frame.id,
    });
  }
  const observation: HuntStallIncidentObservation = {
    ...observationResult.value,
    recognition: input.recognition ?? null,
    transition: createObservationTransition(input),
  };
  boundary = { ...observationResult.state, latestObservation: observation };

  const patch: HuntStallIncidentEvidencePatch = {
    currentResetEpochId: boundary.resetEpoch.id,
    currentConfigurationRevisionId: boundary.configurationRevision.id,
    frames: [frame],
    observations: [observation],
  };
  let activityAccepted = false;
  const activityReason = getAcceptedActivityReason(input);
  if (activityReason) {
    const activityResult = acceptHuntStallIncidentActivity({
      previous: boundary,
      frame,
      observation,
      occurredAt: input.sampledAt,
      reason: activityReason,
    });
    if (activityResult.accepted) {
      activityAccepted = true;
      boundary = activityResult.state;
      appendClosedBoundary(patch, activityResult.value.closed);
      patch.activityEpochs = mergePatchById(
        patch.activityEpochs,
        activityResult.value.activityEpoch,
      );
      patch.stallEpisodes = mergePatchById(
        patch.stallEpisodes,
        activityResult.value.stallEpisode,
      );
      recorder = appendLifecycleEvent(recorder, {
        occurredAt: input.sampledAt,
        category: "recognition",
        action: activityReason,
        frameId: frame.id,
        observationId: observation.id,
        activityEpochId: activityResult.value.activityEpoch.id,
        stallEpisodeId: activityResult.value.stallEpisode.id,
        configRevisionId: boundary.configurationRevision.id,
        details: {
          decision: input.stateAfter.lastDecision,
          reading: input.stateAfter.recognizedText,
        },
      });
    } else {
      recorder = appendBoundaryRejection(
        recorder,
        input.sampledAt,
        activityResult.reason,
        { operation: "accept-activity", frameId: frame.id },
      );
    }
  }

  if (boundary.activeStallEpisode && boundary.activeActivityEpoch) {
    const activeActivityEpoch = boundary.activeActivityEpoch;
    const thresholdMs = input.configuration.thresholdSeconds * 1000;
    const elapsedMs = Math.max(0, input.stateAfter.unchangedSeconds * 1000);
    const thresholdReached = elapsedMs >= thresholdMs;
    const evaluation = getThresholdEvaluation({ input, thresholdReached });
    const episode = {
      ...boundary.activeStallEpisode,
      lastEvaluation: {
        frameId: frame.id,
        observationId: observation.id,
        evaluatedAt: input.sampledAt,
        elapsedMs,
        thresholdMs,
        excludedUnreadableMs: Math.max(
          0,
          input.sampledAt - activeActivityEpoch.startedAt - elapsedMs,
        ),
        thresholdReached,
        outcome: evaluation.outcome,
        reason: evaluation.reason,
      },
    };
    boundary = { ...boundary, activeStallEpisode: episode };
    patch.stallEpisodes = mergePatchById(patch.stallEpisodes, episode);

    if (input.shouldAlert) {
      const decisionKind = input.alertDecisionKind ?? "initial";
      const activityStartedAt = activeActivityEpoch.startedAt;
      const decisionResult = recordHuntStallIncidentAlertDecision({
        previous: boundary,
        frame,
        observation,
        occurredAt: input.sampledAt,
        kind: decisionKind,
      });
      if (decisionResult.accepted) {
        const decision = {
          ...decisionResult.value.decision,
          dueAt:
            decisionKind === "initial"
              ? activityStartedAt + thresholdMs
              : getRepeatDueAt(boundary, input.configuration),
          evaluation: { outcome: "alert" as const, reason: null },
        };
        boundary = {
          ...decisionResult.state,
          latestDecision: decision,
        };
        patch.alertCycles = mergePatchById(
          patch.alertCycles,
          decisionResult.value.cycle,
        );
        patch.stallEpisodes = mergePatchById(
          patch.stallEpisodes,
          boundary.activeStallEpisode!,
        );
        patch.decisions = mergePatchById(patch.decisions, decision);
        recorder = appendLifecycleEvent(recorder, {
          occurredAt: input.sampledAt,
          category: "decision",
          action: decisionKind === "repeat" ? "repeat-decision" : "initial-decision",
          frameId: frame.id,
          observationId: observation.id,
          activityEpochId: decision.activityEpochId,
          stallEpisodeId: decision.stallEpisodeId,
          cycleId: decision.cycleId,
          configRevisionId: decision.configRevisionId,
          details: {
            dueAt: decision.dueAt ?? null,
            elapsedMs,
            thresholdMs,
          },
        });
      } else {
        recorder = appendBoundaryRejection(
          recorder,
          input.sampledAt,
          decisionResult.reason,
          { operation: "record-decision", frameId: frame.id },
        );
      }
    } else {
      recorder = recordRepeatEvaluation({
        recorder,
        boundary,
        input,
        frame,
        observation,
      });
    }
  }

  const mediaReason = getMediaReason({
    input,
    previousObservation,
    activityAccepted,
    latestMediaAt: recorder.latestMediaAt,
  });
  if (mediaReason && (input.media?.rawDataUrl || input.media?.processedDataUrl)) {
    const media: HuntStallIncidentMediaFrame = {
      id: `hunt-stall-media:${frame.id}`,
      frameId: frame.id,
      resetEpochId: frame.resetEpochId,
      sampledAt: frame.sampledAt,
      reason: mediaReason,
      rawDataUrl: input.media?.rawDataUrl ?? null,
      processedDataUrl: input.media?.processedDataUrl ?? null,
    };
    patch.media = [media];
    recorder = { ...recorder, latestMediaAt: input.sampledAt };
  } else if (mediaReason && isRequiredMediaReason(mediaReason)) {
    patch.omissions = [
      createOmission({
        occurredAt: input.sampledAt,
        kind: "media",
        reason: "never-produced",
        subjectIds: [frame.id],
      }),
    ];
  }

  recorder = appendLifecycleEvent(recorder, {
    occurredAt: input.sampledAt,
    category: input.runtimeFailure ? "runtime-error" : "presentation",
    action: input.runtimeFailure ? "runtime-sample-failed" : "runtime-state-published",
    frameId: frame.id,
    observationId: observation.id,
    activityEpochId: boundary.activeActivityEpoch?.id ?? null,
    stallEpisodeId: boundary.activeStallEpisode?.id ?? null,
    cycleId: boundary.activeAlertCycle?.id ?? null,
    attemptId: boundary.latestPlaybackAttempt?.id ?? null,
    configRevisionId: boundary.configurationRevision.id,
    details: input.runtimeFailure
      ? { stage: input.runtimeFailure.stage, code: input.runtimeFailure.code }
      : {
          status: input.stateAfter.status,
          decision: input.stateAfter.lastDecision,
        },
  });

  const presentationSequence = recorder.presentationSequence + 1;
  const latestPresentationRevision = `hunt-stall-presentation:${boundary.resetEpoch.id}:${presentationSequence}`;
  recorder = {
    ...recorder,
    boundary,
    presentationSequence,
    latestPresentationRevision,
    archive: updateHuntStallIncidentEvidenceArchive({
      previous: recorder.archive,
      patch,
      now: input.sampledAt,
    }),
  };
  return recorder;
}

export function recordHuntStallIncidentPlaybackRequested({
  previous,
  requestedAt,
  visibilityState = null,
}: {
  previous: HuntStallIncidentRuntimeRecorder;
  requestedAt: number;
  visibilityState?: "visible" | "hidden" | "prerender" | null;
}): HuntStallIncidentPlaybackRecordResult {
  const boundary = previous.boundary;
  const decision = boundary?.latestDecision ?? null;
  if (!boundary || !decision) {
    return {
      recorder: appendLifecycleEvent(previous, {
        occurredAt: requestedAt,
        category: "playback",
        action: "playback-request-rejected",
        details: { reason: "no-current-decision" },
      }),
      attemptId: null,
      rejectedReason: "stale-alert-decision",
    };
  }
  const result = requestHuntStallIncidentPlayback({
    previous: boundary,
    decision,
    requestedAt,
  });
  if (!result.accepted) {
    return {
      recorder: appendBoundaryRejection(previous, requestedAt, result.reason, {
        operation: "request-playback",
        decisionId: decision.id,
      }),
      attemptId: null,
      rejectedReason: result.reason,
    };
  }
  const attempt = { ...result.value, visibilityState };
  let recorder: HuntStallIncidentRuntimeRecorder = {
    ...previous,
    boundary: {
      ...result.state,
      activePlaybackAttempt: attempt,
      latestPlaybackAttempt: attempt,
    },
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt: requestedAt,
    category: "playback",
    action: "playback-requested",
    frameId: decision.frameId,
    observationId: decision.observationId,
    activityEpochId: attempt.activityEpochId,
    stallEpisodeId: attempt.stallEpisodeId,
    cycleId: attempt.cycleId,
    attemptId: attempt.id,
    configRevisionId: attempt.configRevisionId,
    details: {
      soundId: attempt.soundId,
      effectiveVolume: attempt.effectiveVolume,
      visibilityState,
    },
  });
  recorder = {
    ...recorder,
    archive: updateHuntStallIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: { playbackAttempts: [attempt] },
      now: requestedAt,
    }),
  };
  return { recorder, attemptId: attempt.id, rejectedReason: null };
}

export function recordHuntStallIncidentPlaybackTransition({
  previous,
  attemptId,
  status,
  occurredAt,
  error = null,
}: {
  previous: HuntStallIncidentRuntimeRecorder;
  attemptId: string;
  status: "started" | "finished" | "failed";
  occurredAt: number;
  error?: string | null;
}): HuntStallIncidentPlaybackRecordResult {
  const boundary = previous.boundary;
  if (!boundary) {
    return { recorder: previous, attemptId: null, rejectedReason: "stale-playback-attempt" };
  }
  const result = transitionHuntStallIncidentPlayback({
    previous: boundary,
    attemptId,
    status,
    occurredAt,
    error,
  });
  if (!result.accepted) {
    return {
      recorder: appendBoundaryRejection(previous, occurredAt, result.reason, {
        operation: `playback-${status}`,
        attemptId,
      }),
      attemptId: null,
      rejectedReason: result.reason,
    };
  }
  let recorder: HuntStallIncidentRuntimeRecorder = {
    ...previous,
    boundary: result.state,
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt,
    category: "playback",
    action: `playback-${status}`,
    activityEpochId: result.value.activityEpochId,
    stallEpisodeId: result.value.stallEpisodeId,
    cycleId: result.value.cycleId,
    attemptId: result.value.id,
    configRevisionId: result.value.configRevisionId,
    details: error ? { error } : {},
  });
  recorder = {
    ...recorder,
    archive: updateHuntStallIncidentEvidenceArchive({
      previous: recorder.archive,
      patch: {
        playbackAttempts: [result.value],
        media:
          status === "failed"
            ? createPlaybackFailureMediaPatch(recorder, result.value.decisionId)
            : undefined,
      },
      now: occurredAt,
    }),
  };
  return { recorder, attemptId: result.value.id, rejectedReason: null };
}

function createPlaybackFailureMediaPatch(
  recorder: HuntStallIncidentRuntimeRecorder,
  decisionId: string,
): HuntStallIncidentMediaFrame[] | undefined {
  const decision = recorder.archive.decisions.find(
    (entry) => entry.id === decisionId,
  );
  if (!decision) return undefined;
  const existing = recorder.archive.media.find(
    (entry) => entry.frameId === decision.frameId,
  );
  if (!existing) return undefined;
  return [{ ...existing, reason: "playback-failed" }];
}

export function createHuntStallIncidentFrozenState({
  recorder,
  capturedAt,
  state,
}: {
  recorder: HuntStallIncidentRuntimeRecorder;
  capturedAt: number;
  state: HuntStallRuntimeState;
}): HuntStallIncidentFrozenState | null {
  const boundary = recorder.boundary;
  if (!boundary) return null;
  return {
    capturedAt,
    resetEpochId: boundary.resetEpoch.id,
    configRevisionId: boundary.configurationRevision.id,
    mode: boundary.resetEpoch.continuity.mode,
    enabled: boundary.configurationRevision.values.enabled,
    status: state.status,
    decision: state.lastDecision,
    presentationRevision: recorder.latestPresentationRevision,
    latestFrameId: boundary.latestFrame?.id ?? null,
    latestObservationId: boundary.latestObservation?.id ?? null,
    activityEpochId: boundary.activeActivityEpoch?.id ?? null,
    stallEpisodeId: boundary.activeStallEpisode?.id ?? null,
    alertCycleId: boundary.activeAlertCycle?.id ?? null,
    playbackAttemptId: boundary.latestPlaybackAttempt?.id ?? null,
  };
}

export function createHuntStallIncidentRegionRevision({
  mode,
  layoutKey,
  region,
}: {
  mode: HuntStallIncidentContinuity["mode"];
  layoutKey: string;
  region: HuntStallIncidentRegion | null;
}): string {
  const value = region
    ? `${mode}:${layoutKey}:${region.x},${region.y},${region.width},${region.height}`
    : `${mode}:${layoutKey}:none`;
  return hashToken(value);
}

function synchronizeBoundary(
  previous: HuntStallIncidentRuntimeRecorder,
  input: HuntStallIncidentRuntimeSampleInput,
): HuntStallIncidentRuntimeRecorder {
  const continuity: HuntStallIncidentContinuity = {
    captureGeneration: previous.captureGeneration,
    featureGeneration: previous.featureGeneration,
    workerGeneration: previous.workerGeneration,
    mode: input.mode,
    layoutKey: input.layoutKey,
    regionRevision: input.regionRevision,
  };
  if (!previous.boundary) {
    const boundary = createHuntStallIncidentBoundary({
      sessionId: createSessionId(input.sampledAt),
      continuity,
      configuration: input.configuration,
      now: input.sampledAt,
    });
    let recorder: HuntStallIncidentRuntimeRecorder = {
      ...previous,
      boundary,
      pendingReset: null,
      archive: updateHuntStallIncidentEvidenceArchive({
        previous: previous.archive,
        patch: {
          currentResetEpochId: boundary.resetEpoch.id,
          currentConfigurationRevisionId: boundary.configurationRevision.id,
          resetEpochs: [boundary.resetEpoch],
          configurationRevisions: [boundary.configurationRevision],
        },
        now: input.sampledAt,
      }),
    };
    recorder = appendLifecycleEvent(recorder, {
      occurredAt: input.sampledAt,
      category: "lifecycle",
      action: "initialized",
      configRevisionId: boundary.configurationRevision.id,
      details: { enabled: input.configuration.enabled, mode: input.mode },
    });
    return recorder;
  }

  const current = previous.boundary;
  const continuityReason = getHuntStallIncidentContinuityResetReason(
    current.resetEpoch.continuity,
    continuity,
  );
  const enabledChanged =
    current.configurationRevision.values.enabled !== input.configuration.enabled;
  const reason = selectResetReason({
    enabledChanged,
    enabled: input.configuration.enabled,
    continuityReason,
    pendingReset: previous.pendingReset,
  });
  if (reason) {
    const reset = resetHuntStallIncidentBoundary({
      previous: current,
      continuity,
      configuration: input.configuration,
      now: input.sampledAt,
      reason,
    });
    if (!reset.accepted) {
      return appendBoundaryRejection(previous, input.sampledAt, reset.reason, {
        operation: "reset-boundary",
        requestedReason: reason,
      });
    }
    const patch: HuntStallIncidentEvidencePatch = {
      currentResetEpochId: reset.value.resetEpoch.id,
      currentConfigurationRevisionId: reset.value.configurationRevision.id,
      resetEpochs: [reset.value.resetEpoch],
      configurationRevisions: [reset.value.configurationRevision],
    };
    appendClosedBoundary(patch, reset.value.closed);
    let recorder: HuntStallIncidentRuntimeRecorder = {
      ...previous,
      boundary: reset.state,
      pendingReset: null,
      archive: updateHuntStallIncidentEvidenceArchive({
        previous: previous.archive,
        patch,
        now: input.sampledAt,
      }),
    };
    recorder = appendLifecycleEvent(recorder, {
      occurredAt: input.sampledAt,
      category: reason === "disabled" || reason === "enabled" ? "configuration" : "lifecycle",
      action: reason === "disabled" ? "disabled" : reason === "enabled" ? "enabled" : "reset",
      configRevisionId: reset.value.configurationRevision.id,
      details: {
        reason,
        previousResetEpochId: current.resetEpoch.id,
        nextResetEpochId: reset.value.resetEpoch.id,
      },
    });
    return recorder;
  }

  const revision = reviseHuntStallIncidentConfiguration({
    previous: current,
    configuration: input.configuration,
    now: input.sampledAt,
  });
  if (!revision.accepted) {
    return appendBoundaryRejection(previous, input.sampledAt, revision.reason, {
      operation: "revise-configuration",
    });
  }
  if (!revision.value.changed) {
    return { ...previous, boundary: revision.state, pendingReset: null };
  }
  let recorder: HuntStallIncidentRuntimeRecorder = {
    ...previous,
    boundary: revision.state,
    pendingReset: null,
    archive: updateHuntStallIncidentEvidenceArchive({
      previous: previous.archive,
      patch: {
        currentConfigurationRevisionId: revision.value.configurationRevision.id,
        configurationRevisions: [revision.value.configurationRevision],
      },
      now: input.sampledAt,
    }),
  };
  recorder = appendLifecycleEvent(recorder, {
    occurredAt: input.sampledAt,
    category: "configuration",
    action: "configuration-revised",
    configRevisionId: revision.value.configurationRevision.id,
    details: {
      fingerprint: revision.value.configurationRevision.fingerprint,
    },
  });
  return recorder;
}

function appendLifecycleEvent(
  previous: HuntStallIncidentRuntimeRecorder,
  input: Pick<
    HuntStallIncidentLifecycleEvent,
    "occurredAt" | "category" | "action" | "details"
  > &
    Partial<
      Pick<
        HuntStallIncidentLifecycleEvent,
        | "frameId"
        | "observationId"
        | "activityEpochId"
        | "stallEpisodeId"
        | "cycleId"
        | "attemptId"
        | "configRevisionId"
      >
    >,
): HuntStallIncidentRuntimeRecorder {
  const boundary = previous.boundary;
  if (!boundary) return previous;
  const lifecycleSequence = previous.lifecycleSequence + 1;
  const event: HuntStallIncidentLifecycleEvent = {
    id: `hunt-stall-event:${boundary.sessionId}:${lifecycleSequence}`,
    resetEpochId: boundary.resetEpoch.id,
    occurredAt: input.occurredAt,
    category: input.category,
    action: input.action,
    frameId: input.frameId ?? null,
    observationId: input.observationId ?? null,
    activityEpochId: input.activityEpochId ?? null,
    stallEpisodeId: input.stallEpisodeId ?? null,
    cycleId: input.cycleId ?? null,
    attemptId: input.attemptId ?? null,
    configRevisionId: input.configRevisionId ?? null,
    details: input.details,
  };
  return {
    ...previous,
    lifecycleSequence,
    archive: updateHuntStallIncidentEvidenceArchive({
      previous: previous.archive,
      patch: { lifecycleEvents: [event] },
      now: input.occurredAt,
    }),
  };
}

function appendBoundaryRejection(
  previous: HuntStallIncidentRuntimeRecorder,
  occurredAt: number,
  reason: HuntStallIncidentBoundaryRejectReason,
  details: Record<string, unknown>,
): HuntStallIncidentRuntimeRecorder {
  return appendLifecycleEvent(previous, {
    occurredAt,
    category: "runtime-error",
    action: "boundary-rejected",
    details: { ...details, reason },
  });
}

function appendClosedBoundary(
  patch: HuntStallIncidentEvidencePatch,
  closed: {
    activityEpoch: NonNullable<HuntStallIncidentEvidencePatch["activityEpochs"]>[number] | null;
    stallEpisode: NonNullable<HuntStallIncidentEvidencePatch["stallEpisodes"]>[number] | null;
    alertCycle: NonNullable<HuntStallIncidentEvidencePatch["alertCycles"]>[number] | null;
    playbackAttempt: NonNullable<HuntStallIncidentEvidencePatch["playbackAttempts"]>[number] | null;
  },
): void {
  if (closed.activityEpoch) {
    patch.activityEpochs = mergePatchById(patch.activityEpochs, closed.activityEpoch);
  }
  if (closed.stallEpisode) {
    patch.stallEpisodes = mergePatchById(patch.stallEpisodes, closed.stallEpisode);
  }
  if (closed.alertCycle) {
    patch.alertCycles = mergePatchById(patch.alertCycles, closed.alertCycle);
  }
  if (closed.playbackAttempt) {
    patch.playbackAttempts = mergePatchById(
      patch.playbackAttempts,
      closed.playbackAttempt,
    );
  }
}

function mergePatchById<T extends { id: string }>(
  current: T[] | undefined,
  entry: T,
): T[] {
  return [...(current ?? []).filter((item) => item.id !== entry.id), entry];
}

function toIncidentStateSnapshot(
  state: HuntStallRuntimeState,
  capturedAt: number,
  mode: HuntStallIncidentContinuity["mode"],
  enabled: boolean,
) {
  return {
    capturedAt,
    enabled,
    mode,
    status: state.status,
    decision: state.lastDecision,
    armed: state.hasObservedExperienceChange || state.hasObservedCooldownPresence,
    lastChangedAt: state.lastChangedAt,
    lastAlertAt: state.lastAlertedAt ?? state.alertedAt,
    initialAlertCount: state.alertedAt === null ? 0 : 1,
    repeatAlertCount: state.repeatedAlertCount,
    latestReading: state.recognizedText,
  };
}

function createObservationTransition(
  input: HuntStallIncidentRuntimeSampleInput,
): HuntStallIncidentObservation["transition"] {
  const before = input.stateBefore;
  const after = input.stateAfter;
  const thresholdMs = input.configuration.thresholdSeconds * 1000;
  const elapsedMs = Math.max(0, after.unchangedSeconds * 1000);
  let kind: NonNullable<HuntStallIncidentObservation["transition"]>["kind"] = "unchanged";
  if (input.runtimeFailure) kind = "error";
  else if (input.shouldAlert) kind = "threshold-reached";
  else if (after.lastDecision === "confirmed-progress") kind = "activity-confirmed";
  else if (!before.hasObservedExperienceChange && after.fingerprint && input.mode === "manual-experience") {
    kind = "baseline-established";
  } else if (after.lastDecision === "pending" || after.lastDecision === "pending-progress") {
    kind = "pending-progress";
  } else if (
    input.mode === "cooldown-presence" &&
    !after.hasObservedCooldownPresence &&
    (after.lastDecision === "cooldown-arming" || after.cooldownConsecutiveVisualActivityCount === 1)
  ) {
    kind = "presence-pending";
  } else if (
    before.alertedAt !== null &&
    after.alertedAt === null &&
    input.mode === "cooldown-presence"
  ) {
    kind = "rearmed";
  } else if (
    ["sample-error", "foreground-ratio", "cooldown-empty", "cooldown-missing"].includes(
      after.lastDecision,
    )
  ) {
    kind = "unreadable";
  } else if (after.lastDecision === "ignored-jitter") {
    kind = "rejected";
  } else if (!before.hasObservedCooldownPresence && after.hasObservedCooldownPresence) {
    kind = "armed";
  }
  return {
    kind,
    reason: after.lastDecision,
    elapsedMs,
    thresholdMs,
    shouldAlert: input.shouldAlert,
  };
}

function getAcceptedActivityReason(
  input: HuntStallIncidentRuntimeSampleInput,
): HuntStallIncidentActivityReason | null {
  const before = input.stateBefore;
  const after = input.stateAfter;
  if (input.mode === "manual-experience") {
    return after.lastDecision === "confirmed-progress"
      ? "manual-progress-confirmed"
      : null;
  }
  const becameArmed =
    !before.hasObservedCooldownPresence && after.hasObservedCooldownPresence;
  const rearmed = before.alertedAt !== null && after.alertedAt === null;
  const changedAtThisFrame =
    after.hasObservedCooldownPresence &&
    after.lastChangedAt === input.sampledAt &&
    before.lastChangedAt !== after.lastChangedAt;
  if (!becameArmed && !rearmed && !changedAtThisFrame) return null;
  if (rearmed) {
    return after.cooldownUsedVisualActivity
      ? "cooldown-rearmed-visual"
      : "cooldown-rearmed-readable";
  }
  if (after.cooldownUsedVisualActivity) return "cooldown-visual-activity";
  if (
    before.recognizedText !== null &&
    after.recognizedText !== null &&
    before.recognizedText !== after.recognizedText
  ) {
    return "cooldown-digit-changed";
  }
  return "cooldown-presence-confirmed";
}

function getThresholdEvaluation({
  input,
  thresholdReached,
}: {
  input: HuntStallIncidentRuntimeSampleInput;
  thresholdReached: boolean;
}): {
  outcome: "not-due" | "alert" | "suppressed" | "stale" | "blocked";
  reason: string | null;
} {
  if (input.shouldAlert) return { outcome: "alert", reason: null };
  if (!thresholdReached) return { outcome: "not-due", reason: "threshold-not-reached" };
  if (input.stateAfter.alertedAt !== null) {
    return { outcome: "suppressed", reason: "already-alerted" };
  }
  if (
    input.stateAfter.lastDecision === "pending" ||
    input.stateAfter.lastDecision === "pending-progress"
  ) {
    return { outcome: "blocked", reason: "pending-progress-confirmation" };
  }
  return { outcome: "blocked", reason: "threshold-reached-without-decision" };
}

function recordRepeatEvaluation({
  recorder,
  boundary,
  input,
  frame,
  observation,
}: {
  recorder: HuntStallIncidentRuntimeRecorder;
  boundary: HuntStallIncidentBoundaryState;
  input: HuntStallIncidentRuntimeSampleInput;
  frame: HuntStallIncidentFrame;
  observation: HuntStallIncidentObservation;
}): HuntStallIncidentRuntimeRecorder {
  const cycle = boundary.activeAlertCycle;
  if (input.mode !== "manual-experience" || !cycle) return recorder;
  const latestAttempt = boundary.latestPlaybackAttempt;
  const maxCount = input.configuration.repeatAlertMaxCount;
  const dueAt = getRepeatDueAt(boundary, input.configuration);
  let action = "repeat-not-due";
  let reason: string | null = null;
  if (!input.configuration.repeatAlertEnabled) action = "repeat-disabled";
  else if (latestAttempt?.status === "requested" || latestAttempt?.status === "started") {
    action = "repeat-blocked-by-playback";
  } else if (!latestAttempt || latestAttempt.finishedAt === null) {
    action = "repeat-blocked-no-finished-playback";
  } else if (maxCount !== null && input.stateAfter.repeatedAlertCount >= maxCount) {
    action = "repeat-limit-reached";
  } else if (dueAt !== null && input.sampledAt >= dueAt) {
    action = "repeat-decision-missing";
    reason = "repeat-due-without-decision";
  }
  return appendLifecycleEvent(recorder, {
    occurredAt: input.sampledAt,
    category: "decision",
    action,
    frameId: frame.id,
    observationId: observation.id,
    activityEpochId: cycle.activityEpochId,
    stallEpisodeId: cycle.stallEpisodeId,
    cycleId: cycle.id,
    attemptId: latestAttempt?.id ?? null,
    configRevisionId: boundary.configurationRevision.id,
    details: { dueAt, reason, repeatedAlertCount: input.stateAfter.repeatedAlertCount },
  });
}

function getRepeatDueAt(
  boundary: HuntStallIncidentBoundaryState,
  configuration: HuntStallIncidentConfiguration,
): number | null {
  const finishedAt = boundary.latestPlaybackAttempt?.finishedAt ?? null;
  const interval = configuration.repeatAlertIntervalSeconds;
  return finishedAt !== null && interval !== null
    ? finishedAt + interval * 1000
    : null;
}

function getMediaReason({
  input,
  previousObservation,
  activityAccepted,
  latestMediaAt,
}: {
  input: HuntStallIncidentRuntimeSampleInput;
  previousObservation: HuntStallIncidentObservation | null;
  activityAccepted: boolean;
  latestMediaAt: number | null;
}): HuntStallIncidentMediaReason | null {
  if (input.runtimeFailure) return "runtime-error";
  if (input.shouldAlert) return "alert-decision";
  if (activityAccepted) {
    return input.stateBefore.alertedAt !== null ? "rearm" : "activity-anchor";
  }
  if (
    input.stateAfter.unchangedSeconds * 1000 >=
    input.configuration.thresholdSeconds * 1000
  ) {
    return "threshold";
  }
  if (
    input.recognition?.decision === "rejected" ||
    input.recognition?.decision === "missing" ||
    input.recognition?.decision === "error"
  ) {
    if (
      previousObservation?.recognition?.decision !== input.recognition.decision ||
      latestMediaAt === null ||
      input.sampledAt - latestMediaAt >= 10_000
    ) {
      return "rejected-observation";
    }
  }
  const previousRecognition = previousObservation?.recognition;
  if (
    previousRecognition &&
    input.recognition &&
    (previousRecognition.rawText !== input.recognition.rawText ||
      previousRecognition.correctedValue !== input.recognition.correctedValue ||
      previousRecognition.fingerprint !== input.recognition.fingerprint)
  ) {
    return "value-transition";
  }
  if (latestMediaAt === null) return "current";
  if (input.sampledAt - latestMediaAt >= 15_000) return "periodic";
  return null;
}

function isRequiredMediaReason(reason: HuntStallIncidentMediaReason): boolean {
  return !["current", "periodic"].includes(reason);
}

function createOmission({
  occurredAt,
  kind,
  reason,
  subjectIds,
}: Pick<
  HuntStallIncidentEvidenceOmission,
  "occurredAt" | "kind" | "reason" | "subjectIds"
>): HuntStallIncidentEvidenceOmission {
  return {
    id: `hunt-stall-omission:${kind}:${reason}:${occurredAt}:${subjectIds.join(",")}`,
    occurredAt,
    kind,
    reason,
    subjectIds,
    count: Math.max(1, subjectIds.length),
  };
}

function selectResetReason({
  enabledChanged,
  enabled,
  continuityReason,
  pendingReset,
}: {
  enabledChanged: boolean;
  enabled: boolean;
  continuityReason: Exclude<HuntStallIncidentResetReason, "initialized"> | null;
  pendingReset: PendingReset | null;
}): Exclude<HuntStallIncidentResetReason, "initialized"> | null {
  if (enabledChanged) {
    if (pendingReset?.reason === "global-disabled") return "global-disabled";
    return enabled ? "enabled" : "disabled";
  }
  if (continuityReason && continuityReason !== "profile-replaced") {
    return continuityReason;
  }
  return pendingReset?.reason ?? continuityReason;
}

function createSessionId(now: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Math.max(0, Math.floor(now)).toString(36)}-${random}`;
}

function hashToken(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
