import type { ResolvedGameViewport } from "../../contracts/geometry/frameSource";
import type { RelativeRegion } from "../../types";
import {
  coerceRegionToSquare,
  sampleSkill,
  sampleSkillPixelRegion,
  sampleVideoPixelRegion,
  sampleVideoRegion,
} from "../../lib/capture";
import { mapViewportRelativeRegionToCapturePixels } from "../../lib/gameViewport";

export function sampleGameViewportSkill(
  video: HTMLVideoElement,
  viewport: ResolvedGameViewport,
  region: RelativeRegion,
  includePreview: boolean,
) {
  if (viewport.mode === "legacy-passthrough") {
    return sampleSkill(video, region, includePreview);
  }

  const squareRegion = coerceRegionToSquare(
    region,
    viewport.region.width / viewport.region.height,
  );
  return sampleSkillPixelRegion(
    video,
    mapViewportRelativeRegionToCapturePixels(squareRegion, viewport),
    includePreview,
  );
}

export function sampleGameViewportVideoRegion(
  video: HTMLVideoElement,
  viewport: ResolvedGameViewport,
  region: RelativeRegion,
  includePreview: boolean,
  maxPreviewWidth?: number,
) {
  if (viewport.mode === "legacy-passthrough") {
    return sampleVideoRegion(
      video,
      region,
      includePreview,
      maxPreviewWidth,
    );
  }

  return sampleVideoPixelRegion(
    video,
    mapViewportRelativeRegionToCapturePixels(region, viewport),
    includePreview,
    maxPreviewWidth,
  );
}
