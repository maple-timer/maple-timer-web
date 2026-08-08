import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuffSlotAnalysisEngine } from "./buffSlotAnalysisWorkerClient";
import {
  evaluatePrecisionParserCpuBenchmark,
  runPrecisionParserCpuBenchmark,
} from "./precisionParserCpuBenchmark";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("precisionParserCpuBenchmark", () => {
  it("accepts a CPU that keeps parser and request p95 inside the cadence budget", () => {
    expect(
      evaluatePrecisionParserCpuBenchmark({
        parserSamplesMs: [380, 410, 420, 450],
        requestSamplesMs: [400, 430, 445, 470],
        measurementDurationMs: 5_000,
        measuredAt: 1_000,
      }),
    ).toMatchObject({
      accepted: true,
      parserAverageMs: 415,
      requestAverageMs: 436.3,
      parserP95Ms: 450,
      requestP95Ms: 470,
    });
  });

  it("rejects a CPU when either p95 exceeds its budget", () => {
    expect(
      evaluatePrecisionParserCpuBenchmark({
        parserSamplesMs: [420, 450, 480, 510],
        requestSamplesMs: [450, 500, 520, 540],
        measurementDurationMs: 5_000,
        measuredAt: 1_000,
      }).accepted,
    ).toBe(false);
    expect(
      evaluatePrecisionParserCpuBenchmark({
        parserSamplesMs: [400, 420, 430, 440],
        requestSamplesMs: [500, 550, 600, 910],
        measurementDurationMs: 5_000,
        measuredAt: 1_000,
      }).accepted,
    ).toBe(false);
  });

  it("rejects a CPU when a rare severe stall pushes the five-second average over budget", () => {
    expect(
      evaluatePrecisionParserCpuBenchmark({
        parserSamplesMs: [...Array(19).fill(400), 3_000],
        requestSamplesMs: [...Array(19).fill(500), 10_000],
        measurementDurationMs: 19_500,
        measuredAt: 1_000,
      }),
    ).toMatchObject({
      accepted: false,
      parserAverageMs: 530,
      parserP95Ms: 400,
      requestAverageMs: 975,
      requestP95Ms: 500,
    });
  });

  it("warms once, measures for five seconds, and always releases the benchmark worker", async () => {
    vi.stubGlobal(
      "ImageData",
      class TestImageData {
        data: Uint8ClampedArray;
        width: number;
        height: number;

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    const process = vi.fn().mockResolvedValue({
      performance: { detectMs: 120 },
    });
    const reset = vi.fn();
    const engine = { process, reset } as unknown as BuffSlotAnalysisEngine;
    let clock = 0;

    const result = await runPrecisionParserCpuBenchmark(
      { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement,
      {
        createEngine: () => engine,
        now: () => {
          clock += 625;
          return clock;
        },
        measuredAt: () => 10_000,
        sampleFrame: () => new ImageData(new Uint8ClampedArray(16), 2, 2),
      },
    );

    expect(process).toHaveBeenCalledTimes(9);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSelection: {
          executionProvider: "wasm",
          selectionSource: "benchmark",
        },
      }),
    );
    expect(result).toMatchObject({
      accepted: true,
      parserSamplesMs: Array(8).fill(120),
      requestSamplesMs: Array(8).fill(625),
      measurementDurationMs: 5_000,
      parserAverageMs: 120,
      requestAverageMs: 625,
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately and releases the isolated benchmark worker", async () => {
    vi.stubGlobal(
      "ImageData",
      class TestImageData {
        data: Uint8ClampedArray;
        width: number;
        height: number;

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    const process = vi.fn(() => new Promise<never>(() => undefined));
    const reset = vi.fn();
    const abortController = new AbortController();

    const benchmark = runPrecisionParserCpuBenchmark(
      { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement,
      {
        createEngine: () =>
          ({ process, reset }) as unknown as BuffSlotAnalysisEngine,
        sampleFrame: () => new ImageData(new Uint8ClampedArray(16), 2, 2),
        signal: abortController.signal,
      },
    );
    abortController.abort();

    await expect(benchmark).rejects.toMatchObject({ name: "AbortError" });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
