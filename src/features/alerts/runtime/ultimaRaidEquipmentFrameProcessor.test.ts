import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import {
  createUltimaRaidEquipmentRuntimeState,
  type UltimaRaidEquipmentRuntimeState,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import { createDefaultProfile, createDefaultUltimaRaidEquipmentAlert } from "../../../lib/storage";
import { processUltimaRaidEquipmentFrame } from "./ultimaRaidEquipmentFrameProcessor";

describe("processUltimaRaidEquipmentFrame", () => {
  it("uses the selected layout crop and alerts after stable full-inventory evidence", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region: region,
      regionsByLayout: { "1920x1080": region },
    };
    const context = createContext(createFullInventoryImage());

    const first = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const second = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 2_000 },
      profile,
      previousState: first.state,
      previousSnapshot: first.snapshot,
    });

    expect(context.sampleVideoRegion).toHaveBeenCalledWith(region, false, 480);
    expect(first.shouldAlert).toBe(false);
    expect(second.shouldAlert).toBe(true);
    expect(second.snapshot?.detected).toBe(true);
    expect(second.snapshot?.bagFullDetected).toBe(true);
    expect(second.snapshot?.layoutValid).toBe(true);
    expect(second.snapshot?.previewImageData).not.toBeNull();
  });

  it("confirms a horizontally compressed full count after two samples", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const context = createContext(createCompressedFullInventoryImage());

    const first = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const second = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 2_000 },
      profile,
      previousState: first.state,
      previousSnapshot: first.snapshot,
    });

    expect(first.snapshot?.largestBagWarmClusterWidth).toBe(4);
    expect(first.snapshot?.largestBagWarmClusterHeight).toBe(2);
    expect(first.shouldAlert).toBe(false);
    expect(second.shouldAlert).toBe(true);
  });

  it("does not confirm repeated narrow vertical combat effects", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const context = createContext(createVerticalCombatEffectImage());

    const first = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const second = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 2_000 },
      profile,
      previousState: first.state,
      previousSnapshot: first.snapshot,
    });
    const third = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 3_000 },
      profile,
      previousState: second.state,
      previousSnapshot: second.snapshot,
    });

    expect(first.snapshot?.largestBagWarmClusterWidth).toBe(4);
    expect(first.snapshot?.largestBagWarmClusterHeight).toBe(10);
    expect(first.snapshot?.bagCountState).toBe("unreadable");
    expect(first.shouldAlert).toBe(false);
    expect(second.shouldAlert).toBe(false);
    expect(third.shouldAlert).toBe(false);
  });

  it("does not combine intermittent off-row combat tint into an alert for report 65aeea58-274e-4983-a975-652910c63b05", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const firstContext = createContext(createOffRowCombatTintImage());
    const first = processUltimaRaidEquipmentFrame({
      context: firstContext,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const clearContext = createContext(createClearInventoryImage());
    const second = processUltimaRaidEquipmentFrame({
      context: { ...clearContext, sampledAt: 2_000 },
      profile,
      previousState: first.state,
      previousSnapshot: first.snapshot,
    });
    const thirdContext = createContext(createOffRowCombatTintImage());
    const third = processUltimaRaidEquipmentFrame({
      context: { ...thirdContext, sampledAt: 3_000 },
      profile,
      previousState: second.state,
      previousSnapshot: second.snapshot,
    });

    expect(first.snapshot?.bagCountState).toBe("clear");
    expect(first.snapshot?.bagFullDetected).toBe(false);
    expect(first.shouldAlert).toBe(false);
    expect(second.shouldAlert).toBe(false);
    expect(third.shouldAlert).toBe(false);
    expect(third.state.recentBagDetections).toEqual([false, false, false]);
  });

  it("rearms from the cool clear count before alerting on report 9861c1f9-3edf-4a3f-acc4-a20a8df5be77", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const clearImage = createReportFixtureImage(
      "report-9861c1f9-clear-count.png",
      480,
      199,
    );
    let state: UltimaRaidEquipmentRuntimeState = {
      ...createUltimaRaidEquipmentRuntimeState("alerted"),
      alertedForCurrentPresence: true,
      lastAlertedAt: 1,
    };
    let snapshot = null;

    for (let index = 0; index < 5; index += 1) {
      const result = processUltimaRaidEquipmentFrame({
        context: {
          ...createContext(clearImage),
          sampledAt: 1_000 + index * 1_000,
        },
        profile,
        previousState: state,
        previousSnapshot: snapshot,
      });
      state = result.state;
      snapshot = result.snapshot;

      expect(result.shouldAlert).toBe(false);
      expect(result.snapshot?.bagCountState).toBe("clear");
      expect(result.snapshot?.bagCountReadable).toBe(true);
    }

    expect(state.alertedForCurrentPresence).toBe(false);
    expect(state.consecutiveBagAbsentFrames).toBe(5);

    const fullImage = createReportFixtureImage(
      "report-9861c1f9-full-count.png",
      480,
      199,
    );
    const firstFull = processUltimaRaidEquipmentFrame({
      context: { ...createContext(fullImage), sampledAt: 6_000 },
      profile,
      previousState: state,
      previousSnapshot: snapshot,
    });
    const secondFull = processUltimaRaidEquipmentFrame({
      context: { ...createContext(fullImage), sampledAt: 7_000 },
      profile,
      previousState: firstFull.state,
      previousSnapshot: firstFull.snapshot,
    });

    expect(firstFull.snapshot?.bagFullDetected).toBe(true);
    expect(firstFull.shouldAlert).toBe(false);
    expect(secondFull.shouldAlert).toBe(true);
  });

  it("rejects the right-edge combat tint sequence from report f65bc3ee-dae7-486d-a56f-12766c2218cc", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    let state = createUltimaRaidEquipmentRuntimeState();
    let snapshot = null;

    for (const [index, fixture] of [
      "report-f65bc3ee-false-warm-1.png",
      "report-f65bc3ee-false-warm-2.png",
      "report-f65bc3ee-false-warm-3.png",
    ].entries()) {
      const result = processUltimaRaidEquipmentFrame({
        context: {
          ...createContext(createReportFixtureImage(fixture, 480, 192)),
          sampledAt: 1_000 + index * 1_000,
        },
        profile,
        previousState: state,
        previousSnapshot: snapshot,
      });
      state = result.state;
      snapshot = result.snapshot;

      expect(result.snapshot?.largestBagWarmClusterXRatio).toBeGreaterThanOrEqual(
        0.7,
      );
      expect(result.snapshot?.bagWarmComponentValid).toBe(false);
      expect(result.snapshot?.bagFullDetected).toBe(false);
      expect(result.shouldAlert).toBe(false);
    }

    expect(state.recentBagDetections).toEqual([false, false, false]);
  });

  it("rejects the isolated left-side combat tint sequence from report d544182f-efcd-45b9-96ac-89a21351971a", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    let state = createUltimaRaidEquipmentRuntimeState();
    let snapshot = null;

    for (const [index, fixture] of [
      "report-d544182f-false-warm-1.png",
      "report-d544182f-false-warm-2.png",
    ].entries()) {
      const result = processUltimaRaidEquipmentFrame({
        context: {
          ...createContext(createReportFixtureImage(fixture, 397, 168)),
          sampledAt: 1_000 + index * 1_000,
        },
        profile,
        previousState: state,
        previousSnapshot: snapshot,
      });
      state = result.state;
      snapshot = result.snapshot;

      expect(result.snapshot?.largestBagWarmClusterXRatio).toBeLessThan(0.14);
      expect(result.snapshot?.bagWarmComponentValid).toBe(false);
      expect(result.snapshot?.bagFullDetected).toBe(false);
      expect(result.shouldAlert).toBe(false);
    }

    expect(state.recentBagDetections).toEqual([false, false]);
  });

  it("alerts on the distributed full-count sequence from report 29459db2-c380-4f1e-8545-566ce01cf0b8", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const context = createContext(createDistributedRightEdgeFullInventoryImage());
    const first = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const second = processUltimaRaidEquipmentFrame({
      context: {
        ...createContext(createIsolatedRightEdgeFullInventoryImage()),
        sampledAt: 2_000,
      },
      profile,
      previousState: first.state,
      previousSnapshot: first.snapshot,
    });
    const third = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 3_000 },
      profile,
      previousState: second.state,
      previousSnapshot: second.snapshot,
    });

    expect(first.snapshot?.largestBagWarmClusterXRatio).toBeGreaterThan(0.7);
    expect(first.snapshot?.bagWarmComponentValid).toBe(true);
    expect(first.snapshot?.bagFullDetected).toBe(true);
    expect(first.shouldAlert).toBe(false);
    expect(second.snapshot?.bagWarmComponentValid).toBe(false);
    expect(second.snapshot?.fullBannerDetected).toBe(true);
    expect(second.shouldAlert).toBe(false);
    expect(third.shouldAlert).toBe(true);
  });

  it("does not sample when the feature has no region", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
    };
    const context = createContext(createFullInventoryImage());

    const result = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });

    expect(context.sampleVideoRegion).not.toHaveBeenCalled();
    expect(result.state.status).toBe("no-region");
  });

  it("uses the same crop once for the boss alert when the equipment alert is off", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: false,
      bossAlert: {
        ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
        enabled: true,
      },
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const normalContext = createContext(createNormalProgressImage());
    const armed = processUltimaRaidEquipmentFrame({
      context: normalContext,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const bossContext = createContext(createBossProgressImage());
    const firstBoss = processUltimaRaidEquipmentFrame({
      context: { ...bossContext, sampledAt: 2_000 },
      profile,
      previousState: armed.state,
      previousSnapshot: armed.snapshot,
    });
    const secondBoss = processUltimaRaidEquipmentFrame({
      context: { ...bossContext, sampledAt: 3_000 },
      profile,
      previousState: firstBoss.state,
      previousSnapshot: firstBoss.snapshot,
    });

    expect(normalContext.sampleVideoRegion).toHaveBeenCalledTimes(1);
    expect(bossContext.sampleVideoRegion).toHaveBeenCalledTimes(2);
    expect(armed.state.status).toBe("paused");
    expect(armed.state.boss.armed).toBe(true);
    expect(firstBoss.bossShouldAlert).toBe(false);
    expect(secondBoss.bossShouldAlert).toBe(true);
    expect(secondBoss.shouldAlert).toBe(false);
    expect(secondBoss.snapshot?.bossProgressState).toBe("boss");
  });

  it("alerts when a boss is visible from the first retained frame in report c8ef17e0-4991-4384-8c99-3b87ec97763e", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: false,
      bossAlert: {
        ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
        enabled: true,
      },
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const context = createContext(createBossProgressImage());
    const first = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const second = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 2_000 },
      profile,
      previousState: first.state,
      previousSnapshot: first.snapshot,
    });
    const third = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 3_000 },
      profile,
      previousState: second.state,
      previousSnapshot: second.snapshot,
    });

    expect(first.state.boss.status).toBe("candidate");
    expect(first.bossShouldAlert).toBe(false);
    expect(second.state.boss.status).toBe("active");
    expect(second.bossShouldAlert).toBe(true);
    expect(third.bossShouldAlert).toBe(false);
  });

  it("marks the legacy bag-only crop as invalid without alerting", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const context = createContext(createImage(80, 100));

    const result = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });

    expect(result.state.status).toBe("invalid-region");
    expect(result.shouldAlert).toBe(false);
    expect(result.snapshot?.layoutValid).toBe(false);
  });

  it("refreshes the panel preview from its own capture timestamp", () => {
    const profile = createDefaultProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1920x1080": region },
    };
    const context = createContext(createImage(392, 160));

    const first = processUltimaRaidEquipmentFrame({
      context,
      profile,
      previousState: createUltimaRaidEquipmentRuntimeState(),
      previousSnapshot: null,
    });
    const second = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 2_000 },
      profile,
      previousState: first.state,
      previousSnapshot: first.snapshot,
    });
    const third = processUltimaRaidEquipmentFrame({
      context: { ...context, sampledAt: 3_000 },
      profile,
      previousState: second.state,
      previousSnapshot: second.snapshot,
    });

    expect(first.snapshot?.previewSampledAt).toBe(1_000);
    expect(second.snapshot?.previewSampledAt).toBe(1_000);
    expect(second.snapshot?.previewImageData).toBe(
      first.snapshot?.previewImageData,
    );
    expect(third.snapshot?.previewSampledAt).toBe(3_000);
    expect(third.snapshot?.previewImageData).not.toBe(
      second.snapshot?.previewImageData,
    );
  });
});

