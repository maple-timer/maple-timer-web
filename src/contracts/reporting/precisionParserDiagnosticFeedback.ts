export const PRECISION_PARSER_DIAGNOSTIC_FEEDBACK_SCHEMA =
  "maple-timer.precision-parser-diagnostic";
export const PRECISION_PARSER_DIAGNOSTIC_FEEDBACK_VERSION = 1;

export type PrecisionParserChromeGpuWebGpuStatus =
  | "not-checked"
  | "not-found"
  | "hardware-accelerated"
  | "software-only"
  | "disabled";

export type PrecisionParserDiagnosticUserChecks = {
  chromeGpuWebGpuStatus: PrecisionParserChromeGpuWebGpuStatus;
};

export const DEFAULT_PRECISION_PARSER_DIAGNOSTIC_USER_CHECKS: PrecisionParserDiagnosticUserChecks = {
  chromeGpuWebGpuStatus: "not-checked",
};

export type PrecisionParserDiagnosticSubmissionResult = {
  id: string | null;
  deduplicated: boolean;
};
