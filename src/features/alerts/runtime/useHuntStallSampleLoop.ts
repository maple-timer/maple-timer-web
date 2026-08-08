import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { HuntStallRuntimeState, HuntStallSnapshot } from "../../../alertTypes";
import { playAlertUntilEnded } from "../../../lib/alert";
import {
  createAlertPlaybackRequested,
  markAlertPlaybackFailed,
  markAlertPlaybackFinished,
  markAlertPlaybackStarted,
} from "../../../lib/alertPlaybackDiagnostics";
import {
  trackAlertPlayed,
  trackFeatureSessionActive,
} from "../../../lib/analyticsEvents";
import { createHuntStallCooldownWorkerClient } from "../../../platform/runtime-workers/hunt-stall-cooldown/huntStallCooldownWorkerClient";
import { createHuntStallOcrEngine } from "../../../lib/huntStallOcrEngine";
import {
  createHuntStallRuntimeState,
  markHuntStallAlertPlaybackFinished,
} from "../../../lib/huntStallRuntimeState";
import { createDefaultHuntStallAlert } from "../../../lib/storage";
import { applyMasterVolume } from "../../../lib/volume";
import type { MonitoringFrameRequest } from "../../../runtime/monitoring/monitoringFrameBinding";
import type { HuntStallAlertMode, Profile } from "../../../types";
import {
  createHuntStallSampleProcessorPreviewState,
  processHuntStallActiveSample,
  processHuntStallSampleError,
  processHuntStallUnavailableSample,
  type HuntStallSampleProcessResult,
} from "./huntStallSampleProcessor";
import { useInactiveSamplePublishGate } from "./useInactiveSamplePublishGate";
import { useLazyRef } from "./useLazyRef";
import { toHuntStallCropHistoryState } from "./huntStallSampleProcessorShared";
import {
  createAlertIncidentFrameId,
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import { createHuntStallIncidentConfiguration } from "../../../application/reporting/huntStallIncidentConfiguration";
import {
  createHuntStallIncidentRegionRevision,
  recordHuntStallIncidentPlaybackRequested,
  recordHuntStallIncidentPlaybackTransition,
  recordHuntStallIncidentSample,
  requestHuntStallIncidentRuntimeReset,
  type HuntStallIncidentRuntimeRecorder,
} from "../../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";

function getHuntStallFeatureSessionMode(mode: HuntStallAlertMode) {
  return mode === "manual-experience" ? "manual_experience" : "cooldown_presence";
}

export function useHuntStallSampleLoop({
  stream,
  gameViewportRevision,
  profileRef,
  huntStallRuntimeRef,
  huntStallIncidentRecorderRef,
  lastAlertErrorRef,
  showDebugColumns,
  setHuntStallRuntime,
  setHuntStallSnapshot,
  onMessage,
  alertIncidentJournal,
}: {
  stream: MediaStream | null;
  gameViewportRevision: number;
  profileRef: MutableRefObject<Profile>;
  huntStallRuntimeRef: MutableRefObject<HuntStallRuntimeState>;
  huntStallIncidentRecorderRef: MutableRefObject<HuntStallIncidentRuntimeRecorder>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  showDebugColumns: boolean;
  setHuntStallRuntime: Dispatch<SetStateAction<HuntStallRuntimeState>>;
  setHuntStallSnapshot: Dispatch<SetStateAction<HuntStallSnapshot | null>>;
  onMessage: (message: string) => void;
  alertIncidentJournal?: AlertIncidentJournal;
}) {
  const huntStallPreviewStateRef = useLazyRef(createHuntStallSampleProcessorPreviewState);
  const huntStallOcrEngineRef = useLazyRef(createHuntStallOcrEngine);
  const huntStallCooldownWorkerRef = useLazyRef(createHuntStallCooldownWorkerClient);
  const huntStallRuntimeTraceRef = useRef<HuntStallSampleProcessResult["runtimeTrace"]>([]);
  const huntStallCropHistoryRef = useRef<HuntStallSampleProcessResult["cropHistory"]>([]);
  const currentGameViewportRevisionRef = useRef(gameViewportRevision);
  const appliedGameViewportRevisionRef = useRef(gameViewportRevision);
  currentGameViewportRevisionRef.current = gameViewportRevision;
  const {
    markActiveSamplePublished,
    shouldPublishInactiveSample,
  } = useInactiveSamplePublishGate();

  const resetHuntStallOcrState = useCallback(() => {
    huntStallOcrEngineRef.current.reset();
    huntStallCooldownWorkerRef.current.reset();
    huntStallPreviewStateRef.current = createHuntStallSampleProcessorPreviewState();
    huntStallRuntimeTraceRef.current = [];
    huntStallCropHistoryRef.current = [];
  }, []);

  const applyHuntStallSampleResult = useCallback(
    (result: HuntStallSampleProcessResult) => {
      const state = preserveConcurrentHuntStallPlayback(
        huntStallRuntimeRef.current,
        result.state,
      );
      const config = profileRef.current.huntStallAlert ?? createDefaultHuntStallAlert();
      const incident = result.incidentEvidence;
      const currentContinuity =
        huntStallIncidentRecorderRef.current.boundary?.resetEpoch.continuity ?? null;
      const layoutKey =
        incident?.layoutKey && incident.layoutKey !== "unknown"
          ? incident.layoutKey
          : currentContinuity?.layoutKey ?? "unknown";
      const regionRevision =
        incident?.layoutKey === "unknown" && currentContinuity
          ? currentContinuity.regionRevision
          : createHuntStallIncidentRegionRevision({
              mode: config.mode,
              layoutKey,
              region: incident?.region ?? null,
            });
      huntStallIncidentRecorderRef.current = recordHuntStallIncidentSample({
        previous: huntStallIncidentRecorderRef.current,
        input: {
          sampledAt:
            result.snapshot?.sampledAt ??
            result.state.lastSampledAt ??
            Date.now(),
          configuration: createHuntStallIncidentConfiguration(
            config,
            profileRef.current.masterVolume,
          ),
          mode: config.mode,
          layoutKey,
          regionRevision,
          recordFrame: config.enabled && incident !== null,
          source: incident?.runtimeFailure ? "runtime-error" : "runtime",
          sourceDimensions: incident?.sourceDimensions ?? null,
          region: incident?.region ?? null,
          sourceToCrop: incident?.sourceToCrop ?? null,
          stateBefore: result.stateBefore,
          stateAfter: state,
          recognition: incident?.recognition ?? null,
          recognizer: incident?.recognizer ?? null,
          runtimeFailure: incident?.runtimeFailure ?? null,
          timings: incident?.timings ?? null,
          shouldAlert: result.shouldAlert,
          alertDecisionKind: result.shouldAlert
            ? state.repeatedAlertCount > 0
              ? "repeat"
              : "initial"
            : null,
          media: incident?.media ?? null,
          unavailableAction:
            !config.enabled
              ? null
              : incident === null
                ? "stream-unavailable"
                : null,
        },
      });
      huntStallPreviewStateRef.current = result.previewState;
      huntStallRuntimeTraceRef.current = result.runtimeTrace;
      huntStallCropHistoryRef.current = result.cropHistory;
      huntStallRuntimeRef.current = state;
      setHuntStallRuntime(state);
      setHuntStallSnapshot(result.snapshot);
      const trace = result.runtimeTrace[result.runtimeTrace.length - 1] ?? null;
      if (trace) {
        alertIncidentJournal?.record({
          id: `hunt-stall:sample:${trace.sampledAt}`,
          feature: "hunt-stall",
          targetId: null,
          kind: trace.alertDecision ? "decision" : "sample",
          occurredAt: trace.sampledAt,
          frameId: createAlertIncidentFrameId(trace.sampledAt),
          cycleId: state.lastAlertPlayback?.cycleId ?? state.alertedAt,
          status: state.status,
          decision: trace.alertDecision ?? trace.lastDecision,
          value: trace.recognizedText,
          configuration: getHuntStallIncidentConfiguration(
            config,
            profileRef.current.masterVolume,
          ),
          details: {
            confidence: trace.confidence,
            unchangedSeconds: trace.unchangedSeconds,
            stableSampleCount: trace.stableSampleCount,
            repeatedAlertCount: trace.repeatedAlertCount,
            cooldownMissingSeconds: trace.cooldownMissingSeconds,
            runtimeFailureStage: trace.runtimeFailure?.stage ?? null,
            runtimeFailureCode: trace.runtimeFailure?.code ?? null,
            runtimeTechnicalMessage:
              trace.runtimeFailure?.technicalMessage ?? null,
            stateBefore: toHuntStallCropHistoryState(result.stateBefore),
            stateAfter: toHuntStallCropHistoryState(state),
          },
        });
      }
      if (result.errorMessage) {
        onMessage(result.errorMessage);
      }
    },
    [
      alertIncidentJournal,
      huntStallIncidentRecorderRef,
      huntStallRuntimeRef,
      onMessage,
      profileRef,
      setHuntStallRuntime,
      setHuntStallSnapshot,
    ],
  );

  const playHuntStallAlert = useCallback(
    (
      soundId: string,
      volume: number,
      masterVolume: number,
      alertCycleStartedAt: number | null,
      detectionMode: string,
      alertDecision: "initial" | "repeat",
    ) => {
      const requestedAt = Date.now();
      const playback = createAlertPlaybackRequested({
        cycleId: alertCycleStartedAt,
        soundId,
        requestedAt,
      });
      const playbackId = `hunt-stall:playback:${requestedAt}`;
      const playbackConfiguration = getHuntStallIncidentConfiguration(
        profileRef.current.huntStallAlert ?? createDefaultHuntStallAlert(),
        masterVolume,
      );
      const stateWithPlayback = {
        ...huntStallRuntimeRef.current,
        lastRepeatedAlertAt: null,
        lastAlertPlayback: playback,
      };
      huntStallRuntimeRef.current = stateWithPlayback;
      setHuntStallRuntime(stateWithPlayback);
      const incidentPlayback = recordHuntStallIncidentPlaybackRequested({
        previous: huntStallIncidentRecorderRef.current,
        requestedAt,
        visibilityState: document.visibilityState,
      });
      huntStallIncidentRecorderRef.current = incidentPlayback.recorder;
      alertIncidentJournal?.record({
        id: playbackId,
        feature: "hunt-stall",
        targetId: null,
        kind: "playback",
        occurredAt: requestedAt,
        frameId: null,
        cycleId: alertCycleStartedAt,
        status: "requested",
        decision: alertDecision,
        value: null,
        configuration: playbackConfiguration,
        details: {
          requestedAt,
          soundId,
          detectionMode,
          effectiveVolume: applyMasterVolume(volume, masterVolume),
          visibilityState: document.visibilityState,
        },
      });

      void playAlertUntilEnded(soundId, applyMasterVolume(volume, masterVolume), {
        onStarted: () => {
          const startedAt = Date.now();
          if (incidentPlayback.attemptId) {
            huntStallIncidentRecorderRef.current =
              recordHuntStallIncidentPlaybackTransition({
                previous: huntStallIncidentRecorderRef.current,
                attemptId: incidentPlayback.attemptId,
                status: "started",
                occurredAt: startedAt,
              }).recorder;
          }
          alertIncidentJournal?.record({
            id: playbackId,
            feature: "hunt-stall",
            targetId: null,
            kind: "playback",
            occurredAt: requestedAt,
            frameId: null,
            cycleId: alertCycleStartedAt,
            status: "started",
            decision: alertDecision,
            value: null,
            configuration: playbackConfiguration,
            details: {
              requestedAt,
              startedAt,
              soundId,
              detectionMode,
              effectiveVolume: applyMasterVolume(volume, masterVolume),
              visibilityState: document.visibilityState,
            },
          });
          setHuntStallRuntime((current) => {
            const currentPlayback = current.lastAlertPlayback;
            if (currentPlayback?.requestedAt !== playback.requestedAt) {
              return current;
            }
            const next = {
              ...current,
              lastAlertPlayback: markAlertPlaybackStarted(currentPlayback, startedAt),
            };
            huntStallRuntimeRef.current = next;
            return next;
          });
        },
      })
        .then(() => {
          trackAlertPlayed("hunt_stall", alertDecision, { detectionMode });
          const finishedAt = Date.now();
          if (incidentPlayback.attemptId) {
            huntStallIncidentRecorderRef.current =
              recordHuntStallIncidentPlaybackTransition({
                previous: huntStallIncidentRecorderRef.current,
                attemptId: incidentPlayback.attemptId,
                status: "finished",
                occurredAt: finishedAt,
              }).recorder;
          }
          alertIncidentJournal?.record({
            id: playbackId,
            feature: "hunt-stall",
            targetId: null,
            kind: "playback",
            occurredAt: requestedAt,
            frameId: null,
            cycleId: alertCycleStartedAt,
            status: "finished",
            decision: alertDecision,
            value: null,
            configuration: playbackConfiguration,
            details: {
              requestedAt,
              finishedAt,
              soundId,
              detectionMode,
              effectiveVolume: applyMasterVolume(volume, masterVolume),
              visibilityState: document.visibilityState,
            },
          });
          if (alertCycleStartedAt === null) {
            return;
          }
          setHuntStallRuntime((current) => {
            const currentPlayback = current.lastAlertPlayback;
            if (currentPlayback?.requestedAt !== playback.requestedAt) {
              return current;
            }
            const nextHuntStallState = markHuntStallAlertPlaybackFinished(
              current,
              alertCycleStartedAt,
              finishedAt,
            );
            const next = {
              ...nextHuntStallState,
              lastAlertPlayback: markAlertPlaybackFinished(currentPlayback, finishedAt),
            };
            huntStallRuntimeRef.current = next;
            return next;
          });
        })
        .catch((error) => {
          const nextError =
            error instanceof Error ? error.message : "사냥 멈춤 알람 재생에 실패했습니다.";
          const failedAt = Date.now();
          if (incidentPlayback.attemptId) {
            huntStallIncidentRecorderRef.current =
              recordHuntStallIncidentPlaybackTransition({
                previous: huntStallIncidentRecorderRef.current,
                attemptId: incidentPlayback.attemptId,
                status: "failed",
                occurredAt: failedAt,
                error: nextError,
              }).recorder;
          }
          alertIncidentJournal?.record({
            id: playbackId,
            feature: "hunt-stall",
            targetId: null,
            kind: "playback",
            occurredAt: requestedAt,
            frameId: null,
            cycleId: alertCycleStartedAt,
            status: "failed",
            decision: alertDecision,
            value: null,
            configuration: playbackConfiguration,
            details: {
              requestedAt,
              failedAt,
              error: nextError,
              soundId,
              detectionMode,
              effectiveVolume: applyMasterVolume(volume, masterVolume),
              visibilityState: document.visibilityState,
            },
          });
          setHuntStallRuntime((current) => {
            const currentPlayback = current.lastAlertPlayback;
            if (currentPlayback?.requestedAt !== playback.requestedAt) {
              return current;
            }
            const next = {
              ...current,
              lastAlertPlayback: markAlertPlaybackFailed(currentPlayback, failedAt, nextError),
            };
            huntStallRuntimeRef.current = next;
            return next;
          });
          if (lastAlertErrorRef.current !== nextError) {
            lastAlertErrorRef.current = nextError;
            onMessage(nextError);
          }
        });
    },
    [
      alertIncidentJournal,
      huntStallIncidentRecorderRef,
      huntStallRuntimeRef,
      lastAlertErrorRef,
      onMessage,
      profileRef,
      setHuntStallRuntime,
    ],
  );

  const runHuntStallSample = useCallback(
    async ({ sampledAt, context }: MonitoringFrameRequest) => {
      const gameViewportRevisionAtStart =
        currentGameViewportRevisionRef.current;
      const currentProfile = profileRef.current;
      const huntConfig = currentProfile.huntStallAlert ?? createDefaultHuntStallAlert();

      if (!huntConfig.enabled) {
        if (!shouldPublishInactiveSample(`disabled:${huntConfig.mode}:${Boolean(stream)}`)) {
          return;
        }
        resetHuntStallOcrState();
        applyHuntStallSampleResult(
          processHuntStallUnavailableSample({
            config: huntConfig,
            previousState: huntStallRuntimeRef.current,
            previewState: huntStallPreviewStateRef.current,
            runtimeTrace: huntStallRuntimeTraceRef.current,
            cropHistory: huntStallCropHistoryRef.current,
            sampledAt,
            hasStream: Boolean(stream),
          }),
        );
        return;
      }

      if (!stream || !context) {
        if (!shouldPublishInactiveSample(`video-unavailable:${huntConfig.mode}:${Boolean(stream)}`)) {
          return;
        }
        applyHuntStallSampleResult(
          processHuntStallUnavailableSample({
            config: huntConfig,
            previousState: huntStallRuntimeRef.current,
            previewState: huntStallPreviewStateRef.current,
            runtimeTrace: huntStallRuntimeTraceRef.current,
            cropHistory: huntStallCropHistoryRef.current,
            sampledAt,
            hasStream: Boolean(stream),
          }),
        );
        return;
      }

      try {
        markActiveSamplePublished();
        trackFeatureSessionActive("hunt_stall", {
          mode: getHuntStallFeatureSessionMode(huntConfig.mode),
          enabledCount: 1,
        });

        const result = await processHuntStallActiveSample({
          config: huntConfig,
          cooldownWorker: huntStallCooldownWorkerRef.current,
          cropHistory: huntStallCropHistoryRef.current,
          ocrEngine: huntStallOcrEngineRef.current,
          previousState: huntStallRuntimeRef.current,
          previewState: huntStallPreviewStateRef.current,
          runtimeTrace: huntStallRuntimeTraceRef.current,
          sampledAt,
          showDebugColumns,
          context,
        });

        if (
          profileRef.current !== currentProfile ||
          currentGameViewportRevisionRef.current !== gameViewportRevisionAtStart
        ) {
          return;
        }

        applyHuntStallSampleResult(result);

        if (result.shouldAlert) {
          playHuntStallAlert(
            huntConfig.soundId,
            huntConfig.volume,
            currentProfile.masterVolume,
            result.state.alertedAt,
            huntConfig.mode.replace(/-/g, "_"),
            result.state.repeatedAlertCount > 0 ? "repeat" : "initial",
          );
        }
        if (result.shouldResetOcrState) {
          resetHuntStallOcrState();
        }
      } catch (error) {
        if (
          profileRef.current !== currentProfile ||
          currentGameViewportRevisionRef.current !== gameViewportRevisionAtStart
        ) {
          return;
        }

        applyHuntStallSampleResult(
          processHuntStallSampleError({
            config: huntConfig,
            previousState: huntStallRuntimeRef.current,
            previewState: huntStallPreviewStateRef.current,
            runtimeTrace: huntStallRuntimeTraceRef.current,
            cropHistory: huntStallCropHistoryRef.current,
            sampledAt,
            error,
          }),
        );
      }
    },
    [
      applyHuntStallSampleResult,
      huntStallRuntimeRef,
      markActiveSamplePublished,
      playHuntStallAlert,
      profileRef,
      resetHuntStallOcrState,
      showDebugColumns,
      shouldPublishInactiveSample,
      stream,
    ],
  );

  useEffect(() => {
    if (appliedGameViewportRevisionRef.current === gameViewportRevision) {
      return;
    }
    appliedGameViewportRevisionRef.current = gameViewportRevision;
    huntStallIncidentRecorderRef.current = requestHuntStallIncidentRuntimeReset({
      previous: huntStallIncidentRecorderRef.current,
      reason: "region-changed",
    });
    resetHuntStallOcrState();
    const next = createHuntStallRuntimeState();
    huntStallRuntimeRef.current = next;
    setHuntStallRuntime(next);
    setHuntStallSnapshot(null);
  }, [
    gameViewportRevision,
    huntStallIncidentRecorderRef,
    huntStallRuntimeRef,
    resetHuntStallOcrState,
    setHuntStallRuntime,
    setHuntStallSnapshot,
  ]);

  useEffect(() => {
    huntStallIncidentRecorderRef.current = requestHuntStallIncidentRuntimeReset({
      previous: huntStallIncidentRecorderRef.current,
      reason: "stream-replaced",
    });
    resetHuntStallOcrState();
    if (!stream) {
      setHuntStallSnapshot(null);
    }
  }, [
    huntStallIncidentRecorderRef,
    resetHuntStallOcrState,
    setHuntStallSnapshot,
    stream,
  ]);

  return runHuntStallSample;
}

export function preserveConcurrentHuntStallPlayback(
  current: HuntStallRuntimeState,
  next: HuntStallRuntimeState,
): HuntStallRuntimeState {
  const currentPlayback = current.lastAlertPlayback ?? null;
  const nextPlayback = next.lastAlertPlayback ?? null;
  if (current.alertedAt === null || current.alertedAt !== next.alertedAt || !currentPlayback) {
    return next;
  }

  const currentAdvancedSamePlayback =
    nextPlayback !== null &&
    currentPlayback.requestedAt === nextPlayback.requestedAt &&
    getHuntStallPlaybackStatusRank(currentPlayback.status) >
      getHuntStallPlaybackStatusRank(nextPlayback.status);
  const currentStartedNewerPlayback =
    nextPlayback === null || currentPlayback.requestedAt > nextPlayback.requestedAt;
  const currentHasNewerRepeatCount =
    current.repeatedAlertCount > next.repeatedAlertCount &&
    (nextPlayback === null || currentPlayback.requestedAt >= nextPlayback.requestedAt);

  if (
    !currentAdvancedSamePlayback &&
    !currentStartedNewerPlayback &&
    !currentHasNewerRepeatCount
  ) {
    return next;
  }

  return {
    ...next,
    lastAlertPlayback: currentPlayback,
    lastRepeatedAlertAt: current.lastRepeatedAlertAt,
    repeatedAlertCount: Math.max(next.repeatedAlertCount, current.repeatedAlertCount),
    lastAlertedAt: maxTimestamp(next.lastAlertedAt, current.lastAlertedAt),
  };
}

function getHuntStallIncidentConfiguration(
  config: NonNullable<Profile["huntStallAlert"]>,
  masterVolume: number,
) {
  return {
    enabled: config.enabled,
    mode: config.mode,
    stallThresholdSeconds: config.stallThresholdSeconds,
    cooldownMissingThresholdSeconds: config.cooldownMissingThresholdSeconds,
    repeatAlertEnabled: config.repeatAlertEnabled ?? false,
    repeatAlertIntervalSeconds: config.repeatAlertIntervalSeconds ?? null,
    repeatAlertMaxCount: config.repeatAlertMaxCount ?? null,
    soundId: config.soundId,
    volume: config.volume,
    masterVolume,
    effectiveVolume: applyMasterVolume(config.volume, masterVolume),
  };
}

function getHuntStallPlaybackStatusRank(
  status: NonNullable<HuntStallRuntimeState["lastAlertPlayback"]>["status"],
): number {
  if (status === "requested") return 0;
  if (status === "started") return 1;
  return 2;
}

function maxTimestamp(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
