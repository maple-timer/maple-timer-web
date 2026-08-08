import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { RuneRuntimeState, RuneSnapshot } from "../../../alertTypes";
import { playAlertUntilEnded } from "../../../lib/alert";
import {
  trackAlertPlayed,
  trackFeatureSessionActive,
} from "../../../lib/analyticsEvents";
import {
  getSkillRegionForLayout,
  hasUsableRegion,
} from "../../../lib/regions";
import {
  markRuneAlertPlaybackFailed,
  markRuneAlertPlaybackFinished,
  markRuneAlertPlaybackStarted,
  mergeRuneRuntimePlaybackProgress,
} from "../../../lib/runeAlert";
import { createRuneDetectionWorkerClient } from "../../../platform/runtime-workers/rune/runeDetectionWorkerClient";
import {
  clearRuntimeAssetFailure,
  reportRuntimeAssetFailure,
  runtimeAssetHealthController,
} from "../../../platform/runtime-assets/browserRuntimeAssetHealth";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile } from "../../../types";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import {
  createRuneFramePreviewState,
  processRuneFrameSample,
} from "./runeFrameProcessor";
import { useLazyRef } from "./useLazyRef";
import {
  createAlertIncidentFrameId,
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import { getRuneDetectionEpisodeId } from "../../../lib/runeEpisodeIdentity";

const RUNE_WORKER_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000] as const;

