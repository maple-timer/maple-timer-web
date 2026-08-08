import type { RelativeRegion } from "../../types";

export type CropTool = "select" | "pan";

export type PanState = {
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

export const DEFAULT_CROP_ZOOM = 2;

export function clampCropZoom(zoom: number): number {
  return Math.min(8, Math.max(1, zoom));
}

export function getWheelZoom(currentZoom: number, deltaY: number): number {
  return clampCropZoom(currentZoom * (deltaY > 0 ? 0.86 : 1.16));
}

export function getMovedPan(
  state: PanState,
  point: { clientX: number; clientY: number },
): { x: number; y: number } {
  return {
    x: state.startPanX + point.clientX - state.startClientX,
    y: state.startPanY + point.clientY - state.startClientY,
  };
}

export function isRegionCenteredInQuickSlotQuadrant(region: RelativeRegion): boolean {
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  return centerX >= 0.5 && centerY >= 0.5;
}

export type CropPlacementWarningType = "skill-quickslot";

function getRegionCenter(region: RelativeRegion): { x: number; y: number } {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  };
}

export function isRegionInSkillQuickSlotArea(region: RelativeRegion): boolean {
  const center = getRegionCenter(region);
  return center.x >= 0.5 && center.y >= 0.75;
}

export function isRegionInExpectedCropArea(
  region: RelativeRegion,
  _warningType: CropPlacementWarningType,
): boolean {
  return isRegionInSkillQuickSlotArea(region);
}
