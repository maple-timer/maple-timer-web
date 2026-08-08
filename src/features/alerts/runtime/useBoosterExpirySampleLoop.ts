import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { playAlert } from "../../../lib/alert";
import {
  createAlertPlaybackRequested,
  markAlertPlaybackFailed,
  markAlertPlaybackStarted,
} from "../../../lib/alertPlaybackDiagnostics";
import {
  trackAlertPlayed,
  trackFeatureSessionActive,
} from "../../../lib/analyticsEvents";
import {
  BOOSTER_EXPIRY_CAPTURE_REGION,
  BOOSTER_EXPIRY_MAX_CAPTURE_WIDTH,
  cloneImageData,
} from "../../../lib/boosterExpiry/boosterExpiryCapture";
import {
  createBoosterExpiryRuntimeState,
  markBoosterExpiryRuntimeAlerted,
} from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import { createBoosterExpiryWorkerClient } from "../../../platform/runtime-workers/booster-expiry/boosterExpiryWorkerClient";
import { createDefaultBoosterExpiryAlert } from "../../../lib/storage";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile } from "../../../types";
import type { MonitoringFrameRequest } from "../../../runtime/monitoring/monitoringFrameBinding";
import {
  appendBoosterExpiryAlertedTrace,
  createBoosterExpirySampleProcessorState,
  processBoosterExpirySampleError,
  processBoosterExpiryUnavailableSample,
  processBoosterExpiryWorkerSample,
  resetBoosterExpirySampleProcessorState,
  shouldIncludeBoosterExpiryPreview,
  type BoosterExpirySampleProcessResult,
} from "./boosterExpirySampleProcessor";
import { useInactiveSamplePublishGate } from "./useInactiveSamplePublishGate";
import { useLazyRef } from "./useLazyRef";
import type { BoosterExpiryVideoSample } from "./boosterExpirySampleProcessorState";
import {
  createAlertIncidentFrameId,
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import {
  recordBoosterExpiryIncidentConfigurationObserved,
  recordBoosterExpiryIncidentPlaybackRequested,
  recordBoosterExpiryIncidentPlaybackTransition,
  recordBoosterExpiryIncidentScheduleOutcome,
  recordBoosterExpiryIncidentScheduleRegistered,
  requestBoosterExpiryIncidentFlowRestart,
  requestBoosterExpiryIncidentRuntimeReset,
  shouldCaptureBoosterExpiryIncidentMedia,
  type BoosterExpiryIncidentRuntimeRecorder,
} from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import type { BoosterExpiryIncidentFlowRestartReason } from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceTypes";
import {
  createBoosterExpiryIncidentConfiguration,
  createBoosterExpiryIncidentRuntimeFailure,
  recordBoosterExpiryMonitoringIncident,
} from "./boosterExpiryIncidentRuntimeAdapter";

export function useBoosterExpirySampleLoop({
  stream,
  gameViewportRevision,
  profileRef,
  boosterExpiryRuntimeRef,
  boosterExpiryIncidentRecorderRef,
  lastAlertErrorRef,
  setBoosterExpiryRuntime,
  setBoosterExpirySnapshot,
  onMessage,
  alertIncidentJournal,
}: {
  stream: MediaStream | null;
  gameViewportRevision: number;
  profileRef: MutableRefObject<Profile>;
  boosterExpiryRuntimeRef: MutableRefObject<BoosterExpiryRuntimeState>;
  boosterExpiryIncidentRecorderRef: MutableRefObject<BoosterExpiryIncidentRuntimeRecorder>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  setBoosterExpiryRuntime: Dispatch<SetStateAction<BoosterExpiryRuntimeState>>;
  setBoosterExpirySnapshot: Dispatch<SetStateAction<BoosterExpirySnapshot | null>>;
  onMessage: (message: string) => void;
  alertIncidentJournal?: AlertIncidentJournal;
}) {
  const workerRef = useLazyRef(createBoosterExpiryWorkerClient);
  const alertTimerRef = useRef<number | null>(null);
  const scheduledAlertRef = useRef<{
    alertAt: number;
    confirmedExpiresAt: number;
    incidentCycleId: string | null;
  } | null>(null);
  const previousStreamRef = useRef(stream);
  const currentGameViewportRevisionRef = useRef(gameViewportRevision);
  const appliedGameViewportRevisionRef = useRef(gameViewportRevision);
  currentGameViewportRevisionRef.current = gameViewportRevision;
  const diagnosticsRef = useLazyRef(createBoosterExpirySampleProcessorState);
  const {
    markActiveSamplePublished,
    shouldPublishInactiveSample,
  } = useInactiveSamplePublishGate();

  const recordScheduleLifecycle = useCallback(
    ({
      alertAt,
      confirmedExpiresAt,
      decision,
      occurredAt = Date.now(),
      details = {},
    }: {
      alertAt: number;
      confirmedExpiresAt: number;
      decision: string;
      occurredAt?: number;
      details?: Record<string, unknown>;
    }) => {
      const currentProfile = profileRef.current;
      const config =
        currentProfile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();
      const cycleId = `${confirmedExpiresAt}:${alertAt}`;
      alertIncidentJournal?.record({
        id: `booster-expiry:schedule:${cycleId}:${decision}:${occurredAt}`,
        feature: "booster-expiry",
        targetId: null,
        kind: "lifecycle",
        occurredAt,
        frameId: null,
        cycleId,
        status: decision,
        decision,
        value: alertAt,
        configuration: getBoosterExpiryIncidentConfiguration(
          config,
          currentProfile.masterVolume,
        ),
        details: {
          alertAt,
          confirmedExpiresAt,
          ...details,
        },
      });
    },
    [alertIncidentJournal, profileRef],
  );

  const observeIncidentConfiguration = useCallback((occurredAt: number) => {
    const currentProfile = profileRef.current;
    const config =
      currentProfile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();
    const result = recordBoosterExpiryIncidentConfigurationObserved({
      previous: boosterExpiryIncidentRecorderRef.current,
      configuration: createBoosterExpiryIncidentConfiguration(
        config,
        currentProfile.masterVolume,
      ),
      occurredAt,
    });
    boosterExpiryIncidentRecorderRef.current = result.recorder;
  }, [boosterExpiryIncidentRecorderRef, profileRef]);

  const recordIncidentScheduleOutcome = useCallback(({
    incidentCycleId,
    outcome,
    occurredAt,
    reason,
  }: {
    incidentCycleId: string | null;
    outcome: "cancelled" | "suppressed" | "fired";
    occurredAt: number;
    reason: string | null;
  }) => {
    if (!incidentCycleId) return;
    const activeSchedule =
      boosterExpiryIncidentRecorderRef.current.boundary?.activeSchedule;
    if (!activeSchedule || activeSchedule.cycleId !== incidentCycleId) return;
    const result = recordBoosterExpiryIncidentScheduleOutcome({
      previous: boosterExpiryIncidentRecorderRef.current,
      cycleId: incidentCycleId,
      outcome,
      occurredAt,
      reason,
    });
    boosterExpiryIncidentRecorderRef.current = result.recorder;
  }, [boosterExpiryIncidentRecorderRef]);

  const clearScheduledAlert = useCallback((
    reason = "schedule-cancelled",
    options: { recordIncidentOutcome?: boolean } = {},
  ) => {
    const scheduled = scheduledAlertRef.current;
    if (alertTimerRef.current !== null) {
      window.clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
    if (scheduled) {
      const occurredAt = Date.now();
      recordScheduleLifecycle({
        alertAt: scheduled.alertAt,
        confirmedExpiresAt: scheduled.confirmedExpiresAt,
        decision: reason,
        occurredAt,
      });
      if (options.recordIncidentOutcome !== false) {
        recordIncidentScheduleOutcome({
          incidentCycleId: scheduled.incidentCycleId,
          outcome: "cancelled",
          occurredAt,
          reason,
        });
      }
    }
    scheduledAlertRef.current = null;
  }, [recordIncidentScheduleOutcome, recordScheduleLifecycle]);

  const resetWorkerState = useCallback((options: {
    clearDiagnostics?: boolean;
    incidentResetReason?: "stream-replaced" | "source-geometry-changed";
  } = {}) => {
    const { clearDiagnostics = true, incidentResetReason } = options;
    workerRef.current.reset();
    clearScheduledAlert();
    if (incidentResetReason) {
      boosterExpiryIncidentRecorderRef.current =
        requestBoosterExpiryIncidentRuntimeReset({
          previous: boosterExpiryIncidentRecorderRef.current,
          reason: incidentResetReason,
        });
    }
    diagnosticsRef.current = resetBoosterExpirySampleProcessorState({
      clearDiagnostics,
      previous: diagnosticsRef.current,
    });
  }, [boosterExpiryIncidentRecorderRef, clearScheduledAlert]);

  const publishState = useCallback(
    (
      result: Pick<
        BoosterExpirySampleProcessResult,
        "stateBefore" | "state" | "snapshot" | "diagnostics"
      >,
    ) => {
      boosterExpiryRuntimeRef.current = result.state;
      diagnosticsRef.current = result.diagnostics;
      setBoosterExpiryRuntime(result.state);
      setBoosterExpirySnapshot(result.snapshot);
      const trace = result.diagnostics.trace[result.diagnostics.trace.length - 1] ?? null;
      const config = profileRef.current.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();
      if (trace) {
        alertIncidentJournal?.record({
          id: `booster-expiry:sample:${trace.sampledAt}`,
          feature: "booster-expiry",
          targetId: null,
          kind: trace.alerted ? "decision" : "sample",
          occurredAt: trace.sampledAt,
          frameId: createAlertIncidentFrameId(trace.sampledAt),
          cycleId: result.state.confirmedExpiresAt ?? result.state.estimatedExpiresAt,
          status: trace.status,
          decision: trace.decision,
          value: trace.rawText,
          configuration: getBoosterExpiryIncidentConfiguration(
            config,
            profileRef.current.masterVolume,
          ),
          details: {
            remainingSeconds: trace.remainingSeconds,
            estimatedExpiresAt: trace.estimatedExpiresAt,
            alertAt: trace.alertAt,
            flowSource: trace.flowSource,
            locked: trace.locked,
            runtimeFailureStage: trace.runtimeFailure?.stage ?? null,
            runtimeFailureCode: trace.runtimeFailure?.code ?? null,
            runtimeTechnicalMessage:
              trace.runtimeFailure?.technicalMessage ?? null,
            stateBefore: getBoosterExpiryIncidentState(result.stateBefore),
            stateAfter: getBoosterExpiryIncidentState(result.state),
          },
        });
      }
    },
    [
      alertIncidentJournal,
      boosterExpiryRuntimeRef,
      profileRef,
      setBoosterExpiryRuntime,
      setBoosterExpirySnapshot,
    ],
  );

  const playBoosterExpiryAlert = useCallback((state: BoosterExpiryRuntimeState, requestedAt: number) => {
    const currentProfile = profileRef.current;
    const config = currentProfile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();
    if (!config.enabled) {
      return;
    }

    observeIncidentConfiguration(requestedAt);
    const incidentCycle =
      boosterExpiryIncidentRecorderRef.current.boundary?.activeCycle ?? null;
    const incidentPlayback =
      incidentCycle &&
      incidentCycle.expiresAt ===
        (state.confirmedExpiresAt ?? state.estimatedExpiresAt)
        ? recordBoosterExpiryIncidentPlaybackRequested({
            previous: boosterExpiryIncidentRecorderRef.current,
            cycleId: incidentCycle.id,
            requestedAt,
          })
        : null;
    if (incidentPlayback) {
      boosterExpiryIncidentRecorderRef.current = incidentPlayback.recorder;
    }
    const incidentPlaybackAttemptId = incidentPlayback?.attemptId ?? null;

    const playback = createAlertPlaybackRequested({
      cycleId: state.confirmedExpiresAt ?? state.estimatedExpiresAt ?? state.alertedAt,
      soundId: config.soundId,
      requestedAt,
    });
    const stateWithPlayback = {
      ...state,
      lastAlertPlayback: playback,
    };
    boosterExpiryRuntimeRef.current = stateWithPlayback;
    setBoosterExpiryRuntime(stateWithPlayback);
    const playbackId = `booster-expiry:playback:${requestedAt}`;
    const playbackConfiguration = getBoosterExpiryIncidentConfiguration(
      config,
      currentProfile.masterVolume,
    );
    alertIncidentJournal?.record({
      id: playbackId,
      feature: "booster-expiry",
      targetId: null,
      kind: "playback",
      occurredAt: requestedAt,
      frameId: null,
      cycleId: playback.cycleId,
      status: "requested",
      decision: "initial",
      value: null,
      configuration: playbackConfiguration,
      details: {
        scheduledForAt: state.alertAt,
        requestedAt,
        schedulerDelayMs: state.alertAt === null ? null : requestedAt - state.alertAt,
        soundId: config.soundId,
        visibilityState: document.visibilityState,
      },
    });

    void playAlert(
      config.soundId,
      applyMasterVolume(config.volume, currentProfile.masterVolume),
    )
      .then(() => {
        const startedAt = Date.now();
        if (incidentPlaybackAttemptId) {
          const result = recordBoosterExpiryIncidentPlaybackTransition({
            previous: boosterExpiryIncidentRecorderRef.current,
            attemptId: incidentPlaybackAttemptId,
            status: "browser-play-accepted",
            occurredAt: startedAt,
          });
          boosterExpiryIncidentRecorderRef.current = result.recorder;
        }
        alertIncidentJournal?.record({
          id: playbackId,
          feature: "booster-expiry",
          targetId: null,
          kind: "playback",
          occurredAt: requestedAt,
          frameId: null,
          cycleId: playback.cycleId,
          status: "started",
          decision: "initial",
          value: null,
          configuration: playbackConfiguration,
          details: {
            scheduledForAt: state.alertAt,
            requestedAt,
            startedAt,
            schedulerDelayMs: state.alertAt === null ? null : requestedAt - state.alertAt,
            soundId: config.soundId,
            visibilityState: document.visibilityState,
          },
        });
        const current = boosterExpiryRuntimeRef.current;
        if (current.lastAlertPlayback?.requestedAt === playback.requestedAt) {
          const next = {
            ...current,
            lastAlertPlayback: markAlertPlaybackStarted(playback, startedAt),
          };
          boosterExpiryRuntimeRef.current = next;
          setBoosterExpiryRuntime(next);
        }
        trackAlertPlayed("booster_expiry", "initial");
      })
      .catch((error) => {
        const nextError =
          error instanceof Error ? error.message : "부스터 종료 알람 재생에 실패했습니다.";
        const current = boosterExpiryRuntimeRef.current;
        const failedAt = Date.now();
        if (incidentPlaybackAttemptId) {
          const result = recordBoosterExpiryIncidentPlaybackTransition({
            previous: boosterExpiryIncidentRecorderRef.current,
            attemptId: incidentPlaybackAttemptId,
            status: "failed",
            occurredAt: failedAt,
            error: nextError,
          });
          boosterExpiryIncidentRecorderRef.current = result.recorder;
        }
        alertIncidentJournal?.record({
          id: playbackId,
          feature: "booster-expiry",
          targetId: null,
          kind: "playback",
          occurredAt: requestedAt,
          frameId: null,
          cycleId: playback.cycleId,
          status: "failed",
          decision: "initial",
          value: null,
          configuration: playbackConfiguration,
          details: {
            scheduledForAt: state.alertAt,
            requestedAt,
            failedAt,
            error: nextError,
            schedulerDelayMs: state.alertAt === null ? null : requestedAt - state.alertAt,
            soundId: config.soundId,
            visibilityState: document.visibilityState,
          },
        });
        if (current.lastAlertPlayback?.requestedAt === playback.requestedAt) {
          const next = {
            ...current,
            lastAlertPlayback: markAlertPlaybackFailed(playback, failedAt, nextError),
          };
          boosterExpiryRuntimeRef.current = next;
          setBoosterExpiryRuntime(next);
        }
        if (lastAlertErrorRef.current !== nextError) {
          lastAlertErrorRef.current = nextError;
          onMessage(nextError);
        }
      });
  }, [
    alertIncidentJournal,
    boosterExpiryIncidentRecorderRef,
    boosterExpiryRuntimeRef,
    lastAlertErrorRef,
    observeIncidentConfiguration,
    onMessage,
    profileRef,
    setBoosterExpiryRuntime,
  ]);

  const ensureIncidentScheduleForState = useCallback((
    state: BoosterExpiryRuntimeState,
    registeredAt: number,
  ): string | null => {
    if (state.alertAt === null || state.confirmedExpiresAt === null) return null;
    observeIncidentConfiguration(registeredAt);
    const boundary = boosterExpiryIncidentRecorderRef.current.boundary;
    const cycle = boundary?.activeCycle ?? null;
    if (!boundary || !cycle || cycle.expiresAt !== state.confirmedExpiresAt) {
      return null;
    }
    if (
      boundary.latestDecision?.cycleId === cycle.id &&
      boundary.latestDecision.dueAt === state.alertAt
    ) {
      return cycle.id;
    }
    if (
      boundary.activeSchedule?.cycleId === cycle.id &&
      boundary.activeSchedule.alertDueAt === state.alertAt
    ) {
      return cycle.id;
    }
    const reason = boundary.activeSchedule
      ? "configuration-retimed"
      : boundary.latestSchedule?.cycleId === cycle.id
        ? "browser-rescheduled"
        : "cycle-confirmed";
    const result = recordBoosterExpiryIncidentScheduleRegistered({
      previous: boosterExpiryIncidentRecorderRef.current,
      cycleId: cycle.id,
      registeredAt,
      reason,
    });
    boosterExpiryIncidentRecorderRef.current = result.recorder;
    return result.rejectedReason === null ? cycle.id : null;
  }, [
    boosterExpiryIncidentRecorderRef,
    observeIncidentConfiguration,
  ]);

  const scheduleAlertForState = useCallback(
    (state: BoosterExpiryRuntimeState) => {
      if (
        state.alertAt === null ||
        state.confirmedExpiresAt === null
      ) {
        clearScheduledAlert();
        return;
      }

      const registeredAt = Date.now();
      const incidentCycleId = ensureIncidentScheduleForState(
        state,
        registeredAt,
      );
      if (state.alertedAt !== null) {
        clearScheduledAlert("schedule-fired", {
          recordIncidentOutcome: false,
        });
        recordIncidentScheduleOutcome({
          incidentCycleId,
          outcome: "fired",
          occurredAt: state.alertedAt,
          reason: "same-sample-alert",
        });
        return;
      }

      const scheduled = scheduledAlertRef.current;
      if (
        scheduled?.alertAt === state.alertAt &&
        scheduled.confirmedExpiresAt === state.confirmedExpiresAt &&
        alertTimerRef.current !== null
      ) {
        return;
      }

      clearScheduledAlert("schedule-replaced", {
        recordIncidentOutcome: false,
      });
      const alertAt = state.alertAt;
      const confirmedExpiresAt = state.confirmedExpiresAt;
      scheduledAlertRef.current = {
        alertAt,
        confirmedExpiresAt,
        incidentCycleId,
      };
      recordScheduleLifecycle({
        alertAt,
        confirmedExpiresAt,
        decision: "schedule-registered",
        details: { delayMs: Math.max(0, alertAt - Date.now()) },
      });
      alertTimerRef.current = window.setTimeout(() => {
        alertTimerRef.current = null;
        const currentScheduled = scheduledAlertRef.current;
        scheduledAlertRef.current = null;
        if (
          currentScheduled?.alertAt !== alertAt ||
          currentScheduled.confirmedExpiresAt !== confirmedExpiresAt
        ) {
          const suppressedAt = Date.now();
          recordScheduleLifecycle({
            alertAt,
            confirmedExpiresAt,
            decision: "schedule-suppressed",
            occurredAt: suppressedAt,
            details: { reason: "schedule-replaced-before-fire" },
          });
          recordIncidentScheduleOutcome({
            incidentCycleId: currentScheduled?.incidentCycleId ?? incidentCycleId,
            outcome: "suppressed",
            occurredAt: suppressedAt,
            reason: "schedule-replaced-before-fire",
          });
          return;
        }

        const currentState = boosterExpiryRuntimeRef.current;
        const currentConfig = profileRef.current.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();
        if (
          !currentConfig.enabled ||
          currentState.alertAt !== alertAt ||
          currentState.confirmedExpiresAt !== confirmedExpiresAt ||
          currentState.alertedAt !== null
        ) {
          const suppressedAt = Date.now();
          const reason = !currentConfig.enabled
            ? "disabled"
            : currentState.alertedAt !== null
              ? "already-alerted"
              : "state-changed";
          recordScheduleLifecycle({
            alertAt,
            confirmedExpiresAt,
            decision: "schedule-suppressed",
            occurredAt: suppressedAt,
            details: { reason },
          });
          recordIncidentScheduleOutcome({
            incidentCycleId: currentScheduled.incidentCycleId,
            outcome: "suppressed",
            occurredAt: suppressedAt,
            reason,
          });
          return;
        }

        const alertedAt = Date.now();
        recordScheduleLifecycle({
          alertAt,
          confirmedExpiresAt,
          decision: "schedule-fired",
          occurredAt: alertedAt,
          details: { schedulerDelayMs: alertedAt - alertAt },
        });
        recordIncidentScheduleOutcome({
          incidentCycleId: currentScheduled.incidentCycleId,
          outcome: "fired",
          occurredAt: alertedAt,
          reason: null,
        });
        const nextState = markBoosterExpiryRuntimeAlerted(currentState, alertedAt);
        diagnosticsRef.current = appendBoosterExpiryAlertedTrace({
          diagnostics: diagnosticsRef.current,
          sampledAt: alertedAt,
          state: nextState,
        });
        boosterExpiryRuntimeRef.current = nextState;
        setBoosterExpiryRuntime(nextState);
        playBoosterExpiryAlert(nextState, alertedAt);
      }, Math.max(0, alertAt - Date.now()));
    },
    [
      boosterExpiryRuntimeRef,
      clearScheduledAlert,
      ensureIncidentScheduleForState,
      playBoosterExpiryAlert,
      profileRef,
      recordIncidentScheduleOutcome,
      recordScheduleLifecycle,
      setBoosterExpiryRuntime,
    ],
  );

  const runBoosterExpirySample = useCallback(
    async ({ sampledAt, context }: MonitoringFrameRequest) => {
      const gameViewportRevisionAtStart =
        currentGameViewportRevisionRef.current;
      const currentProfile = profileRef.current;
      const config = currentProfile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();

      if (!config.enabled) {
        if (!shouldPublishInactiveSample(`disabled:${Boolean(stream)}`)) {
          return;
        }
        resetWorkerState({
          clearDiagnostics: boosterExpiryRuntimeRef.current.lastSampledAt === null,
        });
        const result = processBoosterExpiryUnavailableSample({
          config,
          diagnostics: diagnosticsRef.current,
          previousState: boosterExpiryRuntimeRef.current,
          sampledAt,
          hasStream: Boolean(stream),
        });
        boosterExpiryIncidentRecorderRef.current =
          recordBoosterExpiryMonitoringIncident({
            previous: boosterExpiryIncidentRecorderRef.current,
            config,
            masterVolume: currentProfile.masterVolume,
            sampledAt,
            context,
            sample: null,
            stateBefore: result.stateBefore,
            stateAfter: result.state,
            result: null,
            performance: null,
            runtimeFailure: null,
            recordFrame: false,
            unavailableAction: "feature-disabled",
          });
        publishState(result);
        return;
      }

      if (!stream || !context) {
        if (!shouldPublishInactiveSample(`video-unavailable:${Boolean(stream)}`)) {
          return;
        }
        const result = processBoosterExpiryUnavailableSample({
          config,
          diagnostics: diagnosticsRef.current,
          previousState: boosterExpiryRuntimeRef.current,
          sampledAt,
          hasStream: Boolean(stream),
        });
        boosterExpiryIncidentRecorderRef.current =
          recordBoosterExpiryMonitoringIncident({
            previous: boosterExpiryIncidentRecorderRef.current,
            config,
            masterVolume: currentProfile.masterVolume,
            sampledAt,
            context,
            sample: null,
            stateBefore: result.stateBefore,
            stateAfter: result.state,
            result: null,
            performance: null,
            runtimeFailure: null,
            recordFrame: false,
            unavailableAction: "video-unavailable",
          });
        publishState(result);
        clearScheduledAlert();
        return;
      }

      let sampledFrame: BoosterExpiryVideoSample | null = null;
      let shouldCaptureIncidentMedia = false;
      try {
        markActiveSamplePublished();
        trackFeatureSessionActive("booster_expiry", { mode: "ocr", enabledCount: 1 });

        if (boosterExpiryRuntimeRef.current.lastSampledAt === null) {
          resetWorkerState();
        }

        const previousState = boosterExpiryRuntimeRef.current;
        shouldCaptureIncidentMedia = shouldCaptureBoosterExpiryIncidentMedia({
          recorder: boosterExpiryIncidentRecorderRef.current,
          sampledAt,
        });
        const shouldIncludePreview =
          shouldCaptureIncidentMedia ||
          shouldIncludeBoosterExpiryPreview({
            diagnostics: diagnosticsRef.current,
            sampledAt,
          });
        const sample = context.sampleGameVideoRegion(
          BOOSTER_EXPIRY_CAPTURE_REGION,
          shouldIncludePreview,
          BOOSTER_EXPIRY_MAX_CAPTURE_WIDTH,
        );
        sampledFrame = sample;
        const previewImageData = shouldIncludePreview ? cloneImageData(sample.imageData) : null;
        const processed = await workerRef.current.process(sample.imageData, sampledAt);
        if (
          currentGameViewportRevisionRef.current !== gameViewportRevisionAtStart
        ) {
          return;
        }
        const result = processBoosterExpiryWorkerSample({
          config,
          currentState: boosterExpiryRuntimeRef.current,
          diagnostics: diagnosticsRef.current,
          previousState,
          previewImageData,
          processed,
          sample,
          sampledAt,
          shouldIncludePreview,
        });

        boosterExpiryIncidentRecorderRef.current =
          recordBoosterExpiryMonitoringIncident({
            previous: boosterExpiryIncidentRecorderRef.current,
            config,
            masterVolume: currentProfile.masterVolume,
            sampledAt,
            context,
            sample,
            stateBefore: result.stateBefore,
            stateAfter: result.state,
            result: processed.result,
            performance: processed.performance,
            runtimeFailure: null,
            mediaImageDataUrl: shouldCaptureIncidentMedia
              ? sample.rawPreviewUrl
              : null,
          });
        publishState(result);
        scheduleAlertForState(result.state);
        if (result.shouldAlertNow) {
          playBoosterExpiryAlert(result.state, result.state.alertedAt ?? sampledAt);
        }
      } catch (error) {
        if (
          currentGameViewportRevisionRef.current !== gameViewportRevisionAtStart
        ) {
          return;
        }
        const result = processBoosterExpirySampleError({
          config,
          diagnostics: diagnosticsRef.current,
          previousState: boosterExpiryRuntimeRef.current,
          sampledAt,
          error,
        });
        const runtimeFailure = createBoosterExpiryIncidentRuntimeFailure({
          failure: result.snapshot.runtimeFailure ?? null,
          error,
          workerRequestStarted: sampledFrame !== null,
        });
        boosterExpiryIncidentRecorderRef.current =
          recordBoosterExpiryMonitoringIncident({
            previous: boosterExpiryIncidentRecorderRef.current,
            config,
            masterVolume: currentProfile.masterVolume,
            sampledAt,
            context,
            sample: sampledFrame,
            stateBefore: result.stateBefore,
            stateAfter: result.state,
            result: null,
            performance: null,
            runtimeFailure,
            mediaImageDataUrl:
              shouldCaptureIncidentMedia && sampledFrame
                ? sampledFrame.rawPreviewUrl
                : null,
          });
        const flowRestartReason =
          getBoosterExpiryFlowRestartReason(runtimeFailure);
        if (flowRestartReason) {
          boosterExpiryIncidentRecorderRef.current =
            requestBoosterExpiryIncidentFlowRestart({
              previous: boosterExpiryIncidentRecorderRef.current,
              reason: flowRestartReason,
              requestedAt: sampledAt,
            });
        }
        publishState(result);
        scheduleAlertForState(result.state);
        if (result.errorMessage) {
          onMessage(result.errorMessage);
        }
      }
    },
    [
      boosterExpiryRuntimeRef,
      boosterExpiryIncidentRecorderRef,
      clearScheduledAlert,
      markActiveSamplePublished,
      onMessage,
      playBoosterExpiryAlert,
      profileRef,
      publishState,
      resetWorkerState,
      scheduleAlertForState,
      shouldPublishInactiveSample,
      stream,
    ],
  );

  useEffect(() => {
    if (appliedGameViewportRevisionRef.current === gameViewportRevision) {
      return;
    }
    appliedGameViewportRevisionRef.current = gameViewportRevision;
    resetWorkerState({
      clearDiagnostics: true,
      incidentResetReason: "source-geometry-changed",
    });
    const next = createBoosterExpiryRuntimeState();
    boosterExpiryRuntimeRef.current = next;
    setBoosterExpiryRuntime(next);
    setBoosterExpirySnapshot(null);
  }, [
    boosterExpiryRuntimeRef,
    gameViewportRevision,
    resetWorkerState,
    setBoosterExpiryRuntime,
    setBoosterExpirySnapshot,
  ]);

  useEffect(() => {
    const streamChanged = previousStreamRef.current !== stream;
    previousStreamRef.current = stream;
    resetWorkerState({
      clearDiagnostics: true,
      incidentResetReason: streamChanged ? "stream-replaced" : undefined,
    });
    if (!stream) {
      const next = createBoosterExpiryRuntimeState();
      boosterExpiryRuntimeRef.current = next;
      setBoosterExpiryRuntime(next);
      setBoosterExpirySnapshot(null);
    }

    return () => {
      clearScheduledAlert();
    };
  }, [
    boosterExpiryRuntimeRef,
    clearScheduledAlert,
    resetWorkerState,
    setBoosterExpiryRuntime,
    setBoosterExpirySnapshot,
    stream,
  ]);

  return {
    runBoosterExpirySample,
    resetBoosterExpiryDetection: () => resetWorkerState(),
  };
}

function getBoosterExpiryIncidentConfiguration(
  config: NonNullable<Profile["boosterExpiryAlert"]>,
  masterVolume: number,
) {
  return {
    enabled: config.enabled,
    alertLeadSeconds: config.alertLeadSeconds,
    soundId: config.soundId,
    volume: config.volume,
    masterVolume,
    effectiveVolume: applyMasterVolume(config.volume, masterVolume),
  };
}

function getBoosterExpiryIncidentState(state: BoosterExpiryRuntimeState) {
  return {
    status: state.status,
    decision: state.lastDecision,
    rawRemainingSeconds: state.rawRemainingSeconds,
    remainingSeconds: state.remainingSeconds,
    estimatedExpiresAt: state.estimatedExpiresAt,
    alertAt: state.alertAt,
    alertedAt: state.alertedAt,
    confirmedAt: state.confirmedAt,
    confirmedExpiresAt: state.confirmedExpiresAt,
    locked: state.locked,
    flowSource: state.flowSource,
  };
}

function getBoosterExpiryFlowRestartReason(
  failure: ReturnType<typeof createBoosterExpiryIncidentRuntimeFailure>,
): Exclude<BoosterExpiryIncidentFlowRestartReason, "initialized"> | null {
  if (failure.stage === "worker-timeout") return "worker-timeout";
  if (
    failure.stage === "worker-create" ||
    failure.stage === "worker-runtime"
  ) {
    return "worker-runtime-failed";
  }
  return null;
}

export { createBoosterExpiryRuntimeState };
