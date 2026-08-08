import type { PrecisionParserDiagnosticStage } from "../../../contracts/recognition/precisionParserDiagnostics";
import type { PrecisionParserFailureReason } from "../../../lib/buffSlotParser/precisionParserAvailability";
import type { PrecisionParserBrowserGuidance } from "../../../platform/browser-diagnostics/precisionParserBrowserGuidance";

export type PrecisionParserRecoveryStep = {
  label: string;
  description: string;
  address?: string;
};

export type PrecisionParserRecoveryGuidance = {
  causes: string[];
  steps: PrecisionParserRecoveryStep[];
};

export function getPrecisionParserRecoveryGuidance({
  browser,
  failedStage,
  failureReason,
  technicalMessage,
  isWindows,
}: {
  browser: PrecisionParserBrowserGuidance;
  failedStage: PrecisionParserDiagnosticStage | null;
  failureReason: PrecisionParserFailureReason;
  technicalMessage: string | null;
  isWindows: boolean;
}): PrecisionParserRecoveryGuidance {
  if (
    (failedStage === "gpu-device" || failedStage === "model-session") &&
    isShaderF16CompatibilityMessage(technicalMessage)
  ) {
    return {
      causes: [
        "현재 그래픽 환경에서 정밀 감지 모델에 필요한 연산을 사용할 수 없습니다.",
        "그래픽 카드, 드라이버, 브라우저 조합에 따라 지원되는 연산이 다를 수 있습니다.",
      ],
      steps: [
        {
          label: "CPU 속도를 확인하세요",
          description:
            "위의 CPU로 계속 사용을 눌러 이 기기에서 정밀 감지를 실행할 수 있는지 측정하세요.",
        },
        driverAndRestartStep(browser),
        retryStep(),
      ],
    };
  }

  if (failedStage === "analysis-worker") {
    return {
      causes: [
        "분석 작업 파일을 불러오지 못했거나 실행 중 응답이 중단됐을 수 있습니다.",
        "오래 열어둔 탭의 파일과 현재 사이트 버전이 달라졌을 수 있습니다.",
        "백그라운드 탭 또는 높은 시스템 사용량 때문에 준비가 지연됐을 수 있습니다.",
      ],
      steps: [
        {
          label: "이 페이지를 화면에 띄운 상태로 다시 확인을 누르세요",
          description: "백그라운드 탭에서는 브라우저가 분석 작업을 늦출 수 있습니다.",
        },
        {
          label: "페이지를 새로고침하세요",
          description: "현재 사이트 버전의 분석 파일을 다시 불러옵니다.",
        },
        {
          label: "브라우저를 완전히 다시 시작하세요",
          description: "계속 실패하면 무거운 탭을 닫고 브라우저의 모든 창을 종료한 뒤 다시 실행하세요.",
        },
      ],
    };
  }

  if (failedStage === "webgpu-api") {
    return {
      causes: [
        "브라우저가 오래됐거나 현재 환경에서 WebGPU 기능을 제공하지 않을 수 있습니다.",
        "그래픽 가속이 꺼져 있거나 브라우저 관리 정책으로 제한됐을 수 있습니다.",
        "보안 연결이 아닌 페이지에서는 WebGPU 기능이 숨겨질 수 있습니다.",
      ],
      steps: [
        browserUpdateStep(browser),
        browserAccelerationStep(browser),
        browserRestartStep(browser),
        retryStep(),
      ],
    };
  }

  if (failedStage === "gpu-adapter") {
    return {
      causes: [
        "그래픽 가속 설정을 바꾼 뒤 브라우저가 완전히 다시 시작되지 않았을 수 있습니다.",
        "그래픽 드라이버가 오래됐거나 GPU가 브라우저 차단 목록, 관리 정책, 실행 옵션의 영향을 받았을 수 있습니다.",
        "GPU 프로세스가 중단됐거나 원격·가상·관리 환경에서 그래픽 장치 접근이 제한됐을 수 있습니다.",
      ],
      steps: compact([
        browserAccelerationStep(browser),
        browserRestartStep(browser),
        driverAndRestartStep(browser),
        isWindows ? windowsGpuPreferenceStep(browser) : null,
        browserGpuStatusStep(browser),
        retryStep(),
      ]),
    };
  }

  if (failedStage === "gpu-device") {
    return {
      causes: [
        "그래픽 장치는 찾았지만 브라우저가 정밀 감지용 연산 장치를 만들지 못했습니다.",
        "GPU 프로세스가 재시작됐거나 다른 프로그램이 그래픽 메모리를 많이 사용 중일 수 있습니다.",
        "그래픽 드라이버 또는 브라우저와 GPU의 호환 문제가 있을 수 있습니다.",
      ],
      steps: compact([
        {
          label: "GPU를 많이 사용하는 프로그램과 탭을 닫으세요",
          description: "게임 외의 영상, 3D, AI 작업을 닫은 뒤 다시 시도하세요.",
        },
        driverAndRestartStep(browser),
        isWindows ? windowsGpuPreferenceStep(browser) : null,
        browserGpuStatusStep(browser),
        retryStep(),
      ]),
    };
  }

  if (failedStage === "onnx-runtime") {
    return {
      causes: [
        "정밀 감지 실행 파일을 네트워크나 브라우저 캐시에서 불러오지 못했을 수 있습니다.",
        "오래 열어둔 탭이 이전 사이트 버전의 파일을 요청했을 수 있습니다.",
        "브라우저의 메모리 부족이나 일시적인 실행 오류가 발생했을 수 있습니다.",
      ],
      steps: runtimeRecoverySteps(browser),
    };
  }

  if (failedStage === "model-session") {
    const compatibilityFailure = isWebGpuBrowserCompatibilityMessage(
      technicalMessage,
    );
    return {
      causes: compatibilityFailure
        ? [
            "현재 브라우저가 정밀 감지 엔진에 필요한 그래픽 정보를 제공하지 않을 수 있습니다.",
            "브라우저와 그래픽 드라이버의 버전 조합이 맞지 않을 수 있습니다.",
            "브라우저가 업데이트됐지만 완전히 다시 시작되지 않았을 수 있습니다.",
          ]
        : [
            "정밀 감지 모델 파일을 내려받지 못했거나 캐시된 파일 버전이 맞지 않을 수 있습니다.",
            "그래픽 장치는 준비됐지만 모델에 필요한 연산을 지원하지 않을 수 있습니다.",
            "브라우저 또는 그래픽 메모리가 부족해 모델 준비가 중단됐을 수 있습니다.",
          ],
      steps: compatibilityFailure
        ? [
            browserUpdateStep(browser),
            driverAndRestartStep(browser),
            retryStep(),
          ]
        : runtimeRecoverySteps(browser),
    };
  }

  if (failedStage === "first-inference") {
    return {
      causes: [
        "모델 준비 후 첫 분석 중 그래픽 장치가 초기화되거나 연결을 잃었을 수 있습니다.",
        "다른 프로그램이 그래픽 메모리를 많이 사용해 분석에 필요한 공간이 부족했을 수 있습니다.",
        "특정 GPU·드라이버 조합에서 실제 연산 오류가 발생했을 수 있습니다.",
      ],
      steps: [
        {
          label: "GPU를 많이 사용하는 프로그램과 탭을 닫으세요",
          description: "게임 외의 영상, 3D, AI 작업을 닫아 그래픽 메모리를 확보하세요.",
        },
        driverAndRestartStep(browser),
        retryStep(),
      ],
    };
  }

  return {
    causes: [
      failureReason === "model-load-failed"
        ? "정밀 감지 파일을 불러오지 못했거나 캐시된 파일 버전이 맞지 않을 수 있습니다."
        : "브라우저의 분석 작업이 일시적으로 중단됐을 수 있습니다.",
    ],
    steps: runtimeRecoverySteps(browser),
  };
}

