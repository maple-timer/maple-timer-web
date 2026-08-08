import type { PixelRegion } from "../../contracts/geometry/pixelRegion";
import type { BuffSlotParserInputMode } from "../../recognition/buff-slot/parser/types";

export type BuffSlotEvidenceSource = {
  kind: "buff-slot-top-right-quadrant-v1";
  parserInputMode: Extract<BuffSlotParserInputMode, "topRightQuadrant">;
  coordinateSpace: "capture-pixels" | "game-viewport-pixels";
  sourceSize: { width: number; height: number };
  captureSize?: { width: number; height: number };
  sourceRegion?: PixelRegion;
  roi: PixelRegion;
  dataUrl: string;
};

export type BuffSlotVideoFrameSample = {
  imageData: ImageData;
  rawPreviewUrl: string | null;
  regionLabel: string;
  sourceSize: { width: number; height: number };
  captureSize?: { width: number; height: number };
  coordinateSpace?: BuffSlotEvidenceSource["coordinateSpace"];
  sourceRegion?: PixelRegion;
  roi: PixelRegion;
};

export function sampleBuffSlotVideoFrame(
  video: HTMLVideoElement,
  options: {
    includePreview?: boolean;
    sourceRegion?: PixelRegion;
    coordinateSpace?: BuffSlotEvidenceSource["coordinateSpace"];
  } = {},
): BuffSlotVideoFrameSample {
  const { includePreview = true } = options;
  const sourceRegion = options.sourceRegion ?? {
    x: 0,
    y: 0,
    width: video.videoWidth,
    height: video.videoHeight,
  };
  const width = sourceRegion.width;
  const height = sourceRegion.height;
  const captureSize = {
    width: video.videoWidth,
    height: video.videoHeight,
  };
  const coordinateSpace =
    options.coordinateSpace ??
    (options.sourceRegion
      ? "game-viewport-pixels"
      : "capture-pixels");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("canvas-context-unavailable");
  }

  context.imageSmoothingEnabled = false;
  context.drawImage(
    video,
    sourceRegion.x,
    sourceRegion.y,
    sourceRegion.width,
    sourceRegion.height,
    0,
    0,
    width,
    height,
  );

  const roi = getBuffSlotTopRightQuadrant(width, height);
  return {
    imageData: context.getImageData(0, 0, width, height),
    rawPreviewUrl: includePreview ? createTopRightQuadrantPreview(canvas, roi) : null,
    regionLabel: `${roi.width}x${roi.height}`,
    sourceSize: { width, height },
    captureSize,
    coordinateSpace,
    sourceRegion,
    roi,
  };
}

export function createBuffSlotEvidenceSource(
  frame: Pick<
    BuffSlotVideoFrameSample,
    | "rawPreviewUrl"
    | "sourceSize"
    | "captureSize"
    | "coordinateSpace"
    | "sourceRegion"
    | "roi"
  >,
): BuffSlotEvidenceSource | null {
  if (!frame.rawPreviewUrl) {
    return null;
  }
  return {
    kind: "buff-slot-top-right-quadrant-v1",
    parserInputMode: "topRightQuadrant",
    coordinateSpace: frame.coordinateSpace ?? "capture-pixels",
    sourceSize: frame.sourceSize,
    ...(frame.captureSize ? { captureSize: frame.captureSize } : {}),
    ...(frame.sourceRegion ? { sourceRegion: frame.sourceRegion } : {}),
    roi: frame.roi,
    dataUrl: frame.rawPreviewUrl,
  };
}

export function getBuffSlotTopRightQuadrant(width: number, height: number): PixelRegion {
  const x = Math.floor(width / 2);
  return {
    x,
    y: 0,
    width: Math.max(1, width - x),
    height: Math.max(1, Math.floor(height / 2)),
  };
}

function createTopRightQuadrantPreview(
  source: HTMLCanvasElement,
  roi: PixelRegion,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = roi.width;
  canvas.height = roi.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = false;
  context.drawImage(
    source,
    roi.x,
    roi.y,
    roi.width,
    roi.height,
    0,
    0,
    roi.width,
    roi.height,
  );

  return canvas.toDataURL("image/png");
}
