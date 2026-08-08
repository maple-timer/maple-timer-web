import type {
  AlertIssueOccurrence,
  AlertIssueScenario,
} from "../../contracts/reporting/alertIssueScenario";
import {
  ALERT_INCIDENT_CURRENT_WINDOW_MS,
  type AlertIncidentJournalEntry,
  type AlertIncidentJournalSelection,
} from "../../application/reporting/alertIncidentJournal";

export type RuneReportIncidentSelection = {
  status: "matched" | "current-snapshot" | "outside-retention" | "unavailable";
  anchorKind: "frame" | "episode" | "attempt" | null;
  selectedEventAt: number | null;
  frameIds: string[];
  episodeIds: string[];
  cycleIds: Array<string | number>;
  candidateCount: number;
  sampleCount: number;
  ambiguous: boolean;
  entries: AlertIncidentJournalEntry[];
  relatedPlaybackEntries: AlertIncidentJournalEntry[];
};

type IncidentCandidate = {
  anchorKind: Exclude<RuneReportIncidentSelection["anchorKind"], null>;
  occurredAt: number;
  entries: AlertIncidentJournalEntry[];
  frameIds?: string[];
  episodeIds?: string[];
};

export type RuneReportRuntimeIncidentSelectionSource = {
  id: string;
  episodeId?: string | null;
  startedAt: number;
  lastSignalAt: number;
  frames: Array<{
    sampledAt: number;
    outcome: "detected" | "near-threshold" | "not-detected" | "error";
  }>;
};

export function selectRuneReportIncident({
  selection,
  scenario,
  occurrence,
  runtimeIncidents = [],
}: {
  selection: AlertIncidentJournalSelection | null | undefined;
  scenario: AlertIssueScenario | null | undefined;
  occurrence: AlertIssueOccurrence | null | undefined;
  runtimeIncidents?: RuneReportRuntimeIncidentSelectionSource[];
}): RuneReportIncidentSelection {
  if (!selection) {
    return emptySelection("unavailable");
  }
  if (occurrence === "historical") {
    return emptySelection("outside-retention");
  }

  const cutoff =
    occurrence === "current"
      ? selection.capturedAt - ALERT_INCIDENT_CURRENT_WINDOW_MS
      : selection.windowStartedAt;
  const entries = selectWindowEntries(selection.entries, cutoff, selection.capturedAt);
  const relatedPlaybackEntries = selectWindowEntries(
    selection.relatedPlaybackEntries ?? [],
    cutoff,
    selection.capturedAt,
  );
  const sampleCount = entries.filter(
    (entry) => entry.kind === "sample" || entry.kind === "decision",
  ).length;
  const candidates = createScenarioCandidates(entries, scenario, {
    occurrence,
    runtimeIncidents,
    cutoff,
    capturedAt: selection.capturedAt,
  });
  if (candidates.length === 0) {
    return {
      ...emptySelection("unavailable"),
      sampleCount,
      relatedPlaybackEntries,
    };
  }

  const selectedCandidates =
    scenario === "duplicate-alert" ? candidates.slice(-2) : candidates.slice(-1);
  const selectedEntries = uniqueEntries(
    selectedCandidates.flatMap((candidate) => candidate.entries),
  );
  const anchor = selectedCandidates[selectedCandidates.length - 1];

  return {
    status: occurrence === "current" ? "current-snapshot" : "matched",
    anchorKind: anchor.anchorKind,
    selectedEventAt: anchor.occurredAt,
    frameIds: uniqueValues(
      selectedCandidates.flatMap(
        (candidate) =>
          candidate.frameIds ?? candidate.entries.map((entry) => entry.frameId),
      ),
    ),
    episodeIds: uniqueValues(
      selectedCandidates.flatMap(
        (candidate) =>
          candidate.episodeIds ?? candidate.entries.map(getEpisodeId),
      ),
    ),
    cycleIds: uniqueValues(
      selectedCandidates.flatMap((candidate) =>
        candidate.entries.map((entry) => entry.cycleId),
      ),
    ),
    candidateCount: candidates.length,
    sampleCount,
    ambiguous: candidates.length > selectedCandidates.length,
    entries: selectedEntries,
    relatedPlaybackEntries,
  };
}

