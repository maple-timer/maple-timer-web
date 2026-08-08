import {
  formatConfidence,
  formatScore,
} from "../../model/sample";
import { BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION } from "../../../../../recognition/skill-precision/remaining-count/bottomRightRemainingCountContract";
import { metric } from "../../model/shared";
import {
  buildRecognitionResult,
  getFeatureConfig,
  isBuffDurationSkill,
  recognitionStage,
  temporalLimit,
  temporalStage,
  type RecognitionContext,
} from "../helpers";
import { iconToDataUrl, imageDataToDataUrl } from "../imageData";

export async function runSkillRecognition(context: RecognitionContext) {
  return isBuffDurationSkill(context.view)
    ? runSkillBuffDurationRecognition(context)
    : runSkillQuickslotRecognition(context);
}

async function runSkillBuffDurationRecognition({
  view,
  imageData,
  startedAt,
  buffSlotInputMode,
}: RecognitionContext) {
  const [{ createSkillBuffDurationEngine }, { getSkillBuffDurationTargetForPresetId }] =
    await Promise.all([
      import("../../../../../platform/runtime-workers/skill-precision/skillPrecisionWorkerClient"),
      import("../../../../../lib/skillBuffDuration/skillBuffDurationTargets"),
    ]);
  const config = getFeatureConfig(view, "skill");
  const target = getSkillBuffDurationTargetForPresetId(config.presetId);
  if (!target) {
    throw new Error("이 정밀 스킬 preset에 연결된 최신 matcher가 없습니다.");
  }

  const engine = createSkillBuffDurationEngine();
  try {
    const response = await engine.process({
      imageData,
      sampledAt: Date.now(),
      buffSlotInputMode: buffSlotInputMode ?? undefined,
      targets: [
        {
          skillId: target.skillId,
          detectorId: target.detectorId,
          matcherEngine: target.matcherEngine,
          matcherSkillId: target.matcherSkillId,
          maxBuffRowIndex: target.maxBuffRowIndex,
          valueKind: target.valueKind ?? "countdown",
        },
      ],
    });
    const detection = response.detectionsBySkillId?.[target.skillId] ?? null;
    const detectedIcon = detection?.detectedIcon ?? response.detectedIcon;
    const candidates = detection?.candidateIcons ?? response.candidateIcons;
    const matcherEvidence = detectedIcon?.match ?? candidates[0]?.match ?? null;
    const matcherDecision = matcherEvidence?.decisionReason ?? "no-candidate";
    const matcherDecisionLabel = formatSkillMatcherDecision(matcherDecision);
    const value =
      target.valueKind === "remaining-count"
        ? detectedIcon?.remainingCount?.count ?? null
        : detectedIcon?.countdown?.totalSeconds ?? null;
    const confidence =
      target.valueKind === "remaining-count"
        ? detectedIcon?.remainingCount?.confidence ?? null
        : detectedIcon?.countdown?.confidence ?? null;
    const evidence = candidates.slice(0, 6).map((candidate, index) => ({
      id: `current-skill-${index}`,
      label: candidate.match.displayName ?? `스킬 후보 ${index + 1}`,
      description: `1차 점수 ${formatScore(candidate.match.score)} · ${formatSkillMatcherDecision(candidate.match.decisionReason)}`,
      src: iconToDataUrl(candidate.icon),
    }));
    const valueLabel = target.valueKind === "remaining-count" ? "남은 횟수" : "남은 시간";

    return buildRecognitionResult({
      tone: detectedIcon && value !== null ? "positive" : "warning",
      title:
        detectedIcon && value !== null
          ? `현재 모델이 ${target.shortName}과 ${valueLabel}을 인식함`
          : detectedIcon
            ? `현재 모델은 ${target.shortName}을 찾았지만 ${valueLabel}을 읽지 못함`
            : getSkillMatcherMissTitle(target.shortName, matcherDecision),
      detail: temporalLimit("스킬 종료 시각과 알림 확정"),
      startedAt,
      metrics: [
        metric("current-target", "대상", target.displayName),
        metric("current-input-mode", "parser 입력", buffSlotInputMode ?? "fullFrame"),
        metric("current-boxes", "버프칸", `${response.boxCount}개`),
        metric("current-candidates", "비교 후보", `${candidates.length}개`),
        metric("current-decision", "matcher 판정", matcherDecisionLabel),
        metric("current-base-skill", "1차 대상", matcherEvidence?.baseSkillId ?? "없음"),
        metric("current-score", "1차 점수", formatScore(matcherEvidence?.score)),
        metric("current-threshold", "1차 기준", formatScore(matcherEvidence?.threshold)),
        metric("current-margin", "1차 여유", formatScore(matcherEvidence?.margin)),
        metric("current-gate-score", "형태 점수", formatScore(matcherEvidence?.gateScore)),
        metric("current-gate-threshold", "형태 기준", formatScore(matcherEvidence?.gateThreshold)),
        metric("current-gate-margin", "형태 여유", formatScore(matcherEvidence?.gateMargin)),
        metric("current-value", valueLabel, value === null ? "없음" : String(value)),
        metric("current-confidence", "판독 신뢰도", formatConfidence(confidence)),
        ...(target.valueKind === "remaining-count"
          ? [
              metric(
                "current-recognizer",
                "횟수 인식기",
                BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION,
              ),
            ]
          : []),
        metric("current-parser", "parser", response.parserVersion ?? "없음"),
        metric("current-engine", "matcher 방식", matcherEvidence?.matcherEngine ?? "없음"),
        metric("current-bundle", "matcher 번들", matcherEvidence?.bundleId ?? "없음"),
        metric("current-model", "matcher", matcherEvidence?.modelVersion ?? "없음"),
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
          `${target.shortName} 판정`,
          Boolean(detectedIcon),
          detectedIcon ? "대상 일치" : matcherDecisionLabel,
          `현재 스킬 matcher 결과입니다. ${matcherDecisionLabel}.`,
          candidates.length > 0 ? "warning" : "blocked",
        ),
        recognitionStage(
          "reader",
          `${valueLabel} 판독`,
          value !== null,
          value === null ? "판독 없음" : String(value),
          `현재 ${valueLabel} 인식 결과입니다.`,
          detectedIcon ? "warning" : "pending",
        ),
        temporalStage("tracking", "종료 시각 추적", "여러 프레임 필요"),
      ],
      evidence,
    });
  } finally {
    engine.reset();
  }
}

