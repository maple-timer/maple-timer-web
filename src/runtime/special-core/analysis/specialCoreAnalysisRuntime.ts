import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import type { PrecisionParserRuntimeProvenance } from "../../../contracts/recognition/precisionParserRuntime";
import type { BuffSlotParserInputMode } from "../../../recognition/buff-slot/parser/types";
import type {
  SpecialCoreIcon,
  SpecialCoreMatcherEvidence,
} from "../../../recognition/special-core/specialCoreMatcherTypes";

export type SpecialCoreBox = {
  x: number;
  y: number;
  size: number;
  confidence: number;
  score: number;
};

export type SpecialCoreMatch = SpecialCoreMatcherEvidence & {
  matched: boolean;
  targetId: string | null;
};

export type SpecialCoreCandidateIcon = {
  boxIndex: number;
  box: SpecialCoreBox;
  icon: SpecialCoreIcon;
  match: SpecialCoreMatch;
};

export type SpecialCoreDetectedIcon = SpecialCoreCandidateIcon;

export type SpecialCoreRowGroup = {
  rowIndex: number;
  y: number;
  size: number;
  boxIndexes: number[];
  eligible: boolean;
};

export type SpecialCorePerformance = {
  totalMs: number;
  detectMs: number;
  matchMs: number;
  boxCount: number;
};

export type SpecialCoreSampleRequest = {
  imageData: ImageData;
  sampledAt?: number;
  buffSlotAnalysis?: BuffSlotAnalysis;
  buffSlotInputMode?: BuffSlotParserInputMode;
};

export type SpecialCoreSampleResponse = {
  sampledAt: number | null;
  parserEngine?: "rule" | "dl" | null;
  parserVersion?: string | null;
  parserFallbackReason?: string | null;
  parserRuntime: PrecisionParserRuntimeProvenance | null;
  boxCount: number;
  parsedBoxes: SpecialCoreBox[];
  rowGroups: SpecialCoreRowGroup[];
  eligibleBoxIndexes: number[];
  detectedCount: number;
  detectedIcon: SpecialCoreDetectedIcon | null;
  candidateIcons: SpecialCoreCandidateIcon[];
  performance: SpecialCorePerformance;
  unsupported: false;
  unsupportedReason: null;
};

export type SpecialCoreAnalysisProcessor = {
  process: (request: SpecialCoreSampleRequest) => Promise<SpecialCoreSampleResponse>;
};
