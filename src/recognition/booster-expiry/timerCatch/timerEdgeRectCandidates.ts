import { clampNumber } from "./timerImage";
import type { ImageDataLike, Rect, TimerRectOptions } from "./timerTypes";

type TimerEdgeRectSettings = Required<
  Pick<
    TimerRectOptions,
    "minRectWidth" | "minRectHeight" | "sobelThresholdRatio"
  >
>;

type HorizontalEdgeRun = {
  x: number;
  y: number;
  width: number;
};

type VerticalEdgeRun = {
  x: number;
  y: number;
  height: number;
};

export function makeSobelEdgeMask(
  imageData: ImageDataLike,
  roi: Rect,
  options: TimerRectOptions = {},
) {
  const settings = makeTimerEdgeRectSettings(options);
  const width = roi.width;
  const height = roi.height;
  const magnitudes = new Float32Array(width * height);
  let maxMagnitude = 0;

  for (let localY = 1; localY < height - 1; localY += 1) {
    for (let localX = 1; localX < width - 1; localX += 1) {
      const x = roi.x + localX;
      const y = roi.y + localY;
      const topLeft = redAt(imageData, x - 1, y - 1);
      const top = redAt(imageData, x, y - 1);
      const topRight = redAt(imageData, x + 1, y - 1);
      const left = redAt(imageData, x - 1, y);
      const right = redAt(imageData, x + 1, y);
      const bottomLeft = redAt(imageData, x - 1, y + 1);
      const bottom = redAt(imageData, x, y + 1);
      const bottomRight = redAt(imageData, x + 1, y + 1);
      const gx =
        -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gy =
        topLeft + 2 * top + topRight - bottomLeft - 2 * bottom - bottomRight;
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      magnitudes[localY * width + localX] = magnitude;
      if (magnitude > maxMagnitude) maxMagnitude = magnitude;
    }
  }

  const data = new Uint8Array(width * height);
  const threshold = maxMagnitude * settings.sobelThresholdRatio;
  if (threshold > 0) {
    for (let index = 0; index < magnitudes.length; index += 1) {
      if (magnitudes[index] > threshold) data[index] = 1;
    }
  }

  return {
    width,
    height,
    data,
    maxMagnitude,
  };
}

export function findEdgeRectCandidates(
  edgeMask: { width: number; height: number; data: Uint8Array },
  roi: Rect,
  options: TimerRectOptions = {},
): Rect[] {
  const settings = makeTimerEdgeRectSettings(options);
  const hEdges = findHorizontalEdgeRuns(edgeMask, roi, settings.minRectWidth);
  const vEdges = findVerticalEdgeRuns(edgeMask, roi, settings.minRectHeight);
  const rects: Rect[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < hEdges.length; i += 1) {
    for (let j = i + 1; j < hEdges.length; j += 1) {
      const rect = makeRectFromEdgePair(hEdges[i], hEdges[j], vEdges, settings);
      if (!rect) continue;
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rects.push(rect);
    }
  }

  return removeContainedRects(rects).sort(
    (a, b) => a.y - b.y || a.x - b.x || b.width * b.height - a.width * a.height,
  );
}

function makeTimerEdgeRectSettings(
  options: TimerRectOptions,
): TimerEdgeRectSettings {
  return {
    minRectWidth: Math.max(1, Math.round(options.minRectWidth ?? 10)),
    minRectHeight: Math.max(1, Math.round(options.minRectHeight ?? 10)),
    sobelThresholdRatio: clampNumber(options.sobelThresholdRatio ?? 0.3, 0, 1),
  };
}

