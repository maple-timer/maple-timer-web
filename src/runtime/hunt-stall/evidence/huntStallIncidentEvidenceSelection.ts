import type {
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../../contracts/reporting/alertIssueScenario";
import { HUNT_STALL_INCIDENT_CURRENT_WINDOW_MS } from "./huntStallIncidentEvidenceArchive";
import {
  HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION,
  type FrozenHuntStallIncidentEvidence,
  type HuntStallIncidentAlertCycle,
  type HuntStallIncidentConfigurationRevision,
  type HuntStallIncidentEvidenceOmission,
  type HuntStallIncidentLifecycleEvent,
  type HuntStallIncidentMode,
  type HuntStallIncidentPlaybackAttempt,
  type HuntStallIncidentSelectionDegradationReason,
  type HuntStallIncidentStallEpisode,
} from "./huntStallIncidentEvidenceTypes";

export type HuntStallIncidentOperatorConclusion =
  | "recognition-rejected"
  | "recognition-missing"
  | "recognition-unconfirmed"
  | "runtime-failure"
  | "episode-not-armed"
  | "episode-reset-before-threshold"
  | "threshold-not-reached"
  | "decision-suppressed"
  | "decision-stale"
  | "decision-blocked"
  | "decision-missing"
  | "decision-without-playback"
  | "playback-requested-only"
  | "playback-failed"
  | "physical-audibility-unverifiable"
  | "repeat-disabled"
  | "repeat-not-due"
  | "repeat-limit-reached"
  | "repeat-blocked-by-playback"
  | "repeat-decision-missing"
  | "repeat-not-applicable"
  | "false-alert-chain-found"
  | "same-cycle-alerts-found"
  | "separate-episode-alerts-found"
  | "playback-presentation-mismatch"
  | "playback-presentation-consistent"
  | "unrelated-feature-playback-found"
  | "sampled-region-found"
  | "sampled-region-unavailable"
  | "recognizer-output-found"
  | "temporal-correction-found"
  | "unstable-sequence-found"
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

export type HuntStallReportIncidentSelection = {
  policy: "hunt-stall-scenario-selection-v1";
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
    | "episode"
    | "cycle"
    | "decision"
    | "attempt"
    | "event"
    | "configuration"
    | "state"
    | null;
  selectedEventAt: number | null;
  mode: HuntStallIncidentMode | null;
  resetEpochId: string | null;
  candidateIds: string[];
  frameIds: string[];
  observationIds: string[];
  activityEpochIds: string[];
  stallEpisodeIds: string[];
  cycleIds: string[];
  decisionIds: string[];
  attemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
  mediaFrameIds: string[];
  relatedPlaybackIds: string[];
  ambiguous: boolean;
  operatorConclusion: HuntStallIncidentOperatorConclusion;
  physicalAudibility: "unknown";
  externalPlayerActivity: "unknown";
  degradationReasons: HuntStallIncidentSelectionDegradationReason[];
};

type SelectionContext = ReturnType<typeof createSelectionContext>;
type AnchorKind = Exclude<HuntStallReportIncidentSelection["anchorKind"], null>;

type IncidentCandidate = {
  id: string;
  anchorKind: AnchorKind;
  occurredAt: number;
  mode: HuntStallIncidentMode;
  resetEpochId: string;
  frameIds: string[];
  observationIds: string[];
  activityEpochIds: string[];
  stallEpisodeIds: string[];
  cycleIds: string[];
  decisionIds: string[];
  attemptIds: string[];
  eventIds: string[];
  configurationRevisionIds: string[];
  relatedPlaybackIds: string[];
  operatorConclusion: HuntStallIncidentOperatorConclusion;
  degradationReasons: HuntStallIncidentSelectionDegradationReason[];
};

type CandidateSeed = Partial<
  Pick<
    IncidentCandidate,
    | "frameIds"
    | "observationIds"
    | "activityEpochIds"
    | "stallEpisodeIds"
    | "cycleIds"
    | "decisionIds"
    | "attemptIds"
    | "eventIds"
    | "configurationRevisionIds"
    | "relatedPlaybackIds"
    | "degradationReasons"
  >
> & {
  id: string;
  anchorKind: AnchorKind;
  occurredAt: number;
  mode: HuntStallIncidentMode;
  resetEpochId: string;
  operatorConclusion: HuntStallIncidentOperatorConclusion;
};

export function selectHuntStallReportIncident({
  evidence,
  reason,
  scenario,
  occurrence,
  otherCategory = null,
}: {
  evidence:
    | FrozenHuntStallIncidentEvidence
    | Record<string, unknown>
    | null
    | undefined;
  reason: string;
  scenario: AlertIssueScenario | null | undefined;
  occurrence: AlertIssueOccurrence | null | undefined;
  otherCategory?: AlertIssueOtherCategory | null;
}): HuntStallReportIncidentSelection {
  if (!evidence) {
    return emptySelection(
      "unavailable",
      "evidence-unavailable",
      "never-produced",
    );
  }
  if (!isFrozenHuntStallIncidentEvidence(evidence)) {
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
      mode: evidence.lease.mode,
      resetEpochId: evidence.lease.resetEpochId,
    };
  }
  if (scenario === "repeat-missing" && evidence.lease.mode === "cooldown-presence") {
    return {
      ...emptySelection(
        "not-applicable",
        "repeat-not-applicable",
        "not-applicable",
      ),
      mode: evidence.lease.mode,
      resetEpochId: evidence.lease.resetEpochId,
      selectedEventAt: evidence.frozenAt,
      configurationRevisionIds: [evidence.lease.configRevisionId],
    };
  }
  if (
    scenario === "other" &&
    (otherCategory === null || otherCategory === "other")
  ) {
    return {
      ...emptySelection(
        "unavailable",
        "unsupported-other",
        "not-applicable",
      ),
      mode: evidence.lease.mode,
      resetEpochId: evidence.lease.resetEpochId,
    };
  }

  const cutoff =
    occurrence === "current"
      ? evidence.frozenAt - HUNT_STALL_INCIDENT_CURRENT_WINDOW_MS
      : evidence.frozenAt - 60_000;
  const context = createSelectionContext(evidence, cutoff);
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
    const reportTimeOnly = evidence.frames.some(
      (entry) =>
        entry.source === "report-time" &&
        entry.sampledAt >= cutoff &&
        entry.sampledAt <= evidence.frozenAt,
    );
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
      const selection = {
        ...emptySelection(
          "outside-retention",
          "evidence-outside-retention",
          "outside-retention",
        ),
        mode: evidence.lease.mode,
        resetEpochId: evidence.lease.resetEpochId,
      };
      if (reportTimeOnly) {
        selection.degradationReasons.push("report-time-only");
      }
      return selection;
    }
    if (reportTimeOnly) {
      return {
        ...emptySelection(
          "unavailable",
          "report-time-context-only",
          "report-time-only",
        ),
        mode: evidence.lease.mode,
        resetEpochId: evidence.lease.resetEpochId,
      };
    }
    const expired =
      evidence.omissions.some(
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
      mode: evidence.lease.mode,
      resetEpochId: evidence.lease.resetEpochId,
    };
  }

  const latest = candidates[candidates.length - 1];
  const equallyCompatible = candidates.filter(
    (entry) =>
      entry.id !== latest.id &&
      entry.occurredAt === latest.occurredAt &&
      (entry.resetEpochId !== latest.resetEpochId ||
        entry.stallEpisodeIds.join("|") !== latest.stallEpisodeIds.join("|")),
  );
  const ambiguous = equallyCompatible.length > 0;
  const mediaFrameIds = latest.frameIds.filter((frameId) =>
    evidence.media.some((entry) => entry.frameId === frameId),
  );
  const degradationReasons = collectDegradationReasons({
    evidence,
    scenario,
    candidate: latest,
    mediaFrameIds,
    ambiguous,
  });
  const physicalAudibilityOnly =
    (scenario === "playback-missing" || scenario === "unexpected-playback") &&
    latest.attemptIds.some((id) => {
      const attempt = evidence.playbackAttempts.find((entry) => entry.id === id);
      return attempt?.status === "started" || attempt?.status === "finished";
    });

  return {
    policy: "hunt-stall-scenario-selection-v1",
    status: occurrence === "current" ? "current-snapshot" : "matched",
    support:
      degradationReasons.length > 0 || physicalAudibilityOnly
        ? "partial"
        : "definitive",
    anchorKind: latest.anchorKind,
    selectedEventAt: latest.occurredAt,
    mode: latest.mode,
    resetEpochId: latest.resetEpochId,
    candidateIds: candidates.map((entry) => entry.id),
    frameIds: latest.frameIds,
    observationIds: latest.observationIds,
    activityEpochIds: latest.activityEpochIds,
    stallEpisodeIds: latest.stallEpisodeIds,
    cycleIds: latest.cycleIds,
    decisionIds: latest.decisionIds,
    attemptIds: latest.attemptIds,
    eventIds: latest.eventIds,
    configurationRevisionIds: latest.configurationRevisionIds,
    mediaFrameIds,
    relatedPlaybackIds: latest.relatedPlaybackIds,
    ambiguous,
    operatorConclusion: ambiguous
      ? "ambiguous-incident"
      : latest.operatorConclusion,
    physicalAudibility: "unknown",
    externalPlayerActivity: "unknown",
    degradationReasons,
  };
}

