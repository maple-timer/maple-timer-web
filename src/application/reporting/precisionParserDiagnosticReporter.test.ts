import { describe, expect, it, vi } from "vitest";
import {
  applyPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticReport,
} from "../../contracts/recognition/precisionParserDiagnostics";
import type { PrecisionParserReadiness } from "../../lib/buffSlotParser/precisionParserAvailability";
import type { PrecisionParserDiagnosticEnvironment } from "../../platform/browser-diagnostics/precisionParserDiagnosticEnvironment";
import { buildPrecisionParserRuntimeReport } from "../../contracts/reporting/precisionParserRuntimeReport";
import {
  buildPrecisionParserDiagnosticFeedbackPayload,
  createPrecisionParserDiagnosticFingerprint,
  submitPrecisionParserDiagnosticReport,
} from "./precisionParserDiagnosticReporter";

describe("precisionParserDiagnosticReporter", () => {
  it("submits technical diagnostics without screen or settings data", async () => {
    const readiness = createUnavailableReadiness();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "feedback-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const storage = createMemoryStorage();

    const result = await submitPrecisionParserDiagnosticReport(readiness, {
      environment: ENVIRONMENT,
      fetchImpl,
      storage,
      userChecks: { chromeGpuWebGpuStatus: "hardware-accelerated" },
      precisionParserRuntime: CPU_RUNTIME_REPORT,
    });

    expect(result).toEqual({ id: "feedback-1", deduplicated: false });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.diagnostics.precisionParser).toMatchObject({
      schema: "maple-timer.precision-parser-diagnostic",
      version: 1,
      failureReason: "webgpu-unavailable",
      failedStage: "gpu-adapter",
      errorCode: "adapter-null",
      environment: {
        mainThreadWebGpuAdapterProbe: {
          status: "not-run",
          technicalMessage: null,
          adapterDetails: {},
        },
      },
      userChecks: { chromeGpuWebGpuStatus: "hardware-accelerated" },
    });
    expect(body.diagnostics.precisionParserRuntime).toMatchObject({
      executionProvider: "wasm",
      cpuFallbackStatus: "active",
      cpuBenchmark: {
        parserAverageMs: 200,
        requestP95Ms: 300,
      },
    });
    expect(body.diagnostics).not.toHaveProperty("capture");
    expect(body.diagnostics).not.toHaveProperty("settings");
    expect(body.attachments).toEqual([]);
  });

  it("deduplicates the same diagnostic fingerprint in session storage", async () => {
    const readiness = createUnavailableReadiness();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "feedback-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const storage = createMemoryStorage();

    await submitPrecisionParserDiagnosticReport(readiness, {
      environment: ENVIRONMENT,
      fetchImpl,
      storage,
    });
    const second = await submitPrecisionParserDiagnosticReport(readiness, {
      environment: ENVIRONMENT,
      fetchImpl,
      storage,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ id: "feedback-1", deduplicated: true });
  });

  it("ignores volatile request duration when deduplicating retries", () => {
    const first = withAdapterDetails(createUnavailableReadiness(), {
      requestElapsedMs: 34,
      visibilityState: "visible",
    });
    const retried = withAdapterDetails(createUnavailableReadiness(), {
      requestElapsedMs: 44,
      visibilityState: "visible",
    });
    const hidden = withAdapterDetails(createUnavailableReadiness(), {
      requestElapsedMs: 44,
      visibilityState: "hidden",
    });

    expect(createPrecisionParserDiagnosticFingerprint(first, ENVIRONMENT)).toBe(
      createPrecisionParserDiagnosticFingerprint(retried, ENVIRONMENT),
    );
    expect(createPrecisionParserDiagnosticFingerprint(hidden, ENVIRONMENT)).not.toBe(
      createPrecisionParserDiagnosticFingerprint(first, ENVIRONMENT),
    );
  });

  it("ignores timestamps but changes the fingerprint when evidence changes", () => {
    const first = createUnavailableReadiness(new Date("2026-07-16T00:00:00.000Z"));
    const second = createUnavailableReadiness(new Date("2026-07-16T00:01:00.000Z"));
    const changed = {
      ...second,
      diagnostic: applyPrecisionParserDiagnosticEvent(
        second.diagnostic,
        createPrecisionParserDiagnosticEvent({
          stage: "gpu-adapter",
          status: "failed",
          code: "adapter-blocked",
          technicalMessage: "adapter blocked",
        }),
      ),
    } satisfies Extract<PrecisionParserReadiness, { status: "unavailable" }>;

    expect(createPrecisionParserDiagnosticFingerprint(first, ENVIRONMENT)).toBe(
      createPrecisionParserDiagnosticFingerprint(second, ENVIRONMENT),
    );
    expect(createPrecisionParserDiagnosticFingerprint(changed, ENVIRONMENT)).not.toBe(
      createPrecisionParserDiagnosticFingerprint(first, ENVIRONMENT),
    );
    expect(
      createPrecisionParserDiagnosticFingerprint(first, ENVIRONMENT, {
        chromeGpuWebGpuStatus: "hardware-accelerated",
      }),
    ).not.toBe(createPrecisionParserDiagnosticFingerprint(first, ENVIRONMENT));
  });

  it("builds a stable API payload", () => {
    const payload = buildPrecisionParserDiagnosticFeedbackPayload(
      createUnavailableReadiness(),
      ENVIRONMENT,
    );

    expect(payload.kind).toBe("bug");
    expect(payload.appBuild.shortCommit).toBe("abcdef1");
    expect(payload.url).toBe("https://preview.maple-timer.pages.dev/");
    expect(payload.diagnostics.precisionParser).not.toHaveProperty("userChecks");
  });
});

