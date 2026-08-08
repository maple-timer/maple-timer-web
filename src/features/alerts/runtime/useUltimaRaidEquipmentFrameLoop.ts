import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { playAlertUntilEnded } from "../../../lib/alert";
import {
  trackAlertPlayed,
  trackFeatureSessionActive,
} from "../../../lib/analyticsEvents";
import { applyMasterVolume } from "../../../lib/volume";
import {
  DEFAULT_REPEAT_ALERT_MAX_COUNT,
  getRepeatAlertIntervalSeconds,
  getRepeatAlertMaxCount,
  isRepeatAlertEnabled,
} from "../../../lib/repeatAlerts";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { AlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import {
  createUltimaRaidEquipmentIncidentArchive,
  getUltimaRaidEquipmentIncidentMediaReason,
  recordUltimaRaidEquipmentIncidentFrame,
  recordUltimaRaidEquipmentPlaybackRequested,
  recordUltimaRaidEquipmentPlaybackTransition,
  type UltimaRaidEquipmentIncidentArchive,
} from "../../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import { encodeUltimaRaidEquipmentEvidenceFrame } from "../../../platform/frame-capture/ultima-raid-equipment/ultimaRaidEquipmentEvidenceCapture";
import {
  createUltimaRaidEquipmentRuntimeState,
  markUltimaRaidEquipmentPlaybackFinished,
  releaseUltimaRaidEquipmentAlertAfterPlaybackFailure,
  type UltimaRaidEquipmentRuntimeState,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import {
  markUltimaRaidBossPlaybackFinished,
  releaseUltimaRaidBossAlertAfterPlaybackFailure,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidBossAlertState";
import type { Profile } from "../../../types";
import {
  processUltimaRaidEquipmentFrame,
} from "./ultimaRaidEquipmentFrameProcessor";
import type { UltimaRaidEquipmentSnapshot } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";

type UltimaRaidAlertTarget = "equipment" | "boss";
type UltimaRaidPlaybackKind = "initial" | "repeat";
type UltimaRaidPlaybackOutcome = "finished" | "failed" | "cancelled";

type UltimaRaidRepeatCycleSlot = {
  generation: number;
  cycleId: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  repeatsCancelled: boolean;
};

function createRepeatCycleSlot(): UltimaRaidRepeatCycleSlot {
  return {
    generation: 0,
    cycleId: null,
    timer: null,
    repeatsCancelled: true,
  };
}

export function useUltimaRaidEquipmentFrameLoop({
  stream,
  profileRef,
  runtimeRef,
  snapshotRef,
  incidentArchiveRef,
  lastAlertErrorRef,
  setRuntime,
  setSnapshot,
  onMessage,
  alertIncidentJournal,
}: {
  stream: MediaStream | null;
  profileRef: MutableRefObject<Profile>;
  runtimeRef: MutableRefObject<UltimaRaidEquipmentRuntimeState>;
  snapshotRef: MutableRefObject<UltimaRaidEquipmentSnapshot | null>;
  incidentArchiveRef: MutableRefObject<UltimaRaidEquipmentIncidentArchive>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  setRuntime: Dispatch<SetStateAction<UltimaRaidEquipmentRuntimeState>>;
  setSnapshot: Dispatch<SetStateAction<UltimaRaidEquipmentSnapshot | null>>;
  onMessage: (message: string) => void;
  alertIncidentJournal?: AlertIncidentJournal;
}) {
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve());
  const repeatCyclesRef = useRef<Record<UltimaRaidAlertTarget, UltimaRaidRepeatCycleSlot>>({
    equipment: createRepeatCycleSlot(),
    boss: createRepeatCycleSlot(),
  });
  const cancelRepeatCycle = useCallback((target: UltimaRaidAlertTarget) => {
    const slot = repeatCyclesRef.current[target];
    if (slot.timer !== null) {
      clearTimeout(slot.timer);
    }
    repeatCyclesRef.current[target] = {
      generation: slot.generation + 1,
      cycleId: null,
      timer: null,
      repeatsCancelled: true,
    };
  }, []);
  const cancelPendingRepeats = useCallback((target: UltimaRaidAlertTarget) => {
    const slot = repeatCyclesRef.current[target];
    if (slot.timer !== null) {
      clearTimeout(slot.timer);
    }
    slot.timer = null;
    slot.repeatsCancelled = true;
  }, []);
  const cancelAllRepeatCycles = useCallback(() => {
    cancelRepeatCycle("equipment");
    cancelRepeatCycle("boss");
  }, [cancelRepeatCycle]);

  useEffect(() => {
    if (!stream) {
      const nextState = createUltimaRaidEquipmentRuntimeState("no-stream");
      runtimeRef.current = nextState;
      setRuntime(nextState);
      snapshotRef.current = null;
      setSnapshot(null);
      incidentArchiveRef.current = createUltimaRaidEquipmentIncidentArchive();
    }

    return cancelAllRepeatCycles;
  }, [
    cancelAllRepeatCycles,
    incidentArchiveRef,
    runtimeRef,
    setRuntime,
    setSnapshot,
    snapshotRef,
    stream,
  ]);

  return useCallback(
    ({ context }: { context: MonitoringFrameContext }) => {
      const currentProfile = profileRef.current;
      const stateBefore = runtimeRef.current;
      const currentConfig = currentProfile.ultimaRaidEquipmentAlert;
      if (!currentConfig?.enabled) {
        cancelRepeatCycle("equipment");
      } else if (
        repeatCyclesRef.current.equipment.cycleId !== null &&
        !isRepeatAlertEnabled(currentConfig)
      ) {
        cancelPendingRepeats("equipment");
      }
      if (!currentConfig?.bossAlert.enabled) {
        cancelRepeatCycle("boss");
      } else if (
        repeatCyclesRef.current.boss.cycleId !== null &&
        !isRepeatAlertEnabled(currentConfig.bossAlert)
      ) {
        cancelPendingRepeats("boss");
      }
      if (currentProfile.ultimaRaidEquipmentAlert?.enabled) {
        trackFeatureSessionActive("ultima_raid_equipment", {
          mode: "inventory_full",
          enabledCount: 1,
        });
      }
      if (currentProfile.ultimaRaidEquipmentAlert?.bossAlert.enabled) {
        trackFeatureSessionActive("ultima_raid_boss", {
          mode: "boss_progress",
          enabledCount: 1,
        });
      }

      const result = processUltimaRaidEquipmentFrame({
        context,
        profile: currentProfile,
        previousState: stateBefore,
        previousSnapshot: snapshotRef.current,
      });
      if (profileRef.current !== currentProfile) {
        return;
      }

      runtimeRef.current = result.state;
      setRuntime(result.state);
      snapshotRef.current = result.snapshot;
      setSnapshot(result.snapshot);

      let incidentFrameId: string | null = null;
      if (result.snapshot && result.evidenceImageData) {
        const mediaReason = getUltimaRaidEquipmentIncidentMediaReason({
          archive: incidentArchiveRef.current,
          sampledAt: result.snapshot.sampledAt,
          stateBefore,
          stateAfter: result.state,
          detected: result.snapshot.detected,
          shouldAlert: result.shouldAlert,
          bossDetected: result.snapshot.bossBarDetected,
          bossShouldAlert: result.bossShouldAlert,
        });
        const mediaDataUrl = mediaReason
          ? encodeUltimaRaidEquipmentEvidenceFrame(result.evidenceImageData)
          : null;
        incidentArchiveRef.current =
          recordUltimaRaidEquipmentIncidentFrame({
            previous: incidentArchiveRef.current,
            sampledAt: result.snapshot.sampledAt,
            detectorVersion: result.snapshot.detectorVersion,
            layoutKey: result.snapshot.layoutKey,
            sourceDimensions: result.snapshot.sourceDimensions,
            sampledRegion: result.snapshot.sampledRegion,
            detection: {
              layoutValid: result.snapshot.layoutValid,
              detected: result.snapshot.detected,
              confidence: result.snapshot.confidence,
              source: result.snapshot.detectionSource,
              bagCountState: result.snapshot.bagCountState,
              bagCountReadable: result.snapshot.bagCountReadable,
              bagCountOccluded: result.snapshot.bagCountOccluded,
              bagFullDetected: result.snapshot.bagFullDetected,
              bagWarmPixelCount: result.snapshot.bagWarmPixelCount,
              bagForegroundPixelCount:
                result.snapshot.bagForegroundPixelCount,
              bagReadablePixelCount:
                result.snapshot.bagReadablePixelCount,
              bagWarmPixelRatio: result.snapshot.bagWarmPixelRatio,
              largestBagWarmClusterSize:
                result.snapshot.largestBagWarmClusterSize,
              largestBagWarmClusterWidth:
                result.snapshot.largestBagWarmClusterWidth,
              largestBagWarmClusterHeight:
                result.snapshot.largestBagWarmClusterHeight,
              largestBagWarmClusterXRatio:
                result.snapshot.largestBagWarmClusterXRatio,
              largestBagWarmClusterYRatio:
                result.snapshot.largestBagWarmClusterYRatio,
              bagWarmComponentValid:
                result.snapshot.bagWarmComponentValid,
              bagWarmComponentTouchesBoundary:
                result.snapshot.bagWarmComponentTouchesBoundary,
              bagCountRowTopRatio:
                result.snapshot.bagCountRowTopRatio,
              bagCountRowHeightRatio:
                result.snapshot.bagCountRowHeightRatio,
              fullBannerDetected: result.snapshot.fullBannerDetected,
              largestBannerClusterSize:
                result.snapshot.largestBannerClusterSize,
              bannerWidthRatio: result.snapshot.bannerWidthRatio,
              bannerHeightRatio: result.snapshot.bannerHeightRatio,
              bannerFillRatio: result.snapshot.bannerFillRatio,
            },
            bossDetection: {
              detectorVersion: result.snapshot.bossDetectorVersion,
              progressState: result.snapshot.bossProgressState,
              bossBarDetected: result.snapshot.bossBarDetected,
              normalBarDetected:
                result.snapshot.normalProgressBarDetected,
              bossBarPixelCount: result.snapshot.bossBarPixelCount,
              bossBarWidthRatio: result.snapshot.bossBarWidthRatio,
              bossBarHeightRatio: result.snapshot.bossBarHeightRatio,
              bossBarFillRatio: result.snapshot.bossBarFillRatio,
              normalBarPixelCount:
                result.snapshot.normalProgressBarPixelCount,
              normalBarWidthRatio:
                result.snapshot.normalProgressBarWidthRatio,
            },
            shouldAlert: result.shouldAlert,
            bossShouldAlert: result.bossShouldAlert,
            stateBefore,
            stateAfter: result.state,
            mediaDataUrl,
            mediaReason,
          });
        incidentFrameId =
          incidentArchiveRef.current.frames[
            incidentArchiveRef.current.frames.length - 1
          ]?.id ?? null;
        alertIncidentJournal?.record({
          id: `ultima-raid-equipment-${result.shouldAlert ? "decision" : "sample"}:${result.snapshot.sampledAt}`,
          feature: "ultima-raid-equipment",
          targetId: "equipment",
          kind: result.shouldAlert ? "decision" : "sample",
          occurredAt: result.snapshot.sampledAt,
          frameId: incidentFrameId,
          cycleId: result.state.lastAlertedAt,
          status: result.state.status,
          decision: result.shouldAlert ? "alert-requested" : "no-alert",
          value: result.snapshot.detected,
          configuration: {
            enabled: currentProfile.ultimaRaidEquipmentAlert?.enabled === true,
            soundId: result.soundId,
            featureVolume: result.volume,
            masterVolume: context.masterVolume,
            repeatAlertEnabled:
              currentProfile.ultimaRaidEquipmentAlert?.repeatAlertEnabled ===
              true,
            repeatAlertIntervalSeconds:
              currentProfile.ultimaRaidEquipmentAlert
                ?.repeatAlertIntervalSeconds ?? null,
            repeatAlertMaxCount:
              currentProfile.ultimaRaidEquipmentAlert?.repeatAlertMaxCount ??
              null,
          },
          details: {
            detectorVersion: result.snapshot.detectorVersion,
            detectionSource: result.snapshot.detectionSource,
            bagCountState: result.snapshot.bagCountState,
            bagCountOccluded: result.snapshot.bagCountOccluded,
            bagFullDetected: result.snapshot.bagFullDetected,
            fullBannerDetected: result.snapshot.fullBannerDetected,
            stateBefore,
            stateAfter: result.state,
          },
        });
        alertIncidentJournal?.record({
          id: `ultima-raid-boss-${result.bossShouldAlert ? "decision" : "sample"}:${result.snapshot.sampledAt}`,
          feature: "ultima-raid-equipment",
          targetId: "boss",
          kind: result.bossShouldAlert ? "decision" : "sample",
          occurredAt: result.snapshot.sampledAt,
          frameId: incidentFrameId,
          cycleId: result.state.boss.lastAlertedAt,
          status: result.state.boss.status,
          decision: result.bossShouldAlert
            ? "alert-requested"
            : "no-alert",
          value: result.snapshot.bossProgressState,
          configuration: {
            enabled:
              currentProfile.ultimaRaidEquipmentAlert?.bossAlert.enabled ===
              true,
            soundId: result.bossSoundId,
            featureVolume: result.bossVolume,
            masterVolume: context.masterVolume,
            repeatAlertEnabled:
              currentProfile.ultimaRaidEquipmentAlert?.bossAlert
                .repeatAlertEnabled === true,
            repeatAlertIntervalSeconds:
              currentProfile.ultimaRaidEquipmentAlert?.bossAlert
                .repeatAlertIntervalSeconds ?? null,
            repeatAlertMaxCount:
              currentProfile.ultimaRaidEquipmentAlert?.bossAlert
                .repeatAlertMaxCount ?? null,
          },
          details: {
            detectorVersion: result.snapshot.bossDetectorVersion,
            progressState: result.snapshot.bossProgressState,
            bossBarDetected: result.snapshot.bossBarDetected,
            normalProgressBarDetected:
              result.snapshot.normalProgressBarDetected,
            stateBefore: stateBefore.boss,
            stateAfter: result.state.boss,
          },
        });
      }

      const enqueueAlertPlayback = ({
        target,
        cycleId,
        soundId,
        volume,
        masterVolume,
        kind,
        repeatIndex,
        repeatMaxCount,
        repeatIntervalSeconds,
        isCurrent,
      }: {
        target: UltimaRaidAlertTarget;
        cycleId: number;
        soundId: string;
        volume: number;
        masterVolume: number;
        kind: UltimaRaidPlaybackKind;
        repeatIndex: number | null;
        repeatMaxCount: number | null;
        repeatIntervalSeconds: number | null;
        isCurrent: () => boolean;
      }): Promise<UltimaRaidPlaybackOutcome> => {
        const effectiveVolume = applyMasterVolume(
          volume,
          masterVolume,
        );
        const playbackTask = playbackQueueRef.current
          .catch(() => undefined)
          .then(async (): Promise<UltimaRaidPlaybackOutcome> => {
            if (!isCurrent()) {
              return "cancelled";
            }
            const requestedAt = Date.now();
            const playback = recordUltimaRaidEquipmentPlaybackRequested({
              previous: incidentArchiveRef.current,
              frameId: incidentFrameId,
              requestedAt,
              soundId,
              featureVolume: volume,
              masterVolume,
              effectiveVolume,
              target,
              kind,
              cycleId,
              repeatIndex,
              repeatMaxCount,
              repeatIntervalSeconds,
            });
            incidentArchiveRef.current = playback.archive;
            const recordPlaybackJournal = (
              status: "requested" | "started" | "finished" | "failed",
              occurredAt: number,
              error: string | null = null,
            ) => {
              alertIncidentJournal?.record({
                id: `${playback.playbackId}:${status}`,
                feature: "ultima-raid-equipment",
                targetId: target,
                kind: "playback",
                occurredAt,
                frameId: incidentFrameId,
                cycleId,
                status,
                decision: "alert-playback",
                value: effectiveVolume,
                configuration: {
                  soundId,
                  featureVolume: volume,
                  masterVolume,
                  effectiveVolume,
                  repeatAlertEnabled: repeatMaxCount !== null,
                  repeatAlertIntervalSeconds: repeatIntervalSeconds,
                  repeatAlertMaxCount: repeatMaxCount,
                },
                details: {
                  target,
                  kind,
                  repeatIndex,
                  requestedAt,
                  error,
                },
              });
            };
            recordPlaybackJournal("requested", requestedAt);
            try {
              await playAlertUntilEnded(soundId, effectiveVolume, {
                onStarted: () => {
                  const startedAt = Date.now();
                  incidentArchiveRef.current =
                    recordUltimaRaidEquipmentPlaybackTransition({
                      previous: incidentArchiveRef.current,
                      playbackId: playback.playbackId,
                      status: "started",
                      occurredAt: startedAt,
                    });
                  recordPlaybackJournal("started", startedAt);
                },
              });
              const finishedAt = Date.now();
              incidentArchiveRef.current =
                recordUltimaRaidEquipmentPlaybackTransition({
                  previous: incidentArchiveRef.current,
                  playbackId: playback.playbackId,
                  status: "finished",
                  occurredAt: finishedAt,
                });
              recordPlaybackJournal("finished", finishedAt);
              setRuntime((current) => {
                const next =
                  target === "boss"
                    ? {
                        ...current,
                        boss: markUltimaRaidBossPlaybackFinished(
                          current.boss,
                          finishedAt,
                        ),
                      }
                    : markUltimaRaidEquipmentPlaybackFinished(
                        current,
                        finishedAt,
                      );
                runtimeRef.current = next;
                return next;
              });
              trackAlertPlayed(
                target === "boss"
                  ? "ultima_raid_boss"
                  : "ultima_raid_equipment",
                kind,
                {
                  detectionMode:
                    target === "boss"
                      ? "boss_progress"
                      : "inventory_full",
                },
              );
              return "finished";
            } catch (error) {
              const nextError =
                error instanceof Error
                  ? error.message
                  : target === "boss"
                    ? "울티마 스쿼드 보스 등장 알림 재생에 실패했습니다."
                    : "울티마 스쿼드 장비 알림 재생에 실패했습니다.";
              const failedAt = Date.now();
              incidentArchiveRef.current =
                recordUltimaRaidEquipmentPlaybackTransition({
                  previous: incidentArchiveRef.current,
                  playbackId: playback.playbackId,
                  status: "failed",
                  occurredAt: failedAt,
                  error: nextError,
                });
              recordPlaybackJournal("failed", failedAt, nextError);
              setRuntime((current) => {
                const next =
                  kind === "initial"
                    ? target === "boss"
                      ? {
                          ...current,
                          boss: releaseUltimaRaidBossAlertAfterPlaybackFailure(
                            current.boss,
                            cycleId,
                            nextError,
                          ),
                        }
                      : releaseUltimaRaidEquipmentAlertAfterPlaybackFailure(
                          current,
                          cycleId,
                          nextError,
                        )
                    : target === "boss"
                      ? {
                          ...current,
                          boss: {
                            ...current.boss,
                            lastError: nextError,
                          },
                        }
                      : {
                          ...current,
                          lastError: nextError,
                        };
                runtimeRef.current = next;
                return next;
              });
              if (lastAlertErrorRef.current !== nextError) {
                lastAlertErrorRef.current = nextError;
                onMessage(nextError);
              }
              return "failed";
            }
          });
        playbackQueueRef.current = playbackTask.then(() => undefined);
        return playbackTask;
      };

      const startAlertPlaybackCycle = ({
        target,
        cycleId,
        soundId,
        volume,
      }: {
        target: UltimaRaidAlertTarget;
        cycleId: number;
        soundId: string;
        volume: number;
      }) => {
        const slot = repeatCyclesRef.current[target];
        if (slot.timer !== null) {
          clearTimeout(slot.timer);
        }
        const generation = slot.generation + 1;
        const targetConfig =
          target === "boss"
            ? currentProfile.ultimaRaidEquipmentAlert?.bossAlert
            : currentProfile.ultimaRaidEquipmentAlert;
        const repeatEnabled =
          Boolean(targetConfig) && isRepeatAlertEnabled(targetConfig!);
        const repeatIntervalSeconds = repeatEnabled
          ? getRepeatAlertIntervalSeconds(targetConfig!)
          : null;
        const repeatMaxCount = repeatEnabled
          ? getRepeatAlertMaxCount(targetConfig!) ??
            DEFAULT_REPEAT_ALERT_MAX_COUNT
          : null;
        repeatCyclesRef.current[target] = {
          generation,
          cycleId,
          timer: null,
          repeatsCancelled: !repeatEnabled,
        };
        const isCurrentCycle = () => {
          const current = repeatCyclesRef.current[target];
          const liveConfig =
            target === "boss"
              ? profileRef.current.ultimaRaidEquipmentAlert?.bossAlert
              : profileRef.current.ultimaRaidEquipmentAlert;
          return (
            current.generation === generation &&
            current.cycleId === cycleId &&
            liveConfig?.enabled === true
          );
        };
        const isCurrentRepeatCycle = () =>
          isCurrentCycle() &&
          !repeatCyclesRef.current[target].repeatsCancelled &&
          isRepeatAlertEnabled(
            target === "boss"
              ? profileRef.current.ultimaRaidEquipmentAlert?.bossAlert ?? {}
              : profileRef.current.ultimaRaidEquipmentAlert ?? {},
          );
        const scheduleRepeat = (repeatIndex: number) => {
          if (
            repeatIntervalSeconds === null ||
            repeatMaxCount === null ||
            repeatIndex > repeatMaxCount ||
            !isCurrentRepeatCycle()
          ) {
            return;
          }
          const current = repeatCyclesRef.current[target];
          current.timer = setTimeout(() => {
            current.timer = null;
            if (!isCurrentRepeatCycle()) {
              return;
            }
            const liveProfile = profileRef.current;
            const liveConfig =
              target === "boss"
                ? liveProfile.ultimaRaidEquipmentAlert?.bossAlert
                : liveProfile.ultimaRaidEquipmentAlert;
            if (!liveConfig?.enabled) {
              cancelRepeatCycle(target);
              return;
            }
            void enqueueAlertPlayback({
              target,
              cycleId,
              soundId: liveConfig.soundId,
              volume: liveConfig.volume,
              masterVolume: liveProfile.masterVolume,
              kind: "repeat",
              repeatIndex,
              repeatMaxCount,
              repeatIntervalSeconds,
              isCurrent: isCurrentRepeatCycle,
            }).then((outcome) => {
              if (outcome === "finished" && isCurrentRepeatCycle()) {
                scheduleRepeat(repeatIndex + 1);
              } else if (outcome === "failed") {
                cancelPendingRepeats(target);
              }
            });
          }, repeatIntervalSeconds * 1_000);
        };

        void enqueueAlertPlayback({
          target,
          cycleId,
          soundId,
          volume,
          masterVolume: context.masterVolume,
          kind: "initial",
          repeatIndex: null,
          repeatMaxCount,
          repeatIntervalSeconds,
          isCurrent: isCurrentCycle,
        }).then((outcome) => {
          if (outcome === "finished") {
            scheduleRepeat(1);
          } else if (outcome === "failed") {
            cancelPendingRepeats(target);
          }
        });
      };

      if (
        result.bossShouldAlert &&
        result.state.boss.lastAlertedAt !== null
      ) {
        startAlertPlaybackCycle({
          target: "boss",
          cycleId: result.state.boss.lastAlertedAt,
          soundId: result.bossSoundId,
          volume: result.bossVolume,
        });
      }
      if (result.shouldAlert && result.state.lastAlertedAt !== null) {
        startAlertPlaybackCycle({
          target: "equipment",
          cycleId: result.state.lastAlertedAt,
          soundId: result.soundId,
          volume: result.volume,
        });
      }

      if (
        result.errorMessage &&
        lastAlertErrorRef.current !== result.errorMessage
      ) {
        lastAlertErrorRef.current = result.errorMessage;
        onMessage(result.errorMessage);
      }
    },
    [
      lastAlertErrorRef,
      alertIncidentJournal,
      cancelPendingRepeats,
      cancelRepeatCycle,
      incidentArchiveRef,
      onMessage,
      profileRef,
      playbackQueueRef,
      runtimeRef,
      setRuntime,
      setSnapshot,
      snapshotRef,
    ],
  );
}
