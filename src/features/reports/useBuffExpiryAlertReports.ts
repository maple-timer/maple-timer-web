import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import { createDefaultBuffExpiryAlert } from "../../lib/storage";
import type { BuffExpiryAlertConfig, Profile } from "../../types";
import type {
  RuntimeReportEvidenceCoordinator,
  RuntimeReportEvidenceEnvelope,
} from "../../contracts/reporting/runtimeReportEvidence";
import type { BuffExpiryRuntimeReportPayload } from "../../contracts/reporting/runtimeReportEvidencePayloads";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import { createBuffExpiryIncidentConfiguration } from "../../application/reporting/buffExpiryIncidentConfiguration";
import {
  createBuffExpiryIncidentFrozenState,
  recordBuffExpiryIncidentConfiguration,
  type BuffExpiryIncidentRuntimeRecorder,
} from "../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import { freezeBuffExpiryIncidentEvidence } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentEvidenceArchive";
import type { FrozenBuffExpiryIncidentEvidence } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentEvidenceTypes";
import { selectBuffExpiryReportIncident } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentEvidenceSelection";
import { createBuffExpiryIncidentReportEvidence } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentReportEvidence";
import {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";

type FrozenBuffExpiryIssueReportEvidence = {
  config: BuffExpiryAlertConfig;
  incident: FrozenBuffExpiryIncidentEvidence;
};

export function useBuffExpiryAlertReports({
  videoRef,
  profileRef,
  buffExpiryRuntimeRef,
  buffExpirySnapshotRef,
  buffExpiryIncidentRecorderRef,
  currentLayoutKey,
  reportFrameSourceContext,
  runtimeReportEvidenceCoordinator,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  buffExpiryRuntimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  buffExpirySnapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  buffExpiryIncidentRecorderRef: MutableRefObject<BuffExpiryIncidentRuntimeRecorder>;
  currentLayoutKey: string | null;
  reportFrameSourceContext?: ReportFrameSourceContext;
  runtimeReportEvidenceCoordinator: RuntimeReportEvidenceCoordinator;
  onMessage: (message: string) => void;
}) {
  const [isBuffExpiryIssueSubmitting, setBuffExpiryIssueSubmitting] = useState(false);
  const frozenBuffExpiryIssueEvidenceRef = useRef<
    FrozenBuffExpiryIssueReportEvidence | undefined
  >(undefined);

  const createCurrentBuffExpiryIssueEvidence = useCallback(
    (capturedAt: number): FrozenBuffExpiryIssueReportEvidence => {
      const currentProfile = profileRef.current;
      const currentConfig = cloneBuffExpiryAlertConfig(
        currentProfile.buffExpiryAlert ?? createDefaultBuffExpiryAlert(),
      );
      const incidentConfiguration = createBuffExpiryIncidentConfiguration(
        currentConfig,
        currentProfile.masterVolume,
      );
      const recorder = recordBuffExpiryIncidentConfiguration({
        previous: buffExpiryIncidentRecorderRef.current,
        capturedAt,
        configuration: incidentConfiguration,
      });
      buffExpiryIncidentRecorderRef.current = recorder;
      const latestFrame = [...recorder.archive.frames]
        .reverse()
        .find((frame) => frame.sampledAt <= capturedAt) ?? null;
      const frozenState = createBuffExpiryIncidentFrozenState({
        recorder,
        capturedAt,
        status: buffExpiryRuntimeRef.current.status,
        provider: latestFrame?.parser.provider ?? null,
      });
      return {
        config: currentConfig,
        incident: freezeBuffExpiryIncidentEvidence({
          archive: recorder.archive,
          capturedAt,
          frozenState,
        }),
      };
    },
    [buffExpiryIncidentRecorderRef, buffExpiryRuntimeRef, profileRef],
  );

  const freezeBuffExpiryIssueReportEvidence = useCallback(
    (capturedAt = Date.now()) => {
      frozenBuffExpiryIssueEvidenceRef.current =
        createCurrentBuffExpiryIssueEvidence(capturedAt);
    },
    [createCurrentBuffExpiryIssueEvidence],
  );

  const clearBuffExpiryIssueReportEvidence = useCallback(() => {
    frozenBuffExpiryIssueEvidenceRef.current = undefined;
  }, []);

  const submitBuffExpiryIssueReport = useCallback(async (
    issue: AlertIssueReportDetails,
    journalSelection: AlertIncidentJournalSelection | null = null,
  ) => {
    const video = videoRef.current;
    if (
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      onMessage("화면 공유가 준비된 뒤 제보할 수 있습니다.");
      return false;
    }

    const currentProfile = profileRef.current;
    const frozenEvidence =
      frozenBuffExpiryIssueEvidenceRef.current ??
      createCurrentBuffExpiryIssueEvidence(Date.now());
    const config = frozenEvidence.config;
    const unavailableMessage = getAlertIssueReportUnavailableMessage({
      profile: currentProfile,
      target: { kind: "buff-expiry" },
    });
    if (unavailableMessage) {
      onMessage(unavailableMessage);
      return false;
    }

    setBuffExpiryIssueSubmitting(true);
    try {
      const evidencePromise = runtimeReportEvidenceCoordinator.request<BuffExpiryRuntimeReportPayload>({
        feature: "buff-expiry",
      });
      const [
        { buildBuffExpiryIssueReportPayload },
        { getOrCreateReportClientId, postDebugSample },
        {
          getCaptureDiagnostics,
          getViewportDiagnostics,
        },
        runtimeEvidence,
      ] = await Promise.all([
        import("./alertReportPayloads"),
        import("./reportClient"),
        import("./reportDiagnostics"),
        evidencePromise,
      ]);
      const frameLayoutKey = currentLayoutKey;
      const diagnosticsContext =
        reportFrameSourceContext ??
        createLegacyReportFrameSourceContext(currentLayoutKey);
      const { snapshot, stateBefore, stateAfter } = runtimeEvidence.payload;
      const selection = selectBuffExpiryReportIncident({
        evidence: frozenEvidence.incident,
        reason: issue.reason,
        scenario: issue.scenario,
        occurrence: issue.occurrence,
        affectedTargetId: issue.affectedTarget?.id,
        otherCategory: issue.otherCategory,
      });
      const incidentEvidence = createBuffExpiryIncidentReportEvidence({
        evidence: frozenEvidence.incident,
        selection,
        reportSampledAt: runtimeEvidence.sampledAt,
      });

      await postDebugSample(
        buildBuffExpiryIssueReportPayload({
          submittedAt: new Date().toISOString(),
          url: window.location.href,
          clientId: getOrCreateReportClientId(),
          viewportDiagnostics: getViewportDiagnostics(),
          captureDiagnostics: getCaptureDiagnostics(
            video,
            diagnosticsContext,
            "game-viewport",
            frameLayoutKey,
          ),
          config,
          snapshot,
          state: stateAfter,
          stateBefore,
          runtimeEvidence: toBuffExpiryRuntimeEvidenceMetadata(runtimeEvidence),
          incidentEvidence,
          issue,
          journalSelection,
        }),
        "버프 종료 감지 제보 전송에 실패했습니다.",
      );

      buffExpirySnapshotRef.current = snapshot;
      onMessage("제보를 보냈습니다.");
      return true;
    } catch (error) {
      onMessage(getBuffExpiryReportErrorMessage(error));
      return false;
    } finally {
      setBuffExpiryIssueSubmitting(false);
    }
  }, [
    buffExpirySnapshotRef,
    createCurrentBuffExpiryIssueEvidence,
    currentLayoutKey,
    onMessage,
    profileRef,
    reportFrameSourceContext,
    runtimeReportEvidenceCoordinator,
    videoRef,
  ]);

  return {
    isBuffExpiryIssueSubmitting,
    submitBuffExpiryIssueReport,
    freezeBuffExpiryIssueReportEvidence,
    clearBuffExpiryIssueReportEvidence,
  };
}

function cloneBuffExpiryAlertConfig(
  config: BuffExpiryAlertConfig,
): BuffExpiryAlertConfig {
  return {
    ...config,
    selectedBuffIds: [...config.selectedBuffIds],
    selectedPrecisionTargetGroups: config.selectedPrecisionTargetGroups
      ? [...config.selectedPrecisionTargetGroups]
      : undefined,
  };
}

function toBuffExpiryRuntimeEvidenceMetadata(
  evidence: RuntimeReportEvidenceEnvelope<BuffExpiryRuntimeReportPayload>,
) {
  return {
    source: evidence.source,
    parser: evidence.parser,
    sampledAt: evidence.sampledAt,
  };
}

function getBuffExpiryReportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "runtime-report-evidence-timeout") {
    return "실제 버프 종료 감지 결과를 기다렸지만 새 프레임을 받지 못했습니다.";
  }
  return error instanceof Error ? error.message : "버프 종료 감지 제보 전송에 실패했습니다.";
}
