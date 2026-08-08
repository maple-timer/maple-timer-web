import { addCommonEvidence, buildVerdict, createEvidenceCollector, diagnostic, evidenceIdsForStage, metric, stage } from "../shared";
import type { FeatureAdapter } from "../types";

export const fallbackAdapter: FeatureAdapter = {
  feature: "unknown",
  analyze(sample) {
    const collector = createEvidenceCollector(sample);
    addCommonEvidence(sample, collector, "제보 원본");
    const diagnostics = [
      diagnostic(
        "unsupported-kind",
        "warning",
        "지원하지 않는 제보 형식",
        `현재 트러블슈터에 ${sample.kind} 형식의 기능별 adapter가 없습니다.`,
      ),
    ];
    return {
      feature: "unknown",
      featureLabel: "알 수 없는 제보",
      modeLabel: sample.kind,
      title: sample.id === "unknown" ? "제보 데이터" : `제보 ${sample.id.slice(0, 8)}`,
      verdict: buildVerdict(diagnostics, {
        title: "제보 형식 확인 필요",
        detail: "기능별 분석을 시작할 수 없습니다.",
      }),
      summaryMetrics: [metric("kind", "제보 형식", sample.kind)],
      diagnostics,
      stages: [
        stage({
          id: "input",
          label: "저장된 증거",
          status: collector.evidence.length > 0 ? "complete" : "unavailable",
          summary: `${collector.evidence.length}개 이미지`,
          detail: "기능별 해석 없이 저장된 공통 이미지만 표시합니다.",
          evidenceIds: evidenceIdsForStage(collector.evidence, "input"),
        }),
      ],
      evidence: collector.evidence,
    };
  },
};
