import { formatMilliseconds } from "../../model/sample";
import { metric } from "../../model/shared";
import {
  buildRecognitionResult,
  recognitionStage,
  temporalLimit,
  temporalStage,
  type RecognitionContext,
} from "../helpers";

export async function runBoosterRecognition({ imageData, startedAt }: RecognitionContext) {
  const { createBoosterExpiryWorkerClient } = await import(
    "../../../../../platform/runtime-workers/booster-expiry/boosterExpiryWorkerClient"
  );
  const client = createBoosterExpiryWorkerClient();
  try {
    const response = await client.process(imageData, Date.now());
    const reading = response.result.time ?? response.result.rawTime;
    return buildRecognitionResult({
      tone: reading?.ok ? "positive" : "warning",
      title: reading?.ok
        ? `현재 부스터 시간 인식값 ${reading.text ?? `${reading.seconds}초`}`
        : "현재 화면에서 부스터 시간을 읽지 못함",
      detail: temporalLimit("자연스러운 감소 흐름과 종료 시각 확정"),
      startedAt,
      metrics: [
        metric("current-value", "판독값", reading?.text ?? "없음"),
        metric(
          "current-seconds",
          "남은 시간",
          reading?.seconds === null || reading?.seconds === undefined
            ? "없음"
            : `${reading.seconds}초`,
        ),
        metric("current-rects", "타이머 후보", `${response.result.timeRect.candidateCount}개`),
        metric("current-selection", "선택 근거", reading?.selectedBy ?? "없음"),
        metric("current-recognizer", "인식기", response.result.recognizerVersion ?? "없음"),
        metric(
          "current-processing",
          "처리 시간",
          formatMilliseconds(response.performance.totalMs),
        ),
      ],
      stages: [
        recognitionStage(
          "detection",
          "타이머 영역 탐색",
          response.result.timeRect.ok,
          response.result.timeRect.ok ? "영역 찾음" : "영역 없음",
          response.result.timeRect.reason,
          response.result.timeRect.candidateCount > 0 ? "warning" : "blocked",
        ),
        recognitionStage(
          "recognition",
          "시간 판독",
          Boolean(reading?.ok),
          reading?.text ?? "판독 없음",
          reading?.reason ?? "현재 부스터 타이머 판독 결과입니다.",
          response.result.timeRect.ok ? "warning" : "pending",
        ),
        temporalStage("tracking", "감소 흐름 확인", "여러 프레임 필요"),
      ],
      evidence: [],
    });
  } finally {
    client.reset();
  }
}
