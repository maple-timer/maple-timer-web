import { describe, expect, it } from "vitest";
import type { ExpBarEstimate } from "../recognition/hunt-stall/experience/huntStallExperienceBar";
import type {
  HuntStallExperienceCandidateResult,
  HuntStallExperienceProcessResult,
} from "../runtime/hunt-stall/experience/huntStallExperienceRuntime";
import {
  buildCropCandidateSnapshots,
  buildPerformanceMetrics,
  buildSourceDetails,
  mergeCandidatePerformance,
  roundMs,
} from "./huntStallOcrDiagnostics";

function makeCandidate(
  label: string,
  overrides: Partial<HuntStallExperienceCandidateResult> = {},
): HuntStallExperienceCandidateResult {
  return {
    label,
    regionPixels: { x: 10, y: 20, width: 120, height: 24 },
    reading: {
      fingerprint: `${label}-fingerprint`,
      recognizedText: "12,345 [1.23%]",
      debugText: `${label}-debug`,
      confidence: 0.82,
      foregroundRatio: 0.14,
    },
    score: 0.76,
    performance: {
      totalMs: 5.24,
      frameReadMs: 0,
      ocrMs: 3.1,
      previewMs: 0.8,
    },
    barPercent: 1.23,
    barConfidence: 0.7,
    barCoverage: "partial_bar",
    ...overrides,
  };
}

function makeResponse(
  candidates: HuntStallExperienceCandidateResult[],
  overrides: Partial<HuntStallExperienceProcessResult> = {},
): HuntStallExperienceProcessResult {
  return {
    selectedIndex: 0,
    reading: candidates[0].reading,
    barEstimate: null,
    candidates,
    performance: {
      totalMs: 0,
      barEstimateMs: 1.2,
      candidateCount: candidates.length,
      candidateMs: null,
      selectedCandidateMs: null,
      selectedFrameReadMs: null,
      selectedOcrMs: null,
      selectedPreviewMs: null,
      fullFramePreviewMs: null,
      barFrameReadMs: null,
    },
    ...overrides,
  };
}

function makeBarEstimate(overrides: Partial<ExpBarEstimate> = {}): ExpBarEstimate {
  return {
    percent: 17.166,
    confidence: 0.88,
    fillX0: 10,
    fillX1: 80,
    trackX0: 0,
    trackX1: 100,
    y: 5,
    supportRows: 3,
    sourceLabel: "fixed-bar",
    ...overrides,
  };
}

describe("huntStallOcrDiagnostics", () => {
  it("rounds millisecond values to one decimal place", () => {
    expect(roundMs(1.24)).toBe(1.2);
    expect(roundMs(1.25)).toBe(1.3);
  });

  it("merges main-thread frame read timing into worker candidate performance", () => {
    const candidates = [
      makeCandidate("primary", {
        performance: { totalMs: 4.24, frameReadMs: 0, ocrMs: 2.5, previewMs: 0.5 },
      }),
      makeCandidate("fallback", {
        performance: { totalMs: 7.99, frameReadMs: 0, ocrMs: 5.5, previewMs: 1.1 },
      }),
    ];

    const merged = mergeCandidatePerformance(candidates, [
      { frameReadMs: 1.22 },
      { frameReadMs: 0.54 },
    ]);

    expect(merged[0].performance).toMatchObject({ frameReadMs: 1.22, totalMs: 5.5 });
    expect(merged[1].performance).toMatchObject({ frameReadMs: 0.54, totalMs: 8.5 });
    expect(candidates[0].performance.frameReadMs).toBe(0);
  });

  it("builds aggregate performance metrics from worker and selected candidate timings", () => {
    const selected = makeCandidate("selected", {
      performance: { totalMs: 6.2, frameReadMs: 1.1, ocrMs: 3.2, previewMs: 0.9 },
    });
    const other = makeCandidate("other", {
      performance: { totalMs: 4.4, frameReadMs: 0.7, ocrMs: 2.9, previewMs: 0.2 },
    });
    const response = makeResponse([selected, other]);

    const metrics = buildPerformanceMetrics(response, selected, 2.3, 1.4, 100, 111.24);

    expect(metrics).toMatchObject({
      totalMs: 11.2,
      candidateMs: 10.6,
      selectedCandidateMs: 6.2,
      selectedFrameReadMs: 1.1,
      selectedOcrMs: 3.2,
      selectedPreviewMs: 0.9,
      fullFramePreviewMs: 1.4,
      barFrameReadMs: 2.3,
    });
  });

  it("builds compact source details for report payloads", () => {
    const selected = makeCandidate("fixed-y-wide", {
      reading: {
        fingerprint: "selected",
        recognizedText: null,
        confidence: 0.5,
        foregroundRatio: 0.1,
      },
    });
    const response = makeResponse([selected], {
      reading: {
        ...selected.reading,
        correctionApplied: true,
        correctionReason: "bar-correction",
      },
      barEstimate: makeBarEstimate(),
    });

    expect(buildSourceDetails(response, selected)).toBe(
      "fixed-y-wide / bar=17.166% c=0.88 / one=-- / correction=bar-correction",
    );
  });

  it("maps candidate diagnostics into report snapshots", () => {
    const selected = makeCandidate("selected");
    const rejected = makeCandidate("rejected", {
      regionPixels: { x: 30, y: 40, width: 90, height: 18 },
      score: 0.33,
      barPercent: null,
      barConfidence: null,
      barCoverage: "no_bar",
    });

    const snapshots = buildCropCandidateSnapshots(
      [selected, rejected],
      [{ rawPreviewUrl: "data:image/png;base64,selected" }],
      1,
    );

    expect(snapshots).toEqual([
      {
        label: "selected",
        regionLabel: "10,20 120x24",
        pixelRegion: { x: 10, y: 20, width: 120, height: 24 },
        score: 0.76,
        selected: false,
        rawPreviewUrl: "data:image/png;base64,selected",
        processedPreviewUrl: null,
        recognizedText: "12,345 [1.23%]",
        debugText: "selected-debug",
        confidence: 0.82,
        foregroundRatio: 0.14,
        barPercent: 1.23,
        barConfidence: 0.7,
        barCoverage: "partial_bar",
        performance: selected.performance,
      },
      {
        label: "rejected",
        regionLabel: "30,40 90x18",
        pixelRegion: { x: 30, y: 40, width: 90, height: 18 },
        score: 0.33,
        selected: true,
        rawPreviewUrl: null,
        processedPreviewUrl: null,
        recognizedText: "12,345 [1.23%]",
        debugText: "rejected-debug",
        confidence: 0.82,
        foregroundRatio: 0.14,
        barPercent: null,
        barConfidence: null,
        barCoverage: "no_bar",
        performance: rejected.performance,
      },
    ]);
  });
});
