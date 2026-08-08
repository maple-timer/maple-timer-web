import type {
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import { SKILL_INCIDENT_CURRENT_WINDOW_MS } from "./skillIncidentEvidenceArchive";
import type {
  FrozenSkillIncidentEvidence,
  SkillIncidentAlertDecision,
  SkillIncidentCycle,
  SkillIncidentEvidenceOmissionReason,
  SkillIncidentFrame,
  SkillIncidentLifecycleEvent,
  SkillIncidentObservation,
  SkillIncidentPlaybackAttempt,
} from "./skillIncidentEvidenceTypes";
import { SKILL_INCIDENT_EVIDENCE_SCHEMA_VERSION } from "./skillIncidentEvidenceTypes";

export type SkillReportIncidentSelection = {
  policy: "skill-alert-scenario-selection-v1";
  status:
    | "matched"
    | "current-snapshot"
    | "outside-retention"
    | "unavailable";
  support: "definitive" | "partial" | "unsupported";
  anchorKind:
    | "frame"
    | "observation"
    | "cycle"
    | "decision"
    | "attempt"
    | "event"
    | "configuration"
    | null;
  selectedEventAt: number | null;
  selectedSkillId: string | null;
  mode: SkillIncidentFrame["mode"] | null;
  targetId: string | null;
  epochId: string | null;
  candidateIds: string[];
  frameIds: string[];
  observationIds: string[];
  cycleIds: string[];
  decisionIds: string[];
  arbitrationIds: string[];
  attemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
  mediaIds: string[];
  ambiguous: boolean;
  playbackStartEvidence:
    | "browser-play-accepted"
    | "legacy-request-only"
    | "not-recorded";
  physicalAudibility: "unknown";
  degradationReasons: SkillIncidentEvidenceOmissionReason[];
};

type SelectionContext = ReturnType<typeof createSelectionContext>;

type IncidentCandidate = {
  id: string;
  anchorKind: Exclude<SkillReportIncidentSelection["anchorKind"], null>;
  occurredAt: number;
  skillId: string;
  mode: SkillIncidentFrame["mode"] | null;
  targetId: string | null;
  epochId: string | null;
  cycleId: string | null;
  frameIds: string[];
  observationIds: string[];
  cycleIds: string[];
  decisionIds: string[];
  arbitrationIds: string[];
  attemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
};

export function selectSkillReportIncident({
  evidence,
  reason,
  scenario,
  occurrence,
  selectedSkillId,
  otherCategory = null,
}: {
  evidence: FrozenSkillIncidentEvidence | Record<string, unknown> | null | undefined;
  reason: string;
  scenario: AlertIssueScenario | null | undefined;
  occurrence: AlertIssueOccurrence | null | undefined;
  selectedSkillId?: string | null;
  otherCategory?: AlertIssueOtherCategory | null;
}): SkillReportIncidentSelection {
  if (!evidence) {
    return emptySelection("unavailable", "never-produced");
  }
  if (!isFrozenSkillIncidentEvidence(evidence)) {
    return emptySelection("unavailable", "legacy-unavailable");
  }
  const skillId = selectedSkillId || evidence.selectedSkillId;
  if (!skillId) {
    return emptySelection("unavailable", "ambiguous-skill");
  }
  if (occurrence === "historical") {
    return {
      ...emptySelection("outside-retention", "outside-retention"),
      selectedSkillId: skillId,
    };
  }

  const cutoff =
    occurrence === "current"
      ? evidence.frozenAt - SKILL_INCIDENT_CURRENT_WINDOW_MS
      : evidence.frozenAt - 60_000;
  const context = createSelectionContext(evidence, skillId, cutoff);
  const candidates = createScenarioCandidates({
    context,
    reason,
    scenario,
    otherCategory,
  }).sort(
    (left, right) =>
      left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
  );

  if (candidates.length === 0) {
    const hasReportTimeContext = evidence.frames.some(
      (entry) => entry.skillId === skillId && entry.source === "report-time",
    );
    return {
      ...emptySelection(
        "unavailable",
        hasReportTimeContext ? "report-time-only" : "never-produced",
      ),
      selectedSkillId: skillId,
    };
  }

  const latest = candidates[candidates.length - 1];
  const equallyCompatible = candidates.filter(
    (entry) =>
      entry.occurredAt === latest.occurredAt &&
      (entry.cycleId !== latest.cycleId || entry.epochId !== latest.epochId),
  );
  const ambiguous = equallyCompatible.length > 0;
  const selected = latest;
  const mediaIds = collectMediaIds(evidence, selected);
  const referencedMediaIds = collectReferencedMediaIds(evidence, selected);
  const selectedIds = new Set([
    ...selected.frameIds,
    ...selected.observationIds,
    ...selected.cycleIds,
    ...selected.decisionIds,
    ...selected.arbitrationIds,
    ...selected.attemptIds,
    ...selected.eventIds,
    ...selected.configurationRevisionIds,
    ...referencedMediaIds,
  ]);
  const degradationReasons = collectDegradationReasons({
    evidence,
    scenario,
    selected,
    selectedIds,
    mediaIds,
    ambiguous,
  });
  const attempts = evidence.attempts.filter((entry) =>
    selected.attemptIds.includes(entry.id),
  );
  const playbackStartEvidence = getPlaybackStartEvidence(attempts);
  const physicalAudibilityOnly =
    (scenario === "playback-missing" || scenario === "unexpected-playback") &&
    attempts.some(
      (entry) => entry.status === "started" || entry.status === "finished",
    );

  return {
    policy: "skill-alert-scenario-selection-v1",
    status: occurrence === "current" ? "current-snapshot" : "matched",
    support:
      degradationReasons.length > 0 || physicalAudibilityOnly
        ? "partial"
        : "definitive",
    anchorKind: selected.anchorKind,
    selectedEventAt: selected.occurredAt,
    selectedSkillId: skillId,
    mode: selected.mode,
    targetId: selected.targetId,
    epochId: selected.epochId,
    candidateIds: candidates.map((entry) => entry.id),
    frameIds: selected.frameIds,
    observationIds: selected.observationIds,
    cycleIds: selected.cycleIds,
    decisionIds: selected.decisionIds,
    arbitrationIds: selected.arbitrationIds,
    attemptIds: selected.attemptIds,
    eventIds: selected.eventIds,
    configurationRevisionIds: selected.configurationRevisionIds,
    mediaIds,
    ambiguous,
    playbackStartEvidence,
    physicalAudibility: "unknown",
    degradationReasons,
  };
}

function createSelectionContext(
  evidence: FrozenSkillIncidentEvidence,
  skillId: string,
  cutoff: number,
) {
  const skillCycles = evidence.cycles.filter(
    (entry) =>
      entry.skillId === skillId &&
      entry.lastEventAt <= evidence.frozenAt &&
      (entry.lastEventAt >= cutoff || entry.status !== "terminal"),
  );
  const cycleIds = new Set(skillCycles.map((entry) => entry.id));
  const anchorObservationIds = new Set(
    skillCycles.flatMap((entry) => entry.anchorObservationIds),
  );
  const candidateObservations = evidence.observations.filter(
    (entry) =>
      entry.skillIds.includes(skillId) &&
      entry.sampledAt <= evidence.frozenAt &&
      (entry.sampledAt >= cutoff || anchorObservationIds.has(entry.id)),
  );
  const candidateObservationIds = new Set(
    candidateObservations.map((entry) => entry.id),
  );
  const frames = evidence.frames.filter(
    (entry) =>
      entry.skillId === skillId &&
      entry.source !== "report-time" &&
      entry.sampledAt <= evidence.frozenAt &&
      (entry.sampledAt >= cutoff ||
        entry.observationIds.some((id) => anchorObservationIds.has(id))),
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  const frameObservationIds = new Set(
    frames.flatMap((entry) => entry.observationIds),
  );
  const observations = candidateObservations.filter((entry) =>
    frameIds.has(entry.frameId) || frameObservationIds.has(entry.id),
  );
  const observationIds = new Set(observations.map((entry) => entry.id));
  const cycles = skillCycles.filter(
    (entry) =>
      entry.observationIds.some((id) => observationIds.has(id)) ||
      entry.decisionIds.length > 0 ||
      entry.status !== "pending",
  );
  const retainedCycleIds = new Set(cycles.map((entry) => entry.id));
  const decisions = evidence.decisions.filter(
    (entry) =>
      entry.skillId === skillId &&
      retainedCycleIds.has(entry.cycleId) &&
      entry.occurredAt <= evidence.frozenAt,
  );
  const decisionIds = new Set(decisions.map((entry) => entry.id));
  const attempts = evidence.attempts.filter(
    (entry) =>
      entry.skillId === skillId &&
      retainedCycleIds.has(entry.cycleId) &&
      decisionIds.has(entry.decisionId) &&
      entry.requestedAt <= evidence.frozenAt,
  );
  const arbitrations = evidence.arbitrations.filter(
    (entry) =>
      entry.occurredAt <= evidence.frozenAt &&
      (entry.dueSkillIds.includes(skillId) ||
        entry.winnerSkillId === skillId ||
        entry.suppressedSkillIds.includes(skillId) ||
        entry.decisionIds.some((id) => decisionIds.has(id))),
  );
  const lifecycleEvents = evidence.lifecycleEvents.filter(
    (entry) =>
      (entry.skillId === null || entry.skillId === skillId) &&
      entry.occurredAt >= cutoff &&
      entry.occurredAt <= evidence.frozenAt,
  );
  const configurationRevisions = evidence.configurationRevisions.filter(
    (entry) =>
      entry.skillId === skillId &&
      entry.capturedAt <= evidence.frozenAt &&
      (entry.capturedAt >= cutoff ||
        frames.some((frame) => frame.configRevisionId === entry.id) ||
        cycles.some((cycle) => cycle.configRevisionIds.includes(entry.id)) ||
        decisions.some((decision) => decision.configRevisionId === entry.id)),
  );
  return {
    evidence,
    skillId,
    cutoff,
    frames,
    frameIds,
    observations,
    observationIds,
    cycles,
    cycleIds,
    decisions,
    decisionIds,
    attempts,
    arbitrations,
    lifecycleEvents,
    configurationRevisions,
    candidateObservationIds,
  };
}

function createScenarioCandidates({
  context,
  reason,
  scenario,
  otherCategory,
}: {
  context: SelectionContext;
  reason: string;
  scenario: AlertIssueScenario | null | undefined;
  otherCategory: AlertIssueOtherCategory | null;
}): IncidentCandidate[] {
  switch (scenario) {
    case "not-recognized":
      return createNotRecognizedCandidates(context);
    case "wrong-value":
    case "unstable-value":
      return context.observations
        .filter(isValueFailureObservation)
        .map((entry) => observationCandidate(entry, context));
    case "recognized-no-alert":
      return context.cycles
        .filter((cycle) => isRecognizedWithoutAlert(cycle, context))
        .map((entry) => cycleCandidate(entry, context));
    case "playback-missing":
    case "unexpected-playback":
      return createPlaybackCandidates(context);
    case "repeat-missing":
    case "repeat-timing":
    case "duplicate-alert":
      return context.cycles
        .filter((cycle) =>
          context.decisions.some(
            (decision) =>
              decision.cycleId === cycle.id && decision.kind === "repeat",
          ),
        )
        .map((entry) => cycleCandidate(entry, context));
    case "early-alert":
    case "late-alert":
      return context.decisions
        .filter((entry) => entry.kind === "initial")
        .map((entry) => decisionCandidate(entry, context));
    case "wrong-target":
      return context.observations
        .filter((entry) => entry.recognitionDecision === "accepted")
        .map((entry) => observationCandidate(entry, context));
    case "other":
      return createOtherCandidates(context, otherCategory);
    default:
      return reason === "skill-alert-timing"
        ? context.cycles.map((entry) => cycleCandidate(entry, context))
        : createFallbackCandidates(context);
  }
}

function createNotRecognizedCandidates(
  context: SelectionContext,
): IncidentCandidate[] {
  const observations = context.observations
    .filter(
      (entry) =>
        entry.recognitionDecision !== "accepted" ||
        Boolean(entry.runtimeFailure),
    )
    .map((entry) => observationCandidate(entry, context));
  const frames = context.frames
    .filter((frame) => {
      const frameObservations = context.observations.filter(
        (entry) => entry.frameId === frame.id,
      );
      return (
        Boolean(frame.runtimeFailure) ||
        frameObservations.length === 0 ||
        !frameObservations.some(
          (entry) => entry.recognitionDecision === "accepted",
        )
      );
    })
    .map((entry) => frameCandidate(entry, context));
  return uniqueCandidates([...observations, ...frames]);
}

function isValueFailureObservation(
  observation: SkillIncidentObservation,
): boolean {
  if (observation.recognitionDecision !== "accepted") {
    return false;
  }
  if (observation.value.decision !== "accepted") {
    return true;
  }
  const flowReason = observation.flow?.decisionReason?.toLowerCase() ?? "";
  return /reject|quarantin|implaus|unreachable|invalid|missing|unstable/.test(
    flowReason,
  );
}

function isRecognizedWithoutAlert(
  cycle: SkillIncidentCycle,
  context: SelectionContext,
): boolean {
  if (cycle.confirmedAt === null) {
    return false;
  }
  const decisions = context.decisions.filter(
    (entry) => entry.cycleId === cycle.id,
  );
  const requestedDecisionIds = new Set(
    decisions
      .filter((entry) => entry.outcome === "requested")
      .map((entry) => entry.id),
  );
  const hasRequestedAttempt = context.attempts.some(
    (entry) =>
      entry.cycleId === cycle.id && requestedDecisionIds.has(entry.decisionId),
  );
  return (
    !hasRequestedAttempt ||
    decisions.some((entry) =>
      [
        "suppressed-duplicate-target",
        "pending-confirmation",
        "not-due",
        "already-alerted",
        "reset",
        "cancelled",
      ].includes(entry.outcome),
    )
  );
}

function createPlaybackCandidates(
  context: SelectionContext,
): IncidentCandidate[] {
  const attempts = context.attempts.map((entry) =>
    attemptCandidate(entry, context),
  );
  const decisionsWithoutAttempt = context.decisions
    .filter(
      (entry) =>
        entry.outcome === "requested" &&
        !context.attempts.some((attempt) => attempt.decisionId === entry.id),
    )
    .map((entry) => decisionCandidate(entry, context));
  return [...attempts, ...decisionsWithoutAttempt];
}

function createOtherCandidates(
  context: SelectionContext,
  category: AlertIssueOtherCategory | null,
): IncidentCandidate[] {
  if (category === "status-display") {
    return [
      ...context.lifecycleEvents
        .filter((entry) => entry.category === "presentation")
        .map((entry) => eventCandidate(entry, context)),
      ...context.frames.map((entry) => frameCandidate(entry, context)),
    ];
  }
  if (category === "sound-volume") {
    return [
      ...context.attempts.map((entry) => attemptCandidate(entry, context)),
      ...context.configurationRevisions.map((entry) =>
        configurationCandidate(entry, context),
      ),
    ];
  }
  if (category === "settings-preset") {
    return [
      ...context.lifecycleEvents
        .filter((entry) => entry.category === "configuration")
        .map((entry) => eventCandidate(entry, context)),
      ...context.configurationRevisions.map((entry) =>
        configurationCandidate(entry, context),
      ),
    ];
  }
  if (category === "performance-error") {
    return [
      ...context.frames
        .filter((entry) => Boolean(entry.runtimeFailure))
        .map((entry) => frameCandidate(entry, context)),
      ...context.observations
        .filter((entry) => Boolean(entry.runtimeFailure))
        .map((entry) => observationCandidate(entry, context)),
      ...context.lifecycleEvents
        .filter((entry) => entry.category === "runtime-error")
        .map((entry) => eventCandidate(entry, context)),
    ];
  }
  if (category === "interaction") {
    return context.lifecycleEvents
      .filter(
        (entry) =>
          entry.category === "interaction" || entry.category === "lifecycle",
      )
      .map((entry) => eventCandidate(entry, context));
  }
  return createFallbackCandidates(context);
}

function createFallbackCandidates(
  context: SelectionContext,
): IncidentCandidate[] {
  return [
    ...context.lifecycleEvents.map((entry) => eventCandidate(entry, context)),
    ...context.attempts.map((entry) => attemptCandidate(entry, context)),
    ...context.cycles.map((entry) => cycleCandidate(entry, context)),
    ...context.observations.map((entry) =>
      observationCandidate(entry, context),
    ),
    ...context.frames.map((entry) => frameCandidate(entry, context)),
  ];
}

function frameCandidate(
  frame: SkillIncidentFrame,
  context: SelectionContext,
): IncidentCandidate {
  const observations = context.observations.filter(
    (entry) =>
      entry.frameId === frame.id || frame.observationIds.includes(entry.id),
  );
  const cycle = findLatestCycleForObservations(observations, context);
  return mergeCandidateChain({
    base: emptyCandidate({
      id: `frame:${frame.id}`,
      anchorKind: "frame",
      occurredAt: frame.sampledAt,
      skillId: context.skillId,
      mode: frame.mode,
      targetId: frame.targetId,
      epochId: frame.epochId,
      cycleId: cycle?.id ?? null,
    }),
    context,
    frameIds: [frame.id],
    observationIds: observations.map((entry) => entry.id),
    cycle,
  });
}

function observationCandidate(
  observation: SkillIncidentObservation,
  context: SelectionContext,
): IncidentCandidate {
  const frame = context.frames.find((entry) => entry.id === observation.frameId);
  const cycle = findLatestCycleForObservations([observation], context);
  return mergeCandidateChain({
    base: emptyCandidate({
      id: `observation:${observation.id}`,
      anchorKind: "observation",
      occurredAt: observation.sampledAt,
      skillId: context.skillId,
      mode: observation.mode,
      targetId: observation.targetId,
      epochId: observation.epochId,
      cycleId: cycle?.id ?? null,
    }),
    context,
    frameIds: frame ? [frame.id] : [],
    observationIds: [observation.id],
    cycle,
  });
}

function cycleCandidate(
  cycle: SkillIncidentCycle,
  context: SelectionContext,
): IncidentCandidate {
  return mergeCandidateChain({
    base: emptyCandidate({
      id: `cycle:${cycle.id}`,
      anchorKind: "cycle",
      occurredAt: cycle.lastEventAt,
      skillId: context.skillId,
      mode: cycle.mode,
      targetId: cycle.targetId,
      epochId: cycle.epochId,
      cycleId: cycle.id,
    }),
    context,
    cycle,
  });
}

function decisionCandidate(
  decision: SkillIncidentAlertDecision,
  context: SelectionContext,
): IncidentCandidate {
  const cycle = context.cycles.find((entry) => entry.id === decision.cycleId);
  const base = mergeCandidateChain({
    base: emptyCandidate({
      id: `decision:${decision.id}`,
      anchorKind: "decision",
      occurredAt: decision.occurredAt,
      skillId: context.skillId,
      mode: cycle?.mode ?? null,
      targetId: decision.targetId,
      epochId: decision.epochId,
      cycleId: decision.cycleId,
    }),
    context,
    frameIds: decision.frameId ? [decision.frameId] : [],
    observationIds: decision.observationId ? [decision.observationId] : [],
    cycle,
  });
  return {
    ...base,
    decisionIds: unique([...base.decisionIds, decision.id]),
    arbitrationIds: unique([
      ...base.arbitrationIds,
      ...(decision.arbitrationId ? [decision.arbitrationId] : []),
    ]),
    attemptIds: unique([
      ...base.attemptIds,
      ...(decision.attemptId ? [decision.attemptId] : []),
    ]),
  };
}

function attemptCandidate(
  attempt: SkillIncidentPlaybackAttempt,
  context: SelectionContext,
): IncidentCandidate {
  const decision = context.decisions.find(
    (entry) => entry.id === attempt.decisionId,
  );
  const base = decision
    ? decisionCandidate(decision, context)
    : cycleCandidate(
        context.cycles.find((entry) => entry.id === attempt.cycleId) ??
          createSyntheticCycle(attempt),
        context,
      );
  return {
    ...base,
    id: `attempt:${attempt.id}`,
    anchorKind: "attempt",
    occurredAt:
      attempt.failedAt ??
      attempt.finishedAt ??
      attempt.startedAt ??
      attempt.requestedAt,
    attemptIds: unique([...base.attemptIds, attempt.id]),
  };
}

function eventCandidate(
  event: SkillIncidentLifecycleEvent,
  context: SelectionContext,
): IncidentCandidate {
  const cycle = event.cycleId
    ? context.cycles.find((entry) => entry.id === event.cycleId)
    : undefined;
  return mergeCandidateChain({
    base: emptyCandidate({
      id: `event:${event.id}`,
      anchorKind: "event",
      occurredAt: event.occurredAt,
      skillId: context.skillId,
      mode: cycle?.mode ?? null,
      targetId: cycle?.targetId ?? null,
      epochId: event.epochId,
      cycleId: cycle?.id ?? null,
    }),
    context,
    cycle,
    eventIds: [event.id],
  });
}

function configurationCandidate(
  revision: SelectionContext["configurationRevisions"][number],
  context: SelectionContext,
): IncidentCandidate {
  return {
    ...emptyCandidate({
      id: `configuration:${revision.id}`,
      anchorKind: "configuration",
      occurredAt: revision.capturedAt,
      skillId: context.skillId,
      mode: null,
      targetId: null,
      epochId: revision.epochId,
      cycleId: null,
    }),
    configurationRevisionIds: [revision.id],
  };
}

function mergeCandidateChain({
  base,
  context,
  frameIds = [],
  observationIds = [],
  cycle,
  eventIds = [],
}: {
  base: IncidentCandidate;
  context: SelectionContext;
  frameIds?: string[];
  observationIds?: string[];
  cycle?: SkillIncidentCycle;
  eventIds?: string[];
}): IncidentCandidate {
  const cycleObservationIds = cycle?.observationIds ?? [];
  const allObservationIds = unique([
    ...observationIds,
    ...(cycle?.anchorObservationIds ?? []),
    ...cycleObservationIds,
  ]).filter((id) => context.observationIds.has(id));
  const allFrameIds = unique([
    ...frameIds,
    ...context.frames
      .filter((entry) =>
        entry.observationIds.some((id) => allObservationIds.includes(id)),
      )
      .map((entry) => entry.id),
    ...context.observations
      .filter((entry) => allObservationIds.includes(entry.id))
      .map((entry) => entry.frameId),
  ]).filter((id) => context.frameIds.has(id));
  const decisions = cycle
    ? context.decisions.filter((entry) => entry.cycleId === cycle.id)
    : [];
  const decisionIds = decisions.map((entry) => entry.id);
  const arbitrations = context.arbitrations.filter((entry) =>
    entry.decisionIds.some((id) => decisionIds.includes(id)),
  );
  const attempts = context.attempts.filter(
    (entry) => cycle && entry.cycleId === cycle.id,
  );
  const lifecycle = context.lifecycleEvents.filter(
    (entry) =>
      (cycle && entry.cycleId === cycle.id) ||
      (base.epochId && entry.epochId === base.epochId),
  );
  return {
    ...base,
    frameIds: allFrameIds,
    observationIds: allObservationIds,
    cycleIds: cycle ? [cycle.id] : [],
    decisionIds,
    arbitrationIds: arbitrations.map((entry) => entry.id),
    attemptIds: attempts.map((entry) => entry.id),
    eventIds: unique([...eventIds, ...lifecycle.map((entry) => entry.id)]),
    configurationRevisionIds: unique([
      ...(cycle?.configRevisionIds ?? []),
      ...context.frames
        .filter((entry) => allFrameIds.includes(entry.id))
        .map((entry) => entry.configRevisionId),
      ...decisions.map((entry) => entry.configRevisionId),
    ]),
  };
}

function findLatestCycleForObservations(
  observations: SkillIncidentObservation[],
  context: SelectionContext,
): SkillIncidentCycle | undefined {
  const ids = new Set(observations.map((entry) => entry.id));
  return [...context.cycles]
    .filter((cycle) => cycle.observationIds.some((id) => ids.has(id)))
    .sort(
      (left, right) =>
        right.lastEventAt - left.lastEventAt || left.id.localeCompare(right.id),
    )[0];
}

function collectMediaIds(
  evidence: FrozenSkillIncidentEvidence,
  selected: IncidentCandidate,
): string[] {
  const ids = new Set<string>();
  for (const frame of evidence.frames) {
    if (selected.frameIds.includes(frame.id)) {
      frame.mediaIds.forEach((id) => ids.add(id));
    }
  }
  for (const observation of evidence.observations) {
    if (selected.observationIds.includes(observation.id)) {
      observation.mediaIds.forEach((id) => ids.add(id));
    }
  }
  const retained = new Set(evidence.media.map((entry) => entry.id));
  return [...ids].filter((id) => retained.has(id));
}

function collectReferencedMediaIds(
  evidence: FrozenSkillIncidentEvidence,
  selected: IncidentCandidate,
): string[] {
  return unique([
    ...evidence.frames
      .filter((entry) => selected.frameIds.includes(entry.id))
      .flatMap((entry) => entry.mediaIds),
    ...evidence.observations
      .filter((entry) => selected.observationIds.includes(entry.id))
      .flatMap((entry) => entry.mediaIds),
  ]);
}

function collectDegradationReasons({
  evidence,
  scenario,
  selected,
  selectedIds,
  mediaIds,
  ambiguous,
}: {
  evidence: FrozenSkillIncidentEvidence;
  scenario: AlertIssueScenario | null | undefined;
  selected: IncidentCandidate;
  selectedIds: Set<string>;
  mediaIds: string[];
  ambiguous: boolean;
}): SkillIncidentEvidenceOmissionReason[] {
  const reasons = new Set<SkillIncidentEvidenceOmissionReason>();
  if (ambiguous) {
    reasons.add("ambiguous-cycle");
  }
  const mediaRequired = [
    "not-recognized",
    "wrong-value",
    "unstable-value",
    "wrong-target",
  ].includes(scenario ?? "");
  if (mediaRequired && mediaIds.length === 0) {
    const mediaOmission = [...evidence.omissions]
      .reverse()
      .find(
        (entry) =>
          entry.kind === "media" &&
          entry.subjectIds.some((id) => selectedIds.has(id)),
      );
    reasons.add(mediaOmission?.reason ?? "never-produced");
  }
  for (const omission of evidence.omissions) {
    if (
      omission.subjectIds.some((id) => selectedIds.has(id)) ||
      (omission.kind === "media" &&
        mediaRequired &&
        mediaIds.length === 0 &&
        omission.subjectIds.some((id) => selectedIds.has(id)))
    ) {
      reasons.add(omission.reason);
    }
  }
  const selectedCycle = evidence.cycles.find((entry) =>
    selected.cycleIds.includes(entry.id),
  );
  if (
    selectedCycle &&
    selectedCycle.anchorObservationIds.some(
      (id) => !selected.observationIds.includes(id),
    )
  ) {
    reasons.add("metadata-budget");
  }
  const selectedAttempts = evidence.attempts.filter((entry) =>
    selected.attemptIds.includes(entry.id),
  );
  if (
    selectedAttempts.some(
      (entry) => entry.startedMeaning === "legacy-request-recorded",
    )
  ) {
    reasons.add("legacy-unavailable");
  }
  return [...reasons];
}

function getPlaybackStartEvidence(
  attempts: SkillIncidentPlaybackAttempt[],
): SkillReportIncidentSelection["playbackStartEvidence"] {
  if (
    attempts.some(
      (entry) => entry.startedMeaning === "browser-play-accepted",
    )
  ) {
    return "browser-play-accepted";
  }
  if (
    attempts.some(
      (entry) => entry.startedMeaning === "legacy-request-recorded",
    )
  ) {
    return "legacy-request-only";
  }
  return "not-recorded";
}

function emptyCandidate({
  id,
  anchorKind,
  occurredAt,
  skillId,
  mode,
  targetId,
  epochId,
  cycleId,
}: Pick<
  IncidentCandidate,
  | "id"
  | "anchorKind"
  | "occurredAt"
  | "skillId"
  | "mode"
  | "targetId"
  | "epochId"
  | "cycleId"
>): IncidentCandidate {
  return {
    id,
    anchorKind,
    occurredAt,
    skillId,
    mode,
    targetId,
    epochId,
    cycleId,
    frameIds: [],
    observationIds: [],
    cycleIds: [],
    decisionIds: [],
    arbitrationIds: [],
    attemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
  };
}

function emptySelection(
  status: SkillReportIncidentSelection["status"],
  degradation: SkillIncidentEvidenceOmissionReason,
): SkillReportIncidentSelection {
  return {
    policy: "skill-alert-scenario-selection-v1",
    status,
    support: "unsupported",
    anchorKind: null,
    selectedEventAt: null,
    selectedSkillId: null,
    mode: null,
    targetId: null,
    epochId: null,
    candidateIds: [],
    frameIds: [],
    observationIds: [],
    cycleIds: [],
    decisionIds: [],
    arbitrationIds: [],
    attemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
    mediaIds: [],
    ambiguous: false,
    playbackStartEvidence: "not-recorded",
    physicalAudibility: "unknown",
    degradationReasons: [degradation],
  };
}

function isFrozenSkillIncidentEvidence(
  value: FrozenSkillIncidentEvidence | Record<string, unknown>,
): value is FrozenSkillIncidentEvidence {
  return Boolean(
    value &&
      value.schemaVersion === SKILL_INCIDENT_EVIDENCE_SCHEMA_VERSION &&
      typeof value.frozenAt === "number" &&
      typeof value.selectedSkillId === "string" &&
      typeof value.leaseId === "string" &&
      Array.isArray(value.frames) &&
      Array.isArray(value.observations) &&
      Array.isArray(value.cycles) &&
      Array.isArray(value.decisions) &&
      Array.isArray(value.arbitrations) &&
      Array.isArray(value.attempts) &&
      Array.isArray(value.lifecycleEvents) &&
      Array.isArray(value.configurationRevisions) &&
      Array.isArray(value.media) &&
      Array.isArray(value.omissions),
  );
}

function uniqueCandidates(entries: IncidentCandidate[]): IncidentCandidate[] {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function unique(entries: string[]): string[] {
  return [...new Set(entries)];
}

function createSyntheticCycle(
  attempt: SkillIncidentPlaybackAttempt,
): SkillIncidentCycle {
  return {
    id: attempt.cycleId,
    epochId: attempt.epochId,
    skillId: attempt.skillId,
    targetId: "unknown",
    sequence: 0,
    mode: "quickslot-countdown",
    status: "terminal",
    startedAt: attempt.requestedAt,
    confirmedAt: null,
    lastEventAt:
      attempt.failedAt ?? attempt.finishedAt ?? attempt.requestedAt,
    endedAt: attempt.failedAt ?? attempt.finishedAt,
    terminalReason: "missing-cycle",
    anchorObservationIds: [],
    observationIds: [],
    decisionIds: [attempt.decisionId],
    configRevisionIds: [],
    estimatedExpiresAt: null,
    confirmedCount: null,
    initialAlertDelaySeconds: null,
  };
}
