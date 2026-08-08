import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type {
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../lib/specialCore";
import { createDefaultSpecialCoreAlert } from "../../lib/storage";
import { applyMasterVolume } from "../../lib/volume";
import type { Profile } from "../../types";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import { freezeSpecialCoreIncidentBoundary } from "../../runtime/special-core/evidence/specialCoreIncidentBoundary";
import { freezeSpecialCoreIncidentEvidence } from "../../runtime/special-core/evidence/specialCoreIncidentEvidenceArchive";
import { selectSpecialCoreReportIncident } from "../../runtime/special-core/evidence/specialCoreIncidentEvidenceSelection";
import { createSpecialCoreIncidentReportEvidence } from "../../runtime/special-core/evidence/specialCoreIncidentReportEvidence";
import {
  createSpecialCoreIncidentFrozenState,
  recordSpecialCoreIncidentConfigurationObserved,
  type SpecialCoreIncidentRuntimeRecorder,
} from "../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import type {
  FrozenSpecialCoreIncidentEvidence,
  SpecialCoreIncidentRelatedPlayback,
} from "../../runtime/special-core/evidence/specialCoreIncidentEvidenceTypes";
import {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";

type SpecialCoreAlertConfig = NonNullable<Profile["specialCoreAlert"]>;

type FrozenSpecialCoreIssueReportEvidence = {
  config: SpecialCoreAlertConfig;
  state: SpecialCoreRuntimeState;
  snapshot: SpecialCoreSnapshot | null;
  incident: FrozenSpecialCoreIncidentEvidence | null;
};

export function useSpecialCoreAlertReports({
  videoRef,
  profileRef,
  specialCoreRuntimeRef,
  specialCoreSnapshotRef,
  specialCoreIncidentRecorderRef,
  currentLayoutKey,
  reportFrameSourceContext,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  specialCoreRuntimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  specialCoreSnapshotRef: MutableRefObject<SpecialCoreSnapshot | null>;
  specialCoreIncidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
  currentLayoutKey: string | null;
  reportFrameSourceContext?: ReportFrameSourceContext;
  onMessage: (message: string) => void;
}) {
  const [isSpecialCoreIssueSubmitting, setSpecialCoreIssueSubmitting] =
    useState(false);
  const frozenSpecialCoreIssueEvidenceRef = useRef<
    FrozenSpecialCoreIssueReportEvidence | undefined
  >(undefined);

  const createCurrentSpecialCoreIssueEvidence = useCallback(
    (
      capturedAt: number,
      journalSelection: AlertIncidentJournalSelection | null = null,
    ): FrozenSpecialCoreIssueReportEvidence => {
      const currentProfile = profileRef.current;
      const config = cloneReportValue(
        currentProfile.specialCoreAlert ?? createDefaultSpecialCoreAlert(),
      );
      const state = cloneReportValue(specialCoreRuntimeRef.current);
      const snapshot = specialCoreSnapshotRef.current
        ? cloneReportValue(specialCoreSnapshotRef.current)
        : null;
      const observed = recordSpecialCoreIncidentConfigurationObserved({
        previous: specialCoreIncidentRecorderRef.current,
        configuration: {
          enabled: config.enabled,
          cooldownSeconds: config.cooldownSeconds,
          alertLeadSeconds: config.alertLeadSeconds,
          soundId: config.soundId,
          featureVolume: config.volume,
          masterVolume: currentProfile.masterVolume,
          effectiveVolume: applyMasterVolume(
            config.volume,
            currentProfile.masterVolume,
          ),
        },
        occurredAt: capturedAt,
      });
      let recorder = observed.recorder;
      specialCoreIncidentRecorderRef.current = recorder;
      if (!recorder.boundary) {
        return { config, state, snapshot, incident: null };
      }

      const frozenBoundary = freezeSpecialCoreIncidentBoundary({
        previous: recorder.boundary,
        frozenAt: capturedAt,
      });
      recorder = {
        ...recorder,
        boundary: frozenBoundary.state,
      };
      specialCoreIncidentRecorderRef.current = recorder;

      return {
        config,
        state,
        snapshot,
        incident: freezeSpecialCoreIncidentEvidence({
          archive: recorder.archive,
          lease: frozenBoundary.lease,
          frozenState: createSpecialCoreIncidentFrozenState({
            recorder,
            capturedAt,
            state,
          }),
          relatedPlayback: toSpecialCoreRelatedPlayback(journalSelection),
        }),
      };
    },
    [
      profileRef,
      specialCoreIncidentRecorderRef,
      specialCoreRuntimeRef,
      specialCoreSnapshotRef,
    ],
  );

  const freezeSpecialCoreIssueReportEvidence = useCallback(
    (
      capturedAt = Date.now(),
      journalSelection: AlertIncidentJournalSelection | null = null,
    ) => {
      frozenSpecialCoreIssueEvidenceRef.current =
        createCurrentSpecialCoreIssueEvidence(capturedAt, journalSelection);
    },
    [createCurrentSpecialCoreIssueEvidence],
  );

  const clearSpecialCoreIssueReportEvidence = useCallback(() => {
    frozenSpecialCoreIssueEvidenceRef.current = undefined;
  }, []);

  const submitSpecialCoreIssueReport = useCallback(
    async (
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
      const unavailableMessage = getAlertIssueReportUnavailableMessage({
        profile: currentProfile,
        target: { kind: "special-core" },
      });
      if (unavailableMessage) {
        onMessage(unavailableMessage);
        return false;
      }

      setSpecialCoreIssueSubmitting(true);
      try {
        const [
          { buildSpecialCoreIssueReportPayload },
          { getOrCreateReportClientId, postDebugSample },
          {
            getCaptureDiagnostics,
            getViewportDiagnostics,
          },
        ] = await Promise.all([
          import("./alertReportPayloads"),
          import("./reportClient"),
          import("./reportDiagnostics"),
        ]);
        const frameLayoutKey = currentLayoutKey;
        const diagnosticsContext =
          reportFrameSourceContext ??
          createLegacyReportFrameSourceContext(currentLayoutKey);
        const frozenEvidence =
          frozenSpecialCoreIssueEvidenceRef.current ??
          createCurrentSpecialCoreIssueEvidence(Date.now(), journalSelection);
        const incidentEvidence = frozenEvidence.incident
          ? createSpecialCoreIncidentReportEvidence({
              evidence: frozenEvidence.incident,
              selection: selectSpecialCoreReportIncident({
                evidence: frozenEvidence.incident,
                reason: issue.reason,
                scenario: issue.scenario,
                occurrence: issue.occurrence,
                otherCategory: issue.otherCategory,
              }),
            })
          : null;

        await postDebugSample(
          buildSpecialCoreIssueReportPayload({
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
            config: frozenEvidence.config,
            snapshot: frozenEvidence.snapshot,
            state: frozenEvidence.state,
            incidentEvidence,
            issue,
            journalSelection,
          }),
          "특수코어 감지 제보 전송에 실패했습니다.",
        );

        onMessage("제보를 보냈습니다.");
        return true;
      } catch (error) {
        onMessage(
          error instanceof Error
            ? error.message
            : "특수코어 감지 제보 전송에 실패했습니다.",
        );
        return false;
      } finally {
        setSpecialCoreIssueSubmitting(false);
      }
    },
    [
      createCurrentSpecialCoreIssueEvidence,
      currentLayoutKey,
      onMessage,
      profileRef,
      reportFrameSourceContext,
      videoRef,
    ],
  );

  return {
    isSpecialCoreIssueSubmitting,
    submitSpecialCoreIssueReport,
    freezeSpecialCoreIssueReportEvidence,
    clearSpecialCoreIssueReportEvidence,
  };
}

function toSpecialCoreRelatedPlayback(
  selection: AlertIncidentJournalSelection | null,
): SpecialCoreIncidentRelatedPlayback[] {
  return (selection?.relatedPlaybackEntries ?? [])
    .filter((entry) => entry.kind === "playback")
    .map((entry) => {
      const status = normalizePlaybackStatus(entry.status);
      const requestedAt =
        getFiniteNumber(entry.details.requestedAt) ?? entry.occurredAt;
      const browserAcceptedAt =
        getFiniteNumber(entry.details.browserAcceptedAt) ??
        getFiniteNumber(entry.details.startedAt) ??
        (status === "browser-play-accepted" || status === "finished"
          ? entry.occurredAt
          : null);
      return {
        id: entry.id,
        feature: entry.feature,
        requestedAt,
        browserAcceptedAt,
        finishedAt:
          getFiniteNumber(entry.details.finishedAt) ??
          (status === "finished" ? entry.occurredAt : null),
        failedAt:
          getFiniteNumber(entry.details.failedAt) ??
          (status === "failed" ? entry.occurredAt : null),
        status,
      };
    });
}

function normalizePlaybackStatus(
  status: string | null,
): SpecialCoreIncidentRelatedPlayback["status"] {
  if (status === "started" || status === "browser-play-accepted") {
    return "browser-play-accepted";
  }
  return status === "finished" || status === "failed" ? status : "requested";
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cloneReportValue<T>(value: T): T {
  return structuredClone(value);
}
