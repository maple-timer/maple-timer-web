import type { RuneCandidate } from "../recognition/rune/runeDetectionTypes";
import { rgbToHsv } from "./runeMask";

const SCAN_SIZES = [9, 11, 13, 15] as const;
const SCAN_STEP = 2;
const MAX_DIAMOND_SCAN_CANDIDATES = 14;
const MIN_DIAMOND_SCAN_SCORE = 0.78;

type DiamondScanScore = {
  score: number;
  purplePixels: number;
  brightPurplePixels: number;
  purpleRatio: number;
  borderLightRatio: number;
  hasDiamondTaper: boolean;
  hasNarrowDiamondTips: boolean;
  hasDiamondShoulders: boolean;
};

export function collectRuneDiamondScanCandidates(
  imageData: ImageData,
  existingCandidates: RuneCandidate[] = [],
): RuneCandidate[] {
  const candidates: RuneCandidate[] = [];

  for (const size of SCAN_SIZES) {
    const radius = Math.floor(size / 2);
    for (let centerY = radius; centerY < imageData.height - radius; centerY += SCAN_STEP) {
      for (let centerX = radius; centerX < imageData.width - radius; centerX += SCAN_STEP) {
        const score = scoreDiamondWindow(imageData, centerX, centerY, size);
        if (!isStrongDiamondWindow(score)) {
          continue;
        }

        const candidate: RuneCandidate = {
          x: centerX - radius,
          y: centerY - radius,
          width: size,
          height: size,
          pixelCount: score.purplePixels,
          confidence: score.score,
          source: "diamond-scan",
        };
        if (
          existingCandidates.some((existing) => overlapsCandidate(existing, candidate)) ||
          candidates.some((existing) => overlapsCandidate(existing, candidate))
        ) {
          continue;
        }
        candidates.push(candidate);
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, MAX_DIAMOND_SCAN_CANDIDATES);
}

function isStrongDiamondWindow(score: DiamondScanScore): boolean {
  return (
    score.score >= MIN_DIAMOND_SCAN_SCORE &&
    score.hasDiamondTaper &&
    score.hasNarrowDiamondTips &&
    score.hasDiamondShoulders &&
    score.purplePixels >= 8 &&
    score.brightPurplePixels >= 2 &&
    score.purpleRatio >= 0.88 &&
    score.borderLightRatio >= 0.12
  );
}

function scoreDiamondWindow(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  size: number,
): DiamondScanScore {
  const radius = (size - 1) / 2;
  const rowPurpleWidths: number[] = [];
  let purplePixels = 0;
  let brightPurplePixels = 0;
  let diamondAreaPixels = 0;
  let outsidePurplePixels = 0;
  let borderPixels = 0;
  let lightBorderPixels = 0;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    let rowPurpleWidth = 0;
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const x = Math.round(centerX + offsetX);
      const y = Math.round(centerY + offsetY);
      if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
        continue;
      }

      const index = (y * imageData.width + x) * 4;
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      const diamondDistance = (Math.abs(offsetX) + Math.abs(offsetY)) / radius;
      const isInsideDiamond = diamondDistance <= 1.05;
      const isBorderBand = diamondDistance >= 0.72 && diamondDistance <= 1.35;

      if (isInsideDiamond) {
        diamondAreaPixels += 1;
        if (isLooseRunePurple(red, green, blue)) {
          purplePixels += 1;
          rowPurpleWidth += 1;
        }
        if (isBrightRunePurple(red, green, blue)) {
          brightPurplePixels += 1;
        }
      } else if (isLooseRunePurple(red, green, blue)) {
        outsidePurplePixels += 1;
      }

      if (isBorderBand) {
        borderPixels += 1;
        if (isLightRuneBorder(red, green, blue)) {
          lightBorderPixels += 1;
        }
      }
    }
    rowPurpleWidths.push(rowPurpleWidth);
  }

  const maxRowWidth = Math.max(1, ...rowPurpleWidths);
  const middleRowWidth = rowPurpleWidths[Math.floor(rowPurpleWidths.length / 2)] ?? 0;
  const topEdgeWidth = rowPurpleWidths[0] ?? 0;
  const topNearEdgeWidth = rowPurpleWidths[1] ?? 0;
  const bottomEdgeWidth = rowPurpleWidths[rowPurpleWidths.length - 1] ?? 0;
  const bottomNearEdgeWidth = rowPurpleWidths[rowPurpleWidths.length - 2] ?? 0;
  const hasDiamondTaper =
    middleRowWidth / maxRowWidth >= 0.7 &&
    topNearEdgeWidth / maxRowWidth <= 0.75 &&
    bottomNearEdgeWidth / maxRowWidth <= 0.75;
  const hasNarrowDiamondTips =
    topEdgeWidth / maxRowWidth <= 0.7 &&
    bottomEdgeWidth / maxRowWidth <= 0.7;
  const hasDiamondShoulders = topEdgeWidth >= 1 && bottomEdgeWidth >= 1;
  const purpleRatio = purplePixels / Math.max(1, diamondAreaPixels);
  const outsidePurpleRatio =
    outsidePurplePixels / Math.max(1, size * size - diamondAreaPixels);
  const borderLightRatio = lightBorderPixels / Math.max(1, borderPixels);
  const score =
    purpleRatio * 0.42 +
    Math.min(1, brightPurplePixels / 8) * 0.28 +
    (hasDiamondTaper ? 0.18 : 0) +
    Math.min(1, borderLightRatio / 0.18) * 0.12 -
    Math.min(0.2, outsidePurpleRatio * 0.4);

  return {
    score,
    purplePixels,
    brightPurplePixels,
    purpleRatio,
    borderLightRatio,
    hasDiamondTaper,
    hasNarrowDiamondTips,
    hasDiamondShoulders,
  };
}

function isLooseRunePurple(red: number, green: number, blue: number): boolean {
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  return (
    hue >= 235 &&
    hue <= 325 &&
    saturation >= 0.18 &&
    value >= 0.22 &&
    blue > green * 1.02 &&
    red > green * 0.65
  );
}

function isBrightRunePurple(red: number, green: number, blue: number): boolean {
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  return (
    hue >= 255 &&
    hue <= 315 &&
    saturation >= 0.25 &&
    value >= 0.45 &&
    blue > green * 1.05 &&
    red > green * 0.72
  );
}

function isLightRuneBorder(red: number, green: number, blue: number): boolean {
  const { saturation, value } = rgbToHsv(red, green, blue);
  return value >= 0.55 && Math.min(red, green, blue) >= 65 && saturation <= 0.62;
}

function overlapsCandidate(a: RuneCandidate, b: RuneCandidate): boolean {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return overlapArea / Math.max(1, smallerArea) > 0.55;
}
