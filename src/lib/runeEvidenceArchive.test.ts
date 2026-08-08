import { describe, expect, it } from "vitest";
import type {
  RuneAlertTriggerEvidence,
  RuneEvidenceArchive,
  RuneRuntimeIncidentEvidence,
  RuneRuntimeIncidentFrame,
} from "../alertTypes";
import {
  RUNE_EVIDENCE_ARCHIVE_MAX_INCIDENTS,
  RUNE_EVIDENCE_ARCHIVE_MAX_EPISODES,
  RUNE_LAST_ALERT_TRIGGER_RETENTION_MS,
  updateRuneEvidenceArchive,
} from "./runeEvidenceArchive";

describe("updateRuneEvidenceArchive", () => {
  it("retains three adjacent incidents instead of replacing the selected older episode", () => {
    let archive: RuneEvidenceArchive | null = null;
    for (let index = 0; index < 4; index += 1) {
      const sampledAt = 10_000 + index * 10_000;
      const incident = createIncident(index + 1, sampledAt);
      const update = updateRuneEvidenceArchive({
        previousArchive: archive,
        runtimeIncident: incident,
        pendingAlertTriggerFrames: [],
        lastAlertTrigger: null,
        sampledAt,
      });
      archive = update.archive;
    }

    expect(archive?.runtimeIncidents).toHaveLength(
      RUNE_EVIDENCE_ARCHIVE_MAX_INCIDENTS,
    );
    expect(archive?.runtimeIncidents.map((entry) => entry.id)).toEqual([
      "incident-2",
      "incident-3",
      "incident-4",
    ]);
    expect(archive?.runtimeIncidents[0]?.episodeId).toBe("rune-episode:2:20000");
  });

  it("keeps alert-attempt metadata while sharing one six-frame media budget", () => {
    const incidents = Array.from({ length: 3 }, (_, index) =>
      createIncident(index + 1, 10_000 + index * 5_000, 3),
    );
    let archive: RuneEvidenceArchive | null = null;
    let latestTrigger: RuneAlertTriggerEvidence | null = null;
    for (const incident of incidents) {
      latestTrigger = createTrigger(
        incident.sceneEpoch,
        incident.lastSignalAt,
        incident.frames,
      );
      const update = updateRuneEvidenceArchive({
        previousArchive: archive,
        runtimeIncident: incident,
        pendingAlertTriggerFrames: [],
        lastAlertTrigger: latestTrigger,
        sampledAt: incident.lastSignalAt,
      });
      archive = update.archive;
    }

    const retainedFrameIds = archive?.mediaBudget.retainedFrameIds ?? [];
    expect(retainedFrameIds.length).toBeLessThanOrEqual(6);
    expect(archive?.runtimeIncidents).toHaveLength(3);
    expect(archive?.alertTriggers).toHaveLength(3);
    expect(archive?.alertTriggers.map((entry) => entry.cycleId)).toEqual([
      "1:10000:initial",
      "2:15000:initial",
      "3:20000:initial",
    ]);
    expect(archive?.mediaBudget.omittedCapacity).toBeGreaterThan(0);
    const archivedFrames = archive?.runtimeIncidents.flatMap((entry) => entry.frames) ?? [];
    expect(archivedFrames).toHaveLength(9);
    expect(archivedFrames.filter((entry) => entry.rawDataUrl)).toHaveLength(6);
  });

  it("bounds alert-attempt metadata to the three most recent episodes", () => {
    let archive: RuneEvidenceArchive | null = null;
    for (let sceneEpoch = 1; sceneEpoch <= 4; sceneEpoch += 1) {
      const sampledAt = sceneEpoch * 10_000;
      const incident = createIncident(sceneEpoch, sampledAt);
      const update = updateRuneEvidenceArchive({
        previousArchive: archive,
        runtimeIncident: incident,
        pendingAlertTriggerFrames: [],
        lastAlertTrigger: createTrigger(sceneEpoch, sampledAt, incident.frames),
        sampledAt,
      });
      archive = update.archive;
    }

    expect(new Set(archive?.alertTriggers.map((entry) => entry.episodeId)).size).toBe(
      RUNE_EVIDENCE_ARCHIVE_MAX_EPISODES,
    );
    expect(archive?.alertTriggers.map((entry) => entry.episodeId)).toEqual([
      "rune-episode:2:20000",
      "rune-episode:3:30000",
      "rune-episode:4:40000",
    ]);
  });

  it("expires incidents after sixty seconds but protects the latest trigger for three minutes", () => {
    const incident = createIncident(1, 1_000);
    const trigger = createTrigger(1, 1_000, incident.frames);
    const first = updateRuneEvidenceArchive({
      previousArchive: null,
      runtimeIncident: incident,
      pendingAlertTriggerFrames: [],
      lastAlertTrigger: trigger,
      sampledAt: 1_000,
    });
    const afterIncidentWindow = updateRuneEvidenceArchive({
      previousArchive: first.archive,
      runtimeIncident: null,
      pendingAlertTriggerFrames: [],
      lastAlertTrigger: trigger,
      sampledAt: 61_001,
    });

    expect(afterIncidentWindow.runtimeIncident).toBeNull();
    expect(afterIncidentWindow.lastAlertTrigger?.cycleId).toBe(trigger.cycleId);
    expect(afterIncidentWindow.archive?.runtimeIncidents).toEqual([]);
    expect(afterIncidentWindow.archive?.alertTriggers).toHaveLength(1);

    const expired = updateRuneEvidenceArchive({
      previousArchive: afterIncidentWindow.archive,
      runtimeIncident: null,
      pendingAlertTriggerFrames: [],
      lastAlertTrigger: afterIncidentWindow.lastAlertTrigger,
      sampledAt: 1_001 + RUNE_LAST_ALERT_TRIGGER_RETENTION_MS,
    });

    expect(expired.archive).toBeNull();
    expect(expired.lastAlertTrigger).toBeNull();
  });
});

