import type {
  ImageDataLike,
  Rect,
  SevenSegmentDigitResult,
  TimeReadResult,
  TimerCatchAnalyzeOptions,
  TimerRectOptions,
  TimerRectResult,
} from "./timerTypes";

export function resolveTimerCatchRoi(
  imageData: ImageDataLike,
  roi?: Rect | readonly [number, number, number, number],
): Rect {
  assertImageData(imageData);
  return normalizeRoi(roi, imageData.width, imageData.height) ?? topQuarterRoi(imageData);
}

export function cropImageData(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
): ImageDataLike {
  assertImageData(imageData);
  const sourceRect = normalizeStrictRect(rect, imageData.width, imageData.height);
  if (!sourceRect) throw new RangeError("Crop rect is outside the ImageData bounds.");

  const data = new Uint8ClampedArray(sourceRect.width * sourceRect.height * 4);
  for (let y = 0; y < sourceRect.height; y += 1) {
    for (let x = 0; x < sourceRect.width; x += 1) {
      const sourceOffset = ((sourceRect.y + y) * imageData.width + sourceRect.x + x) * 4;
      const targetOffset = (y * sourceRect.width + x) * 4;
      data[targetOffset] = imageData.data[sourceOffset];
      data[targetOffset + 1] = imageData.data[sourceOffset + 1];
      data[targetOffset + 2] = imageData.data[sourceOffset + 2];
      data[targetOffset + 3] = imageData.data[sourceOffset + 3];
    }
  }

  return {
    width: sourceRect.width,
    height: sourceRect.height,
    data,
  };
}

