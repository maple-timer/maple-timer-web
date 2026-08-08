import type {
  BoosterExpiryAlertConfig,
  BuffExpiryAlertConfig,
  HuntStallAlertConfig,
  RelativeRegion,
  RuneAlertConfig,
  SpecialCoreAlertConfig,
  UltimaRaidEquipmentAlertConfig,
} from "../types";

export function shouldResetRuneDetectionForPatch(patch: Partial<RuneAlertConfig>): boolean {
  return (
    "enabled" in patch ||
    "region" in patch ||
    "regionsByLayout" in patch ||
    "repeatAlertEnabled" in patch
  );
}

export function shouldResetHuntStallDetectionForPatch(
  patch: Partial<HuntStallAlertConfig>,
): boolean {
  return (
    "enabled" in patch ||
    "mode" in patch ||
    "manualExperienceRegion" in patch ||
    "manualExperienceRegionsByLayout" in patch ||
    "cooldownRegion" in patch ||
    "cooldownRegionsByLayout" in patch
  );
}

export function shouldResetUltimaRaidEquipmentDetectionForPatch(
  patch: Partial<UltimaRaidEquipmentAlertConfig>,
  current: UltimaRaidEquipmentAlertConfig,
): boolean {
  return (
    ("enabled" in patch && patch.enabled !== current.enabled) ||
    ("region" in patch &&
      !areRelativeRegionsEqual(patch.region, current.region)) ||
    ("regionsByLayout" in patch &&
      !areRegionsByLayoutEqual(
        patch.regionsByLayout,
        current.regionsByLayout,
      )) ||
    (typeof patch.bossAlert?.enabled === "boolean" &&
      patch.bossAlert.enabled !== current.bossAlert.enabled)
  );
}

function areRelativeRegionsEqual(
  left: RelativeRegion | null | undefined,
  right: RelativeRegion | null | undefined,
): boolean {
  if (!left || !right) {
    return left == null && right == null;
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function areRegionsByLayoutEqual(
  left: Record<string, RelativeRegion> | undefined,
  right: Record<string, RelativeRegion> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([layoutKey, region]) =>
      areRelativeRegionsEqual(region, right?.[layoutKey]),
    )
  );
}

export function shouldResetBuffExpiryDetectionForPatch(
  patch: Partial<BuffExpiryAlertConfig>,
): boolean {
  return (
    "enabled" in patch ||
    "selectedBuffIds" in patch
  );
}

export function shouldResetBoosterExpiryDetectionForPatch(
  patch: Partial<BoosterExpiryAlertConfig>,
): boolean {
  return "alertLeadSeconds" in patch;
}

export function shouldResetSpecialCoreDetectionForPatch(
  patch: Partial<SpecialCoreAlertConfig>,
): boolean {
  return "enabled" in patch;
}

export function shouldRetimeSpecialCoreDetectionForPatch(
  patch: Partial<SpecialCoreAlertConfig>,
): boolean {
  return "cooldownSeconds" in patch || "alertLeadSeconds" in patch;
}
