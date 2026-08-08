import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampVolume,
  playAudioBufferSegment,
  playAudioSourceSegment,
  preloadAudioBufferSource,
} from "./audioPlayback";

class FakeAudio {
  static instances: FakeAudio[] = [];

  src: string;
  volume = 1;
  currentTime = 0;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  listeners = new Map<string, Array<() => void>>();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((item) => item !== listener),
    );
  }
}

describe("audioPlayback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeAudio.instances = [];
  });

  it("clamps invalid and out-of-range volume values", () => {
    expect(clampVolume(0.45)).toBe(0.45);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(2);
    expect(clampVolume(3)).toBe(2);
    expect(clampVolume(Number.NaN)).toBe(1);
  });

  it("stops segment playback when its signal is aborted", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const controller = new AbortController();
    const onRelease = vi.fn();

    await playAudioSourceSegment("/sounds/test.m4a", 1, {
      endTimeSeconds: 10,
      signal: controller.signal,
      onRelease,
    });

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].pause).not.toHaveBeenCalled();

    controller.abort();

    expect(FakeAudio.instances[0].pause).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("reports playback start only after the browser accepts play", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const onStarted = vi.fn();

    await playAudioSourceSegment("/sounds/test.m4a", 1, { onStarted });

    expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it("preloads and reuses decoded buffer playback from the requested offset", async () => {
    class FakeBufferSourceNode {
      buffer: unknown = null;
      onended: (() => void) | null = null;
      connect = vi.fn();
      disconnect = vi.fn();
      start = vi.fn();
      stop = vi.fn(() => this.onended?.());
    }
    const sourceNodes: FakeBufferSourceNode[] = [];
    class FakeGainNode {
      gain = { value: 0 };
      connect = vi.fn();
      disconnect = vi.fn();
    }
    const decodeAudioDataMock = vi.fn(async () => ({ duration: 10.056 }));
    class FakeAudioContext {
      state = "running";
      destination = {};
      createBufferSource = vi.fn(() => {
        const source = new FakeBufferSourceNode();
        sourceNodes.push(source);
        return source;
      });
      createGain = vi.fn(() => new FakeGainNode());
      decodeAudioData = decodeAudioDataMock;
      resume = vi.fn();
    }
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );
    vi.stubGlobal("AudioContext", FakeAudioContext);

    await preloadAudioBufferSource("/sounds/special-core-countdown-female.m4a");
    await playAudioBufferSegment("/sounds/special-core-countdown-female.m4a", 0.75, {
      startTimeSeconds: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1);
    expect(sourceNodes).toHaveLength(1);
    expect(sourceNodes[0].start).toHaveBeenCalledWith(0, 5);
  });
});
