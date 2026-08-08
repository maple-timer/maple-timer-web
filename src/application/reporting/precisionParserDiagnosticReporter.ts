import {
  PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER,
  getFailedPrecisionParserDiagnosticStep,
  type PrecisionParserDiagnosticDetail,
} from "../../contracts/recognition/precisionParserDiagnostics";
import {
  DEFAULT_PRECISION_PARSER_DIAGNOSTIC_USER_CHECKS,
  PRECISION_PARSER_DIAGNOSTIC_FEEDBACK_SCHEMA,
  PRECISION_PARSER_DIAGNOSTIC_FEEDBACK_VERSION,
  type PrecisionParserDiagnosticSubmissionResult,
  type PrecisionParserDiagnosticUserChecks,
} from "../../contracts/reporting/precisionParserDiagnosticFeedback";
import type { PrecisionParserRuntimeReport } from "../../contracts/reporting/precisionParserRuntimeReport";
import type { PrecisionParserReadiness } from "../../lib/buffSlotParser/precisionParserAvailability";
import {
  collectPrecisionParserDiagnosticEnvironment,
  collectPrecisionParserDiagnosticEnvironmentWithProbe,
  type PrecisionParserDiagnosticEnvironment,
} from "../../platform/browser-diagnostics/precisionParserDiagnosticEnvironment";

const SUBMISSION_STORAGE_KEY =
  "maple-timer.precision-parser-diagnostic-submission-v1";

type UnavailablePrecisionParserReadiness = Extract<
  PrecisionParserReadiness,
  { status: "unavailable" }
>;

type SubmissionStorage = Pick<Storage, "getItem" | "setItem">;

type SubmitOptions = {
  environment?: PrecisionParserDiagnosticEnvironment;
  fetchImpl?: typeof fetch;
  storage?: SubmissionStorage | null;
  userChecks?: PrecisionParserDiagnosticUserChecks;
  precisionParserRuntime?: PrecisionParserRuntimeReport;
};

export function buildPrecisionParserDiagnosticFeedbackPayload(
  readiness: UnavailablePrecisionParserReadiness,
  environment: PrecisionParserDiagnosticEnvironment,
  userChecks: PrecisionParserDiagnosticUserChecks =
    DEFAULT_PRECISION_PARSER_DIAGNOSTIC_USER_CHECKS,
  precisionParserRuntime?: PrecisionParserRuntimeReport,
) {
  const failedStep = getFailedPrecisionParserDiagnosticStep(
    readiness.diagnostic,
  );

  return {
    kind: "bug" as const,
    message: "정밀 감지를 준비하지 못해 단계별 진단 정보를 전송했습니다.",
    contact: null,
    submittedAt: new Date().toISOString(),
    url: environment.currentUrl,
    appBuild: environment.appBuild,
    diagnostics: {
      userAgent: environment.userAgent,
      viewport: environment.viewport,
      ...(precisionParserRuntime ? { precisionParserRuntime } : {}),
      precisionParser: {
        schema: PRECISION_PARSER_DIAGNOSTIC_FEEDBACK_SCHEMA,
        version: PRECISION_PARSER_DIAGNOSTIC_FEEDBACK_VERSION,
        failureReason: readiness.failureReason,
        failedStage: failedStep?.stage ?? null,
        errorCode: failedStep?.code ?? null,
        technicalMessage: failedStep?.technicalMessage ?? null,
        environment: {
          origin: environment.origin,
          secureContext: environment.secureContext,
          mainThreadWebGpu: environment.mainThreadWebGpu,
          mainThreadWebGpuAdapterProbe:
            environment.mainThreadWebGpuAdapterProbe,
        },
        ...(userChecks.chromeGpuWebGpuStatus !== "not-checked"
          ? { userChecks }
          : {}),
        report: readiness.diagnostic,
      },
    },
    attachments: [],
  };
}

export function createPrecisionParserDiagnosticFingerprint(
  readiness: UnavailablePrecisionParserReadiness,
  environment: PrecisionParserDiagnosticEnvironment,
  userChecks: PrecisionParserDiagnosticUserChecks =
    DEFAULT_PRECISION_PARSER_DIAGNOSTIC_USER_CHECKS,
  precisionParserRuntime?: PrecisionParserRuntimeReport,
): string {
  return JSON.stringify({
    build: {
      commitSha: environment.appBuild.commitSha,
      buildTime: environment.appBuild.buildTime,
      channel: environment.appBuild.channel,
    },
    origin: environment.origin,
    userAgent: environment.userAgent,
    secureContext: environment.secureContext,
    mainThreadWebGpu: environment.mainThreadWebGpu,
    mainThreadWebGpuAdapterProbe: environment.mainThreadWebGpuAdapterProbe,
    ...(userChecks.chromeGpuWebGpuStatus !== "not-checked"
      ? { userChecks }
      : {}),
    precisionParserRuntime: precisionParserRuntime ?? null,
    failureReason: readiness.failureReason,
    steps: PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER.map((stage) => {
      const step = readiness.diagnostic.steps[stage];
      return {
        stage,
        status: step.status,
        code: step.code,
        technicalMessage: step.technicalMessage,
        details: getStableFingerprintDetails(step.details),
      };
    }),
  });
}

function getStableFingerprintDetails(
  details: Record<string, PrecisionParserDiagnosticDetail>,
) {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => key !== "requestElapsedMs")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export async function submitPrecisionParserDiagnosticReport(
  readiness: UnavailablePrecisionParserReadiness,
  options: SubmitOptions = {},
): Promise<PrecisionParserDiagnosticSubmissionResult> {
  const environment =
    options.environment ??
    (readiness.failureReason === "webgpu-unavailable"
      ? await collectPrecisionParserDiagnosticEnvironmentWithProbe()
      : collectPrecisionParserDiagnosticEnvironment());
  const userChecks =
    options.userChecks ?? DEFAULT_PRECISION_PARSER_DIAGNOSTIC_USER_CHECKS;
  const storage = options.storage === undefined ? getSessionStorage() : options.storage;
  const fingerprint = createPrecisionParserDiagnosticFingerprint(
    readiness,
    environment,
    userChecks,
    options.precisionParserRuntime,
  );
  const previous = readStoredSubmission(storage);
  if (previous?.fingerprint === fingerprint) {
    return { id: previous.id, deduplicated: true };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      buildPrecisionParserDiagnosticFeedbackPayload(
        readiness,
        environment,
        userChecks,
        options.precisionParserRuntime,
      ),
    ),
  });
  const data = (await response.json().catch(() => ({}))) as {
    id?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "진단 정보를 전송하지 못했습니다.",
    );
  }

  const id = typeof data.id === "string" ? data.id : null;
  writeStoredSubmission(storage, { fingerprint, id });
  return { id, deduplicated: false };
}

function getSessionStorage(): SubmissionStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readStoredSubmission(
  storage: SubmissionStorage | null,
): { fingerprint: string; id: string | null } | null {
  if (!storage) {
    return null;
  }
  try {
    const parsed = JSON.parse(storage.getItem(SUBMISSION_STORAGE_KEY) ?? "null") as {
      fingerprint?: unknown;
      id?: unknown;
    } | null;
    if (!parsed || typeof parsed.fingerprint !== "string") {
      return null;
    }
    return {
      fingerprint: parsed.fingerprint,
      id: typeof parsed.id === "string" ? parsed.id : null,
    };
  } catch {
    return null;
  }
}

function writeStoredSubmission(
  storage: SubmissionStorage | null,
  value: { fingerprint: string; id: string | null },
) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(SUBMISSION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The report was delivered even when session storage is unavailable.
  }
}
