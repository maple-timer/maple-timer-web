import { readAlertReportContract } from "../../../../contracts/reporting/alertReportContract";
import type {
  NormalizedDebugSample,
  TroubleshooterFeature,
  TroubleshooterMetadata,
} from "./types";

export type UnknownRecord = Record<string, unknown>;

export function normalizeDebugSample(value: unknown): NormalizedDebugSample {
  const root = asRecord(value);
  const wrappedBody = asRecord(root.body);
  const body = Object.keys(wrappedBody).length > 0 ? wrappedBody : root;
  const kind = firstString(body.kind, asRecord(body.sample).kind) ?? "unknown";
  return {
    root,
    body,
    id: firstString(root.id, body.id, asRecord(body.sample).id) ?? "unknown",
    storedAt: readTimestamp(root.storedAt, root.createdAt),
    kind,
    reportContract: readAlertReportContract(body.reportContract),
    schemaVersion: firstNumber(body.schemaVersion),
    feature: detectTroubleshooterFeature(body, kind),
  };
}

export function buildTroubleshooterMetadata(
  sample: NormalizedDebugSample,
): TroubleshooterMetadata {
  const { body } = sample;
  const issue = asRecord(body.reportIssue);
  const incident = asRecord(body.incident);
  const appBuild = asRecord(body.appBuild);
  const diagnostics = asRecord(body.diagnostics);
  const capture = asRecord(diagnostics.capture);
  const captureSize = asRecord(capture.size);
  const frameSource = asRecord(capture.frameSource);
  const gameViewport = asRecord(frameSource.gameViewport);
  const viewport = asRecord(diagnostics.viewport);
  const branch = firstString(appBuild.branch);
  const commit = firstString(appBuild.shortCommit, appBuild.commitSha);
  const channel = firstString(appBuild.channel);

  return {
    sampleId: sample.id,
    kind: sample.kind,
    reportContract: sample.reportContract,
    schemaVersion: sample.schemaVersion,
    submittedAt: readTimestamp(body.submittedAt, body.createdAt),
    storedAt: sample.storedAt,
    issueReason:
      firstString(
        issue.reason,
        asRecord(body.buffExpiry).reportReason,
        asRecord(body.boosterExpiry).reportReason,
        asRecord(body.rune).reportReason,
        asRecord(body.huntStall).reportReason,
        asRecord(body.skill).reportReason,
        asRecord(body.specialCore).reportReason,
        asRecord(body.ultimaRaidEquipment).reportReason,
      ) ?? "unknown",
    issueLabel: firstString(issue.label) ?? "제보 사유 없음",
    issueOtherCategory: firstString(
      incident.otherCategory,
      issue.otherCategory,
    ),
    issueOtherCategoryLabel: firstString(
      incident.otherCategoryLabel,
      incident.otherCategory,
      issue.otherCategoryLabel,
      issue.otherCategory,
    ),
    incident: buildIncidentMetadata(incident, issue),
    sourceUrl: firstString(body.url) ?? "",
    appBuildLabel:
      [channel, branch && commit ? `${branch}@${commit.slice(0, 8)}` : branch ?? commit]
        .filter(Boolean)
        .join(" ") || "빌드 정보 없음",
    environmentLabel: formatEnvironment(channel, firstString(appBuild.runtimeHostname, body.url)),
    captureLabel: formatSize(captureSize.width, captureSize.height, firstString(capture.layoutKey)),
    frameSourceLabel: formatFrameSource(frameSource),
    gameViewportLabel: formatGameViewport(gameViewport),
    viewportLabel: formatSize(viewport.width, viewport.height),
  };
}

function formatFrameSource(frameSource: UnknownRecord): string {
  const coordinateSpace = firstString(frameSource.coordinateSpace);
  if (!coordinateSpace) {
    return "기록 없음 (이전 제보)";
  }
  const label =
    coordinateSpace === "game-viewport"
      ? "설정한 게임 영역"
      : coordinateSpace === "capture"
        ? "전체 공유 화면"
        : coordinateSpace;
  const layoutKey = firstString(frameSource.layoutKey);
  return layoutKey ? `${label} · ${layoutKey}` : label;
}

