import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeReportEvidenceCoordinator } from "../../application/reporting/runtimeReportEvidenceCoordinator";
import type { BuffExpiryRuntimeReportPayload } from "../../contracts/reporting/runtimeReportEvidencePayloads";
import { createBuffExpiryRuntimeState } from "../../lib/buffExpiry/buffExpiryRuntimeState";
import type { BuffExpirySnapshot } from "../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryTrackedBuff } from "../../domain/buff-expiry/precisionTrackingTypes";
import { createDefaultBuffExpiryAlert, createDefaultProfile } from "../../lib/storage";
import {
  createBuffExpiryIncidentRuntimeRecorder,
  recordBuffExpiryIncidentSample,
} from "../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import type {
  BuffExpiryPrecisionBestGroupCandidate,
  BuffExpiryPrecisionIconObservation,
} from "../../runtime/buff-expiry/analysis/buffExpiryPrecisionAnalysisRuntime";
import { useBuffExpiryAlertReports } from "./useBuffExpiryAlertReports";

const mocks = vi.hoisted(() => ({
  postDebugSample: vi.fn(),
}));

vi.mock("./reportClient", () => ({
  getOrCreateReportClientId: () => "test-client",
  postDebugSample: mocks.postDebugSample,
}));

describe("useBuffExpiryAlertReports", () => {
  beforeEach(() => {
    mocks.postDebugSample.mockReset();
    mocks.postDebugSample.mockResolvedValue({ id: "sample-1" });
  });

  it("waits for the next runtime frame and submits only its evidence", async () => {
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const profile = {
      ...createDefaultProfile(),
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
      },
    };
    const stateBefore = createBuffExpiryRuntimeState();
    const stateAfter = {
      ...stateBefore,
      status: "tracking" as const,
      lastSampledAt: 20_000,
      boxCount: 1,
    };
    const snapshot = createRuntimeSnapshot();
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const onMessage = vi.fn();
    const snapshotRef = { current: null as BuffExpirySnapshot | null };
    const { result } = renderHook(() =>
      useBuffExpiryAlertReports({
        videoRef: { current: video },
        profileRef: { current: profile },
        buffExpiryRuntimeRef: { current: stateBefore },
        buffExpirySnapshotRef: snapshotRef,
        buffExpiryIncidentRecorderRef: {
          current: createBuffExpiryIncidentRuntimeRecorder({ now: 0 }),
        },
        currentLayoutKey: "1920x1080",
        runtimeReportEvidenceCoordinator: coordinator,
        onMessage,
      }),
    );

    let submission!: Promise<boolean>;
    act(() => {
      submission = result.current.submitBuffExpiryIssueReport({
        reason: "missed-alert",
        label: "알림이 안 울렸어요",
      });
    });

    expect(coordinator.hasPending({ feature: "buff-expiry" })).toBe(true);
    expect(mocks.postDebugSample).not.toHaveBeenCalled();

    const runtimePayload: BuffExpiryRuntimeReportPayload = {
      snapshot,
      stateBefore,
      stateAfter,
    };
    act(() => {
      coordinator.publish({
        target: { feature: "buff-expiry" },
        sampledAt: Date.now() + 1,
        source: {
          kind: "buff-slot-top-right-quadrant-v1",
          parserInputMode: "topRightQuadrant",
          coordinateSpace: "capture-pixels",
          sourceSize: { width: 1920, height: 1080 },
          roi: { x: 960, y: 0, width: 960, height: 540 },
          dataUrl: "data:image/png;base64,runtime-buff-roi",
        },
        parser: {
          engine: "dl",
          version: "buff-slot-parser-test-v1",
          fallbackReason: null,
        },
        payload: runtimePayload,
      });
    });

    await expect(submission).resolves.toBe(true);
    expect(mocks.postDebugSample).toHaveBeenCalledTimes(1);
    const submitted = mocks.postDebugSample.mock.calls[0]?.[0];
    expect(submitted.schemaVersion).toBe(2);
    expect(submitted.sample).toMatchObject({
      sampledAt: 20_000,
      source: {
        parserInputMode: "topRightQuadrant",
        dataUrl: "data:image/png;base64,runtime-buff-roi",
      },
      parser: {
        engine: "dl",
        version: "buff-slot-parser-test-v1",
        fallbackReason: null,
      },
      rawDataUrl: null,
      processedDataUrl: null,
      fullFrameDataUrl: null,
    });
    expect(submitted.buffExpiry.state).toEqual(stateAfter);
    expect(snapshotRef.current).toBe(snapshot);
    expect(onMessage).toHaveBeenLastCalledWith("제보를 보냈습니다.");
  });

  it("keeps the report-open incident and configuration across a failed retry", async () => {
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const config = {
      ...createDefaultBuffExpiryAlert(),
      enabled: true,
      alertLeadSeconds: 5,
    };
    const profileRef = {
      current: {
        ...createDefaultProfile(),
        buffExpiryAlert: config,
      },
    };
    const stateBefore = createBuffExpiryRuntimeState();
    const track = createTrackedBuff("unionWealth", 1_000, 0);
    const incidentState = {
      ...stateBefore,
      status: "tracking" as const,
      tracks: [track],
      lastSampledAt: 1_000,
    };
    const observation = createObservation("unionWealth", 0, 0);
    const recorderRef = {
      current: recordBuffExpiryIncidentSample({
        previous: createBuffExpiryIncidentRuntimeRecorder({ now: 0 }),
        input: {
          sampledAt: 1_000,
          selectedGroups: ["unionWealth"],
          stateBefore,
          stateAfter: incidentState,
          iconObservations: [observation],
          bestByGroup: [toBestCandidate(observation)],
          parser: {
            engine: "dl",
            version: "parser-open",
            provider: "webgpu",
            modelVersion: "model-open",
          },
          recentRoiFrames: [{
            sampledAt: 1_000,
            reason: "target-seen",
            sourceSize: { width: 1920, height: 1080 },
            roi: { x: 960, y: 0, width: 960, height: 540 },
            imageDataUrl: "data:image/jpeg;base64,open-incident",
            boxCount: 1,
            targetObservationCount: 1,
            countdownObservationCount: 1,
            bestByGroup: [],
            trackCount: 1,
            pendingTrackCount: 0,
          }],
          configuration: {
            enabled: true,
            alertLeadSeconds: 5,
            selectedBuffIds: [],
            selectedPrecisionTargetGroups: ["unionWealth"],
            soundId: config.soundId,
            volume: config.volume,
            masterVolume: profileRef.current.masterVolume,
            effectiveVolume: config.volume * profileRef.current.masterVolume,
          },
        },
      }),
    };
    const runtimeRef = { current: incidentState };
    const snapshotRef = { current: null as BuffExpirySnapshot | null };
    const video = {
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const { result } = renderHook(() =>
      useBuffExpiryAlertReports({
        videoRef: { current: video },
        profileRef,
        buffExpiryRuntimeRef: runtimeRef,
        buffExpirySnapshotRef: snapshotRef,
        buffExpiryIncidentRecorderRef: recorderRef,
        currentLayoutKey: "1920x1080",
        runtimeReportEvidenceCoordinator: coordinator,
        onMessage: vi.fn(),
      }),
    );

    act(() => {
      result.current.freezeBuffExpiryIssueReportEvidence(1_500);
    });
    profileRef.current = {
      ...profileRef.current,
      buffExpiryAlert: { ...config, alertLeadSeconds: 9 },
    };
    const laterTrack = createTrackedBuff("unionLuck", 2_000, 1);
    const laterObservation = createObservation("unionLuck", 1, 1);
    recorderRef.current = recordBuffExpiryIncidentSample({
      previous: recorderRef.current,
      input: {
        sampledAt: 2_000,
        selectedGroups: ["unionLuck"],
        stateBefore: incidentState,
        stateAfter: {
          ...incidentState,
          tracks: [track, laterTrack],
          lastSampledAt: 2_000,
        },
        iconObservations: [laterObservation],
        bestByGroup: [toBestCandidate(laterObservation)],
        parser: {
          engine: "dl",
          version: "parser-later",
          provider: "wasm",
          modelVersion: "model-later",
        },
        configuration: {
          enabled: true,
          alertLeadSeconds: 9,
          selectedBuffIds: [],
          selectedPrecisionTargetGroups: ["unionLuck"],
          soundId: config.soundId,
          volume: config.volume,
          masterVolume: profileRef.current.masterVolume,
          effectiveVolume: config.volume * profileRef.current.masterVolume,
        },
      },
    });

    const issue = {
      reason: "buff-expiry-missed",
      label: "버프가 꺼졌는데 알림이 안 울려요",
      scenario: "recognized-no-alert" as const,
      scenarioLabel: "종료 시각은 표시됐지만 알림이 안 났어요",
      occurrence: "current" as const,
      affectedTarget: { id: "unionWealth", label: "유니온의 부" },
    };
    mocks.postDebugSample.mockRejectedValueOnce(new Error("temporary-failure"));

    let firstSubmission!: Promise<boolean>;
    const firstReportSampledAt = Date.now() + 1_000;
    act(() => {
      firstSubmission = result.current.submitBuffExpiryIssueReport(issue);
    });
    publishRuntimeEvidence(
      coordinator,
      firstReportSampledAt,
      stateBefore,
      incidentState,
    );
    await expect(firstSubmission).resolves.toBe(false);

    let retrySubmission!: Promise<boolean>;
    const retryReportSampledAt = Date.now() + 2_000;
    act(() => {
      retrySubmission = result.current.submitBuffExpiryIssueReport(issue);
    });
    publishRuntimeEvidence(
      coordinator,
      retryReportSampledAt,
      stateBefore,
      incidentState,
    );
    await expect(retrySubmission).resolves.toBe(true);

    const submitted = mocks.postDebugSample.mock.calls[1]?.[0];
    expect(submitted.buffExpiry.config.alertLeadSeconds).toBe(5);
    expect(submitted.sample.buffExpiryEvidence).toMatchObject({
      frozenAt: 1_500,
      frozenState: {
        provider: "webgpu",
        activeEpisodeIds: [expect.stringContaining(":unionWealth:")],
      },
      selection: {
        affectedGroup: "unionWealth",
        status: "current-snapshot",
      },
      reportFrame: {
        source: "report-time",
        sampledAt: retryReportSampledAt,
      },
    });
    expect(
      submitted.sample.buffExpiryEvidence.frames.map(
        (frame: { sampledAt: number }) => frame.sampledAt,
      ),
    ).toEqual([1_000]);
    expect(
      submitted.sample.buffExpiryEvidence.episodes.map(
        (episode: { group: string }) => episode.group,
      ),
    ).toEqual(["unionWealth"]);
    expect(submitted.sample.buffExpiryEvidence.media).toEqual([
      expect.objectContaining({
        sampledAt: 1_000,
        dataUrl: "data:image/jpeg;base64,open-incident",
      }),
    ]);
    expect(submitted.sample.next.replay.frames).toEqual([]);
    expect(
      JSON.stringify(submitted).match(/data:image\/jpeg;base64,open-incident/g),
    ).toHaveLength(1);
  });
});

