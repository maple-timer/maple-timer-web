export const CUSTOM_ALERT_SOUND_ID_PREFIX = "custom:";

export function isCustomAlertSoundId(
  soundId: string | null | undefined,
): soundId is `${typeof CUSTOM_ALERT_SOUND_ID_PREFIX}${string}` {
  return typeof soundId === "string" && soundId.startsWith(CUSTOM_ALERT_SOUND_ID_PREFIX);
}

export function createCustomAlertSoundId(id: string): string {
  return `${CUSTOM_ALERT_SOUND_ID_PREFIX}${id}`;
}

export function getCustomAlertSoundRecordId(soundIdOrId: string | null | undefined): string | null {
  if (!soundIdOrId || typeof soundIdOrId !== "string") {
    return null;
  }
  return isCustomAlertSoundId(soundIdOrId)
    ? soundIdOrId.slice(CUSTOM_ALERT_SOUND_ID_PREFIX.length)
    : soundIdOrId;
}
