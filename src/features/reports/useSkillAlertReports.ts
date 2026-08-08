import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type {
  SkillReportTimeline,
  SkillSnapshot,
} from "../../alertTypes";
import type {
  Profile,
  SkillConfig,
  SkillRuntimeState,
} from "../../types";
import { getSkillBuffDurationTargetForSkill } from "../../lib/skillBuffDuration/skillBuffDurationTargets";
import type {
  RuntimeReportEvidenceCoordinator,
  RuntimeReportEvidenceEnvelope,
} from "../../contracts/reporting/runtimeReportEvidence";
import type { SkillBuffDurationRuntimeReportPayload } from "../../contracts/reporting/runtimeReportEvidencePayloads";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import { freezeSkillIncidentEvidence } from "../../runtime/skill-alert/evidence/skillIncidentEvidenceArchive";
import { selectSkillReportIncident } from "../../runtime/skill-alert/evidence/skillIncidentEvidenceSelection";
import { createSkillIncidentReportEvidence } from "../../runtime/skill-alert/evidence/skillIncidentReportEvidence";
import type { FrozenSkillIncidentEvidence } from "../../runtime/skill-alert/evidence/skillIncidentEvidenceTypes";
import type { SkillIncidentRuntimeRecorder } from "../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";
import {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";

type FrozenSkillIssueReportEvidence = {
  selectedSkillId: string;
  skills: SkillConfig[];
  incident: FrozenSkillIncidentEvidence;
};

export function useSkillAlertReports({
  videoRef,
  profileRef,
  runtimeRef,
  skillIncidentRecorderRef,
  skillReportTimelineRef,
  snapshots,
  currentLayoutKey,
  reportFrameSourceContext,
  runtimeReportEvidenceCoordinator,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  runtimeRef: MutableRefObject<Record<string, SkillRuntimeState>>;
  skillIncidentRecorderRef: MutableRefObject<SkillIncidentRuntimeRecorder>;
  skillReportTimelineRef: MutableRefObject<Record<string, SkillReportTimeline>>;
  snapshots: Record<string, SkillSnapshot>;
  currentLayoutKey: string | null;
  reportFrameSourceContext?: ReportFrameSourceContext;
  runtimeReportEvidenceCoordinator: RuntimeReportEvidenceCoordinator;
  onMessage: (message: string) => void;
}) {
  const [submittingSkillMisreadId, setSubmittingSkillMisreadId] = useState<string | null>(null);
  const frozenSkillIssueEvidenceRef = useRef<
    FrozenSkillIssueReportEvidence | undefined
  >(undefined);

  const createCurrentSkillIssueEvidence = useCallback(
    (
      skillId: string,
      capturedAt: number,
    ): FrozenSkillIssueReportEvidence | null => {
      const skills = profileRef.current.skills.map(cloneSkillConfig);
      if (!skills.some((skill) => skill.id === skillId)) {
        return null;
      }
      return {
        selectedSkillId: skillId,
        skills,
        incident: freezeSkillIncidentEvidence({
          archive: skillIncidentRecorderRef.current.archive,
          selectedSkillId: skillId,
          frozenAt: capturedAt,
        }),
      };
    },
    [profileRef, skillIncidentRecorderRef],
  );

  const freezeSkillIssueReportEvidence = useCallback(
    (skillId: string, capturedAt = Date.now()) => {
      frozenSkillIssueEvidenceRef.current =
        createCurrentSkillIssueEvidence(skillId, capturedAt) ?? undefined;
    },
    [createCurrentSkillIssueEvidence],
  );

  const clearSkillIssueReportEvidence = useCallback(() => {
    frozenSkillIssueEvidenceRef.current = undefined;
  }, []);

  const submitSkillIssueReport = useCallback(
    async (
      skillId: string,
      issue: AlertIssueReportDetails,
      journalSelection: AlertIncidentJournalSelection | null = null,
    ) => {
      const currentProfile = profileRef.current;
      const frozenEvidence =
        frozenSkillIssueEvidenceRef.current?.selectedSkillId === skillId
          ? frozenSkillIssueEvidenceRef.current
          : createCurrentSkillIssueEvidence(skillId, Date.now());
      const skill =
        frozenEvidence?.skills.find((item) => item.id === skillId) ?? null;
      if (!frozenEvidence || !skill) {
        onMessage("제보할 스킬을 찾지 못했습니다.");
        return false;
      }

      const unavailableMessage = getAlertIssueReportUnavailableMessage({
        profile: currentProfile,
        target: { kind: "skill", skillId: skill.id, skillName: skill.name },
      });
      if (unavailableMessage) {
        onMessage(unavailableMessage);
        return false;
      }

      const video = videoRef.current;
      const buffDurationTarget = getSkillBuffDurationTargetForSkill(skill);
      if (buffDurationTarget && !isVideoReady(video)) {
        onMessage("정밀 감지와 화면 공유가 켜진 상태에서 제보해주세요.");
        return false;
      }

      setSubmittingSkillMisreadId(skillId);
      try {
        const evidencePromise = buffDurationTarget
          ? runtimeReportEvidenceCoordinator.request<SkillBuffDurationRuntimeReportPayload>({
              feature: "skill-buff-duration",
              targetId: skillId,
            })
          : Promise.resolve(null);
        const [
          { buildSkillIssueReportPayload },
          { getOrCreateReportClientId, postDebugSample },
          {
            getCaptureDiagnostics,
            getViewportDiagnostics,
          },
          { createSkillIssueReportSnapshotContext },
          runtimeEvidence,
        ] = await Promise.all([
          import("./alertReportPayloads"),
          import("./reportClient"),
          import("./reportDiagnostics"),
          import("./skillReportSnapshot"),
          evidencePromise,
        ]);
        const frameLayoutKey = currentLayoutKey;
        const diagnosticsContext =
          reportFrameSourceContext ??
          createLegacyReportFrameSourceContext(currentLayoutKey);
        const reportProfile = {
          ...currentProfile,
          skills: frozenEvidence.skills,
        };
        const {
          currentRegion,
          snapshot,
          state,
          estimatedRemainingSeconds,
          alertInSeconds,
          relatedActiveSkills,
        } = await createSkillIssueReportSnapshotContext({
          profile: reportProfile,
          skillId,
          snapshots,
          runtimeStates: runtimeRef.current,
          video,
          layoutKey: frameLayoutKey,
          gameViewport: reportFrameSourceContext?.gameViewport,
          runtimeEvidence: runtimeEvidence?.payload ?? null,
          now: runtimeEvidence?.sampledAt,
        });

        if (!canSubmitSkillIssueReportSnapshot(snapshot)) {
          onMessage("화면 공유와 스킬 영역이 준비된 뒤 제보할 수 있습니다.");
          return false;
        }

        const incidentSelection = selectSkillReportIncident({
          evidence: frozenEvidence.incident,
          reason: issue.reason,
          scenario: issue.scenario,
          occurrence: issue.occurrence,
          selectedSkillId: skill.id,
          otherCategory: issue.otherCategory,
        });
        const skillEvidence = createSkillIncidentReportEvidence({
          evidence: frozenEvidence.incident,
          selection: incidentSelection,
          reportSampledAt: runtimeEvidence?.sampledAt ?? snapshot.sampledAt,
        });

        await postDebugSample(
          buildSkillIssueReportPayload({
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
            skill,
            currentRegion,
            snapshot,
            state,
            stateBefore: runtimeEvidence?.payload.stateBefore ?? null,
            runtimeTraceSample: runtimeEvidence?.payload.traceSample ?? null,
            estimatedRemainingSeconds,
            alertInSeconds,
            timeline:
              runtimeEvidence?.payload.timeline ??
              skillReportTimelineRef.current[skill.id] ??
              null,
            runtimeEvidence: toSkillRuntimeEvidenceMetadata(runtimeEvidence),
            skillEvidence,
            relatedActiveSkills,
            issue,
            journalSelection,
          }),
          "스킬 감지 제보 전송에 실패했습니다.",
        );

        onMessage("제보를 보냈습니다.");
        return true;
      } catch (error) {
        onMessage(getSkillReportErrorMessage(error));
        return false;
      } finally {
        setSubmittingSkillMisreadId(null);
      }
    },
    [
      currentLayoutKey,
      createCurrentSkillIssueEvidence,
      onMessage,
      profileRef,
      reportFrameSourceContext,
      runtimeRef,
      runtimeReportEvidenceCoordinator,
      skillReportTimelineRef,
      snapshots,
      videoRef,
    ],
  );

  return {
    submittingSkillMisreadId,
    submitSkillIssueReport,
    freezeSkillIssueReportEvidence,
    clearSkillIssueReportEvidence,
  };
}

function cloneSkillConfig(skill: SkillConfig): SkillConfig {
  return {
    ...skill,
    region: skill.region ? { ...skill.region } : null,
    regionsByLayout: skill.regionsByLayout
      ? Object.fromEntries(
          Object.entries(skill.regionsByLayout).map(([key, region]) => [
            key,
            { ...region },
          ]),
        )
      : undefined,
    repeat: skill.repeat ? { ...skill.repeat } : undefined,
  };
}

function toSkillRuntimeEvidenceMetadata(
  evidence: RuntimeReportEvidenceEnvelope<SkillBuffDurationRuntimeReportPayload> | null,
) {
  return evidence
    ? {
        source: evidence.source,
        parser: evidence.parser,
        sampledAt: evidence.sampledAt,
      }
    : null;
}

function isVideoReady(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return Boolean(
    video &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth &&
      video.videoHeight,
  );
}

function getSkillReportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "runtime-report-evidence-timeout") {
    return "실제 정밀 감지 결과를 기다렸지만 새 프레임을 받지 못했습니다.";
  }
  return error instanceof Error ? error.message : "스킬 감지 제보 전송에 실패했습니다.";
}

function canSubmitSkillIssueReportSnapshot(
  snapshot: SkillSnapshot | null,
): snapshot is SkillSnapshot {
  if (!snapshot) {
    return false;
  }
  if (snapshot.rawPreviewUrl && snapshot.previewUrl) {
    return true;
  }
  return Boolean(snapshot.rawPreviewUrl && snapshot.buffDuration);
}
