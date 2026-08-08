export const PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER = [
  "analysis-worker",
  "webgpu-api",
  "gpu-adapter",
  "gpu-device",
  "onnx-runtime",
  "model-session",
  "first-inference",
] as const;

export type PrecisionParserDiagnosticStage =
  (typeof PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER)[number];

export type PrecisionParserDiagnosticStatus =
  | "pending"
  | "checking"
  | "passed"
  | "failed";

export type PrecisionParserDiagnosticDetail =
  | string
  | number
  | boolean
  | null;

export type PrecisionParserDiagnosticEvent = {
  stage: PrecisionParserDiagnosticStage;
  status: Exclude<PrecisionParserDiagnosticStatus, "pending">;
  code: string | null;
  technicalMessage: string | null;
  details: Record<string, PrecisionParserDiagnosticDetail>;
};

export type PrecisionParserDiagnosticStep = {
  stage: PrecisionParserDiagnosticStage;
  status: PrecisionParserDiagnosticStatus;
  code: string | null;
  technicalMessage: string | null;
  details: Record<string, PrecisionParserDiagnosticDetail>;
};

export type PrecisionParserDiagnosticReport = {
  startedAt: string | null;
  updatedAt: string | null;
  steps: Record<PrecisionParserDiagnosticStage, PrecisionParserDiagnosticStep>;
};

export class PrecisionParserDiagnosticError extends Error {
  readonly precisionParserDiagnostic: PrecisionParserDiagnosticEvent;

  constructor(message: string, diagnostic: PrecisionParserDiagnosticEvent) {
    super(message);
    this.name = "PrecisionParserDiagnosticError";
    this.precisionParserDiagnostic = diagnostic;
  }
}

export function createPrecisionParserDiagnosticEvent({
  stage,
  status,
  code = null,
  technicalMessage = null,
  details = {},
}: Omit<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details"> &
  Partial<Pick<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details">>): PrecisionParserDiagnosticEvent {
  return { stage, status, code, technicalMessage, details };
}

export function createPrecisionParserDiagnosticReport(): PrecisionParserDiagnosticReport {
  return {
    startedAt: null,
    updatedAt: null,
    steps: Object.fromEntries(
      PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER.map((stage) => [
        stage,
        {
          stage,
          status: "pending",
          code: null,
          technicalMessage: null,
          details: {},
        } satisfies PrecisionParserDiagnosticStep,
      ]),
    ) as Record<PrecisionParserDiagnosticStage, PrecisionParserDiagnosticStep>,
  };
}

export function applyPrecisionParserDiagnosticEvent(
  report: PrecisionParserDiagnosticReport,
  event: PrecisionParserDiagnosticEvent,
  now: Date = new Date(),
): PrecisionParserDiagnosticReport {
  const timestamp = now.toISOString();
  const current = report.steps[event.stage];
  if (current.status === "passed" && event.status === "checking") {
    return report;
  }

  return {
    startedAt: report.startedAt ?? timestamp,
    updatedAt: timestamp,
    steps: {
      ...report.steps,
      [event.stage]: {
        stage: event.stage,
        status: event.status,
        code: event.code,
        technicalMessage: event.technicalMessage,
        details: event.details,
      },
    },
  };
}

export function getFailedPrecisionParserDiagnosticStep(
  report: PrecisionParserDiagnosticReport,
): PrecisionParserDiagnosticStep | null {
  for (const stage of PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER) {
    const step = report.steps[stage];
    if (step.status === "failed") {
      return step;
    }
  }
  return null;
}

export function getPrecisionParserDiagnosticEvent(
  error: unknown,
): PrecisionParserDiagnosticEvent | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = (error as { precisionParserDiagnostic?: unknown })
    .precisionParserDiagnostic;
  return isPrecisionParserDiagnosticEvent(candidate) ? candidate : null;
}

function isPrecisionParserDiagnosticEvent(
  value: unknown,
): value is PrecisionParserDiagnosticEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PrecisionParserDiagnosticEvent>;
  return (
    PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER.includes(
      candidate.stage as PrecisionParserDiagnosticStage,
    ) &&
    (candidate.status === "checking" ||
      candidate.status === "passed" ||
      candidate.status === "failed") &&
    (candidate.code === null || typeof candidate.code === "string") &&
    (candidate.technicalMessage === null ||
      typeof candidate.technicalMessage === "string") &&
    Boolean(candidate.details && typeof candidate.details === "object")
  );
}
