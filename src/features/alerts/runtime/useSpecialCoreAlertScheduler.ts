import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { playAlertFromOffset, preloadAlertFromOffset } from "../../../lib/alert";
import {
  type AlertPlaybackDiagnostic,
  createAlertPlaybackRequested,
  markAlertPlaybackFailed,
  markAlertPlaybackFinished,
  markAlertPlaybackStarted,
} from "../../../lib/alertPlaybackDiagnostics";
import { trackAlertPlayed } from "../../../lib/analyticsEvents";
import {
  getSpecialCoreCountdownAudioStartOffsetSeconds,
  markSpecialCoreAlerted,
  type SpecialCoreRuntimeState,
} from "../../../lib/specialCore";
import { createDefaultSpecialCoreAlert } from "../../../lib/storage";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile, SpecialCoreAlertConfig } from "../../../types";
import type { AlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import {
  recordSpecialCoreIncidentConfigurationObserved,
  recordSpecialCoreIncidentPlaybackRequested,
  recordSpecialCoreIncidentPlaybackTransition,
  recordSpecialCoreIncidentScheduleOutcome,
  recordSpecialCoreIncidentScheduleRegistered,
  type SpecialCoreIncidentRuntimeRecorder,
} from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import type { RemoteRecognitionWarmTraceTerminalOutcome } from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  completeSpecialCoreWarmTracePlayback,
  completeSpecialCoreWarmTraceSchedule,
  takeSpecialCoreWarmTraceActivation,
  terminateSpecialCoreWarmTraceCandidate,
  type SpecialCoreWarmTraceScheduleCandidate,
} from "./specialCoreWarmTrace";

type ScheduledSpecialCoreAlert = {
  activationId: number;
  alertDueAt: number;
  timeoutId: number;
  warmTrace: SpecialCoreWarmTraceScheduleCandidate | null;
};

