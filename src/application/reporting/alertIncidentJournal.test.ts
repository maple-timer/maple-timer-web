import { describe, expect, it } from "vitest";
import {
  ALERT_INCIDENT_JOURNAL_MAX_ENTRIES,
  createAlertIncidentJournal,
  selectAlertIncidentJournalOccurrence,
} from "./alertIncidentJournal";

describe("alertIncidentJournal", () => {
  it("freezes only the requested feature and target from the recent minute", () => {
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "old",
      feature: "skill",
      targetId: "janus",
      kind: "sample",
      occurredAt: 1_000,
      frameId: "frame:1000",
      cycleId: null,
      status: "watching",
      decision: null,
      value: 10,
      details: {},
    });
    journal.record({
      id: "current",
      feature: "skill",
      targetId: "janus",
      kind: "decision",
      occurredAt: 70_000,
      frameId: "frame:70000",
      cycleId: 70_000,
      status: "alerted",
      decision: "initial",
      value: 3,
      configuration: { threshold: 3, rawDataUrl: "data:image/png;base64,ignored" },
      details: { opaque: "data:image/png;base64,also-ignored" },
    });
    journal.record({
      id: "other",
      feature: "skill",
      targetId: "fountain",
      kind: "sample",
      occurredAt: 71_000,
      frameId: "frame:71000",
      cycleId: null,
      status: "watching",
      decision: null,
      value: 9,
      details: {},
    });

    const selection = journal.freeze({ feature: "skill", targetId: "janus" }, 72_000);

    expect(selection.entries.map((entry) => entry.id)).toEqual(["current"]);
    expect(selection.entries[0]?.configuration).toEqual({ threshold: 3 });
    expect(selection.entries[0]?.details).toEqual({});
    expect(selection.entries[0]?.configRevision).toMatch(/^cfg-/);
  });

  it("selects decision or playback evidence for a recent occurrence", () => {
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "sample",
      feature: "rune",
      targetId: null,
      kind: "sample",
      occurredAt: 90_000,
      frameId: "frame:90000",
      cycleId: null,
      status: "candidate",
      decision: "stable",
      value: true,
      details: {},
    });
    journal.record({
      id: "playback",
      feature: "rune",
      targetId: null,
      kind: "playback",
      occurredAt: 95_000,
      frameId: "frame:90000",
      cycleId: "rune-1",
      status: "finished",
      decision: "initial",
      value: null,
      details: {},
    });

    const selected = selectAlertIncidentJournalOccurrence(
      journal.freeze({ feature: "rune" }, 100_000),
      "recent",
    );

    expect(selected.status).toBe("matched");
    expect(selected.entries).toHaveLength(2);
    expect(selected.selectedEventAt).toBe(95_000);
  });

  it("keeps other alert playback separate without moving the target incident anchor", () => {
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "rune-decision",
      feature: "rune",
      targetId: null,
      kind: "decision",
      occurredAt: 94_000,
      frameId: "frame:94000",
      cycleId: "rune-cycle",
      status: "recognized",
      decision: "threshold-reached-no-alert",
      value: true,
      details: {},
    });
    journal.record({
      id: "skill-playback",
      feature: "skill",
      targetId: "janus",
      kind: "playback",
      occurredAt: 98_000,
      frameId: "frame:97000",
      cycleId: "skill-cycle",
      status: "finished",
      decision: "initial",
      value: null,
      details: {},
    });

    const frozen = journal.freeze({ feature: "rune" }, 100_000);
    const selected = selectAlertIncidentJournalOccurrence(frozen, "recent");

    expect(frozen.entries.map((entry) => entry.id)).toEqual(["rune-decision"]);
    expect(frozen.relatedPlaybackEntries?.map((entry) => entry.id)).toEqual([
      "skill-playback",
    ]);
    expect(selected.relatedPlaybackEntries.map((entry) => entry.id)).toEqual([
      "skill-playback",
    ]);
    expect(selected.selectedEventAt).toBe(94_000);
  });

  it("does not discard newer samples when an older playback event is updated", () => {
    const journal = createAlertIncidentJournal();
    const playback = {
      id: "playback",
      feature: "skill" as const,
      targetId: "janus",
      kind: "playback" as const,
      occurredAt: 100_000,
      frameId: "frame:100000",
      cycleId: "janus-cycle",
      decision: "initial",
      value: null,
      details: {},
    };
    journal.record({ ...playback, status: "requested" });
    for (const occurredAt of [101_000, 102_000, 103_000]) {
      journal.record({
        id: `sample-${occurredAt}`,
        feature: "skill",
        targetId: "janus",
        kind: "sample",
        occurredAt,
        frameId: `frame:${occurredAt}`,
        cycleId: "janus-cycle",
        status: "running",
        decision: "countdown",
        value: 5,
        details: {},
      });
    }

    journal.record({ ...playback, status: "finished" });

    const selection = journal.freeze(
      { feature: "skill", targetId: "janus" },
      103_000,
    );
    expect(selection.entries.map((entry) => entry.id)).toEqual([
      "playback",
      "sample-101000",
      "sample-102000",
      "sample-103000",
    ]);
    expect(selection.entries[0]?.status).toBe("finished");
  });

  it("does not claim to retain incidents older than one minute", () => {
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "sample",
      feature: "rune",
      targetId: null,
      kind: "sample",
      occurredAt: 99_000,
      frameId: "frame:99000",
      cycleId: null,
      status: "waiting",
      decision: null,
      value: false,
      details: {},
    });

    const selected = selectAlertIncidentJournalOccurrence(
      journal.freeze({ feature: "rune" }, 100_000),
      "historical",
    );

    expect(selected).toEqual({
      status: "outside-retention",
      entries: [],
      relatedPlaybackEntries: [],
      selectedEventAt: null,
    });
  });

  it("bounds retained metadata independently of event rate", () => {
    const journal = createAlertIncidentJournal();
    for (let index = 0; index < ALERT_INCIDENT_JOURNAL_MAX_ENTRIES + 20; index += 1) {
      journal.record({
        id: `sample-${index}`,
        feature: "buff-expiry",
        targetId: null,
        kind: "sample",
        occurredAt: 100_000 + index,
        frameId: `frame:${index}`,
        cycleId: null,
        status: "watching",
        decision: null,
        value: index,
        details: {},
      });
    }

    const selection = journal.freeze(
      { feature: "buff-expiry" },
      100_000 + ALERT_INCIDENT_JOURNAL_MAX_ENTRIES + 20,
    );
    expect(selection.entries).toHaveLength(ALERT_INCIDENT_JOURNAL_MAX_ENTRIES);
    expect(selection.entries[0]?.id).toBe("sample-20");
  });

  it("applies the entry cap independently to each target", () => {
    const journal = createAlertIncidentJournal();
    for (const targetId of ["janus", "fountain"]) {
      for (let index = 0; index < ALERT_INCIDENT_JOURNAL_MAX_ENTRIES + 5; index += 1) {
        journal.record({
          id: `${targetId}-${index}`,
          feature: "skill",
          targetId,
          kind: "sample",
          occurredAt: 100_000 + index,
          frameId: `frame:${index}`,
          cycleId: null,
          status: "watching",
          decision: null,
          value: index,
          details: {},
        });
      }
    }

    expect(
      journal.freeze({ feature: "skill", targetId: "janus" }, 100_300).entries,
    ).toHaveLength(ALERT_INCIDENT_JOURNAL_MAX_ENTRIES);
    expect(
      journal.freeze({ feature: "skill", targetId: "fountain" }, 100_300).entries,
    ).toHaveLength(ALERT_INCIDENT_JOURNAL_MAX_ENTRIES);
  });
});
