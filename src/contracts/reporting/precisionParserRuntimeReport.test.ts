import { describe, expect, it } from "vitest";
import { buildPrecisionParserRuntimeReport } from "./precisionParserRuntimeReport";

describe("precisionParserRuntimeReport", () => {
  it("stores a compact CPU benchmark summary without raw samples", () => {
    const report = buildPrecisionParserRuntimeReport(
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

    expect(report).toMatchObject({
      schema: "maple-timer.precision-parser-runtime",
      version: 1,
      executionProvider: "wasm",
      selectionSource: "user-opt-in",
      cpuFallbackStatus: "active",
      cpuBenchmark: {
        parserSampleCount: 3,
        requestSampleCount: 3,
        parserAverageMs: 200,
        requestP95Ms: 300,
      },
    });
    expect(report.cpuBenchmark).not.toHaveProperty("parserSamplesMs");
    expect(report.cpuBenchmark).not.toHaveProperty("requestSamplesMs");
  });

  it("records a runtime failure without leaking an unbounded error", () => {
    const report = buildPrecisionParserRuntimeReport(
      { executionProvider: "wasm", selectionSource: "user-opt-in" },
      {
        status: "failed",
        phase: "benchmark",
        technicalMessage: `  ${"x".repeat(700)}  `,
      },
    );

    expect(report.cpuFallbackPhase).toBe("benchmark");
    expect(report.technicalMessage).toHaveLength(500);
    expect(report.cpuBenchmark).toBeNull();
  });

  it("records bounded remote provider and failure provenance without session secrets", () => {
    const report = buildPrecisionParserRuntimeReport(
      { executionProvider: "webgpu", selectionSource: "default" },
      { status: "idle" },
      {
        phase: "failed",
        active: false,
        consentVersion:
          "remote-recognition-parser-provider-preview-2026-08-02",
        generation: 4,
        parserFrames: {
          successfulFrames: 8,
          failedFrames: 3,
          droppedFrames: 2,
          lastE2eMs: 442.4,
          lastServerTotalMs: 85.2,
          lastEncodedBytes: 54_000,
          lastSampledAt: 1_785_600_000_000,
          lastError: "temporary-network-error",
        },
        failure: {
          code: "service-unavailable",
          phase: "transport",
          retryable: true,
          technicalMessage: `  ${"x".repeat(700)}  `,
        },
      },
    );

    expect(report).toMatchObject({
      executionProvider: "webgpu",
      remoteProvider: {
        status: "failed",
        controlPhase: "failed",
        generation: 4,
        successfulFrames: 8,
        failedFrames: 3,
        failure: {
          code: "service-unavailable",
          phase: "transport",
        },
      },
    });
    expect(report.remoteProvider?.failure?.technicalMessage).toHaveLength(500);
    expect(JSON.stringify(report)).not.toContain("session-");
  });

  it("uses remote as the active execution provider only while enabled", () => {
    const report = buildPrecisionParserRuntimeReport(
      { executionProvider: "webgpu", selectionSource: "default" },
      { status: "idle" },
      {
        phase: "ready",
        active: true,
        consentVersion:
          "remote-recognition-parser-provider-preview-2026-08-02",
        generation: 1,
        parserFrames: {
          successfulFrames: 0,
          failedFrames: 0,
          droppedFrames: 0,
          lastE2eMs: null,
          lastServerTotalMs: null,
          lastEncodedBytes: null,
          lastSampledAt: null,
          lastError: null,
        },
        failure: null,
      },
    );

    expect(report).toMatchObject({
      executionProvider: "remote",
      selectionSource: "user-opt-in",
      remoteProvider: { status: "active" },
    });
  });
});
