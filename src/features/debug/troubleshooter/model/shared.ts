import type { DebugReplayCause } from "../../replay/buffExpiryPrecisionReplay";
import {
  asArray,
  asRecord,
  firstNumber,
  firstString,
  getByPath,
  readTimestamp,
} from "./sample";
import type {
  EvidenceAsset,
  EvidenceGroup,
  NormalizedDebugSample,
  PipelineStage,
  PipelineStageStatus,
  ReplayCoverage,
  TroubleshooterDiagnostic,
  TroubleshooterMetric,
  TroubleshooterTone,
  TroubleshooterVerdict,
} from "./types";

export function metric(
  id: string,
  label: string,
  value: string,
  detail?: string,
  tone?: TroubleshooterTone,
): TroubleshooterMetric {
  return { id, label, value, detail, tone };
}

export function diagnostic(
  id: string,
  tone: TroubleshooterTone,
  title: string,
  detail: string,
  stageId?: string,
): TroubleshooterDiagnostic {
  return { id, tone, title, detail, stageId };
}

export function stage({
  id,
  label,
  status,
  summary,
  detail,
  replayCoverage = "stored-evidence",
  metrics = [],
  evidenceIds = [],
}: {
  id: string;
  label: string;
  status: PipelineStageStatus;
  summary: string;
  detail: string;
  replayCoverage?: ReplayCoverage;
  metrics?: TroubleshooterMetric[];
  evidenceIds?: string[];
}): PipelineStage {
  return { id, label, status, summary, detail, replayCoverage, metrics, evidenceIds };
}

export function createEvidenceCollector(sample: NormalizedDebugSample) {
  const evidence: EvidenceAsset[] = [];
  const ids = new Set<string>();

  function add({
    id,
    group,
    label,
    description,
    value,
    capturedAt,
    stageId,
    metadata = [],
  }: {
    id: string;
    group: EvidenceGroup;
    label: string;
    description: string;
    value: unknown;
    capturedAt?: unknown;
    stageId?: string;
    metadata?: TroubleshooterMetric[];
  }) {
    if (typeof value !== "string" || !value.startsWith("data:image/") || ids.has(id)) return;
    ids.add(id);
    evidence.push({
      id,
      group,
      label,
      description,
      src: value,
      capturedAt: readTimestamp(capturedAt),
      stageId,
      metadata,
    });
  }

  function addPath(
    id: string,
    group: EvidenceGroup,
    label: string,
    description: string,
    path: string,
    options: {
      capturedAt?: unknown;
      stageId?: string;
      metadata?: TroubleshooterMetric[];
    } = {},
  ) {
    add({
      id,
      group,
      label,
      description,
      value: getByPath(sample.body, path),
      ...options,
    });
  }

  return { evidence, add, addPath };
}

export function selectIncidentRecord({
  records,
  selectedIds,
  selectedEventAt,
  timeKey,
}: {
  records: Record<string, unknown>[];
  selectedIds: unknown[];
  selectedEventAt: number | null;
  timeKey: string;
}): Record<string, unknown> | null {
  const requestedIds = selectedIds.filter(
    (entry): entry is string => typeof entry === "string",
  );
  const ids = new Set(requestedIds);
  const selected = records.filter((entry) =>
    ids.has(firstString(entry.id) ?? ""),
  );
  if (requestedIds.length > 0 && selected.length === 0) return null;
  const candidates = selected.length > 0 ? selected : records;
  return [...candidates].sort((left, right) => {
    const leftAt = firstNumber(left[timeKey]) ?? 0;
    const rightAt = firstNumber(right[timeKey]) ?? 0;
    if (selectedEventAt !== null) {
      const distance =
        Math.abs(leftAt - selectedEventAt) -
        Math.abs(rightAt - selectedEventAt);
      if (distance !== 0) return distance;
    }
    return rightAt - leftAt;
  })[0] ?? null;
}

export function selectIncidentFrame({
  frames,
  frameId,
  selectedIds,
  selectedEventAt,
}: {
  frames: Record<string, unknown>[];
  frameId: string | null;
  selectedIds: unknown[];
  selectedEventAt: number | null;
}) {
  const direct = frameId
    ? frames.find((entry) => firstString(entry.id) === frameId)
    : null;
  return direct ?? selectIncidentRecord({
    records: frames,
    selectedIds,
    selectedEventAt,
    timeKey: "sampledAt",
  });
}

export function collectIncidentDegradationReasons(
  selection: Record<string, unknown>,
  omissions: Record<string, unknown>[],
) {
  return [
    ...asArray(selection.degradationReasons),
    ...omissions.map((entry) => entry.reason),
  ].filter(
    (entry, index, all): entry is string =>
      typeof entry === "string" && all.indexOf(entry) === index,
  );
}

