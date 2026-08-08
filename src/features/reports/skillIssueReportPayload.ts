import type {
  SkillTraceSample,
  SkillReportTimeline,
  SkillSnapshot,
} from "../../alertTypes";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import type {
  RelativeRegion,
  SkillConfig,
  SkillRuntimeState,
} from "../../types";
import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import {
  COOLDOWN_DIGIT_RECOGNIZER_VERSION,
} from "../../contracts/recognition/cooldownDigitRecognition";
import { BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION } from "../../recognition/skill-precision/remaining-count/bottomRightRemainingCountContract";
import { getSkillBuffDurationTargetForSkill } from "../../lib/skillBuffDuration/skillBuffDurationTargets";
import { getSkillAlertInRemainingCount } from "../../lib/timer";
import {
  getSkillConfigSnapshot,
  type AlertIssueReportDetails,
  type CaptureDiagnostics,
  type ReportBase,
} from "./alertReportPayloadShared";
import type {
  RuntimeParserEvidence,
  RuntimeReportEvidenceEnvelope,
} from "../../contracts/reporting/runtimeReportEvidence";
import {
  buildReportIncident,
  countPresentReportMedia,
  createReportEvidenceReference,
} from "./reportIncidentEvidence";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import type { SkillIncidentReportEvidence } from "../../runtime/skill-alert/evidence/skillIncidentReportEvidence";

type SkillRuntimeEvidenceMetadata = Pick<
  RuntimeReportEvidenceEnvelope,
  "sampledAt" | "source" | "parser"
>;

