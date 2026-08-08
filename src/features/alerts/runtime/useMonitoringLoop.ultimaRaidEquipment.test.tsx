import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultUltimaRaidEquipmentAlert } from "../../../lib/storage";
import {
  MonitoringHarness,
  cleanupMonitoringLoopTestHarness,
  createProfile,
  playAlertUntilEndedMock,
  resetMonitoringLoopTestMocks,
  sampleVideoRegionMock,
} from "./useMonitoringLoopTestHarness";

vi.mock(
  "../../../platform/frame-capture/ultima-raid-equipment/ultimaRaidEquipmentEvidenceCapture",
  () => ({
    encodeUltimaRaidEquipmentEvidenceFrame: vi.fn(
      () => "data:image/webp;base64,VUxUSU1B",
    ),
  }),
);

describe("useMonitoringLoop Ultima Squad equipment alert", () => {
  beforeEach(() => {
    resetMonitoringLoopTestMocks();
  });

  afterEach(() => {
    cleanupMonitoringLoopTestHarness();
  });

  it("plays an alert when the selected Ultima Squad UI confirms a full bag", async () => {
    sampleVideoRegionMock.mockReturnValue(createSample(createFullInventoryImage()));

    render(
      <MonitoringHarness
        profile={createUltimaRaidProfile()}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sampleVideoRegionMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      region,
      false,
      480,
    );
    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();

    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
  });

  it("rearms after the bag clears even when the full banner remains visible", async () => {
    let image = createFullInventoryImage();
    sampleVideoRegionMock.mockImplementation(() => createSample(image));

    render(
      <MonitoringHarness
        profile={createUltimaRaidProfile()}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);

    image = createBannerOnlyImage();
    await advanceMonitoringTime(5_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);

    image = createFullInventoryImage();
    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);

    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(2);
  });

  it("plays the boss sound after the shared crop changes from normal to boss progress", async () => {
    let image = createNormalProgressImage();
    sampleVideoRegionMock.mockImplementation(() => createSample(image));

    render(
      <MonitoringHarness
        profile={createUltimaRaidBossProfile()}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();

    image = createBossProgressImage();
    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).not.toHaveBeenCalled();

    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
    expect(playAlertUntilEndedMock).toHaveBeenCalledWith(
      "boss-alert",
      expect.any(Number),
      expect.any(Object),
    );
    expect(sampleVideoRegionMock).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      region,
      false,
      480,
    );
  });

  it("finishes the configured equipment repeats after the bag is cleared", async () => {
    let image = createFullInventoryImage();
    sampleVideoRegionMock.mockImplementation(() => createSample(image));
    const profile = createUltimaRaidProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...profile.ultimaRaidEquipmentAlert!,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 2,
      repeatAlertMaxCount: 2,
    };

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);

    image = createBannerOnlyImage();
    await advanceMonitoringTime(2_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(2);

    await advanceMonitoringTime(2_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(3);

    await advanceMonitoringTime(4_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(3);
  });

  it("finishes the configured boss repeat after the boss bar disappears", async () => {
    let image = createNormalProgressImage();
    sampleVideoRegionMock.mockImplementation(() => createSample(image));
    const profile = createUltimaRaidBossProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...profile.ultimaRaidEquipmentAlert!,
      bossAlert: {
        ...profile.ultimaRaidEquipmentAlert!.bossAlert,
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 2,
        repeatAlertMaxCount: 1,
      },
    };

    render(
      <MonitoringHarness
        profile={profile}
        stream={{} as MediaStream}
        onReady={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    image = createBossProgressImage();
    await advanceMonitoringTime(2_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);

    image = createNormalProgressImage();
    await advanceMonitoringTime(2_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(2);

    await advanceMonitoringTime(4_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(2);
  });

  it("cancels pending repeats when the user turns repeat off", async () => {
    sampleVideoRegionMock.mockReturnValue(createSample(createFullInventoryImage()));
    const profile = createUltimaRaidProfile();
    profile.ultimaRaidEquipmentAlert = {
      ...profile.ultimaRaidEquipmentAlert!,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 3,
    };
    const stream = {} as MediaStream;
    const rendered = render(
      <MonitoringHarness
        profile={profile}
        stream={stream}
        onReady={vi.fn()}
      />,
    );

    await advanceMonitoringTime(1_000);
    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <MonitoringHarness
        profile={{
          ...profile,
          ultimaRaidEquipmentAlert: {
            ...profile.ultimaRaidEquipmentAlert!,
            repeatAlertEnabled: false,
          },
        }}
        stream={stream}
        onReady={vi.fn()}
      />,
    );
    await advanceMonitoringTime(5_000);

    expect(playAlertUntilEndedMock).toHaveBeenCalledTimes(1);
  });
});

const region = { x: 0.1, y: 0.2, width: 0.4, height: 0.3 };

function createUltimaRaidProfile() {
  return createProfile({
    ultimaRaidEquipmentAlert: {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: true,
      region,
      regionsByLayout: { "1280x720": region },
    },
  });
}

function createUltimaRaidBossProfile() {
  return createProfile({
    ultimaRaidEquipmentAlert: {
      ...createDefaultUltimaRaidEquipmentAlert(),
      enabled: false,
      bossAlert: {
        ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
        enabled: true,
        soundId: "boss-alert",
      },
      region,
      regionsByLayout: { "1280x720": region },
    },
  });
}

function createSample(imageData: ImageData) {
  return {
    imageData,
    rawPreviewUrl: null,
    region: { x: 128, y: 144, width: 512, height: 216 },
  };
}

function createFullInventoryImage(): ImageData {
  const image = createBannerOnlyImage();
  const startX = Math.round(image.width * 0.06);
  const startY = Math.round(image.height * 0.535);

  fillRect(image, startX, startY, 10, 8, [255, 214, 28, 255]);
  return image;
}

function createBannerOnlyImage(): ImageData {
  const image = createImage(392, 160, [54, 126, 156, 255]);
  fillRect(image, 72, 8, 210, 10, [235, 72, 125, 255]);
  fillRect(
    image,
    Math.round(image.width * 0.06),
    Math.round(image.height * 0.535),
    10,
    8,
    [238, 242, 236, 255],
  );
  return image;
}

function createNormalProgressImage(): ImageData {
  const image = createImage(392, 160, [54, 84, 92, 255]);
  paintRelativeRect(image, 0.39, 0.845, 0.24, 0.065, [
    60,
    196,
    214,
    255,
  ]);
  return image;
}

function createBossProgressImage(): ImageData {
  const image = createImage(392, 160, [54, 84, 92, 255]);
  paintRelativeRect(image, 0.39, 0.845, 0.31, 0.065, [
    244,
    55,
    124,
    255,
  ]);
  return image;
}

function createImage(
  width: number,
  height: number,
  color: [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(color, offset);
  }
  return new ImageData(data, width, height);
}

function fillRect(
  image: ImageData,
  startX: number,
  startY: number,
  width: number,
  height: number,
  color: [number, number, number, number],
) {
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      image.data.set(color, (y * image.width + x) * 4);
    }
  }
}

function paintRelativeRect(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number],
) {
  fillRect(
    image,
    Math.floor(image.width * x),
    Math.floor(image.height * y),
    Math.ceil(image.width * width),
    Math.ceil(image.height * height),
    color,
  );
}

async function advanceMonitoringTime(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
