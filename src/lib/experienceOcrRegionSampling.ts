import type { HuntStallSnapshot } from "../alertTypes";
import type { HuntStallReading } from "../contracts/recognition/huntStallExperienceRecognition";
import type { RelativeRegion } from "../types";
import {
  hasNearbyDarkOutline,
  isExperienceTextPixel,
} from "../recognition/hunt-stall/experience/fallback/experienceOcrPreprocess";
import { imageDataToUrl } from "./imageData";
import { findForegroundComponents } from "../recognition/template-digit/segmentation";
import { normalizeRegion, regionToPixels } from "./regions";

const MIN_FOREGROUND_RATIO = 0.002;
const MAX_FOREGROUND_RATIO = 0.42;

export type ExperienceVideoSample = {
  imageData: ImageData;
  processedImageData: ImageData;
  reading: HuntStallReading;
  snapshot: HuntStallSnapshot;
};

type ExperienceImageReader = (source: ImageData) => {
  processedImageData: ImageData;
  reading: HuntStallReading;
};

export function getExperienceTextRegion(videoWidth: number, videoHeight: number): RelativeRegion {
  const width = 0.3;
  const height = Math.max(14 / Math.max(1, videoHeight), 0.014);

  return normalizeRegion({
    x: 0.5 - width / 2,
    y: 1 - height,
    width,
    height,
  });
}

export function sampleExperienceFromVideo(
  video: HTMLVideoElement,
  includePreview: boolean,
  readImageData: ExperienceImageReader,
): ExperienceVideoSample {
  const candidates = getExperienceTextRegionCandidatesFromVideo(video);
  const sampled = candidates.map((relativeRegion) => ({
    relativeRegion,
    sample: sampleExperienceRegionFromVideo(video, relativeRegion, false, readImageData),
  }));
  const best =
    sampled
      .slice()
      .sort((a, b) => getExperienceSampleScore(b.sample) - getExperienceSampleScore(a.sample))[0] ??
    null;
  const selectedRegion =
    best?.relativeRegion ??
    candidates[0] ??
    getExperienceTextRegion(video.videoWidth, video.videoHeight);

  if (!includePreview && best) {
    return best.sample;
  }

  return sampleExperienceRegionFromVideo(video, selectedRegion, includePreview, readImageData);
}

function sampleExperienceRegionFromVideo(
  video: HTMLVideoElement,
  relativeRegion: RelativeRegion,
  includePreview: boolean,
  readImageData: ExperienceImageReader,
): ExperienceVideoSample {
  const pixelRegion = regionToPixels(relativeRegion, video.videoWidth, video.videoHeight);
  const scale = Math.max(1, Math.min(3, Math.floor(900 / Math.max(1, pixelRegion.width))));
  const width = Math.max(24, pixelRegion.width * scale);
  const height = Math.max(12, pixelRegion.height * scale);
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
    pixelRegion.x,
    pixelRegion.y,
    pixelRegion.width,
    pixelRegion.height,
    0,
    0,
    width,
    height,
  );

  const imageData = context.getImageData(0, 0, width, height);
  const rawPreviewUrl = includePreview ? canvas.toDataURL("image/png") : null;
  const { processedImageData, reading } = readImageData(imageData);
  let processedPreviewUrl: string | null = null;

  if (includePreview) {
    processedPreviewUrl = imageDataToUrl(processedImageData);
  }

  return {
    imageData,
    processedImageData,
    reading,
    snapshot: {
      sampledAt: Date.now(),
      rawPreviewUrl,
      processedPreviewUrl,
      regionLabel: `${pixelRegion.width}x${pixelRegion.height}`,
      recognizedText: reading.recognizedText,
      debugText: reading.debugText,
      confidence: reading.confidence,
      foregroundRatio: reading.foregroundRatio,
      changeScore: 0,
    },
  };
}

function getExperienceTextRegionCandidatesFromVideo(video: HTMLVideoElement): RelativeRegion[] {
  return dedupeExperienceRegions(
    [
      detectExperienceTextRegionFromVideo(video),
      getExperienceTextRegion(video.videoWidth, video.videoHeight),
      getWideBottomExperienceTextRegion(video.videoWidth, video.videoHeight, 0.38),
      getWideBottomExperienceTextRegion(video.videoWidth, video.videoHeight, 0.5),
    ],
    video.videoWidth,
    video.videoHeight,
  );
}

