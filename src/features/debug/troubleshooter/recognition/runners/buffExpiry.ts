import {
  formatScore,
} from "../../model/sample";
import type {
  BuffExpiryPrecisionIconObservation,
  BuffExpiryPrecisionMatcherCandidate,
} from "../../../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import { metric } from "../../model/shared";
import {
  buildRecognitionResult,
  getFeatureConfig,
  recognitionStage,
  temporalLimit,
  temporalStage,
  type RecognitionContext,
} from "../helpers";
import { iconToDataUrl } from "../imageData";

export async function runBuffExpiryRecognition({
  view,
  imageData,
  startedAt,
  buffSlotInputMode,
}: RecognitionContext) {
  const [
    { createBuffExpiryPrecisionEngine },
    {
      BUFF_EXPIRY_PRECISION_GROUP_LABELS,
      getBuffExpiryPrecisionSelectedTargetGroups,
    },
  ] = await Promise.all([
    import("../../../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient"),
    import("../../../../../domain/buff-expiry/precisionTrackingPolicy"),
  ]);
  const activeGroups = getBuffExpiryPrecisionSelectedTargetGroups(
    getFeatureConfig(view, "buffExpiry"),
  );
  const engine = createBuffExpiryPrecisionEngine();
  try {
    await engine.preload(activeGroups);
    const response = await engine.process({
      imageData,
      sampledAt: Date.now(),
      buffSlotInputMode: buffSlotInputMode ?? undefined,
      activeGroups,
    });
    const targets = response.iconObservations.filter(
      (observation) => observation.identity.kind === "target",
    );
    const countdowns = targets.filter(
      (observation) =>
        observation.countdown?.totalSeconds !== null &&
        observation.countdown?.totalSeconds !== undefined,
    );
    const candidateObservations = response.iconObservations.filter(
      (observation) => (observation.identity.candidates?.length ?? 0) > 0,
    );
    const matcherObservation = targets[0] ?? getBestMatcherObservation(candidateObservations);
    const matcherCandidate = getBestMatcherCandidate(matcherObservation);
    const matcherDecision = matcherObservation?.identity.decisionReason === "cross_bundle_conflict"
      ? "cross_bundle_conflict"
      : matcherCandidate?.decisionReason ?? matcherObservation?.identity.decisionReason ?? "no-candidate";
    const matcherDecisionLabel = formatBuffMatcherDecision(matcherDecision);
    const parserBoxCount =
      response.buffSlotLocalization?.parserBoxCount ??
      response.performance.boxCount ??
      response.boxes.length;
    const localizedBoxCount =
      response.buffSlotLocalization?.localizedBoxCount ??
      response.boxes.length;
    const evidenceSource = targets.length > 0 ? targets : candidateObservations;
    const evidence = evidenceSource.slice(0, 6).flatMap((observation, index) => {
      const icon = response.icons[observation.boxIndex];
      const candidate = getBestMatcherCandidate(observation);
      return icon
        ? [
            {
              id: `current-buff-target-${index}`,
              label: (observation.identity.group ?? candidate?.group)
                ? BUFF_EXPIRY_PRECISION_GROUP_LABELS[
                    (observation.identity.group ?? candidate?.group)!
                  ]
                : `대상 후보 ${index + 1}`,
              description: [
                candidate?.bundleId ?? observation.identity.bundleId,
                formatBuffMatcherDecision(candidate?.decisionReason ?? observation.identity.decisionReason),
                `1차 여유 ${formatScore(candidate?.margin ?? observation.identity.margin)}`,
                `형태 여유 ${formatScore(candidate?.gateMargin ?? observation.identity.gateMargin)}`,
              ].filter(Boolean).join(" · "),
              src: iconToDataUrl(icon),
            },
          ]
        : [];
    });
    const title =
      countdowns.length > 0
        ? "현재 모델도 대상과 남은 시간을 인식함"
        : targets.length > 0
          ? "현재 모델은 대상을 찾았지만 시간을 읽지 못함"
          : localizedBoxCount > 0
            ? getBuffMatcherMissTitle(matcherDecision)
            : parserBoxCount > 0
              ? "현재 모델이 실제 버프칸 묶음을 확정하지 못함"
              : "현재 모델이 버프칸을 찾지 못함";

    return buildRecognitionResult({
      tone: countdowns.length > 0 ? "positive" : "warning",
      title,
      detail: temporalLimit("버프 추적과 종료 알림 확정"),
      startedAt,
      metrics: [
        metric("current-parser-boxes", "parser 후보", `${parserBoxCount}개`),
        metric("current-boxes", "실제 버프칸", `${localizedBoxCount}개`),
        metric(
          "current-spatial-excluded",
          "외부 UI 제외",
          `${response.buffSlotLocalization?.spatialExcludedBoxCount ?? 0}개`,
        ),
        metric("current-input-mode", "parser 입력", buffSlotInputMode ?? "fullFrame"),
        metric("current-targets", "대상 일치", `${targets.length}개`),
        metric("current-countdowns", "시간 판독", `${countdowns.length}개`),
        metric("current-decision", "matcher 판정", matcherDecisionLabel),
        metric("current-bundle", "판정 번들", matcherCandidate?.bundleId ?? "없음"),
        metric("current-model", "판정 모델", matcherCandidate?.modelVersion ?? "없음"),
        metric("current-score", "1차 점수", formatScore(matcherCandidate?.score)),
        metric("current-threshold", "1차 기준", formatScore(matcherCandidate?.threshold)),
        metric("current-margin", "1차 여유", formatScore(matcherCandidate?.margin)),
        metric("current-gate-score", "형태 점수", formatScore(matcherCandidate?.gateScore)),
        metric("current-gate-threshold", "형태 기준", formatScore(matcherCandidate?.gateThreshold)),
        metric("current-gate-margin", "형태 여유", formatScore(matcherCandidate?.gateMargin)),
        metric(
          "current-active-groups",
          "검사 대상",
          activeGroups.map((group) => BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]).join(", "),
        ),
        metric("current-runtime", "runtime", response.moduleVersions.runtime),
        metric("current-parser", "parser", response.moduleVersions.parser),
        metric("current-matcher", "matcher", response.moduleVersions.matcher),
        ...((response.moduleVersions.matcherBundles ?? []).map((bundle) =>
          metric(
            `current-model-${bundle.group}`,
            `${BUFF_EXPIRY_PRECISION_GROUP_LABELS[bundle.group]} 모델`,
            `${bundle.bundleId} · ${bundle.modelVersion}`,
          )
        )),
        metric("current-countdown", "숫자 인식기", response.moduleVersions.countdown),
      ],
      stages: [
        recognitionStage(
          "parser",
          "버프칸 탐색",
          localizedBoxCount > 0,
          `${parserBoxCount}개 후보 · 실제 버프칸 ${localizedBoxCount}개`,
          "현재 parser 후보에서 우상단에 연결된 실제 버프칸 묶음을 먼저 분리했습니다.",
        ),
        recognitionStage(
          "matcher",
          "대상 버프 판정",
          targets.length > 0,
          targets.length > 0 ? `${targets.length}개 일치` : matcherDecisionLabel,
          `현재 matcher가 각 활성 그룹의 독립 번들과 형태 gate를 실행한 결과입니다. ${matcherDecisionLabel}.`,
          localizedBoxCount > 0 ? "warning" : "blocked",
        ),
        recognitionStage(
          "ocr",
          "남은 시간 판독",
          countdowns.length > 0,
          `${countdowns.length}개 판독`,
          "대상 아이콘 안의 숫자를 현재 OCR로 읽었습니다.",
          targets.length > 0 ? "warning" : "pending",
        ),
        temporalStage("tracking", "시간 흐름 추적", "여러 프레임 필요"),
      ],
      evidence,
    });
  } finally {
    engine.reset();
  }
}