function createScenarioCandidates(
  entries: AlertIncidentJournalEntry[],
  scenario: AlertIssueScenario | null | undefined,
  {
    occurrence,
    runtimeIncidents,
    cutoff,
    capturedAt,
  }: {
    occurrence: AlertIssueOccurrence | null | undefined;
    runtimeIncidents: RuneReportRuntimeIncidentSelectionSource[];
    cutoff: number;
    capturedAt: number;
  },
): IncidentCandidate[] {
  if (scenario === "not-recognized") {
    const retainedIncidentCandidates = runtimeIncidents
      .filter(
        (incident) =>
          incident.startedAt <= capturedAt &&
          incident.lastSignalAt >= cutoff &&
          incident.lastSignalAt <= capturedAt &&
          isMissedRecognitionIncident(incident),
      )
      .map((incident) => {
        const frameIds = incident.frames.map((frame) =>
          createRuneRuntimeFrameId(frame.sampledAt),
        );
        const frameIdSet = new Set(frameIds);
        return {
          anchorKind: "frame" as const,
          occurredAt: incident.lastSignalAt,
          entries: entries.filter(
            (entry) => entry.frameId !== null && frameIdSet.has(entry.frameId),
          ),
          frameIds,
          // A low-score/error incident is frame-anchored. A stale episode ID
          // must not correlate it with a different accepted detection episode.
          episodeIds: [],
        };
      })
      .sort((left, right) => left.occurredAt - right.occurredAt);
    if (retainedIncidentCandidates.length > 0 || occurrence !== "current") {
      return retainedIncidentCandidates;
    }

    const latestNegative = [...entries]
      .reverse()
      .find((entry) => entry.kind === "sample" && entry.value !== true);
    return latestNegative
      ? [{
          anchorKind: "frame",
          occurredAt: latestNegative.occurredAt,
          entries: [latestNegative],
        }]
      : [];
  }

  const episodes = createEpisodeCandidates(entries);
  const attempts = createAttemptCandidates(entries, episodes);

  if (scenario === "recognized-no-alert") {
    return episodes.filter(
      (candidate) =>
        candidate.entries.some(
          (entry) => entry.kind === "sample" && entry.value === true,
        ) && !candidate.entries.some((entry) => entry.kind === "playback"),
    );
  }
  if (scenario === "playback-missing" || scenario === "unexpected-playback") {
    return attempts;
  }
  if (scenario === "repeat-missing") {
    const repeatCandidates = episodes.filter((candidate) =>
      candidate.entries.some(
        (entry) => entry.kind === "playback" && entry.decision === "initial",
      ),
    );
    return repeatCandidates.length > 0 ? repeatCandidates : attempts;
  }
  if (scenario === "wrong-target") {
    return attempts.length > 0 ? attempts : episodes;
  }
  if (scenario === "duplicate-alert") {
    return attempts;
  }

  const preferred =
    [...entries].reverse().find((entry) => entry.kind === "playback") ??
    [...entries].reverse().find((entry) => entry.kind === "decision") ??
    entries[entries.length - 1];
  return preferred
    ? [{ anchorKind: "frame", occurredAt: preferred.occurredAt, entries: [preferred] }]
    : [];
}

function createEpisodeCandidates(
  entries: AlertIncidentJournalEntry[],
): IncidentCandidate[] {
  const grouped = new Map<string, AlertIncidentJournalEntry[]>();
  entries.forEach((entry) => {
    const episodeId = getEpisodeId(entry);
    if (!episodeId) {
      return;
    }
    const group = grouped.get(episodeId) ?? [];
    group.push(entry);
    grouped.set(episodeId, group);
  });
  return [...grouped.values()]
    .map((group) => ({
      anchorKind: "episode" as const,
      occurredAt: Math.max(...group.map((entry) => entry.occurredAt)),
      entries: uniqueEntries(group),
    }))
    .sort((left, right) => left.occurredAt - right.occurredAt);
}

function createAttemptCandidates(
  entries: AlertIncidentJournalEntry[],
  episodes: IncidentCandidate[],
): IncidentCandidate[] {
  const grouped = new Map<string, AlertIncidentJournalEntry[]>();
  entries
    .filter((entry) => entry.kind === "playback" && entry.cycleId !== null)
    .forEach((entry) => {
      const key = String(entry.cycleId);
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    });

  return [...grouped.values()]
    .map((attemptEntries) => {
      const episodeIds = uniqueValues(attemptEntries.map(getEpisodeId));
      const episodeEntries = episodes
        .filter((candidate) =>
          candidate.entries.some((entry) => {
            const episodeId = getEpisodeId(entry);
            return episodeId !== null && episodeIds.includes(episodeId);
          }),
        )
        .flatMap((candidate) =>
          candidate.entries.filter((entry) => entry.kind !== "playback"),
        );
      return {
        anchorKind: "attempt" as const,
        occurredAt: Math.max(...attemptEntries.map((entry) => entry.occurredAt)),
        entries: uniqueEntries([...episodeEntries, ...attemptEntries]),
      };
    })
    .sort((left, right) => left.occurredAt - right.occurredAt);
}

function selectWindowEntries(
  entries: AlertIncidentJournalEntry[],
  cutoff: number,
  capturedAt: number,
) {
  return entries
    .filter((entry) => entry.occurredAt >= cutoff && entry.occurredAt <= capturedAt)
    .sort((left, right) => left.occurredAt - right.occurredAt);
}

function getEpisodeId(entry: AlertIncidentJournalEntry): string | null {
  const episodeId = entry.details?.episodeId;
  return typeof episodeId === "string" && episodeId ? episodeId : null;
}

function uniqueEntries(entries: AlertIncidentJournalEntry[]) {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort(
    (left, right) => left.occurredAt - right.occurredAt,
  );
}

function uniqueValues<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];
}

function emptySelection(
  status: RuneReportIncidentSelection["status"],
): RuneReportIncidentSelection {
  return {
    status,
    anchorKind: null,
    selectedEventAt: null,
    frameIds: [],
    episodeIds: [],
    cycleIds: [],
    candidateCount: 0,
    sampleCount: 0,
    ambiguous: false,
    entries: [],
    relatedPlaybackEntries: [],
  };
}

function isMissedRecognitionIncident(
  incident: RuneReportRuntimeIncidentSelectionSource,
) {
  const signalFrames = incident.frames.filter((frame) =>
    frame.outcome === "detected" ||
    frame.outcome === "near-threshold" ||
    frame.outcome === "error",
  );
  return (
    signalFrames.some(
      (frame) => frame.outcome === "near-threshold" || frame.outcome === "error",
    ) &&
    !signalFrames.some((frame) => frame.outcome === "detected")
  );
}

function createRuneRuntimeFrameId(sampledAt: number) {
  return `frame:${Math.round(sampledAt)}`;
}