function getExperienceSampleScore(sample: ExperienceVideoSample): number {
  const { reading, imageData } = sample;
  if (reading.recognizedText) {
    const widthPenalty = Math.max(0, imageData.width - 640) / 640;
    return 100 + reading.confidence * 10 - widthPenalty;
  }

  if (
    reading.foregroundRatio < MIN_FOREGROUND_RATIO ||
    reading.foregroundRatio > MAX_FOREGROUND_RATIO
  ) {
    return -10;
  }

  return reading.confidence;
}

function getWideBottomExperienceTextRegion(
  videoWidth: number,
  videoHeight: number,
  widthRatio: number,
): RelativeRegion {
  const height = Math.max(18 / Math.max(1, videoHeight), 0.022);
  const width = Math.min(0.64, Math.max(0.3, widthRatio));

  return normalizeRegion({
    x: 0.5 - width / 2,
    y: 1 - height,
    width,
    height,
  });
}

function dedupeExperienceRegions(
  regions: RelativeRegion[],
  videoWidth: number,
  videoHeight: number,
): RelativeRegion[] {
  const seen = new Set<string>();
  return regions.filter((region) => {
    const pixelRegion = regionToPixels(region, videoWidth, videoHeight);
    const key = [
      Math.round(pixelRegion.x / 2),
      Math.round(pixelRegion.y / 2),
      Math.round(pixelRegion.width / 2),
      Math.round(pixelRegion.height / 2),
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function detectExperienceTextRegionFromVideo(video: HTMLVideoElement): RelativeRegion {
  const fallback = getExperienceTextRegion(video.videoWidth, video.videoHeight);
  const bottomStartY = Math.floor(video.videoHeight * 0.84);
  const sourceHeight = Math.max(1, video.videoHeight - bottomStartY);
  const scale = Math.min(1, 960 / Math.max(1, video.videoWidth));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return fallback;
  }

  context.imageSmoothingEnabled = false;
  context.drawImage(
    video,
    0,
    bottomStartY,
    video.videoWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );

  const imageData = context.getImageData(0, 0, width, height);
  const bar = findStatusManaBar(imageData);
  const directText = findExperienceTextInBottom(imageData);
  if (!bar) {
    return directText
      ? createExperienceRegionFromBottomGroup(directText, {
          bottomStartY,
          scale,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        })
      : fallback;
  }

  const detectedText = findExperienceTextNearBar(imageData, bar);
  const textGroup = chooseExperienceTextGroup(detectedText, directText);
  if (textGroup) {
    return createExperienceRegionFromBottomGroup(textGroup, {
      bottomStartY,
      scale,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    });
  }

  const absoluteX = Math.max(0, Math.round((bar.minX - 8) / scale));
  const absoluteY = Math.max(0, bottomStartY + Math.round((bar.maxY + 2) / scale));
  const absoluteWidth = Math.min(
    video.videoWidth - absoluteX,
    Math.min(
      Math.round(video.videoWidth * 0.26),
      Math.max(90, Math.round((bar.maxX - bar.minX + 18) / scale)),
    ),
  );
  const absoluteHeight = Math.min(
    video.videoHeight - absoluteY,
    Math.max(10, Math.round(16 / scale)),
  );

  if (absoluteWidth < 40 || absoluteHeight < 8) {
    return fallback;
  }

  return normalizeRegion({
    x: absoluteX / video.videoWidth,
    y: absoluteY / video.videoHeight,
    width: absoluteWidth / video.videoWidth,
    height: absoluteHeight / video.videoHeight,
  });
}

function createExperienceRegionFromBottomGroup(
  textGroup: { minX: number; maxX: number; minY: number; maxY: number },
  {
    bottomStartY,
    scale,
    videoWidth,
    videoHeight,
  }: {
    bottomStartY: number;
    scale: number;
    videoWidth: number;
    videoHeight: number;
  },
): RelativeRegion {
  const sourceMarginX = Math.max(5, Math.round(7 / scale));
  const sourceMarginY = Math.max(4, Math.round(6 / scale));
  const absoluteX = Math.max(0, Math.round(textGroup.minX / scale) - sourceMarginX);
  const absoluteY = Math.max(0, bottomStartY + Math.round(textGroup.minY / scale) - sourceMarginY);
  const absoluteWidth = Math.min(
    videoWidth - absoluteX,
    Math.round((textGroup.maxX - textGroup.minX + 1) / scale) + sourceMarginX * 2,
  );
  const absoluteHeight = Math.min(
    videoHeight - absoluteY,
    Math.round((textGroup.maxY - textGroup.minY + 1) / scale) + sourceMarginY * 2,
  );

  if (absoluteWidth < 40 || absoluteHeight < 8) {
    return getExperienceTextRegion(videoWidth, videoHeight);
  }

  return normalizeRegion({
    x: absoluteX / videoWidth,
    y: absoluteY / videoHeight,
    width: absoluteWidth / videoWidth,
    height: absoluteHeight / videoHeight,
  });
}

function chooseExperienceTextGroup<T extends { minX: number; maxX: number; minY: number; maxY: number }>(
  nearBar: T | null,
  direct: T | null,
): T | null {
  if (!nearBar) {
    return direct;
  }
  if (!direct) {
    return nearBar;
  }

  const nearBarWidth = nearBar.maxX - nearBar.minX + 1;
  const directWidth = direct.maxX - direct.minX + 1;
  return directWidth > nearBarWidth * 1.35 ? direct : nearBar;
}

function findExperienceTextInBottom(
  imageData: ImageData,
): { minX: number; maxX: number; minY: number; maxY: number; count: number } | null {
  const rows = collectExperienceTextRows(imageData, {
    minX: 0,
    maxX: imageData.width - 1,
    startY: Math.floor(imageData.height * 0.42),
    endY: imageData.height - 1,
    requireDarkOutline: true,
  });
  const groups = groupExperienceTextRows(rows);

  return (
    groups
      .filter((group) => {
        const widthRatio = (group.maxX - group.minX + 1) / Math.max(1, imageData.width);
        const centerRatio = (group.minX + group.maxX) / 2 / Math.max(1, imageData.width);
        const height = group.maxY - group.minY + 1;
        return (
          widthRatio >= 0.04 &&
          widthRatio <= 0.32 &&
          centerRatio >= 0.33 &&
          centerRatio <= 0.67 &&
          height >= 2 &&
          group.maxY >= imageData.height * 0.5
        );
      })
      .sort((a, b) => getExperienceTextGroupScore(b, imageData) - getExperienceTextGroupScore(a, imageData))[0] ??
    null
  );
}

function findExperienceTextNearBar(
  imageData: ImageData,
  bar: { minX: number; maxX: number; maxY: number },
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const minX = Math.max(0, bar.minX - Math.round(imageData.width * 0.02));
  const maxX = Math.min(imageData.width - 1, bar.maxX + Math.round(imageData.width * 0.02));
  const startY = Math.min(imageData.height - 1, bar.maxY + 1);
  const endY = Math.min(imageData.height - 1, startY + Math.max(8, Math.round(imageData.height * 0.18)));
  const rows = collectExperienceTextRows(imageData, {
    minX,
    maxX,
    startY,
    endY,
    requireDarkOutline: false,
  });
  const groups = groupExperienceTextRows(rows);

  return (
    groups
      .filter((group) => {
        const width = group.maxX - group.minX + 1;
        const height = group.maxY - group.minY + 1;
        return width >= Math.max(18, imageData.width * 0.035) && height >= 2;
      })
      .sort((a, b) => b.count - a.count || b.maxY - a.maxY)[0] ?? null
  );
}

function collectExperienceTextRows(
  imageData: ImageData,
  {
    minX,
    maxX,
    startY,
    endY,
    requireDarkOutline,
  }: {
    minX: number;
    maxX: number;
    startY: number;
    endY: number;
    requireDarkOutline: boolean;
  },
): Array<{ y: number; minX: number; maxX: number; count: number }> {
  const rows: Array<{ y: number; minX: number; maxX: number; count: number }> = [];

  for (let y = startY; y <= endY; y += 1) {
    let rowMinX = imageData.width;
    let rowMaxX = 0;
    let count = 0;

    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * imageData.width + x) * 4;
      if (
        !isExperienceTextPixel(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]) ||
        (requireDarkOutline && !hasNearbyDarkOutline(imageData, x, y))
      ) {
        continue;
      }
      rowMinX = Math.min(rowMinX, x);
      rowMaxX = Math.max(rowMaxX, x);
      count += 1;
    }

    if (count >= Math.max(2, (maxX - minX + 1) * 0.006)) {
      rows.push({ y, minX: rowMinX, maxX: rowMaxX, count });
    }
  }

  return rows;
}

