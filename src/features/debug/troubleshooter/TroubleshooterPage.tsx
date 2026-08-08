import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { motion } from "motion/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DetailTabs, toneVariant } from "./DetailTabs";
import { CurrentRecognitionPanel } from "./CurrentRecognitionPanel";
import { downloadDebugSampleBundle } from "./downloadDebugSample";
import { EvidenceWorkspace } from "./EvidenceWorkspace";
import { buildTroubleshooterViewModel, type TroubleshooterViewModel } from "./model";
import { formatTimestamp } from "./model/sample";
import { PipelineView } from "./PipelineView";
import { TroubleshooterHeader } from "./TroubleshooterHeader";
import { useDebugSample } from "./useDebugSample";

export function TroubleshooterPage() {
  const { input, setInput, state, load, reload } = useDebugSample();
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
  const [focusedStageId, setFocusedStageId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const view = useMemo(
    () => (state.status === "ready" ? buildTroubleshooterViewModel(state.sample) : null),
    [state],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("maple-timer-troubleshooter-theme", theme);
  }, [theme]);

  useEffect(() => {
    setFocusedStageId(null);
  }, [view?.metadata.sampleId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(input);
  }

  async function handleDownload() {
    if (!view) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await downloadDebugSampleBundle(view);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "샘플 파일을 만들지 못했습니다.",
      );
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className="troubleshooter-shell">
      <TroubleshooterHeader
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        onReload={() => void reload()}
        onDownload={handleDownload}
        isLoading={state.status === "loading"}
        isDownloading={isDownloading}
        theme={theme}
        onThemeToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        view={view}
      />

      {downloadError ? (
        <section className="action-error">
          <Banner
            status="error"
            title="샘플 다운로드 실패"
            description={downloadError}
            container="section"
            isDismissable
            onDismiss={() => setDownloadError(null)}
          />
        </section>
      ) : null}

      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <ErrorState message={state.error} onRetry={() => void reload()} />
      ) : null}
      {state.status === "idle" ? <EmptyState /> : null}
      {view ? (
        <motion.section
          className="troubleshooter-content"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
        >
          <SummaryStrip view={view} />
          <section className="primary-workspace">
            <EvidenceWorkspace
              view={view}
              focusedStageId={focusedStageId}
              onClearStage={() => setFocusedStageId(null)}
            />
            <DiagnosisInspector
              view={view}
              focusedStageId={focusedStageId}
              onSelectStage={(stageId) =>
                setFocusedStageId((current) => (current === stageId ? null : stageId))
              }
            />
          </section>
          <DetailTabs view={view} />
        </motion.section>
      ) : null}
    </main>
  );
}

function SummaryStrip({ view }: { view: TroubleshooterViewModel }) {
  return (
    <section className="summary-strip" aria-labelledby="report-title">
      <header className="summary-heading">
        <span className="summary-feature">
          <StatusDot variant={toneVariant(view.verdict.tone)} label={view.featureLabel} />
          {view.featureLabel} · {view.modeLabel}
        </span>
        <h1 id="report-title">{view.title}</h1>
        <p>{view.metadata.issueLabel}</p>
      </header>
      <dl className="summary-metric-grid">
        {view.summaryMetrics.map((item) => (
          <span key={item.id} title={item.detail}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </span>
        ))}
      </dl>
      <footer className="summary-meta">
        <code>{view.metadata.sampleId}</code>
        <span>{view.metadata.appBuildLabel}</span>
        <time>
          {view.metadata.submittedAt ? formatTimestamp(view.metadata.submittedAt) : "제보 시각 없음"}
        </time>
      </footer>
    </section>
  );
}

function DiagnosisInspector({
  view,
  focusedStageId,
  onSelectStage,
}: {
  view: TroubleshooterViewModel;
  focusedStageId: string | null;
  onSelectStage(stageId: string): void;
}) {
  return (
    <aside className="diagnosis-inspector" aria-labelledby="diagnosis-title">
      <header className="workspace-toolbar inspector-heading">
        <span className="workspace-title-block">
          <strong id="diagnosis-title">진단</strong>
          <small>{view.diagnostics.length}개 판단</small>
        </span>
      </header>
      <Banner
        status={bannerStatus(view.verdict.tone)}
        title={view.verdict.title}
        description={view.verdict.detail}
        container="section"
      />
      <ul className="diagnostic-list">
        {view.diagnostics.slice(1, 7).map((item) => (
          <li key={item.id}>
            <StatusDot variant={toneVariant(item.tone)} label={item.title} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
          </li>
        ))}
      </ul>
      <PipelineView
        stages={view.stages}
        focusedStageId={focusedStageId}
        onSelect={onSelectStage}
      />
      <CurrentRecognitionPanel view={view} />
      <footer className="coverage-note">
        <strong>현재 재현 범위</strong>
        <span>저장 증거 해석 · 알림 판정 재실행 · 현재 인식기 비교</span>
        <small>시간 흐름이 필요한 확정 단계는 저장된 실행 기록으로 판단합니다.</small>
      </footer>
    </aside>
  );
}

function LoadingState() {
  return (
    <section className="full-state" aria-live="polite">
      <Spinner size="lg" label="샘플 데이터 준비 중" />
    </section>
  );
}

function EmptyState() {
  return (
    <section className="full-state empty-state">
      <strong>샘플을 선택해주세요.</strong>
      <p>Slack의 트러블슈팅 링크로 열거나 상단에 샘플 ID를 입력할 수 있습니다.</p>
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <section className="error-state">
      <Banner
        status="error"
        title="샘플을 불러오지 못했습니다."
        description={message}
        container="section"
        endContent={<Button label="다시 시도" size="sm" variant="secondary" onClick={onRetry} />}
      />
    </section>
  );
}

function bannerStatus(tone: TroubleshooterViewModel["verdict"]["tone"]) {
  if (tone === "critical") return "error" as const;
  if (tone === "warning") return "warning" as const;
  if (tone === "positive") return "success" as const;
  return "info" as const;
}

function getInitialTheme(): "light" | "dark" {
  const saved = localStorage.getItem("maple-timer-troubleshooter-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
