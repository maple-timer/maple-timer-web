import { clampAlertVolume, STANDARD_ALERT_VOLUME } from "./volume";

const activeAudios = new Set<HTMLAudioElement>();
const audioCleanups = new WeakMap<HTMLAudioElement, () => void>();
const activeBufferSources = new Set<AudioBufferSourceNode>();
const decodedAudioBuffers = new Map<string, Promise<AudioBuffer>>();
let sharedAudioContext: AudioContext | null = null;

export type AudioSegmentPlaybackOptions = {
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  waitUntilEnded?: boolean;
  onStarted?: () => void;
  onRelease?: () => void;
  signal?: AbortSignal;
};

export function clampVolume(volume: number): number {
  return clampAlertVolume(volume);
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") {
    return typeof AudioContext === "undefined" ? undefined : AudioContext;
  }

  return (
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function getSharedAudioContext(): AudioContext | null {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    return null;
  }

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContextConstructor();
  }

  return sharedAudioContext;
}

function getDecodedAudioBuffer(source: string, context: AudioContext): Promise<AudioBuffer> {
  const cached = decodedAudioBuffers.get(source);
  if (cached) {
    return cached;
  }

  const decoded = fetch(source)
    .then((response) => {
      if (!response.ok) {
        throw new Error("알람 음성 파일을 불러오지 못했습니다.");
      }
      return response.arrayBuffer();
    })
    .then((buffer) => context.decodeAudioData(buffer.slice(0)))
    .catch((error) => {
      decodedAudioBuffers.delete(source);
      throw error;
    });
  decodedAudioBuffers.set(source, decoded);
  return decoded;
}

export async function preloadAudioBufferSource(source: string): Promise<void> {
  const context = getSharedAudioContext();
  if (!context || typeof fetch === "undefined") {
    return;
  }

  await getDecodedAudioBuffer(source, context);
}

export async function preloadAudioBufferSources(sources: string[]): Promise<void> {
  let lastError: unknown = null;
  for (const source of sources) {
    try {
      await preloadAudioBufferSource(source);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError instanceof Error
      ? lastError
      : new Error("알람 음성 파일을 미리 불러오지 못했습니다.");
  }
}

function setupBoostedVolume(audio: HTMLAudioElement, volume: number): AudioContext | null {
  const normalizedVolume = clampVolume(volume);
  audio.volume = Math.min(STANDARD_ALERT_VOLUME, normalizedVolume);

  if (normalizedVolume <= STANDARD_ALERT_VOLUME) {
    return null;
  }

  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    return null;
  }

  try {
    const context = new AudioContextConstructor();
    const source = context.createMediaElementSource(audio);
    const gain = context.createGain();
    gain.gain.value = normalizedVolume;
    source.connect(gain);
    gain.connect(context.destination);
    audioCleanups.set(audio, () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // The node may already be disconnected by the browser.
      }
      void context.close().catch(() => undefined);
    });
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    return context;
  } catch {
    return null;
  }
}

function releaseAudio(audio: HTMLAudioElement): void {
  activeAudios.delete(audio);
  const cleanup = audioCleanups.get(audio);
  if (cleanup) {
    cleanup();
    audioCleanups.delete(audio);
  }
}

