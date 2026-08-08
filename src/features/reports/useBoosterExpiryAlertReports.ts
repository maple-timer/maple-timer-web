import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../lib/boosterExpiry/boosterExpiryTypes";
import { createDefaultBoosterExpiryAlert } from "../../lib/storage";
import { applyMasterVolume } from "../../lib/volume";
import type { Profile } from "../../types";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import { freezeBoosterExpiryIncidentEvidence } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceArchive";
import { selectBoosterExpiryReportIncident } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceSelection";
import { createBoosterExpiryIncidentReportEvidence } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentReportEvidence";
import {
  createBoosterExpiryIncidentFrozenState,
  freezeBoosterExpiryIncidentRuntimeRecorder,
  recordBoosterExpiryIncidentConfigurationObserved,
  type BoosterExpiryIncidentRuntimeRecorder,
} from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import type {
  BoosterExpiryIncidentRelatedPlayback,
  BoosterExpiryIncidentTimerRead,
  FrozenBoosterExpiryIncidentEvidence,
} from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceTypes";
import type { BoosterExpiryIncidentReportEvidence } from "../../runtime/booster-expiry/evidence/boosterExpiryIncidentReportEvidence";
import {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";

type BoosterExpiryAlertConfig = NonNullable<Profile["boosterExpiryAlert"]>;

type FrozenBoosterExpiryIssueReportEvidence = {
  config: BoosterExpiryAlertConfig;
  state: BoosterExpiryRuntimeState;
  snapshot: BoosterExpirySnapshot | null;
  incident: FrozenBoosterExpiryIncidentEvidence | null;
};

export function useBoosterExpiryAlertReports({
  videoRef,
  profileRef,
  boosterExpiryRuntimeRef,
  boosterExpirySnapshotRef,
  boosterExpiryIncidentRecorderRef,
  currentLayoutKey,
  reportFrameSourceContext,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  boosterExpiryRuntimeRef: MutableRefObject<BoosterExpiryRuntimeState>;
  boosterExpirySnapshotRef: MutableRefObject<BoosterExpirySnapshot | null>;
  boosterExpiryIncidentRecorderRef: MutableRefObject<BoosterExpiryIncidentRuntimeRecorder>;
  currentLayoutKey: string | null;
  reportFrameSourceContext?: ReportFrameSourceContext;
  onMessage: (message: string) => void;
}) {
  const [isBoosterExpiryIssueSubmitting, setBoosterExpiryIssueSubmitting] = useState(false);
  const frozenBoosterExpiryIssueEvidenceRef = useRef<
    FrozenBoosterExpiryIssueReportEvidence | undefined
  >(undefined);

  const createCurrentBoosterExpiryIssueEvidence = useCallback(
    (
      capturedAt: number,
      journalSelection: AlertIncidentJournalSelection | null = null,
    ): FrozenBoosterExpiryIssueReportEvidence => {
      const currentProfile = profileRef.current;
      const config = cloneReportValue(
        currentProfile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert(),
      );
      const state = cloneReportValue(boosterExpiryRuntimeRef.current);
      const snapshot = boosterExpirySnapshotRef.current
        ? cloneReportValue(boosterExpirySnapshotRef.current)
        : null;
      const observed = recordBoosterExpiryIncidentConfigurationObserved({
        previous: boosterExpiryIncidentRecorderRef.current,
        configuration: {
          enabled: config.enabled,
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
      boosterExpiryIncidentRecorderRef.current = recorder;
      if (!recorder.boundary) {
        return {
          config,
          state,
          snapshot,
          incident: null,
        };
      }

      const frozen = freezeBoosterExpiryIncidentRuntimeRecorder({
        previous: recorder,
        frozenAt: capturedAt,
      });
      recorder = frozen.recorder;
      boosterExpiryIncidentRecorderRef.current = recorder;
      return {
        config,
        state,
        snapshot,
        incident: frozen.lease
          ? freezeBoosterExpiryIncidentEvidence({
              archive: recorder.archive,
              lease: frozen.lease,
              frozenState: createBoosterExpiryIncidentFrozenState({
                recorder,
                capturedAt,
                state,
              }),
              relatedPlayback: toBoosterExpiryRelatedPlayback(journalSelection),
            })
          : null,
      };
    },
    [
      boosterExpiryIncidentRecorderRef,
      boosterExpiryRuntimeRef,
      boosterExpirySnapshotRef,
      profileRef,
    ],
  );

  const freezeBoosterExpiryIssueReportEvidence = useCallback(
    (
      capturedAt = Date.now(),
      journalSelection: AlertIncidentJournalSelection | null = null,
    ) => {
      frozenBoosterExpiryIssueEvidenceRef.current =
        createCurrentBoosterExpiryIssueEvidence(capturedAt, journalSelection);
    },
    [createCurrentBoosterExpiryIssueEvidence],
  );

  const clearBoosterExpiryIssueReportEvidence = useCallback(() => {
    frozenBoosterExpiryIssueEvidenceRef.current = undefined;
  }, []);

  const submitBoosterExpiryIssueReport = useCallback(async (
    issue: AlertIssueReportDetails,
    journalSelection: AlertIncidentJournalSelection | null = null,
  ) => {
    const currentProfile = profileRef.current;
    const unavailableMessage = getAlertIssueReportUnavailableMessage({
      profile: currentProfile,
      target: { kind: "booster-expiry" },
    });
    if (unavailableMessage) {
      onMessage(unavailableMessage);
      return false;
    }

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

    setBoosterExpiryIssueSubmitting(true);
    try {
      const [
        { buildBoosterExpiryIssueReportPayload },
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
        frozenBoosterExpiryIssueEvidenceRef.current ??
        createCurrentBoosterExpiryIssueEvidence(Date.now(), journalSelection);
      const incidentEvidence = frozenEvidence.incident
        ? createBoosterExpiryIncidentReportEvidence({
            evidence: frozenEvidence.incident,
            selection: selectBoosterExpiryReportIncident({
              evidence: frozenEvidence.incident,
              reason: issue.reason,
              scenario: issue.scenario,
              occurrence: issue.occurrence,
              otherCategory: issue.otherCategory,
            }),
          })
        : null;
      const snapshot = createLegacyBoosterExpirySnapshot({
        frozenSnapshot: frozenEvidence.snapshot,
        incidentEvidence,
        frozenAt: frozenEvidence.incident?.frozenAt ?? Date.now(),
      });

      await postDebugSample(
        buildBoosterExpiryIssueReportPayload({
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
          snapshot,
          state: frozenEvidence.state,
          incidentEvidence,
          issue,
          journalSelection,
        }),
        "부스터 종료 감지 제보 전송에 실패했습니다.",
      );

      onMessage("제보를 보냈습니다.");
      return true;
    } catch (error) {
      onMessage(
        error instanceof Error ? error.message : "부스터 종료 감지 제보 전송에 실패했습니다.",
      );
      return false;
    } finally {
      setBoosterExpiryIssueSubmitting(false);
    }
  }, [
    boosterExpiryRuntimeRef,
    boosterExpirySnapshotRef,
    createCurrentBoosterExpiryIssueEvidence,
    currentLayoutKey,
    onMessage,
    profileRef,
    reportFrameSourceContext,
    videoRef,
  ]);

  return {
    isBoosterExpiryIssueSubmitting,
    submitBoosterExpiryIssueReport,
    freezeBoosterExpiryIssueReportEvidence,
    clearBoosterExpiryIssueReportEvidence,
  };
}

function toBoosterExpiryRelatedPlayback(
  selection: AlertIncidentJournalSelection | null,
): BoosterExpiryIncidentRelatedPlayback[] {
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
): BoosterExpiryIncidentRelatedPlayback["status"] {
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

function createLegacyBoosterExpirySnapshot({
  frozenSnapshot,
  incidentEvidence,
  frozenAt,
}: {
  frozenSnapshot: BoosterExpirySnapshot | null;
  incidentEvidence: BoosterExpiryIncidentReportEvidence | null;
  frozenAt: number;
}): BoosterExpirySnapshot {
  const selectedFrames = incidentEvidence
    ? [...incidentEvidence.frames].sort(
        (left, right) =>
          left.sampledAt - right.sampledAt || left.sequence - right.sequence,
      )
    : [];
  const selectedFrame = selectedFrames[selectedFrames.length - 1] ?? null;
  const selectedObservation = selectedFrame
    ? [...(incidentEvidence?.observations ?? [])]
        .reverse()
        .find((entry) => entry.frameId === selectedFrame.id) ?? null
    : null;
  const hasSelectedIncidentMedia = Boolean(incidentEvidence?.media.length);
  const rawTime = toLegacyBoosterExpiryTime(selectedObservation?.rawTime ?? null);
  const time = toLegacyBoosterExpiryTime(
    selectedObservation?.selectedTime ?? null,
  );
  const timerRect = selectedObservation
    ? {
        ok: Boolean(selectedObservation.timerRect),
        reason:
          selectedObservation.reason ?? selectedObservation.decision,
        rect: selectedObservation.timerRect,
        matchCount: selectedObservation.timerMatchCount,
        candidateCount: selectedObservation.timerCandidateCount,
      }
    : (frozenSnapshot?.timeRect ?? null);
  const flow = selectedObservation?.flow
    ? {
        ...selectedObservation.flow,
        timestampMs: selectedObservation.sampledAt,
      }
    : (frozenSnapshot?.flow ?? null);
  const performance =
    selectedObservation?.recognitionMs !== null &&
    selectedObservation?.recognitionMs !== undefined &&
    selectedObservation.totalMs !== null
      ? {
          recognitionMs: selectedObservation.recognitionMs,
          totalMs: selectedObservation.totalMs,
        }
      : (frozenSnapshot?.performance ?? null);

  return {
    sampledAt:
      selectedObservation?.sampledAt ??
      selectedFrame?.sampledAt ??
      frozenSnapshot?.sampledAt ??
      frozenAt,
    error:
      selectedFrame?.runtimeFailure?.technicalMessage ??
      frozenSnapshot?.error ??
      null,
    recognizerVersion:
      selectedObservation?.recognizerVersion ??
      frozenSnapshot?.recognizerVersion ??
      null,
    rawPreviewUrl: hasSelectedIncidentMedia
      ? null
      : (frozenSnapshot?.rawPreviewUrl ?? null),
    timerPreviewUrl: hasSelectedIncidentMedia
      ? null
      : (frozenSnapshot?.timerPreviewUrl ?? null),
    regionLabel:
      selectedFrame?.source?.regionLabel ??
      frozenSnapshot?.regionLabel ??
      null,
    rawTime: selectedObservation ? rawTime : (frozenSnapshot?.rawTime ?? null),
    time: selectedObservation ? time : (frozenSnapshot?.time ?? null),
    timeRect: timerRect,
    flow,
    performance,
    runtimeTrace: [],
    timerEvidence: [],
    confirmationEvidence: [],
    runtimeFailure: frozenSnapshot?.runtimeFailure ?? null,
  };
}

function toLegacyBoosterExpiryTime(
  value: BoosterExpiryIncidentTimerRead | null,
): BoosterExpirySnapshot["rawTime"] {
  if (!value) return null;
  return {
    ...value,
    format: normalizeLegacyBoosterExpiryFormat(value.format),
    selectedBy: value.selectedBy ?? undefined,
  };
}

function normalizeLegacyBoosterExpiryFormat(
  value: string | null,
): "mm:ss" | "m:ss" | "ss.cc" | "s.cc" | undefined {
  return value === "mm:ss" ||
    value === "m:ss" ||
    value === "ss.cc" ||
    value === "s.cc"
    ? value
    : undefined;
}
