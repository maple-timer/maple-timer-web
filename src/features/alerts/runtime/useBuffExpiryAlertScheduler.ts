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
import { trackAlertPlayed } from "../../../lib/analyticsEvents";
import { getBuffExpiryEffectiveAlertLeadSeconds } from "../../../domain/buff-expiry/alertLeadPolicy";
import { appendBuffExpiryAlertDecision } from "./buffExpiryPrecisionRuntimeDiagnostics";
import {
  getBuffExpiryPrecisionAlertClusters,
  markDueBuffExpiryPrecisionClustersAlerted,
} from "../../../domain/buff-expiry/precisionAlertClusters";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryTrackedBuff } from "../../../domain/buff-expiry/precisionTrackingTypes";
import { createDefaultBuffExpiryAlert } from "../../../lib/storage";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile } from "../../../types";
import {
  REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US,
  type RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  buildBuffExpiryLastAlertEvidence,
  type ScheduledBuffExpiryAlert,
} from "./buffExpiryAlertScheduling";
import type { AlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import { createBuffExpiryIncidentConfiguration } from "../../../application/reporting/buffExpiryIncidentConfiguration";
import {
  getBuffExpiryIncidentEpisodeIdsForTracks,
  recordBuffExpiryIncidentCycleStatus,
  recordBuffExpiryIncidentPlaybackRequested,
  recordBuffExpiryIncidentPlaybackResult,
  registerBuffExpiryIncidentCycle,
  type BuffExpiryIncidentRuntimeRecorder,
} from "../../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import {
  abandonBuffExpiryWarmTracePreparation,
  commitBuffExpiryWarmTraceWait,
  completeBuffExpiryWarmTracePlayback,
  prepareBuffExpiryWarmTraceWait,
  resumeBuffExpiryWarmTraceWait,
  terminateBuffExpiryWarmTraceCandidate,
  terminateBuffExpiryWarmTracePlayback,
  terminateBuffExpiryWarmTraceWaitSlot,
  type BuffExpiryWarmTracePlaybackContext,
  type BuffExpiryWarmTraceScheduleCandidate,
  type BuffExpiryWarmTraceWaitSlot,
} from "./buffExpiryWarmTrace";

type RuntimeScheduledBuffExpiryAlert = ScheduledBuffExpiryAlert & {
  warmTraceWaitSlot: BuffExpiryWarmTraceWaitSlot;
};