function formatGameViewport(gameViewport: UnknownRecord): string {
  const state = firstString(gameViewport.state);
  if (!state) {
    return "기록 없음 (이전 제보)";
  }
  const verification = firstString(gameViewport.verification);
  const verificationLabel =
    verification === "known-capture"
      ? "알려진 화면 자동 확인"
      : verification === "user-confirmed"
        ? "전체 화면 사용자 확인"
        : verification === "calibrated"
          ? "게임 영역 사용자 설정"
          : verification === "unverified"
            ? "게임 화면 미확인"
            : verification === "stale"
              ? "다시 설정 필요"
              : verification === "unavailable"
                ? "사용 불가"
                : null;
  const stateLabel =
    verificationLabel ??
    (state === "calibrated"
      ? "보정됨"
      : state === "stale"
        ? "다시 설정 필요"
        : state === "legacy-passthrough"
          ? "기존 전체 화면"
          : state);
  const resolution = asRecord(gameViewport.gameResolution);
  const region = asRecord(gameViewport.region);
  const revision = firstNumber(gameViewport.revision);
  const parts = [
    stateLabel,
    formatOptionalSize(resolution),
    formatPixelRegion(region),
    revision === null ? null : `r${Math.round(revision)}`,
  ].filter((value): value is string => Boolean(value));
  return parts.join(" · ");
}

function formatOptionalSize(size: UnknownRecord): string | null {
  const width = firstNumber(size.width);
  const height = firstNumber(size.height);
  return width !== null && height !== null
    ? `${Math.round(width)}x${Math.round(height)}`
    : null;
}

function formatPixelRegion(region: UnknownRecord): string | null {
  const x = firstNumber(region.x);
  const y = firstNumber(region.y);
  const width = firstNumber(region.width);
  const height = firstNumber(region.height);
  return x !== null && y !== null && width !== null && height !== null
    ? `(${Math.round(x)}, ${Math.round(y)}) ${Math.round(width)}x${Math.round(height)}`
    : null;
}

function buildIncidentMetadata(
  incident: UnknownRecord,
  issue: UnknownRecord,
): TroubleshooterMetadata["incident"] {
  const evidence = asRecord(incident.evidence);
  const completeness = asRecord(incident.completeness);
  const journal = asRecord(incident.journal);
  const relatedPlaybackEntries = asArray(journal.relatedPlaybackEntries);
  const correlation = asRecord(incident.correlation);
  const evidenceManifest = asRecord(incident.evidenceManifest);
  const evidenceReferences = asArray(evidenceManifest.references).map(asRecord);
  const producedEvidenceReferences = evidenceReferences.filter(isProducedEvidenceReference);
  const retainedEvidenceReferences = evidenceReferences.filter(
    (reference) => reference.retained === true,
  );
  const droppedEvidenceReferences = producedEvidenceReferences.filter(
    (reference) => reference.retained !== true,
  );
  const unavailableEvidenceReferences = evidenceReferences.filter(
    (reference) => !isProducedEvidenceReference(reference),
  );
  const affectedTarget = asRecord(incident.affectedTarget ?? issue.affectedTarget);
  const id = firstString(incident.id, issue.incidentId);
  if (!id) {
    return null;
  }
  return {
    id,
    scenario: firstString(incident.scenario, issue.scenario),
    scenarioLabel: firstString(incident.scenarioLabel, issue.scenarioLabel),
    occurrence: firstString(incident.occurrence, issue.occurrence),
    affectedTargetLabel: firstString(affectedTarget.label, affectedTarget.id),
    evidenceSource: firstString(evidence.source),
    sampledAt: readTimestamp(evidence.sampledAt),
    ageMs: firstNumber(evidence.ageMs),
    windowStartedAt: readTimestamp(evidence.windowStartedAt),
    windowEndedAt: readTimestamp(evidence.windowEndedAt),
    frameCount: firstNumber(evidence.frameCount) ?? 0,
    mediaCount: firstNumber(evidence.mediaCount) ?? 0,
    stateBinding: firstString(evidence.stateBinding),
    completeness: Object.fromEntries(
      Object.entries(completeness)
        .filter(([, value]) => typeof value === "boolean")
        .map(([key, value]) => [key, value === true]),
    ),
    journalStatus: firstString(journal.status),
    journalCapturedAt: readTimestamp(journal.capturedAt),
    journalEntryCount: asArray(journal.entries).length,
    journalLifecycleEntryCount: asArray(journal.entries).filter(
      (entry) => asRecord(entry).kind === "lifecycle",
    ).length,
    relatedPlaybackEntryCount: relatedPlaybackEntries.length,
    journalSelectedEventAt: readTimestamp(journal.selectedEventAt),
    correlation: {
      frameCount: asArray(correlation.frameIds).length,
      cycleCount: asArray(correlation.cycleIds).length,
      playbackCount: asArray(correlation.playbackIds).length,
      relatedPlaybackCount:
        asArray(correlation.relatedPlaybackIds).length || relatedPlaybackEntries.length,
      configRevisionCount: asArray(correlation.configRevisions).length,
    },
    evidenceManifest: {
      referenceCount: evidenceReferences.length,
      producedReferenceCount: producedEvidenceReferences.length,
      retainedReferenceCount: retainedEvidenceReferences.length,
      missingReferenceIds: evidenceReferences
        .filter((reference) => reference.retained !== true)
        .map((reference) => firstString(reference.id))
        .filter((value): value is string => Boolean(value)),
      droppedReferenceIds: droppedEvidenceReferences
        .map((reference) => firstString(reference.id))
        .filter((value): value is string => Boolean(value)),
      unavailableReferenceIds: unavailableEvidenceReferences
        .map((reference) => firstString(reference.id))
        .filter((value): value is string => Boolean(value)),
    },
  };
}

