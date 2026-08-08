import {
  createPrecisionParserDiagnosticReport,
  getFailedPrecisionParserDiagnosticStep,
  getPrecisionParserDiagnosticEvent,
  type PrecisionParserDiagnosticEvent,
  type PrecisionParserDiagnosticReport,
  type PrecisionParserDiagnosticStage,
} from "../../contracts/recognition/precisionParserDiagnostics";

export type PrecisionParserFailureReason =
  | "webgpu-unavailable"
  | "model-load-failed"
  | "worker-failed"
  | "runtime-failed";

export type PrecisionParserReadiness =
  | {
      status: "idle" | "checking" | "ready";
      failureReason: null;
      diagnostic: PrecisionParserDiagnosticReport;
    }
  | {
      status: "unavailable";
      failureReason: PrecisionParserFailureReason;
      diagnostic: PrecisionParserDiagnosticReport;
    };

export type PrecisionParserFailureContent = {
  title: string;
  description: string;
  errorMessage: string;
};

export function createInitialPrecisionParserReadiness(): PrecisionParserReadiness {
  return {
    status: "idle",
    failureReason: null,
    diagnostic: createPrecisionParserDiagnosticReport(),
  };
}

export function canOfferPrecisionParserCpuFallback(
  readiness: PrecisionParserReadiness,
  environment: { webAssemblyAvailable: boolean } = {
    webAssemblyAvailable:
      typeof WebAssembly === "object" &&
      typeof WebAssembly.instantiate === "function",
  },
): boolean {
  if (!environment.webAssemblyAvailable) {
    return false;
  }
  if (readiness.status !== "unavailable") {
    return false;
  }
  if (readiness.failureReason === "webgpu-unavailable") {
    return true;
  }
  if (readiness.failureReason !== "runtime-failed") {
    return false;
  }

  const failedStep = getFailedPrecisionParserDiagnosticStep(
    readiness.diagnostic,
  );
  if (
    !failedStep ||
    !["onnx-runtime", "model-session", "first-inference"].includes(
      failedStep.stage,
    )
  ) {
    return false;
  }
  const technicalMessage = failedStep.technicalMessage?.toLowerCase() ?? "";
  return isWebGpuRuntimeCompatibilityMessage(technicalMessage);
}

export class PrecisionParserUnavailableError extends Error {
  readonly failureReason: PrecisionParserFailureReason;
  readonly technicalMessage: string;
  readonly diagnostic: PrecisionParserDiagnosticEvent | null;

  constructor({
    failureReason,
    technicalMessage,
    diagnostic = null,
  }: {
    failureReason: PrecisionParserFailureReason;
    technicalMessage: string;
    diagnostic?: PrecisionParserDiagnosticEvent | null;
  }) {
    super(
      getPrecisionParserFailureContent(
        failureReason,
        diagnostic?.stage ?? null,
        technicalMessage,
      ).errorMessage,
    );
    this.name = "PrecisionParserUnavailableError";
    this.failureReason = failureReason;
    this.technicalMessage = technicalMessage;
    this.diagnostic = diagnostic;
  }
}

export function normalizePrecisionParserError(
  error: unknown,
): PrecisionParserUnavailableError {
  if (error instanceof PrecisionParserUnavailableError) {
    return error;
  }

  const technicalMessage = getErrorMessage(error);
  const diagnostic = getPrecisionParserDiagnosticEvent(error);
  return new PrecisionParserUnavailableError({
    failureReason: classifyPrecisionParserFailure(
      technicalMessage,
      diagnostic?.stage ?? null,
    ),
    technicalMessage,
    diagnostic,
  });
}

export function classifyPrecisionParserFailure(
  technicalMessage: string,
  diagnosticStage: PrecisionParserDiagnosticStage | null = null,
): PrecisionParserFailureReason {
  if (
    diagnosticStage === "webgpu-api" ||
    diagnosticStage === "gpu-adapter" ||
    diagnosticStage === "gpu-device"
  ) {
    return "webgpu-unavailable";
  }
  if (diagnosticStage === "analysis-worker") {
    return "worker-failed";
  }
  const message = technicalMessage.toLowerCase();
  if (diagnosticStage) {
    if (
      diagnosticStage === "model-session" &&
      isWebGpuModelCompatibilityMessage(message)
    ) {
      return "webgpu-unavailable";
    }
    if (
      diagnosticStage === "model-session" &&
      (message.includes("failed to fetch") ||
        message.includes("request failed (404)") ||
        message.includes("load model") ||
        message.includes("model load") ||
        message.includes(".onnx"))
    ) {
      return "model-load-failed";
    }
    return "runtime-failed";
  }
  if (
    message.includes("webgpu-unavailable") ||
    message.includes("failed to get gpu adapter") ||
    message.includes("webgpu is not supported")
  ) {
    return "webgpu-unavailable";
  }
  if (
    message.includes("worker-timeout") ||
    message.includes("worker가 종료") ||
    message.includes("worker 전송") ||
    message.includes("worker 오류")
  ) {
    return "worker-failed";
  }
  if (
    message.includes("failed to fetch") ||
    message.includes("request failed (404)") ||
    message.includes("load model") ||
    message.includes("model load") ||
    message.includes(".onnx")
  ) {
    return "model-load-failed";
  }
  return "runtime-failed";
}

