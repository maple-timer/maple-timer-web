import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticReport,
} from "../../../contracts/recognition/precisionParserDiagnostics";
import type { PrecisionParserReadiness } from "../../../lib/buffSlotParser/precisionParserAvailability";
import {
  formatPrecisionParserDiagnosticSummary,
  PrecisionParserRequirementBanner,
} from "./PrecisionParserRequirementBanner";

let userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/149.0.0.0 Safari/537.36";

describe("PrecisionParserRequirementBanner", () => {
  beforeEach(() => {
    userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/149.0.0.0 Safari/537.36";
    vi.spyOn(window.navigator, "userAgent", "get").mockImplementation(
      () => userAgent,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, "clipboard");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("leads with CPU recovery and reveals settings beside diagnostic stages", () => {
    const onRetry = vi.fn();
    render(
      <PrecisionParserRequirementBanner
        readiness={createUnavailableReadiness("gpu-adapter")}
        onRetry={onRetry}
        onStartCpuFallback={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByText("그래픽 가속을 사용할 수 없습니다"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/CPU로 정밀 감지를 계속 사용할 수 있습니다/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "CPU로 계속 사용" }),
    ).toBeInTheDocument();
    const settingsButton = screen.getByRole("button", {
      name: "그래픽 설정 확인",
    });
    expect(settingsButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("가능한 원인")).not.toBeInTheDocument();

    fireEvent.click(settingsButton);

    expect(
      screen.getByRole("button", { name: "그래픽 설정 닫기" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("가능한 원인")).toBeInTheDocument();
    expect(
      screen.getByText(
        /브라우저 차단 목록, 관리 정책, 실행 옵션의 영향을 받았을 수 있습니다/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("아래 순서대로 확인해주세요")).toBeInTheDocument();
    expect(
      screen.getByText("Chrome에서 그래픽 가속을 켜세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("브라우저와 그래픽 드라이버를 업데이트하세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("브라우저를 완전히 다시 시작하세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /하드웨어 가속 GPU 일정 예약.*필수 설정이 아니므로 변경하지 않아도 됩니다/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Chrome의 WebGPU 상태를 확인하세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Problems Detected 또는 Log Messages/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/강제로 우회하지 말고 백업 사이트/),
    ).toBeInTheDocument();
    expect(screen.getByText(/chrome:\/\/settings\/system/)).toBeInTheDocument();
    expect(screen.getByText(/chrome:\/\/gpu/)).toBeInTheDocument();
    expect(screen.getByText("진단 결과")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "자세한 진단 결과" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("그래픽 장치 연결 확인")).toBeInTheDocument();
    expect(screen.getAllByText("완료")).toHaveLength(2);
    expect(screen.getByText("문제 발견")).toBeInTheDocument();
    expect(
      screen.getByText(
        /WebGPU 기능은 있지만 실제 그래픽 장치에 연결하지 못했습니다/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("copies a tester-ready diagnostic summary", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onSubmitDiagnostics = vi.fn().mockRejectedValue(new Error("offline"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <PrecisionParserRequirementBanner
        readiness={createUnavailableReadiness("model-session")}
        onRetry={() => undefined}
        onSubmitDiagnostics={onSubmitDiagnostics}
      />,
    );

    openRecoveryDetails();
    fireEvent.click(screen.getByRole("button", { name: "진단 정보 보내기" }));
    await waitFor(() => expect(onSubmitDiagnostics).toHaveBeenCalledOnce());
    expect(
      screen.getByText("전송하지 못했습니다. 진단 정보를 복사해 전달해주세요."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "진단 정보 복사" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain("단계별 결과");
    expect(writeText.mock.calls[0][0]).toContain(
      "실패 단계: 정밀 감지 모델 준비",
    );
    expect(screen.getByRole("button", { name: "복사됨" })).toBeInTheDocument();
  });

  it("formats stable environment and technical details", () => {
    const summary = formatPrecisionParserDiagnosticSummary(
      createUnavailableReadiness("gpu-device"),
      {
        buildLabel: "preview branch@commit",
        origin: "https://preview.example.com",
        userAgent: "Test Browser",
        secureContext: true,
        mainThreadWebGpu: true,
        mainThreadWebGpuAdapterProbe: {
          status: "unavailable",
          technicalMessage: "adapter unavailable",
          adapterDetails: {},
        },
      },
    );

    expect(summary).toContain("빌드: preview branch@commit");
    expect(summary).toContain("메인 화면 WebGPU API: 있음");
    expect(summary).toContain("메인 화면 어댑터 재검사: 연결 실패");
    expect(summary).toContain("오류 코드: test-failure");
    expect(summary).toContain("기술 오류: stage failed");
    expect(summary).not.toContain("브라우저 WebGPU (사용자 확인)");
  });

  it("submits automatic diagnostics without a required questionnaire and exposes the backup site", async () => {
    const readiness = createUnavailableReadiness("gpu-adapter");
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const onSubmitDiagnostics = vi.fn().mockResolvedValue({
      id: "feedback-test-1",
      deduplicated: false,
    });
    render(
      <PrecisionParserRequirementBanner
        readiness={readiness}
        onRetry={() => undefined}
        onSubmitDiagnostics={onSubmitDiagnostics}
      />,
    );

    openRecoveryDetails();
    expect(
      screen.getByText(/화면, 게임 정보, 설정은 보내지 않습니다/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/이번 업데이트 이전에 정상 동작하던 백업 사이트/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "진단 정보 복사" }),
    ).not.toBeInTheDocument();
    const sendButton = screen.getByRole("button", {
      name: "진단 정보 보내기",
    });
    expect(sendButton).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "백업 사이트 열기" }));
    expect(openWindow).toHaveBeenCalledWith(
      "https://backup.maple-timer.com",
      "_blank",
      "noopener,noreferrer",
    );

    fireEvent.click(sendButton);
    await waitFor(() => expect(onSubmitDiagnostics).toHaveBeenCalledOnce());
    expect(onSubmitDiagnostics).toHaveBeenCalledWith(readiness);
    expect(screen.getByRole("button", { name: "전송 완료" })).toBeDisabled();
    expect(screen.getByText(/제보 ID feedback-test-1/)).toBeInTheDocument();
  });

  it("uses the current Chromium browser's own settings addresses", () => {
    userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0";
    render(
      <PrecisionParserRequirementBanner
        readiness={createUnavailableReadiness("gpu-adapter")}
        onRetry={() => undefined}
      />,
    );

    openRecoveryDetails();
    expect(
      screen.getByText("Microsoft Edge에서 그래픽 가속을 켜세요"),
    ).toBeInTheDocument();
    expect(screen.getByText(/edge:\/\/settings\/system/)).toBeInTheDocument();
    expect(screen.getByText(/edge:\/\/gpu/)).toBeInTheDocument();
  });

  it.each([
    [
      "analysis-worker",
      /분석 작업 파일을 불러오지 못했거나 실행 중 응답이 중단/,
    ],
    [
      "webgpu-api",
      /브라우저가 오래됐거나 현재 환경에서 WebGPU 기능을 제공하지 않을 수 있습니다/,
    ],
    [
      "gpu-device",
      /그래픽 장치는 찾았지만 브라우저가 정밀 감지용 연산 장치를 만들지 못했습니다/,
    ],
    [
      "onnx-runtime",
      /정밀 감지 실행 파일을 네트워크나 브라우저 캐시에서 불러오지 못했을 수 있습니다/,
    ],
    [
      "model-session",
      /정밀 감지 모델 파일을 내려받지 못했거나 캐시된 파일 버전이 맞지 않을 수 있습니다/,
    ],
    [
      "first-inference",
      /모델 준비 후 첫 분석 중 그래픽 장치가 초기화되거나 연결을 잃었을 수 있습니다/,
    ],
  ] as const)("shows representative causes for %s failures", (stage, cause) => {
    render(
      <PrecisionParserRequirementBanner
        readiness={createUnavailableReadiness(stage)}
        onRetry={() => undefined}
      />,
    );

    openRecoveryDetails();
    expect(screen.getByText(cause)).toBeInTheDocument();
  });

  it("renders nothing while the parser is ready", () => {
    const { container } = render(
      <PrecisionParserRequirementBanner
        readiness={{
          status: "ready",
          failureReason: null,
          diagnostic: createPrecisionParserDiagnosticReport(),
        }}
        onRetry={() => undefined}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("asks for consent before benchmarking the CPU fallback", async () => {
    const onStartCpuFallback = vi.fn().mockResolvedValue(undefined);
    render(
      <PrecisionParserRequirementBanner
        readiness={createUnavailableReadiness("gpu-adapter")}
        onRetry={() => undefined}
        onStartCpuFallback={onStartCpuFallback}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "CPU로 계속 사용" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText(/그래픽 가속보다 CPU 사용량이 늘어날 수 있습니다/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/약 5초 동안 여러 번 분석.*화면이나 설정은 서버로/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "CPU 속도 확인 후 시작" }),
    );
    await waitFor(() => expect(onStartCpuFallback).toHaveBeenCalledOnce());
  });

  it("lets the user cancel an in-progress CPU benchmark", () => {
    const onStartCpuFallback = vi.fn().mockResolvedValue(undefined);
    const onCancelCpuFallbackBenchmark = vi.fn();
    const readiness = createUnavailableReadiness("gpu-adapter");
    const view = render(
      <PrecisionParserRequirementBanner
        readiness={readiness}
        onRetry={() => undefined}
        onStartCpuFallback={onStartCpuFallback}
        onCancelCpuFallbackBenchmark={onCancelCpuFallbackBenchmark}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "CPU로 계속 사용" }));
    view.rerender(
      <PrecisionParserRequirementBanner
        readiness={readiness}
        cpuFallback={{ status: "benchmarking" }}
        onRetry={() => undefined}
        onStartCpuFallback={onStartCpuFallback}
        onCancelCpuFallbackBenchmark={onCancelCpuFallbackBenchmark}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancelCpuFallbackBenchmark).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the backup action only after the CPU benchmark is rejected", () => {
    const readiness = createUnavailableReadiness("gpu-adapter");
    const onStartCpuFallback = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <PrecisionParserRequirementBanner
        readiness={readiness}
        onRetry={() => undefined}
        onStartCpuFallback={onStartCpuFallback}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "백업 사이트 열기" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <PrecisionParserRequirementBanner
        readiness={readiness}
        cpuFallback={{
          status: "rejected",
          benchmark: {
            accepted: false,
            parserSamplesMs: [700, 720, 740],
            requestSamplesMs: [760, 780, 810],
            measurementDurationMs: 5_000,
            parserAverageMs: 720,
            requestAverageMs: 783,
            parserP95Ms: 740,
            requestP95Ms: 810,
            maxParserP95Ms: 500,
            maxRequestP95Ms: 900,
            measuredAt: 1_000,
          },
        }}
        onRetry={() => undefined}
        onStartCpuFallback={onStartCpuFallback}
      />,
    );

    expect(
      screen.getByRole("button", { name: "CPU 속도 다시 확인" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "백업 사이트 열기" }),
    ).toBeInTheDocument();
  });

  it("does not offer CPU for a model asset failure", () => {
    const readiness = createUnavailableReadiness("model-session");
    readiness.failureReason = "model-load-failed";
    render(
      <PrecisionParserRequirementBanner
        readiness={readiness}
        onRetry={() => undefined}
        onStartCpuFallback={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "CPU로 계속 사용" }),
    ).not.toBeInTheDocument();
  });

  it("offers CPU with capability guidance when an FP16 model cannot start", () => {
    const readiness = createUnavailableReadiness("model-session");
    readiness.failureReason = "webgpu-unavailable";
    readiness.diagnostic.steps["model-session"] = {
      ...readiness.diagnostic.steps["model-session"],
      technicalMessage:
        "GenerateSourceCode Program Transpose requires f16 but the device does not support it.",
    };

    render(
      <PrecisionParserRequirementBanner
        readiness={readiness}
        onRetry={() => undefined}
        onStartCpuFallback={vi.fn()}
      />,
    );

    expect(screen.getByText(/CPU로 정밀 감지를 계속 사용할 수/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "CPU로 계속 사용" }),
    ).toBeInTheDocument();

    openRecoveryDetails();

    expect(screen.getByText("CPU 속도를 확인하세요")).toBeInTheDocument();
    expect(
      screen.getByText(/위의 CPU로 계속 사용을 눌러/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Chrome에서 그래픽 가속을 켜세요"),
    ).not.toBeInTheDocument();
  });

  it("shows an explicit session-only CPU status after the benchmark passes", () => {
    const onRetry = vi.fn();
    const onStop = vi.fn();
    render(
      <PrecisionParserRequirementBanner
        readiness={{
          status: "ready",
          failureReason: null,
          diagnostic: createPrecisionParserDiagnosticReport(),
        }}
        cpuFallback={{
          status: "active",
          benchmark: {
            accepted: true,
            parserSamplesMs: [390, 400, 410, 420],
            requestSamplesMs: [410, 420, 430, 440],
            measurementDurationMs: 5_000,
            parserAverageMs: 405,
            requestAverageMs: 425,
            parserP95Ms: 420,
            requestP95Ms: 440,
            maxParserP95Ms: 500,
            maxRequestP95Ms: 900,
            measuredAt: 1_000,
          },
        }}
        onRetry={onRetry}
        onStopCpuFallback={onStop}
      />,
    );

    expect(screen.getByText("정밀 감지 · CPU 모드")).toBeInTheDocument();
    expect(
      screen.getByText(/한 화면 처리 평균 약 425ms/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "그래픽 가속 다시 확인" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "CPU 모드 종료" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("shows the parser failure instead of an active CPU banner after a WASM error", () => {
    render(
      <PrecisionParserRequirementBanner
        readiness={createUnavailableReadiness("first-inference")}
        cpuFallback={{
          status: "failed",
          phase: "runtime",
          benchmark: {
            accepted: true,
            parserSamplesMs: [390, 400, 410, 420],
            requestSamplesMs: [410, 420, 430, 440],
            measurementDurationMs: 5_000,
            parserAverageMs: 405,
            requestAverageMs: 425,
            parserP95Ms: 420,
            requestP95Ms: 440,
            maxParserP95Ms: 500,
            maxRequestP95Ms: 900,
            measuredAt: 1_000,
          },
          technicalMessage: "wasm-inference-failed",
        }}
        onRetry={() => undefined}
        onStartCpuFallback={vi.fn()}
      />,
    );

    expect(screen.queryByText("정밀 감지 · CPU 모드")).not.toBeInTheDocument();
    expect(
      screen.getByText("정밀 감지를 준비하지 못했습니다"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "CPU 속도 다시 확인" }),
    ).not.toBeInTheDocument();
  });
});

function openRecoveryDetails(): void {
  const button =
    screen.queryByRole("button", { name: "그래픽 설정 확인" }) ??
    screen.getByRole("button", { name: "문제 해결 방법" });
  fireEvent.click(button);
}

function createUnavailableReadiness(
  failedStage: Parameters<
    typeof createPrecisionParserDiagnosticEvent
  >[0]["stage"],
): Extract<PrecisionParserReadiness, { status: "unavailable" }> {
  let report = createPrecisionParserDiagnosticReport();
  const failedIndex = [
    "analysis-worker",
    "webgpu-api",
    "gpu-adapter",
    "gpu-device",
    "onnx-runtime",
    "model-session",
    "first-inference",
  ].indexOf(failedStage);
  const stages = [
    "analysis-worker",
    "webgpu-api",
    "gpu-adapter",
    "gpu-device",
    "onnx-runtime",
    "model-session",
    "first-inference",
  ] as const;
  for (const [index, stage] of stages.entries()) {
    if (index >= failedIndex) {
      break;
    }
    report = applyPrecisionParserDiagnosticEvent(
      report,
      createPrecisionParserDiagnosticEvent({ stage, status: "passed" }),
    );
  }
  report = applyPrecisionParserDiagnosticEvent(
    report,
    createPrecisionParserDiagnosticEvent({
      stage: failedStage,
      status: "failed",
      code: "test-failure",
      technicalMessage: "stage failed",
    }),
  );
  return {
    status: "unavailable",
    failureReason:
      failedStage === "webgpu-api" ||
      failedStage === "gpu-adapter" ||
      failedStage === "gpu-device"
        ? "webgpu-unavailable"
        : "runtime-failed",
    diagnostic: report,
  };
}
