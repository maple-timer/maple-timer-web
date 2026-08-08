import type { ExtractBuffIconsOptions, ExtractBuffIconsResult, ImageLike } from "./types.js";
import { DEFAULT_MAX_ICONS, DEFAULT_OUTPUT_SIZE } from "./detector/constants.js";
import { cropAndResize } from "./detector/crop.js";
import { buildFeatureMaps } from "./detector/features.js";
import { scanSquareCandidates } from "./detector/legacyCandidateScan.js";
import { detectRows } from "./detector/rowScan.js";
import { defaultSearchRoi } from "./detector/viewport.js";
import { orderBuffIconBoxes } from "./resultOrder.js";

export type { BuffIconBox, ExtractBuffIconsOptions, ExtractBuffIconsResult, ImageLike, Rect, RgbaImage } from "./types.js";

/**
 * Extracts active MapleStory buff icons from a full frame or screen-share frame.
 *
 * The function is synchronous and dependency-free in browser runtimes. Pass a
 * browser ImageData object, or any RGBA buffer with the same shape. Returned
 * boxes and icons share the same index and are ordered top-to-bottom, then
 * left-to-right within each row.
 */
export function extractBuffIcons(image: ImageLike, options: ExtractBuffIconsOptions = {}): ExtractBuffIconsResult {
  assertImage(image);

  const outputSize = options.outputSize ?? DEFAULT_OUTPUT_SIZE;
  const maxIcons = options.maxIcons ?? DEFAULT_MAX_ICONS;
  const roi = options.roi ?? (
    options.inputMode === "croppedRoi" || options.inputMode === "topRightQuadrant"
      ? fullImageRoi(image)
      : defaultSearchRoi(image, options)
  );
  const maps = buildFeatureMaps(image, roi);
  const rowBoxes = detectRows(maps, roi, image, options, maxIcons);
  const candidates = options.includeDebug ? scanSquareCandidates(maps, roi, image, options) : [];
  const boxes = orderBuffIconBoxes(rowBoxes);
  const icons = boxes.map((box) => cropAndResize(image, box.x, box.y, box.size, outputSize));

  return {
    icons,
    boxes,
    debug: options.includeDebug
      ? {
          roi,
          slotSize: undefined,
          pitch: undefined,
          candidates,
          supportedCandidates: [],
        }
      : undefined,
  };
}

function fullImageRoi(image: ImageLike) {
  return { x: 0, y: 0, width: image.width, height: image.height };
}

function assertImage(image: ImageLike) {
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) {
    throw new Error("Invalid image dimensions.");
  }
  if (!image.data || image.data.length < image.width * image.height * 4) {
    throw new Error("Image data must be RGBA data with width * height * 4 entries.");
  }
}
