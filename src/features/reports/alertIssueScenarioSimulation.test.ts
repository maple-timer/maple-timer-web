import { describe, expect, it, vi } from "vitest";
import type {
  RuneAlertTriggerEvidence,
  RuneRuntimeIncidentEvidence,
  RuneSnapshot,
} from "../../alertTypes";
import {
  getDebugSampleAssets,
  hasRequiredSampleImages,
  metadataFromSample,
  // @ts-expect-error Cloudflare Pages helpers are JavaScript modules without declarations.
} from "../../../functions/api/_shared/debug-sample-record.js";
// @ts-expect-error Cloudflare Pages helpers are JavaScript modules without declarations.
import { buildDebugSampleSlackNotificationPayload } from "../../../functions/api/_shared/debug-sample-slack.js";
import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import {
  createAlertIncidentJournal,
  type AlertIncidentJournalSelection,
} from "../../application/reporting/alertIncidentJournal";
import {
  getAlertIssueEvidenceRequirements,
  type AlertIssueFeature,
  type AlertIssueOccurrence,
  type AlertIssueScenario,
} from "../../contracts/reporting/alertIssueScenario";
import { createBoosterExpiryRuntimeState } from "../../lib/boosterExpiry/boosterExpiryRuntime";
import { createBuffExpiryRuntimeState } from "../../lib/buffExpiry/buffExpiryRuntimeState";
import { createHuntStallRuntimeState } from "../../lib/huntStallRuntimeState";
import { updateRuneEvidenceArchive } from "../../lib/runeEvidenceArchive";
import {
  createDefaultBoosterExpiryAlert,
  createDefaultBuffExpiryAlert,
  createDefaultHuntStallAlert,
  createDefaultSpecialCoreAlert,
  createSkill,
} from "../../lib/storage";
import {
  createSpecialCoreRuntimeState,
  type SpecialCoreCandidateIcon,
} from "../../lib/specialCore";
import { createRuntimeState } from "../../lib/timer";
import { buildTroubleshooterViewModel } from "../debug/troubleshooter/model/buildTroubleshooterViewModel";
import {
  buildBoosterExpiryIssueReportPayload,
  buildBuffExpiryIssueReportPayload,
  buildHuntStallIssueReportPayload,
  buildRuneIssueReportPayload,
  buildSkillIssueReportPayload,
  buildSpecialCoreIssueReportPayload,
  type AlertIssueReportDetails,
} from "./alertReportPayloads";
import {
  getAlertIssueReportOptions,
  getAlertIssueReportScenarioOptions,
} from "./alertIssueReportDialogViewModel";
import {
  compactReportPayload,
  getReportPayloadByteLength,
} from "./reportPayloadBudget";

vi.mock("../../lib/imageData", () => ({
  imageDataToUrl: () => "data:image/png;base64,c2ltdWxhdGlvbg==",
}));

const CAPTURED_AT = 100_000;
const SUBMITTED_AT = new Date(CAPTURED_AT).toISOString();
const IMAGE_DATA_URL = `data:image/png;base64,${"a".repeat(128)}`;
const OCCURRENCES: AlertIssueOccurrence[] = ["current", "recent", "historical"];

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

type ReportCase = {
  feature: AlertIssueFeature;
  target: AlertIssueReportTarget;
  reason: string;
  label: string;
  scenarios: AlertIssueScenario[];
};

type SimulationVariant =
  "default" | "precision" | "quick-slot" | "experience" | "cooldown";

const REPORT_CASES: ReportCase[] = [
  reportCase("rune", { kind: "rune" }, "rune-missed", [
    "not-recognized",
    "recognized-no-alert",
    "playback-missing",
    "repeat-missing",
  ]),
  reportCase("rune", { kind: "rune" }, "rune-false-positive", [
    "wrong-target",
    "duplicate-alert",
    "unexpected-playback",
  ]),
  reportCase("rune", { kind: "rune" }, "other", ["other"]),
  reportCase(
    "skill",
    { kind: "skill", skillId: "skill-sim", skillName: "시뮬레이션 스킬" },
    "skill-not-detected",
    [
      "not-recognized",
      "wrong-value",
      "recognized-no-alert",
      "playback-missing",
    ],
  ),
  reportCase(
    "skill",
    { kind: "skill", skillId: "skill-sim", skillName: "시뮬레이션 스킬" },
    "skill-alert-timing",
    [
      "recognized-no-alert",
      "early-alert",
      "late-alert",
      "repeat-timing",
      "playback-missing",
    ],
  ),
  reportCase(
    "skill",
    { kind: "skill", skillId: "skill-sim", skillName: "시뮬레이션 스킬" },
    "other",
    ["other"],
  ),
  reportCase("hunt-stall", { kind: "hunt-stall" }, "hunt-stall-missed", [
    "not-recognized",
    "recognized-no-alert",
    "playback-missing",
    "repeat-missing",
  ]),
  reportCase("hunt-stall", { kind: "hunt-stall" }, "hunt-stall-false-alert", [
    "wrong-target",
    "duplicate-alert",
    "unexpected-playback",
  ]),
  reportCase("hunt-stall", { kind: "hunt-stall" }, "hunt-stall-reading", [
    "wrong-target",
    "wrong-value",
    "unstable-value",
  ]),
  reportCase("hunt-stall", { kind: "hunt-stall" }, "other", ["other"]),
  reportCase("buff-expiry", { kind: "buff-expiry" }, "buff-expiry-missed", [
    "not-recognized",
    "wrong-value",
    "recognized-no-alert",
    "playback-missing",
  ]),
  reportCase(
    "buff-expiry",
    { kind: "buff-expiry" },
    "buff-expiry-false-alert",
    ["wrong-target", "duplicate-alert", "unexpected-playback"],
  ),
  reportCase("buff-expiry", { kind: "buff-expiry" }, "buff-expiry-reading", [
    "wrong-target",
    "wrong-value",
    "unstable-value",
  ]),
  reportCase("buff-expiry", { kind: "buff-expiry" }, "other", ["other"]),
  reportCase(
    "booster-expiry",
    { kind: "booster-expiry" },
    "booster-expiry-missed",
    [
      "not-recognized",
      "wrong-value",
      "recognized-no-alert",
      "playback-missing",
    ],
  ),
  reportCase(
    "booster-expiry",
    { kind: "booster-expiry" },
    "booster-expiry-false-alert",
    ["wrong-target", "duplicate-alert", "unexpected-playback"],
  ),
  reportCase(
    "booster-expiry",
    { kind: "booster-expiry" },
    "booster-expiry-reading",
    ["wrong-target", "wrong-value", "unstable-value"],
  ),
  reportCase("booster-expiry", { kind: "booster-expiry" }, "other", ["other"]),
  reportCase("special-core", { kind: "special-core" }, "special-core-missed", [
    "not-recognized",
    "recognized-no-alert",
    "playback-missing",
  ]),
  reportCase(
    "special-core",
    { kind: "special-core" },
    "special-core-false-alert",
    ["wrong-target", "duplicate-alert", "unexpected-playback"],
  ),
  reportCase("special-core", { kind: "special-core" }, "special-core-timing", [
    "early-alert",
    "late-alert",
    "repeat-timing",
    "playback-missing",
  ]),
  reportCase("special-core", { kind: "special-core" }, "other", ["other"]),
];

const SCENARIO_VARIANTS = REPORT_CASES.flatMap((report) =>
  report.scenarios.flatMap((scenario) =>
    getSimulationVariants(report.feature).map((variant) => ({
      report,
      scenario,
      variant,
    })),
  ),
);

const SIMULATIONS = SCENARIO_VARIANTS.flatMap((simulation) =>
  OCCURRENCES.map((occurrence) => ({ ...simulation, occurrence })),
);