export function addCommonEvidence(
  sample: NormalizedDebugSample,
  collector: ReturnType<typeof createEvidenceCollector>,
  sourceLabel: string,
) {
  const sampleNode = asRecord(sample.body.sample);
  const source = asRecord(sampleNode.source);
  const sourceSize = asRecord(source.sourceSize);
  const sourceRoi = asRecord(source.roi);
  const sourceMetadata = firstString(source.dataUrl)
    ? [
        metric(
          "source-input-mode",
          "parser 입력",
          firstString(source.parserInputMode) ?? "미기록",
        ),
        metric(
          "source-capture-size",
          "원본 캡처",
          formatEvidenceSize(sourceSize.width, sourceSize.height),
        ),
        metric(
          "source-roi",
          "ROI",
          formatEvidenceRoi(sourceRoi),
        ),
      ]
    : [];
  collector.add({
    id: "source-raw",
    group: "source",
    label: sourceLabel,
    description: firstString(source.dataUrl)
      ? "실제 런타임 프레임에서 parser 입력 영역으로 함께 저장된 화면입니다."
      : "제보 시점에 분석기로 전달된 원본 화면입니다.",
    value: firstString(source.dataUrl, sampleNode.rawDataUrl),
    stageId: "input",
    capturedAt: sampleNode.sampledAt,
    metadata: sourceMetadata,
  });
  collector.addPath(
    "source-full-frame",
    "source",
    "전체 화면",
    "분석 영역의 위치와 주변 UI를 확인하는 전체 화면입니다.",
    "sample.fullFrameDataUrl",
    { stageId: "input", capturedAt: sampleNode.sampledAt },
  );
  collector.addPath(
    "source-processed",
    "detection",
    "전처리 결과",
    "후보 탐색 또는 OCR에 사용된 전처리 이미지입니다.",
    "sample.processedDataUrl",
    { stageId: "detection", capturedAt: sampleNode.sampledAt },
  );
  collector.addPath(
    "source-candidate",
    "recognition",
    "선택 후보",
    "검출기가 최종 후보로 선택한 영역입니다.",
    "sample.candidateDataUrl",
    { stageId: "recognition", capturedAt: sampleNode.sampledAt },
  );
  collector.addPath(
    "source-timer",
    "recognition",
    "시간 판독 영역",
    "남은 시간을 읽는 데 사용된 영역입니다.",
    "sample.timerDataUrl",
    { stageId: "reading", capturedAt: sampleNode.sampledAt },
  );
}

function formatEvidenceSize(width: unknown, height: unknown): string {
  const parsedWidth = firstNumber(width);
  const parsedHeight = firstNumber(height);
  return parsedWidth !== null && parsedHeight !== null
    ? `${Math.round(parsedWidth)}x${Math.round(parsedHeight)}`
    : "미기록";
}

function formatEvidenceRoi(roi: Record<string, unknown>): string {
  const x = firstNumber(roi.x);
  const y = firstNumber(roi.y);
  const width = firstNumber(roi.width);
  const height = firstNumber(roi.height);
  return [x, y, width, height].every((value) => value !== null)
    ? `${Math.round(x!)}:${Math.round(y!)} · ${Math.round(width!)}x${Math.round(height!)}`
    : "미기록";
}

export function evidenceIdsForStage(evidence: EvidenceAsset[], stageId: string) {
  return evidence.filter((item) => item.stageId === stageId).map((item) => item.id);
}

export function stageStatusFromCount(
  count: number | null,
  options: { zero?: PipelineStageStatus; missing?: PipelineStageStatus } = {},
): PipelineStageStatus {
  if (count === null) return options.missing ?? "unavailable";
  if (count > 0) return "complete";
  return options.zero ?? "warning";
}

export function diagnosticsFromReplayCauses(
  causes: DebugReplayCause[],
  stageId = "alert",
): TroubleshooterDiagnostic[] {
  return causes.map((cause, index) =>
    diagnostic(
      `replay-${index}`,
      replayTone(cause.status),
      cause.title,
      cause.detail,
      stageId,
    ),
  );
}

export function buildVerdict(
  diagnostics: TroubleshooterDiagnostic[],
  fallback: { title: string; detail: string },
): TroubleshooterVerdict {
  const orderedTones: TroubleshooterTone[] = [
    "critical",
    "warning",
    "positive",
    "info",
    "neutral",
  ];
  for (const tone of orderedTones) {
    const match = diagnostics.find((item) => item.tone === tone);
    if (match) return { tone: match.tone, title: match.title, detail: match.detail };
  }
  return { tone: "neutral", ...fallback };
}

export function replayTone(status: DebugReplayCause["status"]): TroubleshooterTone {
  if (status === "fail") return "critical";
  if (status === "warn") return "warning";
  if (status === "pass") return "positive";
  return "info";
}

export function decisionStageStatus(
  tone: TroubleshooterTone,
): PipelineStageStatus {
  if (tone === "critical") return "blocked";
  if (tone === "warning") return "warning";
  if (tone === "positive") return "complete";
  return "pending";
}

export function arrayLength(value: unknown): number {
  return asArray(value).length;
}

export function getLatestRecord(value: unknown): Record<string, unknown> {
  const items = asArray(value);
  return asRecord(items[items.length - 1]);
}

export function getCount(...values: unknown[]): number | null {
  return firstNumber(...values);
}

export function getLabel(...values: unknown[]): string {
  return firstString(...values) ?? "없음";
}
