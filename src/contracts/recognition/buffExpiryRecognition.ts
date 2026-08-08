export type BuffExpiryTargetGroup =
  | "unionWealth"
  | "unionLuck"
  | "potion"
  | "expCoupon";

export const BUFF_EXPIRY_TARGET_GROUPS: BuffExpiryTargetGroup[] = [
  "unionWealth",
  "unionLuck",
  "potion",
  "expCoupon",
];

export function isBuffExpiryTargetGroup(value: string): value is BuffExpiryTargetGroup {
  return value === "unionWealth"
    || value === "unionLuck"
    || value === "potion"
    || value === "expCoupon";
}

export function normalizeBuffExpiryTargetGroups(value: unknown): BuffExpiryTargetGroup[] {
  if (!Array.isArray(value)) {
    return [...BUFF_EXPIRY_TARGET_GROUPS];
  }

  const selected = value
    .filter((item): item is string => typeof item === "string")
    .filter(isBuffExpiryTargetGroup)
    .filter((item, index, array) => array.indexOf(item) === index);

  return selected.length ? selected : [...BUFF_EXPIRY_TARGET_GROUPS];
}
