import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultHuntStallAlert } from "../../../lib/storage";
import {
  MonitoringHarness,
  captureManualExperienceCropFromVideoMock,
  cleanupMonitoringLoopTestHarness,
  createProfile,
  createTestImageData,
  resetMonitoringLoopTestMocks,
  sampleSkillMock,
  type HarnessApi,
} from "./useMonitoringLoopTestHarness";

describe("useMonitoringLoop hunt stall frame binding", () => {
  beforeEach(() => {
    resetMonitoringLoopTestMocks();
  });

  afterEach(() => {
    cleanupMonitoringLoopTestHarness();
  });

  it("samples manual experience from the video owned by the bound frame context", async () => {
    const region = { x: 0.33, y: 0.96, width: 0.34, height: 0.01 };
    const api: { current: HarnessApi | null } = { current: null };

    render(
      <MonitoringHarness
        profile={createProfile({
          huntStallAlert: {
            ...createDefaultHuntStallAlert(),
            enabled: true,
            mode: "manual-experience",
            manualExperienceRegion: region,
          },
        })}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(captureManualExperienceCropFromVideoMock).toHaveBeenCalledTimes(1);
    expect(captureManualExperienceCropFromVideoMock).toHaveBeenCalledWith({
      video: expect.any(HTMLVideoElement),
      region,
      includePreview: true,
    });
    expect(sampleSkillMock).not.toHaveBeenCalled();
    const archive = api.current?.huntStallIncidentRecorderRef.current.archive;
    expect(archive?.frames).toHaveLength(1);
    expect(archive?.frames[0]).toMatchObject({
      mode: "manual-experience",
      layoutKey: "1280x720",
      sourceDimensions: { width: 1280, height: 720 },
      region: { x: 0, y: 0, width: 4, height: 4 },
      source: "runtime",
    });
    expect(archive?.observations[0]?.recognition).toMatchObject({
      decision: "accepted",
      rawText: "12.345%",
      fingerprint: "hunt-fingerprint",
    });
    expect(archive?.media[0]).toMatchObject({
      frameId: archive?.frames[0]?.id,
      reason: "current",
      rawDataUrl: "data:image/png;base64,hunt-raw",
    });
  });

  it("samples cooldown presence through the skill sampler on the bound frame context", async () => {
    const region = { x: 0.1, y: 0.2, width: 0.03, height: 0.04 };
    const sampledImageData = createTestImageData();
    const api: { current: HarnessApi | null } = { current: null };
    sampleSkillMock.mockReturnValue({
      imageData: sampledImageData,
      rawImageData: sampledImageData,
      rawPreviewUrl: "data:image/png;base64,cooldown-raw",
      previewUrl: "data:image/png;base64,cooldown-processed",
      region: { x: 128, y: 144, width: 32, height: 32 },
    });

    render(
      <MonitoringHarness
        profile={createProfile({
          huntStallAlert: {
            ...createDefaultHuntStallAlert(),
            enabled: true,
            mode: "cooldown-presence",
            cooldownRegion: region,
          },
        })}
        stream={{} as MediaStream}
        onReady={(next) => {
          api.current = next;
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sampleSkillMock).toHaveBeenCalledTimes(1);
    expect(sampleSkillMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      region,
      true,
    );
    expect(captureManualExperienceCropFromVideoMock).not.toHaveBeenCalled();
    const archive = api.current?.huntStallIncidentRecorderRef.current.archive;
    expect(archive?.frames).toHaveLength(1);
    expect(archive?.frames[0]).toMatchObject({
      mode: "cooldown-presence",
      layoutKey: "1280x720",
      sourceDimensions: { width: 1280, height: 720 },
      region: { x: 128, y: 144, width: 32, height: 32 },
      source: "runtime",
    });
    expect(archive?.observations[0]?.recognition).toMatchObject({
      decision: "missing",
      readableStreak: 0,
    });
  });
});
