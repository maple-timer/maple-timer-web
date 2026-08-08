import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultBuffExpiryAlert } from "../../../lib/storage";
import {
  MonitoringHarness,
  buffExpiryPrecisionEngineMock,
  buffSlotAnalysisEngineMock,
  cleanupMonitoringLoopTestHarness,
  createBuffExpiryPrecisionSampleResponse,
  createProfile,
  encodeVp8ParserFrameMock,
  playAlertMock,
  resetMonitoringLoopTestMocks,
  sampleBuffSlotVideoFrameMock,
  type HarnessApi,
} from "./useMonitoringLoopTestHarness";
import { createRuntimeReportEvidenceCoordinator } from "../../../application/reporting/runtimeReportEvidenceCoordinator";
import type { BuffExpiryRuntimeReportPayload } from "../../../contracts/reporting/runtimeReportEvidencePayloads";
import { createAlertIncidentJournal } from "../../../application/reporting/alertIncidentJournal";
import { PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW } from "../../../contracts/recognition/precisionParserInputTransport";
import { createRemoteRecognitionControlMarker } from "../../../contracts/remote-recognition/remoteRecognitionControlContract";
import { RemoteRecognitionWarmTraceCollector } from "../../../application/remote-recognition/remoteRecognitionWarmTraceCollector";

const BUFF_WARM_TARGET_CASES = [
  {
    target: "union-wealth",
    group: "unionWealth",
    label: "유니온의 부",
  },
  {
    target: "union-luck",
    group: "unionLuck",
    label: "유니온의 행운",
  },
  {
    target: "potion",
    group: "potion",
    label: "비약",
  },
  {
    target: "exp-coupon",
    group: "expCoupon",
    label: "경험치 쿠폰",
  },
] as const;

type BuffWarmTargetCase = (typeof BUFF_WARM_TARGET_CASES)[number];