export function useRuneFrameLoop({
  stream,
  profileRef,
  runeRuntimeRef,
  runeSnapshotRef,
  lastAlertErrorRef,
  showDebugColumns,
  setRuneRuntime,
  setRuneSnapshot,
  onMessage,
  alertIncidentJournal,
}: {
  stream: MediaStream | null;
  profileRef: MutableRefObject<Profile>;
  runeRuntimeRef: MutableRefObject<RuneRuntimeState>;
  runeSnapshotRef: MutableRefObject<RuneSnapshot | null>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  showDebugColumns: boolean;
  setRuneRuntime: Dispatch<SetStateAction<RuneRuntimeState>>;
  setRuneSnapshot: Dispatch<SetStateAction<RuneSnapshot | null>>;
  onMessage: (message: string) => void;
  alertIncidentJournal?: AlertIncidentJournal;
}) {
  const runeDetectionWorkerClientRef = useRef<ReturnType<
    typeof createRuneDetectionWorkerClient
  > | null>(null);
  const runeDetectionWorkerReadyRef = useRef(false);
  const runeDetectionWorkerRetryCountRef = useRef(0);
  const runeDetectionWorkerNextRetryAtRef = useRef(0);
  const runePreviewStateRef = useLazyRef(createRuneFramePreviewState);

  const disposeRuneDetectionWorker = useCallback(() => {
    runeDetectionWorkerClientRef.current?.reset();
    runeDetectionWorkerClientRef.current = null;
    runeDetectionWorkerReadyRef.current = false;
  }, []);

  const resetRuneDetectionWorker = useCallback(() => {
    disposeRuneDetectionWorker();
    runeDetectionWorkerRetryCountRef.current = 0;
    runeDetectionWorkerNextRetryAtRef.current = 0;
    clearRuntimeAssetFailure("rune");
  }, [disposeRuneDetectionWorker]);

  useEffect(() => {
    if (!stream) {
      resetRuneDetectionWorker();
      runePreviewStateRef.current = createRuneFramePreviewState();
      runeSnapshotRef.current = null;
      setRuneSnapshot(null);
    }
  }, [resetRuneDetectionWorker, runeSnapshotRef, setRuneSnapshot, stream]);

  return useCallback(
    async ({
      context,
    }: {
      context: MonitoringFrameContext;
    }) => {
      const currentProfile = profileRef.current;
      if (currentProfile.runeAlert?.enabled) {
        trackFeatureSessionActive("rune", { mode: "minimap", enabledCount: 1 });
      }
      const runeConfig = currentProfile.runeAlert;
      const runeRegion = runeConfig
        ? getSkillRegionForLayout(runeConfig, context.frameLayoutKey)
        : null;
      const runeDetectionActive = Boolean(
        runeConfig?.enabled && hasUsableRegion(runeRegion),
      );
      if (!runeDetectionActive) {
        resetRuneDetectionWorker();
      } else if (
        !runeDetectionWorkerReadyRef.current &&
        runtimeAssetHealthController.getSnapshot().status === "update-required"
      ) {
        return;
      } else if (
        !runeDetectionWorkerReadyRef.current &&
        context.sampledAt < runeDetectionWorkerNextRetryAtRef.current
      ) {
        return;
      } else if (!runeDetectionWorkerClientRef.current) {
        runeDetectionWorkerClientRef.current = createRuneDetectionWorkerClient();
      }
      if (
        runeDetectionActive &&
        !runeDetectionWorkerReadyRef.current &&
        runeRuntimeRef.current.status !== "loading"
      ) {
        const loadingState = {
          ...runeRuntimeRef.current,
          status: "loading" as const,
          confidence: 0,
          candidateCount: 0,
        };
        runeRuntimeRef.current = loadingState;
        setRuneRuntime(loadingState);
      }
      const runtimeStateBefore = runeRuntimeRef.current;
      const result = await processRuneFrameSample({
        context,
        detector: runeDetectionWorkerClientRef.current ?? undefined,
        previewState: runePreviewStateRef.current,
        profile: currentProfile,
        previousState: runtimeStateBefore,
        previousSnapshot: runeSnapshotRef.current,
        showDebugColumns,
        detectorRetryCount: runeDetectionWorkerRetryCountRef.current,
      });
      if (profileRef.current !== currentProfile) {
        return;
      }
      if (result.detectorOutcome === "success") {
        runeDetectionWorkerReadyRef.current = true;
        runeDetectionWorkerRetryCountRef.current = 0;
        runeDetectionWorkerNextRetryAtRef.current = 0;
        clearRuntimeAssetFailure("rune");
      } else if (result.detectorOutcome === "error" && result.detectionError) {
        const retryCount = runeDetectionWorkerRetryCountRef.current;
        const retryDelay =
          RUNE_WORKER_RETRY_DELAYS_MS[
            Math.min(retryCount, RUNE_WORKER_RETRY_DELAYS_MS.length - 1)
          ];
        runeDetectionWorkerRetryCountRef.current = retryCount + 1;
        runeDetectionWorkerNextRetryAtRef.current = context.sampledAt + retryDelay;
        disposeRuneDetectionWorker();
        reportRuntimeAssetFailure({
          source: "worker",
          feature: "rune",
          code: result.detectionError.code,
          message: result.detectionError.message,
        });
      }

      if (result.shouldAlert) {
        const runeAlertPlaybackId = result.alertPlaybackId;
        const runeAlertDecision = result.alertDecision;
        const runeEpisodeId = getRuneDetectionEpisodeId(result.state);
        const effectiveVolume = applyMasterVolume(result.volume, context.masterVolume);
        const playbackRequestedAt =
          result.state.lastAlertPlayback?.requestedAt ?? context.sampledAt;
        const playbackEventId = `rune:playback:${runeAlertPlaybackId ?? playbackRequestedAt}`;
        const playbackConfiguration = getRuneIncidentConfiguration(
          runeConfig,
          context.masterVolume,
        );
        alertIncidentJournal?.record({
          id: playbackEventId,
          feature: "rune",
          targetId: null,
          kind: "playback",
          occurredAt: playbackRequestedAt,
          frameId: createAlertIncidentFrameId(context.sampledAt),
          cycleId: runeAlertPlaybackId,
          status: "requested",
          decision: runeAlertDecision,
          value: null,
          configuration: playbackConfiguration,
          details: {
            episodeId: runeEpisodeId,
            requestedAt: playbackRequestedAt,
            soundId: result.soundId,
            effectiveVolume,
            visibilityState: document.visibilityState,
          },
        });
        void playAlertUntilEnded(
          result.soundId,
          effectiveVolume,
          {
            onStarted: () => {
              if (runeAlertPlaybackId === null) {
                return;
              }
              const startedAt = Date.now();
              alertIncidentJournal?.record({
                id: playbackEventId,
                feature: "rune",
                targetId: null,
                kind: "playback",
                occurredAt: playbackRequestedAt,
                frameId: createAlertIncidentFrameId(context.sampledAt),
                cycleId: runeAlertPlaybackId,
                status: "started",
                decision: runeAlertDecision,
                value: null,
                configuration: playbackConfiguration,
                details: {
                  episodeId: runeEpisodeId,
                  requestedAt: playbackRequestedAt,
                  startedAt,
                  soundId: result.soundId,
                  effectiveVolume,
                  visibilityState: document.visibilityState,
                },
              });
              setRuneRuntime((current) => {
                const nextRuneState = markRuneAlertPlaybackStarted(
                  current,
                  runeAlertPlaybackId,
                  startedAt,
                );
                if (nextRuneState === current) {
                  return current;
                }

                runeRuntimeRef.current = nextRuneState;
                return nextRuneState;
              });
            },
          },
        )
          .then(() => {
            if (runeAlertPlaybackId === null) {
              return;
            }
            trackAlertPlayed("rune", runeAlertDecision ?? "initial");
            const finishedAt = Date.now();
            alertIncidentJournal?.record({
              id: playbackEventId,
              feature: "rune",
              targetId: null,
              kind: "playback",
              occurredAt: playbackRequestedAt,
              frameId: createAlertIncidentFrameId(context.sampledAt),
              cycleId: runeAlertPlaybackId,
              status: "finished",
              decision: runeAlertDecision,
              value: null,
              configuration: playbackConfiguration,
              details: {
                episodeId: runeEpisodeId,
                requestedAt: playbackRequestedAt,
                finishedAt,
                soundId: result.soundId,
                effectiveVolume,
                visibilityState: document.visibilityState,
              },
            });
            setRuneRuntime((current) => {
              const nextRuneState = markRuneAlertPlaybackFinished(
                current,
                runeAlertPlaybackId,
                finishedAt,
              );
              if (nextRuneState === current) {
                return current;
              }

              runeRuntimeRef.current = nextRuneState;
              return nextRuneState;
            });
          })
          .catch((error) => {
            const nextError =
              error instanceof Error ? error.message : "룬 알람 재생에 실패했습니다.";
            const failedAt = Date.now();
            alertIncidentJournal?.record({
              id: playbackEventId,
              feature: "rune",
              targetId: null,
              kind: "playback",
              occurredAt: playbackRequestedAt,
              frameId: createAlertIncidentFrameId(context.sampledAt),
              cycleId: runeAlertPlaybackId,
              status: "failed",
              decision: runeAlertDecision,
              value: null,
              configuration: playbackConfiguration,
              details: {
                episodeId: runeEpisodeId,
                requestedAt: playbackRequestedAt,
                failedAt,
                error: nextError,
                soundId: result.soundId,
                effectiveVolume,
                visibilityState: document.visibilityState,
              },
            });
            if (runeAlertPlaybackId !== null) {
              setRuneRuntime((current) => {
                const nextRuneState = markRuneAlertPlaybackFailed(
                  current,
                  runeAlertPlaybackId,
                  failedAt,
                  nextError,
                );
                if (nextRuneState === current) {
                  return current;
                }

                runeRuntimeRef.current = nextRuneState;
                return nextRuneState;
              });
            }
            if (lastAlertErrorRef.current !== nextError) {
              lastAlertErrorRef.current = nextError;
              onMessage(nextError);
            }
          });
      }

      if (result.errorMessage) {
        onMessage(result.errorMessage);
      }

      runePreviewStateRef.current = result.previewState;
      const nextRuneRuntime = mergeRuneRuntimePlaybackProgress(
        result.state,
        runeRuntimeRef.current,
      );
      runeRuntimeRef.current = nextRuneRuntime;
      setRuneRuntime(nextRuneRuntime);
      alertIncidentJournal?.record({
        id: `rune:sample:${context.sampledAt}`,
        feature: "rune",
        targetId: null,
        kind: result.alertDecision ? "decision" : "sample",
        occurredAt: context.sampledAt,
        frameId: createAlertIncidentFrameId(context.sampledAt),
        cycleId: result.alertPlaybackId,
        status: nextRuneRuntime.status,
        decision: result.alertDecision ?? nextRuneRuntime.lastDecisionReason ?? null,
        value: result.snapshot?.detected ?? false,
        configuration: getRuneIncidentConfiguration(runeConfig, context.masterVolume),
        details: {
          episodeId: getRuneDetectionEpisodeId(nextRuneRuntime),
          confidence: nextRuneRuntime.confidence,
          stableCount: nextRuneRuntime.stableCount,
          candidateCount: nextRuneRuntime.candidateCount,
          sceneEpoch: nextRuneRuntime.sceneEpoch,
          detectorVersion: nextRuneRuntime.detectorVersion,
          stateBefore: getRuneIncidentState(runtimeStateBefore),
          stateAfter: getRuneIncidentState(nextRuneRuntime),
        },
      });
      runeSnapshotRef.current = result.snapshot;
      setRuneSnapshot(result.snapshot);
    },
    [
      lastAlertErrorRef,
      onMessage,
      profileRef,
      disposeRuneDetectionWorker,
      resetRuneDetectionWorker,
      runeRuntimeRef,
      runeSnapshotRef,
      setRuneRuntime,
      setRuneSnapshot,
      showDebugColumns,
      alertIncidentJournal,
    ],
  );
}

function getRuneIncidentConfiguration(
  config: Profile["runeAlert"],
  masterVolume: number,
) {
  return config
    ? {
        enabled: config.enabled,
        repeatAlertEnabled: config.repeatAlertEnabled ?? false,
        repeatAlertIntervalSeconds: config.repeatAlertIntervalSeconds ?? null,
        repeatAlertMaxCount: config.repeatAlertMaxCount ?? null,
        soundId: config.soundId,
        volume: config.volume,
        masterVolume,
        effectiveVolume: applyMasterVolume(config.volume, masterVolume),
      }
    : { enabled: false, masterVolume };
}

function getRuneIncidentState(state: RuneRuntimeState) {
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