const region = { x: 0.2, y: 0.3, width: 0.25, height: 0.2 };

function createContext(imageData: ImageData): MonitoringFrameContext {
  return {
    sampledAt: 1_000,
    video: {} as HTMLVideoElement,
    captureFrameLayoutKey: "1920x1080",
    gameFrameLayoutKey: "1920x1080",
    gameViewport: {
      mode: "legacy-passthrough",
      sourceSize: { width: 1920, height: 1080 },
      gameResolution: { width: 1920, height: 1080 },
      region: { x: 0, y: 0, width: 1920, height: 1080 },
      layoutKey: "1920x1080",
      revision: 0,
    },
    frameLayoutKey: "1920x1080",
    masterVolume: 0.8,
    sampleSkill: vi.fn(),
    sampleBuffSlotFrame: vi.fn(),
    sampleGameVideoRegion: vi.fn(),
    sampleVideoRegion: vi.fn(() => ({
      imageData,
      rawPreviewUrl: null,
      region: { x: 384, y: 324, width: 480, height: 216 },
    })),
  };
}

function createFullInventoryImage(): ImageData {
  const image = createImage(392, 160);
  const startX = Math.round(image.width * 0.06);
  const startY = Math.round(image.height * 0.535);

  for (let y = startY; y < startY + 8; y += 1) {
    for (let x = startX; x < startX + 10; x += 1) {
      image.data.set([255, 214, 28, 255], (y * image.width + x) * 4);
    }
  }
  return image;
}

