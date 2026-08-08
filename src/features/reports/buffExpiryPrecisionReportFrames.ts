import type { BuffExpirySnapshot } from "../../lib/buffExpiry/buffExpiryTypes";
import {
  BUFF_EXPIRY_PRECISION_REPORT_ROI_FRAME_DATA_URL_MAX_LENGTH,
  BUFF_EXPIRY_PRECISION_REPORT_ROI_FRAME_LIMIT,
} from "./buffExpiryPrecisionReportConstants";

export function serializeBuffExpiryPrecisionRecentRoiFrames(
  frames: NonNullable<BuffExpirySnapshot["nextRecentRoiFrames"]>,
) {
  return frames
    .slice(-BUFF_EXPIRY_PRECISION_REPORT_ROI_FRAME_LIMIT)
    .filter((frame) => isReportSafeBuffExpiryPrecisionRoiDataUrl(frame.imageDataUrl))
    .map((frame) => ({
      sampledAt: frame.sampledAt,
      reason: frame.reason,
      sourceSize: frame.sourceSize,
      roi: frame.roi,
      imageDataUrl: frame.imageDataUrl,
      boxCount: frame.boxCount,
      targetObservationCount: frame.targetObservationCount,
      countdownObservationCount: frame.countdownObservationCount,
      bestByGroup: frame.bestByGroup,
      trackCount: frame.trackCount,
      pendingTrackCount: frame.pendingTrackCount,
    }));
}

function isReportSafeBuffExpiryPrecisionRoiDataUrl(value: string | null): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith("data:image/webp") ||
      value.startsWith("data:image/jpeg") ||
      value.startsWith("data:image/png")) &&
    value.length <= BUFF_EXPIRY_PRECISION_REPORT_ROI_FRAME_DATA_URL_MAX_LENGTH
  );
}