export async function playAudioSources(sources: string[], volume = 1): Promise<void> {
  if (typeof Audio === "undefined") {
    throw new Error("이 브라우저는 오디오 재생을 지원하지 않습니다.");
  }

  let lastError: unknown = null;
  for (const source of sources) {
    try {
      await playAudioSource(source, volume);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("알람 재생에 실패했습니다.");
}

export async function playAudioSourcesUntilEnded(
  sources: string[],
  volume = 1,
  options: Pick<AudioSegmentPlaybackOptions, "onStarted"> = {},
): Promise<void> {
  if (typeof Audio === "undefined") {
    throw new Error("이 브라우저는 오디오 재생을 지원하지 않습니다.");
  }

  let lastError: unknown = null;
  let didStart = false;
  for (const source of sources) {
    try {
      await playAudioSource(source, volume, {
        waitUntilEnded: true,
        onStarted: () => {
          if (!didStart) {
            didStart = true;
            options.onStarted?.();
          }
        },
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("알람 재생에 실패했습니다.");
}

export async function playAudioSourceSegment(
  source: string,
  volume = 1,
  options: AudioSegmentPlaybackOptions = {},
): Promise<void> {
  return playAudioSource(source, volume, options);
}

export async function playAudioBufferSegment(
  source: string,
  volume = 1,
  options: AudioSegmentPlaybackOptions = {},
): Promise<void> {
  const context = getSharedAudioContext();
  if (!context || typeof fetch === "undefined") {
    return playAudioSourceSegment(source, volume, options);
  }

  if (options.signal?.aborted) {
    return;
  }

  const buffer = await getDecodedAudioBuffer(source, context);
  if (options.signal?.aborted) {
    return;
  }
  if (context.state === "suspended") {
    await context.resume().catch(() => undefined);
  }

  const sourceNode = context.createBufferSource();
  const gainNode = context.createGain();
  const requestedStartTime = Math.max(0, Number(options.startTimeSeconds) || 0);
  const startTimeSeconds = Math.min(requestedStartTime, Math.max(0, buffer.duration - 0.01));
  const endTimeSeconds = Number(options.endTimeSeconds);
  const hasSegmentEnd = Number.isFinite(endTimeSeconds) && endTimeSeconds > startTimeSeconds;
  const durationSeconds = hasSegmentEnd
    ? Math.max(0.001, endTimeSeconds - startTimeSeconds)
    : undefined;

  sourceNode.buffer = buffer;
  gainNode.gain.value = clampVolume(volume);
  sourceNode.connect(gainNode);
  gainNode.connect(context.destination);
  activeBufferSources.add(sourceNode);

  let released = false;
  let resolveEnded: (() => void) | null = null;
  const ended = options.waitUntilEnded
    ? new Promise<void>((resolve) => {
        resolveEnded = resolve;
      })
    : null;

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    activeBufferSources.delete(sourceNode);
    options.signal?.removeEventListener("abort", handleAbort);
    try {
      sourceNode.disconnect();
      gainNode.disconnect();
    } catch {
      // The browser may already have detached the graph after playback ends.
    }
    options.onRelease?.();
    resolveEnded?.();
  };
  const handleAbort = () => {
    try {
      sourceNode.stop();
    } catch {
      release();
    }
  };

  sourceNode.onended = release;
  options.signal?.addEventListener("abort", handleAbort, { once: true });

  try {
    if (durationSeconds !== undefined) {
      sourceNode.start(0, startTimeSeconds, durationSeconds);
    } else {
      sourceNode.start(0, startTimeSeconds);
    }
    options.onStarted?.();
    if (ended) {
      await ended;
    }
  } catch (error) {
    release();
    throw error;
  }
}

async function playAudioSource(
  source: string,
  volume = 1,
  options: AudioSegmentPlaybackOptions = {},
): Promise<void> {
  if (typeof Audio === "undefined") {
    throw new Error("이 브라우저는 오디오 재생을 지원하지 않습니다.");
  }

  const audio = new Audio(source);
  const boostedContext = setupBoostedVolume(audio, volume);
  activeAudios.add(audio);

  let released = false;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveEnded: (() => void) | null = null;
  let rejectEnded: ((error: Error) => void) | null = null;

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    if (endTimer) {
      clearTimeout(endTimer);
      endTimer = null;
    }
    audio.removeEventListener("ended", handleEnded);
    audio.removeEventListener("error", handleError);
    options.signal?.removeEventListener("abort", handleAbort);
    releaseAudio(audio);
    options.onRelease?.();
  };
  const handleEnded = () => {
    release();
    resolveEnded?.();
  };
  const handleError = () => {
    release();
    rejectEnded?.(new Error("알람 재생에 실패했습니다."));
  };
  const finishSegment = () => {
    audio.pause();
    release();
    resolveEnded?.();
  };
  const handleAbort = () => {
    audio.pause();
    release();
    resolveEnded?.();
  };

  const ended = options.waitUntilEnded
    ? new Promise<void>((resolve, reject) => {
        resolveEnded = resolve;
        rejectEnded = reject;
      })
    : null;

  audio.addEventListener("ended", handleEnded, { once: true });
  audio.addEventListener("error", handleError, { once: true });
  if (options.signal?.aborted) {
    handleAbort();
    return;
  }
  options.signal?.addEventListener("abort", handleAbort, { once: true });

  const startTimeSeconds = Math.max(0, Number(options.startTimeSeconds) || 0);
  const endTimeSeconds = Number(options.endTimeSeconds);
  const hasSegmentEnd = Number.isFinite(endTimeSeconds) && endTimeSeconds > startTimeSeconds;

  try {
    if (startTimeSeconds > 0) {
      audio.currentTime = startTimeSeconds;
    }
    await audio.play();
    options.onStarted?.();
    if (boostedContext?.state === "suspended") {
      void boostedContext.resume().catch(() => undefined);
    }

    if (hasSegmentEnd) {
      const durationMs = Math.max(1, Math.round((endTimeSeconds - startTimeSeconds) * 1000));
      endTimer = setTimeout(finishSegment, durationMs);
    }

    if (ended) {
      await ended;
    }
  } catch (error) {
    release();
    throw error;
  }
}