describe("alert issue scenario simulation", () => {
  it("keeps the explicit 22-case matrix synchronized with the report dialog", () => {
    expect(REPORT_CASES).toHaveLength(22);
    expect(
      new Set(REPORT_CASES.flatMap((entry) => entry.scenarios)),
    ).toHaveLength(13);
    expect(SCENARIO_VARIANTS).toHaveLength(83);
    expect(SIMULATIONS).toHaveLength(249);

    for (const target of uniqueTargets(REPORT_CASES)) {
      const expected = REPORT_CASES.filter((entry) =>
        sameTarget(entry.target, target),
      ).map((entry) => ({ reason: entry.reason, label: entry.label }));
      expect(getAlertIssueReportOptions(target)).toEqual(expected);
    }

    for (const report of REPORT_CASES) {
      expect(
        getAlertIssueReportScenarioOptions(report.reason).map(
          (entry) => entry.scenario,
        ),
      ).toEqual(report.scenarios);
    }
  });

  it("limits structural evidence gaps to expired historical incidents", () => {
    const gaps = SIMULATIONS.map(({ report, scenario, occurrence, variant }) => ({
      feature: report.feature,
      scenario,
      occurrence,
      gaps: expectedStructuralEvidenceGaps(
        report.feature,
        scenario,
        occurrence,
        variant,
      ),
    })).filter((entry) => entry.gaps.length > 0);

    expect(gaps).toHaveLength(12);
    expect(gaps.filter((entry) => entry.gaps.includes("playback"))).toHaveLength(10);
    expect(
      gaps.filter((entry) => entry.gaps.includes("stateBeforeAfter")),
    ).toEqual([
      expect.objectContaining({
        feature: "rune",
        scenario: "recognized-no-alert",
        occurrence: "historical",
      }),
    ]);
  });

  it.each(SIMULATIONS)(
    "$report.feature / $report.reason / $scenario / $variant / $occurrence",
    ({ report, scenario, occurrence, variant }) => {
      const issue = createIssue(report, scenario, occurrence);
      const journalSelection = createJournalSelection(report.feature, scenario);
      const payload = buildFeaturePayload(
        report.feature,
        issue,
        journalSelection,
        variant,
      );
      const compacted = compactReportPayload(payload);
      const body = asRecord(compacted);
      const incident = asRecord(body.incident);
      const journal = asRecord(incident.journal);
      const reportIssue = asRecord(body.reportIssue);

      expect(body.reportContract).toEqual({
        schema: "maple-timer.alert-report",
        version: 1,
      });
      expect(reportIssue).toMatchObject({
        reason: report.reason,
        scenario,
        occurrence,
      });
      expect(incident).toMatchObject({
        feature: report.feature,
        reason: report.reason,
        scenario,
        occurrence,
      });
      expect(journal.status).toBe(expectedJournalStatus(occurrence));
      expect(asArray(journal.entries)).toHaveLength(
        occurrence === "historical"
          ? 0
          : expectedSelectedJournalEntryCount(report.feature, scenario),
      );
      expect(getReportPayloadByteLength(body)).toBeLessThan(6 * 1024 * 1024);

      const viewModel = buildTroubleshooterViewModel(body, {
        now: CAPTURED_AT,
      });
      expect(viewModel.feature).toBe(report.feature);
      expect(viewModel.metadata.issueReason).toBe(report.reason);
      expect(viewModel.metadata.incident).toMatchObject({
        scenario,
        occurrence,
        journalStatus: expectedJournalStatus(occurrence),
      });
      expect(viewModel.diagnostics.map((entry) => entry.id)).not.toContain(
        "incident-contract-missing",
      );

      const missingEvidence = getAlertIssueEvidenceRequirements(
        scenario,
      ).filter(
        (key) => viewModel.metadata.incident?.completeness[key] !== true,
      );
      expect(missingEvidence).toEqual(
        expectedStructuralEvidenceGaps(
          report.feature,
          scenario,
          occurrence,
          variant,
        ),
      );

      const diagnosticIds = viewModel.diagnostics.map((entry) => entry.id);
      expect(diagnosticIds).not.toContain(
        "incident-referenced-evidence-missing",
      );
      if (scenario === "recognized-no-alert" && occurrence !== "historical") {
        expect(asRecord(journal.coverage)).toEqual({
          playbackLifecycleMonitored: true,
          playbackEventCount: 0,
          relatedPlaybackEventCount: 0,
          lifecycleEventCount: 0,
        });
        expect(viewModel.metadata.incident?.completeness.playback).toBe(true);
        expect(viewModel.metadata.incident?.correlation.playbackCount).toBe(0);
      }
      if (occurrence === "historical") {
        expect(diagnosticIds).toContain("incident-historical");
      } else {
        expect(diagnosticIds).not.toContain("incident-journal-unavailable");
      }
      if (missingEvidence.length > 0) {
        expect(diagnosticIds).toContain("incident-required-evidence-missing");
      } else {
        expect(diagnosticIds).not.toContain(
          "incident-required-evidence-missing",
        );
      }
    },
  );

  it.each(SCENARIO_VARIANTS)(
    "$report.feature / $report.reason / $scenario / $variant keeps compacted evidence references honest",
    ({ report, scenario, variant }) => {
      const issue = createIssue(report, scenario, "recent");
      const payload = buildFeaturePayload(
        report.feature,
        issue,
        createJournalSelection(report.feature, scenario),
        variant,
      );
      const compacted = asRecord(
        compactReportPayload(payload, { targetBytes: 2_500, aggressive: true }),
      );
      const references = asArray(
        asRecord(asRecord(compacted.incident).evidenceManifest).references,
      ).map(asRecord);

      for (const reference of references) {
        const retainedPaths = asArray(reference.retainedPaths);
        expect(reference.retained).toBe(retainedPaths.length > 0);
        for (const path of retainedPaths) {
          expect(readPath(compacted, String(path))).not.toBeNull();
          expect(readPath(compacted, String(path))).not.toBeUndefined();
        }
      }
      expect(asRecord(compacted.reportPayloadBudget).overTarget).toBeTypeOf(
        "boolean",
      );
      const viewModel = buildTroubleshooterViewModel(compacted, {
        now: CAPTURED_AT,
      });
      const manifest = viewModel.metadata.incident?.evidenceManifest;
      expect(manifest?.producedReferenceCount).toBeLessThanOrEqual(
        manifest?.referenceCount ?? 0,
      );
      expect(manifest?.retainedReferenceCount).toBeLessThanOrEqual(
        manifest?.producedReferenceCount ?? 0,
      );
      if (
        manifest &&
        manifest.retainedReferenceCount < manifest.producedReferenceCount
      ) {
        expect(viewModel.diagnostics.map((entry) => entry.id)).toContain(
          "incident-referenced-evidence-missing",
        );
      }
    },
  );

  it.each(SCENARIO_VARIANTS)(
    "$report.feature / $report.reason / $scenario / $variant remains diagnosable after Cloudflare asset and Slack formatting",
    ({ report, scenario, variant }) => {
      const issue = createIssue(report, scenario, "recent");
      const body = buildFeaturePayload(
        report.feature,
        issue,
        createJournalSelection(report.feature, scenario),
        variant,
      );
      const metadata = metadataFromSample(
        `sample-${report.feature}-${report.reason}-${scenario}-${variant}`,
        body,
        CAPTURED_AT,
      );
      const assets = getDebugSampleAssets(body);
      const slack = buildDebugSampleSlackNotificationPayload({
        id: metadata.id,
        key: `sample:${metadata.id}`,
        metadata,
        body,
        requestUrl: "https://maple-timer.com/api/debug-samples",
      });
      const slackText = JSON.stringify(slack);
      const evidenceReferences = asArray(
        asRecord(asRecord(body.incident).evidenceManifest).references,
      ).map(asRecord);
      const producedReferenceCount = evidenceReferences.filter(
        (reference) => reference.produced === true,
      ).length;
      const retainedReferenceCount = evidenceReferences.filter(
        (reference) => reference.retained === true,
      ).length;
      const unavailableReferenceCount =
        evidenceReferences.length - producedReferenceCount;

      expect(hasRequiredSampleImages(body)).toBe(true);
      expect(assets.length).toBeGreaterThan(0);
      expect(slackText).toContain(report.label);
      expect(slackText).toContain(issue.scenarioLabel);
      expect(slackText).toContain("제보 창을 열기 전 1분 이내");
      if (report.reason === "other") {
        expect(slackText).toContain("기타 분류");
        expect(slackText).toContain("속도 저하나 오류");
      }
      expect(slackText).toContain("증거 결합");
      expect(slackText).toContain(
        `증거 ${retainedReferenceCount}/${producedReferenceCount}`,
      );
      if (unavailableReferenceCount > 0) {
        expect(slackText).toContain(`미생성 ${unavailableReferenceCount}`);
      }
      expect(slackText).toContain(
        `사건 연결 ${expectedSelectedJournalEntryCount(report.feature, scenario)}개`,
      );
    },
  );
});

