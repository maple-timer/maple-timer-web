import type {
  RuntimeAnalysisFailureEvidence,
  RuntimeAnalysisFailureStage,
} from "../../../contracts/reporting/runtimeReportEvidence";

const RUNTIME_ANALYSIS_FAILURE_MESSAGE_MAX_LENGTH = 500;

export function createRuntimeAnalysisFailureEvidence({
  error,
  occurredAt,
  stage,
}: {
  error: unknown;
  occurredAt: number;
  stage: RuntimeAnalysisFailureStage;
}): RuntimeAnalysisFailureEvidence {
  const technicalMessage = getRuntimeAnalysisFailureMessage(error);
  return {
    stage,
    code: getRuntimeAnalysisFailureCode(error, stage),
    technicalMessage,
    occurredAt,
  };
}

function getRuntimeAnalysisFailureMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown-runtime-analysis-error";
  return message.slice(0, RUNTIME_ANALYSIS_FAILURE_MESSAGE_MAX_LENGTH);
}

function getRuntimeAnalysisFailureCode(
  error: unknown,
  stage: RuntimeAnalysisFailureStage,
): string {
  const message = getRuntimeAnalysisFailureMessage(error);
  if (message === "canvas-context-unavailable") {
    return "canvas-context-unavailable";
  }
  if (message.includes("timeout")) {
    return `${stage}-timeout`;
  }
  return `${stage}-failed`;
}