export function useBuffExpiryAlertScheduler({
  profileRef,
  buffExpiryRuntimeRef,
  buffExpirySnapshotRef,
  buffExpiryIncidentRecorderRef,
  lastAlertErrorRef,
  setBuffExpiryRuntime,
  setBuffExpirySnapshot,
  alertIncidentJournal,
  onMessage,
}: {
  profileRef: MutableRefObject<Profile>;
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  buffExpiryIncidentRecorderRef: MutableRefObject<BuffExpiryIncidentRuntimeRecorder>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  setBuffExpiryRuntime: Dispatch<SetStateAction<BuffExpiryRuntimeState>>;
  setBuffExpirySnapshot: Dispatch<SetStateAction<BuffExpirySnapshot | null>>;
  alertIncidentJournal?: AlertIncidentJournal;
  onMessage: (message: string) => void;
}) {
  const scheduledAlertsRef = useRef<Map<string, RuntimeScheduledBuffExpiryAlert>>(
    new Map(),
  );
  const inFlightWarmTracePlaybackRef = useRef<
    Map<string, BuffExpiryWarmTracePlaybackContext>
  >(new Map());

  const recordScheduleLifecycle = useCallback(
    ({
      scheduledKey,
      cycleId,
      episodeIds,
      dueAt,
      decision,
      occurredAt = Date.now(),
      details = {},
    }: {
      scheduledKey: string;
      cycleId: string;
      episodeIds: string[];
      dueAt: number | null;
      decision: string;
      occurredAt?: number;
      details?: Record<string, unknown>;
    }) => {
      const currentProfile = profileRef.current;
      const config =
        currentProfile.buffExpiryAlert ?? createDefaultBuffExpiryAlert();
      alertIncidentJournal?.record({
        id: `buff-expiry:schedule:${scheduledKey}:${decision}:${occurredAt}`,
        feature: "buff-expiry",
        targetId: getBuffExpiryIncidentJournalTargetId(
          buffExpiryIncidentRecorderRef.current,
          episodeIds,
        ),
        kind: "lifecycle",
        occurredAt,
        frameId: null,
        cycleId,
        status: decision,
        decision,
        value: dueAt,
        configuration: createBuffExpiryIncidentConfiguration(
          config,
          currentProfile.masterVolume,
        ),
        details: { dueAt, scheduledKey, episodeIds, ...details },
      });
    },
    [alertIncidentJournal, buffExpiryIncidentRecorderRef, profileRef],
  );

  const clearBuffExpiryAlertTimers = useCallback((reason = "schedule-cancelled") => {
    for (const [scheduledKey, scheduled] of scheduledAlertsRef.current.entries()) {
      window.clearTimeout(scheduled.timerId);
      terminateBuffExpiryWarmTraceWaitSlot(
        scheduled.warmTraceWaitSlot,
        "cancelled",
      );
      buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentCycleStatus({
        previous: buffExpiryIncidentRecorderRef.current,
        cycleId: scheduled.cycleId,
        occurredAt: Date.now(),
        status: "cancelled",
        reason,
      });
      recordScheduleLifecycle({
        scheduledKey,
        cycleId: scheduled.cycleId,
        episodeIds: scheduled.episodeIds,
        dueAt: scheduled.dueAt,
        decision: reason,
      });
    }
    scheduledAlertsRef.current.clear();
    for (const playback of inFlightWarmTracePlaybackRef.current.values()) {
      terminateBuffExpiryWarmTracePlayback(playback, "cancelled");
    }
    inFlightWarmTracePlaybackRef.current.clear();
  }, [buffExpiryIncidentRecorderRef, recordScheduleLifecycle]);

  const playScheduledBuffExpiryAlert = useCallback(
    (
      scheduledKey: string,
      warmTracePlayback: BuffExpiryWarmTracePlaybackContext | null,
    ) => {
      if (warmTracePlayback) {
        inFlightWarmTracePlaybackRef.current.set(
          scheduledKey,
          warmTracePlayback,
        );
      }
      const scheduled = scheduledAlertsRef.current.get(scheduledKey) ?? null;
      scheduledAlertsRef.current.delete(scheduledKey);
      const cycleId = scheduled?.cycleId ?? scheduledKey;
      const episodeIds = scheduled?.episodeIds ?? [];

      const currentProfile = profileRef.current;
      const config = currentProfile.buffExpiryAlert ?? createDefaultBuffExpiryAlert();
      if (!config.enabled) {
        terminateInFlightBuffExpiryWarmTracePlayback(
          inFlightWarmTracePlaybackRef,
          scheduledKey,
          "suppressed",
        );
        buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentCycleStatus({
          previous: buffExpiryIncidentRecorderRef.current,
          cycleId,
          occurredAt: Date.now(),
          status: "suppressed",
          reason: "disabled",
        });
        recordScheduleLifecycle({
          scheduledKey,
          cycleId,
          episodeIds,
          dueAt: scheduled?.dueAt ?? null,
          decision: "schedule-suppressed",
          details: { reason: "disabled" },
        });
        return;
      }

      const now = Date.now();
      const previousState = buffExpiryRuntimeRef.current;
      const alertLeadSeconds = getBuffExpiryEffectiveAlertLeadSeconds(config);
      const alertUpdate = markDueBuffExpiryPrecisionClustersAlerted({
        tracks: previousState.tracks,
        now,
        alertLeadSeconds,
      });

      if (!alertUpdate.alertDecision.dueTracks.length) {
        terminateInFlightBuffExpiryWarmTracePlayback(
          inFlightWarmTracePlaybackRef,
          scheduledKey,
          "suppressed",
        );
        buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentCycleStatus({
          previous: buffExpiryIncidentRecorderRef.current,
          cycleId,
          occurredAt: now,
          status: "suppressed",
          reason: "no-due-tracks",
        });
        recordScheduleLifecycle({
          scheduledKey,
          cycleId,
          episodeIds,
          dueAt: scheduled?.dueAt ?? null,
          decision: "schedule-suppressed",
          details: { reason: "no-due-tracks" },
        });
        return;
      }

      const cycleStatus = alertUpdate.shouldAlert ? "fired" : "suppressed";
      if (
        warmTracePlayback &&
        !alertUpdate.alertDecision.newAlertTrackIds.includes(
          warmTracePlayback.trackId,
        )
      ) {
        terminateInFlightBuffExpiryWarmTracePlayback(
          inFlightWarmTracePlaybackRef,
          scheduledKey,
          "suppressed",
        );
      }
      buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentCycleStatus({
        previous: buffExpiryIncidentRecorderRef.current,
        cycleId,
        occurredAt: now,
        status: cycleStatus,
        reason: alertUpdate.alertDecision.reason,
      });
      recordScheduleLifecycle({
        scheduledKey,
        cycleId,
        episodeIds,
        dueAt: scheduled?.dueAt ?? null,
        decision:
          alertUpdate.shouldAlert ? "schedule-fired" : "schedule-suppressed",
        occurredAt: now,
        details: {
          schedulerDelayMs:
            scheduled?.dueAt === undefined ? null : now - scheduled.dueAt,
          dueTrackIds: alertUpdate.alertDecision.dueTracks.map((track) => track.id),
        },
      });

      const lastAlertEvidence =
        alertUpdate.shouldAlert
          ? buildBuffExpiryLastAlertEvidence({
              alertedAt: now,
              alertLeadSeconds,
              clusterId: cycleId,
              dueAt: scheduled?.dueAt ?? null,
              alertDecision: alertUpdate.alertDecision,
              tracks: alertUpdate.tracks,
              snapshot: buffExpirySnapshotRef.current,
            })
          : previousState.lastAlertEvidence ?? null;
      const playback = alertUpdate.shouldAlert
        ? createAlertPlaybackRequested({
            cycleId,
            soundId: config.soundId,
            requestedAt: now,
          })
        : previousState.lastAlertPlayback ?? null;
      const nextState: BuffExpiryRuntimeState = {
        ...previousState,
        status: alertUpdate.tracks.some((track) => track.alertedAt !== null)
          ? "alerted"
          : previousState.status,
        tracks: alertUpdate.tracks,
        lastAlertedAt: alertUpdate.shouldAlert ? now : previousState.lastAlertedAt,
        lastAlertPlayback: playback,
        lastAlertEvidence,
      };
      buffExpiryRuntimeRef.current = nextState;
      setBuffExpiryRuntime(nextState);
      setBuffExpirySnapshot((previousSnapshot) =>
        previousSnapshot
          ? {
              ...previousSnapshot,
              tracks: alertUpdate.tracks,
              alertDecisionHistory: appendBuffExpiryAlertDecision(
                previousSnapshot.alertDecisionHistory ?? [],
                alertUpdate.alertDecision,
              ),
              lastAlertEvidence,
            }
          : previousSnapshot,
      );

      if (!alertUpdate.shouldAlert || !playback) {
        terminateInFlightBuffExpiryWarmTracePlayback(
          inFlightWarmTracePlaybackRef,
          scheduledKey,
          "suppressed",
        );
        return;
      }

      const playbackId = `buff-expiry:playback:${playback.requestedAt}`;
      const playbackConfiguration = {
        enabled: config.enabled,
        alertLeadSeconds: config.alertLeadSeconds,
        selectedBuffIds: config.selectedBuffIds,
        selectedPrecisionTargetGroups: config.selectedPrecisionTargetGroups ?? [],
        soundId: config.soundId,
        volume: config.volume,
        masterVolume: currentProfile.masterVolume,
        effectiveVolume: applyMasterVolume(config.volume, currentProfile.masterVolume),
      };
      const incidentAttempt = recordBuffExpiryIncidentPlaybackRequested({
        previous: buffExpiryIncidentRecorderRef.current,
        cycleId,
        requestedAt: playback.requestedAt,
        soundId: config.soundId,
        featureVolume: config.volume,
        masterVolume: currentProfile.masterVolume,
        effectiveVolume: applyMasterVolume(
          config.volume,
          currentProfile.masterVolume,
        ),
        visibilityState: document.visibilityState,
      });
      buffExpiryIncidentRecorderRef.current = incidentAttempt.recorder;
      alertIncidentJournal?.record({
        id: playbackId,
        feature: "buff-expiry",
        targetId: getBuffExpiryIncidentJournalTargetId(
          buffExpiryIncidentRecorderRef.current,
          episodeIds,
        ),
        kind: "playback",
        occurredAt: playback.requestedAt,
        frameId: null,
        cycleId: playback.cycleId,
        status: "requested",
        decision: "initial",
        value: alertUpdate.alertDecision.dueTracks.length,
        configuration: playbackConfiguration,
        details: {
          scheduledForAt: scheduled?.dueAt ?? null,
          requestedAt: playback.requestedAt,
          schedulerDelayMs:
            scheduled?.dueAt === undefined ? null : playback.requestedAt - scheduled.dueAt,
          dueTrackIds: alertUpdate.alertDecision.dueTracks.map((track) => track.id),
          episodeIds,
          incidentAttemptId: incidentAttempt.attemptId,
          visibilityState: document.visibilityState,
        },
      });

      let playbackPromise: Promise<void>;
      try {
        playbackPromise = playAlert(
          config.soundId,
          applyMasterVolume(config.volume, currentProfile.masterVolume),
        );
      } catch (error) {
        terminateInFlightBuffExpiryWarmTracePlayback(
          inFlightWarmTracePlaybackRef,
          scheduledKey,
          "failed",
        );
        throw error;
      }
      void playbackPromise
        .then(() => {
          completeInFlightBuffExpiryWarmTracePlayback(
            inFlightWarmTracePlaybackRef,
            scheduledKey,
            warmTracePlayback,
          );
          const startedAt = Date.now();
          buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentPlaybackResult({
            previous: buffExpiryIncidentRecorderRef.current,
            attemptId: incidentAttempt.attemptId,
            occurredAt: startedAt,
            status: "started",
          });
          alertIncidentJournal?.record({
            id: playbackId,
            feature: "buff-expiry",
            targetId: getBuffExpiryIncidentJournalTargetId(
              buffExpiryIncidentRecorderRef.current,
              episodeIds,
            ),
            kind: "playback",
            occurredAt: playback.requestedAt,
            frameId: null,
            cycleId: playback.cycleId,
            status: "started",
            decision: "initial",
            value: alertUpdate.alertDecision.dueTracks.length,
            configuration: playbackConfiguration,
            details: {
              scheduledForAt: scheduled?.dueAt ?? null,
              requestedAt: playback.requestedAt,
              startedAt,
              schedulerDelayMs:
                scheduled?.dueAt === undefined ? null : playback.requestedAt - scheduled.dueAt,
              dueTrackIds: alertUpdate.alertDecision.dueTracks.map((track) => track.id),
              episodeIds,
              incidentAttemptId: incidentAttempt.attemptId,
              visibilityState: document.visibilityState,
            },
          });
          const current = buffExpiryRuntimeRef.current;
          if (current.lastAlertPlayback?.requestedAt === playback?.requestedAt) {
            const next = {
              ...current,
              lastAlertPlayback: markAlertPlaybackStarted(playback, startedAt),
            };
            buffExpiryRuntimeRef.current = next;
            setBuffExpiryRuntime(next);
          }
          trackAlertPlayed("buff_expiry", "initial");
        })
        .catch((error) => {
          terminateInFlightBuffExpiryWarmTracePlayback(
            inFlightWarmTracePlaybackRef,
            scheduledKey,
            "failed",
            warmTracePlayback,
          );
          const nextError =
            error instanceof Error ? error.message : "버프 종료 알림 재생에 실패했습니다.";
          const failedAt = Date.now();
          buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentPlaybackResult({
            previous: buffExpiryIncidentRecorderRef.current,
            attemptId: incidentAttempt.attemptId,
            occurredAt: failedAt,
            status: "failed",
            error: nextError,
          });
          alertIncidentJournal?.record({
            id: playbackId,
            feature: "buff-expiry",
            targetId: getBuffExpiryIncidentJournalTargetId(
              buffExpiryIncidentRecorderRef.current,
              episodeIds,
            ),
            kind: "playback",
            occurredAt: playback.requestedAt,
            frameId: null,
            cycleId: playback.cycleId,
            status: "failed",
            decision: "initial",
            value: alertUpdate.alertDecision.dueTracks.length,
            configuration: playbackConfiguration,
            details: {
              scheduledForAt: scheduled?.dueAt ?? null,
              requestedAt: playback.requestedAt,
              failedAt,
              error: nextError,
              schedulerDelayMs:
                scheduled?.dueAt === undefined ? null : playback.requestedAt - scheduled.dueAt,
              dueTrackIds: alertUpdate.alertDecision.dueTracks.map((track) => track.id),
              episodeIds,
              incidentAttemptId: incidentAttempt.attemptId,
              visibilityState: document.visibilityState,
            },
          });
          const current = buffExpiryRuntimeRef.current;
          if (current.lastAlertPlayback?.requestedAt === playback?.requestedAt) {
            const next = {
              ...current,
              lastAlertPlayback: markAlertPlaybackFailed(playback, failedAt, nextError),
            };
            buffExpiryRuntimeRef.current = next;
            setBuffExpiryRuntime(next);
          }
          if (lastAlertErrorRef.current !== nextError) {
            lastAlertErrorRef.current = nextError;
            onMessage(nextError);
          }
        });
    },
    [
      buffExpiryRuntimeRef,
      buffExpirySnapshotRef,
      buffExpiryIncidentRecorderRef,
      lastAlertErrorRef,
      onMessage,
      profileRef,
      setBuffExpiryRuntime,
      setBuffExpirySnapshot,
      alertIncidentJournal,
      recordScheduleLifecycle,
    ],
  );

  const syncBuffExpiryAlertTimers = useCallback(
    (
      tracks: BuffExpiryTrackedBuff[],
      now: number,
      warmTraceCandidate: BuffExpiryWarmTraceScheduleCandidate | null = null,
    ) => {
      let warmTraceCandidateHandled = false;
      const config = profileRef.current.buffExpiryAlert ?? createDefaultBuffExpiryAlert();
      if (!config.enabled) {
        terminateBuffExpiryWarmTraceCandidate(
          warmTraceCandidate,
          "suppressed",
        );
        clearBuffExpiryAlertTimers();
        return;
      }

      const nextKeys = new Set<string>();
      const alertLeadSeconds = getBuffExpiryEffectiveAlertLeadSeconds(config);
      for (const cluster of getBuffExpiryPrecisionAlertClusters({
        tracks,
        alertLeadSeconds,
        now,
      })) {
        nextKeys.add(cluster.id);
        const episodeIds = getBuffExpiryIncidentEpisodeIdsForTracks(
          buffExpiryIncidentRecorderRef.current,
          cluster.tracks,
        );
        const registered = registerBuffExpiryIncidentCycle({
          previous: buffExpiryIncidentRecorderRef.current,
          episodeIds,
          dueAt: cluster.dueAt,
          occurredAt: now,
          configuration: createBuffExpiryIncidentConfiguration(
            config,
            profileRef.current.masterVolume,
          ),
        });
        buffExpiryIncidentRecorderRef.current = registered.recorder;
        const existing = scheduledAlertsRef.current.get(cluster.id) ?? null;
        const delayMs = Math.max(0, cluster.dueAt - now);
        const clusterWarmTraceCandidate =
          isCanonicalBuffExpiryWarmTraceCluster({
            candidate: warmTraceCandidate,
            cluster,
            delayMs,
            now,
          })
            ? warmTraceCandidate
            : null;
        if (clusterWarmTraceCandidate) {
          warmTraceCandidateHandled = true;
        }
        if (existing?.cycleId === registered.cycleId) {
          terminateBuffExpiryWarmTraceCandidate(
            clusterWarmTraceCandidate,
            "suppressed",
          );
          continue;
        }
        if (existing) {
          window.clearTimeout(existing.timerId);
          terminateBuffExpiryWarmTraceWaitSlot(
            existing.warmTraceWaitSlot,
            "replaced",
          );
          buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentCycleStatus({
            previous: buffExpiryIncidentRecorderRef.current,
            cycleId: existing.cycleId,
            occurredAt: now,
            status: "cancelled",
            reason: "cycle-replaced",
          });
        }

        const warmTraceWaitSlot: BuffExpiryWarmTraceWaitSlot = {
          current: null,
        };
        const warmTracePreparation = clusterWarmTraceCandidate
          ? prepareBuffExpiryWarmTraceWait(clusterWarmTraceCandidate, {
              trackId: clusterWarmTraceCandidate.trackId,
              sampledAtMs: now,
              dueAtMs: cluster.dueAt,
              delayMs,
            })
          : null;
        let timerId: number;
        try {
          timerId = window.setTimeout(() => {
            const warmTracePlayback = resumeBuffExpiryWarmTraceWait(
              warmTraceWaitSlot,
            );
            if (
              scheduledAlertsRef.current.get(cluster.id)?.timerId !== timerId
            ) {
              terminateBuffExpiryWarmTracePlayback(
                warmTracePlayback,
                "replaced",
              );
              return;
            }
            playScheduledBuffExpiryAlert(cluster.id, warmTracePlayback);
          }, delayMs);
        } catch (error) {
          abandonBuffExpiryWarmTracePreparation(warmTracePreparation);
          throw error;
        }
        warmTraceWaitSlot.current = commitBuffExpiryWarmTraceWait(
          warmTracePreparation,
        );
        scheduledAlertsRef.current.set(cluster.id, {
          dueAt: cluster.dueAt,
          timerId,
          cycleId: registered.cycleId,
          episodeIds,
          warmTraceWaitSlot,
        });
        recordScheduleLifecycle({
          scheduledKey: cluster.id,
          cycleId: registered.cycleId,
          episodeIds,
          dueAt: cluster.dueAt,
          decision: "schedule-registered",
          occurredAt: now,
          details: { delayMs },
        });
      }

      for (const [key, scheduled] of scheduledAlertsRef.current.entries()) {
        if (nextKeys.has(key)) {
          continue;
        }
        window.clearTimeout(scheduled.timerId);
        terminateBuffExpiryWarmTraceWaitSlot(
          scheduled.warmTraceWaitSlot,
          "suppressed",
        );
        scheduledAlertsRef.current.delete(key);
        buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentCycleStatus({
          previous: buffExpiryIncidentRecorderRef.current,
          cycleId: scheduled.cycleId,
          occurredAt: now,
          status: "cancelled",
          reason: "track-no-longer-due",
        });
        recordScheduleLifecycle({
          scheduledKey: key,
          cycleId: scheduled.cycleId,
          episodeIds: scheduled.episodeIds,
          dueAt: scheduled.dueAt,
          decision: "schedule-cancelled",
          occurredAt: now,
          details: { reason: "track-no-longer-due" },
        });
      }
      if (!warmTraceCandidateHandled) {
        terminateBuffExpiryWarmTraceCandidate(
          warmTraceCandidate,
          "suppressed",
        );
      }
    },
    [
      clearBuffExpiryAlertTimers,
      buffExpiryIncidentRecorderRef,
      playScheduledBuffExpiryAlert,
      profileRef,
      recordScheduleLifecycle,
    ],
  );

  useEffect(() => clearBuffExpiryAlertTimers, [clearBuffExpiryAlertTimers]);

  return {
    clearBuffExpiryAlertTimers,
    syncBuffExpiryAlertTimers,
  };
}

