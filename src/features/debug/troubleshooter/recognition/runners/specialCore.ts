import { formatScore } from "../../model/sample";
import { metric } from "../../model/shared";
import {
  buildRecognitionResult,
  recognitionStage,
  temporalLimit,
  temporalStage,
  type RecognitionContext,
} from "../helpers";
import { iconToDataUrl } from "../imageData";
import { formatSpecialCoreDecisionReason } from "../../specialCoreDecision";

export async function runSpecialCoreRecognition({
  imageData,
  startedAt,
  buffSlotInputMode,
}: RecognitionContext) {
  const { createSpecialCoreAlertEngine } = await import(
    "../../../../../platform/runtime-workers/special-core/specialCoreAlertWorkerClient"
  );
  const engine = createSpecialCoreAlertEngine();
  try {
    const response = await engine.process({
      imageData,
      sampledAt: Date.now(),
      buffSlotInputMode: buffSlotInputMode ?? undefined,
    });
    const best = response.detectedIcon ?? response.candidateIcons[0] ?? null;
    const matcherDecision = best?.match.decisionReason ?? "no-candidate";
    const matcherDecisionLabel = formatSpecialCoreDecisionReason(matcherDecision);
    const evidence = response.candidateIcons.slice(0, 6).map((candidate, index) => ({
      id: `current-special-core-${index}`,
      label: candidate.match.matched ? "특수 코어 일치" : `후보 ${index + 1}`,
      description: `1차 점수 ${formatScore(candidate.match.score)} · 형태 점수 ${formatScore(candidate.match.gateScore)} · ${formatSpecialCoreDecisionReason(candidate.match.decisionReason)}`,
      src: iconToDataUrl(candidate.icon),
    }));

    return buildRecognitionResult({
      tone: response.detectedCount > 0 ? "positive" : response.candidateIcons.length > 0 ? "warning" : "info",
      title:
        response.detectedCount > 0
          ? "현재 모델이 특수 코어를 인식함"
          : response.candidateIcons.length > 0
            ? `현재 모델 미일치: ${matcherDecisionLabel}`
            : "현재 모델은 비교할 버프 아이콘을 찾지 못함",
      detail: temporalLimit("연속 감지와 쿨타임 알림 확정"),
      startedAt,
      metrics: [
        metric("current-boxes", "버프칸", `${response.boxCount}개`),
        metric("current-input-mode", "parser 입력", buffSlotInputMode ?? "fullFrame"),
        metric("current-candidates", "비교 후보", `${response.candidateIcons.length}개`),
        metric("current-detected", "일치", `${response.detectedCount}개`),
        metric("current-decision", "matcher 판정", matcherDecisionLabel),
        metric("current-score", "1차 점수", formatScore(best?.match.score)),
        metric("current-threshold", "1차 기준", formatScore(best?.match.threshold)),
        metric("current-gate-score", "형태 점수", formatScore(best?.match.gateScore)),
        metric("current-gate-threshold", "형태 기준", formatScore(best?.match.gateThreshold)),
        metric("current-parser", "parser", response.parserVersion ?? "없음"),
        metric("current-bundle", "matcher 번들", best?.match.bundleId ?? "없음"),
        metric("current-model", "matcher 모델", best?.match.modelVersion ?? "없음"),
      ],
      stages: [
        recognitionStage(
          "parser",
          "버프칸 탐색",
          response.boxCount > 0,
          `${response.boxCount}개 칸`,
          "현재 parser를 원본 화면에 실행했습니다.",
        ),
        recognitionStage(
          "matcher",
          "특수 코어 판정",
          response.detectedCount > 0,
          matcherDecisionLabel,
          "현재 특수 코어 matcher의 1차 점수와 형태 검증 결과입니다.",
          response.candidateIcons.length > 0 ? "warning" : "blocked",
        ),
        temporalStage("confirmation", "활성화 확정", "연속 프레임 필요"),
      ],
      evidence,
    });
  } finally {
    engine.reset();
  }
}