function createSelectionContext(
  evidence: FrozenHuntStallIncidentEvidence,
  cutoff: number,
) {
  const leaseEligibleFrames = evidence.frames.filter(
    (entry) =>
      (entry.source ?? "runtime") !== "report-time" &&
      entry.sequence <= evidence.lease.leasedThroughFrameSequence &&
      entry.sampledAt <= evidence.frozenAt,
  );
  const leaseEligibleFrameIds = new Set(
    leaseEligibleFrames.map((entry) => entry.id),
  );
  const frames = leaseEligibleFrames.filter(
    (entry) => entry.sampledAt >= cutoff,
  );
  const frameIds = new Set(frames.map((entry) => entry.id));
  const leaseEligibleObservations = evidence.observations.filter((entry) =>
    leaseEligibleFrameIds.has(entry.frameId),
  );
  const leaseEligibleObservationIds = new Set(
    leaseEligibleObservations.map((entry) => entry.id),
  );
  const observations = evidence.observations.filter(
    (entry) =>
      frameIds.has(entry.frameId) &&
      entry.sampledAt >= cutoff &&
      entry.sampledAt <= evidence.frozenAt,
  );
  const activityEpochs = evidence.activityEpochs.filter(
    (entry) =>
      leaseEligibleFrameIds.has(entry.anchorFrameId) &&
      leaseEligibleObservationIds.has(entry.anchorObservationId) &&
      entry.startedAt <= evidence.frozenAt &&
      ((entry.endedAt ?? entry.startedAt) >= cutoff ||
        entry.id === evidence.lease.activityEpochId),
  );
  const activityIds = new Set(activityEpochs.map((entry) => entry.id));
  const stallEpisodes = evidence.stallEpisodes.filter(
    (entry) =>
      activityIds.has(entry.activityEpochId) &&
      entry.startedAt <= evidence.frozenAt &&
      ((entry.lastEvaluation?.evaluatedAt ?? entry.endedAt ?? entry.startedAt) >=
        cutoff ||
        entry.id === evidence.lease.stallEpisodeId),
  );
  const episodeIds = new Set(stallEpisodes.map((entry) => entry.id));
  const alertCycles = evidence.alertCycles.filter(
    (entry) =>
      episodeIds.has(entry.stallEpisodeId) &&
      entry.startedAt <= evidence.frozenAt &&
      ((entry.endedAt ?? entry.startedAt) >= cutoff ||
        entry.id === evidence.lease.alertCycleId),
  );
  const cycleIds = new Set(alertCycles.map((entry) => entry.id));
  const decisions = evidence.decisions.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      leaseEligibleFrameIds.has(entry.frameId) &&
      leaseEligibleObservationIds.has(entry.observationId) &&
      entry.occurredAt <= evidence.frozenAt &&
      (entry.occurredAt >= cutoff ||
        entry.cycleId === evidence.lease.alertCycleId ||
        alertCycles.some(
          (cycle) =>
            cycle.id === entry.cycleId && cycle.initialDecisionId === entry.id,
        )),
  );
  const decisionIds = new Set(decisions.map((entry) => entry.id));
  const playbackAttempts = evidence.playbackAttempts.filter(
    (entry) =>
      cycleIds.has(entry.cycleId) &&
      (decisionIds.has(entry.decisionId) ||
        entry.id === evidence.lease.playbackAttemptId) &&
      getAttemptEventAt(entry) <= evidence.frozenAt &&
      (getAttemptEventAt(entry) >= cutoff ||
        entry.id === evidence.lease.playbackAttemptId),
  );
  const lifecycleEvents = evidence.lifecycleEvents.filter(
    (entry) =>
      entry.occurredAt >= cutoff &&
      entry.occurredAt <= evidence.frozenAt &&
      (!entry.frameId || leaseEligibleFrameIds.has(entry.frameId)) &&
      (!entry.observationId ||
        leaseEligibleObservationIds.has(entry.observationId)) &&
      (!entry.activityEpochId || activityIds.has(entry.activityEpochId)) &&
      (!entry.stallEpisodeId || episodeIds.has(entry.stallEpisodeId)) &&
      (!entry.cycleId || cycleIds.has(entry.cycleId)),
  );
  const configurationRevisions = evidence.configurationRevisions.filter(
    (entry) =>
      entry.capturedAt <= evidence.frozenAt &&
      (entry.capturedAt >= cutoff || entry.id === evidence.lease.configRevisionId),
  );
  return {
    evidence,
    cutoff,
    leaseEligibleFrames,
    leaseEligibleObservations,
    frames,
    observations,
    activityEpochs,
    stallEpisodes,
    alertCycles,
    decisions,
    playbackAttempts,
    lifecycleEvents,
    configurationRevisions,
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
  if (scenario === "not-recognized") return createRecognitionCandidates(context);
  if (scenario === "recognized-no-alert") return createNoAlertCandidates(context);
  if (scenario === "playback-missing") return createPlaybackCandidates(context);
  if (scenario === "repeat-missing") return createRepeatCandidates(context);
  if (scenario === "wrong-target") {
    return reason === "hunt-stall-reading"
      ? createRegionCandidates(context)
      : createFalseAlertCandidates(context);
  }
  if (scenario === "duplicate-alert") return createDuplicateCandidates(context);
  if (scenario === "unexpected-playback") {
    return createUnexpectedPlaybackCandidates(context);
  }
  if (scenario === "wrong-value") return createWrongValueCandidates(context);
  if (scenario === "unstable-value") return createUnstableCandidates(context);
  if (scenario === "other") {
    return createOtherCandidates(context, otherCategory);
  }
  return [];
}

