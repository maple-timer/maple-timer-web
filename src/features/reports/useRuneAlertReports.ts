import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type { RuneRuntimeState, RuneSnapshot } from "../../alertTypes";
import { captureSizeToLayoutKey, getSkillRegionForLayout, hasUsableRegion } from "../../lib/regions";
import { createDefaultRuneAlert } from "../../lib/storage";
import type {
  Profile,
  RuneAlertConfig,
} from "../../types";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import {
  createFrozenRuneIssueReportEvidence,
  type FrozenRuneIssueReportEvidence,
} from "./runeIssueReportEvidenceFreeze";
import {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";

export function useRuneAlertReports({
  videoRef,
  profileRef,
  runeRuntimeRef,
  runeSnapshotRef,
  currentLayoutKey,
  reportFrameSourceContext,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  runeRuntimeRef: MutableRefObject<RuneRuntimeState>;
  runeSnapshotRef: MutableRefObject<RuneSnapshot | null>;
  currentLayoutKey: string | null;
  reportFrameSourceContext?: ReportFrameSourceContext;
  onMessage: (message: string) => void;
}) {
  const [isRuneDebugSubmitting, setRuneDebugSubmitting] = useState(false);
  const [isRuneFalsePositiveSubmitting, setRuneFalsePositiveSubmitting] = useState(false);
  const frozenRuneIssueEvidenceRef = useRef<
    FrozenRuneIssueReportEvidence | undefined
  >(undefined);

  const createCurrentRuneIssueEvidence = useCallback(
    (capturedAt: number) => {
      const video = videoRef.current;
      const frameLayoutKey =
        video?.videoWidth && video.videoHeight
          ? captureSizeToLayoutKey({
              width: video.videoWidth,
              height: video.videoHeight,
            })
          : currentLayoutKey;
      const runeConfig =
        profileRef.current.runeAlert ?? createDefaultRuneAlert();
      return createFrozenRuneIssueReportEvidence({
        capturedAt,
        frameLayoutKey,
        currentRegion: getSkillRegionForLayout(runeConfig, frameLayoutKey),
        runeConfig,
        runtimeState: runeRuntimeRef.current,
        snapshot: runeSnapshotRef.current,
      });
    },
    [
      currentLayoutKey,
      profileRef,
      runeRuntimeRef,
      runeSnapshotRef,
      videoRef,
    ],
  );

  const freezeRuneIssueReportEvidence = useCallback(
    (capturedAt = Date.now()) => {
      frozenRuneIssueEvidenceRef.current =
        createCurrentRuneIssueEvidence(capturedAt);
    },
    [createCurrentRuneIssueEvidence],
  );

  const clearRuneIssueReportEvidence = useCallback(() => {
    frozenRuneIssueEvidenceRef.current = undefined;
  }, []);

  const submitRuneDebugSample = useCallback(async () => {
    const video = videoRef.current;
    if (
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      onMessage("화면 공유가 준비된 뒤 룬 디버그 샘플을 보낼 수 있습니다.");
      return;
    }

    const currentProfile = profileRef.current;
    const runeConfig = currentProfile.runeAlert ?? createDefaultRuneAlert();
    const frameLayoutKey = captureSizeToLayoutKey({
      width: video.videoWidth,
      height: video.videoHeight,
    });
    const runeRegion = getSkillRegionForLayout(runeConfig, frameLayoutKey);
    if (!hasUsableRegion(runeRegion)) {
      onMessage("미니맵 영역을 먼저 선택해주세요.");
      return;
    }

    setRuneDebugSubmitting(true);
    try {
      const [
        { buildRuneDebugReportPayload },
        { formatReportSuccessMessage, postDebugSample },
        { getViewportDiagnostics },
        { createRuneReportFrameSample },
      ] = await Promise.all([
        import("./alertReportPayloads"),
        import("./reportClient"),
        import("./reportDiagnostics"),
        import("./runeReportSnapshot"),
      ]);
      const frame = await createRuneReportFrameSample(video, runeRegion);

      if (!frame.sample.rawPreviewUrl || !frame.maskPreviewUrl) {
        throw new Error("디버그 이미지를 만들지 못했습니다.");
      }

      const data = await postDebugSample(
        buildRuneDebugReportPayload({
          submittedAt: new Date().toISOString(),
          url: window.location.href,
          viewportDiagnostics: getViewportDiagnostics(),
          captureSize: { width: video.videoWidth, height: video.videoHeight },
          layoutKey: frameLayoutKey,
          sample: frame.sample,
          maskPreviewUrl: frame.maskPreviewUrl,
          runeConfig,
          currentRegion: runeRegion,
          runeState: runeRuntimeRef.current,
          lastSnapshot: runeSnapshotRef.current,
          detection: frame.detection,
          candidatePreviewUrl: frame.candidatePreviewUrl,
        }),
        "룬 디버그 샘플 전송에 실패했습니다.",
      );

      onMessage(
        formatReportSuccessMessage(
          data,
          (id) => `룬 디버그 샘플을 보냈습니다. ID: ${id}`,
          "룬 디버그 샘플을 보냈습니다.",
        ),
      );
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "룬 디버그 샘플 전송에 실패했습니다.");
    } finally {
      setRuneDebugSubmitting(false);
    }
  }, [onMessage, profileRef, runeRuntimeRef, runeSnapshotRef, videoRef]);

  const submitRuneIssueReport = useCallback(async (
    issue: AlertIssueReportDetails,
    journalSelection: AlertIncidentJournalSelection | null = null,
  ) => {
    let snapshot = runeSnapshotRef.current;
    const frozenEvidence =
      frozenRuneIssueEvidenceRef.current ??
      createCurrentRuneIssueEvidence(Date.now());
    const lastAlertSnapshot = frozenEvidence.snapshot;
    const currentProfile = profileRef.current;
    const runeConfig: RuneAlertConfig = frozenEvidence.runeConfig;
    const unavailableMessage = getAlertIssueReportUnavailableMessage({
      profile: currentProfile,
      target: { kind: "rune" },
    });
    if (unavailableMessage) {
      onMessage(unavailableMessage);
      return false;
    }
    const video = videoRef.current;
    const [
      { buildRuneIssueReportPayload },
      { getOrCreateReportClientId, postDebugSample },
      {
        getCaptureDiagnostics,
        getVideoLayoutKey,
        getViewportDiagnostics,
      },
      { createRuneIssueReportSnapshot },
    ] = await Promise.all([
      import("./alertReportPayloads"),
      import("./reportClient"),
      import("./reportDiagnostics"),
      import("./runeReportSnapshot"),
    ]);
    const frameLayoutKey =
      frozenEvidence.frameLayoutKey ?? getVideoLayoutKey(video, currentLayoutKey);
    const diagnosticsContext =
      reportFrameSourceContext ??
      createLegacyReportFrameSourceContext(currentLayoutKey);
    const currentRegion = frozenEvidence.currentRegion;

    snapshot = await createRuneIssueReportSnapshot({
      existingSnapshot: snapshot,
      video,
      region: currentRegion,
      issueReason: issue.reason,
    });
    if (!snapshot?.rawPreviewUrl || !snapshot.maskPreviewUrl) {
      onMessage("화면 공유와 미니맵 영역이 준비된 뒤 제보할 수 있습니다.");
      return false;
    }

    setRuneFalsePositiveSubmitting(true);
    try {
      await postDebugSample(
        buildRuneIssueReportPayload({
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
          snapshot,
          lastAlertSnapshot,
          runeConfig,
          currentRegion,
          runeState: frozenEvidence.runtimeState,
          issue,
          journalSelection,
        }),
        "룬 감지 제보 전송에 실패했습니다.",
      );

      onMessage("제보를 보냈습니다.");
      return true;
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "룬 감지 제보 전송에 실패했습니다.");
      return false;
    } finally {
      setRuneFalsePositiveSubmitting(false);
    }
  }, [
    createCurrentRuneIssueEvidence,
    currentLayoutKey,
    onMessage,
    profileRef,
    reportFrameSourceContext,
    runeSnapshotRef,
    videoRef,
  ]);

  return {
    isRuneDebugSubmitting,
    isRuneFalsePositiveSubmitting,
    submitRuneDebugSample,
    submitRuneIssueReport,
    freezeRuneIssueReportEvidence,
    clearRuneIssueReportEvidence,
  };
}
