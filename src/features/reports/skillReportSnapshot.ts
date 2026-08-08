import type { SkillSnapshot } from "../../alertTypes";
import { sampleSkill } from "../../lib/capture";
import { getRecognitionEngine } from "../../lib/recognition";
import { getSkillRegionForLayout, hasUsableRegion } from "../../lib/regions";
import { getSkillBuffDurationTargetForSkill } from "../../lib/skillBuffDuration/skillBuffDurationTargets";
import {
  createRuntimeState,
  getEstimatedRemainingSeconds,
  getSkillAlertInSeconds,
} from "../../lib/timer";
import type {
  Profile,
  RelativeRegion,
  SkillConfig,
  SkillRuntimeState,
} from "../../types";
import type { SkillBuffDurationRuntimeReportPayload } from "../../contracts/reporting/runtimeReportEvidencePayloads";
import type { ResolvedGameViewport } from "../../contracts/geometry/frameSource";
import { sampleGameViewportSkill } from "../../platform/frame-capture/gameViewportSampling";

export type SkillIssueReportSnapshotContext = {
  skill: SkillConfig | null;
  currentRegion: RelativeRegion | null;
  snapshot: SkillSnapshot | null;
  state: SkillRuntimeState;
  estimatedRemainingSeconds: number | null;
  alertInSeconds: number | null;
  relatedActiveSkills: SkillConfig[];
};

export async function createSkillIssueReportSnapshotContext({
  profile,
  skillId,
  snapshots,
  runtimeStates,
  video,
  layoutKey,
  gameViewport,
  runtimeEvidence = null,
  now = Date.now(),
}: {
  profile: Profile;
  skillId: string;
  snapshots: Record<string, SkillSnapshot>;
  runtimeStates: Record<string, SkillRuntimeState>;
  video: HTMLVideoElement | null;
  layoutKey: string | null;
  gameViewport?: ResolvedGameViewport | null;
  runtimeEvidence?: SkillBuffDurationRuntimeReportPayload | null;
  now?: number;
}): Promise<SkillIssueReportSnapshotContext> {
  const skill = profile.skills.find((item) => item.id === skillId) ?? null;
  let snapshot: SkillSnapshot | null = snapshots[skillId] ?? null;
  const state = runtimeEvidence?.stateAfter ?? runtimeStates[skillId] ?? createRuntimeState(skillId);
  const currentRegion = skill ? getSkillRegionForLayout(skill, layoutKey) : null;
  const buffDurationTarget = skill ? getSkillBuffDurationTargetForSkill(skill) : null;

  if (buffDurationTarget) {
    snapshot = runtimeEvidence?.snapshot ?? null;
  } else if ((!snapshot?.rawPreviewUrl || !snapshot.previewUrl) && hasUsableRegion(currentRegion)) {
    if (canSampleVideo(video) && gameViewport !== null) {
      const sample = gameViewport
        ? sampleGameViewportSkill(video, gameViewport, currentRegion, true)
        : sampleSkill(video, currentRegion, true);
      snapshot = {
        result: getRecognitionEngine().recognize(sample.imageData),
        sampledAt: now,
        rawPreviewUrl: sample.rawPreviewUrl,
        previewUrl: sample.previewUrl,
        regionLabel: `${sample.region.width}x${sample.region.height}`,
      };
    }
  }

  const estimatedRemainingSeconds = getEstimatedRemainingSeconds(state, now);
  const alertInSeconds = !skill ? null : getSkillAlertInSeconds(state, skill, now);
  const relatedActiveSkills = skill ? getRelatedActiveSkills(profile.skills, skill) : [];

  return {
    skill,
    currentRegion,
    snapshot,
    state,
    estimatedRemainingSeconds,
    alertInSeconds,
    relatedActiveSkills,
  };
}

function canSampleVideo(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return Boolean(
    video &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth &&
      video.videoHeight,
  );
}

function getRelatedActiveSkills(skills: SkillConfig[], skill: SkillConfig): SkillConfig[] {
  const normalizedSkillName = skill.name.replace(/\s+/g, "");
  return skills.filter(
    (item) => item.enabled && item.name.replace(/\s+/g, "") === normalizedSkillName,
  );
}