function reportCase(
  feature: AlertIssueFeature,
  target: AlertIssueReportTarget,
  reason: string,
  scenarios: AlertIssueScenario[],
): ReportCase {
  const option = getAlertIssueReportOptions(target).find(
    (entry) => entry.reason === reason,
  );
  if (!option) {
    throw new Error(`Missing report option: ${feature}/${reason}`);
  }
  return { feature, target, reason, label: option.label, scenarios };
}

function createIssue(
  report: ReportCase,
  scenario: AlertIssueScenario,
  occurrence: AlertIssueOccurrence,
): AlertIssueReportDetails {
  const scenarioOption = getAlertIssueReportScenarioOptions(report.reason).find(
    (entry) => entry.scenario === scenario,
  );
  return {
    reason: report.reason,
    label: report.label,
    note: report.reason === "other" ? "기타 상황 시뮬레이션" : undefined,
    otherCategory:
      report.reason === "other" ? "performance-error" : undefined,
    otherCategoryLabel:
      report.reason === "other" ? "속도 저하나 오류" : undefined,
    incidentId: `incident-${report.feature}-${report.reason}-${scenario}-${occurrence}`,
    scenario,
    scenarioLabel: scenarioOption?.label ?? scenario,
    occurrence,
    affectedTarget:
      report.feature === "buff-expiry"
        ? { id: "unionWealth", label: "유니온의 부" }
        : undefined,
  };
}

function createJournalSelection(
  feature: AlertIssueFeature,
  scenario: AlertIssueScenario,
): AlertIncidentJournalSelection {
  if (feature === "rune") {
    return createRuneJournalSelection(scenario);
  }
  const journal = createAlertIncidentJournal();
  const targetId = feature === "skill" ? "skill-sim" : null;
  const cycleId = `${feature}-cycle-1`;
  const signals = getScenarioSignals(scenario);
  signals.values.forEach((value, index) => {
    const occurredAt = 94_000 + index * 1_000;
    journal.record({
      id: `${feature}:sample:${occurredAt}`,
      feature,
      targetId,
      kind: "sample",
      occurredAt,
      frameId: `frame:${occurredAt}`,
      cycleId,
      status: signals.detected ? "watching" : "not-detected",
      decision: scenario === "unstable-value" ? "unstable-value" : "candidate",
      value,
      configuration: { enabled: true, threshold: 5 },
      details: { recognizer: `${feature}-sim-v1` },
    });
  });
  journal.record({
    id: `${feature}:decision:96000`,
    feature,
    targetId,
    kind: "decision",
    occurredAt: 96_000,
    frameId: "frame:96000",
    cycleId,
    status: signals.shouldAlert ? "alerted" : "suppressed",
    decision: signals.decision,
    value: signals.shouldAlert,
    configuration: { enabled: true, threshold: 5 },
    details: { shouldAlert: signals.shouldAlert },
  });
  signals.playbacks.forEach((playback, index) => {
    journal.record({
      id: `${feature}:playback:${index}:${playback.requestedAt}`,
      feature,
      targetId,
      kind: "playback",
      occurredAt:
        playback.finishedAt ??
        playback.failedAt ??
        playback.startedAt ??
        playback.requestedAt,
      frameId: "frame:96000",
      cycleId,
      status: playback.status,
      decision: index === 0 ? "initial" : "repeat",
      value: null,
      configuration: { enabled: true, threshold: 5 },
      details: playback,
    });
  });
  return journal.freeze({ feature, targetId }, CAPTURED_AT);
}

function createRuneJournalSelection(
  scenario: AlertIssueScenario,
): AlertIncidentJournalSelection {
  const journal = createAlertIncidentJournal();
  const signals = getScenarioSignals(scenario);
  const episodeId = signals.detected ? "rune-episode:1:94000" : null;
  const sampleCount = Math.max(1, signals.values.length);

  Array.from({ length: sampleCount }, (_, index) => {
    const occurredAt = 94_000 + index * 2_000;
    const shouldAlert = signals.shouldAlert && index === sampleCount - 1;
    const playbackCycleId = signals.playbacks[0]?.cycleId ?? null;
    journal.record({
      id: `rune:sample:${occurredAt}`,
      feature: "rune",
      targetId: null,
      kind: shouldAlert ? "decision" : "sample",
      occurredAt,
      frameId: `frame:${occurredAt}`,
      cycleId: shouldAlert ? playbackCycleId : null,
      status: shouldAlert
        ? "alerted"
        : signals.detected
          ? "candidate"
          : "waiting",
      decision: shouldAlert ? signals.decision : signals.detected ? "stabilizing" : "waiting",
      value: signals.detected,
      configuration: { enabled: true, threshold: 3 },
      details: {
        episodeId,
        recognizer: "rune-sim-v1",
        shouldAlert,
      },
    });
  });

  signals.playbacks.forEach((playback, index) => {
    journal.record({
      id: `rune:playback:${playback.cycleId}`,
      feature: "rune",
      targetId: null,
      kind: "playback",
      occurredAt: playback.requestedAt,
      frameId: "frame:96000",
      cycleId: playback.cycleId,
      status: playback.status,
      decision: index === 0 ? "initial" : "repeat",
      value: null,
      configuration: { enabled: true, threshold: 3 },
      details: { ...playback, episodeId },
    });
  });

  return journal.freeze({ feature: "rune", targetId: null }, CAPTURED_AT);
}

function buildFeaturePayload(
  feature: AlertIssueFeature,
  issue: AlertIssueReportDetails,
  journalSelection: AlertIncidentJournalSelection,
  variant: SimulationVariant,
): Record<string, unknown> {
  const base = {
    submittedAt: SUBMITTED_AT,
    url: "https://maple-timer.com/",
    clientId: "scenario-simulation",
    viewportDiagnostics: {
      userAgent: "scenario-simulation",
      viewport: { width: 1920, height: 1080 },
    },
    captureDiagnostics: {
      hasStream: true,
      size: { width: 1920, height: 1080 },
      layoutKey: "1920x1080",
    },
    issue,
    journalSelection,
  };

  if (feature === "rune") {
    return buildRunePayload(base);
  }
  if (feature === "skill") {
    return buildSkillPayload(base, variant);
  }
  if (feature === "hunt-stall") {
    return buildHuntStallPayload(base, variant);
  }
  if (feature === "buff-expiry") {
    return buildBuffExpiryPayload(base);
  }
  if (feature === "booster-expiry") {
    return buildBoosterExpiryPayload(base);
  }
  return buildSpecialCorePayload(base);
}

type PayloadBase = ReturnType<typeof createPayloadBaseType>;

function createPayloadBaseType() {
  return {
    submittedAt: SUBMITTED_AT,
    url: "",
    clientId: "",
    viewportDiagnostics: { userAgent: "", viewport: { width: 0, height: 0 } },
    captureDiagnostics: {
      hasStream: true,
      size: { width: 0, height: 0 },
      layoutKey: "" as string | null,
    },
    issue: {} as AlertIssueReportDetails,
    journalSelection: {} as AlertIncidentJournalSelection,
  };
}

