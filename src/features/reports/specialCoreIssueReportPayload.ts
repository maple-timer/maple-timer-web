import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import { imageDataToUrl } from "../../lib/imageData";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import type {
  SpecialCoreCandidateIcon,
  SpecialCoreIcon,
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../lib/specialCore";
import type { SpecialCoreAlertConfig as ProfileSpecialCoreAlertConfig } from "../../types";
import type { RuntimeReportEvidenceMetadata } from "../../contracts/reporting/runtimeReportEvidence";
import type { SpecialCoreReportTimeline } from "../../contracts/reporting/specialCoreReportTimeline";
import {
  type AlertIssueReportDetails,
  type CaptureDiagnostics,
  getSpecialCoreConfigSnapshot,
  type ReportBase,
} from "./alertReportPayloadShared";
import {
  buildReportIncident,
  countPresentReportMedia,
  createReportEvidenceReference,
} from "./reportIncidentEvidence";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import type { SpecialCoreIncidentReportEvidence } from "../../runtime/special-core/evidence/specialCoreIncidentReportEvidence";

const MAX_REPORT_EVIDENCE_SNAPSHOTS = 12;
const MAX_REPORT_CANDIDATE_ICONS = 30;

export function buildSpecialCoreIssueReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  config,
  roiPreviewUrl,
  roiRegionLabel,
  snapshot,
  reportSnapshot,
  evidenceHistory = [],
  state,
  stateBefore = null,
  timeline = null,
  runtimeEvidence = null,
  incidentEvidence = null,
  issue,
  journalSelection = null,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  config: ProfileSpecialCoreAlertConfig;
  roiPreviewUrl?: string | null;
  roiRegionLabel?: string | null;
  snapshot: SpecialCoreSnapshot | null;
  reportSnapshot?: SpecialCoreSnapshot | null;
  evidenceHistory?: SpecialCoreSnapshot[];
  state: SpecialCoreRuntimeState;
  stateBefore?: SpecialCoreRuntimeState | null;
  timeline?: SpecialCoreReportTimeline | null;
  runtimeEvidence?: RuntimeReportEvidenceMetadata | null;
  incidentEvidence?: SpecialCoreIncidentReportEvidence | null;
  issue: AlertIssueReportDetails;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  const sampleSnapshot = reportSnapshot ?? snapshot;
  const selectedFrame = incidentEvidence
    ? incidentEvidence.frames[incidentEvidence.frames.length - 1] ?? null
    : null;
  const selectedObservation = incidentEvidence
    ? [...incidentEvidence.observations]
        .reverse()
        .find((entry) => !selectedFrame || entry.frameId === selectedFrame.id) ??
      incidentEvidence.observations[incidentEvidence.observations.length - 1] ??
      null
    : null;
  const selectedCandidate = selectedObservation
    ? selectedObservation.candidates.find(
        (entry) =>
          entry.boxIndex === selectedObservation.selectedCandidateBoxIndex,
      ) ?? selectedObservation.candidates[0] ?? null
    : null;
  const bestCandidate =
    selectedCandidate ??
    (sampleSnapshot
      ? sampleSnapshot.detectedIcon ?? sampleSnapshot.candidateIcons[0] ?? null
      : state.lastDetectedIcon);
  const lastSnapshotBestCandidate = snapshot?.detectedIcon ?? snapshot?.candidateIcons[0] ?? null;
  const recentEvidence = incidentEvidence
    ? []
    : serializeRecentEvidence(evidenceHistory);
  const reportCandidateIcons = incidentEvidence
    ? serializeIncidentCandidateIcons(selectedObservation)
    : serializeReportCandidateIcons(sampleSnapshot?.candidateIcons ?? []);
  const activationEvidence = serializeActivationEvidence(
    state.activationEvidence,
    !incidentEvidence,
  );
  const reportTimeline = incidentEvidence
    ? { samples: [], playbackEvents: [] }
    : timeline ?? { samples: [], playbackEvents: [] };
  const sampledAt =
    incidentEvidence?.selection.selectedEventAt ??
    selectedFrame?.sampledAt ??
    incidentEvidence?.frozenAt ??
    runtimeEvidence?.sampledAt ??
    sampleSnapshot?.sampledAt ??
    null;
  const selectedIncidentTimestamps = incidentEvidence
    ? [
        ...incidentEvidence.frames.map((entry) => entry.sampledAt),
        ...incidentEvidence.confirmationAttempts.flatMap((entry) => [
          entry.startedAt,
          entry.lastObservedAt,
          entry.endedAt,
        ]),
        ...incidentEvidence.activations.flatMap((entry) => [
          entry.startedAt,
          entry.confirmedAt,
          entry.lastSeenAt,
          entry.endedAt,
        ]),
        ...incidentEvidence.schedules.flatMap((entry) => [
          entry.registeredAt,
          entry.endedAt,
        ]),
        ...incidentEvidence.decisions.map((entry) => entry.occurredAt),
        ...incidentEvidence.playbackAttempts.flatMap((entry) => [
          entry.requestedAt,
          entry.browserAcceptedAt,
          entry.finishedAt,
          entry.failedAt,
        ]),
        ...incidentEvidence.lifecycle.map((entry) => entry.occurredAt),
      ]
    : null;
  const selectedStateBinding = incidentEvidence?.observations.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );
  const selectedMediaCount = incidentEvidence
    ? incidentEvidence.media.filter((entry) =>
        entry.imageDataUrl.startsWith("data:image/"),
      ).length
    : null;
  const selectedActivationId =
    incidentEvidence?.selection.activationIds[
      incidentEvidence.selection.activationIds.length - 1
    ] ?? null;
  const incident = buildReportIncident({
    feature: "special-core",
    issue,
    submittedAt,
    source: incidentEvidence
      ? "runtime-atomic"
      : runtimeEvidence
        ? "runtime-atomic"
        : "mixed",
    sampledAt,
    timestamps:
      selectedIncidentTimestamps ?? [
        ...reportTimeline.samples.map((entry) => entry.sampledAt),
        ...reportTimeline.playbackEvents.map((entry) => entry.recordedAt),
        ...recentEvidence.map((entry) => entry.sampledAt),
      ],
    frameCount: incidentEvidence?.frames.length,
    stateBinding: incidentEvidence
      ? selectedStateBinding
        ? "before-after"
        : "unavailable"
      : stateBefore
        ? "before-after"
        : "after-only",
    mediaCount:
      selectedMediaCount ??
      countPresentReportMedia(runtimeEvidence?.source.dataUrl, roiPreviewUrl) +
        reportCandidateIcons.filter((entry) => Boolean(entry?.imageDataUrl)).length +
        recentEvidence.filter((entry) => Boolean(entry.evidenceIcon?.imageDataUrl)).length +
        (activationEvidence?.confirmationIcons.filter((entry) => Boolean(entry?.imageDataUrl))
          .length ?? 0),
    cycleId: incidentEvidence ? selectedActivationId : state.activationId,
    journalSelection,
    evidenceReferences: incidentEvidence
      ? createSpecialCoreIncidentEvidenceReferences(incidentEvidence)
      : [
      createReportEvidenceReference({
        id: "special-core-source",
        kind: "sourceImage",
        paths: [
          "sample.source.dataUrl",
          "sample.rawDataUrl",
          "sample.specialCore.candidateIcons",
          "specialCore.activationEvidence.confirmationIcons",
          "specialCore.recentEvidence",
        ],
        capturedAt: sampledAt,
        frameId: sampledAt === null ? null : `frame:${sampledAt}`,
        cycleId: state.activationId,
      }),
      createReportEvidenceReference({
        id: "special-core-trace",
        kind: "temporalTrace",
        paths: ["specialCore.timeline.samples", "specialCore.recentEvidence"],
        capturedAt: sampledAt,
        frameId: null,
        cycleId: state.activationId,
      }),
      createReportEvidenceReference({
        id: "special-core-state-binding",
        kind: "stateBeforeAfter",
        paths: ["specialCore.stateBefore"],
        capturedAt: sampledAt,
        frameId: null,
        cycleId: state.activationId,
      }),
      createReportEvidenceReference({
        id: "special-core-decision",
        kind: "decision",
        paths: ["sample.result", "specialCore.timeline.samples"],
        capturedAt: sampledAt,
        frameId: null,
        cycleId: state.activationId,
      }),
      createReportEvidenceReference({
        id: "special-core-playback",
        kind: "playback",
        paths: [
          "specialCore.timeline.playbackEvents",
          "specialCore.state.lastAlertPlayback",
        ],
        capturedAt: state.lastAlertPlayback?.requestedAt ?? null,
        frameId: null,
        cycleId: state.lastAlertPlayback?.cycleId ?? state.activationId,
      }),
      createReportEvidenceReference({
        id: "special-core-config",
        kind: "configuration",
        paths: ["specialCore.config"],
        capturedAt: sampledAt,
        frameId: null,
        cycleId: null,
      }),
      createReportEvidenceReference({
        id: "special-core-runtime",
        kind: "runtime",
        paths: ["sample.parser", "sample.result.debug.modelVersion"],
        capturedAt: sampledAt,
        frameId: null,
        cycleId: null,
      }),
      ],
    completeness: incidentEvidence
      ? createSpecialCoreIncidentCompleteness(incidentEvidence)
      : {
          sourceImage: Boolean(
            runtimeEvidence?.source.dataUrl ||
              roiPreviewUrl ||
              reportCandidateIcons.length,
          ),
          temporalTrace:
            reportTimeline.samples.length > 1 || recentEvidence.length > 1,
          stateBeforeAfter: Boolean(stateBefore),
          decision: Boolean(
            reportTimeline.samples.length || reportCandidateIcons.length,
          ),
          playback:
            Object.prototype.hasOwnProperty.call(
              state,
              "lastAlertPlayback",
            ) || Boolean(timeline),
          affectedTarget: true,
        },
  });

  const payload = createAlertReportPayload({
    kind: "special-core-issue",
    schemaVersion: 2,
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
      sampledAt,
      source: runtimeEvidence?.source ?? null,
      parser:
        selectedFrame?.parser ??
        runtimeEvidence?.parser ?? {
          engine: sampleSnapshot?.parserEngine ?? null,
          version: sampleSnapshot?.parserVersion ?? null,
          fallbackReason: sampleSnapshot?.parserFallbackReason ?? null,
        },
      rawDataUrl:
        incidentEvidence || runtimeEvidence ? null : roiPreviewUrl ?? null,
      processedDataUrl: null,
      regionLabel:
        selectedFrame?.source?.regionLabel ??
        (runtimeEvidence
          ? `${runtimeEvidence.source.roi.width}x${runtimeEvidence.source.roi.height}`
          : roiRegionLabel ?? null),
      result: {
        detected: selectedObservation
          ? selectedObservation.decision === "accepted"
          : sampleSnapshot
            ? Boolean(sampleSnapshot.detectedIcon)
            : Boolean(state.lastDetectedIcon),
        confidence: null,
        candidateCount:
          selectedObservation?.candidates.length ??
          sampleSnapshot?.candidateIcons.length ??
          0,
        value: null,
        debug: {
          bundleId: bestCandidate?.match.bundleId ?? null,
          modelId: bestCandidate?.match.modelId ?? null,
          modelVersion: bestCandidate?.match.modelVersion ?? null,
          variantId: bestCandidate?.match.variantId ?? null,
          gateVersion: bestCandidate?.match.gateVersion ?? null,
          parserEngine:
            selectedFrame?.parser?.engine ??
            sampleSnapshot?.parserEngine ??
            null,
          parserVersion:
            selectedFrame?.parser?.version ??
            sampleSnapshot?.parserVersion ??
            null,
          parserFallbackReason:
            selectedFrame?.parser?.fallbackReason ??
            sampleSnapshot?.parserFallbackReason ??
            null,
          error:
            selectedFrame?.runtimeFailure?.technicalMessage ??
            sampleSnapshot?.error ??
            null,
          boxCount: selectedFrame?.parsedBoxes.length ?? sampleSnapshot?.boxCount ?? 0,
          decisionReason: bestCandidate?.match.decisionReason ?? null,
          bestScore: bestCandidate?.match.score ?? null,
          baseThreshold: bestCandidate?.match.threshold ?? null,
          bestMargin: bestCandidate?.match.margin ?? null,
          bestGateScore: bestCandidate?.match.gateScore ?? null,
          gateThreshold: bestCandidate?.match.gateThreshold ?? null,
          bestGateMargin: bestCandidate?.match.gateMargin ?? null,
          rescueThreshold: bestCandidate?.match.rescueThreshold ?? null,
          bestRescueMargin: bestCandidate?.match.rescueMargin ?? null,
          primaryPassed: bestCandidate?.match.primaryPassed ?? false,
          rescuePassed: bestCandidate?.match.rescuePassed ?? false,
          detectedCount:
            selectedObservation?.candidates.filter(
              (entry) => entry.match.matched,
            ).length ??
            sampleSnapshot?.detectedCount ??
            state.detectedCount,
        },
      },
      specialCore: {
        performance: selectedFrame?.timings
          ? {
              totalMs: selectedFrame.timings.totalMs,
              detectMs: selectedFrame.timings.detectMs,
              matchMs: selectedFrame.timings.matchMs,
              boxCount: selectedFrame.parsedBoxes.length,
            }
          : sampleSnapshot?.performance ?? null,
        candidateIcons: reportCandidateIcons,
      },
      specialCoreEvidence: incidentEvidence,
    },
    specialCore: {
      config: getSpecialCoreConfigSnapshot(config),
      state: serializeSpecialCoreRuntimeState(state),
      stateBefore: stateBefore ? serializeSpecialCoreRuntimeState(stateBefore) : null,
      timeline: reportTimeline,
      lastSnapshot: snapshot
        ? {
            sampledAt: snapshot.sampledAt,
            error: snapshot.error ?? null,
            boxCount: snapshot.boxCount,
            parserEngine: snapshot.parserEngine ?? null,
            parserVersion: snapshot.parserVersion ?? null,
            parserFallbackReason: snapshot.parserFallbackReason ?? null,
            detectedCount: snapshot.detectedCount,
            performance: snapshot.performance,
            detected: Boolean(snapshot.detectedIcon),
            candidateCount: snapshot.candidateIcons.length,
            bestMatch: lastSnapshotBestCandidate?.match ?? null,
          }
        : null,
      activationEvidence,
      recentEvidence,
      reportReason: issue.reason,
    },
  });
  if (incidentEvidence) {
    lockSpecialCoreIncidentToSelectedEvidence(payload.incident, incidentEvidence);
  }
  return payload;
}

