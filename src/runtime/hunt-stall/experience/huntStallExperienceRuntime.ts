import type { HuntStallReading } from "../../../contracts/recognition/huntStallExperienceRecognition";
import type {
  ExpBarEstimate,
  FixedYExpBarStripSample,
  HuntStallExperienceBarCoverage,
} from "../../../recognition/hunt-stall/experience/huntStallExperienceBar";
import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";

export type HuntStallCandidatePerformanceMetrics = {
  totalMs: number;
  frameReadMs: number;
  ocrMs: number;
  previewMs: number;
};

export type HuntStallPerformanceMetrics = {
  totalMs: number;
  barEstimateMs: number | null;
  candidateCount: number | null;
  candidateMs: number | null;
  selectedCandidateMs: number | null;
  selectedFrameReadMs: number | null;
  selectedOcrMs: number | null;
  selectedPreviewMs: number | null;
  fullFramePreviewMs: number | null;
  barFrameReadMs?: number | null;
  loopMs?: number | null;
};

export type HuntStallExperienceCandidateInput = {
  label: string;
  regionPixels: PixelRegion;
  imageData: ImageData;
};

export type HuntStallExperienceProcessInput = {
  sampleIndex: number;
  sourceWidth: number;
  sourceHeight: number;
  barStrips: FixedYExpBarStripSample[];
  candidates: HuntStallExperienceCandidateInput[];
  includePreview: boolean;
  includeReportDiagnostics: boolean;
  applyStreamingCorrection?: boolean;
};

export type HuntStallExperienceCandidateResult = {
  label: string;
  regionPixels: PixelRegion;
  reading: HuntStallReading;
  processedImageData?: ImageData;
  score: number;
  performance: HuntStallCandidatePerformanceMetrics;
  barPercent: number | null;
  barConfidence: number | null;
  barCoverage: HuntStallExperienceBarCoverage;
};

export type HuntStallExperienceProcessResult = {
  selectedIndex: number;
  reading: HuntStallReading;
  barEstimate: ExpBarEstimate | null;
  candidates: HuntStallExperienceCandidateResult[];
  performance: HuntStallPerformanceMetrics;
};

export type HuntStallExperienceProcessor = {
  reset: () => void;
  process: (input: HuntStallExperienceProcessInput) => HuntStallExperienceProcessResult;
};