export function normalizeRoi(
  rect: Rect | readonly [number, number, number, number] | undefined,
  frameWidth: number,
  frameHeight: number,
): Rect | null {
  const value = rectFromInput(rect) ?? { x: 0, y: 0, width: frameWidth, height: frameHeight };
  const x = clampNumber(Math.round(value.x), 0, Math.max(0, frameWidth - 1));
  const y = clampNumber(Math.round(value.y), 0, Math.max(0, frameHeight - 1));
  const right = clampNumber(Math.round(value.x + value.width), x + 1, frameWidth);
  const bottom = clampNumber(Math.round(value.y + value.height), y + 1, frameHeight);
  if (right <= x || bottom <= y) return null;

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function normalizeStrictRect(
  rect: Rect | readonly [number, number, number, number] | null | undefined,
  frameWidth: number,
  frameHeight: number,
): Rect | null {
  const value = rectFromInput(rect);
  if (!value) return null;
  const x = Math.round(value.x);
  const y = Math.round(value.y);
  const width = Math.round(value.width);
  const height = Math.round(value.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > frameWidth || y + height > frameHeight) return null;
  return { x, y, width, height };
}

export function rectFromInput(
  rect: Rect | readonly [number, number, number, number] | null | undefined,
): Rect | null {
  if (!rect) return null;
  if (Array.isArray(rect)) return { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
  const value = rect as Rect;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

export function mergeFrameOptions(
  base: TimerCatchAnalyzeOptions,
  update: TimerCatchAnalyzeOptions,
): TimerCatchAnalyzeOptions {
  return {
    ...base,
    ...update,
    timerRect: {
      ...(base.timerRect ?? {}),
      ...(update.timerRect ?? {}),
    },
    timeRead: {
      ...(base.timeRead ?? {}),
      ...(update.timeRead ?? {}),
    },
    timerFlow: {
      ...(base.timerFlow ?? {}),
      ...(update.timerFlow ?? {}),
    },
  };
}

export function makeTimerAnalysisImageData(
  imageData: ImageDataLike,
  options: TimerCatchAnalyzeOptions,
): { imageData: ImageDataLike; scale: number } {
  if (options.autoUpscale === false) return { imageData, scale: 1 };

  const minHeight = Math.max(1, Math.round(options.minTimerAnalysisHeight ?? 720));
  if (imageData.height >= minHeight) return { imageData, scale: 1 };

  const maxScale = Math.max(1, Math.round(options.maxTimerAnalysisScale ?? 2));
  const scale = Math.min(maxScale, Math.max(1, Math.ceil(minHeight / imageData.height)));
  if (scale <= 1) return { imageData, scale: 1 };

  return {
    imageData: scaleImageDataNearest(imageData, scale),
    scale,
  };
}

export function scaleTimerRectOptions(options: TimerRectOptions, scale: number): TimerRectOptions {
  if (scale === 1) return options;
  return {
    ...options,
    minRectWidth: options.minRectWidth == null ? options.minRectWidth : Math.round(options.minRectWidth * scale),
    minRectHeight: options.minRectHeight == null ? options.minRectHeight : Math.round(options.minRectHeight * scale),
  };
}

export function scaleRectInput(
  rect: Rect | readonly [number, number, number, number] | null | undefined,
  scale: number,
): Rect | null {
  const value = rectFromInput(rect);
  if (!value || scale === 1) return value;
  return mapRect(value, scale);
}

export function mapTimerRectResult(result: TimerRectResult, scale: number): TimerRectResult {
  return {
    ...result,
    rect: mapRect(result.rect, scale),
    roi: mapRect(result.roi, scale),
    time: mapTimeReadResult(result.time, scale),
    matches: result.matches.map((match) => ({
      ...match,
      rect: mapRect(match.rect, scale),
      time: mapTimeReadResult(match.time, scale),
    })),
    candidates: result.candidates.map((rect) => mapRect(rect, scale)),
  };
}

export function assertImageData(imageData: ImageDataLike): void {
  if (!imageData || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height) || !imageData.data) {
    throw new TypeError("Expected an ImageData-like object with width, height, and data.");
  }
  if (imageData.data.length < imageData.width * imageData.height * 4) {
    throw new RangeError("ImageData-like data is shorter than width * height * 4.");
  }
}

export function failDigit(reason: string, mask: number | null): SevenSegmentDigitResult {
  return {
    ok: false,
    reason,
    mask,
    digit: null,
  };
}

export function failTime(
  reason: string,
  rect: Rect | null,
  digits: number[],
  digitResults: SevenSegmentDigitResult[],
): TimeReadResult {
  return {
    ok: false,
    reason,
    rect,
    digits,
    digitResults,
    seconds: null,
    text: null,
  };
}

export function emptyTimerRectResult(reason: string): TimerRectResult {
  return {
    ok: false,
    reason,
    rect: null,
    time: null,
    matches: [],
    candidates: [],
    roi: null,
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scaleImageDataNearest(imageData: ImageDataLike, scale: number): ImageDataLike {
  const width = imageData.width * scale;
  const height = imageData.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor(x / scale);
      const sourceOffset = (sourceY * imageData.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      data[targetOffset] = imageData.data[sourceOffset];
      data[targetOffset + 1] = imageData.data[sourceOffset + 1];
      data[targetOffset + 2] = imageData.data[sourceOffset + 2];
      data[targetOffset + 3] = imageData.data[sourceOffset + 3];
    }
  }

  return { width, height, data };
}

function mapTimeReadResult(result: TimeReadResult, scale: number): TimeReadResult;
function mapTimeReadResult(result: null, scale: number): null;
function mapTimeReadResult(result: TimeReadResult | null, scale: number): TimeReadResult | null;
function mapTimeReadResult(result: TimeReadResult | null, scale: number): TimeReadResult | null {
  if (!result) return result;
  return {
    ...result,
    rect: mapRect(result.rect, scale),
    digitResults: result.digitResults.map((digitResult) => ({
      ...digitResult,
      rect: digitResult.rect ? mapRect(digitResult.rect, scale) : undefined,
    })),
  };
}

function mapRect(rect: Rect, scale: number): Rect;
function mapRect(rect: Rect | null | undefined, scale: number): Rect | null;
function mapRect(rect: Rect | null | undefined, scale: number): Rect | null {
  if (!rect) return null;
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

function topQuarterRoi(imageData: ImageDataLike): Rect {
  return {
    x: 0,
    y: 0,
    width: imageData.width,
    height: Math.max(1, Math.floor(imageData.height / 4)),
  };
}
