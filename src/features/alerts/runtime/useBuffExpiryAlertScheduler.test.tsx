import { act, cleanup, render } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playAlert } from "../../../lib/alert";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
  BuffExpiryTrackedBuff,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import { createDefaultBuffExpiryAlert } from "../../../lib/storage";
import type { Profile } from "../../../types";
import { createDefaultProfile } from "../../../lib/profileFactory";
import { useBuffExpiryAlertScheduler } from "./useBuffExpiryAlertScheduler";
import type {
  RemoteRecognitionWarmTraceBuffScheduledWait,
  RemoteRecognitionWarmTraceBuffSchedulerPort,
  RemoteRecognitionWarmTraceBuffWaitAuthorization,
  RemoteRecognitionWarmTraceBuffWaitPreparation,
  RemoteRecognitionWarmTraceFeatureClaim,
  RemoteRecognitionWarmTraceFeaturePort,
  RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  createAlertIncidentJournal,
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import { createBuffExpiryIncidentRuntimeRecorder } from "../../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";
import type { BuffExpiryWarmTraceScheduleCandidate } from "./buffExpiryWarmTrace";

vi.mock("../../../lib/alert", () => ({
  playAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/analyticsEvents", () => ({
  trackAlertPlayed: vi.fn(),
}));

const playAlertMock = vi.mocked(playAlert);

type HarnessApi = {
  runtimeRef: MutableRefObject<BuffExpiryRuntimeState>;
  snapshotRef: MutableRefObject<BuffExpirySnapshot | null>;
  syncBuffExpiryAlertTimers: (
    tracks: BuffExpiryTrackedBuff[],
    now: number,
    warmTraceCandidate?: BuffExpiryWarmTraceScheduleCandidate | null,
  ) => void;
};

type WarmTraceFault =
  | "prepare-throw"
  | "prepare-null"
  | "commit-throw"
  | "commit-null"
  | "resume-throw"
  | "resume-null"
  | "complete-throw"
  | "complete-null";

function createWarmTraceCandidate({
  trackId,
  sampledAtMs,
  dueAtMs,
  fault,
}: {
  trackId: string;
  sampledAtMs: number;
  dueAtMs: number;
  fault?: WarmTraceFault;
}) {
  const claim = Object.freeze({}) as RemoteRecognitionWarmTraceFeatureClaim;
  const authorization = Object.freeze(
    {},
  ) as RemoteRecognitionWarmTraceBuffWaitAuthorization;
  const preparation = Object.freeze(
    {},
  ) as RemoteRecognitionWarmTraceBuffWaitPreparation;
  const scheduledWait = Object.freeze(
    {},
  ) as RemoteRecognitionWarmTraceBuffScheduledWait;
  const events: string[] = [];
  const featurePort: RemoteRecognitionWarmTraceFeaturePort = {
    getSeries: vi.fn(() => null),
    claimFeatureOwner: vi.fn(() => null),
    completeFeatureStage: vi.fn(() => true),
    terminateFeatureStage: vi.fn(
      (_claim, stage, outcome: RemoteRecognitionWarmTraceTerminalOutcome) => {
        events.push(`terminate-feature:${stage}:${outcome}`);
        return true;
      },
    ),
    terminateFeatureCurrentStage: vi.fn(() => true),
    completeFeature: vi.fn(() => true),
  };
  const schedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort = {
    prepareBuffExpiryPlannedWait: vi.fn(() => {
      events.push("prepare");
      if (fault === "prepare-throw") {
        throw new Error("prepare-failed");
      }
      return fault === "prepare-null" ? null : preparation;
    }),
    commitBuffExpiryPlannedWait: vi.fn(() => {
      events.push("commit");
      if (fault === "commit-throw") {
        throw new Error("commit-failed");
      }
      return fault === "commit-null" ? null : scheduledWait;
    }),
    resumeBuffExpiryPlannedWait: vi.fn(() => {
      events.push("resume");
      if (fault === "resume-throw") {
        throw new Error("resume-failed");
      }
      return fault === "resume-null" ? (null as unknown as boolean) : true;
    }),
    completeBuffExpiryPlannedWait: vi.fn(() => {
      events.push("complete");
      if (fault === "complete-throw") {
        throw new Error("complete-failed");
      }
      return fault === "complete-null" ? (null as unknown as boolean) : true;
    }),
    terminateBuffExpiryPlannedWait: vi.fn((_wait, outcome) => {
      events.push(`terminate-wait:${outcome}`);
      return true;
    }),
  };
  const candidate: BuffExpiryWarmTraceScheduleCandidate = {
    target: "union-wealth",
    trackId,
    sampledAtMs,
    dueAtMs,
    authorization,
    claim,
    featurePort,
    schedulerPort,
    active: true,
  };
  return {
    candidate,
    events,
    featurePort,
    schedulerPort,
  };
}

function makeTrack(expiresAt: number, patch: Partial<BuffExpiryTrackedBuff> = {}): BuffExpiryTrackedBuff {
  return {
    id: "union_wealth_group:scheduled",
    buffId: "union_wealth_group",
    name: "유니온의 부",
    box: {
      x: 10,
      y: 20,
      width: 34,
      height: 34,
      side: 34,
      confidence: 0.99,
    },
    detectedSeconds: 30,
    detectedAt: expiresAt - 30_000,
    expiresAt,
    lastSeenAt: expiresAt - 30_000,
    alertedAt: null,
    score: 0.98,
    ...patch,
  };
}

function makeProfile(alertLeadSeconds: number): Profile {
  return {
    ...createDefaultProfile(),
    skills: [],
    buffExpiryAlert: {
      ...createDefaultBuffExpiryAlert(),
      enabled: true,
      alertLeadSeconds,
    },
  };
}

function assignState<T>(
  ref: MutableRefObject<T>,
  next: SetStateAction<T>,
) {
  ref.current = typeof next === "function"
    ? (next as (previous: T) => T)(ref.current)
    : next;
}

function SchedulerHarness({
  profile,
  tracks,
  snapshotBoxes,
  boxPreviewUrls,
  journal,
  onReady,
}: {
  profile: Profile;
  track?: BuffExpiryTrackedBuff;
  tracks?: BuffExpiryTrackedBuff[];
  snapshotBoxes?: BuffExpirySnapshot["boxes"];
  boxPreviewUrls?: NonNullable<BuffExpirySnapshot["boxPreviewUrls"]>;
  journal?: AlertIncidentJournal;
  onReady: (api: HarnessApi) => void;
}) {
  const profileRef = useRef(profile);
  const runtimeTracks = tracks ?? [];
  const snapshotBoxList = snapshotBoxes ?? runtimeTracks.map((track) => track.box);
  const runtimeRef = useRef<BuffExpiryRuntimeState>({
    ...createBuffExpiryRuntimeState(),
    status: "tracking",
    tracks: runtimeTracks,
  });
  const snapshotRef = useRef<BuffExpirySnapshot | null>({
    sampledAt: runtimeTracks[0]?.detectedAt ?? Date.now(),
    roi: null,
    rawPreviewUrl: null,
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
    boxes: snapshotBoxList,
    boxPreviewUrls: boxPreviewUrls ?? Object.fromEntries(
      snapshotBoxList.map((box, index) => [
        `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`,
        `data:image/png;base64,track-${index}`,
      ]),
    ),
    acceptedMatches: [],
    rejectedMatches: [],
    tracks: runtimeTracks,
    pendingTracks: [],
    unsupportedReason: null,
    performance: null,
    alertDecisionHistory: [],
  });
  const lastAlertErrorRef = useRef<string | null>(null);
  const buffExpiryIncidentRecorderRef = useRef(
    createBuffExpiryIncidentRuntimeRecorder({ now: Date.now() }),
  );
  const setRuntimeRef = useRef<Dispatch<SetStateAction<BuffExpiryRuntimeState>>>(
    (next) => assignState(runtimeRef, next),
  );
  const setSnapshotRef = useRef<Dispatch<SetStateAction<BuffExpirySnapshot | null>>>(
    (next) => assignState(snapshotRef, next),
  );
  const scheduler = useBuffExpiryAlertScheduler({
    profileRef,
    buffExpiryRuntimeRef: runtimeRef,
    buffExpirySnapshotRef: snapshotRef,
    buffExpiryIncidentRecorderRef,
    lastAlertErrorRef,
    setBuffExpiryRuntime: setRuntimeRef.current,
    setBuffExpirySnapshot: setSnapshotRef.current,
    alertIncidentJournal: journal,
    onMessage: vi.fn(),
  });

  useEffect(() => {
    onReady({
      runtimeRef,
      snapshotRef,
      syncBuffExpiryAlertTimers: scheduler.syncBuffExpiryAlertTimers,
    });
  }, [onReady, scheduler.syncBuffExpiryAlertTimers]);

  return null;
}

describe("useBuffExpiryAlertScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));
    playAlertMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("plays a confirmed buff expiry alert at the scheduled due time without another sample", async () => {
    const now = Date.now();
    const track = makeTrack(now + 30_000);
    const journal = createAlertIncidentJournal();
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(10)}
        tracks={[track]}
        journal={journal}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBe(Date.now());
    expect(api.current?.snapshotRef.current?.tracks[0]?.alertedAt).toBe(Date.now());
    expect(api.current?.snapshotRef.current?.alertDecisionHistory).toHaveLength(1);
    const entries = journal.freeze({ feature: "buff-expiry" }, Date.now()).entries;
    expect(
      entries
        .filter((entry) => entry.kind === "lifecycle")
        .map((entry) => entry.decision),
    ).toEqual(["schedule-registered", "schedule-fired"]);
    expect(
      entries
        .filter((entry) => entry.kind === "playback")
        .map((entry) => entry.status),
    ).toEqual(["started"]);
  });

  it("cancels a scheduled precision alert when later samples no longer see the track", async () => {
    const now = Date.now();
    const track = makeTrack(now + 30_000);
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(10)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], Date.now());
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(playAlertMock).not.toHaveBeenCalled();
    expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBeNull();
  });

  it("clusters precision tracks that expire within 15 seconds into one alert", async () => {
    const now = Date.now();
    const firstTrack = makeTrack(now + 30_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      name: "유니온의 부",
    });
    const secondTrack = makeTrack(now + 40_000, {
      id: "next:potion:r0:c1",
      buffId: "next:potion",
      name: "비약",
      box: {
        x: 50,
        y: 20,
        width: 34,
        height: 34,
        side: 34,
        confidence: 0.99,
      },
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(10)}
        tracks={[firstTrack, secondTrack]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([firstTrack, secondTrack], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.tracks.map((track) => track.alertedAt)).toEqual([
      Date.now(),
      Date.now(),
    ]);
    expect(api.current?.snapshotRef.current?.alertDecisionHistory?.[0]).toMatchObject({
      shouldAlert: true,
      newAlertTrackIds: [firstTrack.id, secondTrack.id],
    });
    expect(api.current?.runtimeRef.current.lastAlertEvidence).toMatchObject({
      alertLeadSeconds: 10,
      triggeredTracks: [
        {
          id: firstTrack.id,
          buffId: firstTrack.buffId,
          name: firstTrack.name,
          remainingSeconds: 10,
          normalizedIconDataUrl: "data:image/png;base64,track-0",
        },
        {
          id: secondTrack.id,
          buffId: secondTrack.buffId,
          name: secondTrack.name,
          remainingSeconds: 20,
          normalizedIconDataUrl: "data:image/png;base64,track-1",
        },
      ],
    });
    expect(api.current?.snapshotRef.current?.lastAlertEvidence).toEqual(
      api.current?.runtimeRef.current.lastAlertEvidence,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(playAlertMock).toHaveBeenCalledTimes(1);
  });

  it("clamps precision scheduled alerts to the 20 second lead range", async () => {
    const now = Date.now();
    const track = makeTrack(now + 30_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      name: "유니온의 부",
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(30)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.lastAlertEvidence).toMatchObject({
      alertLeadSeconds: 20,
    });
  });

  it("schedules precision alerts after expiry when alert lead is negative", async () => {
    const now = Date.now();
    const track = makeTrack(now + 3_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      name: "유니온의 부",
      detectedAt: now,
      lastSeenAt: now,
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(-2)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.lastAlertEvidence).toMatchObject({
      alertLeadSeconds: -2,
      triggeredTracks: [
        {
          id: track.id,
          remainingSeconds: 0,
        },
      ],
    });
  });

  it("keeps a post-expiry precision alert scheduled when later samples no longer see the icon", async () => {
    const now = Date.now();
    const track = makeTrack(now + 9_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      name: "유니온의 부",
      detectedAt: now,
      lastSeenAt: now,
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(-3)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_500);
    });
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now + 9_500);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499);
    });
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.lastAlertedAt).toBe(now + 12_000);
  });

  it("uses the nearest snapshot preview when precision alert evidence has a stale box key", async () => {
    const now = Date.now();
    const track = makeTrack(now + 30_000, {
      id: "next:unionWealth:r3:c11",
      buffId: "next:unionWealth",
      name: "유니온의 부",
      box: {
        x: 1279,
        y: 147,
        width: 32,
        height: 32,
        side: 32,
        row: 3,
        col: 11,
        confidence: 0.99,
      },
    });
    const snapshotBox = {
      ...track.box,
      x: 1280,
    };
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(10)}
        tracks={[track]}
        snapshotBoxes={[snapshotBox]}
        boxPreviewUrls={{
          "1280:147:32:32": "data:image/png;base64,same-slot",
        }}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(api.current?.runtimeRef.current.lastAlertEvidence?.triggeredTracks[0]).toMatchObject({
      id: track.id,
      normalizedIconDataUrl: "data:image/png;base64,same-slot",
    });
  });

  it("keeps precision tracks separate when expiry times are more than 15 seconds apart", async () => {
    const now = Date.now();
    const firstTrack = makeTrack(now + 30_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      name: "유니온의 부",
    });
    const secondTrack = makeTrack(now + 50_000, {
      id: "next:potion:r0:c1",
      buffId: "next:potion",
      name: "비약",
      box: {
        x: 50,
        y: 20,
        width: 34,
        height: 34,
        side: 34,
        confidence: 0.99,
      },
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(10)}
        tracks={[firstTrack, secondTrack]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([firstTrack, secondTrack], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBe(Date.now());
    expect(api.current?.runtimeRef.current.tracks[1]?.alertedAt).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(2);
    expect(api.current?.runtimeRef.current.tracks[1]?.alertedAt).toBe(Date.now());
  });

  it("keeps precision tracks in separate alert clusters when expiry times are far apart", async () => {
    const now = Date.now();
    const firstTrack = makeTrack(now + 30_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      name: "유니온의 부",
    });
    const secondTrack = makeTrack(now + 70_000, {
      id: "next:potion:r0:c1",
      buffId: "next:potion",
      name: "비약",
      box: {
        x: 50,
        y: 20,
        width: 34,
        height: 34,
        side: 34,
        confidence: 0.99,
      },
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(10)}
        tracks={[firstTrack, secondTrack]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([firstTrack, secondTrack], now);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBe(Date.now());
    expect(api.current?.runtimeRef.current.tracks[1]?.alertedAt).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(playAlertMock).toHaveBeenCalledTimes(2);
    expect(api.current?.runtimeRef.current.tracks[1]?.alertedAt).toBe(Date.now());
  });

  it.each([500, 1_000, 1_499])(
    "keeps the canonical %i ms warm wait in timer and playback order",
    async (scheduledWaitMs) => {
      const now = Date.now();
      const track = makeTrack(now + 20_000 + scheduledWaitMs, {
        id: "next:unionWealth:r0:c0",
        buffId: "next:unionWealth",
        detectedAt: now,
        lastSeenAt: now,
      });
      const warm = createWarmTraceCandidate({
        trackId: track.id,
        sampledAtMs: now,
        dueAtMs: now + scheduledWaitMs,
      });
      const api: { current: HarnessApi | null } = { current: null };
      let resolvePlayback!: () => void;
      const playbackPromise = new Promise<void>((resolve) => {
        resolvePlayback = resolve;
      });
      playAlertMock.mockReturnValueOnce(playbackPromise);

      render(
        <SchedulerHarness
          profile={makeProfile(20)}
          tracks={[track]}
          onReady={(next) => {
            api.current = next;
          }}
        />,
      );
      const setTimeoutSpy = vi.spyOn(window, "setTimeout");

      act(() => {
        api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
      });

      const prepareMock = vi.mocked(
        warm.schedulerPort.prepareBuffExpiryPlannedWait,
      );
      const commitMock = vi.mocked(
        warm.schedulerPort.commitBuffExpiryPlannedWait,
      );
      const resumeMock = vi.mocked(
        warm.schedulerPort.resumeBuffExpiryPlannedWait,
      );
      const completeMock = vi.mocked(
        warm.schedulerPort.completeBuffExpiryPlannedWait,
      );
      expect(prepareMock).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        scheduledWaitMs,
      );
      expect(commitMock).toHaveBeenCalledTimes(1);
      expect(prepareMock.mock.invocationCallOrder[0]).toBeLessThan(
        setTimeoutSpy.mock.invocationCallOrder[0]!,
      );
      expect(setTimeoutSpy.mock.invocationCallOrder[0]).toBeLessThan(
        commitMock.mock.invocationCallOrder[0]!,
      );
      expect(warm.events).toEqual(["prepare", "commit"]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(scheduledWaitMs);
      });

      expect(resumeMock).toHaveBeenCalledTimes(1);
      expect(playAlertMock).toHaveBeenCalledTimes(1);
      expect(resumeMock.mock.invocationCallOrder[0]).toBeLessThan(
        playAlertMock.mock.invocationCallOrder[0]!,
      );
      expect(completeMock).not.toHaveBeenCalled();
      expect(warm.events).toEqual(["prepare", "commit", "resume"]);

      await act(async () => {
        resolvePlayback();
        await playbackPromise;
      });

      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(playAlertMock.mock.invocationCallOrder[0]).toBeLessThan(
        completeMock.mock.invocationCallOrder[0]!,
      );
      expect(warm.events).toEqual([
        "prepare",
        "commit",
        "resume",
        "complete",
      ]);
      expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBe(
        now + scheduledWaitMs,
      );
    },
  );

  it("fails the warm trace when product playback rejects and preserves the product failure", async () => {
    const now = Date.now();
    const track = makeTrack(now + 21_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      detectedAt: now,
      lastSeenAt: now,
    });
    const warm = createWarmTraceCandidate({
      trackId: track.id,
      sampledAtMs: now,
      dueAtMs: now + 1_000,
    });
    const api: { current: HarnessApi | null } = { current: null };
    let rejectPlayback!: (reason: Error) => void;
    const playbackPromise = new Promise<void>((_resolve, reject) => {
      rejectPlayback = reject;
    });
    playAlertMock.mockReturnValueOnce(playbackPromise);

    render(
      <SchedulerHarness
        profile={makeProfile(20)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(playAlertMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectPlayback(new Error("playback-rejected"));
      await playbackPromise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(
      warm.schedulerPort.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(expect.any(Object), "failed");
    expect(
      warm.schedulerPort.completeBuffExpiryPlannedWait,
    ).not.toHaveBeenCalled();
    expect(api.current?.runtimeRef.current.lastAlertPlayback).toMatchObject({
      status: "failed",
      error: "playback-rejected",
    });
  });

  it("replaces a same-key warm cycle, leaves its stale callback inert, and keeps the new product timer", async () => {
    const now = Date.now();
    const track = makeTrack(now + 21_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      detectedAt: now,
      lastSeenAt: now,
    });
    const replacementTrack = {
      ...track,
      expiresAt: track.expiresAt + 100,
    };
    const warm = createWarmTraceCandidate({
      trackId: track.id,
      sampledAtMs: now,
      dueAtMs: now + 1_000,
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(20)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
    });
    const staleCallback = setTimeoutSpy.mock.calls[0]?.[0];

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([replacementTrack], now);
    });

    expect(
      warm.schedulerPort.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(expect.any(Object), "replaced");
    expect(staleCallback).toBeTypeOf("function");
    act(() => {
      if (typeof staleCallback === "function") {
        staleCallback();
      }
    });
    expect(
      warm.schedulerPort.resumeBuffExpiryPlannedWait,
    ).not.toHaveBeenCalled();
    expect(playAlertMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBe(
      now + 1_100,
    );
  });

  it("suppresses a resumed warm trace when due revalidation no longer finds its track", async () => {
    const now = Date.now();
    const track = makeTrack(now + 21_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      detectedAt: now,
      lastSeenAt: now,
    });
    const warm = createWarmTraceCandidate({
      trackId: track.id,
      sampledAtMs: now,
      dueAtMs: now + 1_000,
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(20)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
      api.current!.runtimeRef.current = {
        ...api.current!.runtimeRef.current,
        tracks: [],
      };
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(
      warm.schedulerPort.resumeBuffExpiryPlannedWait,
    ).toHaveBeenCalledTimes(1);
    expect(
      warm.schedulerPort.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(expect.any(Object), "suppressed");
    expect(
      warm.schedulerPort.completeBuffExpiryPlannedWait,
    ).not.toHaveBeenCalled();
    expect(playAlertMock).not.toHaveBeenCalled();
  });

  it("cancels in-flight warm playback on unmount and ignores its later resolution", async () => {
    const now = Date.now();
    const track = makeTrack(now + 21_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      detectedAt: now,
      lastSeenAt: now,
    });
    const warm = createWarmTraceCandidate({
      trackId: track.id,
      sampledAtMs: now,
      dueAtMs: now + 1_000,
    });
    const api: { current: HarnessApi | null } = { current: null };
    let resolvePlayback!: () => void;
    const playbackPromise = new Promise<void>((resolve) => {
      resolvePlayback = resolve;
    });
    playAlertMock.mockReturnValueOnce(playbackPromise);
    const view = render(
      <SchedulerHarness
        profile={makeProfile(20)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(
      warm.schedulerPort.resumeBuffExpiryPlannedWait,
    ).toHaveBeenCalledTimes(1);

    act(() => {
      view.unmount();
    });
    expect(
      warm.schedulerPort.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(expect.any(Object), "cancelled");

    await act(async () => {
      resolvePlayback();
      await playbackPromise;
      await Promise.resolve();
    });

    expect(
      warm.schedulerPort.completeBuffExpiryPlannedWait,
    ).not.toHaveBeenCalled();
    expect(
      warm.schedulerPort.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledTimes(1);
  });

  it("suppresses a warm wait removed by a later track sample and leaves its stale callback inert", async () => {
    const now = Date.now();
    const track = makeTrack(now + 21_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      detectedAt: now,
      lastSeenAt: now,
    });
    const warm = createWarmTraceCandidate({
      trackId: track.id,
      sampledAtMs: now,
      dueAtMs: now + 1_000,
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(20)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
    });
    const staleCallback = setTimeoutSpy.mock.calls[0]?.[0];

    act(() => {
      api.current!.syncBuffExpiryAlertTimers([], now);
    });

    expect(
      warm.schedulerPort.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(expect.any(Object), "suppressed");
    expect(staleCallback).toBeTypeOf("function");
    act(() => {
      if (typeof staleCallback === "function") {
        staleCallback();
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(
      warm.schedulerPort.resumeBuffExpiryPlannedWait,
    ).not.toHaveBeenCalled();
    expect(playAlertMock).not.toHaveBeenCalled();
  });

  it("cancels a warm wait on unmount and leaves its stale callback inert", async () => {
    const now = Date.now();
    const track = makeTrack(now + 21_000, {
      id: "next:unionWealth:r0:c0",
      buffId: "next:unionWealth",
      detectedAt: now,
      lastSeenAt: now,
    });
    const warm = createWarmTraceCandidate({
      trackId: track.id,
      sampledAtMs: now,
      dueAtMs: now + 1_000,
    });
    const api: { current: HarnessApi | null } = { current: null };
    const view = render(
      <SchedulerHarness
        profile={makeProfile(20)}
        tracks={[track]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
    });
    const staleCallback = setTimeoutSpy.mock.calls[0]?.[0];

    act(() => {
      view.unmount();
    });

    expect(
      warm.schedulerPort.terminateBuffExpiryPlannedWait,
    ).toHaveBeenCalledWith(expect.any(Object), "cancelled");
    expect(staleCallback).toBeTypeOf("function");
    act(() => {
      if (typeof staleCallback === "function") {
        staleCallback();
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(
      warm.schedulerPort.resumeBuffExpiryPlannedWait,
    ).not.toHaveBeenCalled();
    expect(playAlertMock).not.toHaveBeenCalled();
  });

  it.each([
    "prepare-throw",
    "prepare-null",
    "commit-throw",
    "commit-null",
    "resume-throw",
    "resume-null",
    "complete-throw",
    "complete-null",
  ] as const)(
    "keeps the product timer and playback intact when the warm %s port fails",
    async (fault) => {
      const now = Date.now();
      const track = makeTrack(now + 21_000, {
        id: "next:unionWealth:r0:c0",
        buffId: "next:unionWealth",
        detectedAt: now,
        lastSeenAt: now,
      });
      const warm = createWarmTraceCandidate({
        trackId: track.id,
        sampledAtMs: now,
        dueAtMs: now + 1_000,
        fault,
      });
      const api: { current: HarnessApi | null } = { current: null };

      render(
        <SchedulerHarness
          profile={makeProfile(20)}
          tracks={[track]}
          onReady={(next) => {
            api.current = next;
          }}
        />,
      );
      act(() => {
        api.current!.syncBuffExpiryAlertTimers([track], now, warm.candidate);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(playAlertMock).toHaveBeenCalledTimes(1);
      expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBe(
        now + 1_000,
      );
    },
  );

  it("suppresses a warm candidate for another track without suppressing the product alert", async () => {
    const now = Date.now();
    const dueTrack = makeTrack(now + 21_000, {
      id: "next:unionWealth:r0:c1",
      buffId: "next:unionWealth",
      detectedAt: now,
      lastSeenAt: now,
    });
    const warm = createWarmTraceCandidate({
      trackId: "next:unionWealth:r0:c0",
      sampledAtMs: now,
      dueAtMs: now + 1_000,
    });
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <SchedulerHarness
        profile={makeProfile(20)}
        tracks={[dueTrack]}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );
    act(() => {
      api.current!.syncBuffExpiryAlertTimers([dueTrack], now, warm.candidate);
    });

    expect(warm.featurePort.terminateFeatureStage).toHaveBeenCalledWith(
      warm.candidate.claim,
      "scheduleUs",
      "suppressed",
    );
    expect(
      warm.schedulerPort.prepareBuffExpiryPlannedWait,
    ).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(playAlertMock).toHaveBeenCalledTimes(1);
    expect(api.current?.runtimeRef.current.tracks[0]?.alertedAt).toBe(
      now + 1_000,
    );
  });
});