function createRuntimeSnapshot(): BuffExpirySnapshot {
  return {
    sampledAt: 20_000,
    parserEngine: "dl",
    parserFallbackReason: null,
    roi: { x: 0, y: 0, width: 1920, height: 1080 },
    rawPreviewUrl: null,
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
    boxes: [
      { x: 1600, y: 40, width: 32, height: 32, side: 32, confidence: 0.98 },
    ],
    nextModuleVersions: {
      runtime: "buff-expiry-test-v1",
      parser: "buff-slot-parser-test-v1",
      matcher: "buff-matcher-test-v1",
      matcherModel: "buff-matcher-model-test-v1",
      countdown: "countdown-test-v1",
    },
    nextIconObservations: [],
    nextBestByGroup: [],
    acceptedMatches: [],
    rejectedMatches: [],
    tracks: [],
    pendingTracks: [],
    unsupportedReason: null,
    performance: null,
    runtimeTrace: [],
    alertDecisionHistory: [],
  };
}

function publishRuntimeEvidence(
  coordinator: ReturnType<typeof createRuntimeReportEvidenceCoordinator>,
  sampledAt: number,
  stateBefore: ReturnType<typeof createBuffExpiryRuntimeState>,
  stateAfter: ReturnType<typeof createBuffExpiryRuntimeState>,
) {
  act(() => {
    coordinator.publish({
      target: { feature: "buff-expiry" },
      sampledAt,
      source: {
        kind: "buff-slot-top-right-quadrant-v1",
        parserInputMode: "topRightQuadrant",
        coordinateSpace: "capture-pixels",
        sourceSize: { width: 1920, height: 1080 },
        roi: { x: 960, y: 0, width: 960, height: 540 },
        dataUrl: `data:image/png;base64,report-${sampledAt}`,
      },
      parser: {
        engine: "dl",
        version: "buff-slot-parser-report-v1",
        fallbackReason: null,
      },
      payload: {
        snapshot: {
          ...createRuntimeSnapshot(),
          sampledAt,
          nextRecentRoiFrames: [{
            sampledAt,
            reason: "report-submitted",
            sourceSize: { width: 1920, height: 1080 },
            roi: { x: 960, y: 0, width: 960, height: 540 },
            imageDataUrl: `data:image/jpeg;base64,report-context-${sampledAt}`,
            boxCount: 0,
            targetObservationCount: 0,
            countdownObservationCount: 0,
            bestByGroup: [],
            trackCount: 0,
            pendingTrackCount: 0,
          }],
        },
        stateBefore,
        stateAfter: { ...stateAfter, lastSampledAt: sampledAt },
      },
    });
  });
}

