import { clampNumber } from "./timerImage";
import type { DigitRatio, ImageDataLike, PixelArray, Rect } from "./timerTypes";
import {
  isMapleTimerGoldPixel,
  isRelaxedMapleTimerGoldPixel,
} from "./timerPixelClassifiers";

export type DigitColumnRun = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  count: number;
};

export function makeDigitRect(rect: Rect, ratio: DigitRatio): Rect {
  const left = Math.floor(rect.x + rect.width * ratio.xRatio);
  const top = Math.floor(rect.y + rect.height * ratio.yRatio);
  const right = Math.floor(
    rect.x + rect.width * (ratio.xRatio + ratio.widthRatio),
  );
  const bottom = Math.floor(
    rect.y + rect.height * (ratio.yRatio + ratio.heightRatio),
  );
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1),
  };
}

export function findMapleTimerDigitRects(
  imageData: ImageDataLike,
  rect: Rect,
): Rect[] {
  const strictDigitRects = findMapleTimerDigitRectsWithPredicate(
    imageData,
    rect,
    isMapleTimerGoldPixel,
    false,
  );
  if (strictDigitRects.length >= 3) return strictDigitRects;
  return findMapleTimerDigitRectsWithPredicate(
    imageData,
    rect,
    isRelaxedMapleTimerGoldPixel,
    true,
  );
}

export function findMapleTimerDigitRectsWithPredicate(
  imageData: ImageDataLike,
  rect: Rect,
  pixelPredicate: (data: PixelArray, offset: number) => boolean,
  relaxed: boolean,
): Rect[] {
  const columnRuns = findMapleTimerColumnRuns(imageData, rect, pixelPredicate);
  const runs = relaxed
    ? mergeCloseDigitRuns(columnRuns, rect)
    : mergeStrictDigitRuns(
        columnRuns,
        Math.max(2, Math.round(rect.height * 0.04)),
      );
  const digitRuns = runs.filter((run) =>
    relaxed ? isDigitColumnRun(run, rect) : isStrictDigitColumnRun(run, rect),
  );
  if (!digitRuns.length) return [];

  const topPadding = Math.max(1, Math.round(rect.height * 0.06));
  const bottomPadding = Math.max(1, Math.round(rect.height * 0.02));
  const basePadding = Math.max(2, Math.round(rect.height * 0.03));
  const maxPadding =
    digitRuns.length === 3
      ? Math.max(basePadding, Math.round(rect.height * 0.14))
      : basePadding;
  const top = clampNumber(
    Math.min(...digitRuns.map((run) => run.top)) - topPadding,
    0,
    rect.height - 1,
  );
  const bottom = clampNumber(
    Math.max(...digitRuns.map((run) => run.bottom)) + bottomPadding,
    top + 1,
    rect.height,
  );

  return digitRuns.map((run, index) => {
    const previous = digitRuns[index - 1] ?? null;
    const next = digitRuns[index + 1] ?? null;
    const leftGap = previous
      ? Math.max(0, run.left - previous.right - 1)
      : maxPadding * 2;
    const rightGap = next
      ? Math.max(0, next.left - run.right - 1)
      : maxPadding * 2;
    const leftPadding = Math.max(
      basePadding,
      Math.min(maxPadding, Math.floor(leftGap / 2)),
    );
    const rightPadding = Math.max(
      basePadding,
      Math.min(maxPadding, Math.floor(rightGap / 2)),
    );
    const left = clampNumber(run.left - leftPadding, 0, rect.width - 1);
    const right = clampNumber(
      run.right + rightPadding + 1,
      left + 1,
      rect.width,
    );
    return {
      x: rect.x + left,
      y: rect.y + top,
      width: right - left,
      height: bottom - top,
    };
  });
}

