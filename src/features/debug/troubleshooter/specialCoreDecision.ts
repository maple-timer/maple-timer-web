export function formatSpecialCoreDecisionReason(value: unknown): string {
  const reason = typeof value === "string" ? value : "";
  const labels: Record<string, string> = {
    base_and_positive_gate_passed: "1차 점수와 형태 검증 통과",
    near_exact_positive_prototype_rescue: "고유 형태 일치로 보정 통과",
    below_base_threshold: "1차 점수 기준 미달",
    below_positive_gate_threshold: "형태 검증 기준 미달",
    matched: "구형 모델 일치",
    below_threshold: "구형 모델 점수 기준 미달",
    prototype_gate: "구형 모델 형태 검증 기준 미달",
    "no-candidate": "비교할 후보 없음",
  };
  return labels[reason] ?? (reason || "판정 기록 없음");
}
