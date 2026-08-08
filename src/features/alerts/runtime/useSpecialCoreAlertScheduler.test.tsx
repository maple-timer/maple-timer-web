import { act, cleanup, render } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playAlertFromOffset, preloadAlertFromOffset } from "../../../lib/alert";
import { createDefaultProfile } from "../../../lib/profileFactory";
import { createDefaultSpecialCoreAlert } from "../../../lib/storage";
import {
  createSpecialCoreRuntimeState,
  type SpecialCoreDetectedIcon,
  type SpecialCoreRuntimeState,
  type SpecialCoreSampleResponse,
} from "../../../lib/specialCore";
import type { Profile, SpecialCoreAlertConfig } from "../../../types";
import { useSpecialCoreAlertScheduler } from "./useSpecialCoreAlertScheduler";
import {
  createAlertIncidentJournal,
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import {
  createSpecialCoreIncidentRuntimeRecorder,
  recordSpecialCoreIncidentRuntimeSample,
  type SpecialCoreIncidentRuntimeRecorder,
} from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import type {
  RemoteRecognitionWarmTraceFeatureClaim,
  RemoteRecognitionWarmTraceFeaturePort,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  bindSpecialCoreWarmTraceActivation,
  type SpecialCoreWarmTraceClaim,
} from "./specialCoreWarmTrace";

vi.mock("../../../lib/alert", () => ({
  playAlertFromOffset: vi.fn().mockResolvedValue(undefined),
  preloadAlertFromOffset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/analyticsEvents", () => ({
  trackAlertPlayed: vi.fn(),
}));

const playAlertFromOffsetMock = vi.mocked(playAlertFromOffset);
const preloadAlertFromOffsetMock = vi.mocked(preloadAlertFromOffset);

type HarnessApi = {
  runtimeRef: MutableRefObject<SpecialCoreRuntimeState>;
  incidentRecorderRef: MutableRefObject<SpecialCoreIncidentRuntimeRecorder>;
};

function makeConfig(patch: Partial<SpecialCoreAlertConfig> = {}): SpecialCoreAlertConfig {
  return {
    ...createDefaultSpecialCoreAlert(),
    enabled: true,
    cooldownSeconds: 30,
    alertLeadSeconds: 10,
    soundId: "여성 카운트다운",
    volume: 0.75,
    ...patch,
  };
}

function makeProfile(config: SpecialCoreAlertConfig): Profile {
  return {
    ...createDefaultProfile(),
    skills: [],
    masterVolume: 0.8,
    specialCoreAlert: config,
  };
}

function SchedulerHarness({
  config,
  gameViewportRevision = 0,
  initialState,
  stream,
  journal,
  initialIncidentRecorder,
  onReady,
}: {
  config: SpecialCoreAlertConfig;
  gameViewportRevision?: number;
  initialState: SpecialCoreRuntimeState;
  stream: MediaStream | null;
  journal?: AlertIncidentJournal;
  initialIncidentRecorder?: SpecialCoreIncidentRuntimeRecorder;
  onReady: (api: HarnessApi) => void;
}) {
  const [runtime, setRuntime] = useState(initialState);
  const profileRef = useRef<Profile>(makeProfile(config));
  const runtimeRef = useRef(runtime);
  const incidentRecorderRef = useRef(
    initialIncidentRecorder ?? createSpecialCoreIncidentRuntimeRecorder(0),
  );
  const lastAlertErrorRef = useRef<string | null>(null);
  const setRuntimeRef = useRef<Dispatch<SetStateAction<SpecialCoreRuntimeState>>>(setRuntime);

  profileRef.current = makeProfile(config);
  runtimeRef.current = runtime;
  setRuntimeRef.current = setRuntime;

  useSpecialCoreAlertScheduler({
    stream,
    gameViewportRevision,
    config,
    profileRef,
    specialCoreRuntime: runtime,
    specialCoreRuntimeRef: runtimeRef,
    specialCoreIncidentRecorderRef: incidentRecorderRef,
    alertIncidentJournal: journal,
    lastAlertErrorRef,
    setSpecialCoreRuntime: setRuntimeRef.current,
    onMessage: vi.fn(),
  });

  useEffect(() => {
    onReady({ runtimeRef, incidentRecorderRef });
  }, [onReady]);

  return null;
}

describe("useSpecialCoreAlertScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    playAlertFromOffsetMock.mockImplementation(async (_soundId, _volume, _offset, options) => {
      options?.onStarted?.();
    });
    preloadAlertFromOffsetMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("plays at alertDueAt without waiting for another special-core sample", async () => {
    const config = makeConfig({ cooldownSeconds: 11 });
    const state = createSpecialCoreRuntimeState({
      status: "cooldown",
      activationId: 1,
      activationStartedAt: 1_000,
      activationConfirmedAt: 1_900,
      cooldownEndsAt: 12_000,
      alertDueAt: 2_000,
      alertedAt: null,
    });
    const journal = createAlertIncidentJournal();
    const api: { current: HarnessApi | null } = { current: null };
    const incidentRecorder = createConfirmedIncidentRecorder(state, config);
    expect(incidentRecorder.boundary?.activeActivation).toMatchObject({
      runtimeActivationId: 1,
      alertDueAt: 2_000,
    });
    vi.setSystemTime(1_900);

    render(
      <SchedulerHarness
        config={config}
        initialState={state}
        stream={{} as MediaStream}
        journal={journal}
        initialIncidentRecorder={incidentRecorder}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(99);
    });
    expect(playAlertFromOffsetMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(api.current?.runtimeRef.current.alertedAt).toBe(2_000);
    expect(playAlertFromOffsetMock).toHaveBeenCalledTimes(1);
    const [soundId, volume, startOffset, options] = playAlertFromOffsetMock.mock.calls[0] ?? [];
    expect(soundId).toBe("여성 카운트다운");
    expect(volume).toBeCloseTo(0.6);
    expect(startOffset).toBe(0);
    expect(options).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(api.current?.runtimeRef.current.lastAlertPlayback).toMatchObject({
      status: "finished",
      requestedAt: 2_000,
      startedAt: 2_000,
      finishedAt: 2_000,
    });
    expect(
      api.current?.incidentRecorderRef.current.archive.lifecycleEvents.map(
        (event) => `${event.action}:${String(event.details.reason ?? "")}`,
      ),
    ).toContain("schedule-fired:");
    expect(last(api.current?.incidentRecorderRef.current.archive.schedules)).toMatchObject({
      status: "fired",
      alertDueAt: 2_000,
    });
    expect(last(api.current?.incidentRecorderRef.current.archive.decisions)).toMatchObject({
      occurredAt: 2_000,
      schedulerDelayMs: 0,
    });
    expect(
      last(api.current?.incidentRecorderRef.current.archive.playbackAttempts),
    ).toMatchObject({
      requestedAt: 2_000,
      browserAcceptedAt: 2_000,
      finishedAt: 2_000,
      status: "finished",
    });
    const entries = journal.freeze({ feature: "special-core" }, Date.now()).entries;
    expect(
      entries
        .filter((entry) => entry.kind === "lifecycle")
        .map((entry) => entry.decision),
    ).toEqual(["schedule-registered", "schedule-fired"]);
    expect(
      entries
        .filter((entry) => entry.kind === "playback")
        .map((entry) => entry.status),
    ).toEqual(["finished"]);
  });

  it("cancels a pending alert when the special-core alert is disabled", async () => {
    const state = createSpecialCoreRuntimeState({
      status: "cooldown",
      activationId: 1,
      activationStartedAt: 1_000,
      activationConfirmedAt: 1_500,
      cooldownEndsAt: 12_000,
      alertDueAt: 2_000,
      alertedAt: null,
    });
    const enabledConfig = makeConfig();
    const disabledConfig = makeConfig({ enabled: false });
    const { rerender } = render(
      <SchedulerHarness
        config={enabledConfig}
        initialState={state}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    rerender(
      <SchedulerHarness
        config={disabledConfig}
        initialState={state}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(playAlertFromOffsetMock).not.toHaveBeenCalled();
  });

  it("cancels and does not recreate a pending alert after the game viewport changes", async () => {
    const state = createSpecialCoreRuntimeState({
      status: "cooldown",
      activationId: 1,
      activationStartedAt: 1_000,
      activationConfirmedAt: 1_500,
      cooldownEndsAt: 12_000,
      alertDueAt: 2_000,
      alertedAt: null,
    });
    const config = makeConfig();
    const stream = {} as MediaStream;
    const { rerender } = render(
      <SchedulerHarness
        config={config}
        gameViewportRevision={0}
        initialState={state}
        stream={stream}
        onReady={vi.fn()}
      />,
    );

    rerender(
      <SchedulerHarness
        config={config}
        gameViewportRevision={1}
        initialState={state}
        stream={stream}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(playAlertFromOffsetMock).not.toHaveBeenCalled();
  });

  it("does not mark playback started until the browser accepts play()", async () => {
    const config = makeConfig({ cooldownSeconds: 11 });
    const state = createSpecialCoreRuntimeState({
      status: "cooldown",
      activationId: 1,
      activationStartedAt: 1_000,
      activationConfirmedAt: 1_900,
      activationLastSeenAt: 1_900,
      cooldownEndsAt: 12_000,
      alertDueAt: 2_000,
      alertedAt: null,
    });
    let playbackOptions:
      | { signal?: AbortSignal; onStarted?: () => void }
      | undefined;
    let finishPlayback: (() => void) | null = null;
    playAlertFromOffsetMock.mockImplementationOnce(
      async (_soundId, _volume, _offset, options) =>
        new Promise<void>((resolve) => {
          playbackOptions = options;
          finishPlayback = resolve;
        }),
    );
    const api: { current: HarnessApi | null } = { current: null };
    vi.setSystemTime(1_900);

    render(
      <SchedulerHarness
        config={config}
        initialState={state}
        initialIncidentRecorder={createConfirmedIncidentRecorder(state, config)}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(api.current?.runtimeRef.current.lastAlertPlayback?.status).toBe("requested");
    expect(
      last(api.current?.incidentRecorderRef.current.archive.playbackAttempts),
    ).toMatchObject({ status: "requested", browserAcceptedAt: null });

    act(() => {
      playbackOptions?.onStarted?.();
    });

    expect(api.current?.runtimeRef.current.lastAlertPlayback?.status).toBe("started");
    expect(
      last(api.current?.incidentRecorderRef.current.archive.playbackAttempts),
    ).toMatchObject({ status: "browser-play-accepted", browserAcceptedAt: 2_000 });

    await act(async () => {
      finishPlayback?.();
      await Promise.resolve();
    });

    expect(api.current?.runtimeRef.current.lastAlertPlayback?.status).toBe("finished");
    expect(
      last(api.current?.incidentRecorderRef.current.archive.playbackAttempts),
    ).toMatchObject({ status: "finished", finishedAt: 2_000 });
  });

  it("fails a warm playback that settles without browser acceptance", async () => {
    const config = makeConfig({ cooldownSeconds: 11, alertLeadSeconds: 10 });
    const warm = createWarmSchedulerFixture();
    playAlertFromOffsetMock.mockResolvedValueOnce(undefined);
    vi.setSystemTime(1_900);
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        config={config}
        initialState={warm.stateAfter}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(playAlertFromOffsetMock).toHaveBeenCalledTimes(1);
    expect(warm.mocks.completeFeature).not.toHaveBeenCalled();
    expect(warm.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      warm.featureClaim,
      "failed",
    );
    expect(api.current?.runtimeRef.current.lastAlertPlayback).toMatchObject({
      status: "failed",
      error: "playback-resolved-before-browser-start",
    });
  });

  it("cancels a scheduled warm activation exactly once when disabled", () => {
    const enabledConfig = makeConfig({ cooldownSeconds: 11, alertLeadSeconds: 10 });
    const disabledConfig = { ...enabledConfig, enabled: false };
    const warm = createWarmSchedulerFixture();
    vi.setSystemTime(1_900);
    const stream = {} as MediaStream;
    const { rerender } = render(
      <SchedulerHarness
        config={enabledConfig}
        initialState={warm.stateAfter}
        stream={stream}
        onReady={vi.fn()}
      />,
    );

    rerender(
      <SchedulerHarness
        config={disabledConfig}
        initialState={warm.stateAfter}
        stream={stream}
        onReady={vi.fn()}
      />,
    );

    expect(warm.mocks.terminateFeatureCurrentStage).toHaveBeenCalledTimes(1);
    expect(warm.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      warm.featureClaim,
      "cancelled",
    );
    expect(playAlertFromOffsetMock).not.toHaveBeenCalled();
  });

  it("keeps product playback intact when warm completion throws", async () => {
    const config = makeConfig({ cooldownSeconds: 11, alertLeadSeconds: 10 });
    const warm = createWarmSchedulerFixture();
    warm.mocks.completeFeature.mockImplementation(() => {
      throw new Error("warm-completion-failed");
    });
    vi.setSystemTime(1_900);
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        config={config}
        initialState={warm.stateAfter}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(warm.mocks.completeFeature).toHaveBeenCalledTimes(1);
    expect(warm.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      warm.featureClaim,
      "failed",
    );
    expect(api.current?.runtimeRef.current).toMatchObject({
      status: "alerted",
      lastAlertPlayback: expect.objectContaining({ status: "finished" }),
    });
  });

  it("keeps the real timer and playback intact when warm schedule completion throws", async () => {
    const config = makeConfig({ cooldownSeconds: 11, alertLeadSeconds: 10 });
    const warm = createWarmSchedulerFixture();
    warm.mocks.completeFeatureStage.mockImplementation((_claim, stage) => {
      if (stage === "scheduleUs") {
        throw new Error("warm-schedule-failed");
      }
      return true;
    });
    vi.setSystemTime(1_900);
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        config={config}
        initialState={warm.stateAfter}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(playAlertFromOffsetMock).toHaveBeenCalledTimes(1);
    expect(warm.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      warm.featureClaim,
      "failed",
    );
    expect(warm.mocks.completeFeature).not.toHaveBeenCalled();
    expect(api.current?.runtimeRef.current).toMatchObject({
      status: "alerted",
      lastAlertPlayback: expect.objectContaining({ status: "finished" }),
    });
  });

  it("fails a warm playback when the product playback rejects", async () => {
    const config = makeConfig({ cooldownSeconds: 11, alertLeadSeconds: 10 });
    const warm = createWarmSchedulerFixture();
    playAlertFromOffsetMock.mockRejectedValueOnce(
      new Error("special-core-playback-rejected"),
    );
    vi.setSystemTime(1_900);
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        config={config}
        initialState={warm.stateAfter}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(warm.mocks.completeFeature).not.toHaveBeenCalled();
    expect(warm.mocks.terminateFeatureCurrentStage).toHaveBeenCalledWith(
      warm.featureClaim,
      "failed",
    );
    expect(api.current?.runtimeRef.current.lastAlertPlayback).toMatchObject({
      status: "failed",
      error: "special-core-playback-rejected",
    });
  });
});

function createWarmSchedulerFixture() {
  const featureClaim = {} as RemoteRecognitionWarmTraceFeatureClaim;
  const completeFeatureStage = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["completeFeatureStage"]
  >(() => true);
  const terminateFeatureStage = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["terminateFeatureStage"]
  >(() => true);
  const terminateFeatureCurrentStage = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["terminateFeatureCurrentStage"]
  >(() => true);
  const completeFeature = vi.fn<
    RemoteRecognitionWarmTraceFeaturePort["completeFeature"]
  >(() => true);
  const featurePort: RemoteRecognitionWarmTraceFeaturePort = {
    getSeries: vi.fn(() => null),
    claimFeatureOwner: vi.fn(() => featureClaim),
    completeFeatureStage,
    terminateFeatureStage,
    terminateFeatureCurrentStage,
    completeFeature,
  };
  const firstIcon = createDetectedCandidate();
  const decisiveIcon = createDetectedCandidate();
  const stateBefore = createSpecialCoreRuntimeState({
    status: "confirming",
    lastSampledAt: 1_000,
    boxCount: 1,
    detectedCount: 1,
    pendingDetections: [
      {
        observedAt: 1_000,
        boxIndex: firstIcon.boxIndex,
        box: firstIcon.box,
        score: firstIcon.match.score,
        margin: firstIcon.match.margin,
      },
    ],
    pendingDetectionIcons: [firstIcon],
    activationLastSeenAt: 1_000,
    lastDetectedIcon: firstIcon,
  });
  const stateAfter = createSpecialCoreRuntimeState({
    status: "cooldown",
    lastSampledAt: 2_000,
    boxCount: 1,
    detectedCount: 1,
    activationId: 1,
    activationStartedAt: 1_000,
    activationConfirmedAt: 2_000,
    activationLastSeenAt: 2_000,
    cooldownEndsAt: 12_000,
    alertDueAt: 2_000,
    alertedAt: null,
    lastDetectedIcon: decisiveIcon,
    activationEvidence: {
      activationId: 1,
      activationStartedAt: 1_000,
      activationConfirmedAt: 2_000,
      confirmationIcons: [firstIcon, decisiveIcon],
    },
  });
  const response: SpecialCoreSampleResponse = {
    sampledAt: 2_000,
    parserEngine: "dl",
    parserVersion: "test-parser",
    parserFallbackReason: null,
    parserRuntime: null,
    boxCount: 1,
    parsedBoxes: [decisiveIcon.box],
    rowGroups: [
      {
        rowIndex: 0,
        y: decisiveIcon.box.y,
        size: decisiveIcon.box.size,
        boxIndexes: [decisiveIcon.boxIndex],
        eligible: true,
      },
    ],
    eligibleBoxIndexes: [decisiveIcon.boxIndex],
    detectedCount: 1,
    detectedIcon: decisiveIcon,
    candidateIcons: [decisiveIcon],
    performance: { totalMs: 1, detectMs: 0, matchMs: 1, boxCount: 1 },
    unsupported: false,
    unsupportedReason: null,
  };
  const warmTrace: SpecialCoreWarmTraceClaim = {
    claim: featureClaim,
    featurePort,
    phase: "temporal",
  };
  const candidate = bindSpecialCoreWarmTraceActivation({
    warmTrace,
    response,
    stateBefore,
    stateAfter,
    sampledAt: 2_000,
  });
  expect(candidate).not.toBeNull();
  return {
    stateAfter,
    candidate: candidate!,
    featureClaim,
    mocks: {
      completeFeatureStage,
      terminateFeatureStage,
      terminateFeatureCurrentStage,
      completeFeature,
    },
  };
}

function createConfirmedIncidentRecorder(
  confirmedState: SpecialCoreRuntimeState,
  config: SpecialCoreAlertConfig,
): SpecialCoreIncidentRuntimeRecorder {
  const candidate = createDetectedCandidate();
  const initialState = createSpecialCoreRuntimeState({ status: "waiting" });
  const confirmingState = createSpecialCoreRuntimeState({
    status: "confirming",
    lastSampledAt: 1_000,
    boxCount: 1,
    detectedCount: 1,
    pendingDetections: [
      {
        observedAt: 1_000,
        boxIndex: candidate.boxIndex,
        box: candidate.box,
        score: candidate.match.score,
        margin: candidate.match.margin,
      },
    ],
    pendingDetectionIcons: [candidate],
    lastDetectedIcon: candidate,
  });
  let recorder = createSpecialCoreIncidentRuntimeRecorder(0);
  recorder = recordSpecialCoreIncidentRuntimeSample({
    previous: recorder,
    input: createIncidentSampleInput({
      config,
      sampledAt: 1_000,
      stateBefore: initialState,
      stateAfter: confirmingState,
      candidate,
    }),
  });
  recorder = recordSpecialCoreIncidentRuntimeSample({
    previous: recorder,
    input: createIncidentSampleInput({
      config,
      sampledAt: 1_900,
      stateBefore: confirmingState,
      stateAfter: {
        ...confirmedState,
        lastSampledAt: 1_900,
        boxCount: 1,
        detectedCount: 1,
        lastDetectedIcon: candidate,
      },
      candidate,
    }),
  });
  return recorder;
}

function createIncidentSampleInput({
  config,
  sampledAt,
  stateBefore,
  stateAfter,
  candidate,
}: {
  config: SpecialCoreAlertConfig;
  sampledAt: number;
  stateBefore: SpecialCoreRuntimeState;
  stateAfter: SpecialCoreRuntimeState;
  candidate: SpecialCoreDetectedIcon;
}) {
  return {
    sampledAt,
    configuration: {
      enabled: config.enabled,
      cooldownSeconds: config.cooldownSeconds,
      alertLeadSeconds: config.alertLeadSeconds,
      soundId: config.soundId,
      featureVolume: config.volume,
      masterVolume: 0.8,
      effectiveVolume: config.volume * 0.8,
    },
    parserRuntimeGeneration: "webgpu:default:ready",
    layoutKey: "1920x1080",
    sourceGeometryRevision: "geometry-1",
    stateBefore,
    stateAfter,
    snapshot: {
      sampledAt,
      error: null,
      parserEngine: "dl" as const,
      parserVersion: "test-parser",
      parserFallbackReason: null,
      boxCount: 1,
      detectedCount: 1,
      detectedIcon: candidate,
      candidateIcons: [candidate],
      performance: { totalMs: 4, detectMs: 2, matchMs: 2, boxCount: 1 },
    },
    source: null,
    parser: null,
    parsedBoxes: [candidate.box],
    rowGroups: [
      {
        rowIndex: 0,
        y: candidate.box.y,
        size: candidate.box.size,
        boxIndexes: [candidate.boxIndex],
        eligible: true,
      },
    ],
    eligibleBoxIndexes: [candidate.boxIndex],
    timings: null,
    runtimeFailure: null,
    media: null,
  };
}

function createDetectedCandidate(): SpecialCoreDetectedIcon {
  return {
    boxIndex: 0,
    box: { x: 100, y: 20, size: 32, confidence: 0.99, score: 0.98 },
    icon: {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 255, 255, 255]),
    },
    match: {
      matched: true,
      targetId: "specialCore",
      bundleId: "special-core-deep-v2",
      modelId: "special-core-deep-v2",
      modelVersion: "v2",
      variantId: "default",
      gateVersion: 2,
      score: 0.98,
      threshold: 0.5,
      margin: 0.48,
      gateScore: 0.99,
      gateThreshold: 0.5,
      gateMargin: 0.49,
      rescueThreshold: 0.99,
      rescueMargin: 0,
      basePassed: true,
      positiveGatePassed: true,
      primaryPassed: true,
      rescuePassed: false,
      decisionReason: "base_and_positive_gate_passed",
      elapsedMs: 2,
    },
  };
}

function last<T>(items: T[] | undefined): T | undefined {
  return items?.[items.length - 1];
}