function getBuffExpiryIncidentJournalTargetId(
  recorder: BuffExpiryIncidentRuntimeRecorder,
  episodeIds: string[],
): string | null {
  const groups = [...new Set(
    recorder.archive.episodes
      .filter((episode) => episodeIds.includes(episode.id))
      .map((episode) => episode.group),
  )];
  return groups.length === 1 ? groups[0] ?? null : null;
}

function isCanonicalBuffExpiryWarmTraceCluster({
  candidate,
  cluster,
  delayMs,
  now,
}: {
  candidate: BuffExpiryWarmTraceScheduleCandidate | null;
  cluster: ReturnType<typeof getBuffExpiryPrecisionAlertClusters>[number];
  delayMs: number;
  now: number;
}): boolean {
  return Boolean(
    candidate?.active &&
      now === candidate.sampledAtMs &&
      cluster.dueAt === candidate.dueAtMs &&
      Number.isSafeInteger(delayMs) &&
      delayMs >=
        REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.minimumScheduled /
          1_000 &&
      delayMs <
        REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.maximumScheduledExclusive /
          1_000 &&
      cluster.tracks.length === 1 &&
      cluster.tracks[0]?.id === candidate.trackId,
  );
}

function completeInFlightBuffExpiryWarmTracePlayback(
  playbackRef: MutableRefObject<
    Map<string, BuffExpiryWarmTracePlaybackContext>
  >,
  scheduledKey: string,
  expected: BuffExpiryWarmTracePlaybackContext | null,
): void {
  const playback = playbackRef.current.get(scheduledKey) ?? null;
  if (playback === expected) {
    playbackRef.current.delete(scheduledKey);
  }
  completeBuffExpiryWarmTracePlayback(expected);
}

function terminateInFlightBuffExpiryWarmTracePlayback(
  playbackRef: MutableRefObject<
    Map<string, BuffExpiryWarmTracePlaybackContext>
  >,
  scheduledKey: string,
  outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  expected?: BuffExpiryWarmTracePlaybackContext | null,
): void {
  const playback = expected ?? playbackRef.current.get(scheduledKey) ?? null;
  if (playbackRef.current.get(scheduledKey) === playback) {
    playbackRef.current.delete(scheduledKey);
  }
  terminateBuffExpiryWarmTracePlayback(playback, outcome);
}
