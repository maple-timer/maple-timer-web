type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

const TOP_EDGE_TIMER_TEXT_SCAN_ROWS = 12;
const TOP_EDGE_TIMER_TEXT_MIN_PIXELS = 8;
const TOP_EDGE_TIMER_TEXT_MAX_BODY_PIXELS = 48;

export function hasTopEdgeTimerTextSignal(icon: ImageDataLike): boolean {
  if (!icon.width || !icon.height) {
    return false;
  }

  let strictTextPixels = 0;
  const scanRows = Math.min(TOP_EDGE_TIMER_TEXT_SCAN_ROWS, icon.height);
  for (let y = 0; y < scanRows; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const offset = (y * icon.width + x) * 4;
      if (isStrictTimerTextPixel(icon.data, offset)) {
        strictTextPixels += 1;
      }
    }
  }

  if (strictTextPixels < TOP_EDGE_TIMER_TEXT_MIN_PIXELS) {
    return false;
  }

  let bodyPixels = 0;
  for (let y = scanRows; y < icon.height; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const offset = (y * icon.width + x) * 4;
      if (isStrongIconBodyPixel(icon.data, offset)) {
        bodyPixels += 1;
        if (bodyPixels >= TOP_EDGE_TIMER_TEXT_MAX_BODY_PIXELS) {
          return false;
        }
      }
    }
  }

  return true;
}

function isStrictTimerTextPixel(data: Uint8ClampedArray, offset: number): boolean {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const yellow = r > 150 && g > 135 && b < 90 && r + g > b * 2.6;
  const white = max > 205 && max - min < 45;
  return yellow || white;
}

function isStrongIconBodyPixel(data: Uint8ClampedArray, offset: number): boolean {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const a = data[offset + 3];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return a > 40 && max > 80 && max - min > 60;
}
