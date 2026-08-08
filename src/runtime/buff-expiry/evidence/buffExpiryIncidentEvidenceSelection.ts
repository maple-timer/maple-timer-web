import type {
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import {
  isBuffExpiryTargetGroup,
  type BuffExpiryTargetGroup,
} from "../../../contracts/recognition/buffExpiryRecognition";
import { BUFF_EXPIRY_INCIDENT_CURRENT_WINDOW_MS } from "./buffExpiryIncidentEvidenceArchive";
import type {
  BuffExpiryIncidentCycle,
  BuffExpiryIncidentEpisode,
  BuffExpiryIncidentEvidenceOmissionReason,
  BuffExpiryIncidentFrame,
  BuffExpiryIncidentObservation,
  BuffExpiryIncidentPlaybackAttempt,
  FrozenBuffExpiryIncidentEvidence,
} from "./buffExpiryIncidentEvidenceTypes";

export type BuffExpiryReportIncidentSelection = {
  policy: "buff-expiry-scenario-selection-v1";
  status: "matched" | "current-snapshot" | "outside-retention" | "unavailable";
  support: "definitive" | "partial" | "unsupported";
  anchorKind:
    | "frame"
    | "observation"
    | "episode"
    | "cycle"
    | "attempt"
    | "event"
    | "configuration"
    | "state"
    | null;
  selectedEventAt: number | null;
  affectedGroup: BuffExpiryTargetGroup | null;
  candidateIds: string[];
  frameIds: string[];
  observationIds: string[];
  episodeIds: string[];
  cycleIds: string[];
  attemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
  mediaFrameIds: string[];
  ambiguous: boolean;
  degradationReasons: BuffExpiryIncidentEvidenceOmissionReason[];
};

type IncidentCandidate = {
  id: string;
  anchorKind: Exclude<BuffExpiryReportIncidentSelection["anchorKind"], null>;
  occurredAt: number;
  groups: BuffExpiryTargetGroup[];
  frameIds: string[];
  observationIds: string[];
  episodeIds: string[];
  cycleIds: string[];
  attemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
};

export function selectBuffExpiryReportIncident({
  evidence,
  reason,
  scenario,
  occurrence,
  affectedTargetId,
  otherCategory = null,
}: {
  evidence: FrozenBuffExpiryIncidentEvidence | null | undefined;
  reason: string;
  scenario: AlertIssueScenario | null | undefined;
  occurrence: AlertIssueOccurrence | null | undefined;
  affectedTargetId: string | null | undefined;
  otherCategory?: AlertIssueOtherCategory | null;
}): BuffExpiryReportIncidentSelection {
  if (!evidence) {
    return emptySelection("unavailable", "never-produced");
  }
  if (occurrence === "historical") {
    return emptySelection("outside-retention", "outside-retention");
  }

  const affectedGroup =
    typeof affectedTargetId === "string" &&
    isBuffExpiryTargetGroup(affectedTargetId)
    ? affectedTargetId
    : null;
  const cutoff =
    occurrence === "current"
      ? evidence.frozenAt - BUFF_EXPIRY_INCIDENT_CURRENT_WINDOW_MS
      : evidence.frozenAt - 60_000;
  const context = createSelectionContext(evidence, cutoff, affectedGroup);
  const candidates = createScenarioCandidates({
    context,
    reason,
    scenario,
    otherCategory,
  })
    .filter((candidate) => isCandidateForGroup(candidate, affectedGroup))
    .sort(
      (left, right) =>
        left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
    );

  if (candidates.length === 0) {
    return {
      ...emptySelection("unavailable", "never-produced"),
      affectedGroup,
    };
  }

  const selectedCandidates = selectLatestCompatibleCandidates(
    candidates,
    scenario,
  );
  const selected = mergeCandidates(selectedCandidates);
  const retainedMedia = new Set(evidence.media.map((entry) => entry.frameId));
  const mediaFrameIds = selected.frameIds.filter((id) => retainedMedia.has(id));
  const ambiguity = hasTargetAmbiguity({
    candidates,
    selectedCandidates,
    scenario,
    affectedGroup,
  });
  const degradationReasons = getDegradationReasons({
    evidence,
    scenario,
    reason,
    selected,
    selectedCandidates,
    mediaFrameIds,
    ambiguity,
  });

  return {
    policy: "buff-expiry-scenario-selection-v1",
    status: occurrence === "current" ? "current-snapshot" : "matched",
    support:
      degradationReasons.length > 0
        ? "partial"
        : "definitive",
    anchorKind: selectedCandidates[selectedCandidates.length - 1]?.anchorKind ?? null,
    selectedEventAt:
      selectedCandidates[selectedCandidates.length - 1]?.occurredAt ?? null,
    affectedGroup,
    candidateIds: candidates.map((entry) => entry.id),
    frameIds: selected.frameIds,
    observationIds: selected.observationIds,
    episodeIds: selected.episodeIds,
    cycleIds: selected.cycleIds,
    attemptIds: selected.attemptIds,
    eventIds: selected.eventIds,
    configurationRevisionIds: selected.configurationRevisionIds,
    mediaFrameIds,
    ambiguous: ambiguity,
    degradationReasons,
  };
}

function createSelectionContext(
  evidence: FrozenBuffExpiryIncidentEvidence,
  cutoff: number,
  affectedGroup: BuffExpiryTargetGroup | null,
) {
  const frames = evidence.frames.filter(
    (frame) =>
      frame.epochId === evidence.epoch.id &&
      frame.source !== "report-time" &&
      frame.sampledAt >= cutoff &&
      frame.sampledAt <= evidence.frozenAt,
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  const observations = evidence.observations.filter(
    (entry) =>
      frameIds.has(entry.frameId) &&
      entry.sampledAt >= cutoff &&
      entry.sampledAt <= evidence.frozenAt &&
      (!affectedGroup || entry.group === affectedGroup),
  );
  const episodes = evidence.episodes.filter(
    (entry) =>
      entry.epochId === evidence.epoch.id &&
      (entry.lastEventAt >= cutoff ||
        (entry.status !== "terminal" &&
          Boolean(
            evidence.frozenState?.activeEpisodeIds.includes(entry.id) ||
              evidence.frozenState?.pendingEpisodeIds.includes(entry.id),
          ))) &&
      entry.lastEventAt <= evidence.frozenAt &&
      (!affectedGroup || entry.group === affectedGroup),
  );
  const episodeIds = new Set(episodes.map((entry) => entry.id));
  const cycles = evidence.cycles.filter(
    (entry) =>
      entry.epochId === evidence.epoch.id &&
      (entry.updatedAt >= cutoff ||
        ((entry.status === "registered" || entry.status === "rescheduled") &&
          Boolean(evidence.frozenState?.scheduledCycleIds.includes(entry.id)))) &&
      entry.updatedAt <= evidence.frozenAt &&
      entry.episodeIds.some((id) => episodeIds.has(id)),
  );
  const cycleIds = new Set(cycles.map((entry) => entry.id));
  const attempts = evidence.attempts.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      entry.requestedAt >= cutoff &&
      entry.requestedAt <= evidence.frozenAt,
  );
  const runtimeEvents = evidence.runtimeEvents.filter(
    (entry) =>
      entry.epochId === evidence.epoch.id &&
      entry.occurredAt >= cutoff &&
      entry.occurredAt <= evidence.frozenAt &&
      (!affectedGroup ||
        !entry.episodeId ||
        episodeIds.has(entry.episodeId)),
  );
  return {
    evidence,
    frames,
    observations,
    episodes,
    cycles,
    attempts,
    runtimeEvents,
  };
}

function createScenarioCandidates({
  context,
  reason,
  scenario,
  otherCategory,
}: {
  context: ReturnType<typeof createSelectionContext>;
  reason: string;
  scenario: AlertIssueScenario | null | undefined;
  otherCategory: AlertIssueOtherCategory | null;
}): IncidentCandidate[] {
  if (scenario === "not-recognized") {
    return createNegativeFrameCandidates(context);
  }
  if (scenario === "wrong-value") {
    return createWrongValueCandidates(context);
  }
  if (scenario === "unstable-value") {
    return createUnstableValueCandidates(context);
  }
  if (scenario === "recognized-no-alert") {
    return createRecognizedWithoutAlertCandidates(context);
  }
  if (scenario === "playback-missing") {
    return createPlaybackMissingCandidates(context);
  }
  if (scenario === "wrong-target") {
    return reason === "buff-expiry-false-alert"
      ? createFiredCycleCandidates(context)
      : createObservationCandidates(context.observations, context);
  }
  if (scenario === "duplicate-alert") {
    return createPlaybackCandidates(
      context.attempts.filter((entry) => entry.status === "started"),
      context,
    );
  }
  if (scenario === "unexpected-playback") {
    return createPlaybackCandidates(
      context.attempts.filter((entry) => entry.status === "started"),
      context,
    );
  }
  if (scenario === "other") {
    return createOtherCategoryCandidates(context, otherCategory);
  }
  return createFallbackCandidates(context);
}

function createNegativeFrameCandidates(
  context: ReturnType<typeof createSelectionContext>,
) {
  return context.frames
    .filter((frame) => {
      const observations = context.observations.filter(
        (entry) => entry.frameId === frame.id,
      );
      return Boolean(frame.runtimeFailure) || !observations.some((entry) => entry.targetAccepted);
    })
    .map((frame) => frameCandidate(frame, context));
}

function createWrongValueCandidates(
  context: ReturnType<typeof createSelectionContext>,
) {
  const observations = context.observations.filter(
    (entry) =>
      entry.targetAccepted &&
      (!entry.countdown || entry.countdown.decision !== "accepted"),
  );
  return groupObservationCandidatesByEpisode(observations, context);
}

function createUnstableValueCandidates(
  context: ReturnType<typeof createSelectionContext>,
) {
  return context.episodes
    .filter((episode) => {
      const transitions = context.evidence.transitions.filter(
        (entry) => entry.episodeId === episode.id,
      );
      const values = transitions.filter(
        (entry) => entry.countdownSeconds !== null,
      );
      return (
        values.length >= 2 ||
        transitions.some((entry) => entry.kind === "countdown-rejected")
      );
    })
    .map((episode) => episodeCandidate(episode, context));
}

function createRecognizedWithoutAlertCandidates(
  context: ReturnType<typeof createSelectionContext>,
) {
  return context.episodes
    .filter(
      (episode) =>
        episode.confirmedAt !== null &&
        !context.cycles.some(
          (cycle) =>
            cycle.episodeIds.includes(episode.id) && cycle.status === "fired",
        ),
    )
    .map((episode) => episodeCandidate(episode, context));
}

function createPlaybackMissingCandidates(
  context: ReturnType<typeof createSelectionContext>,
) {
  const firedCycles = context.cycles.filter((entry) => entry.status === "fired");
  return firedCycles.map((cycle) => cycleCandidate(cycle, context));
}

function createFiredCycleCandidates(
  context: ReturnType<typeof createSelectionContext>,
) {
  return context.cycles
    .filter((entry) => entry.status === "fired")
    .map((entry) => cycleCandidate(entry, context));
}

function createOtherCategoryCandidates(
  context: ReturnType<typeof createSelectionContext>,
  category: AlertIssueOtherCategory | null,
): IncidentCandidate[] {
  if (category === "status-display" && context.evidence.frozenState) {
    return [
      {
        ...emptyCandidate("state:frozen", "state", context.evidence.frozenAt),
        episodeIds: [
          ...context.evidence.frozenState.activeEpisodeIds,
          ...context.evidence.frozenState.pendingEpisodeIds,
        ],
        cycleIds: context.evidence.frozenState.scheduledCycleIds,
        configurationRevisionIds: context.evidence.frozenState.configRevision
          ? [context.evidence.frozenState.configRevision]
          : [],
      },
    ];
  }
  if (category === "sound-volume") {
    return createPlaybackCandidates(context.attempts, context);
  }
  if (category === "settings-preset") {
    return context.runtimeEvents
      .filter((entry) => entry.category === "configuration")
      .map((entry) => eventCandidate(entry, "configuration"));
  }
  if (category === "performance-error") {
    return [
      ...context.frames
        .filter((entry) => Boolean(entry.runtimeFailure))
        .map((entry) => frameCandidate(entry, context)),
      ...context.runtimeEvents
        .filter((entry) => entry.category === "runtime-error")
        .map((entry) => eventCandidate(entry, "event")),
    ];
  }
  if (category === "interaction") {
    return context.runtimeEvents
      .filter(
        (entry) =>
          entry.category === "interaction" || entry.category === "lifecycle",
      )
      .map((entry) => eventCandidate(entry, "event"));
  }
  return createFallbackCandidates(context);
}

function createFallbackCandidates(
  context: ReturnType<typeof createSelectionContext>,
) {
  return [
    ...context.runtimeEvents.map((entry) => eventCandidate(entry, "event")),
    ...context.attempts.map((entry) => attemptCandidate(entry, context)),
    ...context.episodes.map((entry) => episodeCandidate(entry, context)),
    ...context.frames.map((entry) => frameCandidate(entry, context)),
  ];
}

function groupObservationCandidatesByEpisode(
  observations: BuffExpiryIncidentObservation[],
  context: ReturnType<typeof createSelectionContext>,
) {
  const grouped = new Map<string, BuffExpiryIncidentObservation[]>();
  for (const observation of observations) {
    const key = observation.episodeId ?? observation.id;
    const entries = grouped.get(key) ?? [];
    entries.push(observation);
    grouped.set(key, entries);
  }
  return [...grouped.values()].map((entries) =>
    mergeCandidates(entries.map((entry) => observationCandidate(entry, context))),
  );
}

function createObservationCandidates(
  observations: BuffExpiryIncidentObservation[],
  context: ReturnType<typeof createSelectionContext>,
) {
  return groupObservationCandidatesByEpisode(
    observations.filter((entry) => entry.targetAccepted),
    context,
  );
}

function createPlaybackCandidates(
  attempts: BuffExpiryIncidentPlaybackAttempt[],
  context: ReturnType<typeof createSelectionContext>,
) {
  return attempts.map((entry) => attemptCandidate(entry, context));
}

function frameCandidate(
  frame: BuffExpiryIncidentFrame,
  context: ReturnType<typeof createSelectionContext>,
): IncidentCandidate {
  const observations = context.observations.filter(
    (entry) => entry.frameId === frame.id,
  );
  return {
    ...emptyCandidate(frame.id, "frame", frame.sampledAt),
    groups: unique([
      ...frame.selectedGroups,
      ...observations.map((entry) => entry.group),
    ]),
    frameIds: [frame.id],
    observationIds: observations.map((entry) => entry.id),
    episodeIds: unique(
      observations.flatMap((entry) => (entry.episodeId ? [entry.episodeId] : [])),
    ),
  };
}

function observationCandidate(
  observation: BuffExpiryIncidentObservation,
  context: ReturnType<typeof createSelectionContext>,
): IncidentCandidate {
  const episode = observation.episodeId
    ? context.episodes.find((entry) => entry.id === observation.episodeId)
    : null;
  return {
    ...emptyCandidate(observation.id, "observation", observation.sampledAt),
    groups: [observation.group],
    frameIds: [observation.frameId],
    observationIds: [observation.id],
    episodeIds: episode ? [episode.id] : [],
    cycleIds: episode?.cycleIds ?? [],
  };
}

function episodeCandidate(
  episode: BuffExpiryIncidentEpisode,
  context: ReturnType<typeof createSelectionContext>,
): IncidentCandidate {
  const observations = context.observations.filter(
    (entry) =>
      entry.episodeId === episode.id || episode.observationIds.includes(entry.id),
  );
  const cycles = context.cycles.filter((entry) =>
    entry.episodeIds.includes(episode.id),
  );
  const attempts = context.attempts.filter((entry) =>
    cycles.some((cycle) => cycle.id === entry.cycleId),
  );
  return {
    ...emptyCandidate(episode.id, "episode", episode.lastEventAt),
    groups: [episode.group],
    frameIds: unique(observations.map((entry) => entry.frameId)),
    observationIds: observations.map((entry) => entry.id),
    episodeIds: [episode.id],
    cycleIds: cycles.map((entry) => entry.id),
    attemptIds: attempts.map((entry) => entry.id),
    configurationRevisionIds: unique(
      cycles.map((entry) => entry.configRevision),
    ),
  };
}

function cycleCandidate(
  cycle: BuffExpiryIncidentCycle,
  context: ReturnType<typeof createSelectionContext>,
): IncidentCandidate {
  const episodes = context.episodes.filter((entry) =>
    cycle.episodeIds.includes(entry.id),
  );
  const observations = context.observations.filter((entry) =>
    episodes.some((episode) => episode.id === entry.episodeId),
  );
  const attempts = context.attempts.filter(
    (entry) => entry.cycleId === cycle.id,
  );
  const events = context.evidence.cycleEvents.filter(
    (entry) => entry.cycleId === cycle.id,
  );
  return {
    ...emptyCandidate(cycle.id, "cycle", cycle.updatedAt),
    groups: unique(episodes.map((entry) => entry.group)),
    frameIds: unique([
      ...observations.map((entry) => entry.frameId),
      ...events.flatMap((entry) => (entry.frameId ? [entry.frameId] : [])),
    ]),
    observationIds: observations.map((entry) => entry.id),
    episodeIds: episodes.map((entry) => entry.id),
    cycleIds: [cycle.id],
    attemptIds: attempts.map((entry) => entry.id),
    configurationRevisionIds: [cycle.configRevision],
  };
}

function attemptCandidate(
  attempt: BuffExpiryIncidentPlaybackAttempt,
  context: ReturnType<typeof createSelectionContext>,
): IncidentCandidate {
  const cycle = context.cycles.find((entry) => entry.id === attempt.cycleId);
  if (!cycle) {
    return {
      ...emptyCandidate(attempt.id, "attempt", attempt.requestedAt),
      attemptIds: [attempt.id],
      cycleIds: [attempt.cycleId],
    };
  }
  const candidate = cycleCandidate(cycle, context);
  return {
    ...candidate,
    id: attempt.id,
    anchorKind: "attempt",
    occurredAt: attempt.requestedAt,
    attemptIds: unique([...candidate.attemptIds, attempt.id]),
  };
}

function eventCandidate(
  event: ReturnType<typeof createSelectionContext>["runtimeEvents"][number],
  anchorKind: "event" | "configuration",
): IncidentCandidate {
  return {
    ...emptyCandidate(event.id, anchorKind, event.occurredAt),
    frameIds: event.frameId ? [event.frameId] : [],
    episodeIds: event.episodeId ? [event.episodeId] : [],
    cycleIds: event.cycleId ? [event.cycleId] : [],
    eventIds: [event.id],
    configurationRevisionIds: event.configRevision
      ? [event.configRevision]
      : [],
  };
}

function selectLatestCompatibleCandidates(
  candidates: IncidentCandidate[],
  scenario: AlertIssueScenario | null | undefined,
) {
  if (scenario !== "duplicate-alert") {
    return candidates.slice(-1);
  }
  const latest = candidates[candidates.length - 1];
  if (!latest) {
    return [];
  }
  const latestGroup = latest.groups[0] ?? null;
  const compatible = latestGroup
    ? candidates.filter((entry) => entry.groups.includes(latestGroup))
    : candidates;
  return compatible.slice(-2);
}

function hasTargetAmbiguity({
  candidates,
  selectedCandidates,
  scenario,
  affectedGroup,
}: {
  candidates: IncidentCandidate[];
  selectedCandidates: IncidentCandidate[];
  scenario: AlertIssueScenario | null | undefined;
  affectedGroup: BuffExpiryTargetGroup | null;
}) {
  if (scenario === "duplicate-alert") {
    return candidates.length > selectedCandidates.length;
  }
  const episodeOrCycleCandidates = candidates.filter(
    (entry) => entry.episodeIds.length > 0 || entry.cycleIds.length > 0,
  );
  if (episodeOrCycleCandidates.length <= 1) {
    return false;
  }
  if (affectedGroup === "potion" || affectedGroup === null) {
    const lineages = new Set(
      episodeOrCycleCandidates.map((entry) =>
        entry.episodeIds.length
          ? entry.episodeIds.join("|")
          : entry.cycleIds.join("|"),
      ),
    );
    return lineages.size > 1;
  }
  return false;
}

function getDegradationReasons({
  evidence,
  scenario,
  reason,
  selected,
  selectedCandidates,
  mediaFrameIds,
  ambiguity,
}: {
  evidence: FrozenBuffExpiryIncidentEvidence;
  scenario: AlertIssueScenario | null | undefined;
  reason: string;
  selected: IncidentCandidate;
  selectedCandidates: IncidentCandidate[];
  mediaFrameIds: string[];
  ambiguity: boolean;
}) {
  const reasons: BuffExpiryIncidentEvidenceOmissionReason[] = [];
  if (ambiguity) {
    reasons.push("ambiguous-target");
  }
  const requiresMedia =
    scenario === "not-recognized" ||
    scenario === "wrong-value" ||
    scenario === "unstable-value" ||
    scenario === "wrong-target";
  if (requiresMedia && selected.frameIds.length > 0 && mediaFrameIds.length === 0) {
    const omissionReason = evidence.omissions.find(
      (entry) =>
        entry.kind === "media" &&
        entry.subjectIds.some((id) => selected.frameIds.includes(id)),
    )?.reason;
    reasons.push(omissionReason ?? "never-produced");
  }
  if (scenario === "duplicate-alert" && selectedCandidates.length < 2) {
    reasons.push("never-produced");
  }
  if (
    scenario === "wrong-target" &&
    reason === "buff-expiry-false-alert" &&
    selected.cycleIds.length === 0
  ) {
    reasons.push("never-produced");
  }
  return unique(reasons);
}

function isCandidateForGroup(
  candidate: IncidentCandidate,
  affectedGroup: BuffExpiryTargetGroup | null,
) {
  return (
    !affectedGroup ||
    candidate.groups.length === 0 ||
    candidate.groups.includes(affectedGroup)
  );
}

function mergeCandidates(candidates: IncidentCandidate[]): IncidentCandidate {
  const latest = candidates[candidates.length - 1];
  return {
    id: candidates.map((entry) => entry.id).join("+"),
    anchorKind: latest?.anchorKind ?? "frame",
    occurredAt: latest?.occurredAt ?? 0,
    groups: unique(candidates.flatMap((entry) => entry.groups)),
    frameIds: unique(candidates.flatMap((entry) => entry.frameIds)),
    observationIds: unique(candidates.flatMap((entry) => entry.observationIds)),
    episodeIds: unique(candidates.flatMap((entry) => entry.episodeIds)),
    cycleIds: unique(candidates.flatMap((entry) => entry.cycleIds)),
    attemptIds: unique(candidates.flatMap((entry) => entry.attemptIds)),
    eventIds: unique(candidates.flatMap((entry) => entry.eventIds)),
    configurationRevisionIds: unique(
      candidates.flatMap((entry) => entry.configurationRevisionIds),
    ),
  };
}

function emptyCandidate(
  id: string,
  anchorKind: IncidentCandidate["anchorKind"],
  occurredAt: number,
): IncidentCandidate {
  return {
    id,
    anchorKind,
    occurredAt,
    groups: [],
    frameIds: [],
    observationIds: [],
    episodeIds: [],
    cycleIds: [],
    attemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
  };
}

function emptySelection(
  status: BuffExpiryReportIncidentSelection["status"],
  reason: BuffExpiryIncidentEvidenceOmissionReason,
): BuffExpiryReportIncidentSelection {
  return {
    policy: "buff-expiry-scenario-selection-v1",
    status,
    support: "unsupported",
    anchorKind: null,
    selectedEventAt: null,
    affectedGroup: null,
    candidateIds: [],
    frameIds: [],
    observationIds: [],
    episodeIds: [],
    cycleIds: [],
    attemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
    mediaFrameIds: [],
    ambiguous: false,
    degradationReasons: [reason],
  };
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