describe("useMonitoringLoop buff expiry", () => {
  beforeEach(() => {
    resetMonitoringLoopTestMocks();
  });

  afterEach(() => {
    cleanupMonitoringLoopTestHarness();
  });

  it("does not preload the precision buff expiry engine before screen sharing starts", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={null}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(buffExpiryPrecisionEngineMock.preload).not.toHaveBeenCalled();
    expect(api.current?.setBuffExpiryPrecisionPreloadStatus).toHaveBeenCalledWith("idle");
    expect(buffExpiryPrecisionEngineMock.process).not.toHaveBeenCalled();
  });

  it("processes buff expiry samples while precision engine preload is still pending", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    let resolvePreload: (() => void) | null = null;
    buffExpiryPrecisionEngineMock.preload.mockReturnValue(
      new Promise((resolve) => {
        resolvePreload = () => resolve(undefined);
      }),
    );
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(api.current?.setBuffExpiryPrecisionPreloadStatus).toHaveBeenCalledWith("loading");
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalled();

    await act(async () => {
      resolvePreload?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(api.current?.setBuffExpiryPrecisionPreloadStatus).toHaveBeenCalledWith("ready");
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalled();
  });

  it("resets the precision engine when buff expiry is disabled", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const enabledProfile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
      },
    });
    const disabledProfile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: false,
      },
    });

    const { rerender } = render(
      <MonitoringHarness
        profile={enabledProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(buffExpiryPrecisionEngineMock.preload).toHaveBeenCalled();

    rerender(
      <MonitoringHarness
        profile={disabledProfile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(buffExpiryPrecisionEngineMock.reset).toHaveBeenCalled();
    expect(api.current?.buffExpiryRuntimeRef.current.status).toBe("paused");
  });

  it("does not republish unchanged disabled buff expiry state", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: false,
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });

    expect(api.current?.setBuffExpiryRuntime).toHaveBeenCalledTimes(1);
    expect(api.current?.setBuffExpirySnapshot).toHaveBeenCalledTimes(1);
    expect(api.current?.setBuffExpirySnapshot).toHaveBeenLastCalledWith(null);
    expect(buffExpiryPrecisionEngineMock.process).not.toHaveBeenCalled();
    expect(api.current?.buffExpiryRuntimeRef.current.status).toBe("paused");
  });

  it("schedules playback when the precision buff expiry engine confirms a due cluster", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    let sampleIndex = 0;
    buffExpiryPrecisionEngineMock.process.mockImplementation(() => {
      const seconds = Math.max(21, 27 - sampleIndex);
      sampleIndex += 1;
      return Promise.resolve(createBuffExpiryPrecisionSampleResponse(seconds));
    });
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 20,
        soundId: "띵동띵동",
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(buffExpiryPrecisionEngineMock.process.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toHaveLength(1);
    expect(api.current?.buffExpiryRuntimeRef.current.status).toBe("alerted");
    expect(playAlertMock).toHaveBeenCalledTimes(1);
    const firstAlertedAt = api.current?.buffExpiryRuntimeRef.current.lastAlertedAt;
    expect(firstAlertedAt).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.current?.buffExpiryRuntimeRef.current.lastAlertedAt).toBe(firstAlertedAt);
  });

  it.each(BUFF_WARM_TARGET_CASES)(
    "records one canonical remote $target path through the natural product timer",
    async ({ target, group, label }) => {
    const api: { current: HarnessApi | null } = { current: null };
    const sampleSeconds = [26, 25, 24, 23, 22, 21];
    let sampleIndex = 0;
    buffExpiryPrecisionEngineMock.process.mockImplementation(() => {
      const seconds =
        sampleSeconds[Math.min(sampleIndex, sampleSeconds.length - 1)] ?? 21;
      sampleIndex += 1;
      return Promise.resolve(
        createBuffExpiryTargetSampleResponse({ seconds, group, label }),
      );
    });
    let resolvePlayback: (() => void) | null = null;
    playAlertMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePlayback = () => resolve(undefined);
      }),
    );
    const remoteParserProvider = vi.fn(({ sampledAt }: { sampledAt: number }) =>
      Promise.resolve(createRemoteParserProviderResult(sampledAt)),
    );
    const monotonicOriginMs = Date.now();
    let monotonicSubMillisecond = 0;
    const collector = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => {
        monotonicSubMillisecond += 0.001;
        return Date.now() - monotonicOriginMs + monotonicSubMillisecond;
      },
      scheduleTimeout: () => () => undefined,
    });
    const bindPhysicalSample = vi.spyOn(collector, "bindPhysicalSample");
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 20,
        selectedPrecisionTargetGroups: [group],
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        precisionParserInputTransport={
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
        }
        remoteParserProvider={remoteParserProvider}
        remoteRecognitionWarmTracePort={collector}
        remoteRecognitionWarmTraceBuffTemporalPort={collector.getBuffExpiryTemporalPort()}
        remoteRecognitionWarmTraceBuffSchedulerPort={collector.getBuffExpirySchedulerPort()}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(5);
    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toHaveLength(0);
    expect(collector.snapshot()).toEqual([]);

    collector.armNextDecisiveTick({
      target,
      provider: "remote",
    });
    const beforeDecisiveTick = {
      samples: sampleBuffSlotVideoFrameMock.mock.calls.length,
      encodes: encodeVp8ParserFrameMock.mock.calls.length,
      providers: remoteParserProvider.mock.calls.length,
      featureProcesses: buffExpiryPrecisionEngineMock.process.mock.calls.length,
      bindings: bindPhysicalSample.mock.calls.length,
    };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(
      beforeDecisiveTick.samples + 1,
    );
    expect(encodeVp8ParserFrameMock).toHaveBeenCalledTimes(
      beforeDecisiveTick.encodes + 1,
    );
    expect(remoteParserProvider).toHaveBeenCalledTimes(
      beforeDecisiveTick.providers + 1,
    );
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(
      beforeDecisiveTick.featureProcesses + 1,
    );
    expect(bindPhysicalSample).toHaveBeenCalledTimes(
      beforeDecisiveTick.bindings + 1,
    );
    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toHaveLength(1);
    expect(api.current?.buffExpiryRuntimeRef.current.tracks[0]).toMatchObject({
      id: `next:${group}:r1:c0`,
      buffId: `next:${group}`,
      name: label,
    });
    expect(playAlertMock).not.toHaveBeenCalled();
    expect(collector.snapshot()).toEqual([]);

    const decisiveTickCounts = {
      samples: sampleBuffSlotVideoFrameMock.mock.calls.length,
      encodes: encodeVp8ParserFrameMock.mock.calls.length,
      providers: remoteParserProvider.mock.calls.length,
      featureProcesses: buffExpiryPrecisionEngineMock.process.mock.calls.length,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });

    expect(playAlertMock).not.toHaveBeenCalled();
    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(
      decisiveTickCounts.samples,
    );
    expect(encodeVp8ParserFrameMock).toHaveBeenCalledTimes(
      decisiveTickCounts.encodes,
    );
    expect(remoteParserProvider).toHaveBeenCalledTimes(
      decisiveTickCounts.providers,
    );
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(
      decisiveTickCounts.featureProcesses,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(collector.snapshot()).toEqual([]);
    const countsWhilePlaybackPending = {
      samples: sampleBuffSlotVideoFrameMock.mock.calls.length,
      encodes: encodeVp8ParserFrameMock.mock.calls.length,
      providers: remoteParserProvider.mock.calls.length,
      featureProcesses: buffExpiryPrecisionEngineMock.process.mock.calls.length,
    };

    await act(async () => {
      resolvePlayback?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sampleBuffSlotVideoFrameMock).toHaveBeenCalledTimes(
      countsWhilePlaybackPending.samples,
    );
    expect(encodeVp8ParserFrameMock).toHaveBeenCalledTimes(
      countsWhilePlaybackPending.encodes,
    );
    expect(remoteParserProvider).toHaveBeenCalledTimes(
      countsWhilePlaybackPending.providers,
    );
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(
      countsWhilePlaybackPending.featureProcesses,
    );
    const records = collector.snapshot();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toMatchObject({
      schema: "maple-timer.remote-recognition-v1-artifact.warm-e2e",
      version: 2,
      target,
      provider: "remote",
      browserClass: "chromium-local-headed",
      loadTier: "v1-owner-one",
      outcome: "completed",
      terminalStage: "playbackAcceptanceUs",
      waitMode: "scheduler-planned-excluded",
      scheduledWaitUs: 1_000_000,
    });
    expect(record?.excludedWaitUs).toBeGreaterThan(0);
    expect(record?.excludedWaitUs).toBeLessThanOrEqual(1_000_000);
    expect(record?.totalUs).toBeLessThan(15_000_000);
    expect(record?.wallTotalUs).toBeLessThan(20_000_000);
    expect(record?.wallTotalUs).toBe(
      (record?.totalUs ?? 0) + (record?.excludedWaitUs ?? 0),
    );
    expect(Object.values(record?.stageDurationsUs ?? {})).not.toContain(null);
    },
  );

  it("suppresses two simultaneous natural potion transitions before warm authorization without suppressing the product alert", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const sampleSeconds = [26, 25, 24, 23, 22, 21];
    let sampleIndex = 0;
    buffExpiryPrecisionEngineMock.process.mockImplementation(() => {
      const seconds =
        sampleSeconds[Math.min(sampleIndex, sampleSeconds.length - 1)] ?? 21;
      sampleIndex += 1;
      return Promise.resolve(
        createPotionSlotSampleResponse([seconds, seconds]),
      );
    });
    const remoteParserProvider = vi.fn(({ sampledAt }: { sampledAt: number }) =>
      Promise.resolve(createRemoteParserProviderResult(sampledAt)),
    );
    const monotonicOriginMs = Date.now();
    let monotonicSubMillisecond = 0;
    const collector = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => {
        monotonicSubMillisecond += 0.001;
        return Date.now() - monotonicOriginMs + monotonicSubMillisecond;
      },
      scheduleTimeout: () => () => undefined,
    });
    const temporalDelegate = collector.getBuffExpiryTemporalPort();
    const authorizeWarmWait = vi.fn(
      temporalDelegate.authorizeBuffExpiryPlannedWait,
    );
    const temporalPort = {
      ...temporalDelegate,
      authorizeBuffExpiryPlannedWait: authorizeWarmWait,
    };
    const schedulerDelegate = collector.getBuffExpirySchedulerPort();
    const prepareWarmWait = vi.fn(
      schedulerDelegate.prepareBuffExpiryPlannedWait,
    );
    const schedulerPort = {
      ...schedulerDelegate,
      prepareBuffExpiryPlannedWait: prepareWarmWait,
    };
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 20,
        selectedPrecisionTargetGroups: ["potion"],
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        precisionParserInputTransport={
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
        }
        remoteParserProvider={remoteParserProvider}
        remoteRecognitionWarmTracePort={collector}
        remoteRecognitionWarmTraceBuffTemporalPort={temporalPort}
        remoteRecognitionWarmTraceBuffSchedulerPort={schedulerPort}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(5);
    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toEqual([]);
    expect(api.current?.buffExpiryRuntimeRef.current.pendingTracks).toHaveLength(
      2,
    );

    collector.armNextDecisiveTick({
      target: "potion",
      provider: "remote",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const trackIds =
      api.current?.buffExpiryRuntimeRef.current.tracks.map((track) => track.id) ??
      [];
    expect(trackIds).toHaveLength(2);
    expect(api.current?.buffExpiryRuntimeRef.current.pendingTracks).toEqual([]);
    expect(authorizeWarmWait).not.toHaveBeenCalled();
    expect(prepareWarmWait).not.toHaveBeenCalled();
    expect(collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "potion",
        provider: "remote",
        outcome: "suppressed",
        terminalStage: "temporalDecisionUs",
        waitMode: "none",
        scheduledWaitUs: 0,
        excludedWaitUs: 0,
      }),
    ]);
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(
      api.current?.buffExpiryRuntimeRef.current.tracks.map(
        (track) => track.alertedAt,
      ),
    ).toEqual([Date.now(), Date.now()]);
    expect(
      api.current?.buffExpirySnapshotRef.current?.alertDecisionHistory?.[0]
        ?.newAlertTrackIds,
    ).toEqual(expect.arrayContaining(trackIds));
    expect(collector.snapshot()).toHaveLength(1);
  });

  it("keeps two normal potion tracks while suppressing a non-singleton warm cluster", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const startedAt = Date.now();
    const existingTrackId = "next:potion:r1:c0";
    const newTrackId = "next:potion:r1:c3";
    let sampleIndex = 0;
    buffExpiryPrecisionEngineMock.process.mockImplementation(() => {
      const firstSeconds = Math.max(30, 41 - sampleIndex);
      const slotSeconds = sampleIndex < 6
        ? [firstSeconds]
        : [firstSeconds, Math.max(21, 26 - (sampleIndex - 6))];
      sampleIndex += 1;
      return Promise.resolve(createPotionSlotSampleResponse(slotSeconds));
    });
    const remoteParserProvider = vi.fn(({ sampledAt }: { sampledAt: number }) =>
      Promise.resolve(createRemoteParserProviderResult(sampledAt)),
    );
    const monotonicOriginMs = Date.now();
    let monotonicSubMillisecond = 0;
    const collector = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => {
        monotonicSubMillisecond += 0.001;
        return Date.now() - monotonicOriginMs + monotonicSubMillisecond;
      },
      scheduleTimeout: () => () => undefined,
    });
    const temporalDelegate = collector.getBuffExpiryTemporalPort();
    const authorizeWarmWait = vi.fn(
      temporalDelegate.authorizeBuffExpiryPlannedWait,
    );
    const temporalPort = {
      ...temporalDelegate,
      authorizeBuffExpiryPlannedWait: authorizeWarmWait,
    };
    const schedulerDelegate = collector.getBuffExpirySchedulerPort();
    const prepareWarmWait = vi.fn(
      schedulerDelegate.prepareBuffExpiryPlannedWait,
    );
    const schedulerPort = {
      ...schedulerDelegate,
      prepareBuffExpiryPlannedWait: prepareWarmWait,
    };
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 20,
        selectedPrecisionTargetGroups: ["potion"],
      },
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        precisionParserInputTransport={
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
        }
        remoteParserProvider={remoteParserProvider}
        remoteRecognitionWarmTracePort={collector}
        remoteRecognitionWarmTraceBuffTemporalPort={temporalPort}
        remoteRecognitionWarmTraceBuffSchedulerPort={schedulerPort}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(11);
    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toEqual([
      expect.objectContaining({
        id: existingTrackId,
        buffId: "next:potion",
        name: "비약",
        detectedSeconds: 31,
        detectedAt: startedAt + 10_000,
        expiresAt: startedAt + 41_000,
        lastSeenAt: startedAt + 10_000,
        alertedAt: null,
      }),
    ]);
    expect(api.current?.buffExpiryRuntimeRef.current.pendingTracks).toEqual([
      expect.objectContaining({
        id: newTrackId,
        buffId: "next:potion",
        name: "비약",
        firstSeenAt: startedAt + 6_000,
        lastSeenAt: startedAt + 10_000,
      }),
    ]);
    expect(collector.snapshot()).toEqual([]);
    expect(playAlertMock).not.toHaveBeenCalled();

    collector.armNextDecisiveTick({
      target: "potion",
      provider: "remote",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const tracksAtDecisiveTick =
      api.current?.buffExpiryRuntimeRef.current.tracks ?? [];
    expect(tracksAtDecisiveTick).toHaveLength(2);
    expect(
      Object.fromEntries(
        tracksAtDecisiveTick.map((track) => [track.id, track]),
      ),
    ).toMatchObject({
      [existingTrackId]: {
        id: existingTrackId,
        buffId: "next:potion",
        name: "비약",
        detectedSeconds: 30,
        detectedAt: startedAt + 11_000,
        expiresAt: startedAt + 41_000,
        lastSeenAt: startedAt + 11_000,
        alertedAt: null,
      },
      [newTrackId]: {
        id: newTrackId,
        buffId: "next:potion",
        name: "비약",
        detectedSeconds: 21,
        detectedAt: startedAt + 11_000,
        expiresAt: startedAt + 32_000,
        lastSeenAt: startedAt + 11_000,
        alertedAt: null,
      },
    });
    expect(api.current?.buffExpiryRuntimeRef.current.pendingTracks).toEqual([]);
    expect(authorizeWarmWait).toHaveBeenCalledTimes(1);
    expect(prepareWarmWait).not.toHaveBeenCalled();
    expect(collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "potion",
        provider: "remote",
        outcome: "suppressed",
        terminalStage: "scheduleUs",
        waitMode: "none",
        scheduledWaitUs: 0,
        excludedWaitUs: 0,
      }),
    ]);
    const suppressedRecord = collector.snapshot()[0];
    expect(suppressedRecord?.stageDurationsUs.scheduleUs).not.toBeNull();
    expect(suppressedRecord?.stageDurationsUs.playbackAcceptanceUs).toBeNull();
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(
      api.current?.buffExpiryRuntimeRef.current.tracks.map(
        (track) => track.alertedAt,
      ),
    ).toEqual([Date.now(), Date.now()]);
    const decisionHistory =
      api.current?.buffExpirySnapshotRef.current?.alertDecisionHistory ?? [];
    expect(decisionHistory[decisionHistory.length - 1]).toMatchObject({
      shouldAlert: true,
      reason: "new-alert-group",
      newAlertTrackIds: [newTrackId, existingTrackId],
      markedTrackIds: [newTrackId, existingTrackId],
    });
    expect(
      Object.fromEntries(
        (api.current?.buffExpiryRuntimeRef.current.tracks ?? []).map((track) => [
          track.id,
          track.alertedAt,
        ]),
      ),
    ).toEqual({
      [existingTrackId]: startedAt + 12_000,
      [newTrackId]: startedAt + 12_000,
    });
    expect(collector.snapshot()).toHaveLength(1);
  });

  it("cancels a remote warm wait when the parser transport changes to local", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const sampleSeconds = [26, 25, 24, 23, 22, 21];
    let sampleIndex = 0;
    buffExpiryPrecisionEngineMock.process.mockImplementation(() => {
      const seconds =
        sampleSeconds[Math.min(sampleIndex, sampleSeconds.length - 1)] ?? 21;
      sampleIndex += 1;
      return Promise.resolve(createBuffExpiryPrecisionSampleResponse(seconds));
    });
    playAlertMock.mockReturnValue(new Promise(() => {}));
    const remoteParserProvider = vi.fn(({ sampledAt }: { sampledAt: number }) =>
      Promise.resolve(createRemoteParserProviderResult(sampledAt)),
    );
    const monotonicOriginMs = Date.now();
    let monotonicSubMillisecond = 0;
    const collector = new RemoteRecognitionWarmTraceCollector({
      browserClass: "chromium-local-headed",
      monotonicNowMs: () => {
        monotonicSubMillisecond += 0.001;
        return Date.now() - monotonicOriginMs + monotonicSubMillisecond;
      },
      scheduleTimeout: () => () => undefined,
    });
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
        alertLeadSeconds: 20,
        selectedPrecisionTargetGroups: ["unionWealth"],
      },
    });
    const onReady = (next: HarnessApi) => {
      api.current = next;
    };

    const rendered = render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        precisionParserInputTransport={
          PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
        }
        remoteParserProvider={remoteParserProvider}
        remoteRecognitionWarmTracePort={collector}
        remoteRecognitionWarmTraceBuffTemporalPort={collector.getBuffExpiryTemporalPort()}
        remoteRecognitionWarmTraceBuffSchedulerPort={collector.getBuffExpirySchedulerPort()}
        onReady={onReady}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(5);
    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toHaveLength(0);

    collector.armNextDecisiveTick({
      target: "union-wealth",
      provider: "remote",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toHaveLength(1);
    expect(collector.snapshot()).toEqual([]);
    expect(playAlertMock).not.toHaveBeenCalled();
    expect(buffSlotAnalysisEngineMock.process).not.toHaveBeenCalled();
    const featureProcessesBeforeTransportChange =
      buffExpiryPrecisionEngineMock.process.mock.calls.length;

    rendered.rerender(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        remoteRecognitionWarmTracePort={collector}
        remoteRecognitionWarmTraceBuffTemporalPort={collector.getBuffExpiryTemporalPort()}
        remoteRecognitionWarmTraceBuffSchedulerPort={collector.getBuffExpirySchedulerPort()}
        onReady={onReady}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.current?.buffExpiryRuntimeRef.current.tracks).toHaveLength(0);
    expect(collector.snapshot()).toEqual([
      expect.objectContaining({
        target: "union-wealth",
        provider: "remote",
        outcome: "cancelled",
        terminalStage: "playbackAcceptanceUs",
        waitMode: "scheduler-planned-excluded",
        scheduledWaitUs: 1_000_000,
      }),
    ]);
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(buffSlotAnalysisEngineMock.process).toHaveBeenCalledTimes(1);
    expect(buffExpiryPrecisionEngineMock.process).toHaveBeenCalledTimes(
      featureProcessesBeforeTransportChange + 1,
    );
    expect(remoteParserProvider).toHaveBeenCalledTimes(6);
    expect(playAlertMock).not.toHaveBeenCalled();
    expect(collector.snapshot()).toHaveLength(1);
  });

  it("publishes the exact shared runtime frame for a pending buff expiry report", async () => {
    const api: { current: HarnessApi | null } = { current: null };
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
      },
    });
    const evidencePromise = coordinator.request<BuffExpiryRuntimeReportPayload>({
      feature: "buff-expiry",
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        runtimeReportEvidenceCoordinator={coordinator}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const evidence = await evidencePromise;
    expect(evidence.source).toEqual({
      kind: "buff-slot-top-right-quadrant-v1",
      parserInputMode: "topRightQuadrant",
      coordinateSpace: "capture-pixels",
      sourceSize: { width: 4, height: 4 },
      roi: { x: 2, y: 0, width: 2, height: 2 },
      dataUrl: "data:image/png;base64,skill-buff-slot",
    });
    expect(evidence.parser).toEqual({
      engine: "rule",
      version: "test",
      fallbackReason: "webgpu-unavailable",
    });
    expect(evidence.payload.snapshot.sampledAt).toBe(evidence.sampledAt);
    expect(evidence.payload.snapshot.nextIconObservations).toHaveLength(1);
    expect(evidence.payload.stateAfter).toMatchObject({
      lastSampledAt: evidence.sampledAt,
      boxCount: 1,
      acceptedMatchCount: 1,
    });
    expect(evidence.payload.stateBefore.lastSampledAt).toBeNull();
  });

  it("publishes the same runtime source with an explicit worker error", async () => {
    const coordinator = createRuntimeReportEvidenceCoordinator();
    buffExpiryPrecisionEngineMock.process.mockRejectedValueOnce(
      new Error("buff-expiry-worker-crashed"),
    );
    const profile = createProfile({
      buffExpiryAlert: {
        ...createDefaultBuffExpiryAlert(),
        enabled: true,
      },
    });
    const evidencePromise = coordinator.request<BuffExpiryRuntimeReportPayload>({
      feature: "buff-expiry",
    });

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        runtimeReportEvidenceCoordinator={coordinator}
        onReady={() => {}}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const evidence = await evidencePromise;
    expect(evidence.source.dataUrl).toBe("data:image/png;base64,skill-buff-slot");
    expect(evidence.parser).toEqual({
      engine: "rule",
      version: "test-shared-parser",
      fallbackReason: null,
    });
    expect(evidence.payload.stateAfter).toMatchObject({
      status: "unavailable",
      unsupportedReason: "buff-expiry-worker-crashed",
    });
    expect(evidence.payload.snapshot).toMatchObject({
      sampledAt: evidence.sampledAt,
      parserEngine: "rule",
      unsupportedReason: "buff-expiry-worker-crashed",
    });
  });

  it("preserves a shared parser failure in runtime evidence and the recent incident journal", async () => {
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const journal = createAlertIncidentJournal();
    buffSlotAnalysisEngineMock.process.mockRejectedValueOnce(
      new Error("dl-buff-parser-webgpu-unavailable"),
    );
    const evidencePromise = coordinator.request<BuffExpiryRuntimeReportPayload>({
      feature: "buff-expiry",
    });

    render(
      <MonitoringHarness
        profile={createProfile({
          buffExpiryAlert: {
            ...createDefaultBuffExpiryAlert(),
            enabled: true,
          },
        })}
        stream={{} as MediaStream}
        runtimeReportEvidenceCoordinator={coordinator}
        alertIncidentJournal={journal}
        onReady={() => {}}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const evidence = await evidencePromise;
    expect(evidence.parser.failure).toEqual({
      reason: "webgpu-unavailable",
      technicalMessage: "dl-buff-parser-webgpu-unavailable",
      diagnostic: null,
    });
    const incident = journal.freeze({ feature: "buff-expiry" });
    expect(incident.entries).toHaveLength(4);
    expect(incident.entries.map((entry) => entry.targetId).sort()).toEqual([
      "expCoupon",
      "potion",
      "unionLuck",
      "unionWealth",
    ]);
    expect(new Set(incident.entries.map((entry) => entry.frameId)).size).toBe(1);
    expect(incident.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "unavailable",
          decision: "webgpu-unavailable",
          details: expect.objectContaining({
            parserFailureReason: "webgpu-unavailable",
            parserTechnicalMessage: "dl-buff-parser-webgpu-unavailable",
          }),
        }),
      ]),
    );
  });
});

