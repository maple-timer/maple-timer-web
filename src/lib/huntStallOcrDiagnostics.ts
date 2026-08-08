import type {
  HuntStallCropCandidateSnapshot,
} from "../alertTypes";
import type {
  HuntStallExperienceCandidateResult,
  HuntStallExperienceProcessResult,
  HuntStallPerformanceMetrics,
} from "../runtime/hunt-stall/experience/huntStallExperienceRuntime";
import { imageDataToUrl } from "./imageData";

export type HuntStallMainCandidateDiagnostics = {
  rawPreviewUrl?: string | null;
  frameReadMs?: number;
};

export function mergeCandidatePerformance(
  candidates: HuntStallExperienceCandidateResult[],
  mainCandidates: HuntStallMainCandidateDiagnostics[],
): HuntStallExperienceCandidateResult[] {
  return candidates.map((candidate, index) => {
    const frameReadMs = mainCandidates[index]?.frameReadMs ?? 0;
    return {
      ...candidate,
      performance: {
        ...candidate.performance,
        frameReadMs,
        totalMs: roundMs(candidate.performance.totalMs + frameReadMs),
      },
    };
  });
}

export function buildPerformanceMetrics(
  response: HuntStallExperienceProcessResult,
  selected: HuntStallExperienceCandidateResult,
  barFrameReadMs: number,
  fullFramePreviewMs: number | null,
  totalStartedAt: number,
  now = performance.now(),
): HuntStallPerformanceMetrics {
  return {
    ...response.performance,
    totalMs: roundMs(now - totalStartedAt),
    candidateMs: roundMs(
      response.candidates.reduce((total, candidate) => total + candidate.performance.totalMs, 0),
    ),
    selectedCandidateMs: selected.performance.totalMs,
    selectedFrameReadMs: selected.performance.frameReadMs,
    selectedOcrMs: selected.performance.ocrMs,
    selectedPreviewMs: selected.performance.previewMs,
    fullFramePreviewMs,
    barFrameReadMs,
  };
}

export function buildSourceDetails(
  response: HuntStallExperienceProcessResult,
  selected: HuntStallExperienceCandidateResult,
): string {
  return [
    selected.label,
    response.barEstimate
      ? `bar=${response.barEstimate.percent.toFixed(3)}% c=${response.barEstimate.confidence.toFixed(2)}`
      : "bar=unknown",
    `one=${selected.reading.recognizedText ?? "--"}`,
    response.reading.correctionApplied
      ? `correction=${response.reading.correctionReason ?? "unknown"}`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

export function buildCropCandidateSnapshots(
  candidates: HuntStallExperienceCandidateResult[],
  mainCandidates: HuntStallMainCandidateDiagnostics[],
  selectedIndex: number,
): HuntStallCropCandidateSnapshot[] {
  return candidates.map((candidate, index) => ({
    label: candidate.label,
    regionLabel: `${candidate.regionPixels.x},${candidate.regionPixels.y} ${candidate.regionPixels.width}x${candidate.regionPixels.height}`,
    pixelRegion: {
      x: candidate.regionPixels.x,
      y: candidate.regionPixels.y,
      width: candidate.regionPixels.width,
      height: candidate.regionPixels.height,
    },
    score: candidate.score,
    selected: index === selectedIndex,
    rawPreviewUrl: mainCandidates[index]?.rawPreviewUrl ?? null,
    processedPreviewUrl: candidate.processedImageData ? imageDataToUrl(candidate.processedImageData) : null,
    recognizedText: candidate.reading.recognizedText,
    debugText: candidate.reading.debugText,
    confidence: candidate.reading.confidence,
    foregroundRatio: candidate.reading.foregroundRatio,
    barPercent: candidate.barPercent,
    barConfidence: candidate.barConfidence,
    barCoverage: candidate.barCoverage,
    performance: candidate.performance,
  }));
}

export function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
