import type {
  AlertIssueAffectedTarget,
  AlertIssueFeature,
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "./alertIssueScenario";

export const ALERT_REPORT_INCIDENT_SCHEMA = "maple-timer.report-incident";
export const ALERT_REPORT_INCIDENT_VERSION = 1;

export type AlertReportEvidenceSource =
  | "runtime-atomic"
  | "runtime-snapshot"
  | "report-capture"
  | "mixed";

export type AlertReportStateBinding =
  | "before-after"
  | "after-only"
  | "mixed"
  | "unavailable";

export type AlertReportIncidentJournalEntry = {
  id: string;
  feature: AlertIssueFeature;
  targetId: string | null;
  kind: "sample" | "decision" | "playback" | "lifecycle";
  occurredAt: number;
  frameId: string | null;
  cycleId: string | number | null;
  status: string | null;
  decision: string | null;
  value: string | number | boolean | null;
  configRevision: string | null;
  configuration: Record<string, unknown> | null;
  details: Record<string, unknown>;
};

export type AlertReportIncidentJournalSelection = {
  capturedAt: number;
  windowStartedAt: number;
  windowEndedAt: number;
  target: {
    feature: AlertIssueFeature;
    targetId: string | null;
  };
  entries: AlertReportIncidentJournalEntry[];
  /** Playback from other targets/features in the same retained window. */
  relatedPlaybackEntries?: AlertReportIncidentJournalEntry[];
};

export type AlertReportEvidenceReferenceKind =
  | keyof AlertReportIncident["completeness"]
  | "configuration"
  | "runtime";

export type AlertReportEvidenceReference = {
  id: string;
  kind: AlertReportEvidenceReferenceKind;
  paths: string[];
  capturedAt: number | null;
  frameId: string | null;
  cycleId: string | number | null;
  produced: boolean;
  producedPaths: string[];
  retained: boolean;
  retainedPaths: string[];
};

export type AlertReportIncident = {
  schema: typeof ALERT_REPORT_INCIDENT_SCHEMA;
  version: typeof ALERT_REPORT_INCIDENT_VERSION;
  id: string;
  feature: AlertIssueFeature;
  reason: string;
  scenario: AlertIssueScenario | null;
  scenarioLabel: string | null;
  occurrence: AlertIssueOccurrence | null;
  otherCategory: AlertIssueOtherCategory | null;
  otherCategoryLabel: string | null;
  affectedTarget: AlertIssueAffectedTarget | null;
  reportedAt: number;
  cycleId: string | number | null;
  evidence: {
    source: AlertReportEvidenceSource;
    sampledAt: number | null;
    ageMs: number | null;
    windowStartedAt: number | null;
    windowEndedAt: number | null;
    frameCount: number;
    stateBinding: AlertReportStateBinding;
    mediaCount: number;
  };
  completeness: {
    sourceImage: boolean;
    temporalTrace: boolean;
    stateBeforeAfter: boolean;
    decision: boolean;
    playback: boolean;
    affectedTarget: boolean;
  };
  journal: {
    policy: "recent-60s-events-v1" | "recent-60s-events-v2";
    status: "matched" | "current-snapshot" | "outside-retention" | "unavailable";
    capturedAt: number | null;
    windowStartedAt: number | null;
    windowEndedAt: number | null;
    selectedEventAt: number | null;
    entries: AlertReportIncidentJournalEntry[];
    relatedPlaybackEntries?: AlertReportIncidentJournalEntry[];
    coverage: {
      playbackLifecycleMonitored: boolean;
      playbackEventCount: number;
      relatedPlaybackEventCount?: number;
      lifecycleEventCount?: number;
    };
  };
  correlation: {
    frameIds: string[];
    cycleIds: Array<string | number>;
    playbackIds: string[];
    relatedPlaybackIds?: string[];
    configRevisions: string[];
  };
  evidenceManifest: {
    version: 1;
    references: AlertReportEvidenceReference[];
  };
};

export type AlertReportIncidentIssue = {
  reason: string;
  label: string;
  note?: string;
  incidentId?: string;
  scenario?: AlertIssueScenario;
  scenarioLabel?: string;
  occurrence?: AlertIssueOccurrence;
  affectedTarget?: AlertIssueAffectedTarget;
  otherCategory?: AlertIssueOtherCategory;
  otherCategoryLabel?: string;
};

export function createAlertReportIncident({
  feature,
  issue,
  submittedAt,
  evidence,
  cycleId = null,
  completeness,
  journal,
  evidenceReferences = [],
}: {
  feature: AlertIssueFeature;
  issue: AlertReportIncidentIssue;
  submittedAt: string;
  evidence: AlertReportIncident["evidence"];
  cycleId?: string | number | null;
  completeness: Omit<AlertReportIncident["completeness"], "affectedTarget"> & {
    affectedTarget?: boolean;
  };
  journal?: AlertReportIncident["journal"];
  evidenceReferences?: Array<
    Omit<
      AlertReportEvidenceReference,
      "produced" | "producedPaths" | "retained" | "retainedPaths"
    >
  >;
}): AlertReportIncident {
  const reportedAt = parseTimestamp(submittedAt) ?? Date.now();
  const sampledAt = normalizeTimestamp(evidence.sampledAt);
  return {
    schema: ALERT_REPORT_INCIDENT_SCHEMA,
    version: ALERT_REPORT_INCIDENT_VERSION,
    id:
      issue.incidentId ??
      `${feature}:${sampledAt ?? reportedAt}:${normalizeIncidentToken(issue.reason)}`,
    feature,
    reason: issue.reason,
    scenario: issue.scenario ?? null,
    scenarioLabel: issue.scenarioLabel ?? null,
    occurrence: issue.occurrence ?? null,
    otherCategory: issue.otherCategory ?? null,
    otherCategoryLabel: issue.otherCategoryLabel ?? null,
    affectedTarget: issue.affectedTarget ?? null,
    reportedAt,
    cycleId,
    evidence: {
      ...evidence,
      sampledAt,
      ageMs: sampledAt === null ? null : Math.max(0, reportedAt - sampledAt),
      windowStartedAt: normalizeTimestamp(evidence.windowStartedAt),
      windowEndedAt: normalizeTimestamp(evidence.windowEndedAt),
      frameCount: Math.max(0, Math.round(evidence.frameCount)),
      mediaCount: Math.max(0, Math.round(evidence.mediaCount)),
    },
    completeness: {
      ...completeness,
      affectedTarget: completeness.affectedTarget ?? Boolean(issue.affectedTarget),
    },
    journal: journal ?? {
      policy: "recent-60s-events-v2",
      status: "unavailable",
      capturedAt: null,
      windowStartedAt: null,
      windowEndedAt: null,
      selectedEventAt: null,
      entries: [],
      relatedPlaybackEntries: [],
      coverage: {
        playbackLifecycleMonitored: false,
        playbackEventCount: 0,
        relatedPlaybackEventCount: 0,
        lifecycleEventCount: 0,
      },
    },
    correlation: createIncidentCorrelation(
      journal?.entries ?? [],
      journal?.relatedPlaybackEntries ?? [],
      cycleId,
    ),
    evidenceManifest: {
      version: 1,
      references: evidenceReferences.map((reference) => ({
        ...reference,
        paths:
          reference.kind === "playback"
            ? unique([
                ...reference.paths,
                "incident.journal.coverage.playbackLifecycleMonitored",
              ])
            : reference.paths,
        produced: false,
        producedPaths: [],
        retained: false,
        retainedPaths: [],
      })),
    },
  };
}

export function reconcileAlertReportIncidentPayload<T>(payload: T): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const root = payload as Record<string, unknown>;
  const incident = root.incident;
  if (!incident || typeof incident !== "object" || Array.isArray(incident)) {
    return payload;
  }
  const typedIncident = incident as AlertReportIncident;
  if (typedIncident.schema !== ALERT_REPORT_INCIDENT_SCHEMA) {
    return payload;
  }

  const references = typedIncident.evidenceManifest?.references ?? [];
  for (const reference of references) {
    const retainedPaths = reference.paths.filter((path) =>
      isEvidenceReferencePresent(getByPath(root, path), reference.kind),
    );
    const previousProducedPaths = Array.isArray(reference.producedPaths)
      ? reference.producedPaths
      : reference.produced === true || reference.retained === true
        ? (reference.retainedPaths ?? [])
        : [];
    reference.producedPaths = unique([
      ...previousProducedPaths,
      ...retainedPaths,
    ]);
    reference.produced = reference.producedPaths.length > 0;
    reference.retainedPaths = retainedPaths;
    reference.retained = retainedPaths.length > 0;
  }

  const completenessKinds: Array<keyof AlertReportIncident["completeness"]> = [
    "sourceImage",
    "temporalTrace",
    "stateBeforeAfter",
    "decision",
    "playback",
  ];
  for (const kind of completenessKinds) {
    const matching = references.filter((reference) => reference.kind === kind);
    if (matching.length > 0) {
      typedIncident.completeness[kind] = matching.some((reference) => reference.retained);
    }
  }
  typedIncident.completeness.affectedTarget =
    typedIncident.completeness.affectedTarget || Boolean(typedIncident.affectedTarget);
  typedIncident.evidence.mediaCount = countImageDataUrls(root, "incident");
  return payload;
}