function browserUpdateStep(
  browser: PrecisionParserBrowserGuidance,
): PrecisionParserRecoveryStep {
  return {
    label: `${browser.label} 최신 버전을 설치하세요`,
    description: "브라우저 메뉴의 정보 또는 업데이트 화면에서 최신 버전인지 확인하세요.",
  };
}

function browserAccelerationStep(
  browser: PrecisionParserBrowserGuidance,
): PrecisionParserRecoveryStep {
  return {
    label: `${browser.label}에서 그래픽 가속을 켜세요`,
    description: `주소창에 ${browser.settingsUrl}을 입력하고 ‘가능한 경우 그래픽 가속 사용’을 켜세요.`,
  };
}

function browserRestartStep(
  browser: PrecisionParserBrowserGuidance,
): PrecisionParserRecoveryStep {
  return {
    label: "브라우저를 완전히 다시 시작하세요",
    description: `모든 ${browser.label} 창을 닫고 백그라운드 프로세스까지 종료해야 변경한 설정이 적용됩니다.`,
  };
}

function driverAndRestartStep(
  browser: PrecisionParserBrowserGuidance,
): PrecisionParserRecoveryStep {
  return {
    label: "브라우저와 그래픽 드라이버를 업데이트하세요",
    description: `${browser.label}와 그래픽 카드 드라이버를 업데이트하고 PC를 다시 시작하세요.`,
  };
}

