export type HuntStallCooldownVisualActivity = {
  fingerprint: string;
  gridColumns: number;
  gridRows: number;
  foregroundRatio: number;
};

const COOLDOWN_VISUAL_GRID_COLUMNS = 16;
const COOLDOWN_VISUAL_GRID_ROWS = 16;
const COOLDOWN_VISUAL_MAX_LEVEL = 15;
export const COOLDOWN_VISUAL_ACTIVITY_THRESHOLD = 0.018;

export function createHuntStallCooldownVisualActivity(
  imageData: ImageData,
): HuntStallCooldownVisualActivity {
  const { data, width, height } = imageData;
  const cells: string[] = [];
  let foregroundPixels = 0;

  for (let row = 0; row < COOLDOWN_VISUAL_GRID_ROWS; row += 1) {
    const yStart = Math.floor((row / COOLDOWN_VISUAL_GRID_ROWS) * height);
    const yEnd = Math.max(
      yStart + 1,
      Math.floor(((row + 1) / COOLDOWN_VISUAL_GRID_ROWS) * height),
    );

    for (let col = 0; col < COOLDOWN_VISUAL_GRID_COLUMNS; col += 1) {
      const xStart = Math.floor((col / COOLDOWN_VISUAL_GRID_COLUMNS) * width);
      const xEnd = Math.max(
        xStart + 1,
        Math.floor(((col + 1) / COOLDOWN_VISUAL_GRID_COLUMNS) * width),
      );
      let totalSignal = 0;
      let pixelCount = 0;

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const index = (y * width + x) * 4;
          const alpha = data[index + 3] / 255;
          const red = data[index] / 255;
          const green = data[index + 1] / 255;
          const blue = data[index + 2] / 255;
          const maxChannel = Math.max(red, green, blue);
          const minChannel = Math.min(red, green, blue);
          const saturation = maxChannel - minChannel;
          const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          const signal = alpha * (luma * 0.82 + saturation * 0.18);
          totalSignal += signal;
          pixelCount += 1;

          if (alpha > 0.1 && (luma > 0.42 || saturation > 0.18)) {
            foregroundPixels += 1;
          }
        }
      }

      const level = Math.max(
        0,
        Math.min(
          COOLDOWN_VISUAL_MAX_LEVEL,
          Math.round((totalSignal / Math.max(1, pixelCount)) * COOLDOWN_VISUAL_MAX_LEVEL),
        ),
      );
      cells.push(level.toString(16));
    }
  }

  return {
    fingerprint: cells.join(""),
    gridColumns: COOLDOWN_VISUAL_GRID_COLUMNS,
    gridRows: COOLDOWN_VISUAL_GRID_ROWS,
    foregroundRatio: foregroundPixels / Math.max(1, width * height),
  };
}

export function getHuntStallCooldownVisualChangeScore(
  previousFingerprint: string | null | undefined,
  current: HuntStallCooldownVisualActivity | null | undefined,
): number | null {
  if (!previousFingerprint || !current?.fingerprint) {
    return null;
  }

  const length = Math.min(previousFingerprint.length, current.fingerprint.length);
  if (length === 0) {
    return null;
  }

  let weightedDifference = 0;
  let totalWeight = 0;
  const columns = Math.max(1, current.gridColumns);
  const rows = Math.max(1, current.gridRows);

  for (let index = 0; index < length; index += 1) {
    const previousLevel = Number.parseInt(previousFingerprint[index], 16);
    const currentLevel = Number.parseInt(current.fingerprint[index], 16);
    if (!Number.isFinite(previousLevel) || !Number.isFinite(currentLevel)) {
      continue;
    }

    const col = index % columns;
    const row = Math.floor(index / columns);
    const dx = (col + 0.5) / columns - 0.5;
    const dy = (row + 0.5) / rows - 0.5;
    const centerDistance = Math.sqrt(dx * dx + dy * dy);
    const centerWeight = Math.max(0, 1 - centerDistance / 0.58);
    const weight = 1 + centerWeight * 1.15;
    weightedDifference +=
      (Math.abs(previousLevel - currentLevel) / COOLDOWN_VISUAL_MAX_LEVEL) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedDifference / totalWeight : null;
}

export function isHuntStallCooldownVisualActivity(score: number | null | undefined): boolean {
  return typeof score === "number" && score >= COOLDOWN_VISUAL_ACTIVITY_THRESHOLD;
}