function findHorizontalEdgeRuns(
  edgeMask: { width: number; height: number; data: Uint8Array },
  roi: Rect,
  minWidth: number,
): HorizontalEdgeRun[] {
  const runs: HorizontalEdgeRun[] = [];
  for (let localY = 0; localY < edgeMask.height; localY += 1) {
    let start = -1;
    for (let localX = 0; localX <= edgeMask.width; localX += 1) {
      const active =
        localX < edgeMask.width &&
        edgeMask.data[localY * edgeMask.width + localX] > 0;
      if (active && start < 0) {
        start = localX;
      } else if (!active && start >= 0) {
        const width = localX - start;
        if (width >= minWidth)
          runs.push({ x: roi.x + start, y: roi.y + localY, width });
        start = -1;
      }
    }
  }
  return runs;
}

function findVerticalEdgeRuns(
  edgeMask: { width: number; height: number; data: Uint8Array },
  roi: Rect,
  minHeight: number,
): VerticalEdgeRun[] {
  const runs: VerticalEdgeRun[] = [];
  for (let localX = 0; localX < edgeMask.width; localX += 1) {
    let start = -1;
    for (let localY = 0; localY <= edgeMask.height; localY += 1) {
      const active =
        localY < edgeMask.height &&
        edgeMask.data[localY * edgeMask.width + localX] > 0;
      if (active && start < 0) {
        start = localY;
      } else if (!active && start >= 0) {
        const height = localY - start;
        if (height >= minHeight)
          runs.push({ x: roi.x + localX, y: roi.y + start, height });
        start = -1;
      }
    }
  }
  return runs;
}

function makeRectFromEdgePair(
  topCandidate: HorizontalEdgeRun,
  bottomCandidate: HorizontalEdgeRun,
  vEdges: VerticalEdgeRun[],
  settings: TimerEdgeRectSettings,
): Rect | null {
  const x1 = Math.max(topCandidate.x, bottomCandidate.x);
  const x2 = Math.min(
    topCandidate.x + topCandidate.width - 1,
    bottomCandidate.x + bottomCandidate.width - 1,
  );
  if (x2 - x1 + 1 < settings.minRectWidth) return null;

  const top = Math.min(topCandidate.y, bottomCandidate.y);
  const bottom = Math.max(topCandidate.y, bottomCandidate.y);
  if (bottom - top + 1 < settings.minRectHeight) return null;

  let left = -1;
  let right = -1;
  let leftMinStd = Infinity;
  let rightMinStd = Infinity;

  for (const edge of vEdges) {
    let projectedX: number;
    if (edge.x <= x1) projectedX = x1;
    else if (edge.x >= x2) projectedX = x2;
    else continue;

    const y1 = Math.max(edge.y, top);
    const y2 = Math.min(edge.y + edge.height - 1, bottom);
    if (y2 < y1) continue;

    const diffX = Math.abs(edge.x - projectedX);
    const diffY1 = Math.abs(y1 - top);
    const diffY2 = Math.abs(y2 - bottom);
    const minDiff = Math.min(diffX, diffY1, diffY2);
    const maxDiff = Math.max(diffX, diffY1, diffY2);
    if (maxDiff > 0 && minDiff / maxDiff < 0.5) continue;

    const distance = Math.sqrt(
      diffX * diffX + Math.max(diffY1 * diffY1, diffY2 * diffY2),
    );
    if (distance > Math.min(x2 - x1, y2 - y1)) continue;

    const mean = (diffX + diffY1 + diffY2) / 3;
    const std = Math.sqrt(
      Math.max(
        0,
        (diffX * diffX + diffY1 * diffY1 + diffY2 * diffY2) / 3 - mean * mean,
      ),
    );
    if (projectedX === x1 && std < leftMinStd) {
      left = edge.x;
      leftMinStd = std;
    } else if (projectedX === x2 && std < rightMinStd) {
      right = edge.x;
      rightMinStd = std;
    }
  }

  if (left < 0 || right < 0 || right <= left) return null;
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function removeContainedRects(rects: Rect[]): Rect[] {
  return rects.filter(
    (rect) =>
      !rects.some((other) => other !== rect && containsRect(other, rect)),
  );
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function redAt(imageData: ImageDataLike, x: number, y: number): number {
  return imageData.data[(y * imageData.width + x) * 4];
}
