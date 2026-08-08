import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "./feedback.js";

describe("feedback API notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers general feedback to Slack with structured blocks", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      FEEDBACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
    };
    const request = new Request("https://maple-timer.com/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "suggestion",
        message: "제보 모달 Slack 알림 테스트입니다.",
        contact: "tester@example.com",
        submittedAt: "2026-06-09T00:00:00.000Z",
        url: "https://maple-timer.com/",
        appBuild: {
          channel: "production",
          branch: "main",
          shortCommit: "abc123d",
        },
        diagnostics: {
          capture: {
            hasStream: true,
            size: { width: 1920, height: 1080 },
            frameSource: {
              coordinateSpace: "capture",
              layoutKey: "1920x1080",
              gameViewport: {
                state: "calibrated",
                captureSize: { width: 2560, height: 1440 },
                region: { x: 320, y: 180, width: 1920, height: 1080 },
                gameResolution: { width: 1920, height: 1080 },
                revision: 2,
                verification: "calibrated",
              },
            },
          },
          precisionParserRuntime: createPrecisionParserRuntimeReport(),
          settings: {
            runeRuntime: {
              latestAlertTrigger: {
                schemaVersion: "rune-alert-trigger-v1",
                cycleId: "rune-cycle-1",
                decision: "initial",
                triggeredAt: 1_784_720_000_000,
                detectorVersion: "rune-cascade-v10",
                frameCount: 4,
              },
            },
          },
        },
        attachments: [
          {
            name: "screen.png",
            type: "image/png",
            dataUrl: "data:image/png;base64,AA==",
          },
        ],
      }),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.deliveredTo).toBe("slack");
    expect(data.attachmentCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const webhookPayload = JSON.parse(init.body);
    const payloadText = JSON.stringify(webhookPayload);
    expect(webhookPayload.text).toContain("새 Maple Timer 피드백");
    expect(webhookPayload.attachments[0]).toMatchObject({
      color: "#10b981",
    });
    expect(webhookPayload.attachments[0].blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "새 Maple Timer 피드백" },
    });
    expect(payloadText).toContain("제안");
    expect(payloadText).toContain("tester@example.com");
    expect(payloadText).toContain("CPU (WASM)");
    expect(payloadText).toContain("CPU 사용 중");
    expect(payloadText).toContain("CPU 속도 측정");
    expect(payloadText).toContain("전체 평균 267ms");
    expect(payloadText).toContain("게임 영역");
    expect(payloadText).toContain(
      "게임 영역 사용자 설정 · 1920x1080 · 320,180 1920x1080",
    );
    expect(payloadText).toContain("룬 최근 알림");
    expect(payloadText).toContain("최초 · 4프레임 · rune-cascade-v10");
    expect(payloadText).toContain("첨부 파일은 Maple Timer 제보 저장소에 보관됩니다.");
    expect(payloadText).not.toContain("data:image");
  });

  it("formats precision parser diagnostics as readable Slack evidence", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const reportStore = createReportStoreEnv();
    const request = new Request("https://maple-timer.com/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "bug",
        message: "정밀 감지를 준비하지 못해 단계별 진단 정보를 전송했습니다.",
        submittedAt: "2026-07-16T00:00:00.000Z",
        url: "https://preview.maple-timer.pages.dev/",
        appBuild: {
          channel: "preview",
          branch: "codex/webgpu",
          shortCommit: "abcdef1",
        },
        diagnostics: {
          userAgent: "Chrome Test",
          precisionParserRuntime: createPrecisionParserRuntimeReport({
            executionProvider: "webgpu",
            selectionSource: "default",
            cpuFallbackStatus: "rejected",
            benchmarkAccepted: false,
            remoteProvider: {
              status: "failed",
              controlPhase: "failed",
              consentVersion:
                "remote-recognition-parser-provider-preview-2026-08-02",
              generation: 3,
              successfulFrames: 4,
              failedFrames: 3,
              droppedFrames: 2,
              lastE2eMs: 420,
              lastServerTotalMs: 80,
              lastEncodedBytes: 64_000,
              lastSampledAt: 1_785_600_000_000,
              lastError: "temporary-parser-frame-failure",
              failure: {
                code: "service-unavailable",
                phase: "transport",
                retryable: true,
                technicalMessage: "remote parser unavailable",
              },
            },
          }),
          precisionParser: {
            schema: "maple-timer.precision-parser-diagnostic",
            version: 1,
            failureReason: "webgpu-unavailable",
            failedStage: "gpu-adapter",
            errorCode: "adapter-null",
            technicalMessage: "Failed to get GPU adapter",
            environment: {
              origin: "https://preview.maple-timer.pages.dev",
              secureContext: true,
              mainThreadWebGpu: true,
              mainThreadWebGpuAdapterProbe: {
                status: "unavailable",
                technicalMessage:
                  "navigator.gpu.requestAdapter() returned null on the main thread",
                adapterDetails: {},
              },
            },
            userChecks: {
              chromeGpuWebGpuStatus: "not-found",
            },
            report: {
              steps: {
                "analysis-worker": { status: "passed", details: {} },
                "webgpu-api": { status: "passed", details: {} },
                "gpu-adapter": {
                  status: "failed",
                  code: "adapter-null",
                  details: { adapterRequest: "null" },
                },
              },
            },
          },
        },
        attachments: [],
      }),
    });

    const response = await onRequestPost({
      request,
      env: {
        ...reportStore.env,
        FEEDBACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
      },
    });

    expect(response.status).toBe(200);
    const webhookPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const payloadText = JSON.stringify(webhookPayload);
    const fieldSections = webhookPayload.attachments[0].blocks.filter(
      (block) => Array.isArray(block.fields),
    );
    expect(webhookPayload.text).toBe("새 Maple Timer 정밀 감지 진단");
    expect(fieldSections.every((block) => block.fields.length <= 10)).toBe(true);
    expect(payloadText).toContain("그래픽 장치 연결");
    expect(payloadText).toContain("GPU (WebGPU)");
    expect(payloadText).toContain("원격 실패 (실패)");
    expect(payloadText).toContain("transport/service-unavailable");
    expect(payloadText).toContain("CPU 성능 부족");
    expect(payloadText).toContain("CPU 속도 측정");
    expect(payloadText).toContain("adapter-null");
    expect(payloadText).toContain("메인 화면 WebGPU");
    expect(payloadText).toContain("브라우저 WebGPU (사용자 확인)");
    expect(payloadText).toContain("WebGPU 항목을 찾지 못함");
    expect(payloadText).toContain("메인 화면 어댑터 재검사");
    expect(payloadText).toContain("메인 화면 어댑터 연결 실패");
    expect(payloadText).toContain("기술 오류");
    expect(payloadText).toContain("Failed to get GPU adapter");
    expect(payloadText).toContain("단계별 결과");
    expect(payloadText).toContain("화면, 게임 정보, 사용자 설정은 전송되지 않았습니다.");
    expect(payloadText).not.toContain("화면 공유");
    const storedMetadata = JSON.parse(reportStore.bind.mock.calls[0][10]);
    expect(storedMetadata.precisionParserRuntime.remoteProvider).toMatchObject({
      status: "failed",
      controlPhase: "failed",
      failure: { code: "service-unavailable", phase: "transport" },
    });
  });

  it("omits the retired manual WebGPU check from new automatic diagnostics", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://maple-timer.com/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "bug",
        message: "정밀 감지 자동 진단",
        submittedAt: "2026-07-18T00:00:00.000Z",
        url: "https://maple-timer.com/",
        diagnostics: {
          userAgent: "Edge Test",
          precisionParser: {
            schema: "maple-timer.precision-parser-diagnostic",
            version: 1,
            failureReason: "webgpu-unavailable",
            failedStage: "gpu-adapter",
            errorCode: "gpu-adapter-unavailable",
            technicalMessage: "navigator.gpu.requestAdapter() returned null",
            environment: {
              secureContext: true,
              mainThreadWebGpu: true,
              mainThreadWebGpuAdapterProbe: { status: "unavailable" },
            },
            userChecks: { chromeGpuWebGpuStatus: "not-checked" },
            report: { steps: {} },
          },
        },
        attachments: [],
      }),
    });

    const response = await onRequestPost({
      request,
      env: {
        FEEDBACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
      },
    });

    expect(response.status).toBe(200);
    const payloadText = JSON.stringify(
      JSON.parse(fetchMock.mock.calls[0][1].body),
    );
    expect(payloadText).not.toContain("브라우저 WebGPU (사용자 확인)");
    expect(payloadText).toContain("그래픽 장치 연결");
  });

  it("acknowledges a stored report when Slack notification fails", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid_blocks", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const reportStore = createReportStoreEnv();
    const request = new Request("https://maple-timer.com/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "bug",
        message: "저장은 성공하고 알림만 실패합니다.",
        submittedAt: "2026-07-17T00:00:00.000Z",
        url: "https://maple-timer.com/",
        attachments: [],
      }),
    });

    const response = await onRequestPost({
      request,
      env: {
        ...reportStore.env,
        FEEDBACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
      },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      deliveredTo: null,
      stored: true,
      notificationError: "Slack webhook failed with 400",
    });
    expect(reportStore.run).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function createReportStoreEnv() {
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    env: {
      REPORTS_DB: { prepare },
      REPORT_ASSETS: {
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    },
    run,
    bind,
  };
}

function createPrecisionParserRuntimeReport({
  executionProvider = "wasm",
  selectionSource = "user-opt-in",
  cpuFallbackStatus = "active",
  benchmarkAccepted = true,
  remoteProvider = null,
} = {}) {
  return {
    schema: "maple-timer.precision-parser-runtime",
    version: 1,
    executionProvider,
    selectionSource,
    cpuFallbackStatus,
    cpuFallbackPhase: null,
    cpuBenchmark: {
      accepted: benchmarkAccepted,
      measurementDurationMs: 5_000,
      parserSampleCount: 3,
      requestSampleCount: 3,
      parserAverageMs: 200,
      requestAverageMs: 266.7,
      parserP95Ms: 220,
      requestP95Ms: 300,
      maxParserP95Ms: 500,
      maxRequestP95Ms: 900,
      measuredAt: 1_752_800_000_000,
    },
    consecutiveSlowSamples: null,
    technicalMessage: null,
    remoteProvider,
  };
}
