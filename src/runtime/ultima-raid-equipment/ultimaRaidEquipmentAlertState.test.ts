import { describe, expect, it } from "vitest";
import {
  ULTIMA_RAID_INVENTORY_FULL_DETECTOR_VERSION,
  type UltimaRaidInventoryFullDetection,
} from "../../recognition/ultima-raid-equipment/inventoryFullDetector";
import {
  createUltimaRaidEquipmentRuntimeState,
  releaseUltimaRaidEquipmentAlertAfterPlaybackFailure,
  updateUltimaRaidEquipmentRuntimeState,
} from "./ultimaRaidEquipmentAlertState";

describe("ultimaRaidEquipmentAlertState", () => {
  it("alerts after two bag signals within the latest three samples", () => {
    const first = update(createUltimaRaidEquipmentRuntimeState(), bagDetected, 1_000);
    const gap = update(first.state, absent, 2_000);
    const third = update(gap.state, bagDetected, 3_000);

    expect(first.state.status).toBe("candidate");
    expect(first.shouldAlert).toBe(false);
    expect(gap.state.status).toBe("candidate");
    expect(third.state.status).toBe("alerted");
    expect(third.shouldAlert).toBe(true);
  });

  it("requires a second bag signal even when the first appears with the banner", () => {
    const first = update(
      createUltimaRaidEquipmentRuntimeState(),
      bagAndBannerDetected,
      1_000,
    );
    const bannerOnly = update(first.state, bannerDetected, 2_000);
    const secondBag = update(bannerOnly.state, bagDetected, 3_000);

    expect(first.shouldAlert).toBe(false);
    expect(first.state.status).toBe("candidate");
    expect(bannerOnly.shouldAlert).toBe(false);
    expect(secondBag.shouldAlert).toBe(true);
    expect(secondBag.state.status).toBe("alerted");
  });

  it("does not alert from one isolated bag signal combined with an item banner", () => {
    const falsePositive = update(
      createUltimaRaidEquipmentRuntimeState(),
      bagAndBannerDetected,
      1_000,
    );
    const firstMiss = update(falsePositive.state, bannerDetected, 2_000);
    const secondMiss = update(firstMiss.state, absent, 3_000);
    const thirdMiss = update(secondMiss.state, absent, 4_000);
    const fourthMiss = update(thirdMiss.state, absent, 5_000);
    const fifthMiss = update(fourthMiss.state, absent, 6_000);

    expect(falsePositive.shouldAlert).toBe(false);
    expect(firstMiss.shouldAlert).toBe(false);
    expect(secondMiss.shouldAlert).toBe(false);
    expect(thirdMiss.shouldAlert).toBe(false);
    expect(fourthMiss.shouldAlert).toBe(false);
    expect(fifthMiss.shouldAlert).toBe(false);
    expect(fifthMiss.state.status).toBe("waiting");
  });

  it("does not alert from the banner alone", () => {
    const first = update(
      createUltimaRaidEquipmentRuntimeState(),
      bannerDetected,
      1_000,
    );
    const second = update(first.state, bannerDetected, 2_000);
    const third = update(second.state, bannerDetected, 3_000);

    expect(first.state.status).toBe("candidate");
    expect(second.shouldAlert).toBe(false);
    expect(third.shouldAlert).toBe(false);
  });

  it("rearms only after five consecutive readable clear frames", () => {
    const first = update(createUltimaRaidEquipmentRuntimeState(), bagDetected, 1_000);
    const alerted = update(first.state, bagDetected, 2_000);
    const firstMiss = update(alerted.state, absent, 3_000);
    const secondMiss = update(firstMiss.state, absent, 4_000);
    const thirdMiss = update(secondMiss.state, absent, 5_000);
    const fourthMiss = update(thirdMiss.state, absent, 6_000);
    const fifthMiss = update(fourthMiss.state, absent, 7_000);
    const nextFirst = update(fifthMiss.state, bagDetected, 8_000);
    const nextSecond = update(nextFirst.state, bagDetected, 9_000);

    expect(firstMiss.state.alertedForCurrentPresence).toBe(true);
    expect(secondMiss.state.alertedForCurrentPresence).toBe(true);
    expect(thirdMiss.state.alertedForCurrentPresence).toBe(true);
    expect(fourthMiss.state.alertedForCurrentPresence).toBe(true);
    expect(fifthMiss.state.alertedForCurrentPresence).toBe(false);
    expect(nextSecond.shouldAlert).toBe(true);
  });

  it("rearms after five readable clear frames even while the full banner lingers", () => {
    const first = update(createUltimaRaidEquipmentRuntimeState(), bagDetected, 1_000);
    const alerted = update(first.state, bagDetected, 2_000);
    const firstBagMiss = update(alerted.state, bannerDetected, 3_000);
    const secondBagMiss = update(firstBagMiss.state, bannerDetected, 4_000);
    const thirdBagMiss = update(secondBagMiss.state, bannerDetected, 5_000);
    const fourthBagMiss = update(thirdBagMiss.state, bannerDetected, 6_000);
    const fifthBagMiss = update(fourthBagMiss.state, bannerDetected, 7_000);
    const nextFirstBag = update(fifthBagMiss.state, bagDetected, 8_000);
    const nextSecondBag = update(nextFirstBag.state, bagDetected, 9_000);

    expect(firstBagMiss.state.alertedForCurrentPresence).toBe(true);
    expect(secondBagMiss.state.alertedForCurrentPresence).toBe(true);
    expect(thirdBagMiss.state.alertedForCurrentPresence).toBe(true);
    expect(fourthBagMiss.state.alertedForCurrentPresence).toBe(true);
    expect(fifthBagMiss.state.alertedForCurrentPresence).toBe(false);
    expect(nextFirstBag.shouldAlert).toBe(false);
    expect(nextSecondBag.shouldAlert).toBe(true);
  });

  it("does not rearm while the bag count is covered or unreadable", () => {
    const first = update(createUltimaRaidEquipmentRuntimeState(), bagDetected, 1_000);
    const alerted = update(first.state, bagDetected, 2_000);
    let current = alerted;

    for (let index = 0; index < 8; index += 1) {
      current = update(current.state, unreadable, 3_000 + index * 1_000);
    }

    expect(current.state.alertedForCurrentPresence).toBe(true);
    expect(current.state.consecutiveBagAbsentFrames).toBe(0);

    for (let index = 0; index < 5; index += 1) {
      current = update(current.state, absent, 11_000 + index * 1_000);
    }

    expect(current.state.alertedForCurrentPresence).toBe(false);
  });

  it("releases the alert lock after playback failure", () => {
    const first = update(createUltimaRaidEquipmentRuntimeState(), bagDetected, 1_000);
    const alerted = update(first.state, bagDetected, 2_000);
    const released = releaseUltimaRaidEquipmentAlertAfterPlaybackFailure(
      alerted.state,
      2_000,
      "autoplay-blocked",
    );
    const retryFirst = update(released, bagDetected, 3_000);
    const retrySecond = update(retryFirst.state, bagDetected, 4_000);

    expect(released.alertedForCurrentPresence).toBe(false);
    expect(retrySecond.shouldAlert).toBe(true);
  });

  it("rejects a legacy bag-only crop as an invalid region", () => {
    const result = update(
      createUltimaRaidEquipmentRuntimeState(),
      { ...absent, layoutValid: false },
      1_000,
    );

    expect(result.state.status).toBe("invalid-region");
    expect(result.shouldAlert).toBe(false);
  });

  it("reports actionable inactive states", () => {
    const initial = createUltimaRaidEquipmentRuntimeState();

    expect(
      updateUltimaRaidEquipmentRuntimeState({
        previous: initial,
        detection: null,
        now: 1_000,
        enabled: false,
        hasStream: true,
        hasRegion: true,
      }).state.status,
    ).toBe("paused");
    expect(
      updateUltimaRaidEquipmentRuntimeState({
        previous: initial,
        detection: null,
        now: 1_000,
        enabled: true,
        hasStream: false,
        hasRegion: true,
      }).state.status,
    ).toBe("no-stream");
    expect(
      updateUltimaRaidEquipmentRuntimeState({
        previous: initial,
        detection: null,
        now: 1_000,
        enabled: true,
        hasStream: true,
        hasRegion: false,
      }).state.status,
    ).toBe("no-region");
  });
});

