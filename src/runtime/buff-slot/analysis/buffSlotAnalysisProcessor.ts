import { parseBuffSlots } from "../../../recognition/buff-slot/parser/parseBuffSlots.js";
import type { PrecisionParserDiagnosticEvent } from "../../../contracts/recognition/precisionParserDiagnostics.js";
import type {
  BuffSlotAnalysisSampleRequest,
  BuffSlotAnalysisSampleResponse,
} from "./buffSlotAnalysisRuntime";

const NORMALIZED_ICON_SIZE = 32;

export class BuffSlotAnalysisProcessor {
  constructor(private readonly now: () => number) {}

  async process(
    request: BuffSlotAnalysisSampleRequest,
    onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void,
  ): Promise<BuffSlotAnalysisSampleResponse> {
    const started = this.now();
    const detectStarted = this.now();
    const analysis = await parseBuffSlots(request.imageData, {
      engine: "dl",
      fallbackToRule: false,
      outputSize: NORMALIZED_ICON_SIZE,
      inputMode: request.buffSlotInputMode,
      runtimeSelection: request.runtimeSelection,
      onDiagnostic,
    });
    const detectMs = this.now() - detectStarted;

    return {
      sampledAt: request.sampledAt ?? null,
      analysis,
      performance: {
        totalMs: roundMs(this.now() - started),
        detectMs: roundMs(detectMs),
        boxCount: analysis.boxes.length,
        queueWaitMs: 0,
        resultAgeMs: null,
        droppedSampleCount: 0,
        sampleIntervalMs: null,
      },
      unsupported: false,
      unsupportedReason: null,
    };
  }
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
