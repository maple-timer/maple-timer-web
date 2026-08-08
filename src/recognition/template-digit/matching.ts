import {
  DIGIT_TEMPLATES,
  MAPLE_DIGIT_TEMPLATES,
  MAPLE_TEXT_TEMPLATES,
  SEGMENT_PATTERNS,
  SEGMENT_ZONES,
  type SegmentKey,
} from "./templates";
import type { DigitBox } from "./segmentation";

type BoxRecognition = {
  text: string;
  confidence: number;
};

export function recognizeBox(
  imageData: ImageData,
  box: DigitBox,
  totalBoxes: number,
) {
  if (shouldTryTextTemplate(imageData, box, totalBoxes)) {
    const mapleText = recognizeMapleText(imageData, box);
    if (mapleText.confidence >= 0.78) {
      return mapleText;
    }
  }

  const segmented = recognizeCooldownSegmentDigit(imageData, box);
  if (segmented.digit === 7 && segmented.confidence >= 0.8) {
    return { text: "7", confidence: segmented.confidence };
  }

  const mapleDigit = recognizeMapleDigit(imageData, box);
  if (mapleDigit.confidence >= 0.7) {
    return { text: String(mapleDigit.digit), confidence: mapleDigit.confidence };
  }

  if (segmented.confidence >= 0.68) {
    return { text: String(segmented.digit), confidence: segmented.confidence };
  }

  const normalized = normalizeBoxToBitmap(imageData, box);
  let best = { digit: 0, confidence: 0 };

  for (const template of DIGIT_TEMPLATES) {
    const confidence = compareBitmaps(normalized, template.bitmap);
    if (confidence > best.confidence) {
      best = { digit: template.digit, confidence };
    }
  }

  return { text: String(best.digit), confidence: best.confidence };
}

function shouldTryTextTemplate(
  imageData: ImageData,
  box: { x: number; width: number; height: number },
  totalBoxes: number,
): boolean {
  const widthRatio = box.width / Math.max(1, box.height);

  return widthRatio >= 0.5 && totalBoxes === 1 && imageData.width > 0;
}

function recognizeMapleText(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
): BoxRecognition {
  const normalized = normalizeBoxToBitmap(imageData, box, 9, 13, 0.16);

  return MAPLE_TEXT_TEMPLATES.reduce(
    (best, template) => {
      const confidence = compareInkBitmaps(normalized, template.bitmap);
      return confidence > best.confidence ? { text: template.text, confidence } : best;
    },
    { text: "", confidence: 0 },
  );
}

function recognizeMapleDigit(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
) {
  const normalized = normalizeBoxToBitmap(imageData, box, 9, 13, 0.16);

  return MAPLE_DIGIT_TEMPLATES.reduce(
    (best, template) => {
      const confidence = compareInkBitmaps(normalized, template.bitmap);
      return confidence > best.confidence
        ? { digit: template.digit, confidence }
        : best;
    },
    { digit: 0, confidence: 0 },
  );
}

function recognizeCooldownSegmentDigit(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
) {
  const widthRatio = box.width / Math.max(1, box.height);
  const segments = readSegmentOccupancy(imageData, box);

  if (widthRatio <= 0.34) {
    return { digit: 1, confidence: 0.9 };
  }

  if (
    segments.c >= 0.75 &&
    segments.f >= 0.7 &&
    segments.d >= 0.65 &&
    segments.e - segments.b >= 0.35 &&
    segments.g <= 0.86
  ) {
    return { digit: 4, confidence: 0.84 };
  }

  if (
    segments.a >= 0.75 &&
    segments.c >= 0.65 &&
    segments.f <= 0.28 &&
    segments.e >= 0.45 &&
    segments.g <= 0.58
  ) {
    return { digit: 7, confidence: 0.82 };
  }

  if (
    segments.a >= 0.55 &&
    segments.c >= 0.55 &&
    segments.g >= 0.62 &&
    segments.f <= 0.28 &&
    segments.b <= 0.28
  ) {
    return { digit: 2, confidence: 0.78 };
  }

  if (
    segments.a >= 0.55 &&
    segments.c >= 0.7 &&
    segments.d >= 0.62 &&
    segments.f >= 0.7 &&
    segments.g >= 0.62 &&
    segments.b <= 0.28
  ) {
    return { digit: 3, confidence: 0.82 };
  }

  if (
    segments.a >= 0.62 &&
    segments.b >= 0.62 &&
    segments.d >= 0.62 &&
    segments.f >= 0.7 &&
    segments.g >= 0.62 &&
    segments.c <= 0.45
  ) {
    return { digit: 5, confidence: 0.82 };
  }

  const best = Object.entries(SEGMENT_PATTERNS).reduce(
    (currentBest, [digit, enabledSegments]) => {
      const score =
        (Object.keys(SEGMENT_ZONES) as SegmentKey[]).reduce((total, key) => {
          const expected = enabledSegments.includes(key);
          const occupancy = segments[key];
          return total + (expected ? occupancy : (1 - occupancy) * 0.65);
        }, 0) / 7;

      return score > currentBest.confidence
        ? { digit: Number(digit), confidence: score }
        : currentBest;
    },
    { digit: 0, confidence: 0 },
  );

  return best;
}

