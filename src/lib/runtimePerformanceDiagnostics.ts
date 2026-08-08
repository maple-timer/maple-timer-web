const MAX_RECENT_METRIC_SAMPLES = 240;

export type RuntimePerformanceMetricSnapshot = {
  key: string;
  label: string;
  count: number;
  latestMs: number;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
};

export type RuntimePerformancePipelineMetadata = {
  executionProvider: string | null;
  selectionSource: string | null;
  parserEngine: string | null;
  parserVersion: string | null;
  modelIds: string[];
  activeTargets: string[];
  statuses: Array<{ label: string; value: string }>;
};

export type RuntimePerformancePipelineSnapshot = {
  id: string;
  label: string;
  sampleCount: number;
  lastSampledAt: string;
  metrics: RuntimePerformanceMetricSnapshot[];
  metadata: RuntimePerformancePipelineMetadata;
};

export type RuntimePerformanceDiagnosticsSnapshot = {
  paused: boolean;
  totalSamples: number;
  pipelines: RuntimePerformancePipelineSnapshot[];
};

type MetricAccumulator = {
  count: number;
  total: number;
  latest: number;
  max: number;
  recent: number[];
};

type PipelineAccumulator = {
  id: string;
  label: string;
  sampleCount: number;
  lastSampledAt: string;
  metrics: Map<string, MetricAccumulator>;
  metadata: RuntimePerformancePipelineMetadata;
};

type WorkerRequestContext = {
  executionProvider: string | null;
  selectionSource: string | null;
  activeTargets: string[];
};

const pipelineAccumulators = new Map<string, PipelineAccumulator>();
const workerRequestContexts = new Map<string, WorkerRequestContext>();
let paused = false;

const PIPELINE_DESCRIPTORS = [
  { pattern: /buffSlotAnalysis\.worker/i, id: "shared-buff-slot-parser", label: "공유 버프칸 parser" },
  { pattern: /skillPrecisionAnalysis\.worker/i, id: "skill-precision", label: "스킬 알림 · 정밀" },
  { pattern: /buffExpiryPrecision\.worker/i, id: "buff-expiry", label: "버프 종료 알림" },
  { pattern: /specialCoreAlert\.worker/i, id: "special-core", label: "특수 코어 알림" },
  { pattern: /runeDetection\.worker/i, id: "rune", label: "룬 알림" },
  { pattern: /huntStallOcr\.worker/i, id: "hunt-stall-experience", label: "사냥 멈춤 · 경험치" },
  { pattern: /huntStallCooldown\.worker/i, id: "hunt-stall-cooldown", label: "사냥 멈춤 · 퀵슬롯" },
  { pattern: /boosterExpiry\.worker/i, id: "booster-expiry", label: "부스터 종료 알림" },
] as const;

const METRIC_LABELS: Record<string, string> = {
  totalMs: "전체",
  detectMs: "parser / 감지",
  matchMs: "matcher",
  countdownMs: "숫자 인식",
  remainingCountMs: "횟수 인식",
  recognitionMs: "인식",
  candidateMs: "후보 탐색",
  selectedCandidateMs: "선택 후보",
  selectedOcrMs: "OCR",
  selectedPreviewMs: "프리뷰",
  ocrMs: "OCR",
  previewMs: "프리뷰",
  queueWaitMs: "Worker 대기",
  resultAgeMs: "결과 지연",
  inferenceMs: "모델 추론",
};

export function observeRuntimeWorkerRequest(
  workerKey: string,
  message: unknown,
): void {
  const request = asRecord(message);
  if (!request) {
    return;
  }
  const runtimeSelection = asRecord(request.runtimeSelection);
  workerRequestContexts.set(workerKey, {
    executionProvider: asString(runtimeSelection?.executionProvider),
    selectionSource: asString(runtimeSelection?.selectionSource),
    activeTargets: collectRequestTargets(request),
  });
}

