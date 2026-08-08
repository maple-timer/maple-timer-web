import type { BuffExpiryTargetGroup } from "../../contracts/recognition/buffExpiryRecognition";
import {
  BUFF_EXPIRY_TARGET_GROUPS,
  isBuffExpiryTargetGroup,
  normalizeBuffExpiryTargetGroups,
} from "../../contracts/recognition/buffExpiryRecognition";

export const BUFF_EXPIRY_PRECISION_TARGET_GROUPS: BuffExpiryTargetGroup[] = [
  ...BUFF_EXPIRY_TARGET_GROUPS,
];

export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SECONDS = 21;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SECONDS = 59;
export const BUFF_EXPIRY_PRECISION_PENDING_WINDOW_MS = 20_000;
export const BUFF_EXPIRY_PRECISION_TRACK_POST_EXPIRY_ALERT_GRACE_MS = 10_000;
export const BUFF_EXPIRY_PRECISION_TRACK_ALERTED_GRACE_MS = 15_000;
export const BUFF_EXPIRY_PRECISION_ALERT_MAX_STALE_MS = 8_000;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_OBSERVATIONS = 5;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_INLIER_OBSERVATIONS = 4;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MAX_EXPIRES_RESIDUAL_MS = 3_000;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_EXPIRES_RESIDUAL_MS = 1_500;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MAD_SCALE = 2.5;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_SPAN_MS = 5_000;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_DISTINCT_SECONDS = 4;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_TOTAL_DECREASE_SECONDS = 4;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MIN_COUNTDOWN_RATE = 0.7;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MAX_COUNTDOWN_RATE = 1.3;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MAX_TRANSITION_RESIDUAL_SECONDS = 1.5;
export const BUFF_EXPIRY_PRECISION_CONFIRM_MAX_SAME_SECOND_SPAN_MS = 1_500;
export const BUFF_EXPIRY_PRECISION_UPDATE_MAX_EXPIRES_DRIFT_MS = 4_000;
export const BUFF_EXPIRY_PRECISION_ASSIST_MAX_EXPIRES_DRIFT_MS = 3_000;

export const BUFF_EXPIRY_PRECISION_GROUP_MAX_TRACKS: Record<BuffExpiryTargetGroup, number> = {
  unionWealth: 1,
  unionLuck: 1,
  potion: 2,
  expCoupon: 1,
};

export const BUFF_EXPIRY_PRECISION_GROUP_LABELS: Record<BuffExpiryTargetGroup, string> = {
  unionWealth: "유니온의 부",
  unionLuck: "유니온의 행운",
  potion: "비약",
  expCoupon: "경험치 쿠폰",
};

export function getBuffExpiryPrecisionBuffId(group: BuffExpiryTargetGroup): string {
  return `next:${group}`;
}

export function getBuffExpiryPrecisionGroupFromBuffId(buffId: string): BuffExpiryTargetGroup | null {
  const group = buffId.startsWith("next:") ? buffId.slice("next:".length) : buffId;
  if (isBuffExpiryPrecisionTargetGroup(group)) {
    return group;
  }
  return null;
}

export function isBuffExpiryPrecisionTargetGroup(value: string): value is BuffExpiryTargetGroup {
  return isBuffExpiryTargetGroup(value);
}

export function normalizeBuffExpiryPrecisionTargetGroups(
  value: unknown,
): BuffExpiryTargetGroup[] {
  return normalizeBuffExpiryTargetGroups(value);
}

export function getBuffExpiryPrecisionSelectedTargetGroups(config: {
  selectedPrecisionTargetGroups?: unknown;
}): BuffExpiryTargetGroup[] {
  return normalizeBuffExpiryPrecisionTargetGroups(config.selectedPrecisionTargetGroups);
}

export function getBuffExpiryPrecisionSelectedTargetGroupSet(config: {
  selectedPrecisionTargetGroups?: unknown;
}): Set<BuffExpiryTargetGroup> {
  return new Set(getBuffExpiryPrecisionSelectedTargetGroups(config));
}