function createRecognitionCandidates(context: SelectionContext): IncidentCandidate[] {
  return context.frames.flatMap((frame) => {
    const observations = context.observations.filter(
      (entry) => entry.frameId === frame.id,
    );
    const negative = observations.filter(
      (entry) =>
        !entry.recognition ||
        entry.recognition.decision === "rejected" ||
        entry.recognition.decision === "missing" ||
        entry.recognition.decision === "error",
    );
    const unconfirmed = observations.filter(
      (entry) =>
        entry.recognition?.decision === "accepted" &&
        [
          "baseline-established",
          "pending-progress",
          "presence-pending",
        ].includes(entry.transition?.kind ?? ""),
    );
    if (
      !frame.runtimeFailure &&
      observations.length > 0 &&
      negative.length === 0 &&
      unconfirmed.length === 0
    ) {
      return [];
    }
    const conclusion: HuntStallIncidentOperatorConclusion = frame.runtimeFailure
      ? "runtime-failure"
      : negative.some((entry) => entry.recognition?.decision === "rejected")
        ? "recognition-rejected"
        : negative.length > 0
          ? "recognition-missing"
          : "recognition-unconfirmed";
    return [
      expandCandidate(context, {
        id: `hunt-candidate:recognition:${frame.id}`,
        anchorKind: "frame",
        occurredAt: frame.sampledAt,
        mode: frame.mode,
        resetEpochId: frame.resetEpochId,
        frameIds: [frame.id],
        observationIds: [...negative, ...unconfirmed].map((entry) => entry.id),
        operatorConclusion: conclusion,
      }),
    ];
  });
}

