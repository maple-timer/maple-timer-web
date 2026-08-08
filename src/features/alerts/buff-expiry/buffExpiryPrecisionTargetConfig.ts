import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";

export const BUFF_EXPIRY_PRECISION_TARGET_GROUPS: BuffExpiryPrecisionTargetGroup[] = [
  "unionWealth",
  "unionLuck",
  "potion",
  "expCoupon",
];

export const BUFF_EXPIRY_PRECISION_GROUP_LABELS: Record<BuffExpiryPrecisionTargetGroup, string> = {
  unionWealth: "유니온의 부",
  unionLuck: "유니온의 행운",
  potion: "비약",
  expCoupon: "경험치 쿠폰",
};

export const BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE: Record<BuffExpiryPrecisionTargetGroup, number> = {
  unionWealth: 1,
  unionLuck: 1,
  potion: 2,
  expCoupon: 1,
};

export const BUFF_EXPIRY_PRECISION_COLLAPSED_TARGET_SLOT_COUNT = 5;

export function getBuffExpiryPrecisionGroupFromBuffId(buffId: string): BuffExpiryPrecisionTargetGroup | null {
  if (!buffId.startsWith("next:")) {
    return null;
  }
  const group = buffId.slice("next:".length);
  return isBuffExpiryPrecisionTargetGroup(group) ? group : null;
}

export function isBuffExpiryPrecisionTargetGroup(value: string): value is BuffExpiryPrecisionTargetGroup {
  return value === "unionWealth" || value === "unionLuck" || value === "potion" || value === "expCoupon";
}
