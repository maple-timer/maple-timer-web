import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";

export type ExpBarEstimate = {
  percent: number;
  confidence: number;
  fillX0: number;
  fillX1: number;
  trackX0: number;
  trackX1: number;
  y: number;
  supportRows: number;
  sourceLabel: string;
};

type FixedBarPreset = {
  sourceIndex: number;
  captureWidth: number;
  captureHeight: number;
  y: number;
  height: number;
};

export type FixedYExpBarStripRegion = {
  sourceLabel: string;
  y: number;
  height: number;
};

export type FixedYExpBarStripSample = FixedYExpBarStripRegion & {
  imageData: ImageData;
};

export type HuntStallExperienceBarCoverage =
  | "no_bar"
  | "partial_bar"
  | "full_bar"
  | "unknown";

const FIXED_BAR_PRESETS: FixedBarPreset[] = [
  { sourceIndex: 1, captureWidth: 1282, captureHeight: 759, y: 749, height: 7 },
  { sourceIndex: 2, captureWidth: 1282, captureHeight: 759, y: 749, height: 7 },
  { sourceIndex: 3, captureWidth: 1282, captureHeight: 759, y: 749, height: 7 },
  { sourceIndex: 4, captureWidth: 1368, captureHeight: 807, y: 797, height: 7 },
  { sourceIndex: 5, captureWidth: 1368, captureHeight: 807, y: 797, height: 7 },
  { sourceIndex: 6, captureWidth: 1368, captureHeight: 807, y: 797, height: 7 },
  { sourceIndex: 7, captureWidth: 1922, captureHeight: 1119, y: 1105, height: 10 },
  { sourceIndex: 8, captureWidth: 1922, captureHeight: 1119, y: 1105, height: 10 },
  { sourceIndex: 9, captureWidth: 1922, captureHeight: 1119, y: 1109, height: 7 },
  { sourceIndex: 10, captureWidth: 1922, captureHeight: 1239, y: 1229, height: 7 },
  { sourceIndex: 11, captureWidth: 1920, captureHeight: 1200, y: 1186, height: 11 },
  { sourceIndex: 12, captureWidth: 1922, captureHeight: 1239, y: 1224, height: 11 },
  { sourceIndex: 13, captureWidth: 2562, captureHeight: 1479, y: 1461, height: 14 },
  { sourceIndex: 14, captureWidth: 2562, captureHeight: 1479, y: 1461, height: 14 },
  { sourceIndex: 15, captureWidth: 2562, captureHeight: 1479, y: 1460, height: 15 },
  { sourceIndex: 16, captureWidth: 2562, captureHeight: 1639, y: 1620, height: 15 },
  { sourceIndex: 17, captureWidth: 2562, captureHeight: 1639, y: 1619, height: 16 },
  { sourceIndex: 18, captureWidth: 2562, captureHeight: 1639, y: 1619, height: 16 },
  { sourceIndex: 19, captureWidth: 2734, captureHeight: 1575, y: 1556, height: 14 },
  { sourceIndex: 20, captureWidth: 2734, captureHeight: 1575, y: 1556, height: 14 },
  { sourceIndex: 21, captureWidth: 2734, captureHeight: 1575, y: 1556, height: 14 },
  { sourceIndex: 22, captureWidth: 3840, captureHeight: 2160, y: 2142, height: 14 },
  { sourceIndex: 23, captureWidth: 3840, captureHeight: 2160, y: 2134, height: 21 },
  { sourceIndex: 24, captureWidth: 3840, captureHeight: 2160, y: 2134, height: 21 },
  { sourceIndex: 25, captureWidth: 1024, captureHeight: 768, y: 759, height: 7 },
  { sourceIndex: 26, captureWidth: 1026, captureHeight: 807, y: 797, height: 7 },
  { sourceIndex: 27, captureWidth: 1024, captureHeight: 768, y: 759, height: 7 },
];

export function getFixedYExpBarStripRegions(
  sourceWidth: number,
  sourceHeight: number,
): FixedYExpBarStripRegion[] {
  return matchingPresets(sourceWidth, sourceHeight).map((preset) => ({
    sourceLabel: `fixed-full-width-y ${preset.captureWidth}x${preset.captureHeight} #${preset.sourceIndex}`,
    y: scaleMeasuredY(preset, sourceHeight),
    height: scaleMeasuredHeight(preset, sourceHeight),
  }));
}

export function estimateFixedYExpBarFromStrips(
  samples: FixedYExpBarStripSample[],
  sourceWidth: number,
): ExpBarEstimate | null {
  const candidates = samples
    .map((sample) => estimateStrip(sample, sourceWidth))
    .filter((estimate): estimate is ExpBarEstimate => estimate !== null);
  if (!candidates.length) {
    return null;
  }
  return selectBestExpBarEstimate(candidates);
}

function selectBestExpBarEstimate(candidates: ExpBarEstimate[]): ExpBarEstimate {
  return candidates.sort((left, right) => (
    right.confidence - left.confidence ||
    right.supportRows - left.supportRows ||
    Math.abs(50 - right.percent) - Math.abs(50 - left.percent)
  ))[0];
}