function createCompressedFullInventoryImage(): ImageData {
  const image = createImage(395, 163);
  const startX = Math.floor(image.width * 0.066);
  const startY = Math.floor(image.height * 0.558);

  paintRect(image, startX, startY, 4, 2, [216, 228, 175, 255]);
  paintRect(image, startX + 6, startY, 10, 4, [238, 242, 236, 255]);
  return image;
}

function createVerticalCombatEffectImage(): ImageData {
  const image = createImage(384, 152);
  const startX = Math.floor(image.width * 0.09);
  const startY = Math.floor(image.height * 0.52);

  paintRect(image, startX, startY, 4, 10, [216, 191, 126, 255]);
  paintRect(
    image,
    Math.floor(image.width * 0.045),
    Math.floor(image.height * 0.53),
    9,
    4,
    [238, 242, 236, 255],
  );
  return image;
}

function createClearInventoryImage(): ImageData {
  const image = createImage(388, 163);
  paintRect(
    image,
    Math.round(image.width * 0.065),
    Math.round(image.height * 0.535),
    6,
    3,
    [238, 242, 236, 255],
  );
  return image;
}

function createOffRowCombatTintImage(): ImageData {
  const image = createClearInventoryImage();
  const regionRight = Math.ceil(image.width * 0.115);
  const regionBottom = Math.ceil(image.height * 0.625);
  paintRect(
    image,
    regionRight - 3,
    regionBottom - 4,
    2,
    3,
    [216, 191, 126, 255],
  );
  return image;
}

