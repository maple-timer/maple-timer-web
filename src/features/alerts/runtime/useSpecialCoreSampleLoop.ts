import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { trackFeatureSessionActive } from "../../../lib/analyticsEvents";
import type { BuffSlotVideoFrameSample } from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import { createPlaceholderImageData } from "../../../lib/imageData";
import {
  createSpecialCoreRuntimeState,
  updateSpecialCoreRuntimeFromSample,
  type SpecialCoreRuntimeState,
  type SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import {
  createSpecialCoreAlertEngine,
} from "../../../platform/runtime-workers/special-core/specialCoreAlertWorkerClient";
import { createDefaultSpecialCoreAlert } from "../../../lib/storage";
import type { Profile } from "../../../types";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { MonitoringFrameRequest } from "../../../runtime/monitoring/monitoringFrameBinding";
import { useLazyRef } from "./useLazyRef";
import type { RuntimeParserFailureEvidence } from "../../../contracts/reporting/runtimeReportEvidence";
import {
  getSharedBuffSlotAnalysisFailureEvidence,
  getSharedBuffSlotAnalysisFailureFrame,
  isSharedBuffSlotAnalysisDroppedError,
  type GetSharedBuffSlotAnalysis,
  type SharedBuffSlotAnalysisResult,
  type SharedBuffSlotFrameSample,
} from "./useSharedBuffSlotAnalysis";
import {
  createAlertIncidentFrameId,
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import {
  requestSpecialCoreIncidentRuntimeReset,
  shouldCaptureSpecialCoreIncidentMedia,
  type SpecialCoreIncidentRuntimeRecorder,
} from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import {
  createSpecialCoreIdleSnapshot,
  createSpecialCoreIncidentRuntimeFailure,
  recordSpecialCoreMonitoringIncident,
} from "./specialCoreIncidentRuntimeAdapter";
import type {
  RemoteRecognitionWarmTraceFeaturePort,
  RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  bindSpecialCoreWarmTraceActivation,
  claimSpecialCoreWarmTrace,
  completeSpecialCoreWarmTraceMatcher,
  terminateSpecialCoreWarmTraceCandidate,
  terminateSpecialCoreWarmTraceClaim,
  terminateSpecialCoreWarmTraceForState,
  type SpecialCoreWarmTraceClaim,
  type SpecialCoreWarmTraceScheduleCandidate,
} from "./specialCoreWarmTrace";

export function useSpecialCoreSampleLoop({
  stream,
  gameViewportRevision,
  profileRef,
  specialCoreRuntimeRef,
  specialCoreIncidentRecorderRef,
  setSpecialCoreRuntime,
  setSpecialCoreSnapshot,
  getSharedBuffSlotAnalysis,
  precisionParserRuntimeKey,
  remoteRecognitionWarmTracePort,
  alertIncidentJournal,
  onMessage,
}: {
  stream: MediaStream | null;
  gameViewportRevision: number;
  profileRef: MutableRefObject<Profile>;
  specialCoreRuntimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  specialCoreIncidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
  setSpecialCoreRuntime: Dispatch<SetStateAction<SpecialCoreRuntimeState>>;
  setSpecialCoreSnapshot: Dispatch<SetStateAction<SpecialCoreSnapshot | null>>;
  getSharedBuffSlotAnalysis?: GetSharedBuffSlotAnalysis;
  precisionParserRuntimeKey?: string;
  remoteRecognitionWarmTracePort?: RemoteRecognitionWarmTraceFeaturePort;
  alertIncidentJournal?: AlertIncidentJournal;
  onMessage: (message: string) => void;
}) {
  const engineRef = useLazyRef(createSpecialCoreAlertEngine);
  const engineUsedRef = useRef(false);
  const timingKeyRef = useRef<string | null>(null);
  const currentPrecisionParserRuntimeKeyRef = useRef(precisionParserRuntimeKey);
  const appliedPrecisionParserRuntimeKeyRef = useRef(precisionParserRuntimeKey);
  const currentGameViewportRevisionRef = useRef(gameViewportRevision);
  const appliedGameViewportRevisionRef = useRef(gameViewportRevision);
  currentPrecisionParserRuntimeKeyRef.current = precisionParserRuntimeKey;
  currentGameViewportRevisionRef.current = gameViewportRevision;

  const resetEngineState = useCallback((
    reason:
      | "stream-replaced"
      | "source-geometry-changed"
      | "parser-runtime-changed"
      | "matcher-worker-reset"
      | null =
      null,
  ) => {
    terminateSpecialCoreWarmTraceForState(
      specialCoreRuntimeRef.current,
      reason ? "replaced" : "cancelled",
    );
    engineRef.current.reset();
    engineUsedRef.current = false;
    if (reason) {
      specialCoreIncidentRecorderRef.current = requestSpecialCoreIncidentRuntimeReset({
        previous: specialCoreIncidentRecorderRef.current,
        reason,
      });
    }
    const next = createSpecialCoreRuntimeState();
    specialCoreRuntimeRef.current = next;
    setSpecialCoreRuntime(next);
    setSpecialCoreSnapshot(null);
  }, [
    setSpecialCoreRuntime,
    setSpecialCoreSnapshot,
    specialCoreIncidentRecorderRef,
    specialCoreRuntimeRef,
  ]);

  const publishState = useCallback(
    (state: SpecialCoreRuntimeState, snapshot: SpecialCoreSnapshot | null) => {
      specialCoreRuntimeRef.current = state;
      setSpecialCoreRuntime(state);
      setSpecialCoreSnapshot(snapshot);
    },
    [setSpecialCoreRuntime, setSpecialCoreSnapshot, specialCoreRuntimeRef],
  );

  const runSpecialCoreSample = useCallback(
    async ({ sampledAt, context }: MonitoringFrameRequest) => {
      const precisionParserRuntimeKeyAtStart =
        currentPrecisionParserRuntimeKeyRef.current;
      const gameViewportRevisionAtStart =
        currentGameViewportRevisionRef.current;
      const currentProfile = profileRef.current;
      const config = currentProfile.specialCoreAlert ?? createDefaultSpecialCoreAlert();

      if (!config.enabled) {
        const stateBefore = specialCoreRuntimeRef.current;
        timingKeyRef.current = null;
        if (engineUsedRef.current || specialCoreRuntimeRef.current.status !== "idle") {
          resetEngineState();
        }
        specialCoreIncidentRecorderRef.current = recordSpecialCoreMonitoringIncident({
          previous: specialCoreIncidentRecorderRef.current,
          config,
          masterVolume: currentProfile.masterVolume,
          sampledAt,
          parserRuntimeGeneration: precisionParserRuntimeKeyAtStart,
          context,
          evidenceFrame: null,
          sharedBuffSlotAnalysis: null,
          analysis: null,
          stateBefore,
          stateAfter: specialCoreRuntimeRef.current,
          snapshot: createSpecialCoreIdleSnapshot(sampledAt),
          runtimeFailure: null,
          recordFrame: false,
        });
        return;
      }

      const timingKey = `${config.cooldownSeconds}:${config.alertLeadSeconds}`;
      timingKeyRef.current = timingKey;

      if (!stream || !context) {
        const stateBefore = specialCoreRuntimeRef.current;
        const stateAfter = {
          ...stateBefore,
          status: "needs-stream" as const,
          lastSampledAt: sampledAt,
          unsupportedReason: null,
        };
        publishState(stateAfter, null);
        specialCoreIncidentRecorderRef.current = recordSpecialCoreMonitoringIncident({
          previous: specialCoreIncidentRecorderRef.current,
          config,
          masterVolume: currentProfile.masterVolume,
          sampledAt,
          parserRuntimeGeneration: precisionParserRuntimeKeyAtStart,
          context,
          evidenceFrame: null,
          sharedBuffSlotAnalysis: null,
          analysis: null,
          stateBefore,
          stateAfter,
          snapshot: createSpecialCoreIdleSnapshot(sampledAt),
          runtimeFailure: null,
          recordFrame: false,
          unavailableAction:
            stateBefore.status === "needs-stream" ? null : "needs-stream",
        });
        return;
      }

      let sharedBuffSlotAnalysis: SharedBuffSlotAnalysisResult | null = null;
      let evidenceFrame: BuffSlotVideoFrameSample | SharedBuffSlotFrameSample | null = null;
      let warmTraceClaim: SpecialCoreWarmTraceClaim | null = null;
      let warmTraceCandidate: SpecialCoreWarmTraceScheduleCandidate | null = null;
      const terminateWarmTrace = (
        outcome: RemoteRecognitionWarmTraceTerminalOutcome,
      ) => {
        terminateSpecialCoreWarmTraceCandidate(warmTraceCandidate, outcome);
        warmTraceCandidate = null;
        terminateSpecialCoreWarmTraceClaim(warmTraceClaim, outcome);
        warmTraceClaim = null;
      };
      let stateBefore = specialCoreRuntimeRef.current;
      try {
        trackFeatureSessionActive("special_core", { mode: "buff_slot", enabledCount: 1 });
        if (!engineUsedRef.current) {
          engineUsedRef.current = true;
          publishState(
            {
              ...specialCoreRuntimeRef.current,
              status: "loading",
              lastSampledAt: sampledAt,
              unsupportedReason: null,
            },
            null,
          );
        }

        sharedBuffSlotAnalysis = await getOptionalSharedBuffSlotAnalysis({
          getSharedBuffSlotAnalysis,
          context,
        });
        warmTraceClaim = claimSpecialCoreWarmTrace({
          carrier: sharedBuffSlotAnalysis,
          config,
          featurePort: remoteRecognitionWarmTracePort,
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
        let imageData: ImageData;
        if (sharedBuffSlotAnalysis) {
          evidenceFrame = sharedBuffSlotAnalysis.frame;
          imageData = createPlaceholderImageData();
        } else {
          const sampledFrame = context.sampleBuffSlotFrame({
            includePreview:
              shouldCaptureSpecialCoreIncidentMedia({
                recorder: specialCoreIncidentRecorderRef.current,
                sampledAt,
              }),
          });
          evidenceFrame = sampledFrame;
          imageData = sampledFrame.imageData;
        }
        stateBefore = specialCoreRuntimeRef.current;
        const processed = await engineRef.current.process({
          imageData,
          sampledAt,
          buffSlotAnalysis: sharedBuffSlotAnalysis?.analysis,
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
        const currentConfigAfterProcessing =
          profileRef.current.specialCoreAlert ?? createDefaultSpecialCoreAlert();
        if (
          !hasSameSpecialCoreWarmTraceTiming(
            config,
            currentConfigAfterProcessing,
          )
        ) {
          terminateWarmTrace("replaced");
        }
        completeSpecialCoreWarmTraceMatcher({
          warmTrace: warmTraceClaim,
          response: processed,
          sampledAt,
        });
        const previousState = specialCoreRuntimeRef.current;
        stateBefore = previousState;
        const nextState = updateSpecialCoreRuntimeFromSample({
          previous: previousState,
          sample: processed,
          config,
          now: sampledAt,
        });
        warmTraceCandidate = bindSpecialCoreWarmTraceActivation({
          warmTrace: warmTraceClaim,
          response: processed,
          stateBefore: previousState,
          stateAfter: nextState,
          sampledAt,
        });
        const snapshot = {
          sampledAt: processed.sampledAt ?? sampledAt,
          error: null,
          boxCount: processed.boxCount,
          parserEngine: processed.parserEngine ?? null,
          parserVersion: processed.parserVersion ?? null,
          parserFallbackReason: processed.parserFallbackReason ?? null,
          detectedCount: processed.detectedCount,
          detectedIcon: processed.detectedIcon,
          candidateIcons: processed.candidateIcons,
          performance: processed.performance,
        };
        recordSpecialCoreIncidentSample({
          alertIncidentJournal,
          config,
          masterVolume: currentProfile.masterVolume,
          sampledAt,
          snapshot,
          state: nextState,
          parserFailure: null,
        });
        specialCoreIncidentRecorderRef.current = recordSpecialCoreMonitoringIncident({
          previous: specialCoreIncidentRecorderRef.current,
          config,
          masterVolume: currentProfile.masterVolume,
          sampledAt,
          parserRuntimeGeneration: precisionParserRuntimeKeyAtStart,
          context,
          evidenceFrame,
          sharedBuffSlotAnalysis,
          analysis: processed,
          stateBefore,
          stateAfter: nextState,
          snapshot,
          runtimeFailure: null,
        });
        publishState(nextState, snapshot);
      } catch (error) {
        terminateWarmTrace("failed");
        if (
          currentPrecisionParserRuntimeKeyRef.current !==
            precisionParserRuntimeKeyAtStart ||
          currentGameViewportRevisionRef.current !==
            gameViewportRevisionAtStart
        ) {
          return;
        }
        if (isSharedBuffSlotAnalysisDroppedError(error)) {
          return;
        }
        evidenceFrame = getSharedBuffSlotAnalysisFailureFrame(error) ?? evidenceFrame;
        const parserFailure = getSharedBuffSlotAnalysisFailureEvidence(error);
        const errorMessage = error instanceof Error
          ? error.message
          : "특수코어 감지에 실패했습니다.";
        const stateAfter: SpecialCoreRuntimeState = {
          ...specialCoreRuntimeRef.current,
          status: "unavailable",
          lastSampledAt: sampledAt,
          unsupportedReason: errorMessage,
        };
        const snapshot = createSpecialCoreErrorSnapshot({
          sampledAt,
          sharedBuffSlotAnalysis,
          errorMessage,
        });
        recordSpecialCoreIncidentSample({
          alertIncidentJournal,
          config,
          masterVolume: currentProfile.masterVolume,
          sampledAt,
          snapshot,
          state: stateAfter,
          parserFailure,
        });
        specialCoreIncidentRecorderRef.current = recordSpecialCoreMonitoringIncident({
          previous: specialCoreIncidentRecorderRef.current,
          config,
          masterVolume: currentProfile.masterVolume,
          sampledAt,
          parserRuntimeGeneration: precisionParserRuntimeKeyAtStart,
          context,
          evidenceFrame,
          sharedBuffSlotAnalysis,
          analysis: null,
          stateBefore,
          stateAfter,
          snapshot,
          runtimeFailure: createSpecialCoreIncidentRuntimeFailure({
            parserFailure,
            error,
          }),
          unavailableAction: "sample-failed",
        });
        publishState(stateAfter, null);
        if (error instanceof Error && error.message === "canvas-context-unavailable") {
          onMessage("특수코어 감지용 캔버스를 준비하지 못했습니다.");
        }
      }
    },
    [
      onMessage,
      profileRef,
      publishState,
      resetEngineState,
      getSharedBuffSlotAnalysis,
      remoteRecognitionWarmTracePort,
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
    resetEngineState("source-geometry-changed");
    timingKeyRef.current = null;
  }, [gameViewportRevision, resetEngineState]);

  useEffect(() => {
    resetEngineState("stream-replaced");
    timingKeyRef.current = null;
  }, [resetEngineState, stream]);

  useEffect(() => {
    if (appliedPrecisionParserRuntimeKeyRef.current === precisionParserRuntimeKey) {
      return;
    }
    appliedPrecisionParserRuntimeKeyRef.current = precisionParserRuntimeKey;
    resetEngineState("parser-runtime-changed");
  }, [precisionParserRuntimeKey, resetEngineState]);

  useEffect(
    () => () => {
      terminateSpecialCoreWarmTraceForState(
        specialCoreRuntimeRef.current,
        "cancelled",
      );
    },
    [specialCoreRuntimeRef],
  );

  return runSpecialCoreSample;
}

function recordSpecialCoreIncidentSample({
  alertIncidentJournal,
  config,
  masterVolume,
  sampledAt,
  snapshot,
  state,
  parserFailure,
}: {
  alertIncidentJournal?: AlertIncidentJournal;
  config: NonNullable<Profile["specialCoreAlert"]>;
  masterVolume: number;
  sampledAt: number;
  snapshot: SpecialCoreSnapshot;
  state: SpecialCoreRuntimeState;
  parserFailure: RuntimeParserFailureEvidence | null;
}) {
  const bestCandidate = snapshot.detectedIcon ?? snapshot.candidateIcons[0] ?? null;
  alertIncidentJournal?.record({
    id: `special-core:sample:${sampledAt}`,
    feature: "special-core",
    targetId: null,
    kind: state.alertedAt === sampledAt ? "decision" : "sample",
    occurredAt: sampledAt,
    frameId: createAlertIncidentFrameId(sampledAt),
    cycleId: state.activationId,
    status: state.status,
    decision: bestCandidate?.match.decisionReason ?? snapshot.error ?? null,
    value: snapshot.detectedCount,
    configuration: {
      enabled: config.enabled,
      cooldownSeconds: config.cooldownSeconds,
      alertLeadSeconds: config.alertLeadSeconds,
      soundId: config.soundId,
      volume: config.volume,
      masterVolume,
    },
    details: {
      boxCount: snapshot.boxCount,
      detectedCount: snapshot.detectedCount,
      candidateCount: snapshot.candidateIcons.length,
      parserEngine: snapshot.parserEngine ?? null,
      parserVersion: snapshot.parserVersion ?? null,
      parserFailureReason: parserFailure?.reason ?? null,
      parserFailureStage: parserFailure?.diagnostic?.stage ?? null,
      parserFailureCode: parserFailure?.diagnostic?.code ?? null,
      parserTechnicalMessage: parserFailure?.technicalMessage ?? null,
      alertDueAt: state.alertDueAt,
      alertedAt: state.alertedAt,
    },
  });
}

function createSpecialCoreErrorSnapshot({
  sampledAt,
  sharedBuffSlotAnalysis,
  errorMessage,
}: {
  sampledAt: number;
  sharedBuffSlotAnalysis: SharedBuffSlotAnalysisResult | null;
  errorMessage: string;
}): SpecialCoreSnapshot {
  return {
    sampledAt,
    error: errorMessage,
    parserEngine: sharedBuffSlotAnalysis?.analysis.engine ?? null,
    parserVersion: sharedBuffSlotAnalysis?.analysis.parserVersion ?? null,
    parserFallbackReason: sharedBuffSlotAnalysis?.analysis.fallbackReason ?? null,
    boxCount: sharedBuffSlotAnalysis?.analysis.boxes.length ?? 0,
    detectedCount: 0,
    detectedIcon: null,
    candidateIcons: [],
    performance: {
      totalMs: 0,
      detectMs: sharedBuffSlotAnalysis?.performance.detectMs ?? 0,
      matchMs: 0,
      boxCount: sharedBuffSlotAnalysis?.analysis.boxes.length ?? 0,
    },
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

function hasSameSpecialCoreWarmTraceTiming(
  left: Pick<
    NonNullable<Profile["specialCoreAlert"]>,
    "enabled" | "cooldownSeconds" | "alertLeadSeconds"
  >,
  right: Pick<
    NonNullable<Profile["specialCoreAlert"]>,
    "enabled" | "cooldownSeconds" | "alertLeadSeconds"
  >,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.cooldownSeconds === right.cooldownSeconds &&
    left.alertLeadSeconds === right.alertLeadSeconds
  );
}
