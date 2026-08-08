type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export function compareBuffBodyIdentity(
  detectedIcon: ImageDataLike,
  referenceIcon: ImageDataLike,
): number {
  if (
    detectedIcon.width !== referenceIcon.width ||
    detectedIcon.height !== referenceIcon.height
  ) {
    return 0;
  }

  let weightedDistance = 0;
  let totalWeight = 0;
  const width = detectedIcon.width;
  const height = detectedIcon.height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const detectedAlpha = detectedIcon.data[offset + 3] / 255;
      const referenceAlpha = referenceIcon.data[offset + 3] / 255;
      if (detectedAlpha <= 0.01 && referenceAlpha <= 0.01) {
        continue;
      }

      const timerArea = isCountdownTimerArea(x, y, width, height);
      if (
        timerArea &&
        (isDigitLike(detectedIcon.data, offset) ||
          isDigitLike(referenceIcon.data, offset))
      ) {
        continue;
      }

      const alphaWeight = 0.25 + Math.max(detectedAlpha, referenceAlpha) * 0.75;
      const timerWeight = timerArea ? 0.55 : 1;
      const colorDistance = rgbDistance(
        detectedIcon.data,
        referenceIcon.data,
        offset,
      );
      const lumaDistance =
        Math.abs(lumaAt(detectedIcon.data, offset) - lumaAt(referenceIcon.data, offset)) /
        255;
      weightedDistance +=
        (colorDistance * 0.72 + lumaDistance * 0.28) *
        alphaWeight *
        timerWeight;
      totalWeight += alphaWeight * timerWeight;
    }
  }

  return clamp(1 - (totalWeight ? weightedDistance / totalWeight : 1), 0, 1);
}

function isCountdownTimerArea(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return x > width * 0.05 && x < width * 0.95 && y > height * 0.25 && y < height * 0.82;
}

function isDigitLike(data: Uint8ClampedArray, offset: number): boolean {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const yellow = r > 120 && g > 115 && b < 125 && r + g > b * 2.15;
  const white = max > 178 && max - min < 78;
  return yellow || white;
}

function rgbDistance(
  detected: Uint8ClampedArray,
  reference: Uint8ClampedArray,
  offset: number,
): number {
  const dr = detected[offset] - reference[offset];
  const dg = detected[offset + 1] - reference[offset + 1];
  const db = detected[offset + 2] - reference[offset + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.6729559300637;
}

function lumaAt(data: Uint8ClampedArray, offset: number): number {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
