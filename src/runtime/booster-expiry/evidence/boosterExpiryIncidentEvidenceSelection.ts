import type {
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import {
  BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS,
  BOOSTER_EXPIRY_INCIDENT_RETENTION_MS,
} from "./boosterExpiryIncidentEvidenceArchive";
import {
  BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_OBSERVATIONS,
  BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  BOOSTER_EXPIRY_INCIDENT_NEW_CYCLE_EXTENSION_MS,
  type BoosterExpiryIncidentEvidenceOmission,
  type BoosterExpiryIncidentSelectionDegradationReason,
  type FrozenBoosterExpiryIncidentEvidence,
} from "./boosterExpiryIncidentEvidenceTypes";

export type BoosterExpiryIncidentOperatorConclusion =
  | "recognition-rejected"
  | "recognition-missing"
  | "recognition-unconfirmed"
  | "runtime-failure"
  | "flow-substitution-found"
  | "wrong-target-observation-found"
  | "wrong-value-chain-found"
  | "unstable-sequence-found"
  | "candidate-collecting"
  | "candidate-expired"
  | "candidate-rejected"
  | "candidate-replaced"
  | "not-new-cycle"
  | "cycle-missing"
  | "schedule-missing"
  | "schedule-not-due"
  | "schedule-replaced"
  | "schedule-cancelled"
  | "decision-suppressed"
  | "decision-missing"
  | "decision-without-playback"
  | "playback-requested-only"
  | "playback-failed"
  | "browser-playback-accepted"
  | "physical-audibility-unverifiable"
  | "false-cycle-chain-found"
  | "same-cycle-duplicate-found"
  | "separate-cycle-alerts-found"
  | "valid-new-cycle-found"
  | "unexpected-booster-playback-found"
  | "unrelated-feature-playback-found"
  | "playback-source-unavailable"
  | "presentation-event-found"
  | "presentation-state-only"
  | "audio-configuration-found"
  | "configuration-transition-found"
  | "runtime-error-found"
  | "interaction-event-found"
  | "unsupported-other"
  | "ambiguous-incident"
  | "evidence-outside-retention"
  | "evidence-unavailable"
  | "legacy-evidence-unavailable"
  | "report-time-context-only";

export type BoosterExpiryReportIncidentSelection = {
  policy: "booster-expiry-scenario-selection-v1";
  status:
    | "matched"
    | "current-snapshot"
    | "outside-retention"
    | "unavailable"
    | "not-applicable";
  support: "definitive" | "partial" | "unsupported";
  anchorKind:
    | "frame"
    | "observation"
    | "candidate-attempt"
    | "cycle"
    | "schedule"
    | "decision"
    | "playback-attempt"
    | "related-playback"
    | "event"
    | "configuration"
    | "state"
    | null;
  selectedEventAt: number | null;
  resetEpochId: string | null;
  candidateIds: string[];
  flowEpochIds: string[];
  frameIds: string[];
  observationIds: string[];
  candidateAttemptIds: string[];
  cycleIds: string[];
  scheduleIds: string[];
  decisionIds: string[];
  playbackAttemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
  mediaFrameIds: string[];
  relatedPlaybackIds: string[];
  ambiguous: boolean;
  operatorConclusion: BoosterExpiryIncidentOperatorConclusion;
  physicalAudibility: "unknown";
  degradationReasons: BoosterExpiryIncidentSelectionDegradationReason[];
};

type AnchorKind = Exclude<
  BoosterExpiryReportIncidentSelection["anchorKind"],
  null
>;

type CandidateSeed = {
  id: string;
  anchorKind: AnchorKind;
  occurredAt: number;
  operatorConclusion: BoosterExpiryIncidentOperatorConclusion;
  flowEpochIds?: string[];
  frameIds?: string[];
  observationIds?: string[];
  candidateAttemptIds?: string[];
  cycleIds?: string[];
  scheduleIds?: string[];
  decisionIds?: string[];
  playbackAttemptIds?: string[];
  eventIds?: string[];
  configurationRevisionIds?: string[];
  relatedPlaybackIds?: string[];
};

type IncidentCandidate = Required<Omit<CandidateSeed, "operatorConclusion">> & {
  operatorConclusion: BoosterExpiryIncidentOperatorConclusion;
  resetEpochId: string;
};

type SelectionContext = ReturnType<typeof createSelectionContext>;

export function selectBoosterExpiryReportIncident({
  evidence,
  reason,
  scenario,
  occurrence,
  otherCategory = null,
}: {
  evidence:
    | FrozenBoosterExpiryIncidentEvidence
    | Record<string, unknown>
    | null
    | undefined;
  reason: string;
  scenario: AlertIssueScenario | null | undefined;
  occurrence: AlertIssueOccurrence | null | undefined;
  otherCategory?: AlertIssueOtherCategory | null;
}): BoosterExpiryReportIncidentSelection {
  if (!evidence) {
    return emptySelection(
      "unavailable",
      "evidence-unavailable",
      "never-produced",
    );
  }
  if (!isFrozenBoosterExpiryIncidentEvidence(evidence)) {
    return emptySelection(
      "unavailable",
      "legacy-evidence-unavailable",
      "legacy-unavailable",
    );
  }
  if (occurrence === "historical") {
    return {
      ...emptySelection(
        "outside-retention",
        "evidence-outside-retention",
        "outside-retention",
      ),
      resetEpochId: evidence.lease.resetEpochId,
    };
  }
  if (
    scenario === "other" &&
    (otherCategory === null || otherCategory === "other")
  ) {
    return {
      ...emptySelection(
        "not-applicable",
        "unsupported-other",
        "not-applicable",
      ),
      resetEpochId: evidence.lease.resetEpochId,
      selectedEventAt: evidence.frozenAt,
    };
  }

  const context = createSelectionContext(evidence);
  const allCandidates = createScenarioCandidates({
    context,
    reason,
    scenario,
    otherCategory,
  }).sort(compareCandidates);
  const candidates = allCandidates.filter((entry) =>
    isWithinOccurrence(entry.occurredAt, evidence.frozenAt, occurrence),
  );

  if (candidates.length === 0) {
    const reportTimeOnly = evidence.lifecycleEvents.some(
      (entry) =>
        entry.category === "recognition" &&
        entry.action === "report-time-analysis" &&
        isWithinOccurrence(entry.occurredAt, evidence.frozenAt, occurrence),
    );
    if (reportTimeOnly) {
      return {
        ...emptySelection(
          "unavailable",
          "report-time-context-only",
          "report-time-only",
        ),
        resetEpochId: evidence.lease.resetEpochId,
      };
    }
    const relevantOutsideWindow = allCandidates.length > 0;
    const expired = evidence.omissions.some(
      (entry) =>
        entry.reason === "outside-retention" &&
        isOmissionRelevant(entry.kind, scenario, otherCategory),
    );
    return {
      ...emptySelection(
        relevantOutsideWindow || expired ? "outside-retention" : "unavailable",
        relevantOutsideWindow || expired
          ? "evidence-outside-retention"
          : "evidence-unavailable",
        relevantOutsideWindow || expired
          ? "outside-retention"
          : "never-produced",
      ),
      resetEpochId: evidence.lease.resetEpochId,
    };
  }

  const selected = candidates[candidates.length - 1]!;
  const equallyCompatible = candidates.filter(
    (entry) =>
      entry.id !== selected.id &&
      entry.occurredAt === selected.occurredAt &&
      (entry.resetEpochId !== selected.resetEpochId ||
        entry.cycleIds.join("|") !== selected.cycleIds.join("|") ||
        entry.observationIds.join("|") !== selected.observationIds.join("|")),
  );
  const ambiguous = equallyCompatible.length > 0;
  const mediaFrameIds = selected.frameIds.filter((frameId) =>
    evidence.media.some((entry) => entry.frameId === frameId),
  );
  const degradationReasons = collectDegradationReasons({
    evidence,
    scenario,
    otherCategory,
    candidate: selected,
    mediaFrameIds,
    ambiguous,
  });
  const physicalAudibilityOnly =
    isPlaybackScenario(scenario, otherCategory) &&
    (selected.playbackAttemptIds.some((id) => {
      const attempt = evidence.playbackAttempts.find(
        (entry) => entry.id === id,
      );
      return (
        attempt?.status === "browser-play-accepted" ||
        attempt?.status === "finished"
      );
    }) ||
      selected.relatedPlaybackIds.some((id) => {
        const attempt = evidence.relatedPlayback.find(
          (entry) => entry.id === id,
        );
        return (
          attempt?.status === "browser-play-accepted" ||
          attempt?.status === "finished"
        );
      }));
  if (
    physicalAudibilityOnly &&
    !degradationReasons.includes("physical-audibility-unknown")
  ) {
    degradationReasons.push("physical-audibility-unknown");
  }

  return {
    policy: "booster-expiry-scenario-selection-v1",
    status: occurrence === "current" ? "current-snapshot" : "matched",
    support:
      degradationReasons.length > 0 || physicalAudibilityOnly
        ? "partial"
        : "definitive",
    anchorKind: selected.anchorKind,
    selectedEventAt: selected.occurredAt,
    resetEpochId: selected.resetEpochId,
    candidateIds: candidates.map((entry) => entry.id),
    flowEpochIds: selected.flowEpochIds,
    frameIds: selected.frameIds,
    observationIds: selected.observationIds,
    candidateAttemptIds: selected.candidateAttemptIds,
    cycleIds: selected.cycleIds,
    scheduleIds: selected.scheduleIds,
    decisionIds: selected.decisionIds,
    playbackAttemptIds: selected.playbackAttemptIds,
    eventIds: selected.eventIds,
    configurationRevisionIds: selected.configurationRevisionIds,
    mediaFrameIds,
    relatedPlaybackIds: selected.relatedPlaybackIds,
    ambiguous,
    operatorConclusion: ambiguous
      ? "ambiguous-incident"
      : physicalAudibilityOnly &&
          selected.operatorConclusion === "browser-playback-accepted"
        ? "physical-audibility-unverifiable"
        : selected.operatorConclusion,
    physicalAudibility: "unknown",
    degradationReasons,
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
  let seeds: CandidateSeed[];
  switch (scenario) {
    case "not-recognized":
      seeds = createRecognitionCandidates(context);
      break;
    case "wrong-value":
      seeds = createWrongValueCandidates(context);
      break;
    case "unstable-value":
      seeds = createUnstableValueCandidates(context);
      break;
    case "recognized-no-alert":
      seeds = createNoAlertCandidates(context);
      break;
    case "playback-missing":
      seeds = createPlaybackCandidates(context);
      break;
    case "wrong-target":
      seeds = createWrongTargetCandidates(context, reason);
      break;
    case "duplicate-alert":
    case "repeat-timing":
      seeds = createDuplicateCandidates(context);
      break;
    case "unexpected-playback":
      seeds = createUnexpectedPlaybackCandidates(context);
      break;
    case "other":
      seeds = createOtherCandidates(context, otherCategory);
      break;
    default:
      seeds = [];
  }
  if (reason === "other" && scenario !== "other") return [];
  return seeds
    .filter(
      (entry) =>
        entry.occurredAt <= context.evidence.frozenAt &&
        entry.occurredAt >=
          context.evidence.frozenAt - BOOSTER_EXPIRY_INCIDENT_RETENTION_MS,
    )
    .map((entry) => expandCandidate(context, entry))
    .filter((entry): entry is IncidentCandidate => entry !== null);
}

function createWrongTargetCandidates(
  context: SelectionContext,
  reason: string,
): CandidateSeed[] {
  if (reason === "booster-expiry-false-alert") {
    return context.decisions.map((entry) => ({
      id: `wrong-target:${entry.id}`,
      anchorKind: "decision",
      occurredAt: entry.occurredAt,
      decisionIds: [entry.id],
      operatorConclusion: "false-cycle-chain-found",
    }));
  }
  return context.observations
    .filter(
      (entry) =>
        entry.rawTime !== null ||
        entry.selectedTime !== null ||
        entry.timerCandidateCount > 0,
    )
    .map((entry) => ({
      id: `wrong-target-observation:${entry.id}`,
      anchorKind: "observation",
      occurredAt: entry.sampledAt,
      observationIds: [entry.id],
      operatorConclusion: "wrong-target-observation-found",
    }));
}

function createRecognitionCandidates(
  context: SelectionContext,
): CandidateSeed[] {
  return context.observations
    .filter((entry) => entry.decision !== "accepted")
    .map((entry) => ({
      id: `recognition:${entry.id}`,
      anchorKind: "observation",
      occurredAt: entry.sampledAt,
      observationIds: [entry.id],
      operatorConclusion:
        entry.decision === "error"
          ? "runtime-failure"
          : entry.decision === "missing"
            ? "recognition-missing"
            : "recognition-rejected",
    }));
}

function createWrongValueCandidates(
  context: SelectionContext,
): CandidateSeed[] {
  return context.observations
    .filter(
      (entry) =>
        entry.rawTime !== null ||
        entry.selectedTime !== null ||
        entry.decision === "error",
    )
    .map((entry) => ({
      id: `wrong-value:${entry.id}`,
      anchorKind: "observation",
      occurredAt: entry.sampledAt,
      observationIds: getObservationWindow(context, entry.id),
      operatorConclusion:
        entry.decision === "error"
          ? "runtime-failure"
          : entry.rawTime?.seconds !== null &&
              entry.selectedTime?.seconds !== null &&
              entry.rawTime?.seconds !== entry.selectedTime?.seconds
            ? "flow-substitution-found"
            : "wrong-value-chain-found",
    }));
}

function createUnstableValueCandidates(
  context: SelectionContext,
): CandidateSeed[] {
  const attempts = context.candidateAttempts.map((entry) => ({
    id: `unstable:${entry.id}`,
    anchorKind: "candidate-attempt" as const,
    occurredAt: entry.endedAt ?? entry.lastObservedAt,
    candidateAttemptIds: [entry.id],
    operatorConclusion: "unstable-sequence-found" as const,
  }));
  if (attempts.length > 0) return attempts;
  return context.observations.map((entry) => ({
    id: `unstable-observation:${entry.id}`,
    anchorKind: "observation" as const,
    occurredAt: entry.sampledAt,
    observationIds: getObservationWindow(context, entry.id),
    operatorConclusion: "unstable-sequence-found" as const,
  }));
}

function createNoAlertCandidates(context: SelectionContext): CandidateSeed[] {
  const seeds: CandidateSeed[] = [];
  for (const cycle of context.cycles) {
    const schedules = context.schedules
      .filter((entry) => entry.cycleId === cycle.id)
      .sort(
        (left, right) =>
          left.registeredAt - right.registeredAt ||
          left.id.localeCompare(right.id),
      );
    const schedule = schedules[schedules.length - 1] ?? null;
    const decision = schedule
      ? (context.decisions.find((entry) => entry.scheduleId === schedule.id) ??
        null)
      : null;
    const playback = decision
      ? (context.playbackAttempts.find(
          (entry) => entry.decisionId === decision.id,
        ) ?? null)
      : null;
    let conclusion: BoosterExpiryIncidentOperatorConclusion =
      "schedule-missing";
    if (schedule?.status === "registered") {
      conclusion =
        schedule.alertDueAt > context.evidence.frozenAt
          ? "schedule-not-due"
          : "decision-missing";
    }
    if (schedule?.status === "replaced") conclusion = "schedule-replaced";
    if (schedule?.status === "cancelled") conclusion = "schedule-cancelled";
    if (schedule?.status === "suppressed") conclusion = "decision-suppressed";
    if (schedule?.status === "fired" && !decision)
      conclusion = "decision-missing";
    if (decision && !playback) conclusion = "decision-without-playback";
    if (playback) conclusion = getPlaybackConclusion(playback.status);
    seeds.push({
      id: `no-alert:${cycle.id}:${schedule?.id ?? "none"}`,
      anchorKind: schedule ? "schedule" : "cycle",
      occurredAt:
        schedule?.status === "registered"
          ? context.evidence.frozenAt
          : (schedule?.endedAt ?? cycle.confirmedAt),
      cycleIds: [cycle.id],
      scheduleIds: schedule ? [schedule.id] : [],
      decisionIds: decision ? [decision.id] : [],
      playbackAttemptIds: playback ? [playback.id] : [],
      operatorConclusion: conclusion,
    });
  }
  for (const attempt of context.candidateAttempts) {
    if (attempt.confirmedCycleId !== null) continue;
    seeds.push({
      id: `no-alert-candidate:${attempt.id}`,
      anchorKind: "candidate-attempt",
      occurredAt: attempt.endedAt ?? attempt.lastObservedAt,
      candidateAttemptIds: [attempt.id],
      operatorConclusion: getCandidateConclusion(
        attempt.status,
        attempt.terminalReason,
      ),
    });
  }
  if (seeds.length === 0) {
    for (const observation of context.observations.filter(
      (entry) => entry.decision === "accepted",
    )) {
      seeds.push({
        id: `no-alert-observation:${observation.id}`,
        anchorKind: "observation",
        occurredAt: observation.sampledAt,
        observationIds: [observation.id],
        operatorConclusion: "recognition-unconfirmed",
      });
    }
  }
  return seeds;
}

function createPlaybackCandidates(context: SelectionContext): CandidateSeed[] {
  const decisions = context.decisions.map((decision) => {
    const playback = context.playbackAttempts.find(
      (entry) => entry.decisionId === decision.id,
    );
    return {
      id: `playback:${decision.id}:${playback?.id ?? "none"}`,
      anchorKind: playback
        ? ("playback-attempt" as const)
        : ("decision" as const),
      occurredAt: playback ? getPlaybackEventAt(playback) : decision.occurredAt,
      decisionIds: [decision.id],
      playbackAttemptIds: playback ? [playback.id] : [],
      operatorConclusion: playback
        ? getPlaybackConclusion(playback.status)
        : ("decision-without-playback" as const),
    };
  });
  const schedules = context.schedules
    .filter(
      (schedule) =>
        !context.decisions.some((entry) => entry.scheduleId === schedule.id),
    )
    .map((schedule) => ({
      id: `playback-schedule:${schedule.id}`,
      anchorKind: "schedule" as const,
      occurredAt:
        schedule.status === "registered"
          ? context.evidence.frozenAt
          : (schedule.endedAt ?? schedule.registeredAt),
      scheduleIds: [schedule.id],
      operatorConclusion: getScheduleWithoutDecisionConclusion(
        schedule,
        context.evidence.frozenAt,
      ),
    }));
  return [...decisions, ...schedules];
}

function createDuplicateCandidates(context: SelectionContext): CandidateSeed[] {
  const ordered = [...context.decisions].sort(
    (left, right) =>
      left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
  );
  const seeds: CandidateSeed[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const previousCycle = context.cycles.find(
      (entry) => entry.id === previous.cycleId,
    );
    const currentCycle = context.cycles.find(
      (entry) => entry.id === current.cycleId,
    );
    let conclusion: BoosterExpiryIncidentOperatorConclusion =
      "separate-cycle-alerts-found";
    if (previous.cycleId === current.cycleId) {
      conclusion = "same-cycle-duplicate-found";
    } else if (
      previousCycle &&
      currentCycle &&
      currentCycle.expiresAt - previousCycle.expiresAt >=
        BOOSTER_EXPIRY_INCIDENT_NEW_CYCLE_EXTENSION_MS
    ) {
      conclusion = "valid-new-cycle-found";
    }
    seeds.push({
      id: `duplicate:${previous.id}:${current.id}`,
      anchorKind: "decision",
      occurredAt: current.occurredAt,
      decisionIds: [previous.id, current.id],
      operatorConclusion: conclusion,
    });
  }
  return seeds;
}

function createUnexpectedPlaybackCandidates(
  context: SelectionContext,
): CandidateSeed[] {
  const own = context.playbackAttempts.map((entry) => ({
    id: `unexpected:${entry.id}`,
    anchorKind: "playback-attempt" as const,
    occurredAt: getPlaybackEventAt(entry),
    playbackAttemptIds: [entry.id],
    operatorConclusion: "unexpected-booster-playback-found" as const,
  }));
  const related = context.relatedPlayback.map((entry) => ({
    id: `unrelated:${entry.id}`,
    anchorKind: "related-playback" as const,
    occurredAt: getPlaybackEventAt(entry),
    relatedPlaybackIds: [entry.id],
    operatorConclusion: "unrelated-feature-playback-found" as const,
  }));
  if (own.length > 0 || related.length > 0) return [...own, ...related];
  return context.evidence.frozenState
    ? [
        {
          id: "playback-source:unavailable",
          anchorKind: "state" as const,
          occurredAt: context.evidence.frozenAt,
          operatorConclusion: "playback-source-unavailable" as const,
        },
      ]
    : [];
}

function createOtherCandidates(
  context: SelectionContext,
  category: AlertIssueOtherCategory | null,
): CandidateSeed[] {
  if (category === "sound-volume") {
    const playback = context.playbackAttempts.map((entry) => ({
      id: `audio:${entry.id}`,
      anchorKind: "playback-attempt" as const,
      occurredAt: getPlaybackEventAt(entry),
      playbackAttemptIds: [entry.id],
      operatorConclusion: "audio-configuration-found" as const,
    }));
    if (playback.length > 0) return playback;
    const configuration = context.configurationRevisions.find(
      (entry) => entry.id === context.evidence.lease.configRevisionId,
    );
    return configuration
      ? [
          {
            id: `audio-config:${configuration.id}`,
            anchorKind: "configuration" as const,
            occurredAt: context.evidence.frozenAt,
            configurationRevisionIds: [configuration.id],
            operatorConclusion: "audio-configuration-found" as const,
          },
        ]
      : [];
  }
  const eventCategory =
    category === "status-display"
      ? "presentation"
      : category === "settings-preset"
        ? "configuration"
        : category === "performance-error"
          ? "runtime-error"
          : category === "interaction"
            ? "interaction"
            : null;
  if (eventCategory !== null) {
    const events: CandidateSeed[] = context.lifecycleEvents
      .filter((entry) => entry.category === eventCategory)
      .map((entry) => ({
        id: `${category}:${entry.id}`,
        anchorKind: "event",
        occurredAt: entry.occurredAt,
        eventIds: [entry.id],
        operatorConclusion: getOtherConclusion(category),
      }));
    if (category === "performance-error") {
      events.push(
        ...context.frames
          .filter((entry) => entry.runtimeFailure !== null)
          .map((entry) => ({
            id: `performance-frame:${entry.id}`,
            anchorKind: "frame" as const,
            occurredAt: entry.sampledAt,
            frameIds: [entry.id],
            operatorConclusion: "runtime-error-found" as const,
          })),
        ...context.observations
          .filter((entry) => entry.decision === "error")
          .map((entry) => ({
            id: `performance-observation:${entry.id}`,
            anchorKind: "observation" as const,
            occurredAt: entry.sampledAt,
            observationIds: [entry.id],
            operatorConclusion: "runtime-error-found" as const,
          })),
      );
    }
    if (events.length > 0) return events;
  }
  if (category === "status-display" && context.evidence.frozenState) {
    return [
      {
        id: "presentation:frozen-state",
        anchorKind: "state",
        occurredAt: context.evidence.frozenState.capturedAt,
        operatorConclusion: "presentation-state-only",
      },
    ];
  }
  return [];
}

function expandCandidate(
  context: SelectionContext,
  seed: CandidateSeed,
): IncidentCandidate | null {
  const ids = {
    flowEpochIds: new Set(seed.flowEpochIds ?? []),
    frameIds: new Set(seed.frameIds ?? []),
    observationIds: new Set(seed.observationIds ?? []),
    candidateAttemptIds: new Set(seed.candidateAttemptIds ?? []),
    cycleIds: new Set(seed.cycleIds ?? []),
    scheduleIds: new Set(seed.scheduleIds ?? []),
    decisionIds: new Set(seed.decisionIds ?? []),
    playbackAttemptIds: new Set(seed.playbackAttemptIds ?? []),
    eventIds: new Set(seed.eventIds ?? []),
    configurationRevisionIds: new Set(seed.configurationRevisionIds ?? []),
    relatedPlaybackIds: new Set(seed.relatedPlaybackIds ?? []),
    resetEpochIds: new Set<string>(),
  };
  let changed = true;
  while (changed) {
    const before = getCandidateSize(ids);
    for (const playback of context.playbackAttempts) {
      if (!ids.playbackAttemptIds.has(playback.id)) continue;
      ids.cycleIds.add(playback.cycleId);
      ids.scheduleIds.add(playback.scheduleId);
      ids.decisionIds.add(playback.decisionId);
      ids.configurationRevisionIds.add(playback.configRevisionId);
      ids.resetEpochIds.add(playback.resetEpochId);
    }
    for (const decision of context.decisions) {
      if (!ids.decisionIds.has(decision.id)) continue;
      ids.cycleIds.add(decision.cycleId);
      ids.scheduleIds.add(decision.scheduleId);
      ids.configurationRevisionIds.add(decision.timingConfigRevisionId);
      ids.configurationRevisionIds.add(decision.firedConfigRevisionId);
      ids.resetEpochIds.add(decision.resetEpochId);
    }
    for (const schedule of context.schedules) {
      if (!ids.scheduleIds.has(schedule.id)) continue;
      ids.cycleIds.add(schedule.cycleId);
      ids.configurationRevisionIds.add(schedule.timingConfigRevisionId);
      ids.resetEpochIds.add(schedule.resetEpochId);
    }
    for (const cycle of context.cycles) {
      if (!ids.cycleIds.has(cycle.id)) continue;
      ids.candidateAttemptIds.add(cycle.candidateAttemptId);
      cycle.observationIds.forEach((id) => ids.observationIds.add(id));
      ids.flowEpochIds.add(cycle.confirmationFlowEpochId);
      ids.configurationRevisionIds.add(cycle.timingConfigRevisionId);
      ids.resetEpochIds.add(cycle.resetEpochId);
    }
    for (const attempt of context.candidateAttempts) {
      if (!ids.candidateAttemptIds.has(attempt.id)) continue;
      attempt.observationIds.forEach((id) => ids.observationIds.add(id));
      ids.flowEpochIds.add(attempt.flowEpochId);
      if (attempt.confirmedCycleId) ids.cycleIds.add(attempt.confirmedCycleId);
      ids.resetEpochIds.add(attempt.resetEpochId);
    }
    for (const observation of context.observations) {
      if (!ids.observationIds.has(observation.id)) continue;
      ids.frameIds.add(observation.frameId);
      ids.flowEpochIds.add(observation.flowEpochId);
      ids.configurationRevisionIds.add(observation.configRevisionId);
      ids.resetEpochIds.add(observation.resetEpochId);
    }
    for (const frame of context.frames) {
      if (!ids.frameIds.has(frame.id)) continue;
      ids.flowEpochIds.add(frame.flowEpochId);
      ids.configurationRevisionIds.add(frame.configRevisionId);
      ids.resetEpochIds.add(frame.resetEpochId);
    }
    for (const event of context.lifecycleEvents) {
      if (!ids.eventIds.has(event.id)) continue;
      addNullable(ids.configurationRevisionIds, event.configRevisionId);
      addNullable(ids.flowEpochIds, event.flowEpochId);
      addNullable(ids.frameIds, event.frameId);
      addNullable(ids.observationIds, event.observationId);
      addNullable(ids.candidateAttemptIds, event.candidateAttemptId);
      addNullable(ids.cycleIds, event.cycleId);
      addNullable(ids.scheduleIds, event.scheduleId);
      addNullable(ids.decisionIds, event.decisionId);
      addNullable(ids.playbackAttemptIds, event.playbackAttemptId);
      ids.resetEpochIds.add(event.resetEpochId);
    }
    for (const flow of context.flowEpochs) {
      if (ids.flowEpochIds.has(flow.id))
        ids.resetEpochIds.add(flow.resetEpochId);
    }
    for (const configuration of context.configurationRevisions) {
      if (ids.configurationRevisionIds.has(configuration.id)) {
        ids.resetEpochIds.add(configuration.resetEpochId);
      }
    }
    changed = getCandidateSize(ids) !== before;
  }
  if (ids.resetEpochIds.size === 0) {
    ids.resetEpochIds.add(context.evidence.lease.resetEpochId);
  }
  if (ids.resetEpochIds.size !== 1) return null;
  const resetEpochId = [...ids.resetEpochIds][0];
  if (!resetEpochId) return null;
  return {
    ...seed,
    flowEpochIds: sortIds(
      ids.flowEpochIds,
      context.flowEpochs,
      (entry) => entry.startedAt,
    ),
    frameIds: sortIds(ids.frameIds, context.frames, (entry) => entry.sampledAt),
    observationIds: sortIds(
      ids.observationIds,
      context.observations,
      (entry) => entry.sampledAt,
    ),
    candidateAttemptIds: sortIds(
      ids.candidateAttemptIds,
      context.candidateAttempts,
      (entry) => entry.startedAt,
    ),
    cycleIds: sortIds(
      ids.cycleIds,
      context.cycles,
      (entry) => entry.confirmedAt,
    ),
    scheduleIds: sortIds(
      ids.scheduleIds,
      context.schedules,
      (entry) => entry.registeredAt,
    ),
    decisionIds: sortIds(
      ids.decisionIds,
      context.decisions,
      (entry) => entry.occurredAt,
    ),
    playbackAttemptIds: sortIds(
      ids.playbackAttemptIds,
      context.playbackAttempts,
      (entry) => entry.requestedAt,
    ),
    eventIds: sortIds(
      ids.eventIds,
      context.lifecycleEvents,
      (entry) => entry.occurredAt,
    ),
    configurationRevisionIds: sortIds(
      ids.configurationRevisionIds,
      context.configurationRevisions,
      (entry) => entry.capturedAt,
    ),
    relatedPlaybackIds: sortIds(
      ids.relatedPlaybackIds,
      context.relatedPlayback,
      (entry) => entry.requestedAt,
    ),
    resetEpochId,
  };
}

function createSelectionContext(evidence: FrozenBoosterExpiryIncidentEvidence) {
  const frames = evidence.frames.filter(
    (entry) =>
      entry.sampledAt <= evidence.frozenAt &&
      (entry.resetEpochId !== evidence.lease.resetEpochId ||
        entry.sequence <= evidence.lease.leasedThroughFrameSequence),
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  return {
    evidence,
    frames,
    observations: evidence.observations.filter((entry) =>
      frameIds.has(entry.frameId),
    ),
    candidateAttempts: evidence.candidateAttempts,
    cycles: evidence.cycles,
    schedules: evidence.schedules,
    decisions: evidence.decisions,
    playbackAttempts: evidence.playbackAttempts,
    lifecycleEvents: evidence.lifecycleEvents,
    configurationRevisions: evidence.configurationRevisions,
    flowEpochs: evidence.flowEpochs,
    relatedPlayback: evidence.relatedPlayback,
  };
}

function collectDegradationReasons({
  evidence,
  scenario,
  otherCategory,
  candidate,
  mediaFrameIds,
  ambiguous,
}: {
  evidence: FrozenBoosterExpiryIncidentEvidence;
  scenario: AlertIssueScenario | null | undefined;
  otherCategory: AlertIssueOtherCategory | null;
  candidate: IncidentCandidate;
  mediaFrameIds: string[];
  ambiguous: boolean;
}): BoosterExpiryIncidentSelectionDegradationReason[] {
  const reasons = new Set<BoosterExpiryIncidentSelectionDegradationReason>();
  if (ambiguous) reasons.add("ambiguous-incident");
  const mediaRequired =
    scenario === "not-recognized" ||
    scenario === "wrong-target" ||
    scenario === "wrong-value";
  if (mediaRequired && candidate.frameIds.length > mediaFrameIds.length) {
    reasons.add("selected-media-missing");
  }
  if (
    candidate.cycleIds.some((id) => {
      const cycle = evidence.cycles.find((entry) => entry.id === id);
      return (
        !cycle ||
        cycle.observationIds.length <
          BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_OBSERVATIONS
      );
    })
  ) {
    reasons.add("sequence-incomplete");
  }
  if (scenario === "unstable-value" && candidate.observationIds.length < 2) {
    reasons.add("sequence-incomplete");
  }
  for (const omission of evidence.omissions) {
    if (
      isOmissionRelevant(omission.kind, scenario, otherCategory) &&
      (omission.subjectIds.length === 0 ||
        omission.subjectIds.some((id) => candidateContainsId(candidate, id)))
    ) {
      reasons.add(omission.reason);
    }
  }
  return [...reasons].sort();
}

function candidateContainsId(
  candidate: IncidentCandidate,
  id: string,
): boolean {
  return [
    candidate.resetEpochId,
    ...candidate.flowEpochIds,
    ...candidate.frameIds,
    ...candidate.observationIds,
    ...candidate.candidateAttemptIds,
    ...candidate.cycleIds,
    ...candidate.scheduleIds,
    ...candidate.decisionIds,
    ...candidate.playbackAttemptIds,
    ...candidate.eventIds,
    ...candidate.configurationRevisionIds,
    ...candidate.relatedPlaybackIds,
  ].includes(id);
}

function getObservationWindow(
  context: SelectionContext,
  observationId: string,
): string[] {
  const selected = context.observations.find(
    (entry) => entry.id === observationId,
  );
  if (!selected) return [observationId];
  return context.observations
    .filter(
      (entry) =>
        entry.flowEpochId === selected.flowEpochId &&
        entry.sampledAt <= selected.sampledAt,
    )
    .sort(
      (left, right) =>
        left.sampledAt - right.sampledAt || left.id.localeCompare(right.id),
    )
    .slice(-BOOSTER_EXPIRY_INCIDENT_CONFIRMATION_OBSERVATIONS)
    .map((entry) => entry.id);
}

function getCandidateConclusion(
  status: FrozenBoosterExpiryIncidentEvidence["candidateAttempts"][number]["status"],
  reason: FrozenBoosterExpiryIncidentEvidence["candidateAttempts"][number]["terminalReason"],
): BoosterExpiryIncidentOperatorConclusion {
  if (status === "collecting") return "candidate-collecting";
  if (reason === "window-expired") return "candidate-expired";
  if (reason === "not-new-cycle") return "not-new-cycle";
  if (status === "replaced") return "candidate-replaced";
  if (status === "confirmed") return "cycle-missing";
  return "candidate-rejected";
}

function getScheduleWithoutDecisionConclusion(
  schedule: FrozenBoosterExpiryIncidentEvidence["schedules"][number],
  frozenAt: number,
): BoosterExpiryIncidentOperatorConclusion {
  switch (schedule.status) {
    case "registered":
      return schedule.alertDueAt > frozenAt
        ? "schedule-not-due"
        : "decision-missing";
    case "replaced":
      return "schedule-replaced";
    case "cancelled":
      return "schedule-cancelled";
    case "suppressed":
      return "decision-suppressed";
    case "fired":
      return "decision-missing";
  }
}

function isOmissionRelevant(
  kind: BoosterExpiryIncidentEvidenceOmission["kind"],
  scenario: AlertIssueScenario | null | undefined,
  otherCategory: AlertIssueOtherCategory | null,
): boolean {
  if (
    scenario === "not-recognized" ||
    scenario === "wrong-target" ||
    scenario === "wrong-value"
  ) {
    return [
      "flow-epoch",
      "frame",
      "observation",
      "candidate-attempt",
      "cycle",
      "media",
    ].includes(kind);
  }
  if (scenario === "unstable-value") {
    return ["flow-epoch", "observation", "candidate-attempt", "event"].includes(
      kind,
    );
  }
  if (scenario === "recognized-no-alert") {
    return [
      "observation",
      "candidate-attempt",
      "cycle",
      "schedule",
      "decision",
      "playback-attempt",
    ].includes(kind);
  }
  if (scenario === "playback-missing" || scenario === "unexpected-playback") {
    return ["schedule", "decision", "playback-attempt", "event"].includes(kind);
  }
  if (scenario === "duplicate-alert" || scenario === "repeat-timing") {
    return [
      "candidate-attempt",
      "cycle",
      "schedule",
      "decision",
      "playback-attempt",
      "event",
    ].includes(kind);
  }
  if (scenario === "other") {
    return otherCategory === "sound-volume"
      ? ["configuration", "playback-attempt", "event"].includes(kind)
      : ["configuration", "reset-epoch", "flow-epoch", "event"].includes(kind);
  }
  return false;
}

function isPlaybackScenario(
  scenario: AlertIssueScenario | null | undefined,
  otherCategory: AlertIssueOtherCategory | null,
): boolean {
  return (
    scenario === "playback-missing" ||
    scenario === "unexpected-playback" ||
    (scenario === "other" && otherCategory === "sound-volume")
  );
}

function getPlaybackConclusion(
  status: "requested" | "browser-play-accepted" | "finished" | "failed",
): BoosterExpiryIncidentOperatorConclusion {
  switch (status) {
    case "requested":
      return "playback-requested-only";
    case "failed":
      return "playback-failed";
    case "browser-play-accepted":
    case "finished":
      return "browser-playback-accepted";
  }
}

function getOtherConclusion(
  category: AlertIssueOtherCategory | null,
): BoosterExpiryIncidentOperatorConclusion {
  switch (category) {
    case "status-display":
      return "presentation-event-found";
    case "sound-volume":
      return "audio-configuration-found";
    case "settings-preset":
      return "configuration-transition-found";
    case "performance-error":
      return "runtime-error-found";
    case "interaction":
      return "interaction-event-found";
    case "other":
    case null:
      return "unsupported-other";
  }
}

function emptySelection(
  status: BoosterExpiryReportIncidentSelection["status"],
  conclusion: BoosterExpiryIncidentOperatorConclusion,
  degradation: BoosterExpiryIncidentSelectionDegradationReason,
): BoosterExpiryReportIncidentSelection {
  return {
    policy: "booster-expiry-scenario-selection-v1",
    status,
    support: "unsupported",
    anchorKind: null,
    selectedEventAt: null,
    resetEpochId: null,
    candidateIds: [],
    flowEpochIds: [],
    frameIds: [],
    observationIds: [],
    candidateAttemptIds: [],
    cycleIds: [],
    scheduleIds: [],
    decisionIds: [],
    playbackAttemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
    mediaFrameIds: [],
    relatedPlaybackIds: [],
    ambiguous: false,
    operatorConclusion: conclusion,
    physicalAudibility: "unknown",
    degradationReasons: [degradation],
  };
}

function isFrozenBoosterExpiryIncidentEvidence(
  value: Record<string, unknown> | FrozenBoosterExpiryIncidentEvidence,
): value is FrozenBoosterExpiryIncidentEvidence {
  const record = value as Record<string, unknown>;
  const lease = record.lease;
  return (
    record.schemaVersion === BOOSTER_EXPIRY_INCIDENT_EVIDENCE_SCHEMA_VERSION &&
    typeof record.frozenAt === "number" &&
    typeof record.leaseId === "string" &&
    typeof lease === "object" &&
    lease !== null &&
    "resetEpochId" in lease &&
    typeof lease.resetEpochId === "string" &&
    "flowEpochId" in lease &&
    typeof lease.flowEpochId === "string" &&
    "leasedThroughFrameSequence" in lease &&
    typeof lease.leasedThroughFrameSequence === "number" &&
    [
      "resetEpochs",
      "configurationRevisions",
      "flowEpochs",
      "frames",
      "observations",
      "candidateAttempts",
      "cycles",
      "schedules",
      "decisions",
      "playbackAttempts",
      "lifecycleEvents",
      "media",
      "omissions",
      "relatedPlayback",
    ].every((key) => Array.isArray(record[key]))
  );
}

function isWithinOccurrence(
  occurredAt: number,
  frozenAt: number,
  occurrence: AlertIssueOccurrence | null | undefined,
): boolean {
  const age = frozenAt - occurredAt;
  if (age < 0) return false;
  if (occurrence === "current") {
    return age <= BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS;
  }
  if (occurrence === "recent") {
    return (
      age > BOOSTER_EXPIRY_INCIDENT_CURRENT_WINDOW_MS &&
      age <= BOOSTER_EXPIRY_INCIDENT_RETENTION_MS
    );
  }
  return false;
}

function getPlaybackEventAt(entry: {
  requestedAt: number;
  browserAcceptedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
}): number {
  return (
    entry.finishedAt ??
    entry.failedAt ??
    entry.browserAcceptedAt ??
    entry.requestedAt
  );
}

function compareCandidates(
  left: IncidentCandidate,
  right: IncidentCandidate,
): number {
  return left.occurredAt - right.occurredAt || left.id.localeCompare(right.id);
}

function sortIds<T extends { id: string }>(
  ids: Set<string>,
  entries: T[],
  getTime: (entry: T) => number,
): string[] {
  const timeById = new Map(entries.map((entry) => [entry.id, getTime(entry)]));
  return [...ids].sort(
    (left, right) =>
      (timeById.get(left) ?? 0) - (timeById.get(right) ?? 0) ||
      left.localeCompare(right),
  );
}

function getCandidateSize(ids: Record<string, Set<string>>): number {
  return Object.values(ids).reduce((sum, entries) => sum + entries.size, 0);
}

function addNullable(ids: Set<string>, value: string | null): void {
  if (value !== null) ids.add(value);
}
