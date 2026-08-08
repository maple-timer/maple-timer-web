export {
  appendBuffExpiryPrecisionRecentRoiFrame,
  BUFF_EXPIRY_PRECISION_ROI_HISTORY_DATA_URL_MAX_CHARS,
  BUFF_EXPIRY_PRECISION_ROI_HISTORY_LIMIT,
  BUFF_EXPIRY_PRECISION_ROI_HISTORY_NEAR_MISS_MIN_GAP_MS,
  BUFF_EXPIRY_PRECISION_ROI_HISTORY_NEAR_MISS_MIN_SCORE,
  BUFF_EXPIRY_PRECISION_ROI_HISTORY_PERIODIC_INTERVAL_MS,
  BUFF_EXPIRY_PRECISION_ROI_HISTORY_WINDOW_MS,
  createBuffExpiryPrecisionRecentRoiFrame,
  pruneBuffExpiryPrecisionRecentRoiFrames,
  selectBuffExpiryPrecisionRoiFrameReason,
} from "../../runtime/buff-expiry/evidence/buffExpiryPrecisionRoiHistory";
export type {
  BuffExpiryPrecisionRecentRoiBestCandidate,
  BuffExpiryPrecisionRecentRoiFrame,
  BuffExpiryPrecisionRecentRoiFrameReason,
} from "../../runtime/buff-expiry/evidence/buffExpiryPrecisionRoiHistory";