function buildRunePayload(base: PayloadBase): Record<string, unknown> {
  const scenario = base.issue.scenario ?? "other";
  const signals = getScenarioSignals(scenario);
  const playback = last(signals.playbacks) ?? null;
  const runeEpisodeId = signals.detected ? "rune-episode:1:94000" : null;
  const runtimeIncident = createRuneSimulationRuntimeIncident(
    signals,
    runeEpisodeId,
  );
  const alertTriggers = signals.playbacks.map((entry, index) =>
    createRuneSimulationAlertTrigger({
      playback: entry,
      index,
      detected: signals.detected,
      episodeId: runeEpisodeId,
    }),
  );
  let archiveUpdate = updateRuneEvidenceArchive({
    previousArchive: null,
    runtimeIncident,
    pendingAlertTriggerFrames: [],
    lastAlertTrigger: null,
    sampledAt: CAPTURED_AT,
  });
  alertTriggers.forEach((lastAlertTrigger) => {
    archiveUpdate = updateRuneEvidenceArchive({
      previousArchive: archiveUpdate.archive,
      runtimeIncident,
      pendingAlertTriggerFrames: [],
      lastAlertTrigger,
      sampledAt: CAPTURED_AT,
    });
  });

  const snapshot: RuneSnapshot = {
    sampledAt: 96_000,
    detectorVersion: "rune-sim-v1",
    detectionDebug: {
      detectorKind: "onnx-full-frame",
      classifier: "rune-sim-v1",
      modelScore: signals.detected ? 0.98 : 0,
      modelThreshold: 0.8,
      inferenceMs: 4,
      reason: signals.detected ? null : "below-model-threshold",
    },
    detectionError: null,
    rawPreviewUrl: IMAGE_DATA_URL,
    maskPreviewUrl: IMAGE_DATA_URL,
    candidatePreviewUrl: IMAGE_DATA_URL,
    candidateRawPreviewUrl: IMAGE_DATA_URL,
    candidateMaskPreviewUrl: IMAGE_DATA_URL,
    candidateRegionLabel: "16x16",
    candidateSampledAt: 96_000,
    candidate: signals.detected
      ? {
          x: 10,
          y: 10,
          width: 16,
          height: 16,
          confidence: 0.98,
          source: "onnx",
        }
      : null,
    detected: signals.detected,
    confidence: signals.detected ? 0.98 : 0,
    candidateCount: signals.detected ? 1 : 0,
    runtimeIncident: archiveUpdate.runtimeIncident,
    pendingAlertTriggerFrames: [],
    lastAlertTrigger: archiveUpdate.lastAlertTrigger,
    evidenceMediaBudget: archiveUpdate.archive?.mediaBudget ?? null,
    evidenceArchive: archiveUpdate.archive,
  };
  const recentSamples = [94_000, 96_000].map((sampledAt, index) => ({
    sampledAt,
    detected: signals.detected,
    confidence: signals.detected ? 0.97 : 0,
    candidateCount: signals.detected ? 1 : 0,
    candidate: signals.detected
      ? { x: 10, y: 10, width: 16, height: 16 }
      : null,
    status:
      signals.shouldAlert && index === 1
        ? "alerted"
        : signals.detected
          ? "candidate"
          : "waiting",
    stableCount: index + 2,
    consecutiveMissCount: 0,
    sceneEpoch: 1,
    firstDetectedAt: 94_000,
    stableDurationMs: index * 2_000,
    confirmationSatisfied: signals.detected && index === 1,
    confirmationSatisfiedBy:
      signals.detected && index === 1 ? "frames-and-duration" : null,
    shouldAlert: signals.shouldAlert && index === 1,
    reason:
      signals.shouldAlert && index === 1
        ? "initial-alert"
        : signals.detected
          ? "stabilizing"
          : "waiting",
  }));

  return buildRuneIssueReportPayload({
    ...base,
    snapshot: snapshot as never,
    lastAlertSnapshot:
      base.issue.reason === "rune-missed" ||
      base.issue.reason === "rune-false-positive"
        ? (snapshot as never)
        : null,
    runeConfig: {
      enabled: true,
      region: { x: 0, y: 0, width: 1, height: 1 },
      regionsByLayout: {},
      soundId: "default",
      volume: 1,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 10,
      repeatAlertMaxCount: 2,
    },
    currentRegion: { x: 0, y: 0, width: 1, height: 1 },
    runeState: {
      status: signals.shouldAlert
        ? "alerted"
        : signals.detected
          ? "candidate"
          : "waiting",
      detectorVersion: "rune-sim-v1",
      confidence: 0.98,
      stableCount: 3,
      firstDetectedAt: 94_000,
      lastDetectedAt: 96_000,
      lastFoundAt: 96_000,
      alertedAt: signals.shouldAlert ? 96_000 : null,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      lastAlertedAt: playback?.finishedAt ?? playback?.failedAt ?? null,
      candidateCount: signals.detected ? 1 : 0,
      lastDecisionReason: signals.shouldAlert
        ? "initial-alert"
        : signals.detected
          ? "stabilizing"
          : "waiting",
      lastAlertPlayback: playback
        ? { ...playback, decision: "initial", sceneEpoch: 1 }
        : null,
      recentSamples,
    } as never,
  });
}

function createRuneSimulationRuntimeIncident(
  signals: ScenarioSignals,
  episodeId: string | null,
): RuneRuntimeIncidentEvidence | null {
  if (!signals.detected) {
    return {
      schemaVersion: "rune-runtime-incident-v1",
      id: "rune-missed-incident-1",
      episodeId: null,
      startedAt: 94_000,
      lastSignalAt: 94_000,
      updatedAt: 94_000,
      expiresAt: 154_000,
      detectorVersion: "rune-sim-v1",
      sceneEpoch: 1,
      frames: [
        {
          source: "runtime",
          phase: "signal",
          outcome: "near-threshold",
          sampledAt: 94_000,
          detectorVersion: "rune-sim-v1",
          detectionDebug: {
            detectorKind: "onnx-full-frame",
            classifier: "rune-sim-v1",
            modelScore: 0.65,
            modelThreshold: 0.8,
            inferenceMs: 4,
            reason: "score-below-threshold",
          },
          detectionError: null,
          rawDataUrl: IMAGE_DATA_URL,
          detected: false,
          confidence: 0.65,
          candidateCount: 1,
          candidate: {
            x: 10,
            y: 10,
            width: 16,
            height: 16,
            confidence: 0.65,
            source: "onnx",
          },
          status: "waiting",
          stableCount: 0,
          firstDetectedAt: null,
          stableDurationMs: 0,
          confirmationSatisfied: false,
          confirmationSatisfiedBy: null,
          shouldAlert: false,
          reason: "waiting",
          sceneEpoch: 1,
          sceneChanged: false,
          sceneChangeScore: 0,
          stateBefore: {
            status: "waiting",
            stableCount: 0,
            consecutiveMissCount: 0,
            firstDetectedAt: null,
            alertedAt: null,
            lastRepeatedAlertAt: null,
            repeatedAlertCount: 0,
            sceneEpoch: 1,
            lastDecisionReason: "waiting",
          },
          stateAfter: {
            status: "waiting",
            stableCount: 0,
            consecutiveMissCount: 1,
            firstDetectedAt: null,
            alertedAt: null,
            lastRepeatedAlertAt: null,
            repeatedAlertCount: 0,
            sceneEpoch: 1,
            lastDecisionReason: "waiting",
          },
        },
      ],
    };
  }
  if (!episodeId) {
    return null;
  }
  return {
    schemaVersion: "rune-runtime-incident-v1",
    id: "rune-incident-1",
    episodeId,
    startedAt: 94_000,
    lastSignalAt: 96_000,
    updatedAt: 96_000,
    expiresAt: 156_000,
    detectorVersion: "rune-sim-v1",
    sceneEpoch: 1,
    frames: [94_000, 96_000].map((sampledAt, index) => {
      const shouldAlert = signals.shouldAlert && index === 1;
      const stateBefore = {
        status: index === 0 ? "waiting" as const : "candidate" as const,
        stableCount: index === 0 ? 0 : 2,
        consecutiveMissCount: 0,
        firstDetectedAt: index === 0 ? null : 94_000,
        alertedAt: null,
        lastRepeatedAlertAt: null,
        repeatedAlertCount: 0,
        sceneEpoch: 1,
        lastDecisionReason: index === 0 ? "waiting" as const : "stabilizing" as const,
      };
      const stateAfter = {
        ...stateBefore,
        status: shouldAlert ? "alerted" as const : "candidate" as const,
        stableCount: index === 0 ? 1 : 3,
        firstDetectedAt: 94_000,
        alertedAt: shouldAlert ? sampledAt : null,
        lastDecisionReason: shouldAlert ? "initial-alert" as const : "stabilizing" as const,
      };
      return {
        source: "runtime" as const,
        phase: "signal" as const,
        outcome: "detected" as const,
        sampledAt,
        detectorVersion: "rune-sim-v1",
        detectionDebug: {
          detectorKind: "onnx-full-frame",
          classifier: "rune-sim-v1",
          modelScore: 0.98,
          modelThreshold: 0.8,
          inferenceMs: 4,
          reason: null,
        },
        detectionError: null,
        rawDataUrl: IMAGE_DATA_URL,
        detected: true,
        confidence: 0.98,
        candidateCount: 1,
        candidate: {
          x: 10,
          y: 10,
          width: 16,
          height: 16,
          confidence: 0.98,
          source: "onnx",
        },
        status: stateAfter.status,
        stableCount: stateAfter.stableCount,
        firstDetectedAt: 94_000,
        stableDurationMs: index * 2_000,
        confirmationSatisfied: index === 1,
        confirmationSatisfiedBy: index === 1 ? "frames-and-duration" as const : null,
        shouldAlert,
        reason: shouldAlert ? "initial-alert" as const : "stabilizing" as const,
        sceneEpoch: 1,
        sceneChanged: false,
        sceneChangeScore: 0,
        stateBefore,
        stateAfter,
      };
    }),
  };
}