const bagDetected: UltimaRaidInventoryFullDetection = {
  detected: true,
  confidence: 0.9,
  layoutValid: true,
  source: "bag-number",
  bagCountState: "full",
  bagCountReadable: true,
  bagCountOccluded: false,
  bagFullDetected: true,
  bagWarmPixelCount: 20,
  bagForegroundPixelCount: 24,
  bagReadablePixelCount: 24,
  bagWarmPixelRatio: 0.83,
  largestBagWarmClusterSize: 8,
  largestBagWarmClusterWidth: 2,
  largestBagWarmClusterHeight: 4,
  largestBagWarmClusterXRatio: 0.4,
  largestBagWarmClusterYRatio: 0.5,
  bagWarmComponentValid: true,
  bagWarmComponentTouchesBoundary: false,
  bagCountRowTopRatio: 0.43,
  bagCountRowHeightRatio: 0.26,
  fullBannerDetected: false,
  largestBannerClusterSize: 0,
  bannerWidthRatio: 0,
  bannerHeightRatio: 0,
  bannerFillRatio: 0,
  detectorVersion: ULTIMA_RAID_INVENTORY_FULL_DETECTOR_VERSION,
};

const bannerDetected: UltimaRaidInventoryFullDetection = {
  ...bagDetected,
  source: "full-banner",
  bagCountState: "clear",
  bagFullDetected: false,
  bagWarmPixelCount: 0,
  bagForegroundPixelCount: 20,
  bagWarmPixelRatio: 0,
  largestBagWarmClusterSize: 0,
  fullBannerDetected: true,
  largestBannerClusterSize: 3_000,
  bannerWidthRatio: 0.55,
  bannerHeightRatio: 0.1,
  bannerFillRatio: 0.7,
};

