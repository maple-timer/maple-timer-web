import type {
  BuffExpiryIconImageData,
  BuffExpiryNormalizedBoxIcon,
  BuffExpiryPerformanceMetrics,
  BuffExpiryRuntimeStatus,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type {
  BuffExpiryBox,
  BuffExpiryPendingTrack,
  BuffExpiryTrackedBuff,
} from "../../../domain/buff-expiry/precisionTrackingTypes";
import type {
  BuffExpiryPrecisionSampleResponse,
  BuffExpiryPrecisionTargetGroup,
} from "../../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";

export function createBuffExpiryPrecisionBoxes(response: BuffExpiryPrecisionSampleResponse): BuffExpiryBox[] {
  return response.boxes.map((box) => ({
    x: box.x,
    y: box.y,
    width: box.size,
    height: box.size,
    confidence: box.confidence,
    side: box.size,
    row: box.row,
    col: box.col,
  }));
}

export function createBuffExpiryPrecisionNormalizedBoxIcons({
  response,
  boxes,
  boxIndexes,
}: {
  response: BuffExpiryPrecisionSampleResponse;
  boxes: BuffExpiryBox[];
  boxIndexes?: Iterable<number>;
}): BuffExpiryNormalizedBoxIcon[] {
  const indexes = boxIndexes ? [...new Set([...boxIndexes])].sort((left, right) => left - right) : null;
  const sourceIndexes = indexes ?? response.icons.map((_, index) => index);
  return sourceIndexes.flatMap((index) => {
    const icon = response.icons[index];
    const box = boxes[index];
    if (!icon || !box) {
      return [];
    }
    return [
      {
        box,
        imageData: createBuffExpiryPrecisionIconImageData(icon),
      },
    ];
  });
}

export function getBuffExpiryPrecisionAcceptedMatchCount(
  response: BuffExpiryPrecisionSampleResponse,
  selectedGroups?: Set<BuffExpiryPrecisionTargetGroup>,
): number {
  return response.iconObservations.filter(
    (observation) =>
      observation.identity.kind === "target" &&
      (!selectedGroups ||
        (observation.identity.group !== null && selectedGroups.has(observation.identity.group))),
  ).length;
}

export function createBuffExpiryPrecisionPerformanceMetrics({
  response,
  acceptedMatchCount,
}: {
  response: BuffExpiryPrecisionSampleResponse;
  acceptedMatchCount: number;
}): BuffExpiryPerformanceMetrics {
  return {
    totalMs: response.performance.totalMs,
    detectMs: response.performance.detectMs,
    normalizeAndMatchMs: response.performance.matchMs ?? 0,
    countdownMs: response.performance.countdownMs,
    countdownCount: response.performance.countdownCount,
    countdownModelStatus: response.performance.countdownModelStatus,
    ...(response.performance.matcherModelStatus
      ? { matcherModelStatus: response.performance.matcherModelStatus }
      : {}),
    boxCount: response.performance.boxCount,
    acceptedMatchCount,
    activeSampleCount: 0,
  };
}

export function getBuffExpiryPrecisionRuntimeStatus({
  tracks,
  pendingTracks,
  boxCount,
}: {
  tracks: BuffExpiryTrackedBuff[];
  pendingTracks: BuffExpiryPendingTrack[];
  boxCount: number;
}): BuffExpiryRuntimeStatus {
  if (tracks.some((track) => track.alertedAt !== null)) {
    return "alerted";
  }
  if (tracks.length || pendingTracks.length || boxCount) {
    return "tracking";
  }
  return "waiting";
}

function createBuffExpiryPrecisionIconImageData(icon: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): BuffExpiryIconImageData {
  return {
    width: icon.width,
    height: icon.height,
    data: new Uint8ClampedArray(icon.data),
  };
}