export function observeRuntimeWorkerResponse(
  workerKey: string,
  scriptLabel: string,
  message: unknown,
): void {
  if (paused) {
    return;
  }
  const envelope = asRecord(message);
  if (!envelope || envelope.ok === false) {
    return;
  }
  const response = asRecord(envelope.response) ?? envelope;
  const performance = extractPerformance(response);
  if (!performance) {
    return;
  }
  const numericMetrics = Object.entries(performance).filter(
    ([key, value]) => key.endsWith("Ms") && typeof value === "number" && Number.isFinite(value),
  ) as Array<[string, number]>;
  if (numericMetrics.length <= 0) {
    return;
  }

  const descriptor = getPipelineDescriptor(scriptLabel);
  const requestContext = workerRequestContexts.get(workerKey) ?? createEmptyRequestContext();
  const runtime = asRecord(asRecord(response.analysis)?.runtime);
  const executionProvider = asString(runtime?.executionProvider) ?? requestContext.executionProvider;
  const selectionSource = asString(runtime?.selectionSource) ?? requestContext.selectionSource;
  const idSuffix = descriptor.id === "shared-buff-slot-parser"
    ? `:${executionProvider ?? "unknown"}:${selectionSource ?? "unknown"}`
    : "";
  const pipelineId = `${descriptor.id}${idSuffix}`;
  const pipeline = pipelineAccumulators.get(pipelineId) ?? {
    id: pipelineId,
    label: formatPipelineLabel(descriptor.label, executionProvider, selectionSource),
    sampleCount: 0,
    lastSampledAt: new Date().toISOString(),
    metrics: new Map<string, MetricAccumulator>(),
    metadata: createEmptyMetadata(),
  };

  pipeline.sampleCount += 1;
  pipeline.lastSampledAt = new Date().toISOString();
  numericMetrics.forEach(([key, value]) => updateMetric(pipeline.metrics, key, value));
  pipeline.metadata = mergeMetadata(
    pipeline.metadata,
    response,
    performance,
    runtime,
    requestContext,
  );
  pipelineAccumulators.set(pipelineId, pipeline);
}

function extractPerformance(response: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asRecord(response.performance);
  if (direct) {
    return direct;
  }
  const result = asRecord(response.result);
  const nested = asRecord(result?.performance);
  if (nested) {
    return nested;
  }
  const inferenceMs = asRecord(result?.debug)?.inferenceMs;
  return typeof inferenceMs === "number" && Number.isFinite(inferenceMs)
    ? { inferenceMs }
    : null;
}

export function getRuntimePerformanceDiagnosticsSnapshot(): RuntimePerformanceDiagnosticsSnapshot {
  const pipelines = [...pipelineAccumulators.values()]
    .map(toPipelineSnapshot)
    .sort((left, right) => right.lastSampledAt.localeCompare(left.lastSampledAt));
  return {
    paused,
    totalSamples: pipelines.reduce((total, pipeline) => total + pipeline.sampleCount, 0),
    pipelines,
  };
}

export function setRuntimePerformanceDiagnosticsPaused(nextPaused: boolean): void {
  paused = nextPaused;
}

export function resetRuntimePerformanceDiagnostics(): void {
  pipelineAccumulators.clear();
  workerRequestContexts.clear();
}

function getPipelineDescriptor(scriptLabel: string): { id: string; label: string } {
  const descriptor = PIPELINE_DESCRIPTORS.find(({ pattern }) => pattern.test(scriptLabel));
  if (descriptor) {
    return descriptor;
  }
  return {
    id: normalizeWorkerId(scriptLabel),
    label: stripWorkerHash(scriptLabel),
  };
}

