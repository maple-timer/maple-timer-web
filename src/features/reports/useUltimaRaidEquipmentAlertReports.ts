import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import { createDefaultUltimaRaidEquipmentAlert } from "../../lib/storage";
import { encodeUltimaRaidEquipmentEvidenceFrame } from "../../platform/frame-capture/ultima-raid-equipment/ultimaRaidEquipmentEvidenceCapture";
import {
  addUltimaRaidEquipmentReportOpenMedia,
  createUltimaRaidEquipmentIncidentReportEvidence,
  freezeUltimaRaidEquipmentIncidentEvidence,
  type FrozenUltimaRaidEquipmentIncidentEvidence,
  type UltimaRaidAlertTarget,
  type UltimaRaidEquipmentIncidentArchive,
} from "../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import type { UltimaRaidEquipmentRuntimeState } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { Profile, UltimaRaidEquipmentAlertConfig } from "../../types";
import type { UltimaRaidEquipmentSnapshot } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";

type FrozenUltimaRaidEquipmentIssueReportEvidence = {
  target: UltimaRaidAlertTarget;
  config: UltimaRaidEquipmentAlertConfig;
  state: UltimaRaidEquipmentRuntimeState;
  snapshot: UltimaRaidEquipmentSnapshot | null;
  incident: FrozenUltimaRaidEquipmentIncidentEvidence;
};

