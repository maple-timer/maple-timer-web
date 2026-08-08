import {
  classifyBarCoverage,
  estimateFixedYExpBarFromStrips,
  type ExpBarEstimate,
} from "../../../recognition/hunt-stall/experience/huntStallExperienceBar";
import type { HuntStallReading } from "../../../contracts/recognition/huntStallExperienceRecognition";
import { readHuntStallReadingFromImageData } from "../../../recognition/hunt-stall/experience/huntStallExperienceRecognition";
import { FixedYDirectStreamCorrector } from "./fixedYDirectStreamCorrector";
import {
  scoreHuntStallCropCandidate,
  type HuntStallCropScoreInput,
} from "../../../recognition/hunt-stall/experience/huntStallCropScoring";
import type {
  HuntStallExperienceCandidateInput,
  HuntStallExperienceCandidateResult,
  HuntStallExperienceProcessInput,
  HuntStallExperienceProcessResult,
} from "./huntStallExperienceRuntime";

export class HuntStallExperienceProcessor {
  private corrector = new FixedYDirectStreamCorrector();
  private sourceKey: string | null = null;

  constructor(private readonly now: () => number) {}

  reset(): void {
    this.corrector.reset();
    this.sourceKey = null;
  }

  process(input: HuntStallExperienceProcessInput): HuntStallExperienceProcessResult {
    const totalStartedAt = this.now();
    this.resetIfSourceChanged(input.sourceWidth, input.sourceHeight);

    const barStartedAt = this.now();
    const barEstimate = estimateFixedYExpBarFromStrips(input.barStrips, input.sourceWidth);
    const barEstimateMs = roundMs(this.now() - barStartedAt);
    const candidates = input.candidates.map((candidate) =>
      processCandidate(
        candidate,
        barEstimate,
        input.includePreview || input.includeReportDiagnostics,
        this.now,
      ),
    );
    const selected = [...candidates].sort((left, right) => right.score - left.score)[0];
    const selectedIndex = Math.max(0, candidates.findIndex((candidate) => candidate === selected));
    const raw = selected ?? candidates[0];

    if (!raw) {
      throw new Error("hunt-stall-worker-no-candidates");
    }

    const corrected = input.applyStreamingCorrection === false
      ? raw.reading
      : this.corrector.correct(raw.reading, {
          id: `live_${String(input.sampleIndex).padStart(6, "0")}`,
          frameIndex: String(input.sampleIndex),
          timestamp: (this.now() / 1000).toFixed(3),
          cycle: "live",
          barEstimate,
          regionPixels: raw.regionPixels,
        });
    const reading = withOcrMetadata(corrected, raw, barEstimate);

    return {
      selectedIndex,
      reading,
      barEstimate,
      candidates,
      performance: {
        totalMs: roundMs(this.now() - totalStartedAt),
        barEstimateMs,
        candidateCount: candidates.length,
        candidateMs: roundMs(candidates.reduce((total, candidate) => total + candidate.performance.totalMs, 0)),
        selectedCandidateMs: raw.performance.totalMs,
        selectedFrameReadMs: null,
        selectedOcrMs: raw.performance.ocrMs,
        selectedPreviewMs: raw.performance.previewMs,
        fullFramePreviewMs: null,
      },
    };
  }

  private resetIfSourceChanged(width: number, height: number): void {
    const nextKey = `${width}x${height}`;
    if (this.sourceKey === nextKey) {
      return;
    }
    this.corrector.reset();
    this.sourceKey = nextKey;
  }
}

function processCandidate(
  candidate: HuntStallExperienceCandidateInput,
  barEstimate: ExpBarEstimate | null,
  includeProcessedImageData: boolean,
  now: () => number,
): HuntStallExperienceCandidateResult {
  const totalStartedAt = now();
  const ocrStartedAt = now();
  const { processedImageData, reading } = readHuntStallReadingFromImageData(candidate.imageData);
  const ocrMs = roundMs(now() - ocrStartedAt);
  const scoreInput: HuntStallCropScoreInput = {
    recognizedText: reading.recognizedText,
    confidence: reading.confidence,
    foregroundRatio: reading.foregroundRatio,
    regionWidth: candidate.regionPixels.width,
    processedImageData,
  };
  const metadata = withOcrMetadata(reading, { reading, regionPixels: candidate.regionPixels }, barEstimate);

  return {
    label: candidate.label,
    regionPixels: candidate.regionPixels,
    reading,
    processedImageData: includeProcessedImageData ? processedImageData : undefined,
    score: scoreHuntStallCropCandidate(scoreInput),
    performance: {
      totalMs: roundMs(now() - totalStartedAt),
      frameReadMs: 0,
      ocrMs,
      previewMs: 0,
    },
    barPercent: metadata.barPercent ?? null,
    barConfidence: metadata.barConfidence ?? null,
    barCoverage: metadata.barCoverage ?? "unknown",
  };
}

function withOcrMetadata(
  reading: HuntStallReading,
  raw: {
    reading: HuntStallReading;
    regionPixels: HuntStallExperienceCandidateInput["regionPixels"];
  },
  barEstimate: ExpBarEstimate | null,
): HuntStallReading {
  const rawText = raw.reading.recognizedText;
  const finalText = reading.recognizedText;
  const correctionApplied = Boolean(finalText && rawText && finalText !== rawText);
  const barCoverage = classifyBarCoverage(barEstimate, raw.regionPixels);

  return {
    ...reading,
    rawRecognizedText: rawText,
    correctedRecognizedText: finalText,
    correctionApplied,
    correctionReason: correctionApplied ? extractCorrectionReason(reading.debugText) : null,
    barPercent: barEstimate?.percent ?? null,
    barConfidence: barEstimate?.confidence ?? null,
    barCoverage,
    oneFrameRecognizedText: rawText,
  };
}

function extractCorrectionReason(debugText: string | undefined): string {
  const text = debugText ?? "";
  const knownReasons = [
    "suffix_total_projection",
    "total_candidate_repair",
    "synthetic_bar_total",
    "drop_extra_digit_total",
    "gross_total_percent_repair",
    "leading_one_total",
    "fixed_stream",
  ];
  return knownReasons.find((reason) => text.includes(reason)) ?? "corrected";
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