function getSkillMatcherMissTitle(shortName: string, decisionReason: string): string {
  if (decisionReason === "positive_gate_below_threshold") {
    return `현재 모델의 ${shortName} 아이콘 형태 검증이 기준에 미달함`;
  }
  if (decisionReason === "base_target_disabled") {
    return `현재 모델이 ${shortName} 대신 다른 스킬을 우선 판정함`;
  }
  if (decisionReason === "cross_bundle_conflict") {
    return `현재 모델 간 판정이 충돌해 ${shortName}을 확정하지 않음`;
  }
  return `현재 모델이 ${shortName}을 찾지 못함`;
}

function formatSkillMatcherDecision(value: string): string {
  const labels: Record<string, string> = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 기준 미달",
    base_target_disabled: "비활성 대상 우선 판정",
    positive_gate_below_threshold: "아이콘 형태 검증 기준 미달",
    cross_bundle_conflict: "모델 간 판정 충돌",
    other_skill_target: "다른 대상 판정",
    "no-candidate": "비교 후보 없음",
  };
  return labels[value] ?? value;
}

async function runSkillQuickslotRecognition({ imageData, startedAt }: RecognitionContext) {
  const [
    { preprocessCooldownImageData, recognizeCooldownDigits },
    { COOLDOWN_DIGIT_RECOGNIZER_VERSION },
  ] = await Promise.all([
    import("../../../../../recognition/cooldown-digit/recognizeCooldownDigits"),
    import("../../../../../contracts/recognition/cooldownDigitRecognition"),
  ]);
  const processed = preprocessCooldownImageData(imageData);
  const reading = recognizeCooldownDigits(processed);
  return buildRecognitionResult({
    tone: reading.value !== null ? "positive" : "warning",
    title:
      reading.value !== null
        ? `현재 인식값 ${reading.value}초`
        : "현재 모델이 퀵슬롯 숫자를 읽지 못함",
    detail: temporalLimit("스킬 종료 시각과 알림 확정"),
    startedAt,
    metrics: [
      metric(
        "current-value",
        "판독값",
        reading.value === null ? "없음" : `${reading.value}초`,
      ),
      metric("current-confidence", "신뢰도", formatConfidence(reading.confidence)),
      metric("current-digits", "숫자 수", String(reading.debug?.digitCount ?? 0)),
      metric("current-reason", "판정 사유", reading.debug?.reason ?? "정상 판독"),
      metric("current-recognizer", "인식기", COOLDOWN_DIGIT_RECOGNIZER_VERSION),
    ],
    stages: [
      recognitionStage(
        "preprocess",
        "화면 전처리",
        true,
        `${processed.width}x${processed.height}`,
        "현재 퀵슬롯 전처리를 실행했습니다.",
      ),
      recognitionStage(
        "recognition",
        "숫자 판독",
        reading.value !== null,
        reading.value === null ? "판독 없음" : `${reading.value}초`,
        "현재 숫자 인식 결과입니다.",
        "warning",
      ),
      temporalStage("tracking", "종료 시각 추적", "여러 프레임 필요"),
    ],
    evidence: [
      {
        id: "current-skill-processed",
        label: "현재 전처리 결과",
        description: "최신 퀵슬롯 전처리를 적용한 화면입니다.",
        src: imageDataToDataUrl(processed),
      },
    ],
  });
}