export function buildSkillIssueReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  skill,
  currentRegion,
  snapshot,
  state,
  stateBefore = null,
  runtimeTraceSample = null,
  estimatedRemainingSeconds,
  alertInSeconds,
  timeline,
  runtimeEvidence,
  skillEvidence = null,
  relatedActiveSkills,
  issue,
  journalSelection = null,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  skill: SkillConfig;
  currentRegion: RelativeRegion | null;
  snapshot: SkillSnapshot;
  state: SkillRuntimeState;
  stateBefore?: SkillRuntimeState | null;
  runtimeTraceSample?: SkillTraceSample | null;
  estimatedRemainingSeconds: number | null;
  alertInSeconds: number | null;
  timeline?: SkillReportTimeline | null;
  runtimeEvidence?: SkillRuntimeEvidenceMetadata | null;
  skillEvidence?: SkillIncidentReportEvidence | null;
  relatedActiveSkills?: SkillConfig[];
  issue: AlertIssueReportDetails;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  const serializedTimeline = serializeSkillReportTimeline(timeline);
  const candidateImages = snapshot.buffDuration?.candidateIcons
    ?.map((candidate) => candidate.imageDataUrl)
    .filter((value): value is string => Boolean(value)) ?? [];
  const latestPlayback =
    serializedTimeline.alertEvents[serializedTimeline.alertEvents.length - 1] ?? null;
  const runtimeFrames = serializedTimeline.frames;
  const latestRuntimeFrame = runtimeFrames[runtimeFrames.length - 1] ?? null;
  const hasAtomicRuntimeFrame = runtimeFrames.some(
    (frame) => Boolean(frame.stateBefore && frame.stateAfter),
  );
  const hasSkillIncidentContract = skillEvidence !== null;
  const hasSelectedIncidentEvidence = Boolean(
    skillEvidence &&
      (skillEvidence.frames.length ||
        skillEvidence.observations.length ||
        skillEvidence.cycles.length ||
        skillEvidence.decisions.length ||
        skillEvidence.playbackAttempts.length ||
        skillEvidence.lifecycle.length),
  );
  const selectedIncidentCycleId =
    hasSkillIncidentContract
      ? skillEvidence.selection.cycleIds[0] ?? skillEvidence.cycles[0]?.id ?? null
      : latestPlayback?.alertCycleStartedAt ?? null;
  const selectedIncidentSampledAt =
    hasSkillIncidentContract
      ? skillEvidence.selection.selectedEventAt
      : runtimeEvidence?.sampledAt ??
        latestRuntimeFrame?.sampledAt ??
        snapshot.sampledAt;
  const latestIncidentAttempt = skillEvidence?.playbackAttempts.reduce(
    (latest, attempt) =>
      !latest || attempt.requestedAt > latest.requestedAt ? attempt : latest,
    skillEvidence.playbackAttempts[0] ?? null,
  ) ?? null;
  const incidentMediaCount =
    skillEvidence?.media.filter((entry) => Boolean(entry.dataUrl)).length ?? 0;
  const legacyMediaCount =
    countPresentReportMedia(snapshot.rawPreviewUrl, snapshot.previewUrl) +
    candidateImages.length +
    runtimeFrames.reduce(
      (count, frame) =>
        countPresentReportMedia(frame.rawDataUrl, frame.processedDataUrl) + count,
      0,
    );
  const incident = buildReportIncident({
    feature: "skill",
    issue,
    submittedAt,
    source:
      hasSkillIncidentContract
        ? hasSelectedIncidentEvidence
          ? "runtime-atomic"
          : "report-capture"
        : runtimeEvidence || hasAtomicRuntimeFrame
          ? "runtime-atomic"
          : "report-capture",
    sampledAt: selectedIncidentSampledAt,
    timestamps: hasSkillIncidentContract
      ? getSkillIncidentTimestamps(skillEvidence)
      : [
          ...serializedTimeline.samples.map((entry) => entry.sampledAt),
          ...serializedTimeline.alertEvents.map((entry) => entry.startedAt),
          ...runtimeFrames.map((entry) => entry.sampledAt),
        ],
    stateBinding:
      hasSkillIncidentContract
        ? skillEvidence.frames.length
          ? "before-after"
          : "unavailable"
        : stateBefore || hasAtomicRuntimeFrame
          ? "before-after"
          : "after-only",
    mediaCount: hasSkillIncidentContract ? incidentMediaCount : legacyMediaCount,
    cycleId: selectedIncidentCycleId,
    journalSelection,
    evidenceReferences: [
      createReportEvidenceReference({
        id: "skill-source",
        kind: "sourceImage",
        paths: hasSkillIncidentContract
          ? ["sample.skillEvidence.media"]
          : [
              "sample.source.dataUrl",
              "sample.rawDataUrl",
              "sample.processedDataUrl",
              "sample.buffDuration.candidateIcons",
              "skill.runtimeTimeline.frames",
            ],
        capturedAt: selectedIncidentSampledAt,
        frameId:
          hasSkillIncidentContract
            ? skillEvidence.selection.frameIds[0] ?? null
            : `frame:${selectedIncidentSampledAt}`,
        cycleId: selectedIncidentCycleId,
      }),
      createReportEvidenceReference({
        id: "skill-trace",
        kind: "temporalTrace",
        paths: hasSkillIncidentContract
          ? [
              "sample.skillEvidence.frames",
              "sample.skillEvidence.observations",
              "sample.skillEvidence.cycles",
              "sample.skillEvidence.lifecycle",
            ]
          : ["skill.runtimeTimeline.samples", "skill.runtimeTimeline.frames"],
        capturedAt: selectedIncidentSampledAt,
        frameId: null,
        cycleId: selectedIncidentCycleId,
      }),
      createReportEvidenceReference({
        id: "skill-state-binding",
        kind: "stateBeforeAfter",
        paths: hasSkillIncidentContract
          ? skillEvidence.frames.length
            ? ["sample.skillEvidence.frames"]
            : []
          : [
              ...(stateBefore ? ["skill.stateBefore"] : []),
              ...(hasAtomicRuntimeFrame ? ["skill.runtimeTimeline.frames"] : []),
            ],
        capturedAt: selectedIncidentSampledAt,
        frameId: null,
        cycleId: selectedIncidentCycleId,
      }),
      createReportEvidenceReference({
        id: "skill-decision",
        kind: "decision",
        paths: hasSkillIncidentContract
          ? [
              "sample.skillEvidence.observations",
              "sample.skillEvidence.decisions",
              "sample.skillEvidence.arbitrations",
            ]
          : ["skill.runtimeTraceSample", "skill.runtimeTimeline.samples"],
        capturedAt: selectedIncidentSampledAt,
        frameId: null,
        cycleId: selectedIncidentCycleId,
      }),
      createReportEvidenceReference({
        id: "skill-playback",
        kind: "playback",
        paths: hasSkillIncidentContract
          ? ["sample.skillEvidence.playbackAttempts"]
          : ["skill.runtimeTimeline.alertEvents"],
        capturedAt:
          latestIncidentAttempt?.startedAt ??
          latestIncidentAttempt?.requestedAt ??
          latestPlayback?.startedAt ??
          null,
        frameId: null,
        cycleId: selectedIncidentCycleId,
      }),
      createReportEvidenceReference({
        id: "skill-config",
        kind: "configuration",
        paths: hasSkillIncidentContract
          ? ["sample.skillEvidence.configurations"]
          : ["skill.config"],
        capturedAt: selectedIncidentSampledAt,
        frameId: null,
        cycleId: null,
      }),
      createReportEvidenceReference({
        id: "skill-runtime",
        kind: "runtime",
        paths: hasSkillIncidentContract
          ? ["sample.skillEvidence.frames"]
          : ["sample.parser", "sample.result.recognizerVersion"],
        capturedAt: selectedIncidentSampledAt,
        frameId: null,
        cycleId: null,
      }),
    ],
    completeness: {
      sourceImage: hasSkillIncidentContract
        ? incidentMediaCount > 0
        : legacyMediaCount > 0,
      temporalTrace: hasSkillIncidentContract
        ? skillEvidence.frames.length > 1 ||
          skillEvidence.observations.length > 1 ||
          skillEvidence.cycles.length > 0
        : serializedTimeline.samples.length > 1 || runtimeFrames.length > 1,
      stateBeforeAfter: hasSkillIncidentContract
        ? skillEvidence.frames.length > 0
        : Boolean(stateBefore || hasAtomicRuntimeFrame),
      decision: hasSkillIncidentContract
        ? skillEvidence.decisions.length > 0 ||
          skillEvidence.observations.length > 0
        : Boolean(
            runtimeTraceSample ||
              serializedTimeline.samples.length ||
              runtimeFrames.length,
          ),
      playback: hasSkillIncidentContract
        ? skillEvidence.playbackAttempts.length > 0
        : Boolean(timeline),
      affectedTarget: hasSkillIncidentContract
        ? Boolean(skillEvidence.selectedSkillId)
        : Boolean(skill.id),
    },
  });
  const payload = createAlertReportPayload({
    kind: "skill-issue",
    submittedAt,
    url,
    appBuild: getAppBuildReportInfo(),
    clientId,
    reportIssue: issue,
    incident,
    diagnostics: {
      ...viewportDiagnostics,
      capture: captureDiagnostics,
    },
    sample: {
      sampledAt: snapshot.sampledAt,
      source: runtimeEvidence?.source ?? null,
      parser: runtimeEvidence?.parser ?? getSkillSnapshotParserEvidence(snapshot),
      skillEvidence,
      rawDataUrl: runtimeEvidence ? null : snapshot.rawPreviewUrl,
      processedDataUrl: snapshot.previewUrl,
      regionLabel: snapshot.regionLabel,
      buffDuration: serializeSkillBuffDurationSnapshot(snapshot.buffDuration),
      pixelRegion: null,
      result: {
        value: snapshot.result.value,
        confidence: snapshot.result.confidence,
        debug: snapshot.result.debug ?? null,
        recognizerVersion: getSkillRecognizerVersion(skill, snapshot),
        estimatedRemainingSeconds,
        alertInSeconds,
        runtimeFailure: snapshot.runtimeFailure ?? null,
      },
    },
    skill: {
      id: skill.id,
      config: getSkillConfigSnapshot(skill),
      currentRegion,
      state,
      stateBefore,
      runtimeTraceSample,
      runtimeDiagnostics: {
        status: state.status,
        observedRemainingSeconds: state.observedRemainingSeconds,
        observedRemainingCount: state.observedRemainingCount,
        estimatedRemainingSeconds,
        alertThresholdSeconds: skill.alertThresholdSeconds,
        alertInSeconds,
        alertInCount: getSkillAlertInRemainingCount(state, skill),
        observedAt: state.observedAt,
        countObservedAt: state.countObservedAt,
        estimatedExpiresAt: state.estimatedExpiresAt,
        alertedAt: state.alertedAt,
        lastRepeatedAlertAt: state.lastRepeatedAlertAt,
        repeatedAlertCount: state.repeatedAlertCount,
        lastAlertCycleStartedAt: state.lastAlertCycleStartedAt,
        pendingShortAnchor: state.pendingShortAnchor,
        pendingRemainingCountIncrease: state.pendingRemainingCountIncrease,
        pendingRemainingCountDrop: state.pendingRemainingCountDrop,
        pendingRemainingCountAlert: state.pendingRemainingCountAlert,
        rejectedReading: state.rejectedReading,
        confidence: state.confidence,
        lastReading: {
          value: snapshot.result.value,
          confidence: snapshot.result.confidence,
          debug: snapshot.result.debug ?? null,
          sampledAt: snapshot.sampledAt,
        },
      },
      relatedActiveSkills: relatedActiveSkills?.map((item) => ({
        id: item.id,
        name: item.name,
        presetId: item.presetId ?? null,
        alertThresholdSeconds: item.alertThresholdSeconds,
        soundId: item.soundId,
        enabled: item.enabled,
      })) ?? [],
      lastSnapshot: {
        sampledAt: snapshot.sampledAt,
        regionLabel: snapshot.regionLabel,
        result: snapshot.result,
        runtimeFailure: snapshot.runtimeFailure ?? null,
      },
      runtimeTimeline: serializedTimeline,
      reportReason: issue.reason,
    },
  });
  if (hasSkillIncidentContract) {
    payload.incident.evidence.mediaCount = incidentMediaCount;
  }
  return payload;
}

