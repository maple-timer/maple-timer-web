import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useMemo, useState } from "react";
import type {
  EvidenceGroup,
  TroubleshooterTone,
  TroubleshooterViewModel,
} from "./model";
import { formatTimestamp } from "./model/sample";

type DetailTab = "diagnosis" | "evidence" | "metadata" | "raw";

export function DetailTabs({ view }: { view: TroubleshooterViewModel }) {
  const [tab, setTab] = useState<DetailTab>("diagnosis");
  const rawJson = useMemo(
    () => JSON.stringify(redactImageDataUrls(view.rawSample), null, 2),
    [view.rawSample],
  );

  return (
    <section className="detail-section" aria-labelledby="detail-title">
      <h2 id="detail-title" className="visually-hidden">
        상세 정보
      </h2>
      <TabList
        value={tab}
        onChange={(value) => setTab(value as DetailTab)}
        size="sm"
        hasDivider
      >
        <Tab value="diagnosis" label="진단" />
        <Tab value="evidence" label="증거 목록" />
        <Tab value="metadata" label="샘플 정보" />
        <Tab value="raw" label="원본 데이터" />
      </TabList>

      {tab === "diagnosis" ? <DiagnosisDetails view={view} /> : null}
      {tab === "evidence" ? <EvidenceDetails view={view} /> : null}
      {tab === "metadata" ? <MetadataDetails view={view} /> : null}
      {tab === "raw" ? (
        <pre className="raw-json" tabIndex={0}>
          {rawJson}
        </pre>
      ) : null}
    </section>
  );
}

function DiagnosisDetails({ view }: { view: TroubleshooterViewModel }) {
  return (
    <section className="detail-diagnosis">
      <ul className="diagnostic-list extended">
        {view.diagnostics.map((item) => (
          <li key={item.id}>
            <StatusDot variant={toneVariant(item.tone)} label={toneLabel(item.tone)} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            {item.stageId ? <code>{item.stageId}</code> : null}
          </li>
        ))}
      </ul>
      <dl className="summary-metric-grid detail-metrics">
        {view.stages.flatMap((stage) =>
          stage.metrics.map((item) => (
            <span key={`${stage.id}-${item.id}`}>
              <dt>{stage.label} · {item.label}</dt>
              <dd>{item.value}</dd>
            </span>
          )),
        )}
      </dl>
    </section>
  );
}

function EvidenceDetails({ view }: { view: TroubleshooterViewModel }) {
  const counts = view.evidence.reduce<Record<EvidenceGroup, number>>(
    (result, item) => ({ ...result, [item.group]: result[item.group] + 1 }),
    { source: 0, detection: 0, recognition: 0, runtime: 0, alert: 0 },
  );
  const labels: Record<EvidenceGroup, string> = {
    source: "원본",
    detection: "후보 탐색",
    recognition: "판독",
    runtime: "시간 흐름",
    alert: "알림",
  };
  return (
    <section className="evidence-index">
      {(Object.keys(labels) as EvidenceGroup[]).map((group) => (
        <article key={group}>
          <header>
            <strong>{labels[group]}</strong>
            <small>{counts[group]}개</small>
          </header>
          <ul>
            {view.evidence
              .filter((item) => item.group === group)
              .map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <time>{item.capturedAt ? formatTimestamp(item.capturedAt) : "시각 없음"}</time>
                </li>
              ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function MetadataDetails({ view }: { view: TroubleshooterViewModel }) {
  const metadata = view.metadata;
  const reportContractLabel = metadata.reportContract
    ? `${metadata.reportContract.schema} v${metadata.reportContract.version}`
    : "레거시 (표식 없음)";
  const rows = [
    ["샘플 ID", metadata.sampleId],
    ["제보 형식", metadata.kind],
    ["제보 계약", reportContractLabel],
    ["기능 스키마", metadata.schemaVersion ?? "없음"],
    ["제보 사유", metadata.issueLabel],
    ["사유 코드", metadata.issueReason],
    ...(metadata.issueOtherCategoryLabel
      ? [["기타 분류", metadata.issueOtherCategoryLabel]]
      : []),
    ["환경", metadata.environmentLabel],
    ["앱 버전", metadata.appBuildLabel],
    ["캡처", metadata.captureLabel],
    ["분석 기준", metadata.frameSourceLabel],
    ["게임 영역", metadata.gameViewportLabel],
    ["브라우저 화면", metadata.viewportLabel],
    ["제보 시각", metadata.submittedAt ? formatTimestamp(metadata.submittedAt) : "없음"],
    ["저장 시각", metadata.storedAt ? formatTimestamp(metadata.storedAt) : "없음"],
    ["주소", metadata.sourceUrl || "없음"],
  ];
  return (
    <dl className="metadata-grid">
      {rows.map(([label, value]) => (
        <span key={String(label)}>
          <dt>{label}</dt>
          <dd>{String(value)}</dd>
        </span>
      ))}
    </dl>
  );
}

export function toneVariant(tone: TroubleshooterTone) {
  if (tone === "positive") return "success" as const;
  if (tone === "critical") return "error" as const;
  if (tone === "warning") return "warning" as const;
  if (tone === "info") return "accent" as const;
  return "neutral" as const;
}

function toneLabel(tone: TroubleshooterTone) {
  if (tone === "positive") return "정상";
  if (tone === "critical") return "문제";
  if (tone === "warning") return "확인 필요";
  if (tone === "info") return "정보";
  return "기록";
}

function redactImageDataUrls(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("data:image/")) {
    return `[image data omitted: ${value.length.toLocaleString("ko-KR")} chars]`;
  }
  if (Array.isArray(value)) return value.map(redactImageDataUrls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      redactImageDataUrls(item),
    ]),
  );
}
