import type { BuffExpiryPrecisionTargetGroup } from "../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";

export const BUFF_EXPIRY_PRECISION_REPORT_TRACK_LIMIT = 8;
export const BUFF_EXPIRY_PRECISION_REPORT_PENDING_OBSERVATION_LIMIT = 6;
export const BUFF_EXPIRY_PRECISION_REPORT_ICON_EVIDENCE_LIMIT = 24;
export const BUFF_EXPIRY_PRECISION_REPORT_ICON_EVIDENCE_DATA_URL_MAX_LENGTH = 12_000;
export const BUFF_EXPIRY_PRECISION_REPORT_ROI_FRAME_LIMIT = 14;
export const BUFF_EXPIRY_PRECISION_REPORT_ROI_FRAME_DATA_URL_MAX_LENGTH = 220_000;
export const BUFF_EXPIRY_PRECISION_REPORT_ALERT_DECISION_LIMIT = 60;
export const BUFF_EXPIRY_PRECISION_REPORT_RUNTIME_TRACE_LIMIT = 60;
export const BUFF_EXPIRY_PRECISION_REPORT_SCHEMA_VERSION = 2;

export const BUFF_EXPIRY_PRECISION_GROUP_LABELS: Record<BuffExpiryPrecisionTargetGroup, string> = {
  unionWealth: "유니온의 부",
  unionLuck: "유니온의 행운",
  potion: "비약",
  expCoupon: "경험치 쿠폰",
};
