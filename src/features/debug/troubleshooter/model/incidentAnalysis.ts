import {
  getAlertIssueEvidenceRequirements,
  type AlertIssueEvidenceKey,
  type AlertIssueScenario,
} from "../../../../contracts/reporting/alertIssueScenario";
import type {
  PipelineStage,
  TroubleshooterDiagnostic,
  TroubleshooterIncidentMetadata,
  TroubleshooterMetric,
} from "./types";

const EVIDENCE_LABELS: Record<AlertIssueEvidenceKey, string> = {
  sourceImage: "실제 분석 입력",
  temporalTrace: "시간 흐름",
  stateBeforeAfter: "판정 전후 상태",
  decision: "판정 근거",
  playback: "알림 재생 기록",
  affectedTarget: "문제 대상",
};

const ALERT_ISSUE_SCENARIOS = new Set<AlertIssueScenario>([
  "not-recognized",
  "recognized-no-alert",
  "playback-missing",
  "repeat-missing",
  "wrong-target",
  "duplicate-alert",
  "unexpected-playback",
  "wrong-value",
  "unstable-value",
  "early-alert",
  "late-alert",
  "repeat-timing",
  "other",
]);

export function analyzeIncidentEvidence(
  incident: TroubleshooterIncidentMetadata | null,
  options: { hasFeatureIncidentEvidence?: boolean } = {},
): {
  stage: PipelineStage;
  metrics: TroubleshooterMetric[];
  diagnostics: TroubleshooterDiagnostic[];
} {
  if (!incident) {
    return {
      stage: {
        id: "incident-binding",
        label: "제보 시점 증거",
        status: "unavailable",
        summary: "이전 제보 형식이라 시점 결합 정보를 확인할 수 없습니다.",
        detail:
          "사진, 상태, 판정 기록이 같은 순간의 자료인지 페이로드만으로 증명할 수 없습니다.",
        replayCoverage: "stored-evidence",
        metrics: [],
        evidenceIds: [],
      },
      metrics: [],
      diagnostics: [
        {
          id: "incident-contract-missing",
          tone: "warning",
          title: "제보 시점 결합 정보가 없습니다",
          detail:
            "이 결과는 저장된 각 자료를 개별적으로 설명할 수 있지만 실제 문제 순간의 완전 재현으로 해석하면 안 됩니다.",
          stageId: "incident-binding",
        },
      ],
    };
  }

  const scenario = isAlertIssueScenario(incident.scenario) ? incident.scenario : "other";
  const required = getAlertIssueEvidenceRequirements(scenario);
  const missing = options.hasFeatureIncidentEvidence
    ? []
    : required.filter((key) => incident.completeness[key] !== true);
  const diagnostics: TroubleshooterDiagnostic[] = [];

  if (
    !options.hasFeatureIncidentEvidence &&
    (incident.evidenceSource === "mixed" || incident.stateBinding === "mixed")
  ) {
    diagnostics.push({
      id: "incident-mixed-evidence",
      tone: "warning",
      title: "서로 다른 시점의 자료가 섞였습니다",
      detail:
        "제보용 화면 분석과 이전 런타임 상태를 함께 사용했습니다. 인식 결과와 상태 변화의 직접적인 인과관계는 확정할 수 없습니다.",
      stageId: "incident-binding",
    });
  }

  if (
    !options.hasFeatureIncidentEvidence &&
    (incident.occurrence === "current" || incident.occurrence === "recent") &&
    incident.journalStatus === "unavailable"
  ) {
    diagnostics.push({
      id: "incident-journal-unavailable",
      tone: "warning",
      title: "선택한 시점의 사건 기록을 찾지 못했습니다",
      detail:
        "제보 창을 열기 전 최근 1분 기록에 해당 기능과 대상의 샘플·판정·재생 이벤트가 없습니다. 현재 사진만으로 시간 흐름이나 알림 실행 여부를 확정하지 마세요.",
      stageId: "incident-binding",
    });
  }

  if (!options.hasFeatureIncidentEvidence && incident.occurrence === "historical") {
    diagnostics.push({
      id: "incident-historical",
      tone: "warning",
      title: "문제 시점이 보관 구간보다 이전입니다",
      detail:
        "현재 전송된 이미지와 짧은 이력은 과거 사건을 그대로 재현하지 못합니다. 이벤트 앵커가 없는 항목은 참고 자료로만 보세요.",
      stageId: "incident-binding",
    });
  } else if (
    !options.hasFeatureIncidentEvidence &&
    incident.occurrence === "recent" &&
    incident.sampledAt !== null &&
    incident.journalCapturedAt !== null &&
    incident.sampledAt >= incident.journalCapturedAt
  ) {
    diagnostics.push({
      id: "incident-report-capture-after-event",
      tone: "warning",
      title: "사진은 제보를 시작한 뒤 캡처됐습니다",
      detail:
        "최근 1분 선택은 제보 창을 열기 전 사건 기록을 뜻합니다. 전송된 사진은 제보 요청 뒤 받은 새 프레임이므로 직전 문제 화면과 동일하다고 단정할 수 없습니다.",
      stageId: "incident-binding",
    });
  }

  if ((incident.relatedPlaybackEntryCount ?? 0) > 0) {
    diagnostics.push({
      id: "incident-related-playback",
      tone: "info",
      title: "같은 시간대에 다른 알림도 재생됐습니다",
      detail: `대상 기능과 별개인 재생 기록 ${incident.relatedPlaybackEntryCount ?? 0}개가 있습니다. 사용자가 들은 소리가 대상 알림이었다고 단정하지 말고 각 재생 ID와 기능을 구분해 확인하세요.`,
      stageId: "incident-binding",
    });
  }

  if (missing.length > 0) {
    diagnostics.push({
      id: "incident-required-evidence-missing",
      tone: "critical",
      title: "선택한 상황을 판단할 증거가 부족합니다",
      detail: `${missing.map((key) => EVIDENCE_LABELS[key]).join(", ")} 자료가 없어 원인을 하나로 확정할 수 없습니다.`,
      stageId: "incident-binding",
    });
  }


  if (
    !options.hasFeatureIncidentEvidence &&
    incident.evidenceManifest.producedReferenceCount > 0 &&
    incident.evidenceManifest.retainedReferenceCount <
      incident.evidenceManifest.producedReferenceCount
  ) {
    diagnostics.push({
      id: "incident-referenced-evidence-missing",
      tone: "warning",
      title: "일부 증거가 전송 크기 조정 과정에서 제외됐습니다",
      detail: `${incident.evidenceManifest.droppedReferenceIds.join(", ") || "일부 참조"} 자료는 최종 제보에 남지 않았습니다. 남아 있는 증거만 기준으로 판단하세요.`,
      stageId: "incident-binding",
    });
  }

  const metrics: TroubleshooterMetric[] = [
    metric("incident-scenario", "세부 상황", incident.scenarioLabel ?? incident.scenario ?? "기록 없음"),
    metric("incident-occurrence", "발생 시점", formatOccurrence(incident.occurrence)),
    metric("incident-source", "증거 출처", incident.evidenceSource ?? "기록 없음"),
    metric("incident-binding", "상태 결합", incident.stateBinding ?? "기록 없음"),
    metric("incident-window", "보관 구간", formatWindow(incident)),
    metric("incident-media", "보관 이미지", `${incident.mediaCount}개`),
    metric(
      "incident-journal",
      "사건 기록",
      `${formatJournalStatus(incident.journalStatus)} · ${incident.journalEntryCount}개${(incident.journalLifecycleEntryCount ?? 0) > 0 ? ` · 예약 흐름 ${incident.journalLifecycleEntryCount}` : ""}`,
    ),
    metric(
      "incident-correlation",
      "상관관계",
      `프레임 ${incident.correlation.frameCount} · 주기 ${incident.correlation.cycleCount} · 재생 ${incident.correlation.playbackCount}${(incident.correlation.relatedPlaybackCount ?? 0) > 0 ? ` · 다른 재생 ${incident.correlation.relatedPlaybackCount}` : ""} · 설정 ${incident.correlation.configRevisionCount}`,
    ),
    metric(
      "incident-manifest",
      "증거 참조",
      `${incident.evidenceManifest.retainedReferenceCount}/${incident.evidenceManifest.producedReferenceCount}개 보관 · 미생성 ${incident.evidenceManifest.unavailableReferenceIds.length}개`,
    ),
  ];

  return {
    stage: {
      id: "incident-binding",
      label: "제보 시점 증거",
      status: missing.length > 0 || diagnostics.length > 0 ? "warning" : "complete",
      summary:
        options.hasFeatureIncidentEvidence
          ? "기능별 사건 증거와 전송 시점 자료가 분리돼 있습니다."
          : missing.length > 0
          ? `필수 증거 ${missing.length}종이 부족합니다.`
          : diagnostics.length > 0
            ? "증거는 있으나 시점 결합에 주의가 필요합니다."
            : "선택한 상황에 필요한 증거가 같은 사건 단위로 결합됐습니다.",
      detail:
        options.hasFeatureIncidentEvidence
          ? "원인 판정은 기능별 선택 사건 체인을 사용하고, 제보 요청 뒤 받은 샘플은 별도 참고 자료로만 표시합니다."
          : incident.evidenceSource === "runtime-atomic"
          ? "제보 요청 뒤 받은 첫 정상 런타임 샘플의 입력, 판정, 전후 상태를 함께 보관했습니다. 최근 1분 사건 기록과는 별도 시점입니다."
          : "증거 출처와 보관 범위를 확인한 뒤 기능별 결과를 해석하세요.",
      replayCoverage: "stored-evidence",
      metrics,
      evidenceIds: [],
    },
    metrics: metrics.slice(0, 2),
    diagnostics,
  };
}

function isAlertIssueScenario(value: string | null): value is AlertIssueScenario {
  return Boolean(value && ALERT_ISSUE_SCENARIOS.has(value as AlertIssueScenario));
}

function formatOccurrence(value: string | null): string {
  if (value === "current") return "제보 창을 열기 직전에도 재현";
  if (value === "recent") return "제보 창을 열기 전 1분 이내";
  if (value === "historical") return "제보 창을 열기 1분보다 이전";
  return "기록 없음";
}

function formatWindow(incident: TroubleshooterIncidentMetadata): string {
  if (incident.windowStartedAt === null || incident.windowEndedAt === null) {
    return `${incident.frameCount}프레임`;
  }
  const seconds = Math.max(0, incident.windowEndedAt - incident.windowStartedAt) / 1_000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}초 · ${incident.frameCount}프레임`;
}

function formatJournalStatus(value: string | null): string {
  if (value === "matched") return "최근 사건 연결됨";
  if (value === "current-snapshot") return "현재 상태 연결됨";
  if (value === "outside-retention") return "보관 범위 밖";
  if (value === "unavailable") return "연결 기록 없음";
  return "이전 제보 형식";
}

function metric(id: string, label: string, value: string): TroubleshooterMetric {
  return { id, label, value };
}
