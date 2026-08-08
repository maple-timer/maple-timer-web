const FINGERPRINT_COLUMNS = 48;
const FINGERPRINT_ROWS = 10;

export function getFingerprintDifference(previous: string, next: string): number {
  const length = Math.min(previous.length, next.length);
  if (length === 0) {
    return previous === next ? 0 : 1;
  }

  let changed = Math.abs(previous.length - next.length);
  for (let index = 0; index < length; index += 1) {
    if (previous[index] !== next[index]) {
      changed += 1;
    }
  }

  return changed / Math.max(previous.length, next.length);
}

export function createExperienceFingerprint(imageData: ImageData): string {
  let fingerprint = "";

  for (let gy = 0; gy < FINGERPRINT_ROWS; gy += 1) {
    for (let gx = 0; gx < FINGERPRINT_COLUMNS; gx += 1) {
      const startX = Math.floor((gx / FINGERPRINT_COLUMNS) * imageData.width);
      const endX = Math.max(
        startX + 1,
        Math.floor(((gx + 1) / FINGERPRINT_COLUMNS) * imageData.width),
      );
      const startY = Math.floor((gy / FINGERPRINT_ROWS) * imageData.height);
      const endY = Math.max(
        startY + 1,
        Math.floor(((gy + 1) / FINGERPRINT_ROWS) * imageData.height),
      );
      let foreground = 0;
      let total = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          total += 1;
          if (imageData.data[(y * imageData.width + x) * 4] > 0) {
            foreground += 1;
          }
        }
      }

      fingerprint += foreground / Math.max(1, total) >= 0.08 ? "1" : "0";
    }
  }

  return fingerprint;
}
