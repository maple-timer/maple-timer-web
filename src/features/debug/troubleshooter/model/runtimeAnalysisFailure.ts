import { asRecord, firstNumber, firstString } from "./sample";
import type { TroubleshooterMetric } from "./types";

export type SavedRuntimeAnalysisFailure = {
  stage: string;
  code: string;
  technicalMessage: string | null;
  occurredAt: number | null;
};

export function readSavedRuntimeAnalysisFailure(
  value: unknown,
): SavedRuntimeAnalysisFailure | null {
  const failure = asRecord(value);
  const stage = firstString(failure.stage);
  const code = firstString(failure.code);
  if (!stage || !code) {
    return null;
  }
  return {
    stage,
    code,
    technicalMessage: firstString(failure.technicalMessage),
    occurredAt: firstNumber(failure.occurredAt),
  };
}

export function getRuntimeAnalysisFailureTitle(
  failure: SavedRuntimeAnalysisFailure,
): string {
  if (failure.stage === "frame-capture") {
    return "분석할 화면을 준비하지 못함";
  }
  if (failure.stage === "recognizer") {
    return "저장된 인식기를 실행하지 못함";
  }
  return "감지 분석 중 오류가 발생함";
}

export function getRuntimeAnalysisFailureDetail(
  failure: SavedRuntimeAnalysisFailure,
): string {
  const message = failure.technicalMessage
    ? ` 기술 오류: ${failure.technicalMessage}`
    : "";
  return `${formatRuntimeAnalysisFailureStage(failure.stage)} 단계가 실패했습니다 (${failure.code}). 이 기록은 정상적으로 분석한 뒤 아무것도 찾지 못한 결과가 아닙니다.${message}`;
}

export function getRuntimeAnalysisFailureMetrics(
  failure: SavedRuntimeAnalysisFailure,
): TroubleshooterMetric[] {
  return [
    {
      id: "runtime-failure-stage",
      label: "실패 단계",
      value: formatRuntimeAnalysisFailureStage(failure.stage),
    },
    {
      id: "runtime-failure-code",
      label: "오류 코드",
      value: failure.code,
    },
    {
      id: "runtime-failure-message",
      label: "기술 오류",
      value: failure.technicalMessage ?? "미기록",
    },
  ];
}

export function formatRuntimeAnalysisFailureStage(stage: string): string {
  const labels: Record<string, string> = {
    "frame-capture": "화면 준비",
    recognizer: "인식기 실행",
    "feature-analysis": "기능 분석",
  };
  return labels[stage] ?? stage;
}
