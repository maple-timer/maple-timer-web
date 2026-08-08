import { describe, expect, it } from "vitest";
import {
  getSpecialCoreCountdownAudioStartOffsetSeconds,
  getSpecialCoreRemainingSecondsForDisplay,
} from "./specialCoreAlertConfig";
import {
  createSpecialCoreRuntimeState,
  getSpecialCoreSecondsUntilAlert,
  isSpecialCoreAlertDue,
  markSpecialCoreAlerted,
  retimeSpecialCoreRuntimeState,
  updateSpecialCoreRuntimeFromSample,
} from "./specialCoreAlertRuntime";
import type {
  SpecialCoreDetectedIcon,
  SpecialCoreSampleResponse,
} from "./specialCoreAlertTypes";

const config = {
  cooldownSeconds: 30,
  alertLeadSeconds: 5,
};

describe("specialCoreAlertRuntime", () => {
  it("confirms an activation after two detections and starts cooldown at first detection", () => {
    const first = updateSpecialCoreRuntimeFromSample({
      previous: createSpecialCoreRuntimeState(),
      sample: sampleWithDetection(1_000),
      config,
      now: 1_000,
    });
    expect(first.status).toBe("confirming");
    expect(first.alertDueAt).toBeNull();
    expect(first.pendingDetectionIcons).toHaveLength(1);
    expect(first.pendingDetectionIcons[0]?.match.score).toBeCloseTo(4.51);

    const second = updateSpecialCoreRuntimeFromSample({
      previous: first,
      sample: sampleWithDetection(2_000),
      config,
      now: 2_000,
    });
    expect(second.status).toBe("cooldown");
    expect(second.activationStartedAt).toBe(1_000);
    expect(second.cooldownEndsAt).toBe(31_000);
    expect(second.alertDueAt).toBe(26_000);
    expect(getSpecialCoreSecondsUntilAlert(second, 20_500)).toBe(6);
    expect(second.pendingDetectionIcons).toEqual([]);
    expect(second.activationEvidence).toMatchObject({
      activationId: 1,
      activationStartedAt: 1_000,
      activationConfirmedAt: 2_000,
    });
    expect(second.activationEvidence?.confirmationIcons).toHaveLength(2);
    expect(second.activationEvidence?.confirmationIcons[0]?.match.score).toBeCloseTo(4.51);
    expect(second.activationEvidence?.confirmationIcons[1]?.match.score).toBeCloseTo(4.52);
  });

  it("does not reset cooldown while the same visible episode keeps matching", () => {
    const confirmed = confirmAt(1_000, 2_000);
    const updated = updateSpecialCoreRuntimeFromSample({
      previous: confirmed,
      sample: sampleWithDetection(3_500),
      config,
      now: 3_500,
    });

    expect(updated.activationId).toBe(1);
    expect(updated.activationStartedAt).toBe(1_000);
    expect(updated.alertDueAt).toBe(26_000);
    expect(updated.activationLastSeenAt).toBe(3_500);
  });

  it("keeps a confirmed countdown when the icon disappears", () => {
    const confirmed = confirmAt(1_000, 2_000);
    const missing = updateSpecialCoreRuntimeFromSample({
      previous: confirmed,
      sample: emptySample(7_500),
      config,
      now: 7_500,
    });

    expect(missing.status).toBe("cooldown");
    expect(missing.alertDueAt).toBe(26_000);
  });

  it("ignores new detections until the confirmed cooldown ends", () => {
    const confirmed = confirmAt(1_000, 2_000);
    const firstIgnored = updateSpecialCoreRuntimeFromSample({
      previous: confirmed,
      sample: sampleWithDetection(9_000),
      config,
      now: 9_000,
    });
    const secondIgnored = updateSpecialCoreRuntimeFromSample({
      previous: firstIgnored,
      sample: sampleWithDetection(10_000),
      config,
      now: 10_000,
    });

    expect(secondIgnored.activationId).toBe(1);
    expect(secondIgnored.activationStartedAt).toBe(1_000);
    expect(secondIgnored.cooldownEndsAt).toBe(31_000);
    expect(secondIgnored.alertDueAt).toBe(26_000);
    expect(secondIgnored.pendingDetections).toEqual([]);
  });

  it("accepts a confirmed reactivation near the locked cooldown end", () => {
    const delayed = confirmAt(2_000, 3_000, { cooldownSeconds: 30, alertLeadSeconds: 10 });
    const oldAlerted = markSpecialCoreAlerted(delayed, 22_000);
    const strayMidCooldownDetection = updateSpecialCoreRuntimeFromSample({
      previous: oldAlerted,
      sample: sampleWithDetection(26_000),
      config: { cooldownSeconds: 30, alertLeadSeconds: 10 },
      now: 26_000,
    });
    expect(strayMidCooldownDetection.activationLastSeenAt).toBe(3_000);

    const firstReacquire = updateSpecialCoreRuntimeFromSample({
      previous: strayMidCooldownDetection,
      sample: sampleWithDetection(29_000),
      config: { cooldownSeconds: 30, alertLeadSeconds: 10 },
      now: 29_000,
    });
    expect(firstReacquire.activationId).toBe(1);
    expect(firstReacquire.pendingDetections).toHaveLength(1);

    const secondReacquire = updateSpecialCoreRuntimeFromSample({
      previous: firstReacquire,
      sample: sampleWithDetection(30_000),
      config: { cooldownSeconds: 30, alertLeadSeconds: 10 },
      now: 30_000,
    });

    expect(secondReacquire.activationId).toBe(2);
    expect(secondReacquire.activationStartedAt).toBe(29_000);
    expect(secondReacquire.cooldownEndsAt).toBe(59_000);
    expect(secondReacquire.alertDueAt).toBe(49_000);
    expect(secondReacquire.alertedAt).toBeNull();
  });

  it("does not reacquire the same visible episode before it has clearly disappeared", () => {
    let state = confirmAt(1_000, 2_000, { cooldownSeconds: 11, alertLeadSeconds: 5 });
    for (const sampledAt of [8_000, 9_000, 10_000, 11_000]) {
      state = updateSpecialCoreRuntimeFromSample({
        previous: state,
        sample: sampleWithDetection(sampledAt),
        config: { cooldownSeconds: 11, alertLeadSeconds: 5 },
        now: sampledAt,
      });
    }

    expect(state.activationId).toBe(1);
    expect(state.activationStartedAt).toBe(1_000);
    expect(state.cooldownEndsAt).toBe(12_000);
    expect(state.pendingDetections).toEqual([]);
  });

  it("starts a new activation after the confirmed cooldown has ended", () => {
    const confirmed = confirmAt(1_000, 2_000);
    const firstNew = updateSpecialCoreRuntimeFromSample({
      previous: confirmed,
      sample: sampleWithDetection(32_000),
      config,
      now: 32_000,
    });
    const secondNew = updateSpecialCoreRuntimeFromSample({
      previous: firstNew,
      sample: sampleWithDetection(33_000),
      config,
      now: 33_000,
    });

    expect(secondNew.activationId).toBe(2);
    expect(secondNew.activationStartedAt).toBe(32_000);
    expect(secondNew.cooldownEndsAt).toBe(62_000);
    expect(secondNew.alertDueAt).toBe(57_000);
  });

  it("marks a due alert once", () => {
    const confirmed = confirmAt(1_000, 2_000);
    expect(isSpecialCoreAlertDue(confirmed, 25_999)).toBe(false);
    expect(isSpecialCoreAlertDue(confirmed, 26_000)).toBe(true);

    const alerted = markSpecialCoreAlerted(confirmed, 26_000);
    expect(alerted.status).toBe("alerted");
    expect(alerted.lastAlertedAt).toBe(26_000);
    expect(isSpecialCoreAlertDue(alerted, 30_000)).toBe(false);
    expect(markSpecialCoreAlerted(alerted, 31_000)).toBe(alerted);
  });

  it("retimes an active activation without clearing evidence or alert history", () => {
    const confirmed = confirmAt(1_000, 2_000);
    const retimed = retimeSpecialCoreRuntimeState({
      state: confirmed,
      config: { cooldownSeconds: 45, alertLeadSeconds: 10 },
    });

    expect(retimed.activationId).toBe(1);
    expect(retimed.activationStartedAt).toBe(1_000);
    expect(retimed.activationConfirmedAt).toBe(2_000);
    expect(retimed.activationLastSeenAt).toBe(2_000);
    expect(retimed.cooldownEndsAt).toBe(46_000);
    expect(retimed.alertDueAt).toBe(36_000);
    expect(retimed.lastDetectedIcon).toBe(confirmed.lastDetectedIcon);
    expect(retimed.activationEvidence).toEqual(confirmed.activationEvidence);

    const alerted = markSpecialCoreAlerted(retimed, 36_000);
    const retimedAfterAlert = retimeSpecialCoreRuntimeState({
      state: alerted,
      config: { cooldownSeconds: 60, alertLeadSeconds: 5 },
    });

    expect(retimedAfterAlert.status).toBe("alerted");
    expect(retimedAfterAlert.alertedAt).toBe(36_000);
    expect(retimedAfterAlert.lastAlertedAt).toBe(36_000);
    expect(retimedAfterAlert.cooldownEndsAt).toBe(61_000);
    expect(retimedAfterAlert.alertDueAt).toBe(56_000);
  });

  it("clamps an alert lead larger than cooldown to immediate activation time", () => {
    const first = updateSpecialCoreRuntimeFromSample({
      previous: createSpecialCoreRuntimeState(),
      sample: sampleWithDetection(1_000),
      config: { cooldownSeconds: 11, alertLeadSeconds: 10 },
      now: 1_000,
    });
    const confirmed = updateSpecialCoreRuntimeFromSample({
      previous: first,
      sample: sampleWithDetection(2_000),
      config: { cooldownSeconds: 11, alertLeadSeconds: 10 },
      now: 2_000,
    });

    expect(confirmed.cooldownEndsAt).toBe(12_000);
    expect(confirmed.alertDueAt).toBe(2_000);
  });

  it("maps remaining countdown seconds to the countdown audio start offset", () => {
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(10)).toBe(0);
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(8)).toBe(2);
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(5)).toBe(5);
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(1)).toBe(9);
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(0)).toBe(9);
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(999)).toBe(0);
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(9.2)).toBeCloseTo(0.8);
    expect(getSpecialCoreCountdownAudioStartOffsetSeconds(4.2)).toBeCloseTo(5.8);
  });

  it("floors the special-core remaining cooldown value for display", () => {
    expect(getSpecialCoreRemainingSecondsForDisplay({
      cooldownEndsAt: 30_800,
      now: 1_000,
    })).toBe(29);
    expect(getSpecialCoreRemainingSecondsForDisplay({
      cooldownEndsAt: 30_000,
      now: 1_000,
    })).toBe(29);
    expect(getSpecialCoreRemainingSecondsForDisplay({
      cooldownEndsAt: 1_900,
      now: 1_000,
    })).toBe(0);
    expect(getSpecialCoreRemainingSecondsForDisplay({
      cooldownEndsAt: null,
      now: 1_000,
    })).toBeNull();
  });
});