function groupExperienceTextRows(
  rows: Array<{ y: number; minX: number; maxX: number; count: number }>,
): Array<{ minX: number; maxX: number; minY: number; maxY: number; count: number }> {
  const groups: Array<{ minX: number; maxX: number; minY: number; maxY: number; count: number }> =
    [];

  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || row.y > last.maxY + 1) {
      groups.push({ minX: row.minX, maxX: row.maxX, minY: row.y, maxY: row.y, count: row.count });
      continue;
    }
    last.minX = Math.min(last.minX, row.minX);
    last.maxX = Math.max(last.maxX, row.maxX);
    last.maxY = row.y;
    last.count += row.count;
  }

  return groups;
}

function getExperienceTextGroupScore(
  group: { minX: number; maxX: number; minY: number; maxY: number; count: number },
  imageData: ImageData,
): number {
  const widthRatio = (group.maxX - group.minX + 1) / Math.max(1, imageData.width);
  const centerRatio = (group.minX + group.maxX) / 2 / Math.max(1, imageData.width);
  const yRatio = group.maxY / Math.max(1, imageData.height);
  return (
    Math.min(1, widthRatio / 0.16) * 0.38 +
    Math.max(0, 1 - Math.abs(centerRatio - 0.5) / 0.18) * 0.28 +
    yRatio * 0.24 +
    Math.min(1, group.count / Math.max(1, imageData.width * 0.08)) * 0.1
  );
}