function readSegmentOccupancy(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
): Record<SegmentKey, number> {
  return Object.fromEntries(
    (Object.entries(SEGMENT_ZONES) as Array<[SegmentKey, [number, number, number, number]]>).map(
      ([key, zone]) => [key, getZoneOccupancy(imageData, box, zone)],
    ),
  ) as Record<SegmentKey, number>;
}

function getZoneOccupancy(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
  [x1, y1, x2, y2]: [number, number, number, number],
): number {
  const startX = Math.floor(box.x + x1 * box.width);
  const endX = Math.max(startX + 1, Math.ceil(box.x + x2 * box.width));
  const startY = Math.floor(box.y + y1 * box.height);
  const endY = Math.max(startY + 1, Math.ceil(box.y + y2 * box.height));

  let ink = 0;
  let total = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      total++;
      if (imageData.data[(y * imageData.width + x) * 4] > 0) {
        ink++;
      }
    }
  }

  return total > 0 ? ink / total : 0;
}

function normalizeBoxToBitmap(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
  targetWidth = 5,
  targetHeight = 7,
  inkThreshold = 0.22,
): string[] {
  const rows: string[] = [];

  for (let gy = 0; gy < targetHeight; gy++) {
    let row = "";
    for (let gx = 0; gx < targetWidth; gx++) {
      const startX = Math.floor(box.x + (gx / targetWidth) * box.width);
      const endX = Math.max(startX + 1, Math.floor(box.x + ((gx + 1) / targetWidth) * box.width));
      const startY = Math.floor(box.y + (gy / targetHeight) * box.height);
      const endY = Math.max(startY + 1, Math.floor(box.y + ((gy + 1) / targetHeight) * box.height));

      let ink = 0;
      let total = 0;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          total++;
          if (imageData.data[(y * imageData.width + x) * 4] > 0) {
            ink++;
          }
        }
      }
      row += ink / total > inkThreshold ? "1" : "0";
    }
    rows.push(row);
  }

  return rows;
}

function compareBitmaps(a: string[], b: string[]): number {
  let matches = 0;
  let total = 0;
  for (let y = 0; y < a.length; y++) {
    for (let x = 0; x < a[y].length; x++) {
      total++;
      if (a[y][x] === b[y][x]) {
        matches++;
      }
    }
  }
  return matches / total;
}

function compareInkBitmaps(a: string[], b: string[]): number {
  let intersection = 0;
  let union = 0;
  let backgroundMatches = 0;
  let backgroundTotal = 0;

  for (let y = 0; y < a.length; y++) {
    for (let x = 0; x < a[y].length; x++) {
      const aInk = a[y][x] === "1";
      const bInk = b[y][x] === "1";

      if (aInk || bInk) {
        union++;
        if (aInk && bInk) {
          intersection++;
        }
      } else {
        backgroundTotal++;
        backgroundMatches++;
      }
    }
  }

  const foregroundScore = union > 0 ? intersection / union : 0;
  const backgroundScore = backgroundTotal > 0 ? backgroundMatches / backgroundTotal : 1;
  return foregroundScore * 0.82 + backgroundScore * 0.18;
}
