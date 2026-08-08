import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedMonitoringRemoteRecognitionFrameProbeSource } from "./remoteRecognitionFrameProbeSource";

describe("SharedMonitoringRemoteRecognitionFrameProbeSource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lazily crops the shared monitoring plane without rereading video", async () => {
    const source = new SharedMonitoringRemoteRecognitionFrameProbeSource({
      monotonicNow: vi
        .fn()
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(14)
        .mockReturnValueOnce(23),
    });
    const capture = vi.fn(() => ({
      imageData: createImageData(4, 4),
      roi: { x: 2, y: 0, width: 2, height: 2 },
    }));

    source.offerFrame({ sampledAt: 1_785_600_000_000, capture });
    expect(capture).not.toHaveBeenCalled();

    const pending = source.captureFrame(1);
    source.offerFrame({ sampledAt: 1_785_600_001_000, capture });
    const result = await pending;
    expect(capture).toHaveBeenCalledOnce();
    expect(result.frame).toMatchObject({
      sequence: 1,
      sampledAt: 1_785_600_001_000,
      width: 2,
      height: 2,
    });
    expect(result.timings).toEqual({ captureMs: 4, compressionMs: 9 });

    const decoded = new Uint8Array(
      await new Response(
        new Response(result.frame.encodedRgba).body!.pipeThrough(
          new DecompressionStream("gzip"),
        ),
      ).arrayBuffer(),
    );
    expect([...decoded]).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15,
      24, 25, 26, 27, 28, 29, 30, 31,
    ]);
  });

  it("requires a distinct shared tick for every readiness frame", async () => {
    const source = new SharedMonitoringRemoteRecognitionFrameProbeSource();
    const first = source.captureFrame(1);
    source.offerFrame({ sampledAt: 1_000, capture: () => sample() });
    await expect(first).resolves.toMatchObject({
      frame: { sampledAt: 1_000, sequence: 1 },
    });

    const second = source.captureFrame(2);
    let settled = false;
    void second.finally(() => {
      settled = true;
    });
    source.offerFrame({ sampledAt: 1_000, capture: () => sample() });
    await Promise.resolve();
    expect(settled).toBe(false);

    source.offerFrame({ sampledAt: 2_000, capture: () => sample() });
    await expect(second).resolves.toMatchObject({
      frame: { sampledAt: 2_000, sequence: 2 },
    });
  });

  it("does not sample pixels after a pending request is cancelled", async () => {
    const source = new SharedMonitoringRemoteRecognitionFrameProbeSource();
    const abortController = new AbortController();
    const pending = source.captureFrame(1, { signal: abortController.signal });
    abortController.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const capture = vi.fn(() => sample());
    source.offerFrame({ sampledAt: 1_000, capture });
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not return an offered frame after cancellation during encoding", async () => {
    const source = new SharedMonitoringRemoteRecognitionFrameProbeSource();
    const abortController = new AbortController();
    const pending = source.captureFrame(1, { signal: abortController.signal });
    const capture = vi.fn(() => sample());

    source.offerFrame({ sampledAt: 1_000, capture });
    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(capture).toHaveBeenCalledOnce();
  });

  it("fails a readiness request when no shared monitoring tick arrives", async () => {
    vi.useFakeTimers();
    const source = new SharedMonitoringRemoteRecognitionFrameProbeSource();
    const pending = source.captureFrame(1);
    const rejection = expect(pending).rejects.toMatchObject({
      code: "video-not-ready",
      message: "remote-recognition-shared-frame-timeout",
    });

    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });
});

function sample() {
  return {
    imageData: createImageData(2, 2),
    roi: { x: 1, y: 0, width: 1, height: 1 },
  };
}

function createImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = index;
  }
  return { width, height, data } as ImageData;
}