export function useUltimaRaidEquipmentAlertReports({
  videoRef,
  profileRef,
  runtimeRef,
  snapshotRef,
  incidentArchiveRef,
  currentLayoutKey,
  reportFrameSourceContext,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  runtimeRef: MutableRefObject<UltimaRaidEquipmentRuntimeState>;
  snapshotRef: MutableRefObject<UltimaRaidEquipmentSnapshot | null>;
  incidentArchiveRef: MutableRefObject<UltimaRaidEquipmentIncidentArchive>;
  currentLayoutKey: string | null;
  reportFrameSourceContext?: ReportFrameSourceContext;
  onMessage: (message: string) => void;
}) {
  const [submittingTarget, setSubmittingTarget] =
    useState<UltimaRaidAlertTarget | null>(null);
  const frozenEvidenceRef = useRef<
    FrozenUltimaRaidEquipmentIssueReportEvidence | undefined
  >(undefined);

  const createCurrentEvidence = useCallback(
    (
      capturedAt: number,
      target: UltimaRaidAlertTarget,
    ): FrozenUltimaRaidEquipmentIssueReportEvidence => {
      const snapshot = snapshotRef.current;
      const latestRuntimeMedia = snapshot?.previewImageData
        ? encodeUltimaRaidEquipmentEvidenceFrame(snapshot.previewImageData)
        : null;
      const archive = addUltimaRaidEquipmentReportOpenMedia({
        previous: incidentArchiveRef.current,
        capturedAt,
        frameSampledAt:
          snapshot?.previewSampledAt ?? snapshot?.sampledAt ?? capturedAt,
        dataUrl: latestRuntimeMedia,
      });
      incidentArchiveRef.current = archive;
      return {
        target,
        config: structuredClone(
          profileRef.current.ultimaRaidEquipmentAlert ??
            createDefaultUltimaRaidEquipmentAlert(),
        ),
        state: structuredClone(runtimeRef.current),
        snapshot: snapshot
          ? {
              ...structuredClone(snapshot),
              previewImageData: null,
            }
          : null,
        incident: freezeUltimaRaidEquipmentIncidentEvidence({
          archive,
          frozenAt: capturedAt,
        }),
      };
    },
    [incidentArchiveRef, profileRef, runtimeRef, snapshotRef],
  );

  const freezeUltimaRaidEquipmentIssueReportEvidence = useCallback(
    (capturedAt = Date.now()) => {
      frozenEvidenceRef.current = createCurrentEvidence(
        capturedAt,
        "equipment",
      );
    },
    [createCurrentEvidence],
  );

  const freezeUltimaRaidBossIssueReportEvidence = useCallback(
    (capturedAt = Date.now()) => {
      frozenEvidenceRef.current = createCurrentEvidence(capturedAt, "boss");
    },
    [createCurrentEvidence],
  );

  const clearUltimaRaidEquipmentIssueReportEvidence = useCallback(() => {
    frozenEvidenceRef.current = undefined;
  }, []);

  const submitUltimaRaidIssueReport = useCallback(
    async (
      target: UltimaRaidAlertTarget,
      issue: AlertIssueReportDetails,
      journalSelection: AlertIncidentJournalSelection | null = null,
    ) => {
      const unavailableMessage = getAlertIssueReportUnavailableMessage({
        profile: profileRef.current,
        target: {
          kind:
            target === "boss"
              ? "ultima-raid-boss"
              : "ultima-raid-equipment",
        },
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

      setSubmittingTarget(target);
      try {
        const [
          { buildUltimaRaidEquipmentIssueReportPayload },
          { getOrCreateReportClientId, postDebugSample },
          {
            getCaptureDiagnostics,
            getVideoLayoutKey,
            getViewportDiagnostics,
          },
        ] = await Promise.all([
          import("./alertReportPayloads"),
          import("./reportClient"),
          import("./reportDiagnostics"),
        ]);
        const frozen =
          frozenEvidenceRef.current?.target === target
            ? frozenEvidenceRef.current
            : createCurrentEvidence(Date.now(), target);
        const incidentEvidence =
          createUltimaRaidEquipmentIncidentReportEvidence({
            frozen: frozen.incident,
            occurrence: issue.occurrence ?? "current",
            scenario: issue.scenario ?? "other",
            target,
          });
        const frameLayoutKey = getVideoLayoutKey(video, currentLayoutKey);
        const diagnosticsContext =
          reportFrameSourceContext ??
          createLegacyReportFrameSourceContext(currentLayoutKey);
        await postDebugSample(
          buildUltimaRaidEquipmentIssueReportPayload({
            submittedAt: new Date().toISOString(),
            url: window.location.href,
            clientId: getOrCreateReportClientId(),
            viewportDiagnostics: getViewportDiagnostics(),
            captureDiagnostics: getCaptureDiagnostics(
              video,
              diagnosticsContext,
              "capture",
              frameLayoutKey,
            ),
            config: frozen.config,
            state: frozen.state,
            snapshot: frozen.snapshot,
            incidentEvidence,
            issue,
            target,
            journalSelection,
          }),
          target === "boss"
            ? "울티마 스쿼드 보스 감지 제보 전송에 실패했습니다."
            : "울티마 스쿼드 장비 감지 제보 전송에 실패했습니다.",
        );
        onMessage("제보를 보냈습니다.");
        return true;
      } catch (error) {
        onMessage(
          error instanceof Error
            ? error.message
            : target === "boss"
              ? "울티마 스쿼드 보스 감지 제보 전송에 실패했습니다."
              : "울티마 스쿼드 장비 감지 제보 전송에 실패했습니다.",
        );
        return false;
      } finally {
        setSubmittingTarget(null);
      }
    },
    [
      createCurrentEvidence,
      currentLayoutKey,
      onMessage,
      profileRef,
      reportFrameSourceContext,
      videoRef,
    ],
  );

  const submitUltimaRaidEquipmentIssueReport = useCallback(
    (
      issue: AlertIssueReportDetails,
      journalSelection: AlertIncidentJournalSelection | null = null,
    ) => submitUltimaRaidIssueReport("equipment", issue, journalSelection),
    [submitUltimaRaidIssueReport],
  );

  const submitUltimaRaidBossIssueReport = useCallback(
    (
      issue: AlertIssueReportDetails,
      journalSelection: AlertIncidentJournalSelection | null = null,
    ) => submitUltimaRaidIssueReport("boss", issue, journalSelection),
    [submitUltimaRaidIssueReport],
  );

  return {
    isUltimaRaidEquipmentIssueSubmitting: submittingTarget === "equipment",
    isUltimaRaidBossIssueSubmitting: submittingTarget === "boss",
    submitUltimaRaidEquipmentIssueReport,
    submitUltimaRaidBossIssueReport,
    freezeUltimaRaidEquipmentIssueReportEvidence,
    freezeUltimaRaidBossIssueReportEvidence,
    clearUltimaRaidEquipmentIssueReportEvidence,
  };
}
