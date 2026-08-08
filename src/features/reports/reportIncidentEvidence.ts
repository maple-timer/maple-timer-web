import {
  createAlertReportIncident,
  type AlertReportIncident,
  type AlertReportIncidentIssue,
  type AlertReportEvidenceReference,
} from "../../contracts/reporting/alertReportIncident";
import type { AlertIssueFeature } from "../../contracts/reporting/alertIssueScenario";
import {
  selectAlertIncidentJournalOccurrence,
  type AlertIncidentJournalOccurrenceSelection,
  type AlertIncidentJournalSelection,
} from "../../application/reporting/alertIncidentJournal";

export type ReportIncidentEvidenceInput = {
  feature: AlertIssueFeature;
  issue: AlertReportIncidentIssue;
  submittedAt: string;
  source: AlertReportIncident["evidence"]["source"];
  sampledAt: number | null;
  timestamps?: Array<number | null | undefined>;
  frameCount?: number;
  stateBinding: AlertReportIncident["evidence"]["stateBinding"];
  mediaCount?: number;
  cycleId?: string | number | null;
  journalSelection?: AlertIncidentJournalSelection | null;
  journalOccurrence?: AlertIncidentJournalOccurrenceSelection | null;
  evidenceReferences?: Array<
    Omit<
      AlertReportEvidenceReference,
      "produced" | "producedPaths" | "retained" | "retainedPaths"
    >
  >;
  completeness: Omit<AlertReportIncident["completeness"], "affectedTarget"> & {
    affectedTarget?: boolean;
  };
};

export function buildReportIncident({
  feature,
  issue,
  submittedAt,
  source,
  sampledAt,
  timestamps = [],
  frameCount,
  stateBinding,
  mediaCount = 0,
  cycleId = null,
  journalSelection = null,
  journalOccurrence = null,
  evidenceReferences = [],
  completeness,
}: ReportIncidentEvidenceInput): AlertReportIncident {
  const journal =
    journalOccurrence ??
    selectAlertIncidentJournalOccurrence(journalSelection, issue.occurrence);
  const journalEntries = journal.entries;
  const relatedPlaybackEntries = journal.relatedPlaybackEntries;
  const window = getEvidenceWindow([
    ...timestamps,
    ...journalEntries.map((entry) => entry.occurredAt),
  ]);
  const resolvedCycleId =
    cycleId ??
    [...journalEntries].reverse().find((entry) => entry.cycleId !== null)?.cycleId ??
    null;
  const playbackEventCount = journalEntries.filter(
    (entry) => entry.kind === "playback",
  ).length;
  const lifecycleEventCount = journalEntries.filter(
    (entry) => entry.kind === "lifecycle",
  ).length;
  const playbackLifecycleMonitored =
    journal.status === "matched" || journal.status === "current-snapshot";
  const hasJournalStateBeforeAfter = journalEntries.some(
    (entry) =>
      isRecord(entry.details.stateBefore) &&
      isRecord(entry.details.stateAfter),
  );
  const resolvedEvidenceReferences = evidenceReferences.map((reference) =>
    reference.kind === "stateBeforeAfter" && hasJournalStateBeforeAfter
      ? {
          ...reference,
          paths: uniqueStrings([
            ...reference.paths,
            "incident.journal.entries",
          ]),
        }
      : reference,
  );
  return createAlertReportIncident({
    feature,
    issue,
    submittedAt,
    cycleId: resolvedCycleId,
    evidence: {
      source,
      sampledAt,
      ageMs: null,
      windowStartedAt: window.startedAt,
      windowEndedAt: window.endedAt,
      frameCount: frameCount ?? window.frameCount,
      stateBinding:
        hasJournalStateBeforeAfter &&
        (stateBinding === "after-only" || stateBinding === "unavailable")
          ? "before-after"
          : stateBinding,
      mediaCount,
    },
    completeness: {
      ...completeness,
      stateBeforeAfter:
        completeness.stateBeforeAfter || hasJournalStateBeforeAfter,
      temporalTrace: completeness.temporalTrace || journalEntries.length > 1,
      decision:
        completeness.decision ||
        journalEntries.some((entry) => entry.kind === "decision"),
      playback:
        completeness.playback ||
        journalEntries.some((entry) => entry.kind === "playback") ||
        playbackLifecycleMonitored,
    },
    journal: {
      policy: "recent-60s-events-v2",
      status: journal.status,
      capturedAt: journalSelection?.capturedAt ?? null,
      windowStartedAt: journalSelection?.windowStartedAt ?? null,
      windowEndedAt: journalSelection?.windowEndedAt ?? null,
      selectedEventAt: journal.selectedEventAt,
      entries: journalEntries,
      relatedPlaybackEntries,
      coverage: {
        playbackLifecycleMonitored,
        playbackEventCount,
        relatedPlaybackEventCount: relatedPlaybackEntries.length,
        lifecycleEventCount,
      },
    },
    evidenceReferences: resolvedEvidenceReferences,
  });
}

export function countPresentReportMedia(
  ...values: Array<string | null | undefined>
): number {
  return values.reduce((count, value) => count + (isDataUrl(value) ? 1 : 0), 0);
}

export function createReportEvidenceReference({
  id,
  kind,
  paths,
  capturedAt = null,
  frameId = null,
  cycleId = null,
}: Omit<
  AlertReportEvidenceReference,
  "produced" | "producedPaths" | "retained" | "retainedPaths"
>) {
  return { id, kind, paths, capturedAt, frameId, cycleId };
}

function getEvidenceWindow(timestamps: Array<number | null | undefined>) {
  const valid = timestamps.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (valid.length === 0) {
    return { startedAt: null, endedAt: null, frameCount: 0 };
  }
  return {
    startedAt: Math.min(...valid),
    endedAt: Math.max(...valid),
    frameCount: valid.length,
  };
}

function isDataUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("data:image/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