const bagAndBannerDetected: UltimaRaidInventoryFullDetection = {
  ...bagDetected,
  source: "bag-and-banner",
  fullBannerDetected: true,
  largestBannerClusterSize: 3_000,
  bannerWidthRatio: 0.55,
  bannerHeightRatio: 0.1,
  bannerFillRatio: 0.7,
};

const absent: UltimaRaidInventoryFullDetection = {
  ...bagDetected,
  detected: false,
  confidence: 0,
  source: "none",
  bagCountState: "clear",
  bagFullDetected: false,
  bagWarmPixelCount: 0,
  bagWarmPixelRatio: 0,
  largestBagWarmClusterSize: 0,
  largestBagWarmClusterWidth: 0,
  largestBagWarmClusterHeight: 0,
  bagWarmComponentValid: false,
};

const unreadable: UltimaRaidInventoryFullDetection = {
  ...absent,
  bagCountState: "unreadable",
  bagCountReadable: false,
  bagCountOccluded: true,
  bagWarmPixelCount: 20,
  bagWarmPixelRatio: 0.8,
  largestBagWarmClusterSize: 20,
  largestBagWarmClusterWidth: 1,
  largestBagWarmClusterHeight: 20,
  bagWarmComponentTouchesBoundary: true,
};

function update(
  previous: ReturnType<typeof createUltimaRaidEquipmentRuntimeState>,
  detection: UltimaRaidInventoryFullDetection,
  now: number,
) {
  return updateUltimaRaidEquipmentRuntimeState({
    previous,
    detection,
    now,
    enabled: true,
    hasStream: true,
    hasRegion: true,
  });
}