function getSkillIncidentTimestamps(
  evidence: SkillIncidentReportEvidence,
): number[] {
  return [
    ...evidence.frames.map((entry) => entry.sampledAt),
    ...evidence.observations.map((entry) => entry.sampledAt),
    ...evidence.cycles.flatMap((entry) =>
      [entry.startedAt, entry.confirmedAt, entry.lastEventAt, entry.endedAt].filter(
        (value): value is number => value !== null,
      ),
    ),
    ...evidence.decisions.map((entry) => entry.occurredAt),
    ...evidence.arbitrations.map((entry) => entry.occurredAt),
    ...evidence.playbackAttempts.flatMap((entry) =>
      [
        entry.requestedAt,
        entry.startedAt,
        entry.finishedAt,
        entry.failedAt,
      ].filter((value): value is number => value !== null),
    ),
    ...evidence.lifecycle.map((entry) => entry.occurredAt),
    ...evidence.configurations.map((entry) => entry.capturedAt),
    ...evidence.media.map((entry) => entry.capturedAt),
  ];
}

function getSkillRecognizerVersion(skill: SkillConfig, snapshot: SkillSnapshot): string | null {
  if (!snapshot.buffDuration) {
    return COOLDOWN_DIGIT_RECOGNIZER_VERSION;
  }
  return getSkillBuffDurationTargetForSkill(skill)?.valueKind === "remaining-count"
    ? BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION
    : null;
}