const ENVIRONMENT: PrecisionParserDiagnosticEnvironment = {
  appBuild: {
    name: "maple-timer",
    version: "0.1.0",
    commitSha: "abcdef123456",
    shortCommit: "abcdef1",
    branch: "preview",
    deploymentUrl: "https://preview.maple-timer.pages.dev",
    buildTime: "2026-07-16T00:00:00.000Z",
    channel: "preview",
    remoteRecognitionV1TestArm: false,
    runtimeOrigin: "https://preview.maple-timer.pages.dev",
    runtimeHostname: "preview.maple-timer.pages.dev",
  },
  buildLabel: "preview preview@abcdef1",
  origin: "https://preview.maple-timer.pages.dev",
  currentUrl: "https://preview.maple-timer.pages.dev/",
  userAgent: "Test Browser",
  secureContext: true,
  mainThreadWebGpu: true,
  mainThreadWebGpuAdapterProbe: {
    status: "not-run",
    technicalMessage: null,
    adapterDetails: {},
  },
  viewport: { width: 1920, height: 1080 },
};

const CPU_RUNTIME_REPORT = buildPrecisionParserRuntimeReport(
  { executionProvider: "wasm", selectionSource: "user-opt-in" },
  {
    status: "active",
    benchmark: {
      accepted: true,
      parserSamplesMs: [180, 200, 220],
      requestSamplesMs: [240, 260, 300],
      measurementDurationMs: 5_000,
      parserAverageMs: 200,
      requestAverageMs: 266.7,
      parserP95Ms: 220,
      requestP95Ms: 300,
      maxParserP95Ms: 500,
      maxRequestP95Ms: 900,
      measuredAt: 1_752_800_000_000,
    },
  },
);

function createUnavailableReadiness(
  now = new Date("2026-07-16T00:00:00.000Z"),
): Extract<PrecisionParserReadiness, { status: "unavailable" }> {
  let report = createPrecisionParserDiagnosticReport();
  report = applyPrecisionParserDiagnosticEvent(
    report,
    createPrecisionParserDiagnosticEvent({
      stage: "analysis-worker",
      status: "passed",
    }),
    now,
  );
  report = applyPrecisionParserDiagnosticEvent(
    report,
    createPrecisionParserDiagnosticEvent({
      stage: "webgpu-api",
      status: "passed",
    }),
    now,
  );
  report = applyPrecisionParserDiagnosticEvent(
    report,
    createPrecisionParserDiagnosticEvent({
      stage: "gpu-adapter",
      status: "failed",
      code: "adapter-null",
      technicalMessage: "adapter unavailable",
      details: { adapterRequest: "null" },
    }),
    now,
  );
  return {
    status: "unavailable",
    failureReason: "webgpu-unavailable",
    diagnostic: report,
  };
}

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function withAdapterDetails(
  readiness: Extract<PrecisionParserReadiness, { status: "unavailable" }>,
  details: Record<string, string | number>,
): Extract<PrecisionParserReadiness, { status: "unavailable" }> {
  return {
    ...readiness,
    diagnostic: applyPrecisionParserDiagnosticEvent(
      readiness.diagnostic,
      createPrecisionParserDiagnosticEvent({
        stage: "gpu-adapter",
        status: "failed",
        code: "adapter-null",
        technicalMessage: "adapter unavailable",
        details,
      }),
    ),
  };
}
