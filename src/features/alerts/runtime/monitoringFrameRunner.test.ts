import { describe, expect, it, vi } from "vitest";
import { createMonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import { runSkillRuneMonitoringFrame } from "./monitoringFrameRunner";

describe("runSkillRuneMonitoringFrame", () => {
  it("does nothing when the scheduler tick has no ready frame context", () => {
    const handleMetadata = vi.fn();
    const processSkillFrame = vi.fn();
    const processRuneFrame = vi.fn();

    const didRun = runSkillRuneMonitoringFrame({
      context: null,
      handleMetadata,
      processSkillFrame,
      processRuneFrame,
    });

    expect(didRun).toBe(false);
    expect(handleMetadata).not.toHaveBeenCalled();
    expect(processSkillFrame).not.toHaveBeenCalled();
    expect(processRuneFrame).not.toHaveBeenCalled();
  });

  it("creates one shared frame context for skill and rune processing", () => {
    const video = createVideo({
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1280,
      videoHeight: 720,
    });
    const handleMetadata = vi.fn();
    const processSkillFrame = vi.fn();
    const processRuneFrame = vi.fn();

    const didRun = runSkillRuneMonitoringFrame({
      context: createMonitoringFrameContext({
        sampledAt: 2_000,
        video,
        masterVolume: 82,
      }),
      handleMetadata,
      processSkillFrame,
      processRuneFrame,
    });

    expect(didRun).toBe(true);
    expect(handleMetadata).toHaveBeenCalledTimes(1);
    expect(processSkillFrame).toHaveBeenCalledTimes(1);
    expect(processRuneFrame).toHaveBeenCalledTimes(1);
    const skillContext = processSkillFrame.mock.calls[0][0].context;
    const runeContext = processRuneFrame.mock.calls[0][0].context;
    expect(runeContext).toBe(skillContext);
    expect(skillContext).toMatchObject({
      sampledAt: 2_000,
      video,
      masterVolume: 82,
    });
    expect(skillContext.sampleSkill).toEqual(expect.any(Function));
    expect(skillContext.sampleVideoRegion).toEqual(expect.any(Function));
    expect(skillContext.sampleBuffSlotFrame).toEqual(expect.any(Function));
  });

  it("waits for asynchronous skill processing before completing the frame", async () => {
    const video = createVideo({
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1280,
      videoHeight: 720,
    });
    const handleMetadata = vi.fn();
    let resolveSkillFrame = () => {};
    const processSkillFrame = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSkillFrame = resolve;
        }),
    );
    const processRuneFrame = vi.fn();
    let settled = false;

    const didRun = runSkillRuneMonitoringFrame({
      context: createMonitoringFrameContext({
        sampledAt: 3_000,
        video,
        masterVolume: 100,
      }),
      handleMetadata,
      processSkillFrame,
      processRuneFrame,
    });

    expect(didRun).toEqual(expect.any(Promise));
    void (didRun as Promise<boolean>).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(processRuneFrame).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveSkillFrame();
    await expect(didRun).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it("keeps rune processing active while the game viewport is unavailable", () => {
    const video = createVideo({
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
      videoWidth: 1766,
      videoHeight: 968,
    });
    const handleMetadata = vi.fn();
    const processSkillFrame = vi.fn();
    const processRuneFrame = vi.fn();

    const didRun = runSkillRuneMonitoringFrame({
      context: createMonitoringFrameContext({
        sampledAt: 4_000,
        video,
        masterVolume: 100,
        gameViewport: null,
      }),
      handleMetadata,
      processSkillFrame,
      processRuneFrame,
    });

    expect(didRun).toBe(true);
    expect(handleMetadata).toHaveBeenCalledTimes(1);
    expect(processSkillFrame).not.toHaveBeenCalled();
    expect(processRuneFrame).toHaveBeenCalledTimes(1);
  });
});

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
