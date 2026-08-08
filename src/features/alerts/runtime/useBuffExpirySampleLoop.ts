import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  BuffExpiryDebugDetectionFrame,
  BuffExpiryIconEvidence,
  BuffExpiryRuntimeState,
  BuffExpiryRuntimeTraceFrame,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryAlertDecision } from "../../../domain/buff-expiry/precisionAlertTypes";
import type {
  BuffExpiryExpiryCluster,
  BuffExpiryPendingTrack,
  BuffExpiryTemporalCandidateTrack,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type { BuffExpiryDisplayBoxTrack } from "../../../lib/buffExpiry/buffExpiryDisplayBoxes";
import { pruneBuffExpiryIconEvidence } from "./buffExpiryPrecisionRuntimeDiagnostics";
import { createBuffSlotEvidenceSource } from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import { getBuffExpiryPrecisionSelectedTargetGroups } from "../../../domain/buff-expiry/precisionTrackingPolicy";
import {
  createBuffExpiryPrecisionEngine,
  type BuffExpiryPrecisionPreloadStatus,
} from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import {
  trackBuffExpiryMonitoringStarted,
  trackFeatureSessionActive,
} from "../../../lib/analyticsEvents";
import type { Profile } from "../../../types";
import { processBuffExpiryPrecisionSample } from "./buffExpiryPrecisionSampleProcessor";
import {
  createBuffExpiryPrecisionSampleProcessorContext,
  createBuffExpirySampleProcessorCommonContext,
  resetBuffExpirySampleLoopState,
  type BuffExpirySampleLoopRefs,
} from "./buffExpirySampleLoopRuntime";
import { getBuffExpirySampleLoopControl } from "./buffExpirySampleLoopControl";
import { useInactiveSamplePublishGate } from "./useInactiveSamplePublishGate";
import { useBuffExpiryAlertScheduler } from "./useBuffExpiryAlertScheduler";
import { useBuffExpiryPrecisionEnginePreload } from "./useBuffExpiryPrecisionEnginePreload";
import { useLazyRef } from "./useLazyRef";
import {
  getSharedBuffSlotAnalysisFailureEvidence,
  getSharedBuffSlotAnalysisFailureFrame,
  isSharedBuffSlotAnalysisDroppedError,
  type GetSharedBuffSlotAnalysis,
  type SharedBuffSlotAnalysisResult,
  type SharedBuffSlotFrameSample,
} from "./useSharedBuffSlotAnalysis";
import { createRuntimeAnalysisFailureEvidence } from "./runtimeAnalysisFailure";
import type {
  RuntimeParserFailureEvidence,
  RuntimeReportEvidenceCoordinator,
} from "../../../contracts/reporting/runtimeReportEvidence";
import type { BuffExpiryRuntimeReportPayload } from "../../../contracts/reporting/runtimeReportEvidencePayloads";
import type { MonitoringFrameRequest } from "../../../runtime/monitoring/monitoringFrameBinding";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import {
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import {
  recordBuffExpiryIncidentSample,
  resetBuffExpiryIncidentRuntimeRecorder,
  type BuffExpiryIncidentRuntimeRecorder,
} from "../../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import { createBuffExpiryIncidentConfiguration } from "../../../application/reporting/buffExpiryIncidentConfiguration";
import type {
  RemoteRecognitionWarmTraceBuffSchedulerPort,
  RemoteRecognitionWarmTraceBuffTemporalPort,
  RemoteRecognitionWarmTraceFeaturePort,
  RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  authorizeBuffExpiryWarmTraceWait,
  claimBuffExpiryWarmTrace,
  completeBuffExpiryWarmTraceMatcher,
  terminateBuffExpiryWarmTraceCandidate,
  terminateBuffExpiryWarmTraceClaim,
  type BuffExpiryWarmTraceClaim,
  type BuffExpiryWarmTraceScheduleCandidate,
} from "./buffExpiryWarmTrace";

export function useBuffExpirySampleLoop({
  stream,
  gameViewportRevision,
  profileRef,
  buffExpiryRuntimeRef,
  buffExpirySnapshotRef,
  buffExpiryIncidentRecorderRef,
  lastAlertErrorRef,
  showDebugColumns,
  setBuffExpiryRuntime,
  setBuffExpirySnapshot,
  setBuffExpiryPrecisionPreloadStatus,
  getSharedBuffSlotAnalysis,
  precisionParserRuntimeKey,
  remoteRecognitionWarmTracePort,
  remoteRecognitionWarmTraceBuffTemporalPort,
  remoteRecognitionWarmTraceBuffSchedulerPort,
  runtimeReportEvidenceCoordinator,
  alertIncidentJournal,
  onMessage,
}: {
  stream: MediaStream | null;
  gameViewportRevision: number;
  profileRef: MutableRefObject<Profile>;
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  buffExpiryIncidentRecorderRef: MutableRefObject<BuffExpiryIncidentRuntimeRecorder>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  showDebugColumns: boolean;
  setBuffExpiryRuntime: Dispatch<SetStateAction<BuffExpiryRuntimeState>>;
  setBuffExpirySnapshot: Dispatch<SetStateAction<BuffExpirySnapshot | null>>;
  setBuffExpiryPrecisionPreloadStatus: Dispatch<SetStateAction<BuffExpiryPrecisionPreloadStatus>>;
  getSharedBuffSlotAnalysis?: GetSharedBuffSlotAnalysis;
  precisionParserRuntimeKey?: string;
  remoteRecognitionWarmTracePort?: RemoteRecognitionWarmTraceFeaturePort;
  remoteRecognitionWarmTraceBuffTemporalPort?: RemoteRecognitionWarmTraceBuffTemporalPort;
  remoteRecognitionWarmTraceBuffSchedulerPort?: RemoteRecognitionWarmTraceBuffSchedulerPort;
  runtimeReportEvidenceCoordinator?: RuntimeReportEvidenceCoordinator;
  alertIncidentJournal?: AlertIncidentJournal;
  onMessage: (message: string) => void;
}) {
  const precisionEngineRef = useLazyRef(createBuffExpiryPrecisionEngine);
  const lastPreviewAtRef = useRef(0);
  const lastPreviewUrlsRef = useRef<{
    rawPreviewUrl: string | null;
    processedPreviewUrl: string | null;
    fullFramePreviewUrl: string | null;
  }>({ rawPreviewUrl: null, processedPreviewUrl: null, fullFramePreviewUrl: null });
  const displayBoxTracksRef = useRef<BuffExpiryDisplayBoxTrack[]>([]);
  const precisionTrackedBuffsRef = useRef<BuffExpiryTrackedBuff[]>([]);
  const precisionPendingTracksRef = useRef<BuffExpiryPendingTrack[]>([]);
  const precisionRecentRoiFramesRef = useRef<NonNullable<BuffExpirySnapshot["nextRecentRoiFrames"]>>(
    [],
  );
  const lastPrecisionPeriodicRoiFrameAtRef = useRef(0);
  const lastPrecisionNearMissRoiFrameAtRef = useRef(0);
  const lastPrecisionAlertRoiFrameAtRef = useRef<number | null>(null);
  const debugDetectionHistoryRef = useRef<BuffExpiryDebugDetectionFrame[]>([]);
  const runtimeTraceRef = useRef<BuffExpiryRuntimeTraceFrame[]>([]);
  const alertDecisionHistoryRef = useRef<BuffExpiryAlertDecision[]>([]);
  const iconEvidenceRef = useRef<BuffExpiryIconEvidence[]>([]);
  const temporalCandidateTracksRef = useRef<BuffExpiryTemporalCandidateTrack[]>([]);
  const expiryClustersRef = useRef<BuffExpiryExpiryCluster[]>([]);
  const didTrackMonitoringStartedRef = useRef(false);
  const currentPrecisionParserRuntimeKeyRef = useRef(precisionParserRuntimeKey);
  const appliedPrecisionParserRuntimeKeyRef = useRef(precisionParserRuntimeKey);
  const currentGameViewportRevisionRef = useRef(gameViewportRevision);
  const appliedGameViewportRevisionRef = useRef(gameViewportRevision);
  currentPrecisionParserRuntimeKeyRef.current = precisionParserRuntimeKey;
  currentGameViewportRevisionRef.current = gameViewportRevision;
  const {
    markActiveSamplePublished,
    shouldPublishInactiveSample,
  } = useInactiveSamplePublishGate();
  const precisionEnginePreloadActive = Boolean(
    stream && profileRef.current.buffExpiryAlert?.enabled,
  );
  const precisionEngineActiveGroups = getBuffExpiryPrecisionSelectedTargetGroups({
    selectedPrecisionTargetGroups:
      profileRef.current.buffExpiryAlert?.selectedPrecisionTargetGroups,
  });

  const {
    clearBuffExpiryAlertTimers,
    syncBuffExpiryAlertTimers,
  } = useBuffExpiryAlertScheduler({
    profileRef,
    buffExpiryRuntimeRef,
    buffExpirySnapshotRef,
    buffExpiryIncidentRecorderRef,
    lastAlertErrorRef,
    setBuffExpiryRuntime,
    setBuffExpirySnapshot,
    alertIncidentJournal,
    onMessage,
  });

  const {
    precisionEnginePreloadStatusRef,
    resetPrecisionEnginePreload,
    updatePrecisionEnginePreloadStatusFromSample,
  } = useBuffExpiryPrecisionEnginePreload({
    active: precisionEnginePreloadActive,
    activeGroups: precisionEngineActiveGroups,
    precisionEngineRef,
    setBuffExpiryPrecisionPreloadStatus,
  });

  const getSampleLoopRefs = useCallback(
    (): BuffExpirySampleLoopRefs => ({
      precisionEngineRef,
      buffExpiryRuntimeRef,
      buffExpirySnapshotRef,
      lastAlertErrorRef,
      lastPreviewAtRef,
      lastPreviewUrlsRef,
      displayBoxTracksRef,
      precisionTrackedBuffsRef,
      precisionPendingTracksRef,
      precisionRecentRoiFramesRef,
      lastPrecisionPeriodicRoiFrameAtRef,
      lastPrecisionNearMissRoiFrameAtRef,
      lastPrecisionAlertRoiFrameAtRef,
      debugDetectionHistoryRef,
      runtimeTraceRef,
      alertDecisionHistoryRef,
      iconEvidenceRef,
      temporalCandidateTracksRef,
      expiryClustersRef,
    }),
    [buffExpiryRuntimeRef, buffExpirySnapshotRef, lastAlertErrorRef],
  );

  const resetEngineState = useCallback((options: { resetPrecisionEngine?: boolean } = {}) => {
    resetBuffExpirySampleLoopState({
      refs: getSampleLoopRefs(),
      resetPrecisionEngine: options.resetPrecisionEngine,
      clearBuffExpiryAlertTimers,
      resetPrecisionEnginePreload,
    });
  }, [clearBuffExpiryAlertTimers, getSampleLoopRefs, resetPrecisionEnginePreload]);

  const publishState = useCallback(
    (state: BuffExpiryRuntimeState, snapshot: BuffExpirySnapshot | null) => {
      buffExpiryRuntimeRef.current = state;
      setBuffExpiryRuntime(state);
      setBuffExpirySnapshot(snapshot);
    },
    [buffExpiryRuntimeRef, setBuffExpiryRuntime, setBuffExpirySnapshot],
  );

  const trackMonitoringStarted = useCallback(() => {
    if (!didTrackMonitoringStartedRef.current) {
      trackBuffExpiryMonitoringStarted();
      trackFeatureSessionActive("buff_expiry", { mode: "precision", enabledCount: 1 });
      didTrackMonitoringStartedRef.current = true;
    }
  }, []);

  const runBuffExpirySample = useCallback(
    async ({ sampledAt, context }: MonitoringFrameRequest) => {
      const precisionParserRuntimeKeyAtStart =
        currentPrecisionParserRuntimeKeyRef.current;
      const gameViewportRevisionAtStart =
        currentGameViewportRevisionRef.current;
      const currentProfile = profileRef.current;
      iconEvidenceRef.current = pruneBuffExpiryIconEvidence(iconEvidenceRef.current, sampledAt);
      const sampleControl = getBuffExpirySampleLoopControl({
        profile: currentProfile,
        stream,
        context,
        currentState: buffExpiryRuntimeRef.current,
        sampledAt,
        showDebugColumns,
        lastPreviewAt: lastPreviewAtRef.current,
      });

      if (sampleControl.kind === "skip") {
        const inactivePublishKey = [
          sampleControl.state.status,
          sampleControl.resetEngineState ? "reset" : "keep",
          sampleControl.resetPrecisionEngine ? "precision-reset" : "precision-keep",
        ].join(":");
        if (!shouldPublishInactiveSample(inactivePublishKey)) {
          return;
        }
        if (sampleControl.resetEngineState) {
          didTrackMonitoringStartedRef.current = false;
          resetEngineState({ resetPrecisionEngine: sampleControl.resetPrecisionEngine });
        }
        publishState(sampleControl.state, sampleControl.snapshot);
        return;
      }

      let sharedBuffSlotAnalysis: SharedBuffSlotAnalysisResult | null = null;
      let warmTraceClaim: BuffExpiryWarmTraceClaim | null = null;
      let warmScheduleCandidate: BuffExpiryWarmTraceScheduleCandidate | null = null;
      const terminateWarmTrace = (
        outcome: RemoteRecognitionWarmTraceTerminalOutcome,
      ) => {
        terminateBuffExpiryWarmTraceCandidate(warmScheduleCandidate, outcome);
        warmScheduleCandidate = null;
        terminateBuffExpiryWarmTraceClaim(warmTraceClaim, outcome);
        warmTraceClaim = null;
      };
      const stateBefore = buffExpiryRuntimeRef.current;
      try {
        markActiveSamplePublished();
        const sampleLoopRefs = getSampleLoopRefs();
        const commonProcessorContext = createBuffExpirySampleProcessorCommonContext({
          refs: sampleLoopRefs,
          trackMonitoringStarted,
          publishState,
        });
        sharedBuffSlotAnalysis = await getOptionalSharedBuffSlotAnalysis({
          getSharedBuffSlotAnalysis,
          context: sampleControl.context,
        });
        warmTraceClaim = claimBuffExpiryWarmTrace({
          carrier: sharedBuffSlotAnalysis,
          config: sampleControl.config,
          featurePort: remoteRecognitionWarmTracePort,
          temporalPort: remoteRecognitionWarmTraceBuffTemporalPort,
          schedulerPort: remoteRecognitionWarmTraceBuffSchedulerPort,
        });
        if (
          currentPrecisionParserRuntimeKeyRef.current !==
            precisionParserRuntimeKeyAtStart ||
          currentGameViewportRevisionRef.current !==
            gameViewportRevisionAtStart
        ) {
          terminateWarmTrace("replaced");
          return;
        }
        const result = await processBuffExpiryPrecisionSample({
          sampledAt,
          frameContext: sampleControl.context,
          shouldIncludeDebugPreview: sampleControl.shouldIncludeDebugPreview,
          showDebugColumns,
          config: sampleControl.config,
          sharedBuffSlotAnalysis,
          context: createBuffExpiryPrecisionSampleProcessorContext({
            commonContext: commonProcessorContext,
            refs: sampleLoopRefs,
            precisionEnginePreloadStatusRef,
            updatePrecisionEnginePreloadStatusFromSample,
          }),
          isResultCurrent: () =>
            currentPrecisionParserRuntimeKeyRef.current ===
              precisionParserRuntimeKeyAtStart &&
            currentGameViewportRevisionRef.current ===
              gameViewportRevisionAtStart,
          onMatcherOcrCompleted: () => {
            completeBuffExpiryWarmTraceMatcher(warmTraceClaim);
          },
          onTemporalDecisionCompleted: (tracking) => {
            warmScheduleCandidate = authorizeBuffExpiryWarmTraceWait({
              warmTrace: warmTraceClaim,
              confirmedTransitions: tracking.confirmedTransitions,
              tracks: tracking.nextTracks,
              sampledAt,
            });
          },
        });
        if (
          currentPrecisionParserRuntimeKeyRef.current !==
            precisionParserRuntimeKeyAtStart ||
          currentGameViewportRevisionRef.current !==
            gameViewportRevisionAtStart
        ) {
          terminateWarmTrace("replaced");
          return;
        }
        const incidentConfiguration = createBuffExpiryIncidentConfiguration(
          sampleControl.config,
          currentProfile.masterVolume,
        );
        buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentSample({
          previous: buffExpiryIncidentRecorderRef.current,
          input: {
            sampledAt,
            selectedGroups: getBuffExpiryPrecisionSelectedTargetGroups({
              selectedPrecisionTargetGroups:
                sampleControl.config.selectedPrecisionTargetGroups,
            }),
            stateBefore,
            stateAfter: result.state,
            iconObservations: result.snapshot.nextIconObservations ?? [],
            bestByGroup: result.snapshot.nextBestByGroup ?? [],
            parserBoxes: (result.snapshot.nextIconObservations ?? []).map(
              (observation) => observation.box,
            ),
            buffSlotLocalization:
              result.snapshot.nextBuffSlotLocalization ?? null,
            moduleVersions: result.snapshot.nextModuleVersions ?? null,
            parser: {
              engine: result.snapshot.parserEngine ?? null,
              version: result.snapshot.nextModuleVersions?.parser ?? null,
              provider: result.parserRuntime?.executionProvider ?? null,
              modelVersion:
                result.parserRuntime?.modelId ??
                result.snapshot.nextModuleVersions?.runtime ??
                null,
            },
            configuration: incidentConfiguration,
            recentRoiFrames: result.snapshot.nextRecentRoiFrames ?? [],
          },
        });
        syncBuffExpiryAlertTimers(
          result.state.tracks,
          sampledAt,
          warmScheduleCandidate,
        );
        warmScheduleCandidate = null;
        warmTraceClaim = null;
        const trace = result.snapshot.runtimeTrace?.slice(-1)[0] ?? null;
        recordBuffExpirySampleJournalEntries({
          journal: alertIncidentJournal,
          recorder: buffExpiryIncidentRecorderRef.current,
          sampledAt,
          selectedGroups: getBuffExpiryPrecisionSelectedTargetGroups({
            selectedPrecisionTargetGroups:
              sampleControl.config.selectedPrecisionTargetGroups,
          }),
          status: result.state.status,
          decision: trace?.shouldAlert ? "alert" : trace?.unsupportedReason ?? null,
          value: trace?.acceptedMatchCount ?? result.snapshot.acceptedMatches.length,
          configuration: incidentConfiguration,
          details: {
            boxCount: trace?.boxCount ?? result.snapshot.boxes.length,
            acceptedMatchCount:
              trace?.acceptedMatchCount ?? result.snapshot.acceptedMatches.length,
            trackCount: trace?.tracks.length ?? result.state.tracks.length,
            pendingTrackCount: trace?.pendingTracks.length ?? result.state.pendingTracks.length,
            expiryClusterCount: trace?.expiryClusterCount ?? null,
            parserEngine: result.snapshot.parserEngine ?? null,
            parserVersion: result.snapshot.nextModuleVersions?.parser ?? null,
          },
        });
        const evidenceTarget = { feature: "buff-expiry" as const };
        if (
          result.evidenceSource &&
          runtimeReportEvidenceCoordinator?.hasPending(evidenceTarget)
        ) {
          runtimeReportEvidenceCoordinator.publish<BuffExpiryRuntimeReportPayload>({
            target: evidenceTarget,
            sampledAt,
            source: result.evidenceSource,
            parser: {
              engine: result.snapshot.parserEngine ?? null,
              version: result.snapshot.nextModuleVersions?.parser ?? null,
              fallbackReason: result.snapshot.parserFallbackReason ?? null,
              ...(result.parserRuntime
                ? {
                    runtime: result.parserRuntime,
                    performance: result.parserPerformance,
                  }
                : {}),
            },
            payload: {
              snapshot: result.snapshot,
              stateBefore,
              stateAfter: result.state,
            },
          });
        }
      } catch (error) {
        if (
          currentPrecisionParserRuntimeKeyRef.current !==
            precisionParserRuntimeKeyAtStart ||
          currentGameViewportRevisionRef.current !==
            gameViewportRevisionAtStart
        ) {
          terminateWarmTrace("replaced");
          return;
        }
        if (isSharedBuffSlotAnalysisDroppedError(error)) {
          terminateWarmTrace("dropped");
          return;
        }
        terminateWarmTrace("failed");
        const errorMessage = error instanceof Error
          ? error.message
          : "버프 종료 감지에 실패했습니다.";
        const parserFailure = getSharedBuffSlotAnalysisFailureEvidence(error);
        const runtimeFailure = parserFailure
          ? null
          : createRuntimeAnalysisFailureEvidence({
              error,
              occurredAt: sampledAt,
              stage:
                error instanceof Error &&
                error.message === "canvas-context-unavailable"
                  ? "frame-capture"
                  : "feature-analysis",
            });
        const stateAfter: BuffExpiryRuntimeState = {
          ...buffExpiryRuntimeRef.current,
          status: "unavailable",
          lastSampledAt: sampledAt,
          unsupportedReason: errorMessage,
        };
        const previousSnapshot = buffExpirySnapshotRef.current;
        const incidentConfiguration = createBuffExpiryIncidentConfiguration(
          sampleControl.config,
          currentProfile.masterVolume,
        );
        const selectedGroups = getBuffExpiryPrecisionSelectedTargetGroups({
          selectedPrecisionTargetGroups:
            sampleControl.config.selectedPrecisionTargetGroups,
        });
        buffExpiryIncidentRecorderRef.current = recordBuffExpiryIncidentSample({
          previous: buffExpiryIncidentRecorderRef.current,
          input: {
            sampledAt,
            source: "runtime-error",
            selectedGroups,
            stateBefore,
            stateAfter,
            iconObservations: [],
            bestByGroup: [],
            ...(sharedBuffSlotAnalysis
              ? { parserBoxes: sharedBuffSlotAnalysis.analysis.boxes }
              : {}),
            parser: {
              engine: sharedBuffSlotAnalysis?.analysis.engine ?? null,
              version:
                sharedBuffSlotAnalysis?.analysis.runtime?.parserVersion ?? null,
              provider:
                sharedBuffSlotAnalysis?.analysis.runtime?.executionProvider ??
                getRuntimeFailureProvider(parserFailure),
              modelVersion:
                sharedBuffSlotAnalysis?.analysis.runtime?.modelId ?? null,
            },
            runtimeFailure: toBuffExpiryIncidentRuntimeFailure({
              parserFailure,
              runtimeFailure,
              errorMessage,
            }),
            configuration: incidentConfiguration,
            recentRoiFrames: previousSnapshot?.nextRecentRoiFrames ?? [],
          },
        });
        recordBuffExpirySampleJournalEntries({
          journal: alertIncidentJournal,
          recorder: buffExpiryIncidentRecorderRef.current,
          sampledAt,
          selectedGroups,
          status: stateAfter.status,
          decision: parserFailure?.reason ?? "runtime-failed",
          value: null,
          configuration: incidentConfiguration,
          details: getParserFailureIncidentDetails(
            parserFailure,
            runtimeFailure,
            errorMessage,
          ),
        });
        publishState(stateAfter, null);
        publishBuffExpiryRuntimeErrorEvidence({
          sampledAt,
          evidenceFrame:
            getSharedBuffSlotAnalysisFailureFrame(error) ?? sharedBuffSlotAnalysis?.frame ?? null,
          sharedBuffSlotAnalysis,
          stateBefore,
          stateAfter,
          errorMessage,
          parserFailure,
          runtimeFailure,
          previousSnapshot,
          coordinator: runtimeReportEvidenceCoordinator,
        });
        if (error instanceof Error && error.message === "canvas-context-unavailable") {
          onMessage("버프 종료 감지용 캔버스를 준비하지 못했습니다.");
        }
      }
    },
    [
      buffExpiryRuntimeRef,
      buffExpiryIncidentRecorderRef,
      clearBuffExpiryAlertTimers,
      getSampleLoopRefs,
      getSharedBuffSlotAnalysis,
      markActiveSamplePublished,
      precisionEnginePreloadStatusRef,
      remoteRecognitionWarmTraceBuffSchedulerPort,
      remoteRecognitionWarmTraceBuffTemporalPort,
      remoteRecognitionWarmTracePort,
      onMessage,
      profileRef,
      publishState,
      resetEngineState,
      runtimeReportEvidenceCoordinator,
      shouldPublishInactiveSample,
      trackMonitoringStarted,
      updatePrecisionEnginePreloadStatusFromSample,
      showDebugColumns,
      stream,
      syncBuffExpiryAlertTimers,
      alertIncidentJournal,
    ],
  );

  useEffect(() => {
    if (appliedGameViewportRevisionRef.current === gameViewportRevision) {
      return;
    }
    appliedGameViewportRevisionRef.current = gameViewportRevision;
    buffExpiryIncidentRecorderRef.current = resetBuffExpiryIncidentRuntimeRecorder({
      previous: buffExpiryIncidentRecorderRef.current,
      reason: "game-viewport-changed",
    });
    resetEngineState();
    didTrackMonitoringStartedRef.current = false;
    const next = createBuffExpiryRuntimeState();
    buffExpiryRuntimeRef.current = next;
    buffExpirySnapshotRef.current = null;
    setBuffExpiryRuntime(next);
    setBuffExpirySnapshot(null);
  }, [
    buffExpiryIncidentRecorderRef,
    buffExpiryRuntimeRef,
    buffExpirySnapshotRef,
    gameViewportRevision,
    resetEngineState,
    setBuffExpiryRuntime,
    setBuffExpirySnapshot,
  ]);

  useEffect(() => {
    buffExpiryIncidentRecorderRef.current = resetBuffExpiryIncidentRuntimeRecorder({
      previous: buffExpiryIncidentRecorderRef.current,
      reason: stream ? "capture-started" : "capture-stopped",
      captureChanged: true,
    });
    resetEngineState({ resetPrecisionEngine: !stream });
    if (!stream) {
      const next = createBuffExpiryRuntimeState();
      buffExpiryRuntimeRef.current = next;
      buffExpirySnapshotRef.current = null;
      setBuffExpiryRuntime(next);
      setBuffExpirySnapshot(null);
    }
  }, [
    buffExpiryRuntimeRef,
    buffExpiryIncidentRecorderRef,
    buffExpirySnapshotRef,
    resetEngineState,
    setBuffExpiryRuntime,
    setBuffExpirySnapshot,
    stream,
  ]);

  useEffect(() => {
    if (appliedPrecisionParserRuntimeKeyRef.current === precisionParserRuntimeKey) {
      return;
    }
    appliedPrecisionParserRuntimeKeyRef.current = precisionParserRuntimeKey;
    buffExpiryIncidentRecorderRef.current = resetBuffExpiryIncidentRuntimeRecorder({
      previous: buffExpiryIncidentRecorderRef.current,
      reason: "parser-runtime-changed",
    });
    resetEngineState({ resetPrecisionEngine: true });
    didTrackMonitoringStartedRef.current = false;
    const next = createBuffExpiryRuntimeState();
    buffExpiryRuntimeRef.current = next;
    buffExpirySnapshotRef.current = null;
    setBuffExpiryRuntime(next);
    setBuffExpirySnapshot(null);
  }, [
    buffExpiryRuntimeRef,
    buffExpiryIncidentRecorderRef,
    buffExpirySnapshotRef,
    precisionParserRuntimeKey,
    resetEngineState,
    setBuffExpiryRuntime,
    setBuffExpirySnapshot,
  ]);

  return runBuffExpirySample;
}

function recordBuffExpirySampleJournalEntries({
  journal,
  recorder,
  sampledAt,
  selectedGroups,
  status,
  decision,
  value,
  configuration,
  details,
}: {
  journal?: AlertIncidentJournal;
  recorder: BuffExpiryIncidentRuntimeRecorder;
  sampledAt: number;
  selectedGroups: BuffExpiryTargetGroup[];
  status: string;
  decision: string | null;
  value: number | null;
  configuration: Record<string, unknown>;
  details: Record<string, unknown>;
}) {
  if (!journal) {
    return;
  }
  const frame = [...recorder.archive.frames]
    .reverse()
    .find((entry) => entry.sampledAt === sampledAt && entry.source !== "report-time");
  if (!frame) {
    return;
  }
  for (const group of selectedGroups) {
    const observations = recorder.archive.observations.filter(
      (entry) => entry.frameId === frame.id && entry.group === group,
    );
    const episodeIds = [...new Set(
      observations.flatMap((entry) => entry.episodeId ? [entry.episodeId] : []),
    )];
    journal.record({
      id: `${frame.id}:journal:${group}`,
      feature: "buff-expiry",
      targetId: group,
      kind: "sample",
      occurredAt: sampledAt,
      frameId: frame.id,
      cycleId: null,
      status,
      decision,
      value:
        observations.length > 0
          ? observations.filter((entry) => entry.targetAccepted).length
          : value,
      configuration,
      details: {
        ...details,
        group,
        observationIds: observations.map((entry) => entry.id),
        episodeIds,
        runtimeFailure: frame.runtimeFailure,
      },
    });
  }
}

function toBuffExpiryIncidentRuntimeFailure({
  parserFailure,
  runtimeFailure,
  errorMessage,
}: {
  parserFailure: RuntimeParserFailureEvidence | null;
  runtimeFailure: BuffExpirySnapshot["runtimeFailure"];
  errorMessage: string;
}) {
  const diagnostic = parserFailure?.diagnostic ?? null;
  return {
    stage: diagnostic?.stage ?? runtimeFailure?.stage ?? "feature-analysis",
    code:
      diagnostic?.code ?? runtimeFailure?.code ?? "buff-expiry-runtime-failed",
    message:
      parserFailure?.technicalMessage ??
      runtimeFailure?.technicalMessage ??
      errorMessage,
    provider: getRuntimeFailureProvider(parserFailure),
    recoverable: null,
  };
}

function getRuntimeFailureProvider(
  failure: RuntimeParserFailureEvidence | null,
): string | null {
  const provider = failure?.diagnostic?.details.executionProvider;
  return typeof provider === "string" ? provider : null;
}

function publishBuffExpiryRuntimeErrorEvidence({
  sampledAt,
  evidenceFrame,
  sharedBuffSlotAnalysis,
  stateBefore,
  stateAfter,
  errorMessage,
  parserFailure,
  runtimeFailure,
  previousSnapshot,
  coordinator,
}: {
  sampledAt: number;
  evidenceFrame: SharedBuffSlotFrameSample | null;
  sharedBuffSlotAnalysis: SharedBuffSlotAnalysisResult | null;
  stateBefore: BuffExpiryRuntimeState;
  stateAfter: BuffExpiryRuntimeState;
  errorMessage: string;
  parserFailure: RuntimeParserFailureEvidence | null;
  runtimeFailure: BuffExpirySnapshot["runtimeFailure"];
  previousSnapshot: BuffExpirySnapshot | null;
  coordinator?: RuntimeReportEvidenceCoordinator;
}) {
  const evidenceTarget = { feature: "buff-expiry" as const };
  const source = evidenceFrame ? createBuffSlotEvidenceSource(evidenceFrame) : null;
  if (!source || !coordinator?.hasPending(evidenceTarget)) {
    return;
  }
  const parser = sharedBuffSlotAnalysis?.analysis ?? null;
  const boxes = (parser?.boxes ?? []).map((box) => ({
    x: box.x,
    y: box.y,
    width: box.size,
    height: box.size,
    side: box.size,
    confidence: box.confidence,
  }));
  const snapshot: BuffExpirySnapshot = {
    sampledAt,
    parserEngine: parser?.engine ?? null,
    parserFallbackReason: parser?.fallbackReason ?? null,
    roi: {
      x: 0,
      y: 0,
      width: source.sourceSize.width,
      height: source.sourceSize.height,
    },
    rawPreviewUrl: null,
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
    boxes,
    displayBoxes: boxes,
    nextIconObservations: [],
    nextBestByGroup: [],
    acceptedMatches: [],
    rejectedMatches: [],
    tracks: stateAfter.tracks,
    pendingTracks: stateAfter.pendingTracks,
    unsupportedReason: errorMessage,
    performance: null,
    nextRecentRoiFrames: previousSnapshot?.nextRecentRoiFrames ?? [],
    runtimeTrace: previousSnapshot?.runtimeTrace ?? [],
    alertDecisionHistory: previousSnapshot?.alertDecisionHistory ?? [],
    lastAlertEvidence: stateAfter.lastAlertEvidence ?? null,
    runtimeFailure,
  };
  coordinator.publish<BuffExpiryRuntimeReportPayload>({
    target: evidenceTarget,
    sampledAt,
    source,
    parser: {
      engine: parser?.engine ?? null,
      version: parser?.parserVersion ?? null,
      fallbackReason: parser?.fallbackReason ?? null,
      ...(parserFailure ? { failure: parserFailure } : {}),
      ...(parser?.runtime
        ? {
            runtime: parser.runtime,
            performance: sharedBuffSlotAnalysis?.performance ?? null,
          }
        : {}),
    },
    payload: { snapshot, stateBefore, stateAfter },
  });
}

function getParserFailureIncidentDetails(
  failure: RuntimeParserFailureEvidence | null,
  runtimeFailure: BuffExpirySnapshot["runtimeFailure"],
  errorMessage: string,
) {
  return {
    errorMessage,
    parserFailureReason: failure?.reason ?? null,
    parserFailureStage: failure?.diagnostic?.stage ?? null,
    parserFailureCode: failure?.diagnostic?.code ?? null,
    parserTechnicalMessage: failure?.technicalMessage ?? null,
    executionProvider:
      failure?.diagnostic?.details.executionProvider ?? null,
    runtimeFailureStage: runtimeFailure?.stage ?? null,
    runtimeFailureCode: runtimeFailure?.code ?? null,
    runtimeTechnicalMessage: runtimeFailure?.technicalMessage ?? null,
  };
}

async function getOptionalSharedBuffSlotAnalysis({
  getSharedBuffSlotAnalysis,
  context,
}: {
  getSharedBuffSlotAnalysis?: GetSharedBuffSlotAnalysis;
  context: MonitoringFrameContext;
}) {
  if (!getSharedBuffSlotAnalysis) {
    return null;
  }
  return getSharedBuffSlotAnalysis({
    sampledAt: context.sampledAt,
    video: context.video,
    sampleBuffSlotFrame: context.sampleBuffSlotFrame,
    includePreview: false,
  });
}
