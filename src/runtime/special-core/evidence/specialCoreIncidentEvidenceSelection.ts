import type {
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import { SPECIAL_CORE_INCIDENT_CURRENT_WINDOW_MS } from "./specialCoreIncidentEvidenceArchive";
import {
  SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  type FrozenSpecialCoreIncidentEvidence,
  type SpecialCoreIncidentEvidenceOmission,
  type SpecialCoreIncidentSelectionDegradationReason,
} from "./specialCoreIncidentEvidenceTypes";

export type SpecialCoreIncidentOperatorConclusion =
  | "recognition-rejected"
  | "recognition-missing"
  | "recognition-unconfirmed"
  | "runtime-failure"
  | "confirmation-expired"
  | "activation-missing"
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
  | "false-activation-chain-found"
  | "same-activation-duplicate-found"
  | "separate-activation-alerts-found"
  | "valid-reacquire-found"
  | "unexpected-special-core-playback-found"
  | "unrelated-feature-playback-found"
  | "playback-source-unavailable"
  | "early-alert-chain-found"
  | "late-alert-chain-found"
  | "timing-chain-consistent"
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

export type SpecialCoreReportIncidentSelection = {
  policy: "special-core-scenario-selection-v1";
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
    | "confirmation-attempt"
    | "activation"
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
  frameIds: string[];
  observationIds: string[];
  confirmationAttemptIds: string[];
  activationIds: string[];
  scheduleIds: string[];
  decisionIds: string[];
  playbackAttemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
  mediaFrameIds: string[];
  relatedPlaybackIds: string[];
  ambiguous: boolean;
  operatorConclusion: SpecialCoreIncidentOperatorConclusion;
  physicalAudibility: "unknown";
  degradationReasons: SpecialCoreIncidentSelectionDegradationReason[];
};

type AnchorKind = Exclude<
  SpecialCoreReportIncidentSelection["anchorKind"],
  null
>;

type CandidateSeed = {
  id: string;
  anchorKind: AnchorKind;
  occurredAt: number;
  operatorConclusion: SpecialCoreIncidentOperatorConclusion;
  frameIds?: string[];
  observationIds?: string[];
  confirmationAttemptIds?: string[];
  activationIds?: string[];
  scheduleIds?: string[];
  decisionIds?: string[];
  playbackAttemptIds?: string[];
  eventIds?: string[];
  configurationRevisionIds?: string[];
  relatedPlaybackIds?: string[];
};

type IncidentCandidate = Required<
  Omit<CandidateSeed, "operatorConclusion">
> & {
  operatorConclusion: SpecialCoreIncidentOperatorConclusion;
  resetEpochId: string;
};

type SelectionContext = ReturnType<typeof createSelectionContext>;

export function selectSpecialCoreReportIncident({
  evidence,
  reason,
  scenario,
  occurrence,
  otherCategory = null,
}: {
  evidence:
    | FrozenSpecialCoreIncidentEvidence
    | Record<string, unknown>
    | null
    | undefined;
  reason: string;
  scenario: AlertIssueScenario | null | undefined;
  occurrence: AlertIssueOccurrence | null | undefined;
  otherCategory?: AlertIssueOtherCategory | null;
}): SpecialCoreReportIncidentSelection {
  if (!evidence) {
    return emptySelection(
      "unavailable",
      "evidence-unavailable",
      "never-produced",
    );
  }
  if (!isFrozenSpecialCoreIncidentEvidence(evidence)) {
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

  const cutoff =
    occurrence === "current"
      ? evidence.frozenAt - SPECIAL_CORE_INCIDENT_CURRENT_WINDOW_MS
      : evidence.frozenAt - 60_000;
  const context = createSelectionContext(evidence, cutoff);
  const candidates = createScenarioCandidates({
    context,
    reason,
    scenario,
    otherCategory,
  }).sort(compareCandidates);

  if (candidates.length === 0) {
    const olderRetainedCandidates =
      occurrence === "current"
        ? createScenarioCandidates({
            context: createSelectionContext(
              evidence,
              evidence.frozenAt - 60_000,
            ),
            reason,
            scenario,
            otherCategory,
          }).filter((entry) => entry.occurredAt < cutoff)
        : [];
    if (olderRetainedCandidates.length > 0) {
      return {
        ...emptySelection(
          "outside-retention",
          "evidence-outside-retention",
          "outside-retention",
        ),
        resetEpochId: evidence.lease.resetEpochId,
      };
    }
    const reportTimeOnly = evidence.lifecycleEvents.some(
      (entry) =>
        entry.category === "recognition" &&
        entry.action === "report-time-analysis" &&
        entry.occurredAt >= cutoff,
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
    const expired = evidence.omissions.some(
      (entry) =>
        entry.reason === "outside-retention" &&
        isOmissionRelevant(entry.kind, scenario, otherCategory),
    );
    return {
      ...emptySelection(
        expired ? "outside-retention" : "unavailable",
        expired ? "evidence-outside-retention" : "evidence-unavailable",
        expired ? "outside-retention" : "never-produced",
      ),
      resetEpochId: evidence.lease.resetEpochId,
    };
  }

  const latest = candidates[candidates.length - 1]!;
  const equallyCompatible = candidates.filter(
    (entry) =>
      entry.id !== latest.id &&
      entry.occurredAt === latest.occurredAt &&
      (entry.resetEpochId !== latest.resetEpochId ||
        entry.activationIds.join("|") !== latest.activationIds.join("|")),
  );
  const ambiguous = equallyCompatible.length > 0;
  const mediaFrameIds = latest.frameIds.filter((frameId) =>
    evidence.media.some((entry) => entry.frameId === frameId),
  );
  const degradationReasons = collectDegradationReasons({
    evidence,
    scenario,
    otherCategory,
    candidate: latest,
    mediaFrameIds,
    ambiguous,
  });
  const physicalAudibilityOnly =
    isPlaybackScenario(scenario, otherCategory) &&
    (latest.playbackAttemptIds.some((id) => {
      const attempt = evidence.playbackAttempts.find(
        (entry) => entry.id === id,
      );
      return (
        attempt?.status === "browser-play-accepted" ||
        attempt?.status === "finished"
      );
    }) ||
      latest.relatedPlaybackIds.some((id) => {
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
    policy: "special-core-scenario-selection-v1",
    status: occurrence === "current" ? "current-snapshot" : "matched",
    support:
      degradationReasons.length > 0 || physicalAudibilityOnly
        ? "partial"
        : "definitive",
    anchorKind: latest.anchorKind,
    selectedEventAt: latest.occurredAt,
    resetEpochId: latest.resetEpochId,
    candidateIds: candidates.map((entry) => entry.id),
    frameIds: latest.frameIds,
    observationIds: latest.observationIds,
    confirmationAttemptIds: latest.confirmationAttemptIds,
    activationIds: latest.activationIds,
    scheduleIds: latest.scheduleIds,
    decisionIds: latest.decisionIds,
    playbackAttemptIds: latest.playbackAttemptIds,
    eventIds: latest.eventIds,
    configurationRevisionIds: latest.configurationRevisionIds,
    mediaFrameIds,
    relatedPlaybackIds: latest.relatedPlaybackIds,
    ambiguous,
    operatorConclusion: ambiguous
      ? "ambiguous-incident"
      : physicalAudibilityOnly &&
          latest.operatorConclusion === "browser-playback-accepted"
        ? "physical-audibility-unverifiable"
        : latest.operatorConclusion,
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
  let seeds: CandidateSeed[] = [];
  switch (scenario) {
    case "not-recognized":
      seeds = createRecognitionCandidates(context);
      break;
    case "recognized-no-alert":
      seeds = createNoAlertCandidates(context);
      break;
    case "playback-missing":
      seeds = createPlaybackCandidates(context);
      break;
    case "wrong-target":
      seeds = context.activations.map((entry) => ({
        id: `wrong-target:${entry.id}`,
        anchorKind: "activation",
        occurredAt:
          entry.status === "active"
            ? context.evidence.frozenAt
            : entry.confirmedAt,
        activationIds: [entry.id],
        operatorConclusion: "false-activation-chain-found",
      }));
      break;
    case "duplicate-alert":
    case "repeat-timing":
      seeds = createDuplicateCandidates(context);
      break;
    case "unexpected-playback":
      seeds = createUnexpectedPlaybackCandidates(context);
      break;
    case "early-alert":
      seeds = createTimingCandidates(context, "early");
      break;
    case "late-alert":
      seeds = createTimingCandidates(context, "late");
      break;
    case "other":
      seeds = createOtherCandidates(context, otherCategory);
      break;
    default:
      seeds = [];
  }
  if (
    reason === "special-core-timing" &&
    scenario === "playback-missing"
  ) {
    seeds = createPlaybackCandidates(context);
  }
  return seeds
    .filter(
      (entry) =>
        entry.occurredAt >= context.cutoff &&
        entry.occurredAt <= context.evidence.frozenAt,
    )
    .map((entry) => expandCandidate(context, entry))
    .filter((entry): entry is IncidentCandidate => entry !== null);
}

function createRecognitionCandidates(context: SelectionContext): CandidateSeed[] {
  return context.observations.map((entry) => ({
    id: `recognition:${entry.id}`,
    anchorKind: "observation",
    occurredAt: entry.sampledAt,
    observationIds: [entry.id],
    operatorConclusion:
      entry.decision === "error"
        ? "runtime-failure"
        : entry.decision === "missing"
          ? "recognition-missing"
          : entry.decision === "accepted"
            ? "recognition-unconfirmed"
            : "recognition-rejected",
  }));
}

function createNoAlertCandidates(context: SelectionContext): CandidateSeed[] {
  const seeds: CandidateSeed[] = [];
  for (const activation of context.activations) {
    const schedules = context.schedules.filter(
      (entry) => entry.activationId === activation.id,
    );
    const latestSchedule = schedules.sort(
      (left, right) =>
        left.registeredAt - right.registeredAt ||
        left.id.localeCompare(right.id),
    )[schedules.length - 1];
    const decision = latestSchedule
      ? context.decisions.find((entry) => entry.scheduleId === latestSchedule.id)
      : null;
    const playback = decision
      ? context.playbackAttempts.find((entry) => entry.decisionId === decision.id)
      : null;
    let conclusion: SpecialCoreIncidentOperatorConclusion = "schedule-missing";
    if (latestSchedule?.status === "registered") {
      conclusion =
        latestSchedule.alertDueAt > context.evidence.frozenAt
          ? "schedule-not-due"
          : "decision-missing";
    }
    if (latestSchedule?.status === "replaced") conclusion = "schedule-replaced";
    if (latestSchedule?.status === "cancelled") conclusion = "schedule-cancelled";
    if (latestSchedule?.status === "suppressed") conclusion = "decision-suppressed";
    if (latestSchedule?.status === "fired" && !decision) {
      conclusion = "decision-missing";
    }
    if (decision && !playback) conclusion = "decision-without-playback";
    if (playback) conclusion = getPlaybackConclusion(playback.status);
    seeds.push({
      id: `no-alert:${activation.id}:${latestSchedule?.id ?? "none"}`,
      anchorKind: latestSchedule ? "schedule" : "activation",
      occurredAt:
        latestSchedule?.status === "registered"
          ? context.evidence.frozenAt
          : (latestSchedule?.endedAt ?? activation.confirmedAt),
      activationIds: [activation.id],
      scheduleIds: latestSchedule ? [latestSchedule.id] : [],
      decisionIds: decision ? [decision.id] : [],
      playbackAttemptIds: playback ? [playback.id] : [],
      operatorConclusion: conclusion,
    });
  }
  for (const attempt of context.confirmationAttempts) {
    if (attempt.activationId !== null) continue;
    seeds.push({
      id: `no-alert-confirmation:${attempt.id}`,
      anchorKind: "confirmation-attempt",
      occurredAt: attempt.endedAt ?? attempt.lastObservedAt,
      confirmationAttemptIds: [attempt.id],
      operatorConclusion:
        attempt.status === "expired"
          ? "confirmation-expired"
          : attempt.status === "confirmed"
            ? "activation-missing"
            : "recognition-unconfirmed",
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
  const decisions: CandidateSeed[] = context.decisions.map((decision) => {
    const playback = context.playbackAttempts.find(
      (entry) => entry.decisionId === decision.id,
    );
    return {
      id: `playback:${decision.id}:${playback?.id ?? "none"}`,
      anchorKind: playback ? "playback-attempt" : "decision",
      occurredAt: playback ? getPlaybackEventAt(playback) : decision.occurredAt,
      decisionIds: [decision.id],
      playbackAttemptIds: playback ? [playback.id] : [],
      operatorConclusion: playback
        ? getPlaybackConclusion(playback.status)
        : "decision-without-playback",
    };
  });
  const scheduleWithoutDecision = context.schedules
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
  return [...decisions, ...scheduleWithoutDecision];
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
    const activation = context.activations.find(
      (entry) => entry.id === current.activationId,
    );
    const conclusion =
      previous.activationId === current.activationId
        ? "same-activation-duplicate-found"
        : activation?.confirmationKind === "cooldown-reacquire"
          ? "valid-reacquire-found"
          : "separate-activation-alerts-found";
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
    operatorConclusion:
      "unexpected-special-core-playback-found" as SpecialCoreIncidentOperatorConclusion,
  }));
  const related = context.relatedPlayback.map((entry) => ({
    id: `unrelated:${entry.id}`,
    anchorKind: "related-playback" as const,
    occurredAt: getRelatedPlaybackEventAt(entry),
    relatedPlaybackIds: [entry.id],
    operatorConclusion:
      "unrelated-feature-playback-found" as SpecialCoreIncidentOperatorConclusion,
  }));
  if (own.length > 0 || related.length > 0) return [...own, ...related];
  return context.evidence.frozenState
    ? [
        {
          id: "playback-source:unavailable",
          anchorKind: "state" as const,
          occurredAt: context.evidence.frozenAt,
          operatorConclusion:
            "playback-source-unavailable" as SpecialCoreIncidentOperatorConclusion,
        },
      ]
    : [];
}

function createTimingCandidates(
  context: SelectionContext,
  kind: "early" | "late",
): CandidateSeed[] {
  return context.decisions.map((entry) => ({
    id: `${kind}:${entry.id}`,
    anchorKind: "decision",
    occurredAt: entry.occurredAt,
    decisionIds: [entry.id],
    operatorConclusion:
      kind === "early"
        ? entry.occurredAt < entry.dueAt
          ? "early-alert-chain-found"
          : "timing-chain-consistent"
        : entry.schedulerDelayMs > 0
          ? "late-alert-chain-found"
          : "timing-chain-consistent",
  }));
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
      operatorConclusion:
        "audio-configuration-found" as SpecialCoreIncidentOperatorConclusion,
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
            operatorConclusion:
              "audio-configuration-found" as SpecialCoreIncidentOperatorConclusion,
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
        anchorKind: "event" as const,
        occurredAt: entry.occurredAt,
        eventIds: [entry.id],
        operatorConclusion: getOtherConclusion(category),
      }));
    if (category === "performance-error") {
      events.push(
        ...context.observations
          .filter((entry) => entry.decision === "error")
          .map((entry) => ({
            id: `performance-error:${entry.id}`,
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
    frameIds: new Set(seed.frameIds ?? []),
    observationIds: new Set(seed.observationIds ?? []),
    confirmationAttemptIds: new Set(seed.confirmationAttemptIds ?? []),
    activationIds: new Set(seed.activationIds ?? []),
    scheduleIds: new Set(seed.scheduleIds ?? []),
    decisionIds: new Set(seed.decisionIds ?? []),
    playbackAttemptIds: new Set(seed.playbackAttemptIds ?? []),
    eventIds: new Set(seed.eventIds ?? []),
    configurationRevisionIds: new Set(
      seed.configurationRevisionIds ?? [],
    ),
    relatedPlaybackIds: new Set(seed.relatedPlaybackIds ?? []),
    resetEpochIds: new Set<string>(),
  };
  let changed = true;
  while (changed) {
    const before = getCandidateSize(ids);
    for (const attempt of context.playbackAttempts) {
      if (!ids.playbackAttemptIds.has(attempt.id)) continue;
      ids.decisionIds.add(attempt.decisionId);
      ids.scheduleIds.add(attempt.scheduleId);
      ids.activationIds.add(attempt.activationId);
      ids.configurationRevisionIds.add(attempt.configRevisionId);
      ids.resetEpochIds.add(attempt.resetEpochId);
    }
    for (const decision of context.decisions) {
      if (!ids.decisionIds.has(decision.id)) continue;
      ids.scheduleIds.add(decision.scheduleId);
      ids.activationIds.add(decision.activationId);
      ids.configurationRevisionIds.add(decision.timingConfigRevisionId);
      ids.configurationRevisionIds.add(decision.firedConfigRevisionId);
      ids.resetEpochIds.add(decision.resetEpochId);
    }
    for (const schedule of context.schedules) {
      if (!ids.scheduleIds.has(schedule.id)) continue;
      ids.activationIds.add(schedule.activationId);
      ids.configurationRevisionIds.add(schedule.timingConfigRevisionId);
      ids.resetEpochIds.add(schedule.resetEpochId);
    }
    for (const activation of context.activations) {
      if (!ids.activationIds.has(activation.id)) continue;
      ids.confirmationAttemptIds.add(activation.confirmationAttemptId);
      activation.observationIds.forEach((id) => ids.observationIds.add(id));
      ids.configurationRevisionIds.add(activation.timingConfigRevisionId);
      ids.resetEpochIds.add(activation.resetEpochId);
    }
    for (const attempt of context.confirmationAttempts) {
      if (!ids.confirmationAttemptIds.has(attempt.id)) continue;
      attempt.observationIds.forEach((id) => ids.observationIds.add(id));
      if (attempt.activationId) ids.activationIds.add(attempt.activationId);
      ids.resetEpochIds.add(attempt.resetEpochId);
    }
    for (const observation of context.observations) {
      if (!ids.observationIds.has(observation.id)) continue;
      ids.frameIds.add(observation.frameId);
      ids.configurationRevisionIds.add(observation.configRevisionId);
      ids.resetEpochIds.add(observation.resetEpochId);
    }
    for (const frame of context.frames) {
      if (!ids.frameIds.has(frame.id)) continue;
      ids.configurationRevisionIds.add(frame.configRevisionId);
      ids.resetEpochIds.add(frame.resetEpochId);
    }
    for (const event of context.lifecycleEvents) {
      if (!ids.eventIds.has(event.id)) continue;
      addNullable(ids.configurationRevisionIds, event.configRevisionId);
      addNullable(ids.frameIds, event.frameId);
      addNullable(ids.observationIds, event.observationId);
      addNullable(ids.confirmationAttemptIds, event.confirmationAttemptId);
      addNullable(ids.activationIds, event.activationId);
      addNullable(ids.scheduleIds, event.scheduleId);
      addNullable(ids.decisionIds, event.decisionId);
      addNullable(ids.playbackAttemptIds, event.playbackAttemptId);
      ids.resetEpochIds.add(event.resetEpochId);
    }
    for (const configuration of context.configurationRevisions) {
      if (!ids.configurationRevisionIds.has(configuration.id)) continue;
      ids.resetEpochIds.add(configuration.resetEpochId);
    }
    changed = getCandidateSize(ids) !== before;
  }
  if (ids.resetEpochIds.size === 0) {
    ids.resetEpochIds.add(context.evidence.lease.resetEpochId);
  }
  if (ids.resetEpochIds.size !== 1) return null;
  const resetEpochId = [...ids.resetEpochIds].sort()[0];
  if (!resetEpochId) return null;
  return {
    ...seed,
    frameIds: [...ids.frameIds].sort(),
    observationIds: [...ids.observationIds].sort(),
    confirmationAttemptIds: [...ids.confirmationAttemptIds].sort(),
    activationIds: [...ids.activationIds].sort(),
    scheduleIds: [...ids.scheduleIds].sort(),
    decisionIds: [...ids.decisionIds].sort(),
    playbackAttemptIds: [...ids.playbackAttemptIds].sort(),
    eventIds: [...ids.eventIds].sort(),
    configurationRevisionIds: [...ids.configurationRevisionIds].sort(),
    relatedPlaybackIds: [...ids.relatedPlaybackIds].sort(),
    resetEpochId,
  };
}

function createSelectionContext(
  evidence: FrozenSpecialCoreIncidentEvidence,
  cutoff: number,
) {
  const frames = evidence.frames.filter(
    (entry) =>
      entry.sampledAt <= evidence.frozenAt &&
      (entry.resetEpochId !== evidence.lease.resetEpochId ||
        entry.sequence <= evidence.lease.leasedThroughFrameSequence),
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  return {
    evidence,
    cutoff,
    frames,
    observations: evidence.observations.filter((entry) =>
      frameIds.has(entry.frameId),
    ),
    confirmationAttempts: evidence.confirmationAttempts,
    activations: evidence.activations,
    schedules: evidence.schedules,
    decisions: evidence.decisions,
    playbackAttempts: evidence.playbackAttempts,
    lifecycleEvents: evidence.lifecycleEvents,
    configurationRevisions: evidence.configurationRevisions,
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
  evidence: FrozenSpecialCoreIncidentEvidence;
  scenario: AlertIssueScenario | null | undefined;
  otherCategory: AlertIssueOtherCategory | null;
  candidate: IncidentCandidate;
  mediaFrameIds: string[];
  ambiguous: boolean;
}): SpecialCoreIncidentSelectionDegradationReason[] {
  const reasons = new Set<SpecialCoreIncidentSelectionDegradationReason>();
  if (ambiguous) reasons.add("ambiguous-incident");
  const mediaRequired =
    scenario === "not-recognized" || scenario === "wrong-target";
  if (mediaRequired && candidate.frameIds.length > mediaFrameIds.length) {
    reasons.add("selected-media-missing");
  }
  if (
    candidate.confirmationAttemptIds.some((id) => {
      const attempt = evidence.confirmationAttempts.find(
        (entry) => entry.id === id,
      );
      return !attempt || attempt.observationIds.length < 2;
    }) &&
    candidate.activationIds.length > 0
  ) {
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

function candidateContainsId(candidate: IncidentCandidate, id: string): boolean {
  return [
    candidate.resetEpochId,
    ...candidate.frameIds,
    ...candidate.observationIds,
    ...candidate.confirmationAttemptIds,
    ...candidate.activationIds,
    ...candidate.scheduleIds,
    ...candidate.decisionIds,
    ...candidate.playbackAttemptIds,
    ...candidate.eventIds,
    ...candidate.configurationRevisionIds,
    ...candidate.relatedPlaybackIds,
  ].includes(id);
}

function getScheduleWithoutDecisionConclusion(
  schedule: FrozenSpecialCoreIncidentEvidence["schedules"][number],
  frozenAt: number,
): SpecialCoreIncidentOperatorConclusion {
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
  kind: SpecialCoreIncidentEvidenceOmission["kind"],
  scenario: AlertIssueScenario | null | undefined,
  otherCategory: AlertIssueOtherCategory | null,
): boolean {
  if (scenario === "not-recognized" || scenario === "wrong-target") {
    return [
      "frame",
      "observation",
      "confirmation-attempt",
      "activation",
      "media",
    ].includes(kind);
  }
  if (scenario === "recognized-no-alert") {
    return [
      "observation",
      "confirmation-attempt",
      "activation",
      "schedule",
      "decision",
      "playback-attempt",
    ].includes(kind);
  }
  if (
    scenario === "playback-missing" ||
    scenario === "unexpected-playback"
  ) {
    return ["schedule", "decision", "playback-attempt", "event"].includes(
      kind,
    );
  }
  if (
    scenario === "duplicate-alert" ||
    scenario === "repeat-timing" ||
    scenario === "early-alert" ||
    scenario === "late-alert"
  ) {
    return [
      "confirmation-attempt",
      "activation",
      "schedule",
      "decision",
      "playback-attempt",
      "event",
    ].includes(kind);
  }
  if (scenario === "other") {
    return otherCategory === "sound-volume"
      ? ["configuration", "playback-attempt", "event"].includes(kind)
      : ["configuration", "reset-epoch", "event"].includes(kind);
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
): SpecialCoreIncidentOperatorConclusion {
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
): SpecialCoreIncidentOperatorConclusion {
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
  status: SpecialCoreReportIncidentSelection["status"],
  conclusion: SpecialCoreIncidentOperatorConclusion,
  degradation: SpecialCoreIncidentSelectionDegradationReason,
): SpecialCoreReportIncidentSelection {
  return {
    policy: "special-core-scenario-selection-v1",
    status,
    support: "unsupported",
    anchorKind: null,
    selectedEventAt: null,
    resetEpochId: null,
    candidateIds: [],
    frameIds: [],
    observationIds: [],
    confirmationAttemptIds: [],
    activationIds: [],
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

function isFrozenSpecialCoreIncidentEvidence(
  value: Record<string, unknown> | FrozenSpecialCoreIncidentEvidence,
): value is FrozenSpecialCoreIncidentEvidence {
  const record = value as Record<string, unknown>;
  const lease = record.lease;
  return (
    record.schemaVersion === SPECIAL_CORE_INCIDENT_EVIDENCE_SCHEMA_VERSION &&
    typeof record.frozenAt === "number" &&
    typeof record.leaseId === "string" &&
    typeof lease === "object" &&
    lease !== null &&
    "resetEpochId" in lease &&
    typeof lease.resetEpochId === "string" &&
    "leasedThroughFrameSequence" in lease &&
    typeof lease.leasedThroughFrameSequence === "number" &&
    [
      "resetEpochs",
      "configurationRevisions",
      "frames",
      "observations",
      "confirmationAttempts",
      "activations",
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

function getRelatedPlaybackEventAt(entry: {
  requestedAt: number;
  browserAcceptedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
}): number {
  return getPlaybackEventAt(entry);
}

function compareCandidates(
  left: IncidentCandidate,
  right: IncidentCandidate,
): number {
  return left.occurredAt - right.occurredAt || left.id.localeCompare(right.id);
}

function getCandidateSize(ids: Record<string, Set<string>>): number {
  return Object.values(ids).reduce((sum, entries) => sum + entries.size, 0);
}

function addNullable(ids: Set<string>, value: string | null): void {
  if (value !== null) ids.add(value);
}
