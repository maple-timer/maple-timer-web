import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuneRuntimeState, RuneSnapshot } from "../../alertTypes";
import { createRuneRuntimeState } from "../../lib/runeAlert";
import { createDefaultProfile } from "../../lib/storage";
import type { Profile } from "../../types";
import { useRuneAlertReports } from "./useRuneAlertReports";

const mocks = vi.hoisted(() => ({
  buildRuneIssueReportPayload: vi.fn((input) => input),
  buildRuneDebugReportPayload: vi.fn((input) => input),
  postDebugSample: vi.fn(),
  createRuneIssueReportSnapshot: vi.fn(),
}));

vi.mock("./alertReportPayloads", () => ({
  buildRuneIssueReportPayload: mocks.buildRuneIssueReportPayload,
  buildRuneDebugReportPayload: mocks.buildRuneDebugReportPayload,
}));

vi.mock("./reportClient", () => ({
  formatReportSuccessMessage: vi.fn(),
  getOrCreateReportClientId: () => "client-1",
  postDebugSample: mocks.postDebugSample,
}));

vi.mock("./reportDiagnostics", () => ({
  getCaptureDiagnostics: () => ({
    hasStream: true,
    size: { width: 1920, height: 1080 },
    layoutKey: "1920x1080",
  }),
  getVideoLayoutKey: () => "1920x1080",
  getViewportDiagnostics: () => ({
    userAgent: "vitest",
    viewport: { width: 1920, height: 1080 },
  }),
}));

vi.mock("./runeReportSnapshot", () => ({
  createRuneIssueReportSnapshot: mocks.createRuneIssueReportSnapshot,
  createRuneReportFrameSample: vi.fn(),
}));

type HookApi = ReturnType<typeof useRuneAlertReports>;

describe("useRuneAlertReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses report-open evidence after a later episode and a failed submit", async () => {
    const profile = createEnabledProfile(0.4);
    const runtime = createRuntime(1, 1_000);
    const snapshot = createSnapshot(1_000);
    const reportFrame = createSnapshot(9_000);
    mocks.createRuneIssueReportSnapshot.mockResolvedValue(reportFrame);
    mocks.postDebugSample
      .mockRejectedValueOnce(new Error("temporary-network-error"))
      .mockResolvedValueOnce({ ok: true });
    const refs: {
      profile: { current: Profile };
      runtime: { current: RuneRuntimeState };
      snapshot: { current: RuneSnapshot | null };
    } = {
      profile: { current: profile },
      runtime: { current: runtime },
      snapshot: { current: snapshot },
    };
    let api: HookApi | null = null;

    render(
      <Harness
        refs={refs}
        onReady={(next) => {
          api = next;
        }}
      />,
    );

    act(() => {
      api!.freezeRuneIssueReportEvidence(1_100);
      refs.runtime.current = createRuntime(2, 5_000);
      refs.snapshot.current = createSnapshot(5_000);
      refs.profile.current = createEnabledProfile(0.9);
    });

    await act(async () => {
      expect(
        await api!.submitRuneIssueReport({
          reason: "rune-missed",
          label: "룬이 떴는데 감지가 안돼요",
          scenario: "recognized-no-alert",
          occurrence: "recent",
        }),
      ).toBe(false);
    });
    refs.runtime.current = createRuntime(3, 8_000);
    refs.snapshot.current = createSnapshot(8_000);
    await act(async () => {
      expect(
        await api!.submitRuneIssueReport({
          reason: "rune-missed",
          label: "룬이 떴는데 감지가 안돼요",
          scenario: "recognized-no-alert",
          occurrence: "recent",
        }),
      ).toBe(true);
    });

    expect(mocks.buildRuneIssueReportPayload).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.buildRuneIssueReportPayload.mock.calls) {
      expect(input).toMatchObject({
        snapshot: { sampledAt: 9_000 },
        lastAlertSnapshot: { sampledAt: 1_000 },
        runeConfig: { volume: 0.4 },
        currentRegion: { x: 0.1 },
        runeState: { sceneEpoch: 1, firstDetectedAt: 1_000 },
      });
    }
    expect(mocks.createRuneIssueReportSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        region: expect.objectContaining({ x: 0.1 }),
      }),
    );
    expect(refs.snapshot.current?.sampledAt).toBe(8_000);
  });
});

function Harness({
  refs,
  onReady,
}: {
  refs: {
    profile: { current: Profile };
    runtime: { current: RuneRuntimeState };
    snapshot: { current: RuneSnapshot | null };
  };
  onReady: (api: HookApi) => void;
}) {
  const videoRef = useRef({
    videoWidth: 1920,
    videoHeight: 1080,
    readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
  } as HTMLVideoElement);
  const api = useRuneAlertReports({
    videoRef,
    profileRef: refs.profile,
    runeRuntimeRef: refs.runtime,
    runeSnapshotRef: refs.snapshot,
    currentLayoutKey: "1920x1080",
    onMessage: vi.fn(),
  });
  useEffect(() => onReady(api), [api, onReady]);
  return null;
}

function createEnabledProfile(volume: number): Profile {
  const profile = createDefaultProfile();
  return {
    ...profile,
    runeAlert: {
      ...profile.runeAlert!,
      enabled: true,
      volume,
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      regionsByLayout: {
        "1920x1080": { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
    },
  };
}

function createRuntime(sceneEpoch: number, firstDetectedAt: number): RuneRuntimeState {
  return {
    ...createRuneRuntimeState(),
    status: "candidate",
    sceneEpoch,
    firstDetectedAt,
    lastDetectedAt: firstDetectedAt,
  };
}

function createSnapshot(sampledAt: number): RuneSnapshot {
  return {
    sampledAt,
    rawPreviewUrl: `data:image/png;base64,raw-${sampledAt}`,
    maskPreviewUrl: `data:image/png;base64,mask-${sampledAt}`,
    candidatePreviewUrl: null,
    candidateRawPreviewUrl: null,
    candidateMaskPreviewUrl: null,
    candidateRegionLabel: null,
    candidateSampledAt: null,
    candidate: null,
    detected: true,
    confidence: 0.9,
    candidateCount: 1,
  };
}
