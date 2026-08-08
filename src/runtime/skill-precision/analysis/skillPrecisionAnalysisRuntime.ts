import type {
  BuffSlotCountdownModelStatus,
  BuffSlotCountdownObservation,
} from "../../../recognition/buff-slot/countdown-number";
import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import type { BuffSlotParserInputMode } from "../../../recognition/buff-slot/parser/types";
import type {
  BottomRightRemainingCountModelStatus,
  BottomRightRemainingCountObservation,
} from "../../../recognition/skill-precision/remaining-count/bottomRightRemainingCountContract";

export type SkillBuffDurationBox = {
  x: number;
  y: number;
  size: number;
  confidence: number;
  score: number;
};

export type SkillBuffDurationIcon = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type SkillBuffDurationMatch = {
  matched: boolean;
  skillId?: string | null;
  displayName?: string | null;
  detectorId?: string | null;
  matcherEngine?: string | null;
  bundleId?: string | null;
  modelVersion?: string | null;
  baseSkillId?: string | null;
  rawSkillId?: string | null;
  score: number;
  threshold: number;
  margin: number;
  gateScore?: number | null;
  gateThreshold?: number | null;
  gateMargin?: number | null;
  decisionReason: string;
};

export type SkillBuffDurationDetectedIcon = {
  boxIndex: number;
  box: SkillBuffDurationBox;
  icon: SkillBuffDurationIcon;
  match: SkillBuffDurationMatch;
  countdown?: BuffSlotCountdownObservation | null;
  remainingCount?: BottomRightRemainingCountObservation | null;
};

export type SkillBuffDurationCandidateIcon = SkillBuffDurationDetectedIcon;

export type SkillBuffDurationPerformance = {
  totalMs: number;
  detectMs: number;
  matchMs: number;
  countdownMs?: number;
  countdownCount?: number;
  countdownModelStatus?: BuffSlotCountdownModelStatus;
  remainingCountMs?: number;
  remainingCountCount?: number;
  remainingCountModelStatus?: BottomRightRemainingCountModelStatus;
  boxCount: number;
};

export type SkillBuffDurationTargetRequest = {
  skillId: string;
  detectorId?: string;
  matcherEngine?:
    | "prototype"
    | "skill-bundle-v1"
    | "deep-v2"
    | "maehwa-yein-deep-v1";
  matcherSkillId?: string;
  maxBuffRowIndex?: number;
  valueKind?: "countdown" | "remaining-count";
};

export type SkillBuffDurationSampleRequest = {
  imageData: ImageData;
  sampledAt?: number;
  buffSlotAnalysis?: BuffSlotAnalysis;
  buffSlotInputMode?: BuffSlotParserInputMode;
  targets?: SkillBuffDurationTargetRequest[];
};

export type SkillBuffDurationTargetDetection = {
  skillId: string;
  detectedCount: number;
  detectedIcon: SkillBuffDurationDetectedIcon | null;
  candidateIcons: SkillBuffDurationCandidateIcon[];
};

export type SkillBuffDurationSampleResponse = {
  sampledAt: number | null;
  boxCount: number;
  parserRowCount?: number | null;
  parserEngine?: "rule" | "dl" | null;
  parserVersion?: string | null;
  parserFallbackReason?: string | null;
  detectedCount: number;
  detectedIcon: SkillBuffDurationDetectedIcon | null;
  candidateIcons: SkillBuffDurationCandidateIcon[];
  detectionsBySkillId?: Record<string, SkillBuffDurationTargetDetection>;
  performance: SkillBuffDurationPerformance;
  unsupported: false;
  unsupportedReason: null;
};
