import type {
  RuntimeSpecialCoreDecisionReasonV2,
  SpecialCoreRuntimeImageSource,
  SpecialCoreTargetId,
} from "./specialCoreDeepV2Runtime";

export type SpecialCoreIcon = SpecialCoreRuntimeImageSource;

export type SpecialCoreMatcherEvidence = {
  bundleId: "special-core-deep-v2";
  modelId: "special-core-deep-v2";
  modelVersion: string;
  variantId: string;
  gateVersion: 2;
  score: number;
  threshold: number;
  margin: number;
  gateScore: number;
  gateThreshold: number;
  gateMargin: number;
  rescueThreshold: number;
  rescueMargin: number;
  basePassed: boolean;
  positiveGatePassed: boolean;
  primaryPassed: boolean;
  rescuePassed: boolean;
  decisionReason: RuntimeSpecialCoreDecisionReasonV2;
  elapsedMs: number;
};

export type SpecialCoreMatcherResult = SpecialCoreMatcherEvidence & (
  | {
      kind: "target";
      matched: true;
      targetId: SpecialCoreTargetId;
    }
  | {
      kind: "unknown";
      matched: false;
      targetId: null;
    }
);

export type SpecialCoreMatcher = {
  readonly version: string;
  matchBatch(images: readonly SpecialCoreIcon[]): Promise<SpecialCoreMatcherResult[]>;
};