export function useSpecialCoreAlertScheduler({
  stream,
  gameViewportRevision,
  config,
  profileRef,
  specialCoreRuntime,
  specialCoreRuntimeRef,
  specialCoreIncidentRecorderRef,
  alertIncidentJournal,
  lastAlertErrorRef,
  setSpecialCoreRuntime,
  onMessage,
}: {
  stream: MediaStream | null;
  gameViewportRevision: number;
  config: SpecialCoreAlertConfig;
  profileRef: MutableRefObject<Profile>;
  specialCoreRuntime: SpecialCoreRuntimeState;
  specialCoreRuntimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  specialCoreIncidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
  alertIncidentJournal?: AlertIncidentJournal;
  lastAlertErrorRef: MutableRefObject<string | null>;
  setSpecialCoreRuntime: Dispatch<SetStateAction<SpecialCoreRuntimeState>>;
  onMessage: (message: string) => void;
}) {
  const scheduledAlertRef = useRef<ScheduledSpecialCoreAlert | null>(null);
  const activeCountdownControllerRef = useRef<AbortController | null>(null);
  const activeCountdownActivationIdRef = useRef<number | null>(null);
  const activeWarmTraceRef = useRef<SpecialCoreWarmTraceScheduleCandidate | null>(null);
  const preloadedSoundIdRef = useRef<string | null>(null);
  const appliedGameViewportRevisionRef = useRef(gameViewportRevision);
  const awaitingPostViewportRuntimeRef = useRef(false);

  const recordScheduleLifecycle = useCallback(
    ({
      activationId,
      alertDueAt,
      decision,
      occurredAt = Date.now(),
      details = {},
    }: {
      activationId: number;
      alertDueAt: number;
      decision: string;
      occurredAt?: number;
      details?: Record<string, unknown>;
    }) => {
      const currentProfile = profileRef.current;
      const currentConfig =
        currentProfile.specialCoreAlert ?? createDefaultSpecialCoreAlert();
      alertIncidentJournal?.record({
        id: `special-core:schedule:${activationId}:${decision}:${occurredAt}`,
        feature: "special-core",
        targetId: null,
        kind: "lifecycle",
        occurredAt,
        frameId: null,
        cycleId: activationId,
        status: decision,
        decision,
        value: alertDueAt,
        configuration: {
          enabled: currentConfig.enabled,
          cooldownSeconds: currentConfig.cooldownSeconds,
          alertLeadSeconds: currentConfig.alertLeadSeconds,
          soundId: currentConfig.soundId,
          volume: currentConfig.volume,
          masterVolume: currentProfile.masterVolume,
          effectiveVolume: applyMasterVolume(
            currentConfig.volume,
            currentProfile.masterVolume,
          ),
        },
        details: { alertDueAt, ...details },
      });
    },
    [alertIncidentJournal, profileRef],
  );

  const observeIncidentConfiguration = useCallback((occurredAt: number) => {
    const currentProfile = profileRef.current;
    const currentConfig =
      currentProfile.specialCoreAlert ?? createDefaultSpecialCoreAlert();
    const result = recordSpecialCoreIncidentConfigurationObserved({
      previous: specialCoreIncidentRecorderRef.current,
      configuration: {
        enabled: currentConfig.enabled,
        cooldownSeconds: currentConfig.cooldownSeconds,
        alertLeadSeconds: currentConfig.alertLeadSeconds,
        soundId: currentConfig.soundId,
        featureVolume: currentConfig.volume,
        masterVolume: currentProfile.masterVolume,
        effectiveVolume: applyMasterVolume(
          currentConfig.volume,
          currentProfile.masterVolume,
        ),
      },
      occurredAt,
    });
    specialCoreIncidentRecorderRef.current = result.recorder;
  }, [profileRef, specialCoreIncidentRecorderRef]);

  const clearScheduledAlert = useCallback((
    reason = "schedule-cancelled",
    options: { recordIncidentOutcome?: boolean } = {},
  ) => {
    const scheduled = scheduledAlertRef.current;
    if (!scheduled) {
      return;
    }
    window.clearTimeout(scheduled.timeoutId);
    scheduledAlertRef.current = null;
    terminateSpecialCoreWarmTraceCandidate(
      scheduled.warmTrace,
      getSpecialCoreWarmTraceClearOutcome(reason),
    );
    const occurredAt = Date.now();
    recordScheduleLifecycle({
      activationId: scheduled.activationId,
      alertDueAt: scheduled.alertDueAt,
      decision: reason,
      occurredAt,
    });
    if (options.recordIncidentOutcome !== false) {
      const result = recordSpecialCoreIncidentScheduleOutcome({
        previous: specialCoreIncidentRecorderRef.current,
        runtimeActivationId: scheduled.activationId,
        outcome: "cancelled",
        occurredAt,
        reason,
      });
      specialCoreIncidentRecorderRef.current = result.recorder;
    }
  }, [recordScheduleLifecycle, specialCoreIncidentRecorderRef]);

  const stopActiveCountdown = useCallback((
    outcome: RemoteRecognitionWarmTraceTerminalOutcome = "cancelled",
  ) => {
    activeCountdownControllerRef.current?.abort();
    activeCountdownControllerRef.current = null;
    activeCountdownActivationIdRef.current = null;
    const warmTrace = activeWarmTraceRef.current;
    activeWarmTraceRef.current = null;
    terminateSpecialCoreWarmTraceCandidate(warmTrace, outcome);
  }, []);

  const playSpecialCoreAlert = useCallback(
    (
      state: SpecialCoreRuntimeState,
      now: number,
      warmTrace: SpecialCoreWarmTraceScheduleCandidate | null,
    ) => {
      const currentProfile = profileRef.current;
      const currentConfig = currentProfile.specialCoreAlert ?? createDefaultSpecialCoreAlert();
      if (!currentConfig.enabled) {
        terminateSpecialCoreWarmTraceCandidate(warmTrace, "suppressed");
        return;
      }

      stopActiveCountdown("replaced");
      const countdownController = new AbortController();
      activeCountdownControllerRef.current = countdownController;
      activeCountdownActivationIdRef.current = state.activationId;
      activeWarmTraceRef.current = warmTrace;

      const remainingSeconds =
        state.cooldownEndsAt === null ? 0 : Math.max(0, (state.cooldownEndsAt - now) / 1000);
      const requestedPlayback = state.lastAlertPlayback;
      const playbackId = `special-core:playback:${requestedPlayback?.requestedAt ?? now}`;
      const startOffsetSeconds =
        getSpecialCoreCountdownAudioStartOffsetSeconds(remainingSeconds);
      const playbackConfiguration = {
        enabled: currentConfig.enabled,
        cooldownSeconds: currentConfig.cooldownSeconds,
        alertLeadSeconds: currentConfig.alertLeadSeconds,
        soundId: currentConfig.soundId,
        volume: currentConfig.volume,
        masterVolume: currentProfile.masterVolume,
        effectiveVolume: applyMasterVolume(
          currentConfig.volume,
          currentProfile.masterVolume,
        ),
      };
      const playbackRequestedAt = requestedPlayback?.requestedAt ?? now;
      observeIncidentConfiguration(playbackRequestedAt);
      const incidentPlayback = recordSpecialCoreIncidentPlaybackRequested({
        previous: specialCoreIncidentRecorderRef.current,
        runtimeActivationId: state.activationId,
        requestedAt: playbackRequestedAt,
        startOffsetSeconds,
      });
      specialCoreIncidentRecorderRef.current = incidentPlayback.recorder;
      const incidentPlaybackAttemptId = incidentPlayback.attemptId;
      let startedPlayback: AlertPlaybackDiagnostic | null = null;
      let browserStarted = false;

      const handleBrowserStarted = () => {
        completeSpecialCoreWarmTracePlayback(warmTrace);
        if (activeWarmTraceRef.current === warmTrace) {
          activeWarmTraceRef.current = null;
        }
        if (browserStarted) return;
        browserStarted = true;
        const startedAt = Date.now();
        if (incidentPlaybackAttemptId) {
          const result = recordSpecialCoreIncidentPlaybackTransition({
            previous: specialCoreIncidentRecorderRef.current,
            attemptId: incidentPlaybackAttemptId,
            status: "browser-play-accepted",
            occurredAt: startedAt,
          });
          specialCoreIncidentRecorderRef.current = result.recorder;
        }
        if (!requestedPlayback) return;
        startedPlayback = markAlertPlaybackStarted(requestedPlayback, startedAt);
        alertIncidentJournal?.record({
          id: playbackId,
          feature: "special-core",
          targetId: null,
          kind: "playback",
          occurredAt: startedPlayback.requestedAt,
          frameId: null,
          cycleId: startedPlayback.cycleId,
          status: "started",
          decision: "initial",
          value: remainingSeconds,
          configuration: playbackConfiguration,
          details: {
            scheduledForAt: state.alertDueAt,
            requestedAt: startedPlayback.requestedAt,
            startedAt,
            schedulerDelayMs:
              state.alertDueAt === null
                ? null
                : startedPlayback.requestedAt - state.alertDueAt,
            startOffsetSeconds,
            visibilityState: document.visibilityState,
          },
        });
        const current = specialCoreRuntimeRef.current;
        if (current.lastAlertPlayback?.requestedAt === startedPlayback.requestedAt) {
          const next = { ...current, lastAlertPlayback: startedPlayback };
          specialCoreRuntimeRef.current = next;
          setSpecialCoreRuntime(next);
        }
      };

      void playAlertFromOffset(
        currentConfig.soundId,
        applyMasterVolume(currentConfig.volume, currentProfile.masterVolume),
        startOffsetSeconds,
        {
          signal: countdownController.signal,
          onStarted: handleBrowserStarted,
        },
      )
        .then(() => {
          const finishedAt = Date.now();
          if (!startedPlayback) {
            terminateSpecialCoreWarmTraceCandidate(warmTrace, "failed");
            if (activeWarmTraceRef.current === warmTrace) {
              activeWarmTraceRef.current = null;
            }
            const notStartedError = "playback-resolved-before-browser-start";
            if (incidentPlaybackAttemptId) {
              const result = recordSpecialCoreIncidentPlaybackTransition({
                previous: specialCoreIncidentRecorderRef.current,
                attemptId: incidentPlaybackAttemptId,
                status: "failed",
                occurredAt: finishedAt,
                error: notStartedError,
              });
              specialCoreIncidentRecorderRef.current = result.recorder;
            }
            if (requestedPlayback) {
              const current = specialCoreRuntimeRef.current;
              if (
                current.lastAlertPlayback?.requestedAt ===
                requestedPlayback.requestedAt
              ) {
                const failedPlayback = markAlertPlaybackFailed(
                  requestedPlayback,
                  finishedAt,
                  notStartedError,
                );
                const next = { ...current, lastAlertPlayback: failedPlayback };
                specialCoreRuntimeRef.current = next;
                setSpecialCoreRuntime(next);
              }
            }
            return;
          }
          if (incidentPlaybackAttemptId) {
            const result = recordSpecialCoreIncidentPlaybackTransition({
              previous: specialCoreIncidentRecorderRef.current,
              attemptId: incidentPlaybackAttemptId,
              status: "finished",
              occurredAt: finishedAt,
            });
            specialCoreIncidentRecorderRef.current = result.recorder;
          }
          const current = specialCoreRuntimeRef.current;
          if (
            current.lastAlertPlayback?.requestedAt === startedPlayback.requestedAt
          ) {
            const finishedPlayback = markAlertPlaybackFinished(startedPlayback, finishedAt);
            const next = {
              ...current,
              lastAlertPlayback: finishedPlayback,
            };
            specialCoreRuntimeRef.current = next;
            setSpecialCoreRuntime(next);
            alertIncidentJournal?.record({
              id: playbackId,
              feature: "special-core",
              targetId: null,
              kind: "playback",
              occurredAt: startedPlayback.requestedAt,
              frameId: null,
              cycleId: startedPlayback.cycleId,
              status: "finished",
              decision: "initial",
              value: remainingSeconds,
              configuration: playbackConfiguration,
              details: {
                scheduledForAt: state.alertDueAt,
                requestedAt: startedPlayback.requestedAt,
                startedAt: startedPlayback.startedAt,
                finishedAt,
                schedulerDelayMs:
                  state.alertDueAt === null
                    ? null
                    : startedPlayback.requestedAt - state.alertDueAt,
                visibilityState: document.visibilityState,
              },
            });
          }
          trackAlertPlayed("special_core", "initial");
        })
        .catch((error) => {
          terminateSpecialCoreWarmTraceCandidate(
            warmTrace,
            countdownController.signal.aborted ? "cancelled" : "failed",
          );
          if (activeWarmTraceRef.current === warmTrace) {
            activeWarmTraceRef.current = null;
          }
          const nextError =
            error instanceof Error ? error.message : "특수 코어 알림 재생에 실패했습니다.";
          const failedAt = Date.now();
          if (incidentPlaybackAttemptId) {
            const result = recordSpecialCoreIncidentPlaybackTransition({
              previous: specialCoreIncidentRecorderRef.current,
              attemptId: incidentPlaybackAttemptId,
              status: "failed",
              occurredAt: failedAt,
              error: nextError,
            });
            specialCoreIncidentRecorderRef.current = result.recorder;
          }
          const current = specialCoreRuntimeRef.current;
          const playbackBeforeFailure = startedPlayback ?? requestedPlayback;
          if (
            playbackBeforeFailure &&
            current.lastAlertPlayback?.requestedAt ===
              playbackBeforeFailure.requestedAt
          ) {
            const failedPlayback = markAlertPlaybackFailed(
              playbackBeforeFailure,
              failedAt,
              nextError,
            );
            const next = {
              ...current,
              lastAlertPlayback: failedPlayback,
            };
            specialCoreRuntimeRef.current = next;
            setSpecialCoreRuntime(next);
            alertIncidentJournal?.record({
              id: playbackId,
              feature: "special-core",
              targetId: null,
              kind: "playback",
              occurredAt: playbackBeforeFailure.requestedAt,
              frameId: null,
              cycleId: playbackBeforeFailure.cycleId,
              status: "failed",
              decision: "initial",
              value: remainingSeconds,
              configuration: playbackConfiguration,
              details: {
                scheduledForAt: state.alertDueAt,
                requestedAt: playbackBeforeFailure.requestedAt,
                startedAt: playbackBeforeFailure.startedAt,
                failedAt,
                error: nextError,
                schedulerDelayMs:
                  state.alertDueAt === null
                    ? null
                    : playbackBeforeFailure.requestedAt - state.alertDueAt,
                visibilityState: document.visibilityState,
              },
            });
          }
          if (lastAlertErrorRef.current !== nextError) {
            lastAlertErrorRef.current = nextError;
            onMessage(nextError);
          }
        })
        .finally(() => {
          if (activeCountdownControllerRef.current === countdownController) {
            activeCountdownControllerRef.current = null;
            activeCountdownActivationIdRef.current = null;
            activeWarmTraceRef.current = null;
          }
        });
    },
    [
      lastAlertErrorRef,
      onMessage,
      profileRef,
      setSpecialCoreRuntime,
      specialCoreIncidentRecorderRef,
      specialCoreRuntimeRef,
      stopActiveCountdown,
      observeIncidentConfiguration,
      alertIncidentJournal,
    ],
  );

  const fireScheduledAlert = useCallback(
    (
      activationId: number,
      alertDueAt: number,
      warmTrace: SpecialCoreWarmTraceScheduleCandidate | null,
    ) => {
      scheduledAlertRef.current = null;

      const currentConfig = profileRef.current.specialCoreAlert ?? createDefaultSpecialCoreAlert();
      if (!stream || !currentConfig.enabled) {
        terminateSpecialCoreWarmTraceCandidate(warmTrace, "suppressed");
        const occurredAt = Date.now();
        recordScheduleLifecycle({
          activationId,
          alertDueAt,
          decision: "schedule-suppressed",
          occurredAt,
          details: { reason: !stream ? "no-stream" : "disabled" },
        });
        const result = recordSpecialCoreIncidentScheduleOutcome({
          previous: specialCoreIncidentRecorderRef.current,
          runtimeActivationId: activationId,
          outcome: "suppressed",
          occurredAt,
          reason: !stream ? "no-stream" : "disabled",
        });
        specialCoreIncidentRecorderRef.current = result.recorder;
        return;
      }

      const state = specialCoreRuntimeRef.current;
      if (
        state.activationId !== activationId ||
        state.alertDueAt !== alertDueAt ||
        state.alertDueAt === null ||
        state.alertedAt !== null
      ) {
        terminateSpecialCoreWarmTraceCandidate(warmTrace, "suppressed");
        const occurredAt = Date.now();
        const reason = state.alertedAt !== null ? "already-alerted" : "state-changed";
        recordScheduleLifecycle({
          activationId,
          alertDueAt,
          decision: "schedule-suppressed",
          occurredAt,
          details: { reason },
        });
        const result = recordSpecialCoreIncidentScheduleOutcome({
          previous: specialCoreIncidentRecorderRef.current,
          runtimeActivationId: activationId,
          outcome: "suppressed",
          occurredAt,
          reason,
        });
        specialCoreIncidentRecorderRef.current = result.recorder;
        return;
      }

      const now = Date.now();
      if (now < state.alertDueAt) {
        const timeoutId = window.setTimeout(
          () => fireScheduledAlert(activationId, alertDueAt, warmTrace),
          Math.max(0, state.alertDueAt - now),
        );
        scheduledAlertRef.current = {
          activationId,
          alertDueAt,
          timeoutId,
          warmTrace,
        };
        recordScheduleLifecycle({
          activationId,
          alertDueAt,
          decision: "schedule-registered",
          occurredAt: now,
          details: { delayMs: Math.max(0, state.alertDueAt - now), rescheduled: true },
        });
        observeIncidentConfiguration(now);
        const result = recordSpecialCoreIncidentScheduleRegistered({
          previous: specialCoreIncidentRecorderRef.current,
          runtimeActivationId: activationId,
          registeredAt: now,
          reason: "browser-rescheduled",
        });
        specialCoreIncidentRecorderRef.current = result.recorder;
        return;
      }

      const alerted = markSpecialCoreAlerted(state, now);
      if (alerted === state) {
        terminateSpecialCoreWarmTraceCandidate(warmTrace, "suppressed");
        recordScheduleLifecycle({
          activationId,
          alertDueAt,
          decision: "schedule-suppressed",
          details: { reason: "alert-state-unchanged" },
        });
        const result = recordSpecialCoreIncidentScheduleOutcome({
          previous: specialCoreIncidentRecorderRef.current,
          runtimeActivationId: activationId,
          outcome: "suppressed",
          occurredAt: now,
          reason: "alert-state-unchanged",
        });
        specialCoreIncidentRecorderRef.current = result.recorder;
        return;
      }

      recordScheduleLifecycle({
        activationId,
        alertDueAt,
        decision: "schedule-fired",
        occurredAt: now,
        details: { schedulerDelayMs: now - alertDueAt },
      });
      const scheduleResult = recordSpecialCoreIncidentScheduleOutcome({
        previous: specialCoreIncidentRecorderRef.current,
        runtimeActivationId: activationId,
        outcome: "fired",
        occurredAt: now,
      });
      specialCoreIncidentRecorderRef.current = scheduleResult.recorder;

      const alertedWithPlayback = {
        ...alerted,
        lastAlertPlayback: createAlertPlaybackRequested({
          cycleId: activationId,
          soundId: currentConfig.soundId,
          requestedAt: now,
        }),
      };
      specialCoreRuntimeRef.current = alertedWithPlayback;
      setSpecialCoreRuntime(alertedWithPlayback);
      alertIncidentJournal?.record({
        id: `special-core:playback:${now}`,
        feature: "special-core",
        targetId: null,
        kind: "playback",
        occurredAt: now,
        frameId: null,
        cycleId: activationId,
        status: "requested",
        decision: "initial",
        value: null,
        configuration: {
          enabled: currentConfig.enabled,
          cooldownSeconds: currentConfig.cooldownSeconds,
          alertLeadSeconds: currentConfig.alertLeadSeconds,
          soundId: currentConfig.soundId,
          volume: currentConfig.volume,
          masterVolume: profileRef.current.masterVolume,
        },
        details: {
          scheduledForAt: alertDueAt,
          requestedAt: now,
          schedulerDelayMs: now - alertDueAt,
          visibilityState: document.visibilityState,
        },
      });
      playSpecialCoreAlert(alertedWithPlayback, now, warmTrace);
    },
    [
      playSpecialCoreAlert,
      observeIncidentConfiguration,
      profileRef,
      recordScheduleLifecycle,
      setSpecialCoreRuntime,
      specialCoreIncidentRecorderRef,
      specialCoreRuntimeRef,
      stream,
      alertIncidentJournal,
    ],
  );

  useEffect(() => {
    if (appliedGameViewportRevisionRef.current === gameViewportRevision) {
      return;
    }
    appliedGameViewportRevisionRef.current = gameViewportRevision;
    awaitingPostViewportRuntimeRef.current = true;
    clearScheduledAlert("game-viewport-changed");
    stopActiveCountdown("replaced");
  }, [
    clearScheduledAlert,
    gameViewportRevision,
    stopActiveCountdown,
  ]);

  useEffect(() => {
    if (!config.enabled) {
      preloadedSoundIdRef.current = null;
      stopActiveCountdown("cancelled");
      return;
    }

    if (preloadedSoundIdRef.current !== config.soundId) {
      preloadedSoundIdRef.current = config.soundId;
      void preloadAlertFromOffset(config.soundId).catch(() => undefined);
    }
  }, [config.enabled, config.soundId, stopActiveCountdown]);

  useEffect(() => {
    if (awaitingPostViewportRuntimeRef.current) {
      clearScheduledAlert("game-viewport-changed");
      stopActiveCountdown("replaced");
      if (specialCoreRuntime.alertDueAt === null) {
        awaitingPostViewportRuntimeRef.current = false;
      }
      return;
    }

    if (!stream || !config.enabled) {
      clearScheduledAlert();
      stopActiveCountdown("cancelled");
      return;
    }

    if (activeCountdownActivationIdRef.current !== null) {
      if (activeCountdownActivationIdRef.current !== specialCoreRuntime.activationId) {
        stopActiveCountdown("replaced");
      }
    }

    if (specialCoreRuntime.alertDueAt === null || specialCoreRuntime.alertedAt !== null) {
      clearScheduledAlert();
      return;
    }

    const scheduled = scheduledAlertRef.current;
    if (
      scheduled?.activationId === specialCoreRuntime.activationId &&
      scheduled.alertDueAt === specialCoreRuntime.alertDueAt
    ) {
      return;
    }

    const registrationReason =
      scheduled?.activationId === specialCoreRuntime.activationId
        ? "configuration-retimed"
        : "activation-confirmed";
    clearScheduledAlert("schedule-replaced", {
      recordIncidentOutcome: false,
    });
    const registeredAt = Date.now();
    let warmTrace = takeSpecialCoreWarmTraceActivation(specialCoreRuntime);
    const timeoutId = window.setTimeout(
      () =>
        fireScheduledAlert(
          specialCoreRuntime.activationId,
          specialCoreRuntime.alertDueAt!,
          warmTrace,
        ),
      Math.max(0, specialCoreRuntime.alertDueAt - registeredAt),
    );
    if (!completeSpecialCoreWarmTraceSchedule(warmTrace)) {
      warmTrace = null;
    }
    scheduledAlertRef.current = {
      activationId: specialCoreRuntime.activationId,
      alertDueAt: specialCoreRuntime.alertDueAt,
      timeoutId,
      warmTrace,
    };
    recordScheduleLifecycle({
      activationId: specialCoreRuntime.activationId,
      alertDueAt: specialCoreRuntime.alertDueAt,
      decision: "schedule-registered",
      occurredAt: registeredAt,
      details: {
        delayMs: Math.max(0, specialCoreRuntime.alertDueAt - registeredAt),
      },
    });
    observeIncidentConfiguration(registeredAt);
    const result = recordSpecialCoreIncidentScheduleRegistered({
      previous: specialCoreIncidentRecorderRef.current,
      runtimeActivationId: specialCoreRuntime.activationId,
      registeredAt,
      reason: registrationReason,
    });
    specialCoreIncidentRecorderRef.current = result.recorder;
  }, [
    clearScheduledAlert,
    config.enabled,
    fireScheduledAlert,
    recordScheduleLifecycle,
    observeIncidentConfiguration,
    specialCoreIncidentRecorderRef,
    specialCoreRuntime.activationId,
    specialCoreRuntime.alertDueAt,
    specialCoreRuntime.alertedAt,
    stopActiveCountdown,
    stream,
  ]);

  useEffect(
    () => () => {
      clearScheduledAlert("scheduler-unmounted");
      stopActiveCountdown("cancelled");
    },
    [clearScheduledAlert, stopActiveCountdown],
  );
}

function getSpecialCoreWarmTraceClearOutcome(
  reason: string,
): RemoteRecognitionWarmTraceTerminalOutcome {
  return reason === "schedule-replaced" || reason === "game-viewport-changed"
    ? "replaced"
    : "cancelled";
}