function createNoAlertCandidates(context: SelectionContext): IncidentCandidate[] {
  const episodeCandidates = context.stallEpisodes.flatMap((episode) => {
    const evaluation = episode.lastEvaluation;
    if (
      !evaluation ||
      evaluation.evaluatedAt < context.cutoff ||
      evaluation.evaluatedAt > context.evidence.frozenAt
    ) {
      return [];
    }
    const decisions = context.decisions.filter(
      (entry) => entry.stallEpisodeId === episode.id,
    );
    if (evaluation.outcome === "alert" && decisions.length > 0) return [];
    const conclusion = getEvaluationConclusion(evaluation.outcome);
    return [
      expandCandidate(context, {
        id: `hunt-candidate:no-alert:${episode.id}:${evaluation.evaluatedAt}`,
        anchorKind: "episode",
        occurredAt: evaluation.evaluatedAt,
        mode: episode.mode,
        resetEpochId: episode.resetEpochId,
        frameIds: [evaluation.frameId],
        observationIds: [evaluation.observationId],
        stallEpisodeIds: [episode.id],
        operatorConclusion: conclusion,
      }),
    ];
  });
  const activityObservationIds = new Set(
    context.activityEpochs.map((entry) => entry.anchorObservationId),
  );
  const unarmedCandidates = context.observations
    .filter(
      (entry) =>
        !activityObservationIds.has(entry.id) &&
        entry.recognition?.decision === "accepted" &&
        [
          "baseline-established",
          "pending-progress",
          "presence-pending",
        ].includes(entry.transition?.kind ?? ""),
    )
    .map((observation) =>
      expandCandidate(context, {
        id: `hunt-candidate:not-armed:${observation.id}`,
        anchorKind: "observation",
        occurredAt: observation.sampledAt,
        mode: observation.mode,
        resetEpochId: observation.resetEpochId,
        observationIds: [observation.id],
        operatorConclusion: "episode-not-armed",
      }),
    );
  const resetCandidates = context.lifecycleEvents
    .filter(
      (entry) =>
        (entry.category === "lifecycle" || entry.category === "configuration") &&
        [
          "reset",
          "disabled",
          "mode-changed",
          "layout-changed",
          "region-changed",
          "stream-replaced",
          "profile-replaced",
          "preset-replaced",
          "global-disabled",
          "worker-reset",
        ].includes(entry.action),
    )
    .map((event) =>
      eventCandidate(context, event, "episode-reset-before-threshold"),
    );
  return [...episodeCandidates, ...unarmedCandidates, ...resetCandidates];
}

function createPlaybackCandidates(context: SelectionContext): IncidentCandidate[] {
  return context.decisions.map((decision) => {
    const attempts = context.playbackAttempts.filter(
      (entry) => entry.decisionId === decision.id,
    );
    const latestAttempt = attempts[attempts.length - 1];
    return expandCandidate(context, {
      id: `hunt-candidate:playback:${decision.id}`,
      anchorKind: latestAttempt ? "attempt" : "decision",
      occurredAt: latestAttempt ? getAttemptEventAt(latestAttempt) : decision.occurredAt,
      mode:
        context.alertCycles.find((entry) => entry.id === decision.cycleId)?.mode ??
        context.evidence.lease.mode,
      resetEpochId: decision.resetEpochId,
      decisionIds: [decision.id],
      attemptIds: attempts.map((entry) => entry.id),
      operatorConclusion: getPlaybackConclusion(latestAttempt),
    });
  });
}

function createRepeatCandidates(context: SelectionContext): IncidentCandidate[] {
  return context.alertCycles
    .filter((cycle) => cycle.mode === "manual-experience")
    .map((cycle) => {
      const decisions = context.decisions.filter((entry) => entry.cycleId === cycle.id);
      const attempts = context.playbackAttempts.filter(
        (entry) => entry.cycleId === cycle.id,
      );
      const config = getCycleConfiguration(context, cycle);
      const latestAttempt = attempts[attempts.length - 1];
      const repeatDecisions = decisions.filter((entry) => entry.kind === "repeat");
      const conclusion = getRepeatConclusion({
        frozenAt: context.evidence.frozenAt,
        config,
        latestAttempt,
        repeatDecisionCount: repeatDecisions.length,
      });
      const hasEvaluationEvent = context.lifecycleEvents.some(
        (entry) =>
          entry.category === "decision" &&
          entry.cycleId === cycle.id &&
          entry.action.startsWith("repeat-"),
      );
      return expandCandidate(context, {
        id: `hunt-candidate:repeat:${cycle.id}`,
        anchorKind: "cycle",
        occurredAt: context.evidence.frozenAt,
        mode: cycle.mode,
        resetEpochId: cycle.resetEpochId,
        cycleIds: [cycle.id],
        decisionIds: decisions.map((entry) => entry.id),
        attemptIds: attempts.map((entry) => entry.id),
        configurationRevisionIds: config ? [config.id] : [],
        operatorConclusion: conclusion,
        degradationReasons: hasEvaluationEvent ? [] : ["never-produced"],
      });
    });
}

function createFalseAlertCandidates(context: SelectionContext): IncidentCandidate[] {
  return context.decisions
    .filter((entry) => entry.kind === "initial")
    .map((decision) =>
      expandCandidate(context, {
        id: `hunt-candidate:false-alert:${decision.id}`,
        anchorKind: "decision",
        occurredAt: decision.occurredAt,
        mode:
          context.alertCycles.find((entry) => entry.id === decision.cycleId)?.mode ??
          context.evidence.lease.mode,
        resetEpochId: decision.resetEpochId,
        decisionIds: [decision.id],
        operatorConclusion: "false-alert-chain-found",
      }),
    );
}

function createDuplicateCandidates(context: SelectionContext): IncidentCandidate[] {
  const byCycle = context.alertCycles.flatMap((cycle) => {
    const decisions = context.decisions.filter((entry) => entry.cycleId === cycle.id);
    if (decisions.length < 2) return [];
    return [
      expandCandidate(context, {
        id: `hunt-candidate:duplicate:${cycle.id}`,
        anchorKind: "cycle",
        occurredAt: decisions[decisions.length - 1].occurredAt,
        mode: cycle.mode,
        resetEpochId: cycle.resetEpochId,
        cycleIds: [cycle.id],
        decisionIds: decisions.map((entry) => entry.id),
        attemptIds: context.playbackAttempts
          .filter((entry) => entry.cycleId === cycle.id)
          .map((entry) => entry.id),
        operatorConclusion: "same-cycle-alerts-found",
      }),
    ];
  });
  if (byCycle.length > 0) return byCycle;
  const decisions = [...context.decisions].sort(
    (left, right) => left.occurredAt - right.occurredAt,
  );
  if (decisions.length < 2) return [];
  const selected = decisions.slice(-2);
  const latest = selected[1];
  const cycle = context.alertCycles.find((entry) => entry.id === latest.cycleId);
  return [
    expandCandidate(context, {
      id: `hunt-candidate:duplicate:episodes:${selected.map((entry) => entry.id).join(":")}`,
      anchorKind: "decision",
      occurredAt: latest.occurredAt,
      mode: cycle?.mode ?? context.evidence.lease.mode,
      resetEpochId: latest.resetEpochId,
      decisionIds: selected.map((entry) => entry.id),
      operatorConclusion: "separate-episode-alerts-found",
    }),
  ];
}