function createRuneSimulationAlertTrigger({
  playback,
  index,
  detected,
  episodeId,
}: {
  playback: SimulatedPlayback;
  index: number;
  detected: boolean;
  episodeId: string | null;
}): RuneAlertTriggerEvidence {
  const triggeredAt = playback.requestedAt;
  const decision = index === 0 ? "initial" as const : "repeat" as const;
  return {
    schemaVersion: "rune-alert-trigger-v1",
    cycleId: playback.cycleId,
    episodeId,
    decision,
    triggeredAt,
    detectorVersion: "rune-sim-v1",
    sceneEpoch: 1,
    frames: [triggeredAt - 2_000, triggeredAt - 1_000, triggeredAt].map(
      (sampledAt, frameIndex) => ({
        sampledAt,
        detectorVersion: "rune-sim-v1",
        detectionDebug: {
          detectorKind: "onnx-full-frame",
          classifier: "rune-sim-v1",
          modelScore: detected ? 0.96 + frameIndex * 0.01 : 0,
          modelThreshold: 0.8,
          inferenceMs: 4,
          reason: detected ? null : "below-model-threshold",
        },
        rawDataUrl: IMAGE_DATA_URL,
        detected,
        confidence: detected ? 0.96 + frameIndex * 0.01 : 0,
        candidateCount: detected ? 1 : 0,
        candidate: detected
          ? {
              x: 10,
              y: 10,
              width: 16,
              height: 16,
              confidence: 0.96 + frameIndex * 0.01,
              source: "onnx",
            }
          : null,
        status: frameIndex === 2 ? "alerted" : detected ? "candidate" : "waiting",
        stableCount: detected ? frameIndex + 1 : 0,
        firstDetectedAt: detected ? 94_000 : null,
        stableDurationMs: detected ? frameIndex * 1_000 : 0,
        confirmationSatisfied: detected && frameIndex === 2,
        confirmationSatisfiedBy:
          detected && frameIndex === 2 ? "frames-and-duration" : null,
        shouldAlert: frameIndex === 2,
        reason:
          frameIndex === 2
            ? decision === "repeat"
              ? "repeat-alert"
              : "initial-alert"
            : detected
              ? "stabilizing"
              : "waiting",
        sceneEpoch: 1,
      }),
    ),
  };
}

function buildSkillPayload(
  base: PayloadBase,
  variant: SimulationVariant,
): Record<string, unknown> {
  const scenario = base.issue.scenario ?? "other";
  const signals = getScenarioSignals(scenario);
  const isPrecision = variant === "precision";
  const skill = createSkill({
    id: "skill-sim",
    name: "시뮬레이션 스킬",
    enabled: true,
    alertThresholdSeconds: 5,
  });
  const stateBefore = {
    ...createRuntimeState(skill.id),
    status: "running" as const,
    observedRemainingSeconds: 7,
    observedAt: 94_000,
    estimatedExpiresAt: 101_000,
  };
  const state = {
    ...stateBefore,
    status: signals.shouldAlert ? ("alerted" as const) : ("running" as const),
    observedRemainingSeconds: last(signals.values) ?? null,
    observedAt: 96_000,
    alertedAt: signals.shouldAlert ? 96_000 : null,
    lastAlertCycleStartedAt: 94_000,
  };
  const sampleValues =
    signals.values.length > 1
      ? signals.values.slice(0, 2)
      : [signals.values[0], signals.values[0]];
  const samples = [94_000, 96_000].map((sampledAt, index) => ({
    sampledAt,
    ocrValue: sampleValues[index] ?? null,
    confidence: signals.detected ? 0.98 : 0,
    recognizedText:
      sampleValues[index] === null ? null : String(sampleValues[index]),
    reason: signals.detected ? null : "not-recognized",
    digitCount: sampleValues[index] === null ? null : 1,
    foregroundRatio: 0.2,
    statusBefore: "running",
    statusAfter: signals.shouldAlert && index === 1 ? "alerted" : "running",
    observedRemainingSeconds: sampleValues[index] ?? null,
    estimatedRemainingSeconds: sampleValues[index] ?? null,
    alertThresholdSeconds: 5,
    alertInSeconds: Math.max(0, 2 - index * 2),
    estimatedExpiresAt: 101_000,
    rejectedReading: null,
    pendingShortAnchorCount: null,
    shouldFireAlert: signals.shouldAlert && index === 1,
    shouldRepeatAlert: false,
    alertDecision: signals.shouldAlert && index === 1 ? "initial" : null,
  }));
  return buildSkillIssueReportPayload({
    ...base,
    skill,
    currentRegion: skill.region,
    snapshot: {
      sampledAt: 96_000,
      rawPreviewUrl: IMAGE_DATA_URL,
      previewUrl: IMAGE_DATA_URL,
      regionLabel: "36x36",
      result: {
        value: last(signals.values) ?? null,
        confidence: signals.detected ? 0.98 : 0,
        debug: {
          recognizedText:
            last(signals.values) === null ? null : String(last(signals.values)),
          reason: signals.detected ? "ok" : "not-recognized",
        },
      },
    },
    state,
    stateBefore: isPrecision ? stateBefore : null,
    runtimeTraceSample: isPrecision ? samples[1] : null,
    estimatedRemainingSeconds: last(signals.values) ?? null,
    alertInSeconds: signals.shouldAlert ? 0 : 2,
    timeline: {
      samples,
      alertEvents: signals.playbacks.map((playback) => ({
        startedAt: playback.startedAt ?? playback.requestedAt,
        alertCycleStartedAt: 94_000,
        soundId: skill.soundId,
        status: playback.status,
        finishedAt: playback.finishedAt,
        failedAt: playback.failedAt,
          error: playback.error,
        })),
      frames: isPrecision
        ? []
        : samples.map((sample, index) => ({
            sampledAt: sample.sampledAt,
            reasons: [
              sample.shouldFireAlert
                ? "alert"
                : sample.reason ?? "interval",
            ],
            rawDataUrl: IMAGE_DATA_URL,
            processedDataUrl: IMAGE_DATA_URL,
            recognition: {
              value: sample.ocrValue,
              confidence: sample.confidence,
              reason: sample.reason,
            },
            decision: sample.alertDecision,
            stateBefore: {
              status: index === 0 ? stateBefore.status : samples[index - 1].statusAfter,
              observedRemainingSeconds:
                index === 0
                  ? stateBefore.observedRemainingSeconds
                  : samples[index - 1].observedRemainingSeconds,
              observedRemainingCount: null,
              estimatedExpiresAt: stateBefore.estimatedExpiresAt,
              alertedAt: null,
              lastRepeatedAlertAt: null,
              repeatedAlertCount: 0,
              rejectedReading: null,
            },
            stateAfter: {
              status: sample.statusAfter,
              observedRemainingSeconds: sample.observedRemainingSeconds,
              observedRemainingCount: null,
              estimatedExpiresAt: sample.estimatedExpiresAt,
              alertedAt: sample.shouldFireAlert ? sample.sampledAt : null,
              lastRepeatedAlertAt: null,
              repeatedAlertCount: 0,
              rejectedReading: sample.rejectedReading,
            },
          })),
    },
    runtimeEvidence: isPrecision
      ? createRuntimeEvidence("skill-buff-duration")
      : null,
    relatedActiveSkills: [skill],
  } as never);
}

