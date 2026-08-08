import { BuffSlotAnalysisProcessor } from "../../../runtime/buff-slot/analysis/buffSlotAnalysisProcessor";
import type { PrecisionParserDiagnosticEvent } from "../../../contracts/recognition/precisionParserDiagnostics";
import type {
  BuffSlotAnalysisWorkerRequest,
  BuffSlotAnalysisWorkerResponse,
} from "./buffSlotAnalysisWorkerTypes";

const processor = new BuffSlotAnalysisProcessor(() => performance.now());

self.onmessage = async (event: MessageEvent<BuffSlotAnalysisWorkerRequest>) => {
  const message = event.data;
  const diagnosticState: { latest: PrecisionParserDiagnosticEvent | null } = {
    latest: null,
  };
  try {
    const response = await processor.process({
      imageData: message.imageData,
      sampledAt: message.sampledAt,
      buffSlotInputMode: message.buffSlotInputMode,
      runtimeSelection: message.runtimeSelection,
    }, (diagnostic) => {
      diagnosticState.latest = diagnostic;
      self.postMessage({
        requestId: message.requestId,
        type: "diagnostic",
        diagnostic,
      } satisfies BuffSlotAnalysisWorkerResponse);
    });
    self.postMessage({
      requestId: message.requestId,
      type: "process",
      ok: true,
      response,
    } satisfies BuffSlotAnalysisWorkerResponse);
  } catch (error) {
    self.postMessage({
      requestId: message.requestId,
      type: "process",
      ok: false,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "buff-slot-analysis-worker-error",
        diagnostic:
          diagnosticState.latest?.status === "failed"
            ? diagnosticState.latest
            : null,
      },
    } satisfies BuffSlotAnalysisWorkerResponse);
  }
};