function normalizeWorkerId(scriptLabel: string): string {
  return stripWorkerHash(scriptLabel)
    .replace(/\.worker(?:\.js)?$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "worker";
}

function stripWorkerHash(scriptLabel: string): string {
  return scriptLabel.replace(/-[A-Za-z0-9_-]{6,}(?=\.js$)/, "");
}

function formatPipelineLabel(
  label: string,
  executionProvider: string | null,
  selectionSource: string | null,
): string {
  if (!executionProvider) {
    return label;
  }
  const sourceLabel = selectionSource === "benchmark" ? "benchmark" : selectionSource;
  return `${label} · ${executionProvider.toUpperCase()}${sourceLabel ? ` (${sourceLabel})` : ""}`;
}

function updateMetric(metrics: Map<string, MetricAccumulator>, key: string, value: number): void {
  const rounded = roundMs(value);
  const current = metrics.get(key) ?? {
    count: 0,
    total: 0,
    latest: rounded,
    max: rounded,
    recent: [],
  };
  current.count += 1;
  current.total += rounded;
  current.latest = rounded;
  current.max = Math.max(current.max, rounded);
  current.recent.push(rounded);
  if (current.recent.length > MAX_RECENT_METRIC_SAMPLES) {
    current.recent.splice(0, current.recent.length - MAX_RECENT_METRIC_SAMPLES);
  }
  metrics.set(key, current);
}

function toPipelineSnapshot(pipeline: PipelineAccumulator): RuntimePerformancePipelineSnapshot {
  return {
    id: pipeline.id,
    label: pipeline.label,
    sampleCount: pipeline.sampleCount,
    lastSampledAt: pipeline.lastSampledAt,
    metrics: [...pipeline.metrics.entries()]
      .map(([key, metric]) => ({
        key,
        label: METRIC_LABELS[key] ?? key,
        count: metric.count,
        latestMs: metric.latest,
        averageMs: roundMs(metric.total / Math.max(1, metric.count)),
        p95Ms: percentile(metric.recent, 0.95),
        maxMs: metric.max,
      }))
      .sort(compareMetrics),
    metadata: pipeline.metadata,
  };
}

function compareMetrics(
  left: RuntimePerformanceMetricSnapshot,
  right: RuntimePerformanceMetricSnapshot,
): number {
  const order = [
    "totalMs",
    "detectMs",
    "inferenceMs",
    "matchMs",
    "countdownMs",
    "remainingCountMs",
    "recognitionMs",
    "ocrMs",
    "queueWaitMs",
    "resultAgeMs",
  ];
  const leftIndex = order.indexOf(left.key);
  const rightIndex = order.indexOf(right.key);
  if (leftIndex < 0 && rightIndex < 0) {
    return left.label.localeCompare(right.label);
  }
  if (leftIndex < 0) {
    return 1;
  }
  if (rightIndex < 0) {
    return -1;
  }
  return leftIndex - rightIndex;
}

function percentile(values: number[], ratio: number): number {
  if (values.length <= 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function mergeMetadata(
  current: RuntimePerformancePipelineMetadata,
  response: Record<string, unknown>,
  performance: Record<string, unknown>,
  runtime: Record<string, unknown> | null,
  request: WorkerRequestContext,
): RuntimePerformancePipelineMetadata {
  const modelIds = new Set(current.modelIds);
  const parserVersion =
    asString(runtime?.parserVersion) ??
    asString(response.parserVersion) ??
    asString(asRecord(response.moduleVersions)?.parser) ??
    current.parserVersion;
  addModelId(modelIds, asString(runtime?.modelId));
  collectModuleVersions(modelIds, asRecord(response.moduleVersions));
  collectMatcherModels(modelIds, performance.matcherBundleStatuses);
  collectCandidateModels(modelIds, response.candidateIcons);

  const statuses = new Map(current.statuses.map(({ label, value }) => [label, value]));
  addStatus(statuses, "matcher", performance.matcherModelStatus);
  addStatus(statuses, "숫자", performance.countdownModelStatus);
  addStatus(statuses, "횟수", performance.remainingCountModelStatus);
  collectBundleStatuses(statuses, performance.matcherBundleStatuses);

  return {
    executionProvider: asString(runtime?.executionProvider) ?? request.executionProvider ?? current.executionProvider,
    selectionSource: asString(runtime?.selectionSource) ?? request.selectionSource ?? current.selectionSource,
    parserEngine: asString(response.parserEngine) ?? asString(asRecord(response.analysis)?.engine) ?? current.parserEngine,
    parserVersion,
    modelIds: [...modelIds].slice(0, 16),
    activeTargets: unique([...current.activeTargets, ...request.activeTargets]).slice(0, 16),
    statuses: [...statuses.entries()].map(([label, value]) => ({ label, value })),
  };
}

function collectRequestTargets(request: Record<string, unknown>): string[] {
  const targets = Array.isArray(request.targets)
    ? request.targets.flatMap((target) => {
        const value = asRecord(target);
        const id = asString(value?.skillId);
        const engine = asString(value?.matcherEngine);
        return id ? [`${id}${engine ? ` · ${engine}` : ""}`] : [];
      })
    : [];
  const groups = Array.isArray(request.activeGroups)
    ? request.activeGroups.filter((value): value is string => typeof value === "string")
    : [];
  return unique([...targets, ...groups]);
}

function collectModuleVersions(modelIds: Set<string>, versions: Record<string, unknown> | null): void {
  if (!versions) {
    return;
  }
  Object.entries(versions).forEach(([key, value]) => {
    if (typeof value === "string" && !["runtime", "parser"].includes(key)) {
      addModelId(modelIds, `${key}: ${value}`);
    }
  });
  if (Array.isArray(versions.matcherBundles)) {
    versions.matcherBundles.forEach((bundle) => {
      const entry = asRecord(bundle);
      const group = asString(entry?.group);
      const bundleId = asString(entry?.bundleId);
      const modelVersion = asString(entry?.modelVersion);
      addModelId(modelIds, formatModelId(group, bundleId, modelVersion));
    });
  }
}

function collectMatcherModels(modelIds: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((bundle) => {
    const entry = asRecord(bundle);
    addModelId(
      modelIds,
      formatModelId(
        asString(entry?.group),
        asString(entry?.bundleId),
        asString(entry?.modelVersion),
      ),
    );
  });
}

function collectCandidateModels(modelIds: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }
  value.slice(0, 24).forEach((candidate) => {
    const match = asRecord(asRecord(candidate)?.match);
    addModelId(
      modelIds,
      formatModelId(
        asString(match?.skillId) ?? asString(match?.targetId),
        asString(match?.bundleId) ?? asString(match?.matcherEngine),
        asString(match?.modelVersion),
      ),
    );
  });
}

function collectBundleStatuses(statuses: Map<string, string>, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((bundle) => {
    const entry = asRecord(bundle);
    const group = asString(entry?.group);
    const status = asString(entry?.status);
    if (group && status) {
      statuses.set(group, status);
    }
  });
}

function formatModelId(
  target: string | null,
  bundleId: string | null,
  modelVersion: string | null,
): string | null {
  const model = [bundleId, modelVersion].filter(Boolean).join(" @ ");
  if (!model) {
    return null;
  }
  return target ? `${target}: ${model}` : model;
}

function addStatus(statuses: Map<string, string>, label: string, value: unknown): void {
  const status = asString(value);
  if (status) {
    statuses.set(label, status);
  }
}

function addModelId(modelIds: Set<string>, value: string | null): void {
  if (value) {
    modelIds.add(value);
  }
}

function createEmptyRequestContext(): WorkerRequestContext {
  return {
    executionProvider: null,
    selectionSource: null,
    activeTargets: [],
  };
}

function createEmptyMetadata(): RuntimePerformancePipelineMetadata {
  return {
    executionProvider: null,
    selectionSource: null,
    parserEngine: null,
    parserVersion: null,
    modelIds: [],
    activeTargets: [],
    statuses: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