function createBuffExpiryTargetSampleResponse({
  seconds,
  group,
  label,
}: {
  seconds: number;
  group: BuffWarmTargetCase["group"];
  label: BuffWarmTargetCase["label"];
}) {
  const response = createBuffExpiryPrecisionSampleResponse(seconds);
  return {
    ...response,
    iconObservations: response.iconObservations.map((observation) => ({
      ...observation,
      identity: {
        ...observation.identity,
        group,
        bestTargetName: label,
      },
    })),
  };
}

function createPotionSlotSampleResponse(secondsBySlot: readonly number[]) {
  const base = createBuffExpiryTargetSampleResponse({
    seconds: secondsBySlot[0] ?? 21,
    group: "potion",
    label: "비약",
  });
  const baseBox = base.boxes[0]!;
  const baseObservation = base.iconObservations[0]!;
  const boxes = secondsBySlot.map((_seconds, index) => ({
    ...baseBox,
    x: baseBox.x + index * 120,
    col: index * 3,
  }));

  return {
    ...base,
    boxes,
    icons: secondsBySlot.map(() => ({
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    })),
    iconObservations: secondsBySlot.map((seconds, index) => ({
      ...baseObservation,
      id: `slot:${index}`,
      boxIndex: index,
      box: boxes[index]!,
      countdown: {
        ...baseObservation.countdown,
        text: String(seconds),
        totalSeconds: seconds,
      },
    })),
    performance: {
      ...base.performance,
      countdownCount: secondsBySlot.length,
      boxCount: secondsBySlot.length,
    },
  };
}

function createRemoteParserProviderResult(sampledAt: number) {
  return {
    e2eMs: 8,
    response: {
      contract: createRemoteRecognitionControlMarker(),
      status: "ok" as const,
      sessionId: "session-1",
      purpose: "parser-provider" as const,
      expiresAt: Date.now() + 15_000,
      frame: {
        sequence: 1,
        sampledAt,
        encodedBytes: 3,
        width: 2,
        height: 2,
        parser: {
          engine: "onnxruntime-native" as const,
          modelId: "test-remote-parser",
          modelInputWidth: 544,
          modelInputHeight: 960,
          onnxRuntimeVersion: "1.24.4",
          executionProviders: ["CoreMLExecutionProvider"],
          boxCount: 0,
        },
        boxes: [],
        timings: {
          decodeMs: 1,
          preprocessMs: 1,
          inferenceMs: 3,
          postprocessMs: 1,
          serverTotalMs: 6,
        },
      },
    },
  };
}
