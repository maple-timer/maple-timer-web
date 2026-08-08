import type { RelativeRegion } from "../../../types";

export const MAX_MANUAL_EXPERIENCE_REGION_HEIGHT = 0.08;

export function getManualExperienceRegionValidationError(
  region: RelativeRegion,
): string | null {
  if (region.height <= MAX_MANUAL_EXPERIENCE_REGION_HEIGHT) {
    return null;
  }

  return "경험치바 아래에 확장 UI나 검은 여백이 포함되어 있습니다. 게임 화면을 먼저 맞춰주세요.";
}