export function getPrecisionParserFailureContent(
  reason: PrecisionParserFailureReason,
  diagnosticStage: PrecisionParserDiagnosticStage | null = null,
  technicalMessage: string | null = null,
): PrecisionParserFailureContent {
  if (reason === "webgpu-unavailable") {
    if (isShaderF16CompatibilityMessage(technicalMessage ?? "")) {
      return {
        title: "정밀 감지를 준비하지 못했습니다",
        description:
          "현재 그래픽 환경에서 정밀 감지에 필요한 연산을 사용할 수 없습니다. CPU 방식으로 사용할 수 있는지 확인해주세요.",
        errorMessage:
          "정밀 감지 모델에 필요한 그래픽 기능을 사용할 수 없습니다.",
      };
    }
    if (
      diagnosticStage === "model-session" &&
      isWebGpuModelCompatibilityMessage(technicalMessage ?? "")
    ) {
      return {
        title: "정밀 감지를 준비하지 못했습니다",
        description:
          "현재 브라우저 버전이 정밀 감지에 필요한 그래픽 정보를 제공하지 못했습니다. 브라우저 업데이트부터 확인해주세요.",
        errorMessage: "브라우저의 WebGPU 호환성을 확인해주세요.",
      };
    }
    if (diagnosticStage === "model-session") {
      return {
        title: "정밀 감지를 준비하지 못했습니다",
        description:
          "현재 브라우저 또는 그래픽 장치가 정밀 감지 모델에 필요한 기능을 제공하지 못했습니다. 브라우저와 그래픽 드라이버를 확인해주세요.",
        errorMessage:
          "정밀 감지 모델에 필요한 그래픽 기능을 사용할 수 없습니다.",
      };
    }
    if (diagnosticStage === "gpu-adapter" || diagnosticStage === "gpu-device") {
      return {
        title: "정밀 감지를 준비하지 못했습니다",
        description:
          "브라우저에서 필요한 기능은 확인했지만 실제 그래픽 장치에 연결하지 못했습니다. 아래 순서대로 확인해주세요.",
        errorMessage: "정밀 감지용 그래픽 장치를 준비하지 못했습니다.",
      };
    }
    return {
      title: "정밀 감지를 준비하지 못했습니다",
      description:
        "브라우저에서 정밀 감지에 필요한 기능을 사용할 수 없습니다. 아래 순서대로 확인해주세요.",
      errorMessage: "정밀 감지용 WebGPU를 사용할 수 없습니다.",
    };
  }
  if (reason === "model-load-failed") {
    return {
      title: "정밀 감지를 준비하지 못했습니다",
      description:
        "페이지를 새로고침한 뒤 다시 확인해주세요. 문제가 계속되면 제보해주세요.",
      errorMessage: "정밀 감지 모델을 불러오지 못했습니다.",
    };
  }

  return {
    title: "정밀 감지를 준비하지 못했습니다",
    description:
      "다시 확인을 눌러 재시도해주세요. 문제가 계속되면 페이지를 새로고침해주세요.",
    errorMessage: "정밀 감지를 시작하지 못했습니다.",
  };
}

function isWebGpuRuntimeCompatibilityMessage(message: string): boolean {
  return (
    [
      "webgpu",
      "gpu adapter",
      "gpu device",
      "device lost",
      "context lost",
      "command buffer",
    ].some((marker) => message.includes(marker)) ||
    isWebGpuModelCompatibilityMessage(message)
  );
}

function isWebGpuModelCompatibilityMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    isShaderF16CompatibilityMessage(normalized) ||
    normalized.includes("subgroupminsize") ||
    normalized.includes("subgroupmaxsize") ||
    (normalized.includes("adapterinfo") && normalized.includes("undefined"))
  );
}

function isShaderF16CompatibilityMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("shader-f16") ||
    normalized.includes("requires f16") ||
    normalized.includes("feature unavailable: f16") ||
    normalized.includes("feature unavailable: shader-f16")
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error
    ? error
    : "precision-parser-runtime-error";
}
