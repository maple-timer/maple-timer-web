import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import type { BuffSlotParserInputMode } from "../../../recognition/buff-slot/parser/types";
import type {
  PrecisionParserRuntimePerformance,
  PrecisionParserRuntimeSelection,
} from "../../../contracts/recognition/precisionParserRuntime";

export type BuffSlotAnalysisPerformance = PrecisionParserRuntimePerformance;

export type BuffSlotAnalysisSampleRequest = {
  imageData: ImageData;
  sampledAt?: number;
  buffSlotInputMode?: BuffSlotParserInputMode;
  runtimeSelection?: PrecisionParserRuntimeSelection;
};

export type BuffSlotAnalysisSampleResponse = {
  sampledAt: number | null;
  analysis: BuffSlotAnalysis;
  performance: BuffSlotAnalysisPerformance;
  unsupported: false;
  unsupportedReason: null;
};

export type BuffSlotAnalysisProcessor = {
  process: (
    request: BuffSlotAnalysisSampleRequest,
  ) => Promise<BuffSlotAnalysisSampleResponse>;
};

export class BuffSlotAnalysisSampleDroppedError extends Error {
  readonly sampledAt: number | null;
  readonly replacedBySampledAt: number | null;

  constructor({
    sampledAt,
    replacedBySampledAt,
  }: {
    sampledAt: number | null;
    replacedBySampledAt: number | null;
  }) {
    super("buff-slot-analysis-sample-dropped");
    this.name = "BuffSlotAnalysisSampleDroppedError";
    this.sampledAt = sampledAt;
    this.replacedBySampledAt = replacedBySampledAt;
  }
}