function buildHuntStallPayload(
  base: PayloadBase,
  variant: SimulationVariant,
): Record<string, unknown> {
  const scenario = base.issue.scenario ?? "other";
  const signals = getScenarioSignals(scenario);
  const playback = last(signals.playbacks) ?? null;
  const isCooldown = variant === "cooldown";
  const values = ensureTemporalValues(signals.values);
  const trace = values.map((value, index) => {
    const sampledAt = 94_000 + index * 1_000;
    const isLast = index === values.length - 1;
    const recognizedText = isCooldown ? null : formatSimulatedValue(value);
    return {
      sampledAt,
      mode: "manual-experience",
      status:
        signals.shouldAlert && isLast
          ? "alerted"
          : signals.detected
            ? "watching"
            : "unreadable",
      lastDecision: isLast
        ? signals.decision
        : signals.detected
          ? "stable"
          : "not-recognized",
      shouldAlert: signals.shouldAlert && isLast,
      recognizedText,
      snapshotRecognizedText: recognizedText,
      alertedRecognizedText:
        signals.shouldAlert && isLast ? recognizedText : null,
      pendingRecognizedText: null,
      pendingRecognizedCount: 0,
      lastRejectedRecognizedText: null,
      lastReadFailureReason: null,
      confidence: signals.detected ? 0.98 : 0,
      foregroundRatio: 0.2,
      unchangedSeconds: index * 2,
      stableSampleCount: index + 1,
      lastChangedAt: 92_000,
      lastReadableAt: signals.detected ? sampledAt : null,
      lastReadFailureAt: null,
      alertedAt: signals.shouldAlert && isLast ? sampledAt : null,
      lastRepeatedAlertAt: null,
      repeatedAlertCount: 0,
      lastAlertedAt:
        playback && isLast ? (playback.finishedAt ?? playback.failedAt) : null,
      lastAlertPlaybackStatus: playback && isLast ? playback.status : null,
      lastAlertPlaybackRequestedAt:
        playback && isLast ? playback.requestedAt : null,
      lastAlertPlaybackStartedAt:
        playback && isLast ? playback.startedAt : null,
      lastAlertPlaybackFinishedAt:
        playback && isLast ? playback.finishedAt : null,
      hasObservedCooldownPresence: isCooldown && signals.detected,
      cooldownLastDetectedAt: isCooldown && signals.detected ? sampledAt : null,
      cooldownMissingSeconds: isCooldown ? index * 2 : 0,
      cooldownConsecutiveReadableCount:
        isCooldown && signals.detected ? index + 1 : 0,
      cooldownVisualChangeScore: isCooldown ? 0.03 : null,
      cooldownVisualChanged: isCooldown ? false : null,
      cooldownUsedVisualActivity: isCooldown,
    };
  });
  const latestValue = last(signals.values) ?? null;
  const latestText = isCooldown ? null : formatSimulatedValue(latestValue);
  const cropHistory = trace.map((frame, index) => {
    const previousFrame = trace[index - 1] ?? null;
    const stateBefore = {
      status: previousFrame?.status ?? "detecting",
      lastDecision: previousFrame?.lastDecision ?? "idle",
      recognizedText: previousFrame?.recognizedText ?? null,
      alertedRecognizedText: null,
      lastRejectedRecognizedText: null,
      lastReadFailureReason: null,
      unchangedSeconds: previousFrame?.unchangedSeconds ?? 0,
      cooldownMissingSeconds: previousFrame?.cooldownMissingSeconds ?? 0,
      alertedAt: previousFrame?.alertedAt ?? null,
    };
    const stateAfter = {
      status: frame.status,
      lastDecision: frame.lastDecision,
      recognizedText: frame.recognizedText,
      alertedRecognizedText: frame.alertedRecognizedText,
      lastRejectedRecognizedText: frame.lastRejectedRecognizedText,
      lastReadFailureReason: frame.lastReadFailureReason,
      unchangedSeconds: frame.unchangedSeconds,
      cooldownMissingSeconds: frame.cooldownMissingSeconds,
      alertedAt: frame.alertedAt,
    };
    return {
      sampledAt: frame.sampledAt,
      mode: isCooldown ? "cooldown-presence" : "manual-experience",
      reasons: [frame.shouldAlert ? "alert" : "interval"],
      rawDataUrl: IMAGE_DATA_URL,
      processedDataUrl: IMAGE_DATA_URL,
      regionLabel: isCooldown ? "36x36" : "640x8",
      recognizedText: frame.recognizedText,
      debugText: frame.lastDecision,
      confidence: frame.confidence,
      foregroundRatio: frame.foregroundRatio ?? 0,
      changeScore: 0,
      cooldownVisualChangeScore: frame.cooldownVisualChangeScore,
      cooldownVisualChanged: frame.cooldownVisualChanged,
      cooldownUsedVisualActivity: frame.cooldownUsedVisualActivity,
      state: stateAfter,
      stateBefore,
      stateAfter,
    };
  });
  return buildHuntStallIssueReportPayload({
    ...base,
    config: {
      ...createDefaultHuntStallAlert(),
      enabled: true,
      mode: isCooldown ? "cooldown-presence" : "manual-experience",
    },
    snapshot: {
      sampledAt: 96_000,
      mode: isCooldown ? "cooldown-presence" : "manual-experience",
      rawPreviewUrl: IMAGE_DATA_URL,
      processedPreviewUrl: IMAGE_DATA_URL,
      fullFramePreviewUrl: null,
      regionLabel: "640x8",
      recognizedText: latestText,
      debugText: signals.detected ? "ok" : "not-recognized",
      confidence: signals.detected ? 0.98 : 0,
      foregroundRatio: 0.2,
      changeScore: 0,
      runtimeTrace: trace,
      cropHistory,
      cropCandidates: [],
    } as never,
    state: {
      ...createHuntStallRuntimeState(),
      status: signals.shouldAlert
        ? "alerted"
        : signals.detected
          ? "watching"
          : "waiting",
      lastSampledAt: 96_000,
      lastReadableAt: signals.detected ? 96_000 : null,
      alertedAt: signals.shouldAlert ? 96_000 : null,
      recognizedText: latestText,
      lastDecision: signals.decision,
      lastAlertPlayback: playback,
    } as never,
  });
}

function buildBuffExpiryPayload(base: PayloadBase): Record<string, unknown> {
  const scenario = base.issue.scenario ?? "other";
  const signals = getScenarioSignals(scenario);
  const playback = last(signals.playbacks) ?? null;
  const stateBefore = {
    ...createBuffExpiryRuntimeState(),
    status: "tracking" as const,
    lastSampledAt: 94_000,
  };
  const state = {
    ...stateBefore,
    lastSampledAt: 96_000,
    lastAlertedAt: playback?.finishedAt ?? playback?.failedAt ?? null,
    lastAlertPlayback: playback,
  };
  return buildBuffExpiryIssueReportPayload({
    ...base,
    config: { ...createDefaultBuffExpiryAlert(), enabled: true },
    snapshot: {
      sampledAt: 96_000,
      rawPreviewUrl: IMAGE_DATA_URL,
      processedPreviewUrl: IMAGE_DATA_URL,
      fullFramePreviewUrl: null,
      roi: { x: 960, y: 0, width: 960, height: 540 },
      boxes: [],
      displayBoxes: [],
      tracks: [],
      pendingTracks: [],
      runtimeTrace: ensureTemporalValues(signals.values).map(
        (value, index, values) => ({
          sampledAt: 94_000 + index * 1_000,
          status: "tracking",
          boxCount: 0,
          acceptedMatchCount: 0,
          tracks: [],
          pendingTracks: [],
          shouldAlert: signals.shouldAlert && index === values.length - 1,
          alertedTrackIds: [],
          alertDecision:
            index === values.length - 1
              ? {
                  shouldAlert: signals.shouldAlert,
                  reason: signals.decision,
                  dueTracks: [],
                  newAlertTrackIds: [],
                  suppressedTrackIds: [],
                  deferredTrackIds: [],
                  markedTrackIds: [],
                  dueGroupExpiresAt: null,
                  nearestExistingAlertGroup: null,
                }
              : null,
          observedValue: value,
          next: null,
          unsupportedReason: null,
          performance: null,
        }),
      ),
      alertDecisionHistory: [],
      nextIconObservations: [],
      nextBestByGroup: [],
      nextRecentRoiFrames: [],
      nextModuleVersions: { parser: "parser-sim-v1" },
      parserEngine: "dl",
      parserFallbackReason: null,
      unsupportedReason: null,
      performance: null,
    } as never,
    state,
    stateBefore,
    runtimeEvidence: createRuntimeEvidence("buff-expiry"),
  });
}

