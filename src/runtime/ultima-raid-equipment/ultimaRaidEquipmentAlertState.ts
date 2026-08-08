import type {
  UltimaRaidBagCountState,
  UltimaRaidInventoryFullDetection,
  UltimaRaidInventoryFullDetectionSource,
} from "../../recognition/ultima-raid-equipment/inventoryFullDetector";
import {
  createUltimaRaidBossRuntimeState,
  type UltimaRaidBossRuntimeState,
} from "./ultimaRaidBossAlertState";

export const ULTIMA_RAID_EVIDENCE_WINDOW_SIZE = 3;
export const ULTIMA_RAID_REQUIRED_BAG_SIGNALS = 2;
export const ULTIMA_RAID_REQUIRED_BAG_CLEAR_FRAMES = 5;

export type UltimaRaidEquipmentRuntimeStatus =
  | "paused"
  | "no-stream"
  | "no-region"
  | "invalid-region"
  | "waiting"
  | "candidate"
  | "alerted"
  | "unavailable";

export type UltimaRaidEquipmentRuntimeState = {
  status: UltimaRaidEquipmentRuntimeStatus;
  recentBagDetections: boolean[];
  recentBannerDetections: boolean[];
  consecutiveBagAbsentFrames: number;
  alertedForCurrentPresence: boolean;
  confidence: number;
  bagCountState: UltimaRaidBagCountState;
  bagCountOccluded: boolean;
  bagWarmPixelRatio: number;
  fullBannerDetected: boolean;
  detectionSource: UltimaRaidInventoryFullDetectionSource;
  lastDetectedAt: number | null;
  lastAlertedAt: number | null;
  lastPlaybackAt: number | null;
  lastError: string | null;
  boss: UltimaRaidBossRuntimeState;
};

export type UltimaRaidEquipmentStateUpdate = {
  state: UltimaRaidEquipmentRuntimeState;
  shouldAlert: boolean;
};

export function createUltimaRaidEquipmentRuntimeState(
  status: UltimaRaidEquipmentRuntimeStatus = "waiting",
): UltimaRaidEquipmentRuntimeState {
  return {
    status,
    recentBagDetections: [],
    recentBannerDetections: [],
    consecutiveBagAbsentFrames: 0,
    alertedForCurrentPresence: false,
    confidence: 0,
    bagCountState: "unreadable",
    bagCountOccluded: false,
    bagWarmPixelRatio: 0,
    fullBannerDetected: false,
    detectionSource: "none",
    lastDetectedAt: null,
    lastAlertedAt: null,
    lastPlaybackAt: null,
    lastError: null,
    boss: createUltimaRaidBossRuntimeState(
      status === "waiting"
        ? "initializing"
        : status === "alerted"
          ? "active"
          : status,
    ),
  };
}

