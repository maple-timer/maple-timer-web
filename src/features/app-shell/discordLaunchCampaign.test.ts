import { describe, expect, it, vi } from "vitest";
import {
  DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT,
  isDiscordLaunchCampaignActive,
  markDiscordLaunchCampaignSeen,
  shouldShowDiscordLaunchCampaign,
} from "./discordLaunchCampaign";

function createMemoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

describe("discordLaunchCampaign", () => {
  it("stays active through Sunday night in Korea and expires immediately after", () => {
    expect(isDiscordLaunchCampaignActive(DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT)).toBe(true);
    expect(isDiscordLaunchCampaignActive(DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT + 1)).toBe(
      false,
    );
  });

  it("shows only while active and unseen", () => {
    const storage = createMemoryStorage();

    expect(
      shouldShowDiscordLaunchCampaign(
        DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT,
        storage,
      ),
    ).toBe(true);
    expect(markDiscordLaunchCampaignSeen(storage)).toBe(true);
    expect(
      shouldShowDiscordLaunchCampaign(
        DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT,
        storage,
      ),
    ).toBe(false);
    expect(
      shouldShowDiscordLaunchCampaign(
        DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT + 1,
        createMemoryStorage(),
      ),
    ).toBe(false);
  });

  it("does not show when browser storage cannot persist the seen state", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      removeItem: vi.fn(),
    };

    expect(
      shouldShowDiscordLaunchCampaign(
        DISCORD_LAUNCH_CAMPAIGN_EXPIRES_AT,
        storage,
      ),
    ).toBe(false);
    expect(markDiscordLaunchCampaignSeen(storage)).toBe(false);
  });
});