function createUnexpectedPlaybackCandidates(
  context: SelectionContext,
): IncidentCandidate[] {
  const huntAttempts = context.playbackAttempts.map((attempt) => {
    const presentationFound = context.lifecycleEvents.some(
      (event) =>
        event.category === "presentation" &&
        (event.attemptId === attempt.id || event.cycleId === attempt.cycleId),
    );
    return expandCandidate(context, {
      id: `hunt-candidate:unexpected-playback:${attempt.id}`,
      anchorKind: "attempt",
      occurredAt: getAttemptEventAt(attempt),
      mode:
        context.alertCycles.find((entry) => entry.id === attempt.cycleId)?.mode ??
        context.evidence.lease.mode,
      resetEpochId: attempt.resetEpochId,
      attemptIds: [attempt.id],
      operatorConclusion: presentationFound
        ? "playback-presentation-consistent"
        : "playback-presentation-mismatch",
    });
  });
  if (huntAttempts.length > 0) return huntAttempts;
  return context.evidence.relatedPlayback
    .filter(
      (entry) =>
        entry.requestedAt <= context.evidence.frozenAt &&
        entry.requestedAt >= context.cutoff,
    )
    .map((entry) =>
      expandCandidate(context, {
        id: `hunt-candidate:related-playback:${entry.id}`,
        anchorKind: "attempt",
        occurredAt:
          entry.finishedAt ?? entry.failedAt ?? entry.startedAt ?? entry.requestedAt,
        mode: context.evidence.lease.mode,
        resetEpochId: context.evidence.lease.resetEpochId,
        relatedPlaybackIds: [entry.id],
        operatorConclusion: "unrelated-feature-playback-found",
      }),
    );
}

function createRegionCandidates(context: SelectionContext): IncidentCandidate[] {
  return context.frames.map((frame) =>
    expandCandidate(context, {
      id: `hunt-candidate:region:${frame.id}`,
      anchorKind: "frame",
      occurredAt: frame.sampledAt,
      mode: frame.mode,
      resetEpochId: frame.resetEpochId,
      frameIds: [frame.id],
      operatorConclusion: frame.region
        ? "sampled-region-found"
        : "sampled-region-unavailable",
      degradationReasons: frame.region ? [] : ["never-produced"],
    }),
  );
}

function createWrongValueCandidates(context: SelectionContext): IncidentCandidate[] {
  return context.observations
    .filter((entry) => entry.recognition)
    .map((observation) => {
      const recognition = observation.recognition!;
      const corrected =
        recognition.rawValue !== null &&
        recognition.correctedValue !== null &&
        recognition.rawValue !== recognition.correctedValue;
      return expandCandidate(context, {
        id: `hunt-candidate:value:${observation.id}`,
        anchorKind: "observation",
        occurredAt: observation.sampledAt,
        mode: observation.mode,
        resetEpochId: observation.resetEpochId,
        observationIds: [observation.id],
        operatorConclusion: corrected
          ? "temporal-correction-found"
          : "recognizer-output-found",
      });
    });
}

function createUnstableCandidates(context: SelectionContext): IncidentCandidate[] {
  return context.activityEpochs.flatMap((activity) => {
    const observations = context.observations.filter(
      (entry) =>
        entry.resetEpochId === activity.resetEpochId &&
        entry.mode === activity.mode &&
        entry.sampledAt >= activity.startedAt &&
        entry.sampledAt <= (activity.endedAt ?? context.evidence.frozenAt),
    );
    const values = new Set(
      observations.flatMap((entry) => {
        const value =
          entry.recognition?.correctedValue ??
          entry.recognition?.rawValue ??
          entry.recognition?.fingerprint;
        return value === null || value === undefined ? [] : [String(value)];
      }),
    );
    const unstable = observations.some((entry) =>
      ["pending-progress", "rejected", "unreadable", "rearmed"].includes(
        entry.transition?.kind ?? "",
      ),
    );
    if (observations.length < 2 || (!unstable && values.size < 2)) return [];
    return [
      expandCandidate(context, {
        id: `hunt-candidate:unstable:${activity.id}`,
        anchorKind: "observation",
        occurredAt: observations[observations.length - 1].sampledAt,
        mode: activity.mode,
        resetEpochId: activity.resetEpochId,
        observationIds: observations.map((entry) => entry.id),
        activityEpochIds: [activity.id],
        operatorConclusion: "unstable-sequence-found",
        degradationReasons:
          observations.length < 3 ? ["sequence-incomplete"] : [],
      }),
    ];
  });
}