function createIncident(
  sceneEpoch: number,
  sampledAt: number,
  frameCount = 1,
): RuneRuntimeIncidentEvidence {
  return {
    schemaVersion: "rune-runtime-incident-v1",
    id: `incident-${sceneEpoch}`,
    episodeId: `rune-episode:${sceneEpoch}:${sampledAt}`,
    startedAt: sampledAt,
    lastSignalAt: sampledAt,
    updatedAt: sampledAt,
    expiresAt: sampledAt + 60_000,
    detectorVersion: "rune-test",
    sceneEpoch,
    frames: Array.from({ length: frameCount }, (_, index) =>
      createFrame(sceneEpoch, sampledAt + index),
    ),
  };
}

function createFrame(sceneEpoch: number, sampledAt: number): RuneRuntimeIncidentFrame {
  return {
    source: "runtime",
    phase: "signal",
    outcome: "detected",
    sampledAt,
    detectorVersion: "rune-test",
    detectionDebug: null,
    detectionError: null,
    rawDataUrl: `data:image/png;base64,${sceneEpoch}-${sampledAt}`,
    detected: true,
    confidence: 0.9,
    candidateCount: 1,
    candidate: null,
    status: "candidate",
    stableCount: 1,
    firstDetectedAt: sampledAt,
    stableDurationMs: 0,
    confirmationSatisfied: false,
    confirmationSatisfiedBy: null,
    shouldAlert: false,
    reason: "stabilizing",
    sceneEpoch,
    sceneChanged: false,
    sceneChangeScore: null,
  };
}

function createTrigger(
  sceneEpoch: number,
  sampledAt: number,
  frames: RuneRuntimeIncidentFrame[],
): RuneAlertTriggerEvidence {
  return {
    schemaVersion: "rune-alert-trigger-v1",
    cycleId: `${sceneEpoch}:${sampledAt}:initial`,
    episodeId: `rune-episode:${sceneEpoch}:${sampledAt}`,
    decision: "initial",
    triggeredAt: sampledAt,
    detectorVersion: "rune-test",
    sceneEpoch,
    frames: frames.map((frame) => ({
      ...frame,
      confirmationSatisfiedBy: "frames-and-duration",
    })),
  };
}
