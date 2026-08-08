import type { PixelRegion } from "../contracts/geometry/pixelRegion";
import {
  getFixedYExpBarStripRegions,
  type FixedYExpBarStripSample,
} from "../recognition/hunt-stall/experience/huntStallExperienceBar";
import type {
  HuntStallExperienceCandidateInput,
  HuntStallExperienceProcessInput,
} from "../runtime/hunt-stall/experience/huntStallExperienceRuntime";
import { roundMs } from "./huntStallOcrDiagnostics";
import {
  getFixedWideCandidates,
  type HuntStallFixedRegionCandidate,
} from "./huntStallOcrFixedRegions";
import { regionToPixels } from "./regions";

export type HuntStallMainThreadCandidateSample = {
  label: string;
  regionPixels: PixelRegion;
  imageData: ImageData;
  rawPreviewUrl: string | null;
  frameReadMs: number;
};

export type PreparedHuntStallWorkerSample = {
  request: HuntStallExperienceProcessInput;
  candidates: HuntStallMainThreadCandidateSample[];
  barFrameReadMs: number;
};

export function prepareWorkerSample(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  sampleIndex: number,
  includePreview: boolean,
  includeReportDiagnostics: boolean,
): PreparedHuntStallWorkerSample | null {
  const candidates = getFixedWideCandidates(sourceWidth, sourceHeight);
  if (!candidates.length) {
    return null;
  }

  const barCapture = captureBarStrips(source, sourceWidth, sourceHeight);
  const mainCandidates = candidates.map((candidate) =>
    captureCandidate(source, sourceWidth, sourceHeight, candidate, includePreview || includeReportDiagnostics),
  );
  const workerCandidates: HuntStallExperienceCandidateInput[] = mainCandidates.map((candidate) => ({
    label: candidate.label,
    regionPixels: candidate.regionPixels,
    imageData: candidate.imageData,
  }));

  return {
    request: {
      sampleIndex,
      sourceWidth,
      sourceHeight,
      barStrips: barCapture.strips,
      candidates: workerCandidates,
      includePreview,
      includeReportDiagnostics,
    },
    candidates: mainCandidates,
    barFrameReadMs: barCapture.frameReadMs,
  };
}

export function captureFullFramePreview(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  enabled: boolean,
  sourceRegion?: PixelRegion,
): { url: string | null; ms: number | null } {
  if (!enabled) {
    return { url: null, ms: null };
  }

  const startedAt = performance.now();
  const frame = sourceRegion ?? {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };
  const scale = Math.min(
    1,
    1600 / Math.max(1, frame.width),
    900 / Math.max(1, frame.height),
  );
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return { url: null, ms: roundMs(performance.now() - startedAt) };
  }

  context.imageSmoothingEnabled = true;
  context.drawImage(
    source,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    0,
    0,
    width,
    height,
  );

  try {
    return { url: canvas.toDataURL("image/jpeg", 0.78), ms: roundMs(performance.now() - startedAt) };
  } catch {
    return { url: canvas.toDataURL("image/png"), ms: roundMs(performance.now() - startedAt) };
  }
}

function captureBarStrips(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): { strips: FixedYExpBarStripSample[]; frameReadMs: number } {
  const startedAt = performance.now();
  const strips = getFixedYExpBarStripRegions(sourceWidth, sourceHeight).map((region) => {
    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = region.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("canvas-context-unavailable");
    }
    context.drawImage(source, 0, region.y, sourceWidth, region.height, 0, 0, sourceWidth, region.height);
    return {
      ...region,
      imageData: context.getImageData(0, 0, sourceWidth, region.height),
    };
  });

  return {
    strips,
    frameReadMs: roundMs(performance.now() - startedAt),
  };
}

function captureCandidate(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  candidate: HuntStallFixedRegionCandidate,
  includePreview: boolean,
): HuntStallMainThreadCandidateSample {
  const regionPixels = regionToPixels(candidate.relativeRegion, sourceWidth, sourceHeight);
  const scale = Math.max(1, Math.min(3, Math.floor(900 / Math.max(1, regionPixels.width))));
  const width = Math.max(24, regionPixels.width * scale);
  const height = Math.max(12, regionPixels.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("canvas-context-unavailable");
  }

  context.imageSmoothingEnabled = false;
  const frameStartedAt = performance.now();
  context.drawImage(
    source,
    regionPixels.x,
    regionPixels.y,
    regionPixels.width,
    regionPixels.height,
    0,
    0,
    width,
    height,
  );
  const imageData = context.getImageData(0, 0, width, height);
  const rawPreviewUrl = includePreview ? canvas.toDataURL("image/png") : null;

  return {
    label: candidate.label,
    regionPixels,
    imageData,
    rawPreviewUrl,
    frameReadMs: roundMs(performance.now() - frameStartedAt),
  };
}