function createOtherCandidates(
  context: SelectionContext,
  category: AlertIssueOtherCategory | null,
): IncidentCandidate[] {
  if (category === "status-display") {
    const events = context.lifecycleEvents.filter(
      (entry) => entry.category === "presentation",
    );
    if (events.length > 0) {
      return events.map((event) =>
        eventCandidate(context, event, "presentation-event-found"),
      );
    }
    const state = context.evidence.frozenState;
    const stateFrameId =
      state?.latestFrameId &&
      context.leaseEligibleFrames.some(
        (entry) => entry.id === state.latestFrameId,
      )
        ? state.latestFrameId
        : null;
    const stateObservationId =
      state?.latestObservationId &&
      context.leaseEligibleObservations.some(
        (entry) => entry.id === state.latestObservationId,
      )
        ? state.latestObservationId
        : null;
    return state
      ? [
          expandCandidate(context, {
            id: `hunt-candidate:presentation-state:${context.evidence.leaseId}`,
            anchorKind: "state",
            occurredAt: state.capturedAt,
            mode: state.mode,
            resetEpochId: state.resetEpochId,
            frameIds: stateFrameId ? [stateFrameId] : [],
            observationIds: stateObservationId ? [stateObservationId] : [],
            eventIds: [],
            configurationRevisionIds: [state.configRevisionId],
            operatorConclusion: "presentation-state-only",
            degradationReasons: ["never-produced"],
          }),
        ]
      : [];
  }
  if (category === "sound-volume") {
    if (context.playbackAttempts.length > 0) {
      return context.playbackAttempts.map((attempt) =>
        expandCandidate(context, {
          id: `hunt-candidate:audio:${attempt.id}`,
          anchorKind: "attempt",
          occurredAt: getAttemptEventAt(attempt),
          mode:
            context.alertCycles.find((entry) => entry.id === attempt.cycleId)
              ?.mode ?? context.evidence.lease.mode,
          resetEpochId: attempt.resetEpochId,
          attemptIds: [attempt.id],
          operatorConclusion: "audio-configuration-found",
        }),
      );
    }
    return context.configurationRevisions.map((config) =>
      configurationCandidate(context, config, "audio-configuration-found"),
    );
  }
  if (category === "settings-preset") {
    const events = context.lifecycleEvents.filter(
      (entry) =>
        entry.category === "configuration" ||
        (entry.category === "lifecycle" && entry.action.includes("reset")),
    );
    return events.length > 0
      ? events.map((event) =>
          eventCandidate(context, event, "configuration-transition-found"),
        )
      : context.configurationRevisions.map((config) =>
          configurationCandidate(
            context,
            config,
            "configuration-transition-found",
          ),
        );
  }
  if (category === "performance-error") {
    const frameCandidates = context.frames
      .filter((entry) => entry.runtimeFailure)
      .map((frame) =>
        expandCandidate(context, {
          id: `hunt-candidate:runtime-error:${frame.id}`,
          anchorKind: "frame",
          occurredAt: frame.sampledAt,
          mode: frame.mode,
          resetEpochId: frame.resetEpochId,
          frameIds: [frame.id],
          operatorConclusion: "runtime-error-found",
        }),
      );
    const events = context.lifecycleEvents
      .filter((entry) => entry.category === "runtime-error")
      .map((event) => eventCandidate(context, event, "runtime-error-found"));
    return [...frameCandidates, ...events];
  }
  if (category === "interaction") {
    return context.lifecycleEvents
      .filter((entry) => entry.category === "interaction")
      .map((event) => eventCandidate(context, event, "interaction-event-found"));
  }
  return [];
}

function eventCandidate(
  context: SelectionContext,
  event: HuntStallIncidentLifecycleEvent,
  conclusion: HuntStallIncidentOperatorConclusion,
): IncidentCandidate {
  const reset = context.evidence.resetEpochs.find(
    (entry) => entry.id === event.resetEpochId,
  );
  return expandCandidate(context, {
    id: `hunt-candidate:event:${event.id}`,
    anchorKind: "event",
    occurredAt: event.occurredAt,
    mode: reset?.continuity.mode ?? context.evidence.lease.mode,
    resetEpochId: event.resetEpochId,
    eventIds: [event.id],
    operatorConclusion: conclusion,
  });
}

function configurationCandidate(
  context: SelectionContext,
  config: HuntStallIncidentConfigurationRevision,
  conclusion: HuntStallIncidentOperatorConclusion,
): IncidentCandidate {
  return expandCandidate(context, {
    id: `hunt-candidate:configuration:${config.id}`,
    anchorKind: "configuration",
    occurredAt: config.capturedAt,
    mode: config.values.mode,
    resetEpochId: config.resetEpochId,
    configurationRevisionIds: [config.id],
    operatorConclusion: conclusion,
  });
}

function expandCandidate(
  context: SelectionContext,
  seed: CandidateSeed,
): IncidentCandidate {
  const ids = {
    frameIds: new Set(seed.frameIds ?? []),
    observationIds: new Set(seed.observationIds ?? []),
    activityEpochIds: new Set(seed.activityEpochIds ?? []),
    stallEpisodeIds: new Set(seed.stallEpisodeIds ?? []),
    cycleIds: new Set(seed.cycleIds ?? []),
    decisionIds: new Set(seed.decisionIds ?? []),
    attemptIds: new Set(seed.attemptIds ?? []),
    eventIds: new Set(seed.eventIds ?? []),
    configurationRevisionIds: new Set(seed.configurationRevisionIds ?? []),
  };
  for (let pass = 0; pass < 4; pass += 1) {
    for (const attempt of context.playbackAttempts) {
      if (!ids.attemptIds.has(attempt.id)) continue;
      ids.decisionIds.add(attempt.decisionId);
      ids.cycleIds.add(attempt.cycleId);
      ids.stallEpisodeIds.add(attempt.stallEpisodeId);
      ids.activityEpochIds.add(attempt.activityEpochId);
      ids.configurationRevisionIds.add(attempt.configRevisionId);
    }
    for (const decision of context.decisions) {
      if (!ids.decisionIds.has(decision.id)) continue;
      ids.frameIds.add(decision.frameId);
      ids.observationIds.add(decision.observationId);
      ids.cycleIds.add(decision.cycleId);
      ids.stallEpisodeIds.add(decision.stallEpisodeId);
      ids.activityEpochIds.add(decision.activityEpochId);
      ids.configurationRevisionIds.add(decision.configRevisionId);
    }
    for (const cycle of context.alertCycles) {
      if (!ids.cycleIds.has(cycle.id)) continue;
      if (
        context.decisions.some(
          (entry) => entry.id === cycle.initialDecisionId,
        )
      ) {
        ids.decisionIds.add(cycle.initialDecisionId);
      }
      ids.stallEpisodeIds.add(cycle.stallEpisodeId);
      ids.activityEpochIds.add(cycle.activityEpochId);
    }
    for (const episode of context.stallEpisodes) {
      if (!ids.stallEpisodeIds.has(episode.id)) continue;
      ids.activityEpochIds.add(episode.activityEpochId);
    }
    for (const activity of context.activityEpochs) {
      if (!ids.activityEpochIds.has(activity.id)) continue;
      ids.frameIds.add(activity.anchorFrameId);
      ids.observationIds.add(activity.anchorObservationId);
    }
    for (const observation of context.leaseEligibleObservations) {
      if (ids.observationIds.has(observation.id)) {
        ids.frameIds.add(observation.frameId);
      }
    }
    for (const frame of context.leaseEligibleFrames) {
      if (ids.frameIds.has(frame.id)) {
        ids.configurationRevisionIds.add(frame.configRevisionId);
      }
    }
    for (const event of context.lifecycleEvents) {
      if (!ids.eventIds.has(event.id)) continue;
      if (event.frameId) ids.frameIds.add(event.frameId);
      if (event.observationId) ids.observationIds.add(event.observationId);
      if (event.activityEpochId) ids.activityEpochIds.add(event.activityEpochId);
      if (event.stallEpisodeId) ids.stallEpisodeIds.add(event.stallEpisodeId);
      if (event.cycleId) ids.cycleIds.add(event.cycleId);
      if (event.attemptId) ids.attemptIds.add(event.attemptId);
      if (event.configRevisionId) {
        ids.configurationRevisionIds.add(event.configRevisionId);
      }
    }
  }
  return {
    id: seed.id,
    anchorKind: seed.anchorKind,
    occurredAt: seed.occurredAt,
    mode: seed.mode,
    resetEpochId: seed.resetEpochId,
    frameIds: [...ids.frameIds],
    observationIds: [...ids.observationIds],
    activityEpochIds: [...ids.activityEpochIds],
    stallEpisodeIds: [...ids.stallEpisodeIds],
    cycleIds: [...ids.cycleIds],
    decisionIds: [...ids.decisionIds],
    attemptIds: [...ids.attemptIds],
    eventIds: [...ids.eventIds],
    configurationRevisionIds: [...ids.configurationRevisionIds],
    relatedPlaybackIds: seed.relatedPlaybackIds ?? [],
    operatorConclusion: seed.operatorConclusion,
    degradationReasons: seed.degradationReasons ?? [],
  };
}