function buildBoosterExpiryPayload(base: PayloadBase): Record<string, unknown> {
  const scenario = base.issue.scenario ?? "other";
  const signals = getScenarioSignals(scenario);
  const playback = last(signals.playbacks) ?? null;
  const values = ensureTemporalValues(signals.values);
  const trace = values.map((value, index) => {
    const sampledAt = 94_000 + index * 1_000;
    const isLast = index === values.length - 1;
    const text = formatBoosterValue(value);
    return {
      sampledAt,
      status:
        signals.shouldAlert && isLast
          ? "alerted"
          : signals.detected
            ? "armed"
            : "waiting",
      rawText: text,
      displayText: text,
      rawRemainingSeconds: value,
      remainingSeconds: value,
      estimatedExpiresAt: 101_000,
      alertAt: 96_000,
      cycleCandidateObservationCount: 3,
      cycleCandidateDecreaseSeconds: 2,
      confirmedAt: 94_000,
      confirmedExpiresAt: 101_000,
      confirmedLastSupportedAt: sampledAt,
      confirmedContradictionCount: 0,
      alerted: signals.shouldAlert && isLast,
      flowSource: "raw-lock",
      locked: signals.detected,
      decision: isLast
        ? signals.decision
        : signals.detected
          ? "raw-locked"
          : "not-detected",
      rect: { x: 400, y: 30, width: 100, height: 30 },
      performance: null,
    };
  });
  const latestValue = last(signals.values) ?? null;
  const latestText = formatBoosterValue(latestValue);
  const timerEvidence = values.map((value, index) => ({
    sampledAt: 94_000 + index * 1_000,
    dataUrl: IMAGE_DATA_URL,
    rect: { x: 400, y: 30, width: 100, height: 30 },
    rawText: formatBoosterValue(value),
    displayText: formatBoosterValue(value),
    rawRemainingSeconds: value,
    remainingSeconds: value,
    predictedExpiresAt: 101_000,
    confirmedExpiresAt: 101_000,
    alertAt: 96_000,
    flowSource: "raw-lock",
    locked: signals.detected,
    decision: index === values.length - 1 ? signals.decision : "raw-locked",
    format: "ss.cc",
    selectedBy: "decimal",
    stateBefore: {
      status: index === 0 ? "confirming" : "armed",
      decision: index === 0 ? "raw-pending" : "raw-locked",
      rawRemainingSeconds: values[Math.max(0, index - 1)] ?? null,
      remainingSeconds: values[Math.max(0, index - 1)] ?? null,
      estimatedExpiresAt: 101_000,
      alertAt: 96_000,
      alertedAt: null,
      confirmedAt: index === 0 ? null : 94_000,
      confirmedExpiresAt: index === 0 ? null : 101_000,
      locked: index > 0,
      flowSource: index === 0 ? null : "raw-lock",
    },
    stateAfter: {
      status:
        signals.shouldAlert && index === values.length - 1
          ? "alerted"
          : "armed",
      decision:
        index === values.length - 1 ? signals.decision : "raw-locked",
      rawRemainingSeconds: value,
      remainingSeconds: value,
      estimatedExpiresAt: 101_000,
      alertAt: 96_000,
      alertedAt:
        signals.shouldAlert && index === values.length - 1
          ? 94_000 + index * 1_000
          : null,
      confirmedAt: 94_000,
      confirmedExpiresAt: 101_000,
      locked: signals.detected,
      flowSource: "raw-lock",
    },
  }));
  return buildBoosterExpiryIssueReportPayload({
    ...base,
    config: { ...createDefaultBoosterExpiryAlert(), enabled: true },
    snapshot: {
      sampledAt: 96_000,
      rawPreviewUrl: IMAGE_DATA_URL,
      timerPreviewUrl: IMAGE_DATA_URL,
      regionLabel: "top-center 1280x180",
      rawTime: {
        ok: signals.detected,
        reason: signals.detected ? "ok" : "not-detected",
        rect: timerEvidence[0]?.rect ?? null,
        digitCount: 4,
        seconds: latestValue,
        text: latestText,
        format: "ss.cc",
        selectedBy: "decimal",
      },
      time: {
        ok: signals.detected,
        reason: signals.detected ? "ok" : "not-detected",
        rect: timerEvidence[0]?.rect ?? null,
        digitCount: 4,
        seconds: latestValue,
        text: latestText,
        format: "ss.cc",
        selectedBy: "decimal",
      },
      timeRect: {
        ok: signals.detected,
        reason: signals.detected ? "ok" : "not-detected",
        rect: timerEvidence[0]?.rect ?? null,
        matchCount: signals.detected ? 1 : 0,
        candidateCount: signals.detected ? 1 : 0,
      },
      flow: {
        locked: signals.detected,
        source: "raw-lock",
        predictedSeconds: latestValue,
        rawDeltaSeconds: -2,
        timestampMs: 96_000,
      },
      runtimeTrace: trace,
      timerEvidence,
      confirmationEvidence: timerEvidence.slice(0, 2),
      recognizerVersion: "booster-sim-v1",
      performance: null,
    } as never,
    state: {
      ...createBoosterExpiryRuntimeState(),
      status: signals.shouldAlert
        ? "alerted"
        : signals.detected
          ? "armed"
          : "waiting",
      lastSampledAt: 96_000,
      lastDetectedAt: signals.detected ? 96_000 : null,
      rawText: latestText,
      displayText: latestText,
      remainingSeconds: latestValue,
      estimatedExpiresAt: 101_000,
      alertAt: 96_000,
      alertedAt: signals.shouldAlert ? 96_000 : null,
      flowSource: "raw-lock",
      locked: signals.detected,
      lastAlertPlayback: playback,
    } as never,
  });
}

function buildSpecialCorePayload(base: PayloadBase): Record<string, unknown> {
  const scenario = base.issue.scenario ?? "other";
  const signals = getScenarioSignals(scenario);
  const playback = last(signals.playbacks) ?? null;
  const candidate = signals.detected ? createSpecialCoreCandidate() : null;
  const stateBefore = createSpecialCoreRuntimeState({
    status: signals.detected ? "confirming" : "waiting",
    activationId: 1,
    activationStartedAt: signals.detected ? 94_000 : null,
  });
  const state = createSpecialCoreRuntimeState({
    ...stateBefore,
    status: signals.shouldAlert
      ? "alerted"
      : signals.detected
        ? "cooldown"
        : "waiting",
    activationId: 1,
    activationConfirmedAt: signals.detected ? 96_000 : null,
    cooldownEndsAt: signals.detected ? 156_000 : null,
    alertDueAt: signals.detected ? 151_000 : null,
    alertedAt: signals.shouldAlert ? 96_000 : null,
    lastDetectedIcon: candidate,
    lastAlertPlayback: playback,
  });
  const values = ensureTemporalValues(signals.values);
  const timelineSamples = values.map((value, index) => {
    const sampledAt = 94_000 + index * 1_000;
    const isLast = index === values.length - 1;
    return {
      sampledAt,
      parserEngine: "dl" as const,
      parserVersion: "parser-sim-v1",
      parserFallbackReason: null,
      boxCount: signals.detected ? 1 : 0,
      detectedCount: signals.detected ? index + 1 : 0,
      candidateCount: signals.detected ? 1 : 0,
      detected: signals.detected,
      bestMatch: null,
      statusBefore: index === 1 ? "confirming" : "waiting",
      statusAfter: isLast
        ? state.status
        : signals.detected
          ? "confirming"
          : "waiting",
      pendingDetectionCount: signals.detected ? index + 1 : 0,
      activationId: 1,
      activationStartedAt: 94_000,
      activationConfirmedAt: signals.detected && isLast ? 96_000 : null,
      cooldownEndsAt: signals.detected && isLast ? 156_000 : null,
      alertDueAt: signals.detected && isLast ? 151_000 : null,
      alertedAt: signals.shouldAlert && isLast ? 96_000 : null,
      observedValue: value,
      error: null,
    };
  });
  return buildSpecialCoreIssueReportPayload({
    ...base,
    config: { ...createDefaultSpecialCoreAlert(), enabled: true },
    snapshot: {
      sampledAt: 96_000,
      boxCount: signals.detected ? 1 : 0,
      detectedCount: signals.detected ? 1 : 0,
      detectedIcon: candidate,
      candidateIcons: candidate ? [candidate] : [],
      parserEngine: "dl",
      parserVersion: "parser-sim-v1",
      parserFallbackReason: null,
      performance: null,
      error: null,
    },
    reportSnapshot: null,
    evidenceHistory: [],
    state,
    stateBefore,
    timeline: {
      samples: timelineSamples,
      playbackEvents: signals.playbacks.map((entry) => ({
        ...entry,
        recordedAt: entry.finishedAt ?? entry.failedAt ?? entry.requestedAt,
      })),
    },
    runtimeEvidence: createRuntimeEvidence("special-core"),
  } as never);
}

