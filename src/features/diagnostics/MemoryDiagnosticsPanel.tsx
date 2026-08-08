import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectMemoryDiagnosticsSample,
  downloadMemoryDiagnostics,
  type MemoryDiagnosticsBuildInfo,
  type MemoryDiagnosticsMode,
  type MemoryDiagnosticsSample,
} from "../../lib/memoryDiagnostics";
import {
  resetRuntimePerformanceDiagnostics,
  setRuntimePerformanceDiagnosticsPaused,
  type RuntimePerformancePipelineSnapshot,
} from "../../lib/runtimePerformanceDiagnostics";
import type { PrecisionParserReadiness } from "../../lib/buffSlotParser/precisionParserAvailability";
import type {
  PrecisionParserCpuBenchmarkResult,
  PrecisionParserCpuFallbackState,
  PrecisionParserRuntimeSelection,
} from "../../contracts/recognition/precisionParserRuntime";
import { BUFF_SLOT_DL_MODEL } from "../../recognition/buff-slot/parser/dlBuffIconModel";

const SAMPLE_INTERVAL_MS = 5000;
const MAX_SAMPLES = 720;

type MemoryDiagnosticsPanelProps = {
  mode: Exclude<MemoryDiagnosticsMode, "off">;
  buildInfo: MemoryDiagnosticsBuildInfo;
  precisionParserReadiness?: PrecisionParserReadiness;
  precisionParserRuntimeSelection?: PrecisionParserRuntimeSelection;
  precisionParserCpuFallback?: PrecisionParserCpuFallbackState;
};

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB"];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return "-";
  }
  return value ? "on" : "off";
}

