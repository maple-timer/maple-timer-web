import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
} from "../../alertTypes";
import { sampleSkill } from "../../lib/capture";
import { sampleManualExperienceFromVideo } from "../../lib/huntStallManualExperienceSampling";
import { getRecognitionEngine } from "../../lib/recognition";
import {
  captureSizeToLayoutKey,
  getSkillRegionForLayout,
  hasUsableRegion,
} from "../../lib/regions";
import type { HuntStallAlertConfig } from "../../types";
import type { ResolvedGameViewport } from "../../contracts/geometry/frameSource";
import { sampleGameViewportSkill } from "../../platform/frame-capture/gameViewportSampling";

export async function createHuntStallReportSnapshot({
  config,
  layoutKey,
  state,
  video,
  gameViewport,
}: {
  config: HuntStallAlertConfig;
  layoutKey: string | null;
  state: HuntStallRuntimeState;
  video: HTMLVideoElement;
  gameViewport?: ResolvedGameViewport | null;
}): Promise<HuntStallSnapshot> {
  if (gameViewport === null) {
    throw new Error("게임 영역을 먼저 설정해주세요.");
  }

  if (config.mode === "cooldown-presence") {
    const currentRegion = getSkillRegionForLayout(
      {
        region: config.cooldownRegion,
        regionsByLayout: config.cooldownRegionsByLayout,
      },
      layoutKey,
    );
    if (!hasUsableRegion(currentRegion)) {
      throw new Error("쿨타임 숫자 감시 영역을 먼저 선택해주세요.");
    }

    const sample = gameViewport
      ? sampleGameViewportSkill(video, gameViewport, currentRegion, true)
      : sampleSkill(video, currentRegion, true);
    const result = getRecognitionEngine().recognize(sample.imageData);

    return {
      sampledAt: Date.now(),
      rawPreviewUrl: sample.rawPreviewUrl,
      processedPreviewUrl: sample.previewUrl,
      mode: "cooldown-presence",
      regionLabel: `${sample.region.width}x${sample.region.height}`,
      recognizedText:
        result.value !== null ? String(result.value) : result.debug?.recognizedText ?? null,
      debugText: result.debug?.reason,
      confidence: result.confidence,
      foregroundRatio: result.debug?.foregroundRatio ?? 0,
      changeScore: state.changeScore,
      performance: null,
    };
  }

  const currentRegion = getSkillRegionForLayout(
    {
      region: config.manualExperienceRegion ?? null,
      regionsByLayout: config.manualExperienceRegionsByLayout,
    },
    layoutKey ??
      captureSizeToLayoutKey({
        width: video.videoWidth,
        height: video.videoHeight,
      }),
  );
  if (!hasUsableRegion(currentRegion)) {
    throw new Error("경험치바 높이를 먼저 선택해주세요.");
  }

  const sample = sampleManualExperienceFromVideo({
    video,
    region: currentRegion,
    includePreview: true,
    includeReportDiagnostics: true,
    sourceRegion:
      gameViewport?.mode === "calibrated"
        ? gameViewport.region
        : undefined,
  });
  return {
    ...sample.snapshot,
    mode: "manual-experience",
    changeScore: state.changeScore,
  };
}
