import type { RgbaImageSnapshot } from "../../../alertTypes";
import { cloneImageDataSnapshot } from "../../../lib/imageDataSnapshot";
import { getSkillRegionForLayout, hasUsableRegion } from "../../../lib/regions";
import { createDefaultUltimaRaidEquipmentAlert } from "../../../lib/storage";
import {
  detectUltimaRaidInventoryFull,
  type UltimaRaidInventoryFullDetection,
} from "../../../recognition/ultima-raid-equipment/inventoryFullDetector";
import {
  detectUltimaRaidBossEncounter,
  type UltimaRaidBossDetection,
} from "../../../recognition/ultima-raid-equipment/bossEncounterDetector";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import {
  markUltimaRaidEquipmentRuntimeUnavailable,
  updateUltimaRaidEquipmentRuntimeState,
  type UltimaRaidEquipmentRuntimeState,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import {
  markUltimaRaidBossRuntimeUnavailable,
  updateUltimaRaidBossRuntimeState,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidBossAlertState";
import type { UltimaRaidEquipmentSnapshot } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import type { Profile } from "../../../types";

const LIVE_PREVIEW_INTERVAL_MS = 2_000;
const SAMPLE_MAX_WIDTH = 480;
const FRAME_READ_ERROR_MESSAGE =
  "울티마 스쿼드 화면 감지 영역을 읽지 못했습니다.";

export type UltimaRaidEquipmentFrameProcessResult = {
  state: UltimaRaidEquipmentRuntimeState;
  snapshot: UltimaRaidEquipmentSnapshot | null;
  evidenceImageData: ImageData | null;
  shouldAlert: boolean;
  bossShouldAlert: boolean;
  soundId: string;
  volume: number;
  bossSoundId: string;
  bossVolume: number;
  errorMessage: string | null;
};

export function processUltimaRaidEquipmentFrame({
  context,
  profile,
  previousState,
  previousSnapshot,
}: {
  context: MonitoringFrameContext;
  profile: Profile;
  previousState: UltimaRaidEquipmentRuntimeState;
  previousSnapshot: UltimaRaidEquipmentSnapshot | null;
}): UltimaRaidEquipmentFrameProcessResult {
  const config =
    profile.ultimaRaidEquipmentAlert ?? createDefaultUltimaRaidEquipmentAlert();
  const region = getSkillRegionForLayout(config, context.frameLayoutKey);
  const hasRegion = hasUsableRegion(region);
  const anyEnabled = config.enabled || config.bossAlert.enabled;

  if (!anyEnabled || !hasRegion) {
    const equipmentUpdate = updateUltimaRaidEquipmentRuntimeState({
      previous: previousState,
      detection: null,
      now: context.sampledAt,
      enabled: config.enabled,
      hasStream: true,
      hasRegion,
    });
    const bossUpdate = updateUltimaRaidBossRuntimeState({
      previous: previousState.boss,
      detection: null,
      now: context.sampledAt,
      enabled: config.bossAlert.enabled,
      hasStream: true,
      hasRegion,
    });
    return {
      state: {
        ...equipmentUpdate.state,
        boss: bossUpdate.state,
      },
      snapshot: null,
      evidenceImageData: null,
      shouldAlert: false,
      bossShouldAlert: false,
      soundId: config.soundId,
      volume: config.volume,
      bossSoundId: config.bossAlert.soundId,
      bossVolume: config.bossAlert.volume,
      errorMessage: null,
    };
  }

  try {
    const sample = context.sampleVideoRegion(region, false, SAMPLE_MAX_WIDTH);
    const detection = detectUltimaRaidInventoryFull(sample.imageData);
    const bossDetection = detectUltimaRaidBossEncounter(sample.imageData);
    const equipmentUpdate = updateUltimaRaidEquipmentRuntimeState({
      previous: previousState,
      detection,
      now: context.sampledAt,
      enabled: config.enabled,
      hasStream: true,
      hasRegion: true,
    });
    const bossUpdate = updateUltimaRaidBossRuntimeState({
      previous: previousState.boss,
      detection: bossDetection,
      now: context.sampledAt,
      enabled: config.bossAlert.enabled,
      hasStream: true,
      hasRegion: true,
    });
    const shouldRefreshPreview =
      !previousSnapshot?.previewImageData ||
      detection.detected ||
      bossDetection.bossBarDetected ||
      previousSnapshot.previewSampledAt === null ||
      context.sampledAt - previousSnapshot.previewSampledAt >=
        LIVE_PREVIEW_INTERVAL_MS;

    return {
      state: {
        ...equipmentUpdate.state,
        boss: bossUpdate.state,
      },
      snapshot: createSnapshot({
        sampledAt: context.sampledAt,
        layoutKey: context.frameLayoutKey,
        sourceDimensions: {
          width: context.video.videoWidth,
          height: context.video.videoHeight,
        },
        sampledRegion: sample.region,
        previewSampledAt: shouldRefreshPreview
          ? context.sampledAt
          : previousSnapshot.previewSampledAt,
        detection,
        bossDetection,
        previewImageData: shouldRefreshPreview
          ? cloneImageDataSnapshot(sample.imageData)
          : previousSnapshot.previewImageData,
      }),
      evidenceImageData: sample.imageData,
      shouldAlert: equipmentUpdate.shouldAlert,
      bossShouldAlert: bossUpdate.shouldAlert,
      soundId: config.soundId,
      volume: config.volume,
      bossSoundId: config.bossAlert.soundId,
      bossVolume: config.bossAlert.volume,
      errorMessage: null,
    };
  } catch {
    return {
      state: {
        ...markUltimaRaidEquipmentRuntimeUnavailable(
          previousState,
          FRAME_READ_ERROR_MESSAGE,
        ),
        boss: markUltimaRaidBossRuntimeUnavailable(
          previousState.boss,
          FRAME_READ_ERROR_MESSAGE,
        ),
      },
      snapshot: previousSnapshot,
      evidenceImageData: null,
      shouldAlert: false,
      bossShouldAlert: false,
      soundId: config.soundId,
      volume: config.volume,
      bossSoundId: config.bossAlert.soundId,
      bossVolume: config.bossAlert.volume,
      errorMessage: FRAME_READ_ERROR_MESSAGE,
    };
  }
}

function createSnapshot({
  sampledAt,
  layoutKey,
  sourceDimensions,
  sampledRegion,
  previewSampledAt,
  detection,
  bossDetection,
  previewImageData,
}: {
  sampledAt: number;
  layoutKey: string | null;
  sourceDimensions: { width: number; height: number };
  sampledRegion: { x: number; y: number; width: number; height: number };
  previewSampledAt: number | null;
  detection: UltimaRaidInventoryFullDetection;
  bossDetection: UltimaRaidBossDetection;
  previewImageData: RgbaImageSnapshot | null;
}): UltimaRaidEquipmentSnapshot {
  return {
    sampledAt,
    previewSampledAt,
    detectorVersion: detection.detectorVersion,
    layoutKey,
    sourceDimensions,
    sampledRegion,
    detected: detection.detected,
    confidence: detection.confidence,
    layoutValid: detection.layoutValid,
    detectionSource: detection.source,
    bagCountState: detection.bagCountState,
    bagCountReadable: detection.bagCountReadable,
    bagCountOccluded: detection.bagCountOccluded,
    bagFullDetected: detection.bagFullDetected,
    bagWarmPixelCount: detection.bagWarmPixelCount,
    bagForegroundPixelCount: detection.bagForegroundPixelCount,
    bagReadablePixelCount: detection.bagReadablePixelCount,
    bagWarmPixelRatio: detection.bagWarmPixelRatio,
    largestBagWarmClusterSize: detection.largestBagWarmClusterSize,
    largestBagWarmClusterWidth: detection.largestBagWarmClusterWidth,
    largestBagWarmClusterHeight: detection.largestBagWarmClusterHeight,
    largestBagWarmClusterXRatio: detection.largestBagWarmClusterXRatio,
    largestBagWarmClusterYRatio: detection.largestBagWarmClusterYRatio,
    bagWarmComponentValid: detection.bagWarmComponentValid,
    bagWarmComponentTouchesBoundary:
      detection.bagWarmComponentTouchesBoundary,
    bagCountRowTopRatio: detection.bagCountRowTopRatio,
    bagCountRowHeightRatio: detection.bagCountRowHeightRatio,
    fullBannerDetected: detection.fullBannerDetected,
    largestBannerClusterSize: detection.largestBannerClusterSize,
    bannerWidthRatio: detection.bannerWidthRatio,
    bannerHeightRatio: detection.bannerHeightRatio,
    bannerFillRatio: detection.bannerFillRatio,
    bossDetectorVersion: bossDetection.detectorVersion,
    bossProgressState: bossDetection.progressState,
    bossBarDetected: bossDetection.bossBarDetected,
    normalProgressBarDetected: bossDetection.normalBarDetected,
    bossBarPixelCount: bossDetection.bossBarPixelCount,
    bossBarWidthRatio: bossDetection.bossBarWidthRatio,
    bossBarHeightRatio: bossDetection.bossBarHeightRatio,
    bossBarFillRatio: bossDetection.bossBarFillRatio,
    normalProgressBarPixelCount: bossDetection.normalBarPixelCount,
    normalProgressBarWidthRatio: bossDetection.normalBarWidthRatio,
    previewImageData,
  };
}
