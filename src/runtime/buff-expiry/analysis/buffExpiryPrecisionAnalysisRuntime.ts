import type { BuffExpiryTargetGroup } from "../../../contracts/recognition/buffExpiryRecognition";
import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import type { BuffSlotParserInputMode } from "../../../recognition/buff-slot/parser/types";

export type BuffExpiryPrecisionBox = {
  x: number;
  y: number;
  size: number;
  row: number;
  col: number;
  confidence: number;
  score: number;
};

export type BuffExpiryPrecisionIcon = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type BuffExpiryPrecisionPerformance = {
  totalMs: number;
  detectMs: number;
  matchMs?: number;
  countdownMs?: number;
  countdownCount?: number;
  countdownModelStatus?: BuffExpiryPrecisionCountdownModelStatus;
  matcherModelStatus?: BuffExpiryPrecisionMatcherModelStatus;
  matcherBundleStatuses?: BuffExpiryPrecisionMatcherBundleStatus[];
  boxCount: number;
  localizedBoxCount?: number;
  templateCount?: number;
};

export type BuffExpiryPrecisionModuleVersions = {
  runtime: string;
  parser: string;
  matcher: string;
  matcherModel: string;
  matcherBundles?: BuffExpiryPrecisionMatcherBundleVersion[];
  countdown: string;
  localizer?: string;
};

export type BuffExpiryPrecisionSampleRequest = {
  imageData: ImageData;
  sampledAt?: number;
  buffSlotAnalysis?: BuffSlotAnalysis;
  buffSlotInputMode?: BuffSlotParserInputMode;
  sourceSize?: {
    width: number;
    height: number;
  };
  activeGroups?: BuffExpiryPrecisionTargetGroup[];
};

export type BuffExpiryPrecisionBuffSlotLocalization = {
  version: string;
  status: "empty" | "selected" | "unavailable";
  reason:
    | "no-boxes"
    | "source-edge-anchor"
    | "inferred-top-rail"
    | "anchor-not-found";
  parserBoxCount: number;
  parserRowCount: number;
  localizedBoxCount: number;
  localizedRowCount: number;
  spatialExcludedBoxCount: number;
};

export type BuffExpiryPrecisionIconIdentityKind = "target" | "excluded" | "unknown";

export type BuffExpiryPrecisionTargetGroup = BuffExpiryTargetGroup;

export type BuffExpiryPrecisionCountdownModelStatus = "idle" | "loading" | "ready" | "error";

export type BuffExpiryPrecisionMatcherModelStatus = "idle" | "loading" | "ready" | "error";

export type BuffExpiryPrecisionMatcherBundleStatus = {
  group: BuffExpiryPrecisionTargetGroup;
  bundleId: string;
  modelVersion: string;
  status: Exclude<BuffExpiryPrecisionMatcherModelStatus, "idle">;
  error: string | null;
};

export type BuffExpiryPrecisionMatcherBundleVersion = {
  group: BuffExpiryPrecisionTargetGroup;
  bundleId: string;
  modelVersion: string;
};

export type BuffExpiryPrecisionMatcherCandidate = {
  group: BuffExpiryPrecisionTargetGroup;
  bundleId: string;
  modelVersion: string;
  accepted: boolean;
  score: number;
  threshold: number;
  margin: number;
  gateScore: number | null;
  gateThreshold: number;
  gateMargin: number | null;
  decisionReason: string;
};

export type BuffExpiryPrecisionCountdownObservation = {
  kind: "exact" | "not_supported" | "none";
  text: string | null;
  totalSeconds: number | null;
  format: "seconds" | "minutes-seconds" | "unsupported" | "none";
  textRegion: "center" | "bottom-left" | "bottom-right" | "none";
  confidence: number;
  status: "high" | "medium" | "low" | "missing";
  routerTarget: string;
  routerConfidence: number;
  routerStatus: string;
};

export type BuffExpiryPrecisionIconObservation = {
  id: string;
  boxIndex: number;
  box: BuffExpiryPrecisionBox;
  identity: {
    kind: BuffExpiryPrecisionIconIdentityKind;
    group: BuffExpiryPrecisionTargetGroup | null;
    score: number;
    margin: number;
    bundleId?: string | null;
    modelVersion?: string | null;
    gateScore?: number | null;
    gateMargin?: number | null;
    decisionReason: string;
    bestTargetName: string | null;
    bestExcludedName: string | null;
    candidates?: BuffExpiryPrecisionMatcherCandidate[];
  };
  countdown?: BuffExpiryPrecisionCountdownObservation | null;
};

export type BuffExpiryPrecisionBestGroupCandidate = {
  group: BuffExpiryPrecisionTargetGroup;
  boxIndex: number;
  box: BuffExpiryPrecisionBox;
  accepted: boolean;
  matcherAccepted?: boolean;
  winningGroup: BuffExpiryPrecisionTargetGroup | null;
  score: number;
  margin: number;
  bundleId?: string | null;
  modelVersion?: string | null;
  gateScore?: number | null;
  gateMargin?: number | null;
  decisionReason: string;
  countdown?: BuffExpiryPrecisionCountdownObservation | null;
};

export type BuffExpiryPrecisionSampleResponse = {
  boxes: BuffExpiryPrecisionBox[];
  icons: BuffExpiryPrecisionIcon[];
  iconObservations: BuffExpiryPrecisionIconObservation[];
  bestByGroup: BuffExpiryPrecisionBestGroupCandidate[];
  parserEngine?: "rule" | "dl" | null;
  parserFallbackReason?: string | null;
  buffSlotLocalization?: BuffExpiryPrecisionBuffSlotLocalization;
  moduleVersions: BuffExpiryPrecisionModuleVersions;
  unsupported: false;
  unsupportedReason: null;
  performance: BuffExpiryPrecisionPerformance;
};