function collectDegradationReasons({
  evidence,
  scenario,
  candidate,
  mediaFrameIds,
  ambiguous,
}: {
  evidence: FrozenHuntStallIncidentEvidence;
  scenario: AlertIssueScenario | null | undefined;
  candidate: IncidentCandidate;
  mediaFrameIds: string[];
  ambiguous: boolean;
}): HuntStallIncidentSelectionDegradationReason[] {
  const reasons = new Set(candidate.degradationReasons);
  if (ambiguous) reasons.add("ambiguous-incident");
  const imageRequired = [
    "not-recognized",
    "wrong-target",
    "wrong-value",
    "unstable-value",
  ].includes(scenario ?? "");
  if (imageRequired && candidate.frameIds.length > 0 && mediaFrameIds.length === 0) {
    const matchingOmission = evidence.omissions.find(
      (entry) =>
        entry.kind === "media" &&
        (entry.subjectIds.length === 0 ||
          entry.subjectIds.some((id) => candidate.frameIds.includes(id))),
    );
    reasons.add(matchingOmission?.reason ?? "never-produced");
  }
  if (
    scenario === "not-recognized" &&
    candidate.observationIds.length === 0
  ) {
    const omission = evidence.omissions.find(
      (entry) => entry.kind === "observation",
    );
    if (omission) reasons.add(omission.reason);
  }
  if (
    scenario === "recognized-no-alert" &&
    candidate.decisionIds.length === 0
  ) {
    const omission = evidence.omissions.find((entry) => entry.kind === "decision");
    if (omission) reasons.add(omission.reason);
  }
  if (
    (scenario === "playback-missing" || scenario === "repeat-missing") &&
    candidate.attemptIds.length === 0
  ) {
    const omission = evidence.omissions.find((entry) => entry.kind === "attempt");
    if (omission) reasons.add(omission.reason);
  }
  const selectedIds = new Set([
    ...candidate.frameIds,
    ...candidate.observationIds,
    ...candidate.activityEpochIds,
    ...candidate.stallEpisodeIds,
    ...candidate.cycleIds,
    ...candidate.decisionIds,
    ...candidate.attemptIds,
    ...candidate.eventIds,
    ...candidate.configurationRevisionIds,
  ]);
  for (const omission of evidence.omissions) {
    if (omission.subjectIds.some((id) => selectedIds.has(id))) {
      reasons.add(omission.reason);
    }
  }
  const selectedPlaybackStarted = candidate.attemptIds.some((id) => {
    const attempt = evidence.playbackAttempts.find((entry) => entry.id === id);
    return attempt?.status === "started" || attempt?.status === "finished";
  });
  const selectedRelatedPlaybackStarted = candidate.relatedPlaybackIds.some((id) => {
    const attempt = evidence.relatedPlayback.find((entry) => entry.id === id);
    return attempt?.status === "started" || attempt?.status === "finished";
  });
  if (
    (scenario === "playback-missing" || scenario === "unexpected-playback") &&
    (selectedPlaybackStarted || selectedRelatedPlaybackStarted)
  ) {
    reasons.add("physical-audibility-unknown");
  }
  return [...reasons];
}

function getEvaluationConclusion(
  outcome: NonNullable<HuntStallIncidentStallEpisode["lastEvaluation"]>["outcome"],
): HuntStallIncidentOperatorConclusion {
  switch (outcome) {
    case "not-due":
      return "threshold-not-reached";
    case "suppressed":
      return "decision-suppressed";
    case "stale":
      return "decision-stale";
    case "blocked":
      return "decision-blocked";
    case "alert":
      return "decision-missing";
  }
}

