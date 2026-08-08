import type { ExtractBuffIconsOptions, FeatureMaps, ImageLike, Rect } from "../types.js";

export type DetectionContext = {
  maps: FeatureMaps;
  roi: Rect;
  image: ImageLike;
  options: ExtractBuffIconsOptions;
  maxIcons: number;
};

export function createDetectionContext(
  maps: FeatureMaps,
  roi: Rect,
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  maxIcons: number,
): DetectionContext {
  return { maps, roi, image, options, maxIcons };
}