function createTrackedBuff(
  group: "unionWealth" | "unionLuck",
  sampledAt: number,
  col: number,
): BuffExpiryTrackedBuff {
  return {
    id: `next:${group}:r0:c${col}`,
    buffId: `next:${group}`,
    name: group,
    box: {
      x: col * 40,
      y: 0,
      width: 32,
      height: 32,
      side: 32,
      row: 0,
      col,
      confidence: 0.9,
    },
    detectedSeconds: 30,
    detectedAt: sampledAt,
    expiresAt: sampledAt + 30_000,
    lastSeenAt: sampledAt,
    alertedAt: null,
    score: 0.9,
  };
}

function createObservation(
  group: "unionWealth" | "unionLuck",
  boxIndex: number,
  col: number,
): BuffExpiryPrecisionIconObservation {
  return {
    id: `slot:${boxIndex}`,
    boxIndex,
    box: {
      x: col * 40,
      y: 0,
      size: 32,
      row: 0,
      col,
      confidence: 0.9,
      score: 0.9,
    },
    identity: {
      kind: "target",
      group,
      score: 0.9,
      margin: 0.5,
      decisionReason: "target_accepted",
      bestTargetName: group,
      bestExcludedName: null,
      candidates: [{
        group,
        bundleId: `${group}-bundle`,
        modelVersion: "matcher-v1",
        accepted: true,
        score: 0.9,
        threshold: 0.5,
        margin: 0.4,
        gateScore: 0.9,
        gateThreshold: 0.5,
        gateMargin: 0.4,
        decisionReason: "target_accepted",
      }],
    },
    countdown: {
      kind: "exact",
      text: "30",
      totalSeconds: 30,
      format: "seconds",
      textRegion: "center",
      confidence: 0.9,
      status: "high",
      routerTarget: "center",
      routerConfidence: 0.9,
      routerStatus: "accepted",
    },
  };
}

function toBestCandidate(
  observation: BuffExpiryPrecisionIconObservation,
): BuffExpiryPrecisionBestGroupCandidate {
  return {
    group: observation.identity.group!,
    boxIndex: observation.boxIndex,
    box: observation.box,
    accepted: true,
    matcherAccepted: true,
    winningGroup: observation.identity.group,
    score: observation.identity.score,
    margin: observation.identity.margin,
    decisionReason: observation.identity.decisionReason,
    countdown: observation.countdown,
  };
}