function getPlaybackConclusion(
  attempt: HuntStallIncidentPlaybackAttempt | undefined,
): HuntStallIncidentOperatorConclusion {
  if (!attempt) return "decision-without-playback";
  if (attempt.status === "failed") return "playback-failed";
  if (attempt.status === "requested") return "playback-requested-only";
  return "physical-audibility-unverifiable";
}

function getRepeatConclusion({
  frozenAt,
  config,
  latestAttempt,
  repeatDecisionCount,
}: {
  frozenAt: number;
  config: HuntStallIncidentConfigurationRevision | null;
  latestAttempt: HuntStallIncidentPlaybackAttempt | undefined;
  repeatDecisionCount: number;
}): HuntStallIncidentOperatorConclusion {
  if (!config?.values.repeatAlertEnabled) return "repeat-disabled";
  if (
    config.values.repeatAlertMaxCount !== null &&
    repeatDecisionCount >= config.values.repeatAlertMaxCount
  ) {
    return "repeat-limit-reached";
  }
  if (
    !latestAttempt ||
    latestAttempt.status === "requested" ||
    latestAttempt.status === "started"
  ) {
    return "repeat-blocked-by-playback";
  }
  if (latestAttempt.status === "failed") return "repeat-blocked-by-playback";
  const intervalMs = (config.values.repeatAlertIntervalSeconds ?? 0) * 1_000;
  if ((latestAttempt.finishedAt ?? latestAttempt.requestedAt) + intervalMs > frozenAt) {
    return "repeat-not-due";
  }
  return "repeat-decision-missing";
}

function getCycleConfiguration(
  context: SelectionContext,
  cycle: HuntStallIncidentAlertCycle,
): HuntStallIncidentConfigurationRevision | null {
  const decision = context.decisions.find(
    (entry) => entry.id === cycle.initialDecisionId,
  );
  return (
    context.evidence.configurationRevisions.find(
      (entry) => entry.id === decision?.configRevisionId,
    ) ?? null
  );
}

function getAttemptEventAt(entry: HuntStallIncidentPlaybackAttempt): number {
  return entry.finishedAt ?? entry.failedAt ?? entry.startedAt ?? entry.requestedAt;
}

function isOmissionRelevant(
  kind: HuntStallIncidentEvidenceOmission["kind"],
  scenario: AlertIssueScenario | null | undefined,
  otherCategory: AlertIssueOtherCategory | null,
): boolean {
  if (scenario === "not-recognized") {
    return kind === "frame" || kind === "observation";
  }
  if (scenario === "recognized-no-alert") {
    return ["frame", "observation", "activity-epoch", "stall-episode", "decision"].includes(
      kind,
    );
  }
  if (scenario === "playback-missing") {
    return kind === "decision" || kind === "attempt";
  }
  if (scenario === "repeat-missing") {
    return kind === "cycle" || kind === "decision" || kind === "attempt";
  }
  if (scenario === "duplicate-alert" || scenario === "unexpected-playback") {
    return ["cycle", "decision", "attempt", "event"].includes(kind);
  }
  if (
    scenario === "wrong-target" ||
    scenario === "wrong-value" ||
    scenario === "unstable-value"
  ) {
    return [
      "frame",
      "observation",
      "activity-epoch",
      "stall-episode",
      "decision",
      "media",
    ].includes(kind);
  }
  if (scenario !== "other") return false;
  if (otherCategory === "sound-volume") {
    return kind === "configuration" || kind === "attempt" || kind === "event";
  }
  if (otherCategory === "settings-preset") {
    return kind === "reset-epoch" || kind === "configuration" || kind === "event";
  }
  if (otherCategory === "performance-error") {
    return kind === "frame" || kind === "observation" || kind === "event";
  }
  return kind === "event";
}

function emptySelection(
  status: HuntStallReportIncidentSelection["status"],
  conclusion: HuntStallIncidentOperatorConclusion,
  degradation: HuntStallIncidentSelectionDegradationReason,
): HuntStallReportIncidentSelection {
  return {
    policy: "hunt-stall-scenario-selection-v1",
    status,
    support: "unsupported",
    anchorKind: null,
    selectedEventAt: null,
    mode: null,
    resetEpochId: null,
    candidateIds: [],
    frameIds: [],
    observationIds: [],
    activityEpochIds: [],
    stallEpisodeIds: [],
    cycleIds: [],
    decisionIds: [],
    attemptIds: [],
    eventIds: [],
    configurationRevisionIds: [],
    mediaFrameIds: [],
    relatedPlaybackIds: [],
    ambiguous: false,
    operatorConclusion: conclusion,
    physicalAudibility: "unknown",
    externalPlayerActivity: "unknown",
    degradationReasons: [degradation],
  };
}

function isFrozenHuntStallIncidentEvidence(
  value: FrozenHuntStallIncidentEvidence | Record<string, unknown>,
): value is FrozenHuntStallIncidentEvidence {
  const record = value as Record<string, unknown>;
  const lease = record.lease as Record<string, unknown> | null | undefined;
  if (
    record.schemaVersion !== HUNT_STALL_INCIDENT_EVIDENCE_SCHEMA_VERSION ||
    typeof record.frozenAt !== "number" ||
    !Number.isFinite(record.frozenAt) ||
    typeof record.leaseId !== "string" ||
    !lease ||
    typeof lease !== "object" ||
    typeof lease.id !== "string" ||
    typeof lease.resetEpochId !== "string" ||
    typeof lease.configRevisionId !== "string" ||
    typeof lease.frozenAt !== "number" ||
    typeof lease.leasedThroughFrameSequence !== "number" ||
    (lease.mode !== "manual-experience" && lease.mode !== "cooldown-presence")
  ) {
    return false;
  }
  return [
    "resetEpochs",
    "configurationRevisions",
    "frames",
    "observations",
    "activityEpochs",
    "stallEpisodes",
    "alertCycles",
    "decisions",
    "playbackAttempts",
    "lifecycleEvents",
    "media",
    "omissions",
    "relatedPlayback",
  ].every((key) => Array.isArray(record[key]));
}
