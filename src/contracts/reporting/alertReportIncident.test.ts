import { describe, expect, it, vi } from "vitest";
import {
  ALERT_REPORT_INCIDENT_SCHEMA,
  ALERT_REPORT_INCIDENT_VERSION,
  createAlertIssueIncidentId,
  createAlertReportIncident,
} from "./alertReportIncident";

describe("alertReportIncident", () => {
  it("binds the selected scenario to a bounded evidence window", () => {
    const incident = createAlertReportIncident({
      feature: "buff-expiry",
      submittedAt: "2026-07-18T01:00:10.000Z",
      issue: {
        reason: "buff-expiry-missed",
        label: "버프가 꺼졌는데 알림이 안 울려요",
        incidentId: "incident-1",
        scenario: "recognized-no-alert",
        scenarioLabel: "종료 시각은 표시됐지만 알림이 안 났어요",
        occurrence: "recent",
        affectedTarget: { id: "unionLuck", label: "유니온의 행운" },
      },
      cycleId: "track-1",
      evidence: {
        source: "runtime-atomic",
        sampledAt: Date.parse("2026-07-18T01:00:08.000Z"),
        ageMs: null,
        windowStartedAt: Date.parse("2026-07-18T00:59:50.000Z"),
        windowEndedAt: Date.parse("2026-07-18T01:00:08.000Z"),
        frameCount: 19,
        stateBinding: "before-after",
        mediaCount: 3,
      },
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: false,
      },
    });

    expect(incident).toMatchObject({
      schema: ALERT_REPORT_INCIDENT_SCHEMA,
      version: ALERT_REPORT_INCIDENT_VERSION,
      id: "incident-1",
      feature: "buff-expiry",
      scenario: "recognized-no-alert",
      occurrence: "recent",
      cycleId: "track-1",
      evidence: {
        source: "runtime-atomic",
        ageMs: 2_000,
        frameCount: 19,
        stateBinding: "before-after",
      },
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: false,
        affectedTarget: true,
      },
    });
  });

  it("creates a stable fallback id for legacy callers", () => {
    const incident = createAlertReportIncident({
      feature: "rune",
      submittedAt: "2026-07-18T01:00:10.000Z",
      issue: { reason: "rune-missed", label: "룬 미감지" },
      evidence: {
        source: "report-capture",
        sampledAt: 1_000,
        ageMs: null,
        windowStartedAt: null,
        windowEndedAt: null,
        frameCount: 1,
        stateBinding: "after-only",
        mediaCount: 1,
      },
      completeness: {
        sourceImage: true,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
      },
    });

    expect(incident.id).toBe("rune:1000:rune-missed");
    expect(incident.scenario).toBeNull();
  });

  it("keeps a typed other category inside the common incident envelope", () => {
    const incident = createAlertReportIncident({
      feature: "skill",
      submittedAt: "2026-07-19T01:00:10.000Z",
      issue: {
        reason: "other",
        label: "기타",
        otherCategory: "performance-error",
        otherCategoryLabel: "속도 저하나 오류",
      },
      evidence: {
        source: "report-capture",
        sampledAt: null,
        ageMs: null,
        windowStartedAt: null,
        windowEndedAt: null,
        frameCount: 0,
        stateBinding: "unavailable",
        mediaCount: 0,
      },
      completeness: {
        sourceImage: false,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
      },
    });

    expect(incident).toMatchObject({
      otherCategory: "performance-error",
      otherCategoryLabel: "속도 저하나 오류",
    });
  });

  it("uses crypto UUIDs for new dialog incidents", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    expect(createAlertIssueIncidentId()).toBe("uuid-1");
    vi.unstubAllGlobals();
  });
});
