import { afterEach, describe, expect, it } from "vitest";
import {
  getRuntimePerformanceDiagnosticsSnapshot,
  observeRuntimeWorkerRequest,
  observeRuntimeWorkerResponse,
  resetRuntimePerformanceDiagnostics,
  setRuntimePerformanceDiagnosticsPaused,
} from "./runtimePerformanceDiagnostics";

describe("runtime performance diagnostics", () => {
  afterEach(() => {
    setRuntimePerformanceDiagnosticsPaused(false);
    resetRuntimePerformanceDiagnostics();
  });

  it("separates parser benchmark samples from the active provider and calculates rolling stats", () => {
    observeRuntimeWorkerRequest("parser-benchmark", {
      type: "process",
      runtimeSelection: {
        executionProvider: "wasm",
        selectionSource: "benchmark",
      },
    });
    observeRuntimeWorkerResponse(
      "parser-benchmark",
      "buffSlotAnalysis.worker-test.js",
      createParserResponse("wasm", "benchmark", 240),
    );

    observeRuntimeWorkerRequest("parser-runtime", {
      type: "process",
      runtimeSelection: {
        executionProvider: "wasm",
        selectionSource: "user-opt-in",
      },
    });
    [100, 200, 300, 400].forEach((detectMs) => {
      observeRuntimeWorkerResponse(
        "parser-runtime",
        "buffSlotAnalysis.worker-test.js",
        createParserResponse("wasm", "user-opt-in", detectMs),
      );
    });

    const snapshot = getRuntimePerformanceDiagnosticsSnapshot();
    expect(snapshot.totalSamples).toBe(5);
    expect(snapshot.pipelines).toHaveLength(2);
    const runtime = snapshot.pipelines.find((pipeline) => pipeline.id.endsWith(":wasm:user-opt-in"));
    expect(runtime).toMatchObject({
      sampleCount: 4,
      metadata: {
        executionProvider: "wasm",
        selectionSource: "user-opt-in",
        parserEngine: "dl",
        parserVersion: "parser-v1",
        modelIds: ["model-v1"],
      },
    });
    expect(runtime?.metrics.find((metric) => metric.key === "detectMs")).toMatchObject({
      latestMs: 400,
      averageMs: 250,
      p95Ms: 400,
      maxMs: 400,
      count: 4,
    });
  });

  it("collects feature stages, active targets, models, and statuses", () => {
    observeRuntimeWorkerRequest("skill", {
      type: "process",
      targets: [
        {
          skillId: "janus",
          matcherEngine: "skill-bundle-v1",
        },
      ],
    });
    observeRuntimeWorkerResponse("skill", "skillPrecisionAnalysis.worker-test.js", {
      ok: true,
      response: {
        parserEngine: "dl",
        parserVersion: "parser-v1",
        candidateIcons: [
          {
            match: {
              skillId: "janus",
              bundleId: "janus-bundle",
              modelVersion: "v3",
            },
          },
        ],
        performance: {
          totalMs: 18,
          detectMs: 0.2,
          matchMs: 12,
          countdownMs: 3,
          countdownModelStatus: "ready",
        },
      },
    });

    expect(getRuntimePerformanceDiagnosticsSnapshot().pipelines[0]).toMatchObject({
      id: "skill-precision",
      label: "스킬 알림 · 정밀",
      sampleCount: 1,
      metadata: {
        parserEngine: "dl",
        parserVersion: "parser-v1",
        activeTargets: ["janus · skill-bundle-v1"],
        modelIds: ["janus: janus-bundle @ v3"],
        statuses: [{ label: "숫자", value: "ready" }],
      },
    });
  });

  it("stops recording while measurement is paused", () => {
    setRuntimePerformanceDiagnosticsPaused(true);
    observeRuntimeWorkerResponse("rune", "runeDetection.worker-test.js", {
      performance: { totalMs: 12 },
    });
    expect(getRuntimePerformanceDiagnosticsSnapshot()).toMatchObject({
      paused: true,
      totalSamples: 0,
    });
  });

  it("reads rune inference timing from the nested detection debug result", () => {
    observeRuntimeWorkerResponse("rune", "runeDetection.worker-test.js", {
      type: "detected",
      result: {
        debug: {
          inferenceMs: 7.25,
        },
      },
    });

    expect(getRuntimePerformanceDiagnosticsSnapshot().pipelines[0]).toMatchObject({
      id: "rune",
      metrics: [
        {
          key: "inferenceMs",
          latestMs: 7.3,
          averageMs: 7.3,
        },
      ],
    });
  });
});

function createParserResponse(
  executionProvider: "webgpu" | "wasm",
  selectionSource: "default" | "benchmark" | "user-opt-in",
  detectMs: number,
) {
  return {
    type: "process",
    ok: true,
    response: {
      analysis: {
        engine: "dl",
        parserVersion: "parser-v1",
        runtime: {
          recognitionEngine: "dl",
          parserVersion: "parser-v1",
          modelId: "model-v1",
          executionProvider,
          selectionSource,
        },
      },
      performance: {
        totalMs: detectMs + 1,
        detectMs,
        queueWaitMs: 0,
      },
    },
  };
}
