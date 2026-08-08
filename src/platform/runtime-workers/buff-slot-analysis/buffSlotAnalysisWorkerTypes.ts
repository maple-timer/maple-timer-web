import type {
  BuffSlotAnalysisSampleRequest,
  BuffSlotAnalysisSampleResponse,
} from "../../../runtime/buff-slot/analysis/buffSlotAnalysisRuntime";
import type { PrecisionParserDiagnosticEvent } from "../../../contracts/recognition/precisionParserDiagnostics";

export type BuffSlotAnalysisWorkerProcessRequest = BuffSlotAnalysisSampleRequest & {
  requestId: number;
  type: "process";
};

export type BuffSlotAnalysisWorkerRequest = BuffSlotAnalysisWorkerProcessRequest;

export type BuffSlotAnalysisWorkerProcessResponse = {
  requestId: number;
  type: "process";
} & (
  | {
      ok: true;
      response: BuffSlotAnalysisSampleResponse;
    }
  | {
      ok: false;
      error: {
        message: string;
        diagnostic: PrecisionParserDiagnosticEvent | null;
      };
    }
);

export type BuffSlotAnalysisWorkerDiagnosticResponse = {
  requestId: number;
  type: "diagnostic";
  diagnostic: PrecisionParserDiagnosticEvent;
};

export type BuffSlotAnalysisWorkerResponse =
  | BuffSlotAnalysisWorkerProcessResponse
  | BuffSlotAnalysisWorkerDiagnosticResponse;