export function findMapleTimerColumnRuns(
  imageData: ImageDataLike,
  rect: Rect,
  pixelPredicate: (
    data: PixelArray,
    offset: number,
  ) => boolean = isMapleTimerGoldPixel,
): DigitColumnRun[] {
  const columnThreshold = Math.max(3, Math.round(rect.height * 0.04));
  const scanTop = Math.max(0, Math.round(rect.height * 0.05));
  const scanBottom = Math.min(rect.height, Math.round(rect.height * 0.82));
  const columnCounts: Array<{ count: number; top: number; bottom: number }> =
    [];

  for (let localX = 0; localX < rect.width; localX += 1) {
    let count = 0;
    let top = rect.height;
    let bottom = -1;
    for (let localY = scanTop; localY < scanBottom; localY += 1) {
      const offset =
        ((rect.y + localY) * imageData.width + rect.x + localX) * 4;
      if (!pixelPredicate(imageData.data, offset)) continue;
      count += 1;
      top = Math.min(top, localY);
      bottom = Math.max(bottom, localY);
    }
    columnCounts.push({ count, top, bottom });
  }

  const runs: DigitColumnRun[] = [];
  let start = -1;
  for (let index = 0; index <= columnCounts.length; index += 1) {
    const active =
      index < columnCounts.length &&
      columnCounts[index].count > columnThreshold;
    if (active && start < 0) {
      start = index;
      continue;
    }
    if ((active || start < 0) && index < columnCounts.length) continue;
    if (start < 0) continue;

    const end = index - 1;
    let top = rect.height;
    let bottom = -1;
    let count = 0;
    for (let column = start; column <= end; column += 1) {
      const current = columnCounts[column];
      count += current.count;
      if (current.count > 0) {
        top = Math.min(top, current.top);
        bottom = Math.max(bottom, current.bottom);
      }
    }
    runs.push({ left: start, right: end, top, bottom, count });
    start = -1;
  }

  return runs;
}

export function mergeStrictDigitRuns(
  runs: DigitColumnRun[],
  maxGap: number,
): DigitColumnRun[] {
  const merged: DigitColumnRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous && run.left - previous.right - 1 <= maxGap) {
      previous.right = run.right;
      previous.top = Math.min(previous.top, run.top);
      previous.bottom = Math.max(previous.bottom, run.bottom);
      previous.count += run.count;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

export function mergeCloseDigitRuns(
  runs: DigitColumnRun[],
  rect: Rect,
): DigitColumnRun[] {
  const adjacentGap = Math.max(1, Math.round(rect.height * 0.04));
  const internalGap = Math.max(adjacentGap, Math.round(rect.height * 0.28));
  const minDigitWidth = minDigitColumnRunWidth(rect);
  const merged: DigitColumnRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      shouldMergeDigitColumnRuns(
        previous,
        run,
        adjacentGap,
        internalGap,
        minDigitWidth,
      )
    ) {
      previous.right = run.right;
      previous.top = Math.min(previous.top, run.top);
      previous.bottom = Math.max(previous.bottom, run.bottom);
      previous.count += run.count;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

export function shouldMergeDigitColumnRuns(
  previous: DigitColumnRun,
  current: DigitColumnRun,
  adjacentGap: number,
  internalGap: number,
  minDigitWidth: number,
): boolean {
  const gap = current.left - previous.right - 1;
  const previousWidth = previous.right - previous.left + 1;
  const currentWidth = current.right - current.left + 1;
  const previousIsNarrow = previousWidth < minDigitWidth;
  const currentIsNarrow = currentWidth < minDigitWidth;

  if (gap <= adjacentGap && (previousIsNarrow || currentIsNarrow)) return true;
  return gap <= internalGap && (previousIsNarrow || currentIsNarrow);
}

export function isStrictDigitColumnRun(run: DigitColumnRun, rect: Rect): boolean {
  const width = run.right - run.left + 1;
  const height = run.bottom - run.top + 1;
  return (
    width >= Math.max(8, Math.round(rect.height * 0.16)) &&
    height >= Math.max(16, Math.round(rect.height * 0.32)) &&
    run.count >= rect.height * 0.9
  );
}

export function isDigitColumnRun(run: DigitColumnRun, rect: Rect): boolean {
  const width = run.right - run.left + 1;
  const height = run.bottom - run.top + 1;
  return (
    width >= minDigitColumnRunWidth(rect) &&
    height >= Math.max(12, Math.round(rect.height * 0.32)) &&
    run.count >= rect.height * 0.8
  );
}

export function minDigitColumnRunWidth(rect: Rect): number {
  return Math.max(6, Math.round(rect.height * 0.16));
}