function lockSpecialCoreIncidentToSelectedEvidence(
  incident: ReturnType<typeof buildReportIncident>,
  evidence: SpecialCoreIncidentReportEvidence,
): void {
  const timestamps = [
    ...evidence.frames.map((entry) => entry.sampledAt),
    ...evidence.confirmationAttempts.flatMap((entry) => [
      entry.startedAt,
      entry.lastObservedAt,
      entry.endedAt,
    ]),
    ...evidence.activations.flatMap((entry) => [
      entry.startedAt,
      entry.confirmedAt,
      entry.lastSeenAt,
      entry.endedAt,
    ]),
    ...evidence.schedules.flatMap((entry) => [
      entry.registeredAt,
      entry.endedAt,
    ]),
    ...evidence.decisions.map((entry) => entry.occurredAt),
    ...evidence.playbackAttempts.flatMap((entry) => [
      entry.requestedAt,
      entry.browserAcceptedAt,
      entry.finishedAt,
      entry.failedAt,
    ]),
    ...evidence.lifecycle.map((entry) => entry.occurredAt),
  ].filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isFinite(entry) && entry > 0,
  );
  const selectedActivationId =
    evidence.selection.activationIds[
      evidence.selection.activationIds.length - 1
    ] ?? null;
  const hasStateBinding = evidence.observations.some(
    (entry) => Boolean(entry.stateBefore && entry.stateAfter),
  );

  incident.cycleId = selectedActivationId;
  incident.evidence = {
    ...incident.evidence,
    source: "runtime-atomic",
    sampledAt: evidence.selection.selectedEventAt ?? evidence.frozenAt,
    windowStartedAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
    windowEndedAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
    frameCount: evidence.frames.length,
    stateBinding: hasStateBinding ? "before-after" : "unavailable",
    mediaCount: evidence.media.filter((entry) =>
      entry.imageDataUrl.startsWith("data:image/"),
    ).length,
  };
  incident.completeness = createSpecialCoreIncidentCompleteness(evidence);
  incident.correlation = {
    frameIds: [...evidence.selection.frameIds],
    cycleIds: [...evidence.selection.activationIds],
    playbackIds: [...evidence.selection.playbackAttemptIds],
    relatedPlaybackIds: [...evidence.selection.relatedPlaybackIds],
    configRevisions: [...evidence.selection.configurationRevisionIds],
  };
  incident.evidenceManifest.references =
    incident.evidenceManifest.references.map((reference) => {
      const paths = removeJournalFallbackPaths(reference.paths);
      const producedPaths = removeJournalFallbackPaths(
        reference.producedPaths,
      );
      const retainedPaths = removeJournalFallbackPaths(
        reference.retainedPaths,
      );
      return {
        ...reference,
        paths,
        produced: producedPaths.length > 0,
        producedPaths,
        retained: retainedPaths.length > 0,
        retainedPaths,
      };
    });
}

