import { describe, expect, it } from "vitest";
import { buildReportIncident, countPresentReportMedia } from "./reportIncidentEvidence";
import { createAlertIncidentJournal } from "../../application/reporting/alertIncidentJournal";

describe("buildReportIncident", () => {
  it("summarizes a bounded evidence window", () => {
    const incident = buildReportIncident({
      feature: "skill",
      issue: {
        reason: "skill-alert-timing",
        label: "알림 시간이 이상해요",
        incidentId: "incident-1",
        scenario: "late-alert",
      },
      submittedAt: "2026-07-18T12:00:10.000Z",
      source: "runtime-atomic",
      sampledAt: Date.parse("2026-07-18T12:00:09.000Z"),
      timestamps: [1_000, null, 3_000, 2_000],
      stateBinding: "before-after",
      mediaCount: 2,
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: true,
      },
    });

    expect(incident.id).toBe("incident-1");
    expect(incident.evidence).toMatchObject({
      windowStartedAt: 1_000,
      windowEndedAt: 3_000,
      frameCount: 3,
      mediaCount: 2,
    });
  });

  it("binds a frozen recent journal to the incident correlations", () => {
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "sample-1",
      feature: "rune",
      targetId: null,
      kind: "decision",
      occurredAt: 95_000,
      frameId: "frame:95000",
      cycleId: "rune-cycle-1",
      status: "alerted",
      decision: "initial",
      value: true,
      configuration: { repeatEnabled: false },
      details: {},
    });
    journal.record({
      id: "playback-1",
      feature: "rune",
      targetId: null,
      kind: "playback",
      occurredAt: 96_000,
      frameId: "frame:95000",
      cycleId: "rune-cycle-1",
      status: "finished",
      decision: "initial",
      value: null,
      configuration: { repeatEnabled: false },
      details: { requestedAt: 95_500, finishedAt: 96_000 },
    });

    const incident = buildReportIncident({
      feature: "rune",
      issue: {
        reason: "rune-missed",
        label: "룬을 감지하지 못해요",
        occurrence: "recent",
      },
      submittedAt: "1970-01-01T00:01:40.000Z",
      source: "report-capture",
      sampledAt: 99_000,
      stateBinding: "after-only",
      journalSelection: journal.freeze({ feature: "rune" }, 100_000),
      completeness: {
        sourceImage: true,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
      },
    });

    expect(incident.journal).toMatchObject({
      status: "matched",
      selectedEventAt: 96_000,
      coverage: {
        playbackLifecycleMonitored: true,
        playbackEventCount: 1,
      },
    });
    expect(incident.journal.entries).toHaveLength(2);
    expect(incident.completeness).toMatchObject({
      temporalTrace: true,
      decision: true,
      playback: true,
    });
    expect(incident.correlation).toEqual({
      frameIds: ["frame:95000"],
      cycleIds: ["rune-cycle-1"],
      playbackIds: ["playback-1"],
      relatedPlaybackIds: [],
      configRevisions: [incident.journal.entries[0]?.configRevision],
    });
  });

  it("treats a monitored zero-event playback window as explicit negative evidence", () => {
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "sample-1",
      feature: "rune",
      targetId: null,
      kind: "sample",
      occurredAt: 95_000,
      frameId: "frame:95000",
      cycleId: "rune-cycle-1",
      status: "candidate",
      decision: "threshold-reached-no-alert",
      value: true,
      configuration: { enabled: true },
      details: {},
    });

    const incident = buildReportIncident({
      feature: "rune",
      issue: {
        reason: "rune-missed",
        label: "룬을 감지하지 못해요",
        scenario: "recognized-no-alert",
        occurrence: "recent",
      },
      submittedAt: "1970-01-01T00:01:40.000Z",
      source: "report-capture",
      sampledAt: 99_000,
      stateBinding: "after-only",
      journalSelection: journal.freeze({ feature: "rune" }, 100_000),
      completeness: {
        sourceImage: true,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
      },
    });

    expect(incident.journal.coverage).toEqual({
      playbackLifecycleMonitored: true,
      playbackEventCount: 0,
        relatedPlaybackEventCount: 0,
        lifecycleEventCount: 0,
    });
    expect(incident.completeness.playback).toBe(true);
    expect(incident.correlation.playbackIds).toEqual([]);
  });

  it("reports other feature playback as attribution evidence, not target playback", () => {
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "rune-sample",
      feature: "rune",
      targetId: null,
      kind: "decision",
      occurredAt: 95_000,
      frameId: "frame:95000",
      cycleId: "rune-cycle",
      status: "recognized",
      decision: "threshold-reached-no-alert",
      value: true,
      details: {},
    });
    journal.record({
      id: "buff-playback",
      feature: "buff-expiry",
      targetId: "union-wealth",
      kind: "playback",
      occurredAt: 97_000,
      frameId: "frame:96000",
      cycleId: "buff-cycle",
      status: "finished",
      decision: "initial",
      value: null,
      details: {},
    });

    const incident = buildReportIncident({
      feature: "rune",
      issue: {
        reason: "rune-missed",
        label: "룬을 감지했지만 알림이 안 났어요",
        occurrence: "recent",
      },
      submittedAt: "1970-01-01T00:01:40.000Z",
      source: "runtime-snapshot",
      sampledAt: 99_000,
      stateBinding: "before-after",
      journalSelection: journal.freeze({ feature: "rune" }, 100_000),
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: false,
      },
    });

    expect(incident.journal.selectedEventAt).toBe(95_000);
    expect(incident.journal.coverage).toEqual({
      playbackLifecycleMonitored: true,
      playbackEventCount: 0,
      relatedPlaybackEventCount: 1,
      lifecycleEventCount: 0,
    });
    expect(incident.journal.relatedPlaybackEntries?.map((entry) => entry.id)).toEqual([
      "buff-playback",
    ]);
    expect(incident.correlation.playbackIds).toEqual([]);
    expect(incident.correlation.relatedPlaybackIds).toEqual(["buff-playback"]);
  });
});

describe("countPresentReportMedia", () => {
  it("counts only image data urls", () => {
    expect(
      countPresentReportMedia(
        "data:image/png;base64,a",
        null,
        "https://example.com/image.png",
        "data:image/webp;base64,b"
      )
    ).toBe(2);
  });
});
