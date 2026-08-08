import { imageDataToCanvas } from "../canvasImage";
import type {
  BuffExpiryAcceptedMatch,
  BuffExpiryBox,
  BuffExpiryIconImageData,
  BuffExpiryNormalizedBoxIcon,
  BuffExpiryRejectedMatch,
} from "./buffExpiryTypes";
import type { PixelRegion } from "../../contracts/geometry/pixelRegion";

const DEFAULT_MAX_PREVIEW_WIDTH = 960;
const DEFAULT_BOX_PREVIEW_SIZE = 32;

export function createBuffExpiryProcessedPreview({
  imageData,
  roi,
  boxes,
  acceptedMatches,
  rejectedMatches,
  maxWidth = DEFAULT_MAX_PREVIEW_WIDTH,
}: {
  imageData: ImageData;
  roi: PixelRegion;
  boxes: BuffExpiryBox[];
  acceptedMatches: BuffExpiryAcceptedMatch[];
  rejectedMatches: BuffExpiryRejectedMatch[];
  maxWidth?: number;
}): string | null {
  const sourceCanvas = imageDataToCanvas(imageData);
  if (!sourceCanvas) {
    return null;
  }

  const scale = Math.min(1, maxWidth / Math.max(1, imageData.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imageData.width * scale));
  canvas.height = Math.max(1, Math.round(imageData.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = scale !== 1;
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

  const acceptedKeys = new Set(acceptedMatches.map((match) => getBoxKey(match.box)));
  const rejectedKeys = new Set(rejectedMatches.map((match) => getBoxKey(match.box)));

  for (const box of boxes) {
    const key = getBoxKey(box);
    const accepted = acceptedKeys.has(key);
    const rejected = rejectedKeys.has(key);
    drawBox(context, roi, box, scale, accepted ? "#22c55e" : rejected ? "#f59e0b" : "#38bdf8");
  }

  acceptedMatches.slice(0, 8).forEach((match, index) => {
    drawLabel(
      context,
      roi,
      match.box,
      scale,
      `${index + 1}. ${match.seconds}s`,
      "#166534",
      "#dcfce7",
    );
  });

  return canvas.toDataURL("image/png");
}

export function createBuffExpiryBoxPreviewUrls({
  imageData,
  roi,
  boxes,
  size = DEFAULT_BOX_PREVIEW_SIZE,
}: {
  imageData: ImageData;
  roi: PixelRegion;
  boxes: BuffExpiryBox[];
  size?: number;
}): Record<string, string> {
  if (!boxes.length) {
    return {};
  }

  let sourceCanvas: HTMLCanvasElement | null = null;
  try {
    sourceCanvas = imageDataToCanvas(imageData);
  } catch {
    return {};
  }
  if (!sourceCanvas) {
    return {};
  }

  const urls: Record<string, string> = {};
  for (const box of boxes) {
    const sourceX = Math.max(0, Math.round(box.x - roi.x));
    const sourceY = Math.max(0, Math.round(box.y - roi.y));
    const sourceWidth = Math.min(
      imageData.width - sourceX,
      Math.max(1, Math.round(box.width)),
    );
    const sourceHeight = Math.min(
      imageData.height - sourceY,
      Math.max(1, Math.round(box.height)),
    );
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      continue;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      continue;
    }

    context.imageSmoothingEnabled = false;
    context.drawImage(
      sourceCanvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      size,
      size,
    );
    try {
      urls[getBoxKey(box)] = canvas.toDataURL("image/png");
    } catch {
      // Ignore a failed thumbnail and keep the rest of the detected list usable.
    }
  }

  return urls;
}

export function createBuffExpiryNormalizedBoxPreviewUrls({
  normalizedBoxIcons,
  size = DEFAULT_BOX_PREVIEW_SIZE,
}: {
  normalizedBoxIcons: BuffExpiryNormalizedBoxIcon[];
  size?: number;
}): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const icon of normalizedBoxIcons) {
    try {
      const imageData = new ImageData(
        new Uint8ClampedArray(icon.imageData.data),
        icon.imageData.width,
        icon.imageData.height,
      );
      const sourceCanvas = imageDataToCanvas(imageData);
      if (!sourceCanvas) {
        continue;
      }

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        continue;
      }

      context.imageSmoothingEnabled = false;
      context.drawImage(sourceCanvas, 0, 0, size, size);
      urls[getBoxKey(icon.box)] = canvas.toDataURL("image/png");
    } catch {
      // Keep the detected list usable even if one normalized preview fails.
    }
  }
  return urls;
}

export function createBuffExpiryNormalizedBoxPreviewImageData({
  normalizedBoxIcons,
}: {
  normalizedBoxIcons: BuffExpiryNormalizedBoxIcon[];
}): Record<string, BuffExpiryIconImageData> {
  const images: Record<string, BuffExpiryIconImageData> = {};
  for (const icon of normalizedBoxIcons) {
    images[getBoxKey(icon.box)] = {
      width: icon.imageData.width,
      height: icon.imageData.height,
      data: new Uint8ClampedArray(icon.imageData.data),
    };
  }
  return images;
}

function drawBox(
  context: CanvasRenderingContext2D,
  roi: PixelRegion,
  box: BuffExpiryBox,
  scale: number,
  color: string,
) {
  const x = Math.round((box.x - roi.x) * scale);
  const y = Math.round((box.y - roi.y) * scale);
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, Math.round(2 * scale));
  context.strokeRect(x + 0.5, y + 0.5, Math.max(1, width), Math.max(1, height));
  context.restore();
}

function drawLabel(
  context: CanvasRenderingContext2D,
  roi: PixelRegion,
  box: BuffExpiryBox,
  scale: number,
  text: string,
  color: string,
  background: string,
) {
  const x = Math.round((box.x - roi.x) * scale);
  const y = Math.max(0, Math.round((box.y - roi.y) * scale) - 18);
  context.save();
  context.font = "12px sans-serif";
  const metrics = context.measureText(text);
  const width = Math.ceil(metrics.width) + 8;
  context.fillStyle = background;
  context.fillRect(x, y, width, 16);
  context.fillStyle = color;
  context.fillText(text, x + 4, y + 12);
  context.restore();
}

function getBoxKey(box: BuffExpiryBox): string {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}