function createSpecialCoreIncidentEvidenceReferences(
  evidence: SpecialCoreIncidentReportEvidence,
) {
  const capturedAt =
    evidence.selection.selectedEventAt ?? evidence.frozenAt;
  const frameId =
    evidence.selection.frameIds[evidence.selection.frameIds.length - 1] ??
    null;
  const cycleId =
    evidence.selection.activationIds[
      evidence.selection.activationIds.length - 1
    ] ?? null;
  return [
    createReportEvidenceReference({
      id: "special-core-incident-source",
      kind: "sourceImage",
      paths:
        evidence.media.length > 0
          ? ["sample.specialCoreEvidence.media"]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "special-core-incident-trace",
      kind: "temporalTrace",
      paths:
        evidence.observations.length > 0
          ? [
              "sample.specialCoreEvidence.frames",
              "sample.specialCoreEvidence.observations",
              "sample.specialCoreEvidence.confirmationAttempts",
              "sample.specialCoreEvidence.activations",
              "sample.specialCoreEvidence.schedules",
            ]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "special-core-incident-state-binding",
      kind: "stateBeforeAfter",
      paths: evidence.observations.some(
        (entry) => entry.stateBefore && entry.stateAfter,
      )
        ? ["sample.specialCoreEvidence.observations"]
        : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "special-core-incident-decision",
      kind: "decision",
      paths:
        evidence.decisions.length > 0 ||
        evidence.schedules.length > 0 ||
        evidence.confirmationAttempts.length > 0
          ? [
              "sample.specialCoreEvidence.confirmationAttempts",
              "sample.specialCoreEvidence.activations",
              "sample.specialCoreEvidence.schedules",
              "sample.specialCoreEvidence.decisions",
            ]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "special-core-incident-playback",
      kind: "playback",
      paths:
        evidence.playbackAttempts.length > 0
          ? ["sample.specialCoreEvidence.playbackAttempts"]
          : [],
      capturedAt,
      frameId,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "special-core-incident-config",
      kind: "configuration",
      paths:
        evidence.configurations.length > 0
          ? ["sample.specialCoreEvidence.configurations"]
          : [],
      capturedAt,
      frameId: null,
      cycleId,
    }),
    createReportEvidenceReference({
      id: "special-core-incident-runtime",
      kind: "runtime",
      paths: evidence.frames.some((entry) => entry.parser)
        ? ["sample.specialCoreEvidence.frames"]
        : [],
      capturedAt,
      frameId,
      cycleId,
    }),
  ];
}

