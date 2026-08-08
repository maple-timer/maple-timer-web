import type { PixelRegion } from "../contracts/geometry/pixelRegion";
import type { RelativeRegion, SkillConfig } from "../types";

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRegion(region: RelativeRegion): RelativeRegion {
  const x1 = clamp(Math.min(region.x, region.x + region.width));
  const y1 = clamp(Math.min(region.y, region.y + region.height));
  const x2 = clamp(Math.max(region.x, region.x + region.width));
  const y2 = clamp(Math.max(region.y, region.y + region.height));

  return {
    x: x1,
    y: y1,
    width: Math.max(0.001, x2 - x1),
    height: Math.max(0.001, y2 - y1),
  };
}

export function regionToPixels(
  region: RelativeRegion,
  sourceWidth: number,
  sourceHeight: number,
): PixelRegion {
  const normalized = normalizeRegion(region);
  return {
    x: Math.round(normalized.x * sourceWidth),
    y: Math.round(normalized.y * sourceHeight),
    width: Math.max(1, Math.round(normalized.width * sourceWidth)),
    height: Math.max(1, Math.round(normalized.height * sourceHeight)),
  };
}

export function pixelsToRegion(
  region: PixelRegion,
  sourceWidth: number,
  sourceHeight: number,
): RelativeRegion {
  return normalizeRegion({
    x: region.x / sourceWidth,
    y: region.y / sourceHeight,
    width: region.width / sourceWidth,
    height: region.height / sourceHeight,
  });
}

export function hasUsableRegion(region: RelativeRegion | null): region is RelativeRegion {
  return Boolean(region && region.width > 0.005 && region.height > 0.005);
}

export function captureSizeToLayoutKey(
  captureSize: { width: number; height: number } | null,
): string | null {
  if (!captureSize?.width || !captureSize.height) {
    return null;
  }

  return `${Math.round(captureSize.width)}x${Math.round(captureSize.height)}`;
}

export function hasLayoutRegions(skill: Pick<SkillConfig, "regionsByLayout">): boolean {
  return Object.values(skill.regionsByLayout ?? {}).some((region) => hasUsableRegion(region));
}

export function hasAnySkillRegion(
  skill: Pick<SkillConfig, "region" | "regionsByLayout">,
): boolean {
  return hasUsableRegion(skill.region) || hasLayoutRegions(skill);
}

export function getSkillRegionForLayout(
  skill: Pick<SkillConfig, "region" | "regionsByLayout">,
  layoutKey: string | null,
): RelativeRegion | null {
  if (layoutKey) {
    const layoutRegion = skill.regionsByLayout?.[layoutKey] ?? null;
    if (hasUsableRegion(layoutRegion)) {
      return layoutRegion;
    }

    if (hasLayoutRegions(skill)) {
      return null;
    }
  }

  return hasUsableRegion(skill.region) ? skill.region : null;
}

export function buildRegionPatchForLayout(
  skill: Pick<SkillConfig, "regionsByLayout"> &
    Partial<Pick<SkillConfig, "region">>,
  layoutKey: string | null,
  region: RelativeRegion,
  options: {
    preserveFallbackRegion?: boolean;
  } = {},
): Pick<SkillConfig, "region" | "regionsByLayout"> {
  const normalized = normalizeRegion(region);

  if (!layoutKey) {
    return {
      region: normalized,
      regionsByLayout: skill.regionsByLayout,
    };
  }

  return {
    region: options.preserveFallbackRegion
      ? skill.region ?? null
      : normalized,
    regionsByLayout: {
      ...(skill.regionsByLayout ?? {}),
      [layoutKey]: normalized,
    },
  };
}
