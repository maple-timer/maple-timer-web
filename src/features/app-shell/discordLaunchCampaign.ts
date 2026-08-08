export const DISCORD_LAUNCH_CAMPAIGN_ID = "discord-launch-2026-08-02";
export const DISCORD_LAUNCH_CAMPAIGN_INVITE_URL = "https://discord.gg/ACXssjgs9g";
export const DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT = Date.parse(
  "2026-08-02T23:59:59.999+09:00",
);

const DISCORD_LAUNCH_CAMPAIGN_SEEN_KEY =
  "maple-timer.discord-launch-2026-08-02.seen.v1";
const DISCORD_LAUNCH_CAMPAIGN_STORAGE_PROBE_KEY =
  "maple-timer.discord-launch-2026-08-02.storage-probe";

type CampaignStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getBrowserStorage(): CampaignStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function canPersistCampaignState(storage: CampaignStorage) {
  try {
    storage.setItem(DISCORD_LAUNCH_CAMPAIGN_STORAGE_PROBE_KEY, "1");
    storage.removeItem(DISCORD_LAUNCH_CAMPAIGN_STORAGE_PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function isDiscordLaunchCampaignActive(now = Date.now()) {
  return now <= DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT;
}

export function shouldShowDiscordLaunchCampaign(
  now = Date.now(),
  storage: CampaignStorage | null = getBrowserStorage(),
) {
  if (!isDiscordLaunchCampaignActive(now) || !storage) {
    return false;
  }

  try {
    return (
      storage.getItem(DISCORD_LAUNCH_CAMPAIGN_SEEN_KEY) !== "1" &&
      canPersistCampaignState(storage)
    );
  } catch {
    return false;
  }
}

export function markDiscordLaunchCampaignSeen(
  storage: CampaignStorage | null = getBrowserStorage(),
) {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(DISCORD_LAUNCH_CAMPAIGN_SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