function formatMs(value: number): string {
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function getLatestMemoryText(sample: MemoryDiagnosticsSample | null): string {
  if (!sample) {
    return "샘플 없음";
  }

  const jsHeap = sample.performanceMemory.usedJSHeapSize;
  const uaMemory = sample.userAgentSpecificMemory.bytes;
  if (uaMemory !== null) {
    return `${formatBytes(uaMemory)} / UA`;
  }
  if (jsHeap !== null) {
    return `${formatBytes(jsHeap)} / JS heap`;
  }
  return "브라우저 API 없음";
}

export function MemoryDiagnosticsPanel({
  mode,
  buildInfo,
  precisionParserReadiness,
  precisionParserRuntimeSelection,
  precisionParserCpuFallback,
}: MemoryDiagnosticsPanelProps) {
  const [isCollapsed, setCollapsed] = useState(mode !== "lab");
  const [isRunning, setRunning] = useState(true);
  const [samples, setSamples] = useState<MemoryDiagnosticsSample[]>([]);
  const [latest, setLatest] = useState<MemoryDiagnosticsSample | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const startedAtRef = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());
  const isSamplingRef = useRef(false);

  const captureSample = useCallback(async () => {
    if (isSamplingRef.current) {
      return;
    }
    isSamplingRef.current = true;
    try {
      const sample = await collectMemoryDiagnosticsSample(buildInfo, startedAtRef.current);
      setLatest(sample);
      setSamples((current) => [...current, sample].slice(-MAX_SAMPLES));
      setLastError(null);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      isSamplingRef.current = false;
    }
  }, [buildInfo]);

  useEffect(() => {
    void captureSample();
  }, [captureSample]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = window.setInterval(() => void captureSample(), SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [captureSample, isRunning]);

  useEffect(() => {
    setRuntimePerformanceDiagnosticsPaused(!isRunning);
    return () => setRuntimePerformanceDiagnosticsPaused(false);
  }, [isRunning]);

  const workerRows = useMemo(() => latest?.workers.workers.slice(0, 8) ?? [], [latest]);
  const activeWorkers = latest?.workers.activeCount ?? 0;
  const uaMemory = latest?.userAgentSpecificMemory;
  const performanceMemory = latest?.performanceMemory;
  const profile = latest?.profile;
  const runtimePerformance = latest?.runtimePerformance;
  const runtimePipelines = runtimePerformance?.pipelines ?? [];
  const parserPipeline = runtimePipelines.find(
    (pipeline) => pipeline.id === getCurrentParserPipelineId(precisionParserRuntimeSelection),
  );
  const cpuBenchmark = getCpuBenchmark(precisionParserCpuFallback);

  return (
    <aside className={`memory-diagnostics memory-diagnostics--${mode}`} aria-label="메모리 진단">
      <div className="memory-diagnostics__header">
        <div>
          <p className="memory-diagnostics__eyebrow">
            {mode === "lab" ? "Memory Lab" : "Preview Diagnostics"}
          </p>
          <h2>런타임·메모리 진단</h2>
        </div>
        <button
          type="button"
          className="memory-diagnostics__ghost-button"
          onClick={() => setCollapsed((current) => !current)}
        >
          {isCollapsed ? "열기" : "접기"}
        </button>
      </div>

      {isCollapsed ? (
        <div className="memory-diagnostics__collapsed">
          <strong>{getLatestMemoryText(latest)}</strong>
          <span>워커 {activeWorkers}개</span>
        </div>
      ) : (
        <>
          <div className="memory-diagnostics__actions">
            <button type="button" onClick={() => setRunning((current) => !current)}>
              {isRunning ? "측정 정지" : "측정 시작"}
            </button>
            <button type="button" onClick={() => void captureSample()}>
              지금 측정
            </button>
            <button type="button" onClick={() => downloadMemoryDiagnostics(samples, latest)}>
              JSON 저장
            </button>
            <button
              type="button"
              onClick={() => {
                setSamples([]);
                setLatest(null);
                resetRuntimePerformanceDiagnostics();
              }}
            >
              비우기
            </button>
          </div>

          {lastError && <p className="memory-diagnostics__error">{lastError}</p>}

          <div className="memory-diagnostics__grid">
            <Metric label="샘플" value={`${samples.length}개`} />
            <Metric label="경과" value={latest ? formatMs(latest.elapsedMs) : "-"} />
            <Metric label="JS heap" value={formatBytes(performanceMemory?.usedJSHeapSize)} />
            <Metric label="JS total" value={formatBytes(performanceMemory?.totalJSHeapSize)} />
            <Metric
              label="UA memory"
              value={uaMemory?.bytes !== null && uaMemory?.bytes !== undefined ? formatBytes(uaMemory.bytes) : "-"}
            />
            <Metric label="격리" value={latest?.crossOriginIsolated ? "on" : "off"} />
            <Metric label="워커" value={`${activeWorkers} / ${latest?.workers.createdCount ?? 0}`} />
            <Metric label="DOM" value={`${latest?.dom.elementCount ?? 0}`} />
            <Metric label="Canvas" value={`${latest?.dom.canvasCount ?? 0}`} />
            <Metric label="Data image" value={formatBytes(latest?.dom.dataImageCharacters ?? null)} />
            <Metric label="Resource" value={formatBytes(latest?.resources.totalDecodedBodySize ?? null)} />
            <Metric label="Profile" value={profile?.loaded ? `${profile.rawCharacters}자` : "-"} />
            <Metric label="Runtime" value={`${runtimePerformance?.totalSamples ?? 0} samples`} />
          </div>

          <section className="memory-diagnostics__section">
            <h3>정밀 parser</h3>
            <div className="memory-diagnostics__chips">
              <span>상태 {formatParserReadiness(precisionParserReadiness)}</span>
              <span>연산 {formatExecutionProvider(precisionParserRuntimeSelection)}</span>
              <span>선택 {precisionParserRuntimeSelection?.selectionSource ?? "-"}</span>
              <span>CPU fallback {formatCpuFallbackStatus(precisionParserCpuFallback)}</span>
              <span>입력 {BUFF_SLOT_DL_MODEL.inputWidth}x{BUFF_SLOT_DL_MODEL.inputHeight}</span>
            </div>
            <dl className="memory-diagnostics__details">
              <div>
                <dt>parser / model</dt>
                <dd>{parserPipeline?.metadata.parserVersion ?? BUFF_SLOT_DL_MODEL.id}</dd>
              </div>
              <div>
                <dt>현재 runtime 표본</dt>
                <dd>{parserPipeline ? `${parserPipeline.sampleCount} samples` : "아직 분석 없음"}</dd>
              </div>
              {cpuBenchmark ? (
                <div>
                  <dt>CPU benchmark 평균 / p95</dt>
                  <dd>
                    parser {formatRuntimeMs(cpuBenchmark.parserAverageMs)} /{" "}
                    {formatRuntimeMs(cpuBenchmark.parserP95Ms)} · request{" "}
                    {formatRuntimeMs(cpuBenchmark.requestAverageMs)} /{" "}
                    {formatRuntimeMs(cpuBenchmark.requestP95Ms)} ·{" "}
                    {cpuBenchmark.requestSamplesMs.length}회 측정
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="memory-diagnostics__section">
            <div className="memory-diagnostics__section-heading">
              <h3>기능별 처리 속도</h3>
              <span>{runtimePerformance?.paused ? "정지" : "측정 중"}</span>
            </div>
            <p className="memory-diagnostics__note">
              평균과 p95는 측정 시작 이후 표본 기준입니다. 공유 parser의 benchmark와 실제 실행은 별도 행으로 집계합니다.
            </p>
            {runtimePipelines.length ? (
              <div className="memory-diagnostics__runtime-pipelines">
                {runtimePipelines.map((pipeline) => (
                  <RuntimePipeline key={pipeline.id} pipeline={pipeline} />
                ))}
              </div>
            ) : (
              <p className="memory-diagnostics__empty">
                화면 공유 후 기능을 실행하면 parser와 Worker 단계 시간이 표시됩니다.
              </p>
            )}
          </section>

          <section className="memory-diagnostics__section">
            <h3>기능 상태</h3>
            <div className="memory-diagnostics__chips">
              <span>스킬 {profile?.enabledSkillCount ?? "-"}/{profile?.skillCount ?? "-"}</span>
              <span>정밀 {profile?.precisionSkillCount ?? "-"}</span>
              <span>룬 {formatBoolean(profile?.runeEnabled ?? null)}</span>
              <span>사냥 멈춤 {formatBoolean(profile?.huntStallEnabled ?? null)}</span>
              <span>버프 종료 {formatBoolean(profile?.buffExpiryEnabled ?? null)}</span>
              <span>부스터 {formatBoolean(profile?.boosterExpiryEnabled ?? null)}</span>
              <span>특수 코어 {formatBoolean(profile?.specialCoreEnabled ?? null)}</span>
              <span>일반 타이머 {profile?.enabledGeneralTimerCount ?? "-"}</span>
            </div>
          </section>

          <section className="memory-diagnostics__section">
            <h3>워커</h3>
            {workerRows.length ? (
              <div className="memory-diagnostics__workers">
                {workerRows.map((worker) => (
                  <div key={worker.id} className="memory-diagnostics__worker-row">
                    <span data-state={worker.state}>{worker.state}</span>
                    <strong>{worker.scriptLabel}</strong>
                    <em>{formatMs(worker.ageMs)}</em>
                    <small>
                      post {worker.postedMessages} / recv {worker.receivedMessages}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="memory-diagnostics__empty">아직 생성된 워커가 없습니다.</p>
            )}
          </section>

          <section className="memory-diagnostics__section">
            <h3>브라우저 메모리 API</h3>
            <p className="memory-diagnostics__note">
              상단 바의 전체 메모리와 JS heap은 같은 값이 아닙니다. 이 패널은 브라우저가 허용하는
              JS/문서/워커 증거를 모아서 비교용 JSON으로 남깁니다.
            </p>
            {uaMemory?.supported === true && uaMemory.available === false && (
              <p className="memory-diagnostics__note">
                UA memory API 오류: {uaMemory.error ?? "측정 불가"}
              </p>
            )}
            {uaMemory?.supported === false && (
              <p className="memory-diagnostics__note">UA memory API가 이 브라우저에서 제공되지 않습니다.</p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

function RuntimePipeline({ pipeline }: { pipeline: RuntimePerformancePipelineSnapshot }) {
  const metadata = pipeline.metadata;
  return (
    <article className="memory-diagnostics__runtime-pipeline">
      <header>
        <div>
          <h4>{pipeline.label}</h4>
          <small>
            {pipeline.sampleCount} samples · 최근 {formatSampledAt(pipeline.lastSampledAt)}
          </small>
        </div>
        {metadata.executionProvider ? (
          <span data-provider={metadata.executionProvider}>
            {metadata.executionProvider.toUpperCase()}
          </span>
        ) : null}
      </header>

      {metadata.parserVersion || metadata.activeTargets.length || metadata.statuses.length ? (
        <div className="memory-diagnostics__runtime-meta">
          {metadata.parserVersion ? <span>parser {metadata.parserVersion}</span> : null}
          {metadata.activeTargets.map((target) => (
            <span key={target}>{target}</span>
          ))}
          {metadata.statuses.map((status) => (
            <span key={`${status.label}:${status.value}`}>
              {status.label} {status.value}
            </span>
          ))}
        </div>
      ) : null}

      {metadata.modelIds.length ? (
        <p className="memory-diagnostics__runtime-models">
          {metadata.modelIds.join(" · ")}
        </p>
      ) : null}

      <div className="memory-diagnostics__runtime-table" role="table" aria-label={`${pipeline.label} 처리 속도`}>
        <div className="memory-diagnostics__runtime-table-row memory-diagnostics__runtime-table-head" role="row">
          <span role="columnheader">단계</span>
          <span role="columnheader">최근</span>
          <span role="columnheader">평균</span>
          <span role="columnheader">p95</span>
          <span role="columnheader">최대</span>
          <span role="columnheader">n</span>
        </div>
        {pipeline.metrics.map((metric) => (
          <div className="memory-diagnostics__runtime-table-row" role="row" key={metric.key}>
            <strong role="cell">{metric.label}</strong>
            <span role="cell">{formatRuntimeMs(metric.latestMs)}</span>
            <span role="cell">{formatRuntimeMs(metric.averageMs)}</span>
            <span role="cell">{formatRuntimeMs(metric.p95Ms)}</span>
            <span role="cell">{formatRuntimeMs(metric.maxMs)}</span>
            <span role="cell">{metric.count}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function getCurrentParserPipelineId(
  selection?: PrecisionParserRuntimeSelection,
): string {
  const executionProvider = selection?.executionProvider ?? "webgpu";
  const selectionSource = selection?.selectionSource ?? "default";
  return `shared-buff-slot-parser:${executionProvider}:${selectionSource}`;
}

function formatExecutionProvider(selection?: PrecisionParserRuntimeSelection): string {
  if (selection?.executionProvider === "wasm") {
    return "CPU (WASM)";
  }
  return "GPU (WebGPU)";
}

function formatParserReadiness(readiness?: PrecisionParserReadiness): string {
  if (!readiness) {
    return "-";
  }
  const labels: Record<PrecisionParserReadiness["status"], string> = {
    idle: "대기",
    checking: "준비 중",
    ready: "준비 완료",
    unavailable: "사용 불가",
  };
  return labels[readiness.status];
}

function formatCpuFallbackStatus(state?: PrecisionParserCpuFallbackState): string {
  if (!state) {
    return "-";
  }
  const labels: Record<PrecisionParserCpuFallbackState["status"], string> = {
    idle: "대기",
    benchmarking: "측정 중",
    active: "사용 중",
    rejected: "성능 부족",
    failed: "오류",
    overloaded: "과부하 중지",
  };
  return labels[state.status];
}

function getCpuBenchmark(
  state?: PrecisionParserCpuFallbackState,
): PrecisionParserCpuBenchmarkResult | null {
  if (!state || !("benchmark" in state)) {
    return null;
  }
  return state.benchmark;
}

function formatRuntimeMs(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}ms`;
}

function formatSampledAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString("ko-KR", { hour12: false });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="memory-diagnostics__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default MemoryDiagnosticsPanel;
