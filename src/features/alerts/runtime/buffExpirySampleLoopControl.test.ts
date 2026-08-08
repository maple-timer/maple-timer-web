import { describe, expect, it } from "vitest";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import { createDefaultBuffExpiryAlert } from "../../../lib/storage";
import { createDefaultProfile } from "../../../lib/profileFactory";
import type { Profile } from "../../../types";
import { createMonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import {
  BUFF_EXPIRY_PREVIEW_INTERVAL_MS,
  getBuffExpirySampleLoopControl,
} from "./buffExpirySampleLoopControl";

describe("getBuffExpirySampleLoopControl", () => {
  it("publishes paused state and releases the precision engine when disabled", () => {
    const control = getBuffExpirySampleLoopControl({
      profile: createProfile({
        buffExpiryAlert: {
          ...createDefaultBuffExpiryAlert(),
          enabled: false,
        },
      }),
      stream: {} as MediaStream,
      context: createFrameContext(12_000),
      currentState: createBuffExpiryRuntimeState(),
      sampledAt: 12_000,
      showDebugColumns: true,
      lastPreviewAt: 0,
    });

    expect(control).toMatchObject({
      kind: "skip",
      resetEngineState: true,
      resetPrecisionEngine: true,
      state: {
        status: "paused",
        lastSampledAt: 12_000,
      },
    });
  });

  it("publishes no-stream state and releases the precision engine", () => {
    const control = getBuffExpirySampleLoopControl({
      profile: createProfile({
        buffExpiryAlert: {
          ...createDefaultBuffExpiryAlert(),
          enabled: true,
        },
      }),
      stream: null,
      context: createFrameContext(14_000),
      currentState: createBuffExpiryRuntimeState(),
      sampledAt: 14_000,
      showDebugColumns: false,
      lastPreviewAt: 0,
    });

    expect(control).toMatchObject({
      kind: "skip",
      resetEngineState: true,
      resetPrecisionEngine: true,
      state: {
        status: "no-stream",
        lastSampledAt: 14_000,
      },
    });
  });

  it("updates no-stream status without resetting engine state when the frame is unavailable", () => {
    const currentState = {
      ...createBuffExpiryRuntimeState(),
      status: "tracking" as const,
      boxCount: 3,
    };
    const control = getBuffExpirySampleLoopControl({
      profile: createProfile({
        buffExpiryAlert: {
          ...createDefaultBuffExpiryAlert(),
          enabled: true,
        },
      }),
      stream: {} as MediaStream,
      context: null,
      currentState,
      sampledAt: 15_000,
      showDebugColumns: true,
      lastPreviewAt: 0,
    });

    expect(control).toMatchObject({
      kind: "skip",
      resetEngineState: false,
      resetPrecisionEngine: false,
      state: {
        status: "no-stream",
        boxCount: 3,
        lastSampledAt: 15_000,
      },
      snapshot: null,
    });
  });

  it("routes ready samples to the precision engine and gates debug preview by interval", () => {
    const frameContext = createFrameContext(10_000);
    const included = getBuffExpirySampleLoopControl({
      profile: createProfile({
        buffExpiryAlert: {
          ...createDefaultBuffExpiryAlert(),
          enabled: true,
        },
      }),
      stream: {} as MediaStream,
      context: frameContext,
      currentState: createBuffExpiryRuntimeState(),
      sampledAt: 10_000,
      showDebugColumns: true,
      lastPreviewAt: 10_000 - BUFF_EXPIRY_PREVIEW_INTERVAL_MS,
    });
    const throttled = getBuffExpirySampleLoopControl({
      profile: createProfile({
        buffExpiryAlert: {
          ...createDefaultBuffExpiryAlert(),
          enabled: true,
        },
      }),
      stream: {} as MediaStream,
      context: createFrameContext(10_000),
      currentState: createBuffExpiryRuntimeState(),
      sampledAt: 10_000,
      showDebugColumns: true,
      lastPreviewAt: 10_000 - BUFF_EXPIRY_PREVIEW_INTERVAL_MS + 1,
    });

    expect(included).toMatchObject({
      kind: "ready",
      shouldIncludeDebugPreview: true,
    });
    expect(included.kind === "ready" ? included.context : null).toBe(frameContext);
    expect(throttled).toMatchObject({
      kind: "ready",
      shouldIncludeDebugPreview: false,
    });
  });
});

function createProfile(partial: Partial<Profile> = {}): Profile {
  return {
    ...createDefaultProfile(),
    ...partial,
  };
}

function createReadyVideo(): HTMLVideoElement {
  return createVideo({
    readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    videoWidth: 1280,
    videoHeight: 720,
  });
}

function createFrameContext(sampledAt: number) {
  return createMonitoringFrameContext({
    sampledAt,
    video: createReadyVideo(),
    masterVolume: 1,
  });
}

function createVideo({
  readyState,
  videoWidth,
  videoHeight,
}: {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
}): HTMLVideoElement {
  return {
    readyState,
    videoWidth,
    videoHeight,
  } as HTMLVideoElement;
}