function isProducedEvidenceReference(reference: UnknownRecord): boolean {
  if (reference.produced === true) {
    return true;
  }
  return !("produced" in reference) && reference.retained === true;
}

export function detectTroubleshooterFeature(
  body: UnknownRecord,
  kind = String(body.kind ?? ""),
): TroubleshooterFeature {
  if (body.specialCore || /special-core/i.test(kind)) return "special-core";
  if (body.buffExpiry || /buff-expiry/i.test(kind)) return "buff-expiry";
  if (body.boosterExpiry || /booster-expiry/i.test(kind)) return "booster-expiry";
  if (body.huntStall || /hunt-stall/i.test(kind)) return "hunt-stall";
  if (body.rune || /^rune(?:-|$)/i.test(kind)) return "rune";
  if (
    body.ultimaRaidEquipment ||
    /ultima-raid-equipment/i.test(kind)
  ) {
    return "ultima-raid-equipment";
  }
  if (body.skill || /skill/i.test(kind)) return "skill";
  return "unknown";
}

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function readTimestamp(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function getByPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (Array.isArray(current)) {
      const index = Number(key);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    return asRecord(current)[key];
  }, root);
}

export function formatCount(value: unknown, suffix = "개"): string {
  return `${Math.max(0, Math.round(firstNumber(value) ?? 0))}${suffix}`;
}

export function formatSeconds(value: unknown): string {
  const numeric = firstNumber(value);
  return numeric === null ? "없음" : `${Math.round(numeric)}초`;
}

export function formatMilliseconds(value: unknown): string {
  const numeric = firstNumber(value);
  return numeric === null ? "없음" : `${Math.round(numeric * 10) / 10}ms`;
}

export function formatPrecisionParserExecutionProvider(value: unknown): string {
  const provider = firstString(value);
  if (provider === "webgpu") return "GPU (WebGPU)";
  if (provider === "wasm") return "CPU (WASM)";
  if (provider === "remote") return "원격 서버";
  return provider ?? "미기록";
}

export function formatScore(value: unknown): string {
  const numeric = firstNumber(value);
  return numeric === null ? "없음" : numeric.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatConfidence(value: unknown): string {
  const numeric = firstNumber(value);
  if (numeric === null) return "없음";
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return `${Math.round(percent)}%`;
}

export function formatTimestamp(value: unknown): string {
  const timestamp = readTimestamp(value);
  if (timestamp === null) return "없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatSize(width: unknown, height: unknown, fallback?: string | null) {
  const numericWidth = firstNumber(width);
  const numericHeight = firstNumber(height);
  if (numericWidth !== null && numericHeight !== null) {
    return `${Math.round(numericWidth)}x${Math.round(numericHeight)}`;
  }
  return fallback ?? "없음";
}

function formatEnvironment(channel: string | null, source: string | null) {
  if (channel === "production" || source?.includes("maple-timer.com")) return "프로덕션";
  if (channel === "preview" || source?.includes("pages.dev")) return "프리뷰";
  return channel ?? "환경 정보 없음";
}
