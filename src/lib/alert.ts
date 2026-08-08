import { getConcreteAlertSound, DEFAULT_ALERT_SOUND_ID } from "./sounds";
import {
  playAudioBufferSegment,
  playAudioSources,
  playAudioSourcesUntilEnded,
  playAudioSourceSegment,
  preloadAudioBufferSources,
} from "./audioPlayback";
import { getCustomAlertSoundRecord, isCustomAlertSoundId } from "./customSounds";

export async function playAlert(
  soundId = DEFAULT_ALERT_SOUND_ID,
  volume = 1,
): Promise<void> {
  if (isCustomAlertSoundId(soundId)) {
    const played = await playCustomAlertSound(soundId, volume, false);
    if (played) {
      return;
    }
  }

  const sound = getConcreteAlertSound(isCustomAlertSoundId(soundId) ? DEFAULT_ALERT_SOUND_ID : soundId);
  const sources = [sound.src, sound.fallbackSrc].filter((src): src is string => Boolean(src));
  await playAudioSources(sources, volume);
}

export async function playAlertUntilEnded(
  soundId = DEFAULT_ALERT_SOUND_ID,
  volume = 1,
  options: { onStarted?: () => void } = {},
): Promise<void> {
  if (isCustomAlertSoundId(soundId)) {
    const played = await playCustomAlertSound(soundId, volume, true, options);
    if (played) {
      return;
    }
  }

  const sound = getConcreteAlertSound(isCustomAlertSoundId(soundId) ? DEFAULT_ALERT_SOUND_ID : soundId);
  const sources = [sound.src, sound.fallbackSrc].filter((src): src is string => Boolean(src));
  await playAudioSourcesUntilEnded(sources, volume, options);
}

export async function playAlertFromOffset(
  soundId = DEFAULT_ALERT_SOUND_ID,
  volume = 1,
  startTimeSeconds = 0,
  options: { signal?: AbortSignal; onStarted?: () => void } = {},
): Promise<void> {
  if (isCustomAlertSoundId(soundId)) {
    const played = await playCustomAlertSound(soundId, volume, true, options);
    if (played) {
      return;
    }
  }

  const sound = getConcreteAlertSound(isCustomAlertSoundId(soundId) ? DEFAULT_ALERT_SOUND_ID : soundId);
  const sources = [sound.src, sound.fallbackSrc].filter((src): src is string => Boolean(src));
  let lastError: unknown = null;
  for (const source of sources) {
    try {
      await playAudioBufferSegment(source, volume, {
        startTimeSeconds,
        waitUntilEnded: true,
        signal: options.signal,
        onStarted: options.onStarted,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("알람 재생에 실패했습니다.");
}

export async function preloadAlertFromOffset(
  soundId = DEFAULT_ALERT_SOUND_ID,
): Promise<void> {
  if (isCustomAlertSoundId(soundId)) {
    return;
  }

  const sound = getConcreteAlertSound(soundId);
  const sources = [sound.src, sound.fallbackSrc].filter((src): src is string => Boolean(src));
  await preloadAudioBufferSources(sources);
}

async function playCustomAlertSound(
  soundId: string,
  volume: number,
  waitUntilEnded: boolean,
  options: { onStarted?: () => void; signal?: AbortSignal } = {},
): Promise<boolean> {
  const record = await getCustomAlertSoundRecord(soundId).catch(() => null);
  if (!record || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return false;
  }

  const source = URL.createObjectURL(record.blob);
  await playAudioSourceSegment(source, volume, {
    startTimeSeconds: record.trimStartMs / 1000,
    endTimeSeconds: record.trimEndMs / 1000,
    waitUntilEnded,
    onStarted: options.onStarted,
    signal: options.signal,
    onRelease: () => URL.revokeObjectURL(source),
  });
  return true;
}