function createSpecialCoreIncidentCompleteness(
  evidence: SpecialCoreIncidentReportEvidence,
) {
  return {
    sourceImage: evidence.media.some((entry) =>
      entry.imageDataUrl.startsWith("data:image/"),
    ),
    temporalTrace:
      evidence.observations.length > 1 || evidence.lifecycle.length > 1,
    stateBeforeAfter: evidence.observations.some(
      (entry) => Boolean(entry.stateBefore && entry.stateAfter),
    ),
    decision:
      evidence.decisions.length > 0 ||
      evidence.schedules.length > 0 ||
      evidence.confirmationAttempts.length > 0,
    playback: evidence.playbackAttempts.length > 0,
    affectedTarget: true,
  };
}

function removeJournalFallbackPaths(paths: string[]): string[] {
  return paths.filter(
    (path) =>
      path !== "incident.journal.entries" &&
      path !== "incident.journal.coverage.playbackLifecycleMonitored",
  );
}

function serializeSpecialCoreRuntimeState(state: SpecialCoreRuntimeState) {
  return {
    status: state.status,
    lastSampledAt: state.lastSampledAt,
    unsupportedReason: state.unsupportedReason,
    boxCount: state.boxCount,
    detectedCount: state.detectedCount,
    pendingDetections: state.pendingDetections.slice(-6),
    activationId: state.activationId,
    activationStartedAt: state.activationStartedAt,
    activationConfirmedAt: state.activationConfirmedAt,
    activationLastSeenAt: state.activationLastSeenAt,
    cooldownEndsAt: state.cooldownEndsAt,
    alertDueAt: state.alertDueAt,
    alertedAt: state.alertedAt,
    lastAlertedAt: state.lastAlertedAt,
    lastAlertPlayback: state.lastAlertPlayback ?? null,
  };
}

