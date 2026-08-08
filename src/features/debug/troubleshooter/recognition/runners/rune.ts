import { formatConfidence } from "../../model/sample";
import { metric } from "../../model/shared";
import {
  createRuneRuntimeState,
  updateRuneRuntimeState,
} from "../../../../../lib/runeAlert";
import { RUNE_CONFIRMATION_POLICY } from "../../../../../lib/runeAlertPolicy";
import type { RuneDetectionResult } from "../../../../../recognition/rune/runeDetectionTypes";
import {
  getRuneDetectionEvidenceCandidate,
  isRuneOnnxDetectionResult,
} from "../../../../../recognition/rune/runeOnnxContract";
import {
  buildRecognitionResult,
  recognitionStage,
  type RecognitionContext,
} from "../helpers";

export async function runRuneRecognition(context: RecognitionContext) {
  const { imageData, startedAt, sequenceFrames, sequenceKind } = context;
  const { createRuneDetectionWorkerClient } = await import(
    "../../../../../platform/runtime-workers/rune/runeDetectionWorkerClient"
  );
  const client = createRuneDetectionWorkerClient();
  try {
    if (sequenceFrames && sequenceFrames.length > 1) {
      return await runRuneSequenceRecognition({
        client,
        frames: sequenceFrames,
        startedAt,
        sequenceKind: sequenceKind ?? "alert-trigger",
      });
    }
    const response = await client.detect(imageData);
    const best = getRuneDetectionEvidenceCandidate(response);
    const isOnnx = isRuneOnnxDetectionResult(response);
    const proposalCount = response.debug.proposalCount ?? response.candidates.length;
    return buildRecognitionResult({
      tone: response.detected ? "positive" : "info",
      title: response.detected
        ? "현재 모델이 룬을 인식함"
        : "현재 모델은 룬을 인식하지 않음",
      detail: "저장 당시 알림 결과와 분리된 현재 모델의 단일 이미지 판정입니다.",
      startedAt,
      metrics: [
        metric("current-detected", "감지", response.detected ? "예" : "아니오"),
        metric(
          "current-model",
          "현재 모델",
          response.debug.classifier ?? "기록 없음",
          response.debug.classifier,
        ),
        metric(
          "current-confidence",
          isOnnx ? "최종 판정 점수" : "신뢰도",
          formatConfidence(response.debug.modelScore ?? response.confidence),
        ),
        metric("current-candidates", "검토 후보", `${proposalCount}개`),
        ...(isOnnx
          ? [
              metric(
                "current-proposal-rank",
                "선택 후보",
                response.debug.selectedProposalRank
                  ? `${response.debug.selectedProposalRank}순위`
                  : "없음",
              ),
              metric(
                "current-shape",
                "형태",
                `${formatConfidence(response.debug.shapeScore)} / ${formatConfidence(response.debug.shapeThreshold)}`,
              ),
              metric(
                "current-appearance",
                "색감·외형",
                `${formatConfidence(response.debug.appearanceScore)} / ${formatConfidence(response.debug.appearanceThreshold)}`,
              ),
            ]
          : [metric("current-cnn", "최고 CNN 점수", formatConfidence(best?.cnnScore))]),
        metric("current-reason", "판정 사유", response.debug.reason ?? "없음"),
      ],
      stages: isOnnx
        ? [
            recognitionStage(
              "proposal",
              "후보 위치 탐색",
              proposalCount > 0,
              `${proposalCount}개 후보`,
              "미니맵 전체에서 가능성이 높은 위치를 최대 5개까지 찾았습니다. 이 단계의 후보만으로는 룬으로 확정하지 않습니다.",
            ),
            recognitionStage(
              "shape-gate",
              "반듯한 마름모 형태 확인",
              response.debug.shapePass === true,
              response.debug.shapePass ? "형태 통과" : "형태 탈락",
              `형태 점수 ${formatConfidence(response.debug.shapeScore)} · 기준 ${formatConfidence(response.debug.shapeThreshold)}`,
              "warning",
            ),
            recognitionStage(
              "appearance-gate",
              "룬 색감·외형 확인",
              response.debug.appearancePass === true,
              response.debug.appearancePass ? "외형 통과" : "외형 탈락",
              `색감·외형 점수 ${formatConfidence(response.debug.appearanceScore)} · 기준 ${formatConfidence(response.debug.appearanceThreshold)}`,
              "warning",
            ),
            recognitionStage(
              "final-gate",
              "두 조건 결합",
              response.detected,
              response.detected ? "단일 프레임 룬 판정" : "룬 아님",
              "같은 후보가 형태와 색감·외형 조건을 모두 통과해야 다음 연속 감지 확인으로 넘어갑니다.",
              "warning",
            ),
          ]
        : [
            recognitionStage(
              "proposal",
              "보라색 후보 탐색",
              proposalCount > 0,
              `${proposalCount}개 후보`,
              "현재 후보 생성기를 원본 미니맵에 실행했습니다.",
              "warning",
            ),
            recognitionStage(
              "classifier",
              "룬 형태 판정",
              response.detected,
              response.detected ? "룬 확정" : "룬 없음",
              "현재 CNN과 형태 검증 결과입니다.",
              response.candidates.length > 0 ? "warning" : "complete",
            ),
          ],
      evidence: [],
    });
  } finally {
    client.reset();
  }
}

