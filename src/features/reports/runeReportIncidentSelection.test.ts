import { describe, expect, it } from "vitest";
import type {
  AlertIncidentJournalEntry,
  AlertIncidentJournalSelection,
} from "../../application/reporting/alertIncidentJournal";
import {
  selectRuneReportIncident,
  type RuneReportRuntimeIncidentSelectionSource,
} from "./runeReportIncidentSelection";

describe("selectRuneReportIncident", () => {
  it("does not fabricate a recent incident from routine negative samples", () => {
    const selection = createSelection([
      sample(1_000, { detected: false }),
      sample(2_000, { detected: true, episodeId: "rune-episode:1:2000" }),
      sample(3_000, { detected: false }),
    ]);

    const result = selectRuneReportIncident({
      selection,
      scenario: "not-recognized",
      occurrence: "recent",
    });

    expect(result).toMatchObject({
      status: "unavailable",
      anchorKind: null,
      selectedEventAt: null,
      frameIds: [],
      episodeIds: [],
      cycleIds: [],
      candidateCount: 0,
      sampleCount: 3,
      ambiguous: false,
    });
    expect(result.entries).toEqual([]);
  });

  it("selects the retained near-threshold incident instead of a later negative sample", () => {
    const sampledAts = Array.from({ length: 54 }, (_, index) => (index + 1) * 1_000);
    const selection = createSelection(
      sampledAts.map((sampledAt) => sample(sampledAt, { detected: false })),
      [],
      54_000,
    );
    const retainedIncident = runtimeIncident({
      id: "missed:1000",
      startedAt: 1_000,
      lastSignalAt: 3_000,
      frames: [
        [1_000, "before", "not-detected"],
        [2_000, "signal", "near-threshold"],
        [3_000, "signal", "near-threshold"],
        [4_000, "after", "not-detected"],
        [5_000, "after", "not-detected"],
      ],
    });

    const result = selectRuneReportIncident({
      selection,
      scenario: "not-recognized",
      occurrence: "recent",
      runtimeIncidents: [retainedIncident],
    });

    expect(result).toMatchObject({
      status: "matched",
      anchorKind: "frame",
      selectedEventAt: 3_000,
      frameIds: [
        "frame:1000",
        "frame:2000",
        "frame:3000",
        "frame:4000",
        "frame:5000",
      ],
      episodeIds: [],
      candidateCount: 1,
      sampleCount: 54,
      ambiguous: false,
    });
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "rune:sample:1000",
      "rune:sample:2000",
      "rune:sample:3000",
      "rune:sample:4000",
      "rune:sample:5000",
    ]);
  });

  it("counts retained missed incidents rather than their individual samples", () => {
    const result = selectRuneReportIncident({
      selection: createSelection([
        sample(1_000, { detected: false }),
        sample(2_000, { detected: false }),
        sample(10_000, { detected: false }),
        sample(11_000, { detected: false }),
        sample(12_000, { detected: false }),
      ]),
      scenario: "not-recognized",
      occurrence: "recent",
      runtimeIncidents: [
        runtimeIncident({
          id: "missed:1000",
          startedAt: 1_000,
          lastSignalAt: 2_000,
          frames: [
            [1_000, "signal", "near-threshold"],
            [2_000, "after", "not-detected"],
          ],
        }),
        runtimeIncident({
          id: "missed:10000",
          startedAt: 10_000,
          lastSignalAt: 11_000,
          frames: [
            [10_000, "before", "not-detected"],
            [11_000, "signal", "near-threshold"],
            [12_000, "after", "not-detected"],
          ],
        }),
      ],
    });

    expect(result).toMatchObject({
      selectedEventAt: 11_000,
      frameIds: ["frame:10000", "frame:11000", "frame:12000"],
      candidateCount: 2,
      sampleCount: 5,
      ambiguous: true,
    });
  });

  it("keeps one recognized episode and excludes a later unrelated episode", () => {
    const firstEpisode = "rune-episode:1:1000";
    const secondEpisode = "rune-episode:2:6000";
    const selection = createSelection([
      sample(1_000, { detected: true, episodeId: firstEpisode }),
      sample(2_000, { detected: true, episodeId: firstEpisode }),
      sample(3_000, { detected: true, episodeId: firstEpisode }),
      sample(6_000, { detected: true, episodeId: secondEpisode }),
      playback(7_000, {
        episodeId: secondEpisode,
        cycleId: "2:7000:initial",
        decision: "initial",
        status: "finished",
      }),
    ]);

    const result = selectRuneReportIncident({
      selection,
      scenario: "recognized-no-alert",
      occurrence: "recent",
    });

    expect(result).toMatchObject({
      anchorKind: "episode",
      episodeIds: [firstEpisode],
      candidateCount: 1,
      ambiguous: false,
    });
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "rune:sample:1000",
      "rune:sample:2000",
      "rune:sample:3000",
    ]);
  });

  it("selects the matching playback attempt and keeps other feature audio as context", () => {
    const episodeId = "rune-episode:3:4000";
    const selection = createSelection(
      [
        sample(4_000, { detected: true, episodeId }),
        playback(5_000, {
          episodeId,
          cycleId: "3:5000:initial",
          decision: "initial",
          status: "failed",
        }),
      ],
      [otherPlayback(5_100)],
    );

    const result = selectRuneReportIncident({
      selection,
      scenario: "playback-missing",
      occurrence: "recent",
    });

    expect(result).toMatchObject({
      anchorKind: "attempt",
      episodeIds: [episodeId],
      cycleIds: ["3:5000:initial"],
      candidateCount: 1,
    });
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "rune:sample:4000",
      "rune:playback:3:5000:initial",
    ]);
    expect(result.relatedPlaybackEntries.map((entry) => entry.id)).toEqual([
      "skill:playback:5100",
    ]);
  });

  it("keeps the latest two attempts for a duplicate-alert report", () => {
    const episodeId = "rune-episode:4:1000";
    const selection = createSelection([
      sample(1_000, { detected: true, episodeId }),
      playback(2_000, {
        episodeId,
        cycleId: "4:2000:initial",
        decision: "initial",
        status: "finished",
      }),
      playback(5_000, {
        episodeId,
        cycleId: "4:5000:repeat",
        decision: "repeat",
        status: "finished",
      }),
      playback(8_000, {
        episodeId,
        cycleId: "4:8000:repeat",
        decision: "repeat",
        status: "finished",
      }),
    ]);

    const result = selectRuneReportIncident({
      selection,
      scenario: "duplicate-alert",
      occurrence: "recent",
    });

    expect(result.cycleIds).toEqual(["4:5000:repeat", "4:8000:repeat"]);
    expect(result.entries.map((entry) => entry.id)).toEqual([
      "rune:sample:1000",
      "rune:playback:4:5000:repeat",
      "rune:playback:4:8000:repeat",
    ]);
  });

  it("keeps the full selected episode when a repeat alert is missing", () => {
    const episodeId = "rune-episode:5:1000";
    const result = selectRuneReportIncident({
      selection: createSelection([
        sample(1_000, { detected: true, episodeId }),
        playback(2_000, {
          episodeId,
          cycleId: "5:2000:initial",
          decision: "initial",
          status: "finished",
        }),
      ]),
      scenario: "repeat-missing",
      occurrence: "recent",
    });

    expect(result).toMatchObject({
      anchorKind: "episode",
      episodeIds: [episodeId],
      cycleIds: ["5:2000:initial"],
      candidateCount: 1,
    });
  });

  it("does not merge equal-looking detections from different scenes", () => {
    const firstEpisode = "rune-episode:6:1000";
    const secondEpisode = "rune-episode:7:5000";
    const result = selectRuneReportIncident({
      selection: createSelection([
        sample(1_000, { detected: true, episodeId: firstEpisode }),
        sample(5_000, { detected: true, episodeId: secondEpisode }),
      ]),
      scenario: "recognized-no-alert",
      occurrence: "recent",
    });

    expect(result.episodeIds).toEqual([secondEpisode]);
    expect(result.candidateCount).toBe(2);
    expect(result.ambiguous).toBe(true);
  });

  it("ignores a late callback from an older episode when choosing the latest miss", () => {
    const olderEpisode = "rune-episode:8:1000";
    const latestEpisode = "rune-episode:9:6000";
    const result = selectRuneReportIncident({
      selection: createSelection([
        sample(1_000, { detected: true, episodeId: olderEpisode }),
        sample(6_000, { detected: true, episodeId: latestEpisode }),
        playback(2_000, {
          episodeId: olderEpisode,
          cycleId: "8:2000:initial",
          decision: "initial",
          status: "finished",
        }),
      ]),
      scenario: "recognized-no-alert",
      occurrence: "recent",
    });

    expect(result.episodeIds).toEqual([latestEpisode]);
    expect(result.entries.map((entry) => entry.id)).toEqual(["rune:sample:6000"]);
  });

  it("does not reuse retained evidence for historical reports", () => {
    const result = selectRuneReportIncident({
      selection: createSelection([sample(50_000, { detected: false })]),
      scenario: "not-recognized",
      occurrence: "historical",
    });

    expect(result).toEqual({
      status: "outside-retention",
      anchorKind: null,
      selectedEventAt: null,
      frameIds: [],
      episodeIds: [],
      cycleIds: [],
      candidateCount: 0,
      sampleCount: 0,
      ambiguous: false,
      entries: [],
      relatedPlaybackEntries: [],
    });
  });

  it("uses the ten-second boundary for current reports", () => {
    const selection = createSelection([
      sample(49_999, { detected: false }),
      sample(50_000, { detected: false }),
    ], [], 60_000);

    const result = selectRuneReportIncident({
      selection,
      scenario: "not-recognized",
      occurrence: "current",
    });

    expect(result.frameIds).toEqual(["frame:50000"]);
    expect(result.candidateCount).toBe(1);
    expect(result.sampleCount).toBe(1);
  });
});