function ensureTemporalValues(
  values: Array<number | null>,
): Array<number | null> {
  return values.length > 1 ? values : [values[0] ?? null, values[0] ?? null];
}

function formatSimulatedValue(value: number | null): string | null {
  return value === null ? null : `1,000 [${value.toFixed(3)}%]`;
}

function formatBoosterValue(value: number | null): string | null {
  return value === null ? null : `${String(value).padStart(2, "0")}.00`;
}

function createSpecialCoreCandidate(): SpecialCoreCandidateIcon {
  return {
    boxIndex: 0,
    box: {
      x: 120,
      y: 24,
      size: 32,
      confidence: 0.98,
      score: 4.2,
    },
    icon: {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([120, 80, 220, 255]),
    },
    match: {
      matched: true,
      targetId: "specialCore",
      bundleId: "special-core-deep-v2",
      modelId: "special-core-deep-v2",
      modelVersion: "special-core-sim-v1",
      variantId: "simulation",
      gateVersion: 2,
      score: 4.2,
      threshold: 0,
      margin: 4.2,
      gateScore: 0.98,
      gateThreshold: 0.94,
      gateMargin: 0.04,
      rescueThreshold: 0.999,
      rescueMargin: -0.019,
      basePassed: true,
      positiveGatePassed: true,
      primaryPassed: true,
      rescuePassed: false,
      decisionReason: "base_and_positive_gate_passed",
      elapsedMs: 2,
    },
  };
}

function createRuntimeEvidence(
  feature: "skill-buff-duration" | "buff-expiry" | "special-core",
) {
  return {
    target: { feature },
    sampledAt: 96_000,
    source: {
      kind: "buff-slot-top-right-quadrant-v1" as const,
      parserInputMode: "topRightQuadrant" as const,
      coordinateSpace: "capture-pixels" as const,
      sourceSize: { width: 1920, height: 1080 },
      roi: { x: 960, y: 0, width: 960, height: 540 },
      dataUrl: IMAGE_DATA_URL,
    },
    parser: {
      engine: "dl" as const,
      version: "parser-sim-v1",
      fallbackReason: null,
    },
  };
}

type SimulatedPlayback = {
  status: "finished" | "failed";
  cycleId: string;
  soundId: string;
  requestedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  error: string | null;
};

function createPlayback(cycleId: string): SimulatedPlayback {
  return {
    status: "finished",
    cycleId,
    soundId: "default",
    requestedAt: 97_000,
    startedAt: 97_100,
    finishedAt: 98_000,
    failedAt: null,
    error: null,
  };
}

type ScenarioSignals = {
  detected: boolean;
  values: Array<number | null>;
  shouldAlert: boolean;
  decision: string;
  playbacks: SimulatedPlayback[];
};

function getScenarioSignals(scenario: AlertIssueScenario): ScenarioSignals {
  const initial = createPlayback("scenario-cycle-1");
  if (scenario === "not-recognized") {
    return {
      detected: false,
      values: [null],
      shouldAlert: false,
      decision: "not-recognized",
      playbacks: [],
    };
  }
  if (scenario === "recognized-no-alert") {
    return {
      detected: true,
      values: [7, 5],
      shouldAlert: false,
      decision: "threshold-reached-no-alert",
      playbacks: [],
    };
  }
  if (scenario === "playback-missing") {
    return {
      detected: true,
      values: [7, 5],
      shouldAlert: true,
      decision: "initial",
      playbacks: [
        {
          ...initial,
          status: "failed",
          startedAt: null,
          finishedAt: null,
          failedAt: 98_000,
          error: "audio-playback-failed",
        },
      ],
    };
  }
  if (scenario === "wrong-target") {
    return {
      detected: true,
      values: [99],
      shouldAlert: false,
      decision: "wrong-target-accepted",
      playbacks: [],
    };
  }
  if (scenario === "wrong-value") {
    return {
      detected: true,
      values: [8, 3],
      shouldAlert: false,
      decision: "value-rejected",
      playbacks: [],
    };
  }
  if (scenario === "unstable-value") {
    return {
      detected: true,
      values: [8, 3, 7],
      shouldAlert: false,
      decision: "unstable-value",
      playbacks: [],
    };
  }
  if (scenario === "unexpected-playback") {
    return {
      detected: false,
      values: [null],
      shouldAlert: false,
      decision: "no-alert-decision",
      playbacks: [initial],
    };
  }
  if (scenario === "duplicate-alert" || scenario === "repeat-timing") {
    return {
      detected: true,
      values: [7, 5],
      shouldAlert: true,
      decision: scenario,
      playbacks: [
        initial,
        {
          ...initial,
          cycleId: "scenario-cycle-1:repeat",
          requestedAt: 98_100,
          startedAt: 98_200,
          finishedAt: 99_000,
        },
      ],
    };
  }
  if (scenario === "repeat-missing") {
    return {
      detected: true,
      values: [7, 5],
      shouldAlert: true,
      decision: "repeat-overdue",
      playbacks: [initial],
    };
  }
  if (scenario === "early-alert" || scenario === "late-alert") {
    return {
      detected: true,
      values: [7, 5],
      shouldAlert: true,
      decision: scenario,
      playbacks: [initial],
    };
  }
  return {
    detected: true,
    values: [7, 5],
    shouldAlert: true,
    decision: "initial",
    playbacks: [initial],
  };
}

function expectedJournalEntryCount(scenario: AlertIssueScenario) {
  const signals = getScenarioSignals(scenario);
  return (
    1 + Math.max(0, signals.values.length - 1) + 1 + signals.playbacks.length
  );
}

function expectedSelectedJournalEntryCount(
  feature: AlertIssueFeature,
  scenario: AlertIssueScenario,
) {
  if (feature !== "rune") {
    return expectedJournalEntryCount(scenario);
  }
  if (scenario === "not-recognized" || scenario === "wrong-target") {
    return 1;
  }
  if (scenario === "recognized-no-alert") {
    return 2;
  }
  if (scenario === "playback-missing" || scenario === "repeat-missing") {
    return 3;
  }
  if (scenario === "duplicate-alert") {
    return 4;
  }
  return 1;
}

function expectedJournalStatus(occurrence: AlertIssueOccurrence) {
  if (occurrence === "current") return "current-snapshot";
  if (occurrence === "recent") return "matched";
  return "outside-retention";
}

function expectedStructuralEvidenceGaps(
  feature: AlertIssueFeature,
  scenario: AlertIssueScenario,
  occurrence: AlertIssueOccurrence,
  variant: SimulationVariant,
) {
  const gaps: string[] = [];
  if (
    feature === "rune" &&
    occurrence === "historical" &&
    (scenario === "not-recognized" || scenario === "wrong-target")
  ) {
    gaps.push("sourceImage");
  }
  if (
    feature === "rune" &&
    scenario === "recognized-no-alert" &&
    occurrence === "historical"
  ) {
    gaps.push("stateBeforeAfter");
  }
  if (scenario === "recognized-no-alert") {
    if (occurrence === "historical") {
      gaps.push("playback");
    }
  }
  return gaps;
}

function getSimulationVariants(
  feature: AlertIssueFeature,
): SimulationVariant[] {
  if (feature === "skill") {
    return ["precision", "quick-slot"];
  }
  if (feature === "hunt-stall") {
    return ["experience", "cooldown"];
  }
  return ["default"];
}

function uniqueTargets(cases: ReportCase[]) {
  return cases
    .filter(
      (entry, index) =>
        cases.findIndex((candidate) =>
          sameTarget(candidate.target, entry.target),
        ) === index,
    )
    .map((entry) => entry.target);
}

function sameTarget(
  left: AlertIssueReportTarget,
  right: AlertIssueReportTarget,
) {
  return left.kind === right.kind;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (Array.isArray(value)) {
      return value[Number(segment)];
    }
    return asRecord(value)[segment];
  }, root);
}