async function runRuneSequenceRecognition({
  client,
  frames,
  startedAt,
  sequenceKind,
}: {
  client: { detect: (imageData: ImageData) => Promise<RuneDetectionResult> };
  frames: NonNullable<RecognitionContext["sequenceFrames"]>;
  startedAt: number;
  sequenceKind: "alert-trigger" | "runtime-incident";
}) {
  let state = createRuneRuntimeState();
  let shouldAlert = false;
  const results: Array<{
    frame: (typeof frames)[number];
    detection: RuneDetectionResult;
    stableCount: number;
    stableDurationMs: number;
    shouldAlert: boolean;
  }> = [];

  for (const frame of frames) {
    const detection = await client.detect(frame.imageData);
    const update = updateRuneRuntimeState({
      previous: state,
      detection,
      now: frame.sampledAt,
      enabled: true,
      hasStream: true,
      hasRegion: true,
    });
    state = update.state;
    shouldAlert ||= update.shouldAlert;
    const recentSamples = state.recentSamples ?? [];
    const trace = recentSamples[recentSamples.length - 1];
    results.push({
      frame,
      detection,
      stableCount: state.stableCount,
      stableDurationMs: trace?.stableDurationMs ?? 0,
      shouldAlert: update.shouldAlert,
    });
  }

  const last = results[results.length - 1];
  const detectedCount = results.filter((item) => item.detection.detected).length;
  const scores = results
    .map((item) => item.detection.debug.modelScore ?? item.detection.confidence)
    .filter((value): value is number => Number.isFinite(value));
  const minimumScore = scores.length > 0 ? Math.min(...scores) : null;
  const maximumScore = scores.length > 0 ? Math.max(...scores) : null;
  const threshold = last.detection.debug.modelThreshold;
  const shapeScores = results
    .map((item) => item.detection.debug.shapeScore)
    .filter((value): value is number => Number.isFinite(value));
  const appearanceScores = results
    .map((item) => item.detection.debug.appearanceScore)
    .filter((value): value is number => Number.isFinite(value));
  const shapePassCount = results.filter(
    (item) => item.detection.debug.shapePass === true,
  ).length;
  const appearancePassCount = results.filter(
    (item) => item.detection.debug.appearancePass === true,
  ).length;
  const isRuntimeIncident = sequenceKind === "runtime-incident";

  return buildRecognitionResult({
    tone: shouldAlert ? "positive" : "warning",
    title: shouldAlert
      ? isRuntimeIncident
        ? "현재 모델은 저장된 런타임 흐름을 알림으로 확정함"
        : "현재 모델도 저장된 알림 흐름을 확정함"
      : "현재 모델은 저장된 흐름을 알림으로 확정하지 않음",
    detail: `${
      isRuntimeIncident ? "실제 감지 루프에서 저장한" : "알림 확정에 참여한"
    } ${frames.length}개 원본을 현재 모델과 룬 확정 로직에 순서대로 다시 넣은 결과입니다. 오디오 재생은 다시 실행하지 않습니다.`,
    startedAt,
    metrics: [
      metric("current-model", "현재 모델", last.detection.debug.classifier ?? "기록 없음"),
      metric("sequence-frames", "분석 프레임", `${frames.length}개`),
      metric("sequence-detected", "모델 감지", `${detectedCount}/${frames.length}개`),
      metric(
        "sequence-score-range",
        "최종 점수 범위",
        `${formatConfidence(minimumScore)} ~ ${formatConfidence(maximumScore)}`,
      ),
      metric(
        "sequence-shape-range",
        "형태 점수 범위",
        `${formatConfidence(minimum(shapeScores))} ~ ${formatConfidence(maximum(shapeScores))}`,
      ),
      metric(
        "sequence-appearance-range",
        "외형 점수 범위",
        `${formatConfidence(minimum(appearanceScores))} ~ ${formatConfidence(maximum(appearanceScores))}`,
      ),
      metric("current-threshold", "최종 판정 기준", formatConfidence(threshold)),
      metric("sequence-stable", "최종 연속 감지", `${last.stableCount}회`),
      metric("sequence-duration", "최종 유지 시간", `${last.stableDurationMs}ms`),
      metric("sequence-alert", "알림 확정", shouldAlert ? "예" : "아니오"),
    ],
    stages: [
      recognitionStage(
        "sequence-input",
        isRuntimeIncident ? "런타임 프레임 입력" : "알림 확정 프레임 입력",
        frames.length > 0,
        `${frames.length}개 원본`,
        isRuntimeIncident
          ? "제보 버튼 시점 화면이 아니라 실제 감지 루프가 사용한 프레임을 시간순으로 사용했습니다."
          : "제보 시점 화면이 아니라 실제 알림 확정에 참여한 프레임을 시간순으로 사용했습니다.",
        "warning",
      ),
      recognitionStage(
        "sequence-proposal",
        "프레임별 후보 탐색",
        results.every((item) => (item.detection.debug.proposalCount ?? 0) > 0),
        `${frames.length}개 프레임 분석`,
        "각 프레임에서 최대 5개 후보를 독립적으로 찾았습니다.",
        "warning",
      ),
      recognitionStage(
        "sequence-shape",
        "프레임별 형태 확인",
        shapePassCount === frames.length,
        `${shapePassCount}/${frames.length}개 통과`,
        `반듯한 마름모 형태를 독립 게이트로 확인했습니다. 점수 범위 ${formatConfidence(minimum(shapeScores))} ~ ${formatConfidence(maximum(shapeScores))}.`,
        "warning",
      ),
      recognitionStage(
        "sequence-appearance",
        "프레임별 색감·외형 확인",
        appearancePassCount === frames.length,
        `${appearancePassCount}/${frames.length}개 통과`,
        `룬 색감과 외형을 형태와 별도인 게이트로 확인했습니다. 점수 범위 ${formatConfidence(minimum(appearanceScores))} ~ ${formatConfidence(maximum(appearanceScores))}.`,
        "warning",
      ),
      recognitionStage(
        "sequence-final-gate",
        "프레임별 두 조건 결합",
        detectedCount === frames.length,
        `${detectedCount}/${frames.length}개 룬 판정`,
        "같은 후보가 두 게이트를 모두 통과한 프레임만 연속 감지 확인에 사용했습니다.",
        "warning",
      ),
      recognitionStage(
        "sequence-confirmation",
        "현재 확정 로직 재현",
        shouldAlert,
        shouldAlert ? "알림 조건 충족" : "알림 조건 미달",
        `${RUNE_CONFIRMATION_POLICY.requiredStableFrames}회 그리고 ${RUNE_CONFIRMATION_POLICY.requiredStableMilliseconds}ms 조건과 후보 위치 연속성을 적용했습니다.`,
        "warning",
      ),
    ],
    evidence: results.map((item, index) => ({
      id: `current-rune-trigger-${index + 1}`,
      label: `${item.frame.label} · ${item.detection.detected ? "감지" : "미감지"}`,
      description: `형태 ${formatConfidence(item.detection.debug.shapeScore)} · 외형 ${formatConfidence(item.detection.debug.appearanceScore)} · 연속 ${item.stableCount}회`,
      src: item.frame.src,
    })),
  });
}

function minimum(values: number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function maximum(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}