function serializeSkillReportTimeline(timeline: SkillReportTimeline | null | undefined) {
  if (!timeline) {
    return {
      samples: [],
      alertEvents: [],
      frames: [],
    };
  }

  return {
    samples: timeline.samples.slice(-72),
    alertEvents: timeline.alertEvents.slice(-12),
    frames: (timeline.frames ?? []).slice(-8),
  };
}

function serializeSkillBuffDurationSnapshot(
  snapshot: SkillSnapshot["buffDuration"] | null | undefined,
) {
  if (!snapshot) {
    return null;
  }
  return {
    targetSkillId: snapshot.targetSkillId ?? null,
    targetDisplayName: snapshot.targetDisplayName ?? null,
    detected: snapshot.detected,
    boxCount: snapshot.boxCount,
    parserRowCount: snapshot.parserRowCount ?? null,
    parserEngine: snapshot.parserEngine ?? null,
    parserVersion: snapshot.parserVersion ?? null,
    parserFallbackReason: snapshot.parserFallbackReason ?? null,
    detectedCount: snapshot.detectedCount,
    displayStatus: snapshot.displayStatus ?? null,
    displayLastSeenAt: snapshot.displayLastSeenAt ?? null,
    matcherEngine: snapshot.matcherEngine ?? null,
    bundleId: snapshot.bundleId ?? null,
    modelVersion: snapshot.modelVersion ?? null,
    baseSkillId: snapshot.baseSkillId ?? null,
    rawSkillId: snapshot.rawSkillId ?? null,
    score: snapshot.score,
    threshold: snapshot.threshold ?? null,
    margin: snapshot.margin,
    gateScore: snapshot.gateScore ?? null,
    gateThreshold: snapshot.gateThreshold ?? null,
    gateMargin: snapshot.gateMargin ?? null,
    decisionReason: snapshot.decisionReason,
    countdown: snapshot.countdown,
    countdownModelStatus: snapshot.countdownModelStatus ?? null,
    remainingCount: snapshot.remainingCount ?? null,
    remainingCountModelStatus: snapshot.remainingCountModelStatus ?? null,
    performanceMs: snapshot.performanceMs,
    error: snapshot.error,
    candidateIcons: (snapshot.candidateIcons ?? []).map((candidate) => ({
      name: `${candidate.match.displayName ?? "스킬"} 후보`,
      boxIndex: candidate.boxIndex,
      box: candidate.box,
      match: candidate.match,
      countdown: candidate.countdown ?? null,
      remainingCount: candidate.remainingCount ?? null,
      imageDataUrl: candidate.imageDataUrl,
    })),
  };
}

function getSkillSnapshotParserEvidence(snapshot: SkillSnapshot): RuntimeParserEvidence | null {
  if (!snapshot.buffDuration) {
    return null;
  }
  return {
    engine: snapshot.buffDuration.parserEngine ?? null,
    version: snapshot.buffDuration.parserVersion ?? null,
    fallbackReason: snapshot.buffDuration.parserFallbackReason ?? null,
  };
}
