import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
  RuneSnapshot,
  RuneRuntimeState,
  SkillReportTimeline,
  SkillSnapshot,
} from "../../../alertTypes";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionPreloadStatus } from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import type {
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import type { Profile, SkillRuntimeState } from "../../../types";
import { useBoosterExpirySampleLoop } from "./useBoosterExpirySampleLoop";
import { useBuffExpirySampleLoop } from "./useBuffExpirySampleLoop";
import { useHuntStallSampleLoop } from "./useHuntStallSampleLoop";
import { runSkillRuneMonitoringFrame } from "./monitoringFrameRunner";
import { createMonitoringJobs } from "./monitoringJobs";
import { useRuneFrameLoop } from "./useRuneFrameLoop";
import { useSpecialCoreSampleLoop } from "./useSpecialCoreSampleLoop";
import { useSharedBuffSlotAnalysis } from "./useSharedBuffSlotAnalysis";
import { useSkillFrameLoop } from "./useSkillFrameLoop";
import { useMonitoringScheduler } from "./useMonitoringScheduler";
import type { RuntimeReportEvidenceCoordinator } from "../../../contracts/reporting/runtimeReportEvidence";
import { createMonitoringFrameBinding } from "../../../runtime/monitoring/monitoringFrameBinding";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { AlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import type { BuffExpiryIncidentRuntimeRecorder } from "../../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import {
  shouldCaptureSkillIncidentPrecisionMedia,
  type SkillIncidentRuntimeRecorder,
} from "../../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import { getSkillBuffDurationTargetForSkill } from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import type { HuntStallIncidentRuntimeRecorder } from "../../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";
import type { SpecialCoreIncidentRuntimeRecorder } from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import { shouldCaptureSpecialCoreIncidentMedia } from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import type { BoosterExpiryIncidentRuntimeRecorder } from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import type { UltimaRaidEquipmentRuntimeState } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { UltimaRaidEquipmentSnapshot } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import { useUltimaRaidEquipmentFrameLoop } from "./useUltimaRaidEquipmentFrameLoop";
import type { UltimaRaidEquipmentIncidentArchive } from "../../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import type { ResolvedGameViewport } from "../../../contracts/geometry/frameSource";
import type { PrecisionParserInputTransport } from "../../../contracts/recognition/precisionParserInputTransport";
import type { RemoteRecognitionParserFrameProvider } from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import {
  attachRemoteRecognitionWarmTraceHandle,
  getRemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceBuffSchedulerPort,
  type RemoteRecognitionWarmTraceBuffTemporalPort,
  type RemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTracePort,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import type { BuffSlotPhysicalSampleDecorator } from "../../../runtime/monitoring/monitoringFrameContext";

export function useMonitoringLoop({
  stream,
  gameViewport,
  gameViewportRevision = 0,
  videoRef,
  profileRef,
  runtimeRef,
  skillIncidentRecorderRef,
  runeRuntimeRef,
  runeSnapshotRef,
  ultimaRaidEquipmentRuntimeRef,
  ultimaRaidEquipmentSnapshotRef,
  ultimaRaidEquipmentIncidentArchiveRef,
  huntStallRuntimeRef,
  huntStallIncidentRecorderRef,
  buffExpiryRuntimeRef,
  buffExpirySnapshotRef,
  buffExpiryIncidentRecorderRef,
  boosterExpiryRuntimeRef,
  boosterExpiryIncidentRecorderRef,
  specialCoreRuntimeRef,
  specialCoreIncidentRecorderRef,
  skillReportTimelineRef,
  lastAlertErrorRef,
  showDebugColumns,
  handleMetadata,
  setRuntimeStates,
  setSnapshots,
  setRuneRuntime,
  setRuneSnapshot,
  setUltimaRaidEquipmentRuntime,
  setUltimaRaidEquipmentSnapshot,
  setHuntStallRuntime,
  setHuntStallSnapshot,
  setBuffExpiryRuntime,
  setBuffExpirySnapshot,
  setBuffExpiryPrecisionPreloadStatus,
  setBoosterExpiryRuntime,
  setBoosterExpirySnapshot,
  setSpecialCoreRuntime,
  setSpecialCoreSnapshot,
  onMessage,
  onNoStream,
  runtimeReportEvidenceCoordinator,
  alertIncidentJournal,
  precisionParserInputTransport,
  remoteParserProvider,
  onRemoteParserUnavailable,
  remoteRecognitionWarmTracePort,
  remoteRecognitionWarmTraceBuffTemporalPort,
  remoteRecognitionWarmTraceBuffSchedulerPort,
  onMonitoringFrame,
}: {
  stream: MediaStream | null;
  gameViewport?: ResolvedGameViewport | null;
  gameViewportRevision?: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  runtimeRef: MutableRefObject<Record<string, SkillRuntimeState>>;
  skillIncidentRecorderRef: MutableRefObject<SkillIncidentRuntimeRecorder>;
  runeRuntimeRef: MutableRefObject<RuneRuntimeState>;
  runeSnapshotRef: MutableRefObject<RuneSnapshot | null>;
  ultimaRaidEquipmentRuntimeRef: MutableRefObject<UltimaRaidEquipmentRuntimeState>;
  ultimaRaidEquipmentSnapshotRef: MutableRefObject<UltimaRaidEquipmentSnapshot | null>;
  ultimaRaidEquipmentIncidentArchiveRef: MutableRefObject<UltimaRaidEquipmentIncidentArchive>;
  huntStallRuntimeRef: MutableRefObject<HuntStallRuntimeState>;
  huntStallIncidentRecorderRef: MutableRefObject<HuntStallIncidentRuntimeRecorder>;
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  buffExpiryIncidentRecorderRef: MutableRefObject<BuffExpiryIncidentRuntimeRecorder>;
  boosterExpiryRuntimeRef: MutableRefObject<BoosterExpiryRuntimeState>;
  boosterExpiryIncidentRecorderRef: MutableRefObject<BoosterExpiryIncidentRuntimeRecorder>;
  specialCoreRuntimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  specialCoreIncidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
  skillReportTimelineRef: MutableRefObject<Record<string, SkillReportTimeline>>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  showDebugColumns: boolean;
  handleMetadata: () => void;
  setRuntimeStates: Dispatch<SetStateAction<Record<string, SkillRuntimeState>>>;
  setSnapshots: Dispatch<SetStateAction<Record<string, SkillSnapshot>>>;
  setRuneRuntime: Dispatch<SetStateAction<RuneRuntimeState>>;
  setRuneSnapshot: Dispatch<SetStateAction<RuneSnapshot | null>>;
  setUltimaRaidEquipmentRuntime: Dispatch<
    SetStateAction<UltimaRaidEquipmentRuntimeState>
  >;
  setUltimaRaidEquipmentSnapshot: Dispatch<
    SetStateAction<UltimaRaidEquipmentSnapshot | null>
  >;
  setHuntStallRuntime: Dispatch<SetStateAction<HuntStallRuntimeState>>;
  setHuntStallSnapshot: Dispatch<SetStateAction<HuntStallSnapshot | null>>;
  setBuffExpiryRuntime: Dispatch<SetStateAction<BuffExpiryRuntimeState>>;
  setBuffExpirySnapshot: Dispatch<SetStateAction<BuffExpirySnapshot | null>>;
  setBuffExpiryPrecisionPreloadStatus: Dispatch<
    SetStateAction<BuffExpiryPrecisionPreloadStatus>
  >;
  setBoosterExpiryRuntime: Dispatch<SetStateAction<BoosterExpiryRuntimeState>>;
  setBoosterExpirySnapshot: Dispatch<
    SetStateAction<BoosterExpirySnapshot | null>
  >;
  setSpecialCoreRuntime: Dispatch<SetStateAction<SpecialCoreRuntimeState>>;
  setSpecialCoreSnapshot: Dispatch<SetStateAction<SpecialCoreSnapshot | null>>;
  onMessage: (message: string) => void;
  onNoStream: () => void;
  runtimeReportEvidenceCoordinator?: RuntimeReportEvidenceCoordinator;
  alertIncidentJournal?: AlertIncidentJournal;
  precisionParserInputTransport?: PrecisionParserInputTransport;
  remoteParserProvider?: RemoteRecognitionParserFrameProvider;
  onRemoteParserUnavailable?: (error: unknown, sampledAt: number) => void;
  remoteRecognitionWarmTracePort?: RemoteRecognitionWarmTracePort;
  remoteRecognitionWarmTraceBuffTemporalPort?: RemoteRecognitionWarmTraceBuffTemporalPort;
  remoteRecognitionWarmTraceBuffSchedulerPort?: RemoteRecognitionWarmTraceBuffSchedulerPort;
  onMonitoringFrame?: (context: MonitoringFrameContext | null) => void;
}) {
  const decorateBuffSlotPhysicalSample = useMemo<
    BuffSlotPhysicalSampleDecorator | undefined
  >(() => {
    if (!remoteRecognitionWarmTracePort) {
      return undefined;
    }
    return (sample, { replacedSample, sampledAt }) => {
      let handle: RemoteRecognitionWarmTraceHandle | null = null;
      const replacedHandle =
        getRemoteRecognitionWarmTraceHandle(replacedSample);
      if (replacedHandle) {
        safelyReplaceWarmTraceCapture(
          remoteRecognitionWarmTracePort,
          replacedHandle,
        );
      }
      if (replacedSample === null) {
        try {
          handle = remoteRecognitionWarmTracePort.beginPhysicalSample();
        } catch {
          handle = null;
        }
      }
      try {
        const frame = sample();
        if (
          handle &&
          (!safelyBindWarmTracePhysicalSample(
            remoteRecognitionWarmTracePort,
            handle,
            sampledAt,
          ) ||
            !attachRemoteRecognitionWarmTraceHandle(frame, handle))
        ) {
          safelyTerminateWarmTraceCapture(
            remoteRecognitionWarmTracePort,
            handle,
          );
        }
        return frame;
      } catch (error) {
        if (handle) {
          safelyTerminateWarmTraceCapture(
            remoteRecognitionWarmTracePort,
            handle,
          );
        }
        throw error;
      }
    };
  }, [remoteRecognitionWarmTracePort]);
  const monitoringFrameBinding = useMemo(
    () =>
      createMonitoringFrameBinding({
        decorateBuffSlotPhysicalSample,
        getVideo: () => videoRef.current,
        getMasterVolume: () => profileRef.current.masterVolume,
        getGameViewport: () => gameViewport,
      }),
    [decorateBuffSlotPhysicalSample, gameViewport, profileRef, videoRef],
  );
  useEffect(() => {
    monitoringFrameBinding.reset();
  }, [monitoringFrameBinding, stream]);
  useEffect(() => {
    if (!remoteRecognitionWarmTracePort || !stream) {
      return;
    }
    return () => {
      try {
        remoteRecognitionWarmTracePort.cancelOpen("cancelled");
      } catch {
        // Instrumentation cleanup must not change monitoring teardown.
      }
    };
  }, [remoteRecognitionWarmTracePort, stream]);

  const shouldIncludeBuffSlotEvidenceSource = useCallback(
    (sampledAt: number) => {
      if (runtimeReportEvidenceCoordinator?.hasPending() === true) {
        return true;
      }
      const hasEnabledPrecisionSkill = profileRef.current.skills.some(
        (skill) =>
          skill.enabled && getSkillBuffDurationTargetForSkill(skill) !== null,
      );
      const shouldCaptureSkillMedia =
        hasEnabledPrecisionSkill &&
        shouldCaptureSkillIncidentPrecisionMedia({
          recorder: skillIncidentRecorderRef.current,
          sampledAt,
        });
      const shouldCaptureSpecialCoreMedia =
        profileRef.current.specialCoreAlert?.enabled === true &&
        shouldCaptureSpecialCoreIncidentMedia({
          recorder: specialCoreIncidentRecorderRef.current,
          sampledAt,
        });
      return shouldCaptureSkillMedia || shouldCaptureSpecialCoreMedia;
    },
    [
      profileRef,
      runtimeReportEvidenceCoordinator,
      skillIncidentRecorderRef,
      specialCoreIncidentRecorderRef,
    ],
  );

  const {
    getSharedBuffSlotAnalysis,
    precisionParserReadiness,
    precisionParserRuntimeSelection,
    precisionParserRuntimeKey,
    precisionParserCpuFallback,
    retryPrecisionParser,
    startPrecisionParserCpuFallback,
    cancelPrecisionParserCpuFallbackBenchmark,
    stopPrecisionParserCpuFallback,
    precisionParserInputTransportDiagnostics,
  } = useSharedBuffSlotAnalysis({
    stream,
    shouldIncludeEvidenceSource: shouldIncludeBuffSlotEvidenceSource,
    inputTransport: precisionParserInputTransport,
    remoteParserProvider,
    onRemoteParserUnavailable,
    remoteRecognitionWarmTracePort,
  });
  const processHuntStallSample = useHuntStallSampleLoop({
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
  });
  const runBuffExpirySample = useBuffExpirySampleLoop({
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
  });
  const { runBoosterExpirySample: processBoosterExpirySample } =
    useBoosterExpirySampleLoop({
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
    });
  const processSpecialCoreSample = useSpecialCoreSampleLoop({
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
  });
  const processSkillFrame = useSkillFrameLoop({
    stream,
    gameViewportRevision,
    profileRef,
    runtimeRef,
    skillIncidentRecorderRef,
    skillReportTimelineRef,
    lastAlertErrorRef,
    setRuntimeStates,
    setSnapshots,
    getSharedBuffSlotAnalysis,
    precisionParserRuntimeKey,
    runtimeReportEvidenceCoordinator,
    alertIncidentJournal,
    remoteRecognitionWarmTracePort,
    onMessage,
  });
  const processRuneFrame = useRuneFrameLoop({
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
  });
  const processUltimaRaidEquipmentFrame = useUltimaRaidEquipmentFrameLoop({
    stream,
    profileRef,
    runtimeRef: ultimaRaidEquipmentRuntimeRef,
    snapshotRef: ultimaRaidEquipmentSnapshotRef,
    incidentArchiveRef: ultimaRaidEquipmentIncidentArchiveRef,
    lastAlertErrorRef,
    setRuntime: setUltimaRaidEquipmentRuntime,
    setSnapshot: setUltimaRaidEquipmentSnapshot,
    onMessage,
    alertIncidentJournal,
  });

  const processSkillRuneFrame = useCallback(
    (sampledAt: number) => {
      const context = monitoringFrameBinding.getFrameContext(sampledAt);
      onMonitoringFrame?.(context);
      const result = runSkillRuneMonitoringFrame({
        context,
        handleMetadata,
        processSkillFrame,
        processRuneFrame,
      });
      if (typeof result !== "boolean" && typeof result.then === "function") {
        return result.then(() => undefined);
      }
      return undefined;
    },
    [
      handleMetadata,
      monitoringFrameBinding,
      onMonitoringFrame,
      processRuneFrame,
      processSkillFrame,
    ],
  );

  const runSpecialCoreSample = useCallback(
    (sampledAt: number) => {
      const context = monitoringFrameBinding.getFrameContext(sampledAt);
      return processSpecialCoreSample({
        sampledAt,
        context: context?.gameViewport ? context : null,
      });
    },
    [monitoringFrameBinding, processSpecialCoreSample],
  );

  const runUltimaRaidEquipmentSample = useCallback(
    (sampledAt: number) => {
      const context = monitoringFrameBinding.getFrameContext(sampledAt);
      if (!context) {
        return;
      }
      return processUltimaRaidEquipmentFrame({ context });
    },
    [monitoringFrameBinding, processUltimaRaidEquipmentFrame],
  );

  const runHuntStallSample = useCallback(
    (sampledAt: number) => {
      const context = monitoringFrameBinding.getFrameContext(sampledAt);
      return processHuntStallSample({
        sampledAt,
        context: context?.gameViewport ? context : null,
      });
    },
    [monitoringFrameBinding, processHuntStallSample],
  );

  const processBuffExpirySample = useCallback(
    (sampledAt: number) => {
      const context = monitoringFrameBinding.getFrameContext(sampledAt);
      return runBuffExpirySample({
        sampledAt,
        context: context?.gameViewport ? context : null,
      });
    },
    [monitoringFrameBinding, runBuffExpirySample],
  );

  const runBoosterExpirySample = useCallback(
    (sampledAt: number) => {
      const context = monitoringFrameBinding.getFrameContext(sampledAt);
      return processBoosterExpirySample({
        sampledAt,
        context: context?.gameViewport ? context : null,
      });
    },
    [monitoringFrameBinding, processBoosterExpirySample],
  );

  const jobs = useMemo(
    () =>
      createMonitoringJobs({
        processSkillRuneFrame,
        runUltimaRaidEquipmentSample,
        runHuntStallSample,
        runBuffExpirySample: processBuffExpirySample,
        runBoosterExpirySample,
        runSpecialCoreSample,
      }),
    [
      processSkillRuneFrame,
      runUltimaRaidEquipmentSample,
      processBuffExpirySample,
      runBoosterExpirySample,
      runHuntStallSample,
      runSpecialCoreSample,
    ],
  );

  useMonitoringScheduler({
    active: Boolean(stream),
    jobs,
    onInactive: onNoStream,
  });

  return {
    precisionParserReadiness,
    precisionParserRuntimeSelection,
    precisionParserCpuFallback,
    retryPrecisionParser,
    startPrecisionParserCpuFallback,
    cancelPrecisionParserCpuFallbackBenchmark,
    stopPrecisionParserCpuFallback,
    precisionParserInputTransportDiagnostics,
  };
}

function safelyBindWarmTracePhysicalSample(
  port: RemoteRecognitionWarmTracePort,
  handle: RemoteRecognitionWarmTraceHandle,
  sampledAt: number,
): boolean {
  try {
    return port.bindPhysicalSample(handle, sampledAt);
  } catch {
    return false;
  }
}

function safelyTerminateWarmTraceCapture(
  port: RemoteRecognitionWarmTracePort,
  handle: RemoteRecognitionWarmTraceHandle,
): void {
  try {
    port.terminateStage(handle, "captureCropUs", "failed");
  } catch {
    // Instrumentation must not replace the physical sampler result or error.
  }
}

function safelyReplaceWarmTraceCapture(
  port: RemoteRecognitionWarmTracePort,
  handle: RemoteRecognitionWarmTraceHandle,
): boolean {
  try {
    if (!port.getSeries(handle)) {
      return false;
    }
    port.replacePendingPhysicalSample(handle);
    return true;
  } catch {
    // Do not start a second trace while an earlier physical sample may be active.
    return true;
  }
}