function createNormalProgressImage(): ImageData {
  const image = createImage(392, 160);
  paintRelativeRect(image, 0.39, 0.845, 0.24, 0.065, [
    60,
    196,
    214,
    255,
  ]);
  return image;
}

function createBossProgressImage(): ImageData {
  const image = createImage(392, 160);
  paintRelativeRect(image, 0.39, 0.845, 0.31, 0.065, [
    244,
    55,
    124,
    255,
  ]);
  return image;
}

function paintRelativeRect(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) {
  const left = Math.floor(image.width * x);
  const top = Math.floor(image.height * y);
  const right = Math.ceil(image.width * (x + width));
  const bottom = Math.ceil(image.height * (y + height));

  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      image.data.set(color, (row * image.width + column) * 4);
    }
  }
}

function paintRect(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      image.data.set(color, (row * image.width + column) * 4);
    }
  }
}

function createImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([54, 126, 156, 255], offset);
  }
  const image = {
    width,
    height,
    colorSpace: "srgb",
    data,
  } as ImageData;

  return image;
}

function createDistributedRightEdgeFullInventoryImage(): ImageData {
  return createRightEdgeFullInventoryImage(true);
}

function createIsolatedRightEdgeFullInventoryImage(): ImageData {
  return createRightEdgeFullInventoryImage(false);
}

function createRightEdgeFullInventoryImage(distributed: boolean): ImageData {
  const image = createImage(393, 162);
  const regionLeft = Math.floor(image.width * 0.035);
  const regionTop = Math.floor(image.height * 0.49);
  const rowTop = regionTop + 11;
  const warm = [216, 228, 175, 255] as const;
  const readable = [238, 242, 236, 255] as const;

  if (distributed) {
    paintRect(image, regionLeft + 5, rowTop, 2, 3, warm);
    paintRect(image, regionLeft + 15, rowTop, 2, 3, warm);
  }
  paintRect(image, regionLeft + 24, rowTop, 2, 4, warm);
  paintRect(image, regionLeft + 1, rowTop, 2, 4, readable);
  paintRect(image, regionLeft + 10, rowTop, 2, 4, readable);
  paintRect(image, regionLeft + 20, rowTop, 2, 4, readable);
  paintRelativeRect(image, 0.23, 0.045, 0.54, 0.11, [238, 61, 123, 255]);

  return image;
}

function createReportFixtureImage(
  fileName: string,
  width: number,
  height: number,
): ImageData {
  const fixturePath = resolve(
    "src/recognition/ultima-raid-equipment/__fixtures__",
    fileName,
  );
  const patch = PNG.sync.read(readFileSync(fixturePath));
  const image = createImage(width, height);
  const left = Math.floor(width * 0.035);
  const top = Math.floor(height * 0.49);
  const right = Math.ceil(width * 0.115);
  const bottom = Math.ceil(height * 0.625);

  if (patch.width !== right - left || patch.height !== bottom - top) {
    throw new Error(`Unexpected Ultima report fixture size: ${fileName}`);
  }

  for (let row = 0; row < patch.height; row += 1) {
    for (let column = 0; column < patch.width; column += 1) {
      const sourceOffset = (row * patch.width + column) * 4;
      const targetOffset =
        ((top + row) * image.width + left + column) * 4;
      image.data.set(
        patch.data.subarray(sourceOffset, sourceOffset + 4),
        targetOffset,
      );
    }
  }

  return image;
}
