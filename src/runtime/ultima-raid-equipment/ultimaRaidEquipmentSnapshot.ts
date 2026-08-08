import type { RgbaImageSnapshot } from "../../alertTypes";
import type {
  UltimaRaidBagCountState,
  UltimaRaidInventoryFullDetectionSource,
} from "../../recognition/ultima-raid-equipment/inventoryFullDetector";
import type { UltimaRaidBossProgressState } from "../../recognition/ultima-raid-equipment/bossEncounterDetector";

export type UltimaRaidEquipmentSnapshot = {
  sampledAt: number;
  previewSampledAt: number | null;
  detectorVersion: string;
  layoutKey: string | null;
  sourceDimensions: { width: number; height: number };
  sampledRegion: { x: number; y: number; width: number; height: number };
  detected: boolean;
  confidence: number;
  layoutValid: boolean;
  detectionSource: UltimaRaidInventoryFullDetectionSource;
  bagCountState?: UltimaRaidBagCountState;
  bagCountReadable?: boolean;
  bagCountOccluded?: boolean;
  bagFullDetected: boolean;
  bagWarmPixelCount: number;
  bagForegroundPixelCount: number;
  bagReadablePixelCount?: number;
  bagWarmPixelRatio: number;
  largestBagWarmClusterSize: number;
  largestBagWarmClusterWidth?: number;
  largestBagWarmClusterHeight?: number;
  largestBagWarmClusterXRatio?: number;
  largestBagWarmClusterYRatio?: number;
  bagWarmComponentValid?: boolean;
  bagWarmComponentTouchesBoundary?: boolean;
  bagCountRowTopRatio?: number;
  bagCountRowHeightRatio?: number;
  fullBannerDetected: boolean;
  largestBannerClusterSize: number;
  bannerWidthRatio: number;
  bannerHeightRatio: number;
  bannerFillRatio: number;
  bossDetectorVersion: string;
  bossProgressState: UltimaRaidBossProgressState;
  bossBarDetected: boolean;
  normalProgressBarDetected: boolean;
  bossBarPixelCount: number;
  bossBarWidthRatio: number;
  bossBarHeightRatio: number;
  bossBarFillRatio: number;
  normalProgressBarPixelCount: number;
  normalProgressBarWidthRatio: number;
  previewImageData: RgbaImageSnapshot | null;
};