export function createAlertIssueIncidentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `incident-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeIncidentToken(value: string): string {
  return value.trim().replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function createIncidentCorrelation(
  entries: AlertReportIncidentJournalEntry[],
  relatedPlaybackEntries: AlertReportIncidentJournalEntry[],
  cycleId: string | number | null,
): AlertReportIncident["correlation"] {
  return {
    frameIds: unique(entries.map((entry) => entry.frameId)),
    cycleIds: unique([
      cycleId,
      ...entries.map((entry) => entry.cycleId),
    ]),
    playbackIds: unique(
      entries.filter((entry) => entry.kind === "playback").map((entry) => entry.id),
    ),
    relatedPlaybackIds: unique(relatedPlaybackEntries.map((entry) => entry.id)),
    configRevisions: unique(entries.map((entry) => entry.configRevision)),
  };
}

function unique<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];
}

function getByPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function isEvidenceReferencePresent(
  value: unknown,
  kind: AlertReportEvidenceReferenceKind,
): boolean {
  if (kind === "sourceImage") {
    return countImageDataUrls(value) > 0;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return value !== null && value !== undefined && value !== "";
}

function countImageDataUrls(value: unknown, skippedRootKey?: string): number {
  if (typeof value === "string") {
    return value.startsWith("data:image/") ? 1 : 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countImageDataUrls(entry), 0);
  }
  if (!value || typeof value !== "object") {
    return 0;
  }
  return Object.entries(value as Record<string, unknown>).reduce(
    (total, [key, entry]) =>
      key === skippedRootKey ? total : total + countImageDataUrls(entry),
    0,
  );
}
