import type { RelativeRegion } from "../types";
import { normalizeRegion } from "./regions";

type FixedRegionPreset = {
  sourceIndex: number;
  captureWidth: number;
  captureHeight: number;
  y: number;
  height: number;
};

export type HuntStallFixedRegionCandidate = {
  label: string;
  relativeRegion: RelativeRegion;
};

// User-measured MapleStory EXP text/bar strip positions. The X range is always
// the center 33%-67% of the capture; Y/H are measured per supported capture
// size. For near-identical heights, such as 1368x807 vs 1368x808, the measured
// pixel Y/H are kept instead of being rescaled.
const FIXED_REGION_PRESETS: FixedRegionPreset[] = [
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

export function getFixedWideCandidates(
  videoWidth: number,
  videoHeight: number,
): HuntStallFixedRegionCandidate[] {
  const widthTolerance = Math.max(8, videoWidth * 0.02);
  const heightTolerance = Math.max(80, videoHeight * 0.06);
  return FIXED_REGION_PRESETS
    .filter((preset) => (
      Math.abs(videoWidth - preset.captureWidth) <= widthTolerance &&
      Math.abs(videoHeight - preset.captureHeight) <= heightTolerance
    ))
    .map((preset) => {
      const y = scaleMeasuredY(preset, videoHeight);
      const height = scaleMeasuredHeight(preset, videoHeight);
      return {
        label: `fixed-y-wide ${preset.captureWidth}x${preset.captureHeight} #${preset.sourceIndex}`,
        relativeRegion: normalizeRegion({
          x: 0.33,
          y,
          width: 0.34,
          height,
        }),
      };
    });
}

function scaleMeasuredY(preset: FixedRegionPreset, videoHeight: number): number {
  const y = Math.abs(videoHeight - preset.captureHeight) <= 1
    ? preset.y
    : Math.round((preset.y / preset.captureHeight) * videoHeight);
  return y / Math.max(1, videoHeight);
}

function scaleMeasuredHeight(preset: FixedRegionPreset, videoHeight: number): number {
  const height = Math.abs(videoHeight - preset.captureHeight) <= 1
    ? preset.height
    : Math.max(1, Math.round((preset.height / preset.captureHeight) * videoHeight));
  return Math.max(1, height) / Math.max(1, videoHeight);
}