export function classifyBarCoverage(
  estimate: ExpBarEstimate | null,
  cropRegion: PixelRegion | null,
): HuntStallExperienceBarCoverage {
  if (!estimate || !cropRegion || estimate.confidence < 0.25) {
    return "unknown";
  }
  if (estimate.fillX1 <= cropRegion.x + 2) {
    return "no_bar";
  }
  if (estimate.fillX1 >= cropRegion.x + cropRegion.width - 2) {
    return "full_bar";
  }
  return "partial_bar";
}

function matchingPresets(sourceWidth: number, sourceHeight: number): FixedBarPreset[] {
  const widthTolerance = Math.max(8, sourceWidth * 0.02);
  const heightTolerance = Math.max(80, sourceHeight * 0.06);
  return FIXED_BAR_PRESETS.filter((preset) => (
    Math.abs(sourceWidth - preset.captureWidth) <= widthTolerance &&
    Math.abs(sourceHeight - preset.captureHeight) <= heightTolerance
  ));
}

function estimateStrip(
  sample: FixedYExpBarStripSample,
  sourceWidth: number,
): ExpBarEstimate | null {
  const { imageData } = sample;
  const rows: Array<{ y: number; start: number; end: number }> = [];
  const maxStart = Math.max(8, Math.round(sourceWidth * 0.006));
  const maxGap = Math.max(8, Math.round(sourceWidth * 0.008));
  const minFill = Math.max(8, Math.round(sourceWidth * 0.004));

  for (let y = 0; y < sample.height; y += 1) {
    const mask = fillMaskForRow(imageData, y);
    const run = prefixEnd(mask, maxStart, maxGap);
    if (!run || run.end - run.start < minFill) {
      continue;
    }
    rows.push({ y: sample.y + y, start: run.start, end: run.end });
  }

  const clustered = clusterEndPositions(rows);
  if (!clustered.length) {
    return null;
  }

  const endValues = clustered.map((row) => row.end);
  const startValues = clustered.map((row) => row.start);
  const yValues = clustered.map((row) => row.y);
  const fillX0 = Math.round(median(startValues));
  const fillX1 = Math.max(fillX0 + 1, Math.min(sourceWidth, Math.round(median(endValues))));
  const ratio = fillX1 / Math.max(1, sourceWidth);
  const spread = median(endValues.map((value) => Math.abs(value - median(endValues)))) / Math.max(1, sourceWidth);
  const rowSupport = Math.min(1, clustered.length / 6);
  const consistency = Math.max(0, 1 - spread * 80);
  const lengthFactor = Math.min(1, Math.max(0.35, (fillX1 - fillX0) / Math.max(25, sourceWidth * 0.03)));

  return {
    percent: Math.max(0, Math.min(100, ratio * 100)),
    confidence: Math.max(0, Math.min(1, rowSupport * consistency * lengthFactor)),
    fillX0,
    fillX1,
    trackX0: 0,
    trackX1: sourceWidth,
    y: Math.round(median(yValues)),
    supportRows: clustered.length,
    sourceLabel: sample.sourceLabel,
  };
}

function fillMaskForRow(imageData: ImageData, y: number): Uint8Array {
  const { width, data } = imageData;
  const mask = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const maxValue = Math.max(red, green, blue);
    const minValue = Math.min(red, green, blue);
    const sat = maxValue - minValue;
    const brightColored = maxValue > 90 && sat > 25;
    const yellowGreen = green > 120 && red > 110 && blue < 120 && green >= red - 45;
    const pinkPurple = red > 135 && blue > 135 && sat > 22;
    const cyanGreen = green > 120 && blue > 110 && green >= red + 20;
    mask[x] = brightColored || yellowGreen || pinkPurple || cyanGreen ? 1 : 0;
  }
  return mask;
}

function prefixEnd(mask: Uint8Array, maxStart: number, maxGap: number): { start: number; end: number } | null {
  let start: number | null = null;
  let end: number | null = null;
  let gap = 0;
  for (let x = 0; x < mask.length; x += 1) {
    if (mask[x]) {
      if (start === null) {
        start = x;
        if (start > maxStart) {
          return null;
        }
      }
      end = x;
      gap = 0;
      continue;
    }
    if (start === null) {
      continue;
    }
    gap += 1;
    if (gap > maxGap) {
      break;
    }
  }
  if (start === null || end === null) {
    return null;
  }
  return { start, end: end + 1 };
}

function clusterEndPositions(rows: Array<{ y: number; start: number; end: number }>): Array<{ y: number; start: number; end: number }> {
  if (!rows.length) {
    return [];
  }
  const ends = rows.map((row) => row.end);
  const center = median(ends);
  const tolerance = Math.max(5, percentile(ends.map((end) => Math.abs(end - center)), 75) * 3);
  return rows.filter((row) => Math.abs(row.end - center) <= tolerance);
}

function scaleMeasuredY(preset: FixedBarPreset, sourceHeight: number): number {
  if (Math.abs(sourceHeight - preset.captureHeight) <= 1) {
    return preset.y;
  }
  return Math.round((preset.y / preset.captureHeight) * sourceHeight);
}

function scaleMeasuredHeight(preset: FixedBarPreset, sourceHeight: number): number {
  if (Math.abs(sourceHeight - preset.captureHeight) <= 1) {
    return preset.height;
  }
  return Math.max(1, Math.round((preset.height / preset.captureHeight) * sourceHeight));
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((percentileValue / 100) * (sorted.length - 1))));
  return sorted[index];
}
