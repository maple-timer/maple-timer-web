import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import type { BuffExpiryAlertConfig } from "../../types";
import type { RuntimeReportEvidenceMetadata } from "../../contracts/reporting/runtimeReportEvidence";
import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import type {
  AlertIssueReportDetails,
  CaptureDiagnostics,
  ReportBase,
} from "./alertReportPayloadShared";
import { BUFF_EXPIRY_PRECISION_REPORT_SCHEMA_VERSION } from "./buffExpiryPrecisionReportConstants";
import {
  buildBuffExpiryPrecisionReportSample,
  buildBuffExpiryPrecisionReportSection,
  createBuffExpiryPrecisionReportContext,
} from "./buffExpiryPrecisionReportPayloadSections";
import {
  buildReportIncident,
  countPresentReportMedia,
  createReportEvidenceReference,
} from "./reportIncidentEvidence";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import type { BuffExpiryIncidentReportEvidence } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentReportEvidence";

export function buildBuffExpiryPrecisionIssueReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  config,
  snapshot,
  state,
  stateBefore = null,
  runtimeEvidence,
  incidentEvidence = null,
  issue,
  journalSelection = null,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  config: BuffExpiryAlertConfig;
  snapshot: BuffExpirySnapshot;
  state: BuffExpiryRuntimeState;
  stateBefore?: BuffExpiryRuntimeState | null;
  runtimeEvidence?: RuntimeReportEvidenceMetadata | null;
  incidentEvidence?: BuffExpiryIncidentReportEvidence | null;
  issue: AlertIssueReportDetails;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  const context = createBuffExpiryPrecisionReportContext(
    config,
    snapshot,
    state,
    { includeLegacyMedia: !incidentEvidence },
  );
  const runtimeTrace = snapshot.runtimeTrace ?? [];
  const recentRoiFrames = context.recentRoiFrames;
  const lastAlertEvidence = context.lastAlertEvidence;
  const reportSampledAt = runtimeEvidence?.sampledAt ?? snapshot.sampledAt;
  const selectedSampledAt =
    incidentEvidence?.selection.selectedEventAt ?? reportSampledAt;
  const selectedCycleId =
    getLast(incidentEvidence?.selection.cycleIds) ??
    lastAlertEvidence?.clusterId ??
    state.lastAlertPlayback?.cycleId ??
    null;
  const selectedFrameId =
    getLast(incidentEvidence?.selection.frameIds) ?? null;
  const selectedTimestamps = incidentEvidence
    ? [
        ...incidentEvidence.frames.map((entry) => entry.sampledAt),
        ...incidentEvidence.observations.map((entry) => entry.sampledAt),
        ...incidentEvidence.transitions.map((entry) => entry.occurredAt),
        ...incidentEvidence.cycleEvents.map((entry) => entry.occurredAt),
        ...incidentEvidence.attempts.flatMap((entry) => [
          entry.requestedAt,
          entry.startedAt,
          entry.failedAt,
        ]),
        ...incidentEvidence.runtimeEvents.map((entry) => entry.occurredAt),
      ]
    : [
        ...runtimeTrace.map((entry) => entry.sampledAt),
        ...recentRoiFrames.map((entry) => entry.sampledAt),
        lastAlertEvidence?.alertedAt,
      ];
  const selectedJournal = filterBuffExpiryIncidentJournal({
    journalSelection,
    incidentEvidence,
  });
  const incident = buildReportIncident({
    feature: "buff-expiry",
    issue,
    submittedAt,
    source: incidentEvidence
      ? runtimeEvidence
        ? "mixed"
        : "runtime-snapshot"
      : runtimeEvidence
        ? "runtime-atomic"
        : "report-capture",
    sampledAt: selectedSampledAt,
    timestamps: selectedTimestamps,
    frameCount: incidentEvidence?.frames.length,
    stateBinding: incidentEvidence?.frames.length
      ? "before-after"
      : stateBefore
        ? "before-after"
        : "after-only",
    mediaCount: incidentEvidence
      ? incidentEvidence.media.length +
        countPresentReportMedia(runtimeEvidence?.source.dataUrl)
      : countPresentReportMedia(
          runtimeEvidence?.source.dataUrl,
          snapshot.rawPreviewUrl,
          snapshot.processedPreviewUrl,
          snapshot.fullFramePreviewUrl,
        ) +
        context.iconEvidence.filter((entry) =>
          Boolean(entry.normalizedIconDataUrl),
        ).length +
        recentRoiFrames.length +
        (lastAlertEvidence?.triggeredTracks.filter((entry) =>
          Boolean(entry.normalizedIconDataUrl),
        ).length ?? 0),
    cycleId: selectedCycleId,
    journalSelection: selectedJournal,
    evidenceReferences: [
      createReportEvidenceReference({
        id: "buff-expiry-source",
        kind: "sourceImage",
        paths: [
          "sample.buffExpiryEvidence.media",
          "sample.buffExpiryEvidence.frames",
          "sample.source.dataUrl",
          "sample.rawDataUrl",
          "sample.processedDataUrl",
          "sample.fullFrameDataUrl",
          "sample.next.iconEvidence",
          "sample.next.replay.frames",
          "sample.lastAlertEvidence",
        ],
        capturedAt: selectedSampledAt,
        frameId: selectedFrameId ?? `frame:${reportSampledAt}`,
        cycleId: selectedCycleId,
      }),
      createReportEvidenceReference({
        id: "buff-expiry-trace",
        kind: "temporalTrace",
        paths: [
          "sample.buffExpiryEvidence.transitions",
          "sample.buffExpiryEvidence.cycleEvents",
          "sample.runtimeTrace",
          "sample.next.replay.frames",
          "sample.alertDecisionHistory",
        ],
        capturedAt: selectedSampledAt,
        frameId: null,
        cycleId: selectedCycleId,
      }),
      createReportEvidenceReference({
        id: "buff-expiry-state-binding",
        kind: "stateBeforeAfter",
        paths: [
          "sample.buffExpiryEvidence.frames",
          "sample.buffExpiryEvidence.frozenState",
          "buffExpiry.stateBefore",
        ],
        capturedAt: selectedSampledAt,
        frameId: selectedFrameId,
        cycleId: selectedCycleId,
      }),
      createReportEvidenceReference({
        id: "buff-expiry-decision",
        kind: "decision",
        paths: [
          "sample.buffExpiryEvidence.selection",
          "sample.buffExpiryEvidence.observations",
          "sample.buffExpiryEvidence.episodes",
          "sample.buffExpiryEvidence.cycles",
          "sample.alertDecisionHistory",
          "sample.next.identity",
          "sample.lastAlertEvidence",
        ],
        capturedAt: selectedSampledAt,
        frameId: selectedFrameId,
        cycleId: selectedCycleId,
      }),
      createReportEvidenceReference({
        id: "buff-expiry-playback",
        kind: "playback",
        paths: [
          "sample.buffExpiryEvidence.attempts",
          "sample.buffExpiryEvidence.cycles",
          "buffExpiry.state.lastAlertPlayback",
          "sample.lastAlertEvidence",
        ],
        capturedAt:
          getLast(incidentEvidence?.attempts)?.requestedAt ??
          state.lastAlertPlayback?.requestedAt ??
          lastAlertEvidence?.alertedAt ??
          null,
        frameId: null,
        cycleId: selectedCycleId,
      }),
      createReportEvidenceReference({
        id: "buff-expiry-config",
        kind: "configuration",
        paths: [
          "sample.buffExpiryEvidence.configurationRevisions",
          "buffExpiry.config",
        ],
        capturedAt:
          incidentEvidence?.frozenState?.capturedAt ?? selectedSampledAt,
        frameId: null,
        cycleId: null,
      }),
      createReportEvidenceReference({
        id: "buff-expiry-runtime",
        kind: "runtime",
        paths: [
          "sample.buffExpiryEvidence.frames",
          "sample.buffExpiryEvidence.reportFrame",
          "sample.parser",
          "sample.next.moduleVersions",
        ],
        capturedAt: selectedSampledAt,
        frameId: selectedFrameId,
        cycleId: null,
      }),
    ],
    completeness: {
      sourceImage: incidentEvidence
        ? incidentEvidence.media.length > 0
        : Boolean(
            runtimeEvidence?.source.dataUrl ||
            snapshot.rawPreviewUrl ||
            recentRoiFrames.length,
          ),
      temporalTrace: incidentEvidence
        ? incidentEvidence.transitions.length > 1 ||
          incidentEvidence.cycleEvents.length > 1 ||
          incidentEvidence.observations.length > 1
        : runtimeTrace.length > 1 || recentRoiFrames.length > 1,
      stateBeforeAfter: incidentEvidence
        ? incidentEvidence.frames.length > 0
        : Boolean(stateBefore),
      decision: incidentEvidence
        ? incidentEvidence.selection.anchorKind !== null &&
          incidentEvidence.selection.support !== "unsupported"
        : Boolean(
            runtimeTrace.length ||
            snapshot.alertDecisionHistory?.length ||
            context.observations.length,
          ),
      playback: incidentEvidence
        ? incidentEvidence.selection.support === "definitive" &&
          (incidentEvidence.attempts.length > 0 ||
            incidentEvidence.cycles.length > 0)
        : Object.prototype.hasOwnProperty.call(state, "lastAlertPlayback"),
    },
  });

  return createAlertReportPayload({
    kind: "buff-expiry-issue",
    schemaVersion: BUFF_EXPIRY_PRECISION_REPORT_SCHEMA_VERSION,
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
    sample: buildBuffExpiryPrecisionReportSample(
      snapshot,
      state,
      context,
      runtimeEvidence,
      incidentEvidence,
    ),
    buffExpiry: buildBuffExpiryPrecisionReportSection(
      config,
      snapshot,
      state,
      stateBefore,
      issue,
      context,
    ),
  });
}

function filterBuffExpiryIncidentJournal({
  journalSelection,
  incidentEvidence,
}: {
  journalSelection: AlertIncidentJournalSelection | null;
  incidentEvidence: BuffExpiryIncidentReportEvidence | null;
}): AlertIncidentJournalSelection | null {
  if (!journalSelection || !incidentEvidence) {
    return journalSelection;
  }
  const selection = incidentEvidence.selection;
  const frameIds = new Set(selection.frameIds);
  const cycleIds = new Set(selection.cycleIds.map(String));
  const affectedGroup = selection.affectedGroup;
  const entries = journalSelection.entries.filter((entry) => {
    if (affectedGroup && entry.targetId !== affectedGroup) {
      return false;
    }
    return (
      (entry.frameId !== null && frameIds.has(entry.frameId)) ||
      (entry.cycleId !== null && cycleIds.has(String(entry.cycleId)))
    );
  });
  return {
    ...journalSelection,
    target: {
      ...journalSelection.target,
      targetId: affectedGroup ?? journalSelection.target.targetId,
    },
    entries,
  };
}

function getLast<T>(values: T[] | undefined): T | undefined {
  return values?.[values.length - 1];
}
