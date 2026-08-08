import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrecisionParserDiagnosticReport } from "../../contracts/recognition/precisionParserDiagnostics";
import type { MemoryDiagnosticsSample } from "../../lib/memoryDiagnostics";

const collectMemoryDiagnosticsSample = vi.hoisted(() => vi.fn());

vi.mock("../../lib/memoryDiagnostics", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/memoryDiagnostics")>();
  return {
    ...original,
    collectMemoryDiagnosticsSample,
  };
});

import { MemoryDiagnosticsPanel } from "./MemoryDiagnosticsPanel";

describe("MemoryDiagnosticsPanel", () => {
  beforeEach(() => {
    collectMemoryDiagnosticsSample.mockResolvedValue(createSample());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the active parser provider, CPU benchmark, and stage statistics", async () => {
    render(
      <MemoryDiagnosticsPanel
        mode="lab"
        buildInfo={{ channel: "preview" }}
        precisionParserReadiness={{
          status: "ready",
          failureReason: null,
          diagnostic: createPrecisionParserDiagnosticReport(),
        }}
        precisionParserRuntimeSelection={{
          executionProvider: "wasm",
          selectionSource: "user-opt-in",
        }}
        precisionParserCpuFallback={{
          status: "active",
          benchmark: {
            accepted: true,
            parserSamplesMs: [240, 242, 245, 248],
            requestSamplesMs: [250, 252, 255, 258],
            measurementDurationMs: 5_000,
            parserAverageMs: 243.8,
            requestAverageMs: 253.8,
            parserP95Ms: 248,
            requestP95Ms: 258,
            maxParserP95Ms: 500,
            maxRequestP95Ms: 900,
            measuredAt: 1,
          },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("기능별 처리 속도")).toBeInTheDocument());
    expect(screen.getByText(/연산 CPU \(WASM\)/)).toBeInTheDocument();
    expect(screen.getByText(/CPU fallback 사용 중/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /parser 244ms \/ 248ms · request 254ms \/ 258ms · 4회 측정/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /공유 버프칸 parser/ })).toBeInTheDocument();
    expect(screen.getByText("모델 추론")).toBeInTheDocument();
    expect(screen.getByText("250ms")).toBeInTheDocument();
    expect(screen.getAllByText("400ms")).toHaveLength(2);
  });
});

function createSample(): MemoryDiagnosticsSample {
  return {
    sampledAt: "2026-07-18T00:00:00.000Z",
    elapsedMs: 5_000,
    url: "https://preview.maple-timer.pages.dev/memory-lab",
    build: { channel: "preview" },
    userAgent: "test",
    deviceMemoryGb: 8,
    hardwareConcurrency: 8,
    crossOriginIsolated: true,
    performanceMemory: {
      supported: true,
      usedJSHeapSize: 100,
      totalJSHeapSize: 200,
      jsHeapSizeLimit: 1_000,
    },
    userAgentSpecificMemory: {
      supported: false,
      available: false,
      bytes: null,
      breakdown: [],
      error: null,
    },
    workers: {
      installed: true,
      activeCount: 1,
      createdCount: 1,
      terminatedCount: 0,
      postedMessages: 4,
      receivedMessages: 4,
      errors: 0,
      workers: [],
    },
    dom: {
      elementCount: 10,
      elementCountsByTag: [],
      canvasCount: 1,
      canvasPixels: 100,
      largestCanvases: [],
      imageCount: 0,
      dataImageCount: 0,
      dataImageCharacters: 0,
      videoCount: 1,
      videos: [],
      iframeCount: 0,
      stylesheetCount: 1,
      localStorageCharacters: 0,
      sessionStorageCharacters: 0,
    },
    resources: {
      resourceCount: 1,
      workerResourceCount: 1,
      imageResourceCount: 0,
      scriptResourceCount: 1,
      totalTransferSize: 100,
      totalDecodedBodySize: 200,
      largestResources: [],
    },
    profile: {
      loaded: true,
      rawCharacters: 100,
      skillCount: 1,
      enabledSkillCount: 1,
      precisionSkillCount: 1,
      runeEnabled: false,
      huntStallEnabled: false,
      buffExpiryEnabled: false,
      boosterExpiryEnabled: false,
      specialCoreEnabled: false,
      enabledGeneralTimerCount: 0,
    },
    runtimePerformance: {
      paused: false,
      totalSamples: 4,
      pipelines: [
        {
          id: "shared-buff-slot-parser:wasm:user-opt-in",
          label: "공유 버프칸 parser · WASM (user-opt-in)",
          sampleCount: 4,
          lastSampledAt: "2026-07-18T00:00:00.000Z",
          metadata: {
            executionProvider: "wasm",
            selectionSource: "user-opt-in",
            parserEngine: "dl",
            parserVersion: "buff-detector-yolov8n-q1-544x960-fp16",
            modelIds: ["buff-detector-yolov8n-q1-544x960-fp16"],
            activeTargets: [],
            statuses: [],
          },
          metrics: [
            {
              key: "inferenceMs",
              label: "모델 추론",
              count: 4,
              latestMs: 250,
              averageMs: 220,
              p95Ms: 400,
              maxMs: 400,
            },
          ],
        },
      ],
    },
  };
}