function windowsGpuPreferenceStep(
  browser: PrecisionParserBrowserGuidance,
): PrecisionParserRecoveryStep {
  return {
    label: "GPU가 두 개라면 브라우저를 고성능 GPU로 지정하세요 (선택)",
    description: `Windows 설정 > 시스템 > 디스플레이 > 그래픽에서 ${browser.label} 앱을 고성능으로 지정하세요. ‘하드웨어 가속 GPU 일정 예약’은 WebGPU의 필수 설정이 아니므로 변경하지 않아도 됩니다.`,
  };
}

function browserGpuStatusStep(
  browser: PrecisionParserBrowserGuidance,
): PrecisionParserRecoveryStep {
  return {
    label: `${browser.label}의 WebGPU 상태를 확인하세요`,
    description:
      "Graphics Feature Status의 WebGPU와 Problems Detected 또는 Log Messages의 차단·GPU 프로세스 오류를 함께 확인하세요. 차단 안내가 있으면 강제로 우회하지 말고 백업 사이트를 이용하세요.",
    address: browser.gpuStatusUrl,
  };
}

function retryStep(): PrecisionParserRecoveryStep {
  return {
    label: "이 페이지에서 다시 확인을 누르세요",
    description: "정밀 감지 준비를 처음부터 다시 확인합니다.",
  };
}

function runtimeRecoverySteps(
  browser: PrecisionParserBrowserGuidance,
): PrecisionParserRecoveryStep[] {
  return [
    {
      label: "페이지를 새로고침하세요",
      description: "현재 사이트 버전의 정밀 감지 파일을 다시 불러옵니다.",
    },
    {
      label: "안정적인 연결에서 다시 확인하세요",
      description: "모델 파일을 내려받는 동안 네트워크가 끊기지 않도록 확인하세요.",
    },
    {
      label: "브라우저를 완전히 다시 시작하세요",
      description: "계속 실패하면 무거운 탭을 닫고 브라우저를 다시 실행하세요.",
    },
    retryStep(),
  ];
}

function isWebGpuBrowserCompatibilityMessage(
  technicalMessage: string | null,
): boolean {
  const message = technicalMessage?.toLowerCase() ?? "";
  return (
    message.includes("subgroupminsize") ||
    message.includes("subgroupmaxsize") ||
    (message.includes("adapterinfo") && message.includes("undefined"))
  );
}

function isShaderF16CompatibilityMessage(
  technicalMessage: string | null,
): boolean {
  const message = technicalMessage?.toLowerCase() ?? "";
  return (
    message.includes("shader-f16") ||
    message.includes("requires f16") ||
    message.includes("feature unavailable: f16")
  );
}

function compact<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null);
}
