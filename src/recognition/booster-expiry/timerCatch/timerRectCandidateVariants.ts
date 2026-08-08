import { normalizeRoi } from "./timerImage";
import {
  isMapleTimerPanelFragment,
  isMapleTimerPanelShape,
  type TimerPanelGeometryOptions,
} from "./timerDarkPanelCandidates";
import type { ImageDataLike, Rect, TimerRectOptions } from "./timerTypes";

export type TimerRectCandidateVariantOptions = Pick<
  Required<TimerRectOptions>,
  "maxCandidates"
> &
  TimerPanelGeometryOptions;

export function makeTimerCandidateVariants(
  candidates: Rect[],
  imageData: ImageDataLike,
  settings: TimerRectCandidateVariantOptions,
  includeFragments = false,
): Rect[] {
  const variants: Rect[] = [];
  const seen = new Set<string>();
  const maxVariantCount = settings.maxCandidates * 16;

  for (const rect of candidates) {
    addTimerCandidateVariant(variants, seen, rect, imageData);
    if (
      includeFragments &&
      (isMapleTimerPanelShape(rect, imageData, settings) ||
        isMapleTimerPanelFragment(rect, imageData, settings))
    ) {
      for (const variant of makeMapleTimerPanelGeometryVariants(rect)) {
        addTimerCandidateVariant(variants, seen, variant, imageData);
      }
    }
    if (variants.length >= maxVariantCount) break;
  }

  return variants;
}

export function makeMapleTimerPanelGeometryVariants(rect: Rect): Rect[] {
  const variants: Rect[] = [];
  const aspect = rect.width / Math.max(1, rect.height);
  if (aspect >= 3.4) {
    const xOffsets = [-4, 0, 4];
    const yOffsets = [-4, -2, 0, 2];
    const widthDeltas = [-4, -2, 0, 2];
    const heightDeltas = [-4, -2, 0, 2];
    for (const xOffset of xOffsets) {
      for (const yOffset of yOffsets) {
        for (const widthDelta of widthDeltas) {
          for (const heightDelta of heightDeltas) {
            if (
              xOffset === 0 &&
              yOffset === 0 &&
              widthDelta === 0 &&
              heightDelta === 0
            )
              continue;
            const width = rect.width + widthDelta;
            const height = rect.height + heightDelta;
            if (
              width < Math.round(rect.width * 0.94) ||
              height < Math.round(rect.height * 0.88)
            )
              continue;
            variants.push({
              x: rect.x + xOffset,
              y: rect.y + yOffset,
              width,
              height,
            });
          }
        }
      }
    }
    return variants;
  }

  const targetAspects =
    aspect < 3.4 ? [3.6, 3.8, 4.0, 4.2, 4.42, 4.7, 5.0] : [4.0, 4.2, 4.42];
  const anchorFractions = aspect < 3.4 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
  const yOffsets = aspect < 3.4 ? [-6, -4, -2, 0, 2] : [0];
  const targetHeights = new Set<number>([
    rect.height,
    rect.height + 1,
    rect.height + 2,
    rect.height + 4,
    rect.height + 6,
    rect.height + 8,
  ]);

  for (const height of targetHeights) {
    for (const targetAspect of targetAspects) {
      const width = Math.round(height * targetAspect);
      if (width < rect.width) continue;
      const extraWidth = width - rect.width;
      for (const anchorFraction of anchorFractions) {
        for (const yOffset of yOffsets) {
          variants.push({
            x: rect.x - Math.round(extraWidth * anchorFraction),
            y: rect.y + yOffset,
            width,
            height,
          });
        }
      }
    }
  }

  return variants;
}

export function mergeRectCandidates(candidates: Rect[]): Rect[] {
  const merged: Rect[] = [];
  const seen = new Set<string>();
  for (const rect of candidates) {
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(rect);
  }
  return merged;
}

function addTimerCandidateVariant(
  variants: Rect[],
  seen: Set<string>,
  rect: Rect,
  imageData: ImageDataLike,
): void {
  const normalized = normalizeRoi(rect, imageData.width, imageData.height);
  if (!normalized) return;
  const key = `${normalized.x},${normalized.y},${normalized.width},${normalized.height}`;
  if (seen.has(key)) return;
  seen.add(key);
  variants.push(normalized);
}
