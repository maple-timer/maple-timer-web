import { describe, expect, it } from "vitest";
import {
  applyPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticReport,
  getFailedPrecisionParserDiagnosticStep,
  getPrecisionParserDiagnosticEvent,
  PrecisionParserDiagnosticError,
} from "./precisionParserDiagnostics";

describe("precisionParserDiagnostics", () => {
  it("records ordered readiness progress without regressing a passed step", () => {
    const initial = createPrecisionParserDiagnosticReport();
    const checking = applyPrecisionParserDiagnosticEvent(
      initial,
      createPrecisionParserDiagnosticEvent({
        stage: "analysis-worker",
        status: "checking",
      }),
      new Date("2026-07-16T00:00:00.000Z"),
    );
    const passed = applyPrecisionParserDiagnosticEvent(
      checking,
      createPrecisionParserDiagnosticEvent({
        stage: "analysis-worker",
        status: "passed",
      }),
      new Date("2026-07-16T00:00:01.000Z"),
    );
    const unchanged = applyPrecisionParserDiagnosticEvent(
      passed,
      createPrecisionParserDiagnosticEvent({
        stage: "analysis-worker",
        status: "checking",
      }),
      new Date("2026-07-16T00:00:02.000Z"),
    );

    expect(unchanged).toBe(passed);
    expect(passed.steps["analysis-worker"].status).toBe("passed");
    expect(passed.startedAt).toBe("2026-07-16T00:00:00.000Z");
    expect(passed.updatedAt).toBe("2026-07-16T00:00:01.000Z");
  });

  it("keeps the first failed stage and diagnostic metadata", () => {
    const failure = createPrecisionParserDiagnosticEvent({
      stage: "gpu-adapter",
      status: "failed",
      code: "gpu-adapter-unavailable",
      technicalMessage: "requestAdapter returned null",
      details: { worker: true },
    });
    const report = applyPrecisionParserDiagnosticEvent(
      createPrecisionParserDiagnosticReport(),
      failure,
    );

    expect(getFailedPrecisionParserDiagnosticStep(report)).toEqual({
      ...failure,
      status: "failed",
    });
    expect(
      getPrecisionParserDiagnosticEvent(
        new PrecisionParserDiagnosticError("adapter failed", failure),
      ),
    ).toEqual(failure);
  });
});