export function updateUltimaRaidEquipmentRuntimeState({
  previous,
  detection,
  now,
  enabled,
  hasStream,
  hasRegion,
}: {
  previous: UltimaRaidEquipmentRuntimeState;
  detection: UltimaRaidInventoryFullDetection | null;
  now: number;
  enabled: boolean;
  hasStream: boolean;
  hasRegion: boolean;
}): UltimaRaidEquipmentStateUpdate {
  if (!enabled || !hasStream || !hasRegion) {
    const status: UltimaRaidEquipmentRuntimeStatus = !enabled
      ? "paused"
      : !hasStream
        ? "no-stream"
        : "no-region";
    return {
      state: {
        ...createUltimaRaidEquipmentRuntimeState(status),
        lastAlertedAt: previous.lastAlertedAt,
        lastPlaybackAt: previous.lastPlaybackAt,
      },
      shouldAlert: false,
    };
  }

  if (!detection) {
    return {
      state: {
        ...previous,
        status: "waiting",
        recentBagDetections: [],
        recentBannerDetections: [],
        consecutiveBagAbsentFrames: 0,
        confidence: 0,
        bagCountState: "unreadable",
        bagCountOccluded: false,
        bagWarmPixelRatio: 0,
        fullBannerDetected: false,
        detectionSource: "none",
        lastError: null,
      },
      shouldAlert: false,
    };
  }

  if (!detection.layoutValid) {
    return {
      state: {
        ...createUltimaRaidEquipmentRuntimeState("invalid-region"),
        lastAlertedAt: previous.lastAlertedAt,
        lastPlaybackAt: previous.lastPlaybackAt,
      },
      shouldAlert: false,
    };
  }

  const recentBagDetections = appendEvidence(
    previous.recentBagDetections,
    detection.bagFullDetected,
  );
  const recentBannerDetections = appendEvidence(
    previous.recentBannerDetections,
    detection.fullBannerDetected,
  );
  const bagSignalCount = countPositiveEvidence(recentBagDetections);
  const bannerSignalCount = countPositiveEvidence(recentBannerDetections);
  const confirmedFull =
    bagSignalCount >= ULTIMA_RAID_REQUIRED_BAG_SIGNALS;
  const hasCurrentEvidence =
    detection.bagFullDetected || detection.fullBannerDetected;
  const consecutiveBagAbsentFrames =
    detection.bagCountState === "clear"
      ? previous.consecutiveBagAbsentFrames + 1
      : 0;
  const confirmedAbsent =
    consecutiveBagAbsentFrames >=
    ULTIMA_RAID_REQUIRED_BAG_CLEAR_FRAMES;
  const shouldAlert =
    !previous.alertedForCurrentPresence && confirmedFull && !confirmedAbsent;
  const alertedForCurrentPresence = confirmedAbsent
    ? false
    : previous.alertedForCurrentPresence || shouldAlert;
  const hasRecentEvidence = bagSignalCount > 0 || bannerSignalCount > 0;

  let status: UltimaRaidEquipmentRuntimeStatus;
  if (alertedForCurrentPresence) {
    status = "alerted";
  } else if (hasRecentEvidence && !confirmedAbsent) {
    status = "candidate";
  } else {
    status = "waiting";
  }

  return {
    state: {
      ...previous,
      status,
      recentBagDetections,
      recentBannerDetections,
      consecutiveBagAbsentFrames,
      alertedForCurrentPresence,
      confidence: detection.confidence,
      bagCountState: detection.bagCountState,
      bagCountOccluded: detection.bagCountOccluded,
      bagWarmPixelRatio: detection.bagWarmPixelRatio,
      fullBannerDetected: detection.fullBannerDetected,
      detectionSource: detection.source,
      lastDetectedAt: hasCurrentEvidence ? now : previous.lastDetectedAt,
      lastAlertedAt: shouldAlert ? now : previous.lastAlertedAt,
      lastError: null,
    },
    shouldAlert,
  };
}

export function markUltimaRaidEquipmentRuntimeUnavailable(
  previous: UltimaRaidEquipmentRuntimeState,
  error: string,
): UltimaRaidEquipmentRuntimeState {
  return {
    ...previous,
    status: "unavailable",
    recentBagDetections: [],
    recentBannerDetections: [],
    consecutiveBagAbsentFrames: 0,
    confidence: 0,
    bagCountState: "unreadable",
    bagCountOccluded: false,
    bagWarmPixelRatio: 0,
    fullBannerDetected: false,
    detectionSource: "none",
    lastError: error,
  };
}

export function releaseUltimaRaidEquipmentAlertAfterPlaybackFailure(
  previous: UltimaRaidEquipmentRuntimeState,
  alertedAt: number,
  error: string,
): UltimaRaidEquipmentRuntimeState {
  if (previous.lastAlertedAt !== alertedAt) {
    return previous;
  }

  return {
    ...previous,
    status: "waiting",
    recentBagDetections: [],
    recentBannerDetections: [],
    alertedForCurrentPresence: false,
    lastError: error,
  };
}

export function markUltimaRaidEquipmentPlaybackFinished(
  previous: UltimaRaidEquipmentRuntimeState,
  finishedAt: number,
): UltimaRaidEquipmentRuntimeState {
  return {
    ...previous,
    lastPlaybackAt: Math.max(previous.lastPlaybackAt ?? 0, finishedAt),
    lastError: null,
  };
}

function appendEvidence(previous: boolean[], value: boolean): boolean[] {
  return [...previous, value].slice(-ULTIMA_RAID_EVIDENCE_WINDOW_SIZE);
}

function countPositiveEvidence(evidence: boolean[]): number {
  return evidence.reduce((count, value) => count + (value ? 1 : 0), 0);
}
