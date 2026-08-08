import { describe, expect, it } from "vitest";
import {
  createPrecisionParserDiagnosticEvent,
  createPrecisionParserDiagnosticReport,
  PrecisionParserDiagnosticError,
} from "../../contracts/recognition/precisionParserDiagnostics";
import {
  canOfferPrecisionParserCpuFallback,
  classifyPrecisionParserFailure,
  getPrecisionParserFailureContent,
  normalizePrecisionParserError,
} from "./precisionParserAvailability";

describe("precisionParserAvailability", () => {
  it.each([
    ["dl-buff-parser-webgpu-unavailable"],
    ["no available backend found. ERR: [webgpu] Failed to get GPU adapter"],
  ])("classifies WebGPU environment failures", (message) => {
    expect(classifyPrecisionParserFailure(message)).toBe("webgpu-unavailable");
  });

  it("keeps model and worker failures low-cardinality", () => {
    expect(
      classifyPrecisionParserFailure("failed to fetch /models/parser.onnx"),
    ).toBe("model-load-failed");
    expect(
      classifyPrecisionParserFailure("buff-slot-analysis-worker-timeout"),
    ).toBe("worker-failed");
    expect(classifyPrecisionParserFailure("unexpected inference output")).toBe(
      "runtime-failed",
    );
    expect(classifyPrecisionParserFailure("no available backend found")).toBe(
      "runtime-failed",
    );
  });

  it("replaces technical errors with actionable user copy", () => {
    const error = normalizePrecisionParserError(
      new Error(
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
      ),
    );

    expect(error.failureReason).toBe("webgpu-unavailable");
    expect(error.message).toBe("정밀 감지용 WebGPU를 사용할 수 없습니다.");
    expect(error.technicalMessage).toContain("GPU adapter");
    expect(
      getPrecisionParserFailureContent(error.failureReason).description,
    ).toContain("아래 순서대로 확인");
  });

  it("uses the measured worker stage instead of a broad ONNX error string", () => {
    const diagnostic = createPrecisionParserDiagnosticEvent({
      stage: "model-session",
      status: "failed",
      code: "model-session-create-failed",
      technicalMessage:
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
    });
    const error = normalizePrecisionParserError(
      new PrecisionParserDiagnosticError(
        diagnostic.technicalMessage ?? "session failed",
        diagnostic,
      ),
    );

    expect(error.failureReason).toBe("runtime-failed");
    expect(error.diagnostic?.stage).toBe("model-session");
    expect(error.message).toBe("정밀 감지를 시작하지 못했습니다.");
  });

  it("classifies missing modern WebGPU adapter information as browser compatibility", () => {
    const diagnostic = createPrecisionParserDiagnosticEvent({
      stage: "model-session",
      status: "failed",
      code: "model-session-create-failed",
      technicalMessage:
        "Cannot read properties of undefined (reading 'subgroupMinSize')",
    });
    const error = normalizePrecisionParserError(
      new PrecisionParserDiagnosticError(
        diagnostic.technicalMessage ?? "session failed",
        diagnostic,
      ),
    );

    expect(error.failureReason).toBe("webgpu-unavailable");
    expect(error.message).toBe("브라우저의 WebGPU 호환성을 확인해주세요.");
    expect(
      getPrecisionParserFailureContent(
        error.failureReason,
        diagnostic.stage,
        diagnostic.technicalMessage,
      ).description,
    ).toContain("브라우저 업데이트");
  });

  it("classifies an FP16 model rejection as a recoverable WebGPU capability failure", () => {
    const technicalMessage =
      "GenerateSourceCode Program Transpose requires f16 but the device does not support it.";
    const diagnostic = createPrecisionParserDiagnosticEvent({
      stage: "model-session",
      status: "failed",
      code: "model-session-create-failed",
      technicalMessage,
    });
    const error = normalizePrecisionParserError(
      new PrecisionParserDiagnosticError(technicalMessage, diagnostic),
    );

    expect(error.failureReason).toBe("webgpu-unavailable");
    expect(error.message).toBe(
      "정밀 감지 모델에 필요한 그래픽 기능을 사용할 수 없습니다.",
    );

    let report = createPrecisionParserDiagnosticReport();
    report = {
      ...report,
      steps: { ...report.steps, "model-session": diagnostic },
    };
    expect(
      canOfferPrecisionParserCpuFallback({
        status: "unavailable",
        failureReason: "webgpu-unavailable",
        diagnostic: report,
      }),
    ).toBe(true);
  });

  it("offers CPU only for failures that can be isolated from WebGPU", () => {
    const webGpuError = normalizePrecisionParserError(
      new Error(
        "no available backend found. ERR: [webgpu] Failed to get GPU adapter",
      ),
    );
    expect(
      canOfferPrecisionParserCpuFallback({
        status: "unavailable",
        failureReason: webGpuError.failureReason,
        diagnostic: {
          ...createPrecisionParserDiagnosticReport(),
          steps: createPrecisionParserDiagnosticReport().steps,
        },
      }),
    ).toBe(true);

    expect(
      canOfferPrecisionParserCpuFallback(
        {
          status: "unavailable",
          failureReason: webGpuError.failureReason,
          diagnostic: createPrecisionParserDiagnosticReport(),
        },
        { webAssemblyAvailable: false },
      ),
    ).toBe(false);

    const modelDiagnostic = createPrecisionParserDiagnosticEvent({
      stage: "model-session",
      status: "failed",
      code: "model-session-create-failed",
      technicalMessage: "request failed (404) /models/parser.onnx",
    });
    let modelReport = createPrecisionParserDiagnosticReport();
    modelReport = {
      ...modelReport,
      steps: {
        ...modelReport.steps,
        "model-session": modelDiagnostic,
      },
    };
    expect(
      canOfferPrecisionParserCpuFallback({
        status: "unavailable",
        failureReason: "model-load-failed",
        diagnostic: modelReport,
      }),
    ).toBe(false);

    const runtimeDiagnostic = createPrecisionParserDiagnosticEvent({
      stage: "first-inference",
      status: "failed",
      code: "model-inference-failed",
      technicalMessage: "WebGPU device lost during inference",
    });
    let runtimeReport = createPrecisionParserDiagnosticReport();
    runtimeReport = {
      ...runtimeReport,
      steps: {
        ...runtimeReport.steps,
        "first-inference": runtimeDiagnostic,
      },
    };
    expect(
      canOfferPrecisionParserCpuFallback({
        status: "unavailable",
        failureReason: "runtime-failed",
        diagnostic: runtimeReport,
      }),
    ).toBe(true);
  });
});