function findStatusManaBar(imageData: ImageData): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  const mask = new ImageData(imageData.width, imageData.height);

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const index = (y * imageData.width + x) * 4;
      if (!isManaBarPixel(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2])) {
        continue;
      }
      mask.data[index] = 255;
      mask.data[index + 1] = 255;
      mask.data[index + 2] = 255;
      mask.data[index + 3] = 255;
    }
  }

  for (let index = 3; index < mask.data.length; index += 4) {
    mask.data[index] = 255;
  }

  return (
    findForegroundComponents(mask)
      .map((box) => ({
        minX: box.x,
        maxX: box.x + box.width - 1,
        minY: box.y,
        maxY: box.y + box.height - 1,
        count: box.width * box.height,
      }))
      .filter((group) => {
        const centerRatio = (group.minX + group.maxX) / 2 / Math.max(1, imageData.width);
        const widthRatio = (group.maxX - group.minX + 1) / Math.max(1, imageData.width);
        const height = group.maxY - group.minY + 1;
        return (
          centerRatio >= 0.24 &&
          centerRatio <= 0.78 &&
          widthRatio >= 0.07 &&
          widthRatio <= 0.38 &&
          height >= 2 &&
          height <= Math.max(18, imageData.height * 0.16)
        );
      })
      .sort(
        (a, b) =>
          b.maxY - a.maxY || getManaBarScore(b, imageData.width) - getManaBarScore(a, imageData.width),
      )[0] ??
    null
  );
}

function isManaBarPixel(red: number, green: number, blue: number): boolean {
  return red <= 110 && green >= 130 && blue >= 145 && blue > red * 1.45 && green > red * 1.35;
}

function getManaBarScore(
  group: { minX: number; maxX: number; count: number },
  imageWidth: number,
): number {
  const widthRatio = (group.maxX - group.minX + 1) / Math.max(1, imageWidth);
  const centerRatio = (group.minX + group.maxX) / 2 / Math.max(1, imageWidth);
  return Math.min(1, widthRatio / 0.16) * 0.58 + Math.max(0, 1 - Math.abs(centerRatio - 0.5) / 0.22) * 0.42;
}
