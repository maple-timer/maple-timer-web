import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SOUND_ID } from "./sounds";
import { normalizeUltimaRaidEquipmentAlert } from "./profileNormalization";

describe("normalizeUltimaRaidEquipmentAlert", () => {
  it("adds a disabled boss alert to profiles saved before the second alert existed", () => {
    expect(
      normalizeUltimaRaidEquipmentAlert(
        {
          enabled: true,
          region: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
          soundId: "custom:legacy-equipment",
          volume: 0.6,
        },
        0.45,
      ),
    ).toMatchObject({
      enabled: true,
      soundId: "custom:legacy-equipment",
      volume: 0.6,
      repeatAlertEnabled: false,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 3,
      bossAlert: {
        enabled: false,
        soundId: DEFAULT_ALERT_SOUND_ID,
        volume: 0.45,
        repeatAlertEnabled: false,
        repeatAlertIntervalSeconds: 3,
        repeatAlertMaxCount: 3,
      },
    });
  });

  it("normalizes the boss alert independently from equipment settings", () => {
    expect(
      normalizeUltimaRaidEquipmentAlert(
        {
          enabled: false,
          soundId: "custom:equipment",
          volume: 0.2,
          repeatAlertEnabled: true,
          repeatAlertIntervalSeconds: 5,
          repeatAlertMaxCount: null,
          bossAlert: {
            enabled: true,
            soundId: "custom:boss",
            volume: 0.8,
            repeatAlertEnabled: true,
            repeatAlertIntervalSeconds: 2,
            repeatAlertMaxCount: 5,
          },
        },
        0.45,
      ),
    ).toMatchObject({
      enabled: false,
      soundId: "custom:equipment",
      volume: 0.2,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 3,
      bossAlert: {
        enabled: true,
        soundId: "custom:boss",
        volume: 0.8,
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 2,
        repeatAlertMaxCount: 5,
      },
    });
  });
});
