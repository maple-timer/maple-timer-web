import type { ImageDataLike, PixelArray, Rect } from "./timerTypes";

export type TimerPanelGeometryOptions = {
  minRectWidth?: number;
  minRectHeight?: number;
};

type DarkTimerPanelComponent = Rect & {
  count: number;
  density: number;
};

export function findDarkTimerPanelCandidates(
  imageData: ImageDataLike,
  roi: Rect,
  settings: TimerPanelGeometryOptions = {},
): Rect[] {
  const area = roi.width * roi.height;
  const darkMask = new Uint8Array(area);
  const visited = new Uint8Array(area);

  for (let localY = 0; localY < roi.height; localY += 1) {
    for (let localX = 0; localX < roi.width; localX += 1) {
      const offset = ((roi.y + localY) * imageData.width + roi.x + localX) * 4;
      if (isTimerPanelDarkPixel(imageData.data, offset))
        darkMask[localY * roi.width + localX] = 1;
    }
  }

  const minPixelCount = Math.max(80, Math.round(area * 0.0005));
  const candidates: DarkTimerPanelComponent[] = [];
  for (let index = 0; index < area; index += 1) {
    if (!darkMask[index] || visited[index]) continue;
    const component = floodDarkComponent(index, darkMask, visited, roi);
    if (component.count < minPixelCount) continue;
    if (!isDarkTimerPanelCandidate(component, imageData, settings)) continue;
    candidates.push(component);
  }

  candidates.sort(
    (a, b) =>
      scoreDarkTimerPanel(b, imageData) - scoreDarkTimerPanel(a, imageData),
  );
  return candidates.map(({ x, y, width, height }) => ({ x, y, width, height }));
}

function floodDarkComponent(
  startIndex: number,
  darkMask: Uint8Array,
  visited: Uint8Array,
  roi: Rect,
): DarkTimerPanelComponent {
  const stack = [startIndex];
  visited[startIndex] = 1;
  let count = 0;
  let minLocalX = roi.width;
  let minLocalY = roi.height;
  let maxLocalX = -1;
  let maxLocalY = -1;

  while (stack.length) {
    const index = stack.pop() as number;
    const localX = index % roi.width;
    const localY = Math.floor(index / roi.width);
    count += 1;
    minLocalX = Math.min(minLocalX, localX);
    minLocalY = Math.min(minLocalY, localY);
    maxLocalX = Math.max(maxLocalX, localX);
    maxLocalY = Math.max(maxLocalY, localY);

    for (const nextIndex of [
      index - 1,
      index + 1,
      index - roi.width,
      index + roi.width,
    ]) {
      if (nextIndex < 0 || nextIndex >= darkMask.length) continue;
      const nextX = nextIndex % roi.width;
      if (Math.abs(nextX - localX) > 1) continue;
      if (!darkMask[nextIndex] || visited[nextIndex]) continue;
      visited[nextIndex] = 1;
      stack.push(nextIndex);
    }
  }

  const width = maxLocalX - minLocalX + 1;
  const height = maxLocalY - minLocalY + 1;
  return {
    x: roi.x + minLocalX,
    y: roi.y + minLocalY,
    width,
    height,
    count,
    density: count / Math.max(1, width * height),
  };
}

function isTimerPanelDarkPixel(data: PixelArray, offset: number): boolean {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return Math.max(red, green, blue) < 55 && red + green + blue < 120;
}

function isDarkTimerPanelCandidate(
  rect: DarkTimerPanelComponent,
  imageData: ImageDataLike,
  settings: TimerPanelGeometryOptions,
): boolean {
  return (
    isMapleTimerPanelShape(rect, imageData, settings) && rect.density >= 0.35
  );
}

export function isMapleTimerPanelShape(
  rect: Rect,
  imageData: ImageDataLike,
  settings: TimerPanelGeometryOptions = {},
): boolean {
  const aspect = rect.width / Math.max(1, rect.height);
  const centerXRatio = (rect.x + rect.width / 2) / imageData.width;
  const minRectWidth = settings.minRectWidth ?? 1;
  const minRectHeight = settings.minRectHeight ?? 1;
  const minWidth = Math.max(
    minRectWidth,
    Math.min(80, Math.round(imageData.width * 0.035)),
  );
  const maxWidth = Math.max(
    minWidth,
    Math.min(
      imageData.width,
      Math.max(360, Math.round(imageData.width * 0.24)),
    ),
  );
  const minHeight = Math.max(
    minRectHeight,
    Math.min(24, Math.round(imageData.height * 0.02)),
  );
  const maxHeight = Math.max(
    minHeight,
    Math.min(
      imageData.height,
      Math.max(90, Math.round(imageData.height * 0.075)),
    ),
  );

  return (
    rect.width >= minWidth &&
    rect.width <= maxWidth &&
    rect.height >= minHeight &&
    rect.height <= maxHeight &&
    aspect >= 2.8 &&
    aspect <= 6.8 &&
    centerXRatio >= 0.33 &&
    centerXRatio <= 0.67
  );
}

export function isMapleTimerPanelFragment(
  rect: Rect,
  imageData: ImageDataLike,
  settings: TimerPanelGeometryOptions = {},
): boolean {
  const aspect = rect.width / Math.max(1, rect.height);
  const centerXRatio = (rect.x + rect.width / 2) / imageData.width;
  const minRectWidth = settings.minRectWidth ?? 1;
  const minRectHeight = settings.minRectHeight ?? 1;
  const minWidth = Math.max(
    minRectWidth,
    Math.min(36, Math.round(imageData.width * 0.018)),
  );
  const maxWidth = Math.max(
    minWidth,
    Math.min(
      imageData.width,
      Math.max(180, Math.round(imageData.width * 0.12)),
    ),
  );
  const minHeight = Math.max(
    minRectHeight,
    Math.min(24, Math.round(imageData.height * 0.02)),
  );
  const maxHeight = Math.max(
    minHeight,
    Math.min(
      imageData.height,
      Math.max(90, Math.round(imageData.height * 0.075)),
    ),
  );

  return (
    rect.width >= minWidth &&
    rect.width <= maxWidth &&
    rect.height >= minHeight &&
    rect.height <= maxHeight &&
    aspect >= 0.9 &&
    aspect < 2.8 &&
    centerXRatio >= 0.33 &&
    centerXRatio <= 0.67
  );
}

function scoreDarkTimerPanel(rect: Rect, imageData: ImageDataLike): number {
  const aspect = rect.width / Math.max(1, rect.height);
  const aspectScore = Math.max(0, 1 - Math.abs(aspect - 4.5) / 4.5);
  const centerXRatio = (rect.x + rect.width / 2) / imageData.width;
  const centerScore = Math.max(0, 1 - Math.abs(centerXRatio - 0.5) / 0.5);
  return (
    aspectScore * 10 +
    centerScore * 5 +
    (rect.width * rect.height) / Math.max(1, imageData.width * imageData.height)
  );
}
