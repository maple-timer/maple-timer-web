import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";

export function getBuffExpiryPrecisionDiagnosticRoi(
  width: number,
  height: number,
): PixelRegion {
  const x = Math.max(0, Math.floor(width * 0.46));
  const y = 0;
  const roiWidth = Math.max(1, width - x);
  const roiHeight = Math.max(1, Math.min(height, Math.ceil(height * 0.36)));
  return { x, y, width: roiWidth, height: roiHeight };
}