function serializeReportCandidateIcons(candidates: SpecialCoreCandidateIcon[]) {
  return candidates
    .slice(0, MAX_REPORT_CANDIDATE_ICONS)
    .map((candidate) => serializeCandidateIcon(candidate));
}

function serializeIncidentCandidateIcons(
  observation: SpecialCoreIncidentReportEvidence["observations"][number] | null,
) {
  return (observation?.candidates ?? [])
    .slice(0, MAX_REPORT_CANDIDATE_ICONS)
    .map((candidate) => ({
      boxIndex: candidate.boxIndex,
      box: candidate.box,
      match: candidate.match,
      imageDataUrl: null,
    }));
}

function serializeRecentEvidence(evidenceHistory: SpecialCoreSnapshot[]) {
  return evidenceHistory
    .slice(-MAX_REPORT_EVIDENCE_SNAPSHOTS)
    .map((entry) => {
      const evidenceIcon = entry.detectedIcon ?? entry.candidateIcons[0] ?? null;

      return {
        sampledAt: entry.sampledAt,
        boxCount: entry.boxCount,
        detectedCount: entry.detectedCount,
        performance: entry.performance,
        source: entry.detectedIcon ? "detected" : "top-candidate",
        evidenceIcon: serializeCandidateIcon(evidenceIcon),
      };
    });
}

function serializeActivationEvidence(
  evidence: SpecialCoreRuntimeState["activationEvidence"],
  includeImageData = true,
) {
  if (!evidence) {
    return null;
  }

  return {
    activationId: evidence.activationId,
    activationStartedAt: evidence.activationStartedAt,
    activationConfirmedAt: evidence.activationConfirmedAt,
    confirmationIcons: evidence.confirmationIcons.map((candidate) =>
      serializeCandidateIcon(candidate, includeImageData),
    ),
  };
}

function serializeCandidateIcon(
  candidate: SpecialCoreCandidateIcon | null | undefined,
  includeImageData = true,
) {
  if (!candidate) {
    return null;
  }

  return {
    boxIndex: candidate.boxIndex,
    box: candidate.box,
    match: candidate.match,
    imageDataUrl: includeImageData ? serializeIcon(candidate.icon) : null,
  };
}

function serializeIcon(icon: SpecialCoreIcon): string | null {
  if (typeof ImageData === "undefined") {
    return null;
  }

  try {
    return imageDataToUrl(
      new ImageData(new Uint8ClampedArray(icon.data), icon.width, icon.height),
    );
  } catch {
    return null;
  }
}
