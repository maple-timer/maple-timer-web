import {
  asRecord,
  firstString,
  formatPrecisionParserExecutionProvider,
} from "./sample";
import type { TroubleshooterMetric } from "./types";

export type SavedPrecisionParserFailure = {
  reason: string;
  stage: string | null;
  code: string | null;
  technicalMessage: string | null;
  executionProvider: string | null;
};

export function readSavedPrecisionParserFailure(
  parser: Record<string, unknown>,
): SavedPrecisionParserFailure | null {
  const failure = asRecord(parser.failure);
  const reason = firstString(failure.reason);
  if (!reason) {
    return null;
  }
  const diagnostic = asRecord(failure.diagnostic);
  const details = asRecord(diagnostic.details);
  const runtime = asRecord(parser.runtime);
  return {
    reason,
    stage: firstString(diagnostic.stage),
    code: firstString(diagnostic.code),
    technicalMessage: firstString(
      failure.technicalMessage,
      diagnostic.technicalMessage,
    ),
    executionProvider: firstString(
      runtime.executionProvider,
      details.executionProvider,
    ),
  };
}

export function getPrecisionParserFailureTitle(
  failure: SavedPrecisionParserFailure,
): string {
  if (failure.reason === "webgpu-unavailable") {
    return "그래픽 분석 장치를 준비하지 못함";
  }
  if (failure.reason === "model-load-failed") {
    return "정밀 감지 모델을 준비하지 못함";
  }
  if (failure.reason === "worker-failed") {
    return "정밀 감지 분석 작업을 시작하지 못함";
  }
  return "정밀 감지 분석 중 오류가 발생함";
}

export function getPrecisionParserFailureDetail(
  failure: SavedPrecisionParserFailure,
): string {
  const stage = formatPrecisionParserFailureStage(failure.stage);
  const code = failure.code ? ` (${failure.code})` : "";
  const technical = failure.technicalMessage
    ? ` 기술 오류: ${failure.technicalMessage}`
    : "";
  return `${stage} 단계에서 분석이 중단됐습니다${code}. 이 프레임은 parser가 0개를 검출한 결과가 아니라 parser 결과를 만들지 못한 경우입니다.${technical}`;
}

export function getPrecisionParserFailureMetrics(
  failure: SavedPrecisionParserFailure,
): TroubleshooterMetric[] {
  return [
    {
      id: "parser-failure-reason",
      label: "실패 분류",
      value: formatPrecisionParserFailureReason(failure.reason),
    },
    {
      id: "parser-failure-stage",
      label: "실패 단계",
      value: formatPrecisionParserFailureStage(failure.stage),
    },
    {
      id: "parser-failure-code",
      label: "오류 코드",
      value: failure.code ?? "미기록",
    },
    {
      id: "parser-failure-provider",
      label: "실행 방식",
      value: formatPrecisionParserExecutionProvider(
        failure.executionProvider,
      ),
    },
    {
      id: "parser-failure-message",
      label: "기술 오류",
      value: failure.technicalMessage ?? "미기록",
    },
  ];
}

export function formatPrecisionParserFailureStage(
  stage: string | null,
): string {
  const labels: Record<string, string> = {
    "analysis-worker": "분석 작업 시작",
    "webgpu-api": "브라우저 WebGPU 지원",
    "gpu-adapter": "그래픽 장치 연결",
    "gpu-device": "그래픽 연산 준비",
    "onnx-runtime": "정밀 감지 실행 엔진",
    "model-session": "정밀 감지 모델 준비",
    "first-inference": "실제 모델 분석",
  };
  return stage ? labels[stage] ?? stage : "실패 단계 미기록";
}

function formatPrecisionParserFailureReason(reason: string): string {
  const labels: Record<string, string> = {
    "webgpu-unavailable": "그래픽 분석 장치 사용 불가",
    "model-load-failed": "모델 준비 실패",
    "worker-failed": "분석 작업 실패",
    "runtime-failed": "모델 실행 실패",
  };
  return labels[reason] ?? reason;
}