function confirmAt(firstAt: number, secondAt: number, timing = config) {
  const first = updateSpecialCoreRuntimeFromSample({
    previous: createSpecialCoreRuntimeState(),
    sample: sampleWithDetection(firstAt),
    config: timing,
    now: firstAt,
  });
  return updateSpecialCoreRuntimeFromSample({
    previous: first,
    sample: sampleWithDetection(secondAt),
    config: timing,
    now: secondAt,
  });
}

function sampleWithDetection(sampledAt: number): SpecialCoreSampleResponse {
  const detectedIcon = makeDetectedIcon(sampledAt);
  return {
    sampledAt,
    parserRuntime: null,
    boxCount: 3,
    parsedBoxes: [],
    rowGroups: [],
    eligibleBoxIndexes: [],
    detectedCount: 1,
    detectedIcon,
    candidateIcons: [detectedIcon],
    performance: {
      totalMs: 4,
      detectMs: 2,
      matchMs: 2,
      boxCount: 3,
    },
    unsupported: false,
    unsupportedReason: null,
  };
}

function emptySample(sampledAt: number): SpecialCoreSampleResponse {
  return {
    sampledAt,
    parserRuntime: null,
    boxCount: 3,
    parsedBoxes: [],
    rowGroups: [],
    eligibleBoxIndexes: [],
    detectedCount: 0,
    detectedIcon: null,
    candidateIcons: [],
    performance: {
      totalMs: 2,
      detectMs: 2,
      matchMs: 0,
      boxCount: 3,
    },
    unsupported: false,
    unsupportedReason: null,
  };
}

function makeDetectedIcon(sampledAt: number): SpecialCoreDetectedIcon {
  return {
    boxIndex: 1,
    box: {
      x: 100,
      y: 10,
      size: 32,
      confidence: 1,
      score: 1,
    },
    icon: {
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    },
    match: {
      matched: true,
      targetId: "specialCore",
      bundleId: "special-core-deep-v2",
      modelId: "special-core-deep-v2",
      modelVersion: "special-core-20260711-v2",
      variantId: "test",
      gateVersion: 2,
      score: 4.5 + sampledAt / 100000,
      threshold: 0,
      margin: 4.5 + sampledAt / 100000,
      gateScore: 0.98,
      gateThreshold: 0.94,
      gateMargin: 0.04,
      rescueThreshold: 0.999,
      rescueMargin: -0.019,
      basePassed: true,
      positiveGatePassed: true,
      primaryPassed: true,
      rescuePassed: false,
      decisionReason: "base_and_positive_gate_passed",
      elapsedMs: 0.3,
    },
  };
}