function runtimeIncident({
  id,
  startedAt,
  lastSignalAt,
  frames,
}: {
  id: string;
  startedAt: number;
  lastSignalAt: number;
  frames: Array<[
    sampledAt: number,
    phase: "before" | "signal" | "after",
    outcome: "detected" | "near-threshold" | "not-detected" | "error",
  ]>;
}): RuneReportRuntimeIncidentSelectionSource {
  return {
    id,
    episodeId: null,
    startedAt,
    lastSignalAt,
    frames: frames.map(([sampledAt, _phase, outcome]) => ({ sampledAt, outcome })),
  };
}

function createSelection(
  entries: AlertIncidentJournalEntry[],
  relatedPlaybackEntries: AlertIncidentJournalEntry[] = [],
  capturedAt = 60_000,
): AlertIncidentJournalSelection {
  return {
    capturedAt,
    windowStartedAt: capturedAt - 60_000,
    windowEndedAt: capturedAt,
    target: { feature: "rune", targetId: null },
    entries,
    relatedPlaybackEntries,
  };
}

function sample(
  occurredAt: number,
  {
    detected,
    episodeId = null,
  }: {
    detected: boolean;
    episodeId?: string | null;
  },
): AlertIncidentJournalEntry {
  return {
    id: `rune:sample:${occurredAt}`,
    feature: "rune",
    targetId: null,
    kind: "sample",
    occurredAt,
    frameId: `frame:${occurredAt}`,
    cycleId: null,
    status: detected ? "candidate" : "waiting",
    decision: detected ? "stabilizing" : "waiting",
    value: detected,
    configRevision: "cfg-rune",
    configuration: { enabled: true },
    details: {
      episodeId,
      stateBefore: { status: "waiting" },
      stateAfter: { status: detected ? "candidate" : "waiting" },
    },
  };
}

function playback(
  occurredAt: number,
  {
    episodeId,
    cycleId,
    decision,
    status,
  }: {
    episodeId: string;
    cycleId: string;
    decision: "initial" | "repeat";
    status: "requested" | "started" | "finished" | "failed";
  },
): AlertIncidentJournalEntry {
  return {
    id: `rune:playback:${cycleId}`,
    feature: "rune",
    targetId: null,
    kind: "playback",
    occurredAt,
    frameId: `frame:${occurredAt}`,
    cycleId,
    status,
    decision,
    value: null,
    configRevision: "cfg-rune",
    configuration: { enabled: true },
    details: { episodeId, requestedAt: occurredAt },
  };
}

function otherPlayback(occurredAt: number): AlertIncidentJournalEntry {
  return {
    id: `skill:playback:${occurredAt}`,
    feature: "skill",
    targetId: "skill-1",
    kind: "playback",
    occurredAt,
    frameId: `frame:${occurredAt}`,
    cycleId: `skill:${occurredAt}`,
    status: "finished",
    decision: "initial",
    value: null,
    configRevision: "cfg-skill",
    configuration: { enabled: true },
    details: {},
  };
}