function getBestMatcherObservation(
  observations: BuffExpiryPrecisionIconObservation[],
): BuffExpiryPrecisionIconObservation | undefined {
  return [...observations].sort((left, right) => {
    const leftCandidate = getBestMatcherCandidate(left);
    const rightCandidate = getBestMatcherCandidate(right);
    return compareMatcherCandidates(rightCandidate, leftCandidate);
  })[0];
}

function getBestMatcherCandidate(
  observation: Pick<BuffExpiryPrecisionIconObservation, "identity"> | null | undefined,
): BuffExpiryPrecisionMatcherCandidate | undefined {
  if (!observation) {
    return undefined;
  }
  const candidates = observation.identity.candidates ?? [];
  return [...candidates].sort((left, right) => {
    if (observation.identity.group) {
      const groupOrder = Number(right.group === observation.identity.group) -
        Number(left.group === observation.identity.group);
      if (groupOrder) {
        return groupOrder;
      }
    }
    return compareMatcherCandidates(right, left);
  })[0];
}

function compareMatcherCandidates(
  left: BuffExpiryPrecisionMatcherCandidate | undefined,
  right: BuffExpiryPrecisionMatcherCandidate | undefined,
): number {
  if (!left) return right ? -1 : 0;
  if (!right) return 1;
  return (
    Number(left.accepted) - Number(right.accepted) ||
    (left.gateMargin ?? Number.NEGATIVE_INFINITY) -
      (right.gateMargin ?? Number.NEGATIVE_INFINITY) ||
    left.margin - right.margin
  );
}

function getBuffMatcherMissTitle(decisionReason: string): string {
  if (decisionReason === "positive_gate_below_threshold") {
    return "현재 모델의 버프 아이콘 형태 검증이 기준에 미달함";
  }
  if (decisionReason === "cross_bundle_conflict") {
    return "현재 모델 간 판정이 충돌해 대상을 확정하지 않음";
  }
  if (decisionReason === "base_below_threshold") {
    return "현재 모델의 대상 분류가 기준에 미달함";
  }
  return "현재 모델이 버프칸은 찾았지만 대상을 확정하지 못함";
}

function formatBuffMatcherDecision(value: string): string {
  const labels: Record<string, string> = {
    target_accepted: "대상 일치",
    base_below_threshold: "1차 분류 기준 미달",
    positive_gate_below_threshold: "아이콘 형태 검증 기준 미달",
    cross_bundle_conflict: "모델 간 판정 충돌",
    matcher_idle: "matcher 대기",
    matcher_loading: "matcher 로딩 중",
    matcher_error: "matcher 오류",
    "no-candidate": "비교 후보 없음",
  };
  return labels[value] ?? value;
}
