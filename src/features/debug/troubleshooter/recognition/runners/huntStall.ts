import {
  formatConfidence,
  formatMilliseconds,
} from "../../model/sample";
import { metric } from "../../model/shared";
import {
  buildRecognitionResult,
  getFeatureConfig,
  recognitionStage,
  temporalLimit,
  temporalStage,
  type RecognitionContext,
} from "../helpers";
import { imageDataToDataUrl } from "../imageData";

export async function runHuntStallRecognition(context: RecognitionContext) {
  const mode = String(
    getFeatureConfig(context.view, "huntStall").mode ?? "manual-experience",
  );
  return mode === "cooldown-presence"
    ? runCooldownRecognition(context)
    : runExperienceRecognition(context);
}

async function runExperienceRecognition({ imageData, startedAt }: RecognitionContext) {
  const [{ readHuntStallReadingFromImageData }, { HUNT_STALL_EXPERIENCE_RECOGNIZER_VERSION }] =
    await Promise.all([
      import(
        "../../../../../recognition/hunt-stall/experience/huntStallExperienceRecognition"
      ),
      import("../../../../../lib/recognizerVersions"),
    ]);
  const { processedImageData, reading } = readHuntStallReadingFromImageData(imageData);
  return buildRecognitionResult({
    tone: reading.recognizedText ? "positive" : "warning",
    title: reading.recognizedText
      ? `현재 경험치 인식값 ${reading.recognizedText}`
      : "현재 OCR이 경험치 값을 읽지 못함",
    detail: temporalLimit("경험치 변화와 사냥 정지 확정"),
    startedAt,
    metrics: [
      metric("current-value", "인식값", reading.recognizedText ?? "없음"),
      metric("current-confidence", "신뢰도", formatConfidence(reading.confidence)),
      metric("current-debug", "원시 판독", reading.debugText || "없음"),
      metric("current-foreground", "전경 비율", formatConfidence(reading.foregroundRatio)),
      metric("current-recognizer", "인식기", HUNT_STALL_EXPERIENCE_RECOGNIZER_VERSION),
    ],
    stages: [
      recognitionStage(
        "preprocess",
        "경험치 영역 전처리",
        true,
        `${processedImageData.width}x${processedImageData.height}`,
        "현재 경험치 전처리를 실행했습니다.",
      ),
      recognitionStage(
        "ocr",
        "경험치 숫자 판독",
        Boolean(reading.recognizedText),
        reading.recognizedText ?? "판독 없음",
        "현재 경험치 OCR 결과입니다.",
        "warning",
      ),
      temporalStage("tracking", "변화 흐름 확인", "여러 프레임 필요"),
    ],
    evidence: [
      {
        id: "current-hunt-processed",
        label: "현재 전처리 결과",
        description: "최신 경험치 OCR 전처리를 적용한 화면입니다.",
        src: imageDataToDataUrl(processedImageData),
      },
    ],
  });
}

async function runCooldownRecognition({ imageData, startedAt }: RecognitionContext) {
  const [{ createHuntStallCooldownWorkerClient }, { COOLDOWN_DIGIT_RECOGNIZER_VERSION }] =
    await Promise.all([
      import(
        "../../../../../platform/runtime-workers/hunt-stall-cooldown/huntStallCooldownWorkerClient"
      ),
      import("../../../../../contracts/recognition/cooldownDigitRecognition"),
    ]);
  const client = createHuntStallCooldownWorkerClient();
  try {
    const response = await client.process(imageData);
    return buildRecognitionResult({
      tone: response.result.value !== null ? "positive" : "info",
      title:
        response.result.value !== null
          ? `현재 쿨타임 인식값 ${response.result.value}초`
          : "현재 화면에서 쿨타임 숫자를 읽지 못함",
      detail: temporalLimit("아이콘 변화와 사냥 정지 확정"),
      startedAt,
      metrics: [
        metric(
          "current-value",
          "판독값",
          response.result.value === null ? "없음" : `${response.result.value}초`,
        ),
        metric("current-confidence", "신뢰도", formatConfidence(response.result.confidence)),
        metric("current-recognizer", "인식기", COOLDOWN_DIGIT_RECOGNIZER_VERSION),
        metric(
          "current-foreground",
          "전경 비율",
          formatConfidence(response.activity.foregroundRatio),
        ),
        metric(
          "current-processing",
          "처리 시간",
          formatMilliseconds(response.performance.totalMs),
        ),
      ],
      stages: [
        recognitionStage(
          "recognition",
          "쿨타임 숫자 판독",
          response.result.value !== null,
          response.result.value === null ? "판독 없음" : `${response.result.value}초`,
          "현재 쿨타임 인식 결과입니다.",
          "warning",
        ),
        temporalStage("tracking", "아이콘 변화 확인", "여러 프레임 필요"),
      ],
      evidence: [],
    });
  } finally {
    client.reset();
  }
}
