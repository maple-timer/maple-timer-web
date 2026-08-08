import { describe, expect, it } from "vitest";
import {
  detectUltimaRaidInventoryFull,
  isBagFullWarmPixel,
} from "./inventoryFullDetector";

describe("inventoryFullDetector", () => {
  it("accepts yellow and orange bag-number colors without accepting white or cyan", () => {
    expect(isBagFullWarmPixel(255, 214, 28)).toBe(true);
    expect(isBagFullWarmPixel(244, 126, 24)).toBe(true);
    expect(isBagFullWarmPixel(238, 242, 236)).toBe(false);
    expect(isBagFullWarmPixel(82, 210, 224)).toBe(false);
  });

  it.each([
    { width: 392, height: 160, digits: 1 },
    { width: 784, height: 320, digits: 2 },
    { width: 980, height: 400, digits: 3 },
  ])(
    "detects a gold full-state number independently of scale and digit count",
    ({ width, height, digits }) => {
      const image = createUltimaRaidImage(width, height);
      paintBagNumber(image, digits, [255, 214, 28, 255]);

      const result = detectUltimaRaidInventoryFull(image);

      expect(result.layoutValid).toBe(true);
      expect(result.bagCountState).toBe("full");
      expect(result.bagFullDetected).toBe(true);
      expect(result.source).toBe("bag-number");
      expect(result.detected).toBe(true);
    },
  );

  it.each([
    { width: 392, height: 160, rowRatio: 0.525 },
    { width: 784, height: 320, rowRatio: 0.545 },
    { width: 980, height: 400, rowRatio: 0.56 },
  ])(
    "finds the count row dynamically at $width x $height and y=$rowRatio",
    ({ width, height, rowRatio }) => {
      const image = createUltimaRaidImage(width, height);
      paintBagNumber(image, 2, [255, 214, 28, 255], rowRatio);

      const result = detectUltimaRaidInventoryFull(image);

      expect(result.bagCountRowTopRatio).toBeGreaterThan(0);
      expect(result.bagCountRowHeightRatio).toBeGreaterThan(0);
      expect(result.bagFullDetected).toBe(true);
    },
  );

  it("rejects a white available-capacity number", () => {
    const image = createUltimaRaidImage(392, 160);
    paintBagNumber(image, 2, [238, 242, 236, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.layoutValid).toBe(true);
    expect(result.bagCountState).toBe("clear");
    expect(result.bagCountReadable).toBe(true);
    expect(result.bagFullDetected).toBe(false);
    expect(result.detected).toBe(false);
  });

  it("reads a cool cyan available-capacity number as clear", () => {
    const image = createUltimaRaidImage(480, 199);
    paintBagNumber(image, 3, [130, 205, 225, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.layoutValid).toBe(true);
    expect(result.bagReadablePixelCount).toBeGreaterThan(0);
    expect(result.bagCountState).toBe("clear");
    expect(result.bagCountReadable).toBe(true);
    expect(result.bagFullDetected).toBe(false);
  });

  it("accepts a compact warm glyph fragment after screen-share resampling", () => {
    const image = createUltimaRaidImage(392, 160);
    const startX = Math.floor(image.width * 0.05);
    const startY = Math.floor(image.height * 0.54);

    paintRect(image, startX, startY, 2, 4, [216, 228, 175, 255]);
    for (let index = 0; index < 38; index += 1) {
      paintPixel(
        image,
        startX + 4 + (index % 10),
        startY + Math.floor(index / 10),
        [238, 242, 236, 255],
      );
    }

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.bagWarmPixelRatio).toBeCloseTo(8 / 46);
    expect(result.largestBagWarmClusterSize).toBe(8);
    expect(result.bagWarmComponentValid).toBe(true);
    expect(result.bagFullDetected).toBe(true);
  });

  it("accepts a horizontally compressed full number from report 638cb4de-82cd-4386-b3fd-d03aecc19eeb", () => {
    const image = createUltimaRaidImage(395, 163);
    const startX = Math.floor(image.width * 0.066);
    const startY = Math.floor(image.height * 0.558);

    paintRect(image, startX, startY, 4, 2, [216, 228, 175, 255]);
    for (let index = 0; index < 40; index += 1) {
      paintPixel(
        image,
        startX + 6 + (index % 10),
        startY + Math.floor(index / 10),
        [238, 242, 236, 255],
      );
    }

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.largestBagWarmClusterSize).toBe(8);
    expect(result.largestBagWarmClusterWidth).toBe(4);
    expect(result.largestBagWarmClusterHeight).toBe(2);
    expect(result.bagWarmComponentValid).toBe(true);
    expect(result.bagFullDetected).toBe(true);
  });

  it("accepts connected full-count digits after lossy report preview encoding", () => {
    const image = createUltimaRaidImage(395, 163);
    const startX = Math.floor(image.width * 0.066);
    const startY = Math.floor(image.height * 0.558);

    paintRect(image, startX, startY, 13, 4, [216, 228, 175, 255]);
    for (let index = 0; index < 24; index += 1) {
      paintPixel(
        image,
        startX + (index % 8),
        startY + 6 + Math.floor(index / 8),
        [238, 242, 236, 255],
      );
    }

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.largestBagWarmClusterWidth).toBe(13);
    expect(result.largestBagWarmClusterHeight).toBe(4);
    expect(result.bagWarmComponentValid).toBe(true);
    expect(result.bagFullDetected).toBe(true);
  });

  it("rejects an oversized message glyph that is not horizontally digit-like", () => {
    const image = createUltimaRaidImage(395, 163);
    const startX = Math.floor(image.width * 0.055);
    const startY = Math.floor(image.height * 0.51);

    paintRect(image, startX, startY, 13, 12, [216, 191, 126, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.bagWarmComponentTouchesBoundary).toBe(false);
    expect(result.bagWarmComponentValid).toBe(false);
    expect(result.bagFullDetected).toBe(false);
  });

  it.each([
    { width: 4, height: 10 },
    { width: 3, height: 11 },
  ])(
    "rejects a narrow $width x $height combat effect from report 663d8946-9a45-49e9-9023-b73b58aa7a11",
    ({ width, height }) => {
      const image = createUltimaRaidImage(384, 152);
      const startX = Math.floor(image.width * 0.09);
      const startY = Math.floor(image.height * 0.52);

      paintRect(image, startX, startY, width, height, [216, 191, 126, 255]);
      for (let index = 0; index < 36; index += 1) {
        paintPixel(
          image,
          Math.floor(image.width * 0.045) + (index % 9),
          Math.floor(image.height * 0.53) + Math.floor(index / 9),
          [238, 242, 236, 255],
        );
      }

      const result = detectUltimaRaidInventoryFull(image);

      expect(result.largestBagWarmClusterWidth).toBe(width);
      expect(result.largestBagWarmClusterHeight).toBe(height);
      expect(result.bagWarmComponentTouchesBoundary).toBe(false);
      expect(result.bagWarmComponentValid).toBe(false);
      expect(result.bagCountState).toBe("unreadable");
      expect(result.bagFullDetected).toBe(false);
    },
  );

  it.each([
    {
      reportId: "963d3a81-b116-42e1-afd9-b1b087307b16",
      paint: (image: ImageData) => {
        const right = Math.ceil(image.width * 0.115) - 1;
        const top = Math.floor(image.height * 0.49) + 2;
        paintRect(image, right, top, 1, 18, [216, 191, 126, 255]);
      },
    },
    {
      reportId: "b36bc9e6-0541-48fc-b4ab-49ed95c8ff0d",
      paint: (image: ImageData) => {
        const right = Math.ceil(image.width * 0.115) - 1;
        const top = Math.floor(image.height * 0.49);
        paintRect(image, right, top, 1, 19, [216, 191, 126, 255]);
      },
    },
  ])(
    "rejects a warm UI edge instead of treating report $reportId as a full bag",
    ({ paint }) => {
      const image = createUltimaRaidImage(392, 160);
      paint(image);

      const result = detectUltimaRaidInventoryFull(image);

      expect(result.bagWarmComponentTouchesBoundary).toBe(true);
      expect(result.bagWarmComponentValid).toBe(false);
      expect(result.bagCountOccluded).toBe(true);
      expect(result.bagCountState).toBe("unreadable");
      expect(result.bagFullDetected).toBe(false);
    },
  );

  it("rejects a tiny transition fragment from report d1373faa-0def-4724-8e0b-a0a5f1cbd435", () => {
    const image = createUltimaRaidImage(392, 160);
    const startX = Math.floor(image.width * 0.065);
    const startY = Math.floor(image.height * 0.54);
    paintRect(image, startX, startY, 2, 2, [216, 191, 126, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.largestBagWarmClusterSize).toBe(4);
    expect(result.bagWarmComponentValid).toBe(false);
    expect(result.bagCountOccluded).toBe(true);
    expect(result.bagFullDetected).toBe(false);
  });

  it("rejects a yellow stage message crossing the bag area from report 4f5f25a9-b3a2-4d60-b355-d0010197bab6", () => {
    const image = createUltimaRaidImage(480, 197);
    const left = Math.floor(image.width * 0.035) + 1;
    const top = Math.floor(image.height * 0.49);
    paintRect(image, left, top, 13, 12, [148, 154, 80, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.bagWarmComponentTouchesBoundary).toBe(true);
    expect(result.bagWarmComponentValid).toBe(false);
    expect(result.bagCountState).toBe("unreadable");
    expect(result.bagFullDetected).toBe(false);
  });

  it("detects the long full-inventory banner in the expected top area", () => {
    const image = createUltimaRaidImage(392, 160);
    paintRelativeRect(image, 0.23, 0.045, 0.54, 0.11, [238, 61, 123, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.fullBannerDetected).toBe(true);
    expect(result.source).toBe("full-banner");
    expect(result.bannerWidthRatio).toBeGreaterThan(0.5);
  });

  it("rejects warm combat effects and a small pink effect outside semantic regions", () => {
    const image = createUltimaRaidImage(392, 160);
    paintRelativeRect(image, 0.45, 0.35, 0.2, 0.2, [255, 214, 28, 255]);
    paintRelativeRect(image, 0.7, 0.03, 0.04, 0.03, [238, 61, 123, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.bagFullDetected).toBe(false);
    expect(result.fullBannerDetected).toBe(false);
    expect(result.detected).toBe(false);
  });

  it("rejects the legacy bag-only crop and requests the full raid layout", () => {
    const image = createImage(80, 100);
    paintRect(image, 15, 50, 12, 8, [255, 214, 28, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.layoutValid).toBe(false);
    expect(result.detected).toBe(false);
  });

  it("requires a warm-number ratio instead of only a few tinted pixels", () => {
    const image = createUltimaRaidImage(392, 160);
    paintBagNumber(image, 2, [238, 242, 236, 255]);
    const warmX = Math.floor(image.width * 0.05);
    const warmY = Math.floor(image.height * 0.54);
    for (let index = 0; index < 3; index += 1) {
      paintPixel(image, warmX + index, warmY, [255, 214, 28, 255]);
    }

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.bagWarmPixelCount).toBeGreaterThan(0);
    expect(result.largestBagWarmClusterSize).toBeLessThan(4);
    expect(result.bagFullDetected).toBe(false);
  });

  it("rejects a warm fragment confined to the right edge of the count band", () => {
    const image = createUltimaRaidImage(480, 192);
    paintBagNumber(image, 3, [238, 242, 236, 255]);
    const regionLeft = Math.floor(image.width * 0.035);
    const regionWidth =
      Math.ceil(image.width * 0.115) - regionLeft;
    const startX = regionLeft + Math.floor(regionWidth * 0.75);
    const startY = Math.round(image.height * 0.535);
    paintRect(image, startX, startY, 4, 4, [216, 191, 126, 255]);

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.largestBagWarmClusterXRatio).toBeGreaterThanOrEqual(0.7);
    expect(result.bagWarmComponentValid).toBe(false);
    expect(result.bagCountState).toBe("unreadable");
    expect(result.bagFullDetected).toBe(false);
  });

  it("accepts distributed full-count glyphs from report 29459db2-c380-4f1e-8545-566ce01cf0b8", () => {
    const image = createDistributedRightEdgeFullInventoryImage();

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.largestBagWarmClusterWidth).toBe(2);
    expect(result.largestBagWarmClusterHeight).toBe(4);
    expect(result.largestBagWarmClusterXRatio).toBeGreaterThan(0.7);
    expect(
      result.bagWarmPixelCount - result.largestBagWarmClusterSize,
    ).toBeGreaterThanOrEqual(8);
    expect(result.fullBannerDetected).toBe(true);
    expect(result.bagWarmComponentValid).toBe(true);
    expect(result.bagCountState).toBe("full");
    expect(result.bagFullDetected).toBe(true);
  });

  it("ignores a 2x3 combat tint below the count row from report 65aeea58-274e-4983-a975-652910c63b05", () => {
    const image = createUltimaRaidImage(388, 163);
    const countY = Math.round(image.height * 0.535);
    paintRect(
      image,
      Math.round(image.width * 0.065),
      countY,
      6,
      3,
      [238, 242, 236, 255],
    );
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

    const result = detectUltimaRaidInventoryFull(image);

    expect(result.bagCountState).toBe("clear");
    expect(result.bagWarmPixelCount).toBe(0);
    expect(result.largestBagWarmClusterSize).toBe(0);
    expect(result.bagFullDetected).toBe(false);
    expect(result.detected).toBe(false);
  });
});

function createImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([54, 126, 156, 255], offset);
  }
  return {
    width,
    height,
    colorSpace: "srgb",
    data,
  } as ImageData;
}

function createUltimaRaidImage(width: number, height: number): ImageData {
  return createImage(width, height);
}

function createDistributedRightEdgeFullInventoryImage(): ImageData {
  const image = createUltimaRaidImage(393, 162);
  const regionLeft = Math.floor(image.width * 0.035);
  const regionTop = Math.floor(image.height * 0.49);
  const rowTop = regionTop + 11;
  const warm = [216, 228, 175, 255] as const;
  const readable = [238, 242, 236, 255] as const;

  paintRect(image, regionLeft + 5, rowTop, 2, 3, warm);
  paintRect(image, regionLeft + 15, rowTop, 2, 3, warm);
  paintRect(image, regionLeft + 24, rowTop, 2, 4, warm);
  paintRect(image, regionLeft + 1, rowTop, 2, 4, readable);
  paintRect(image, regionLeft + 10, rowTop, 2, 4, readable);
  paintRect(image, regionLeft + 20, rowTop, 2, 4, readable);
  paintRelativeRect(image, 0.23, 0.045, 0.54, 0.11, [238, 61, 123, 255]);

  return image;
}

function paintBagNumber(
  image: ImageData,
  digitCount: number,
  color: readonly [number, number, number, number],
  rowRatio = 0.535,
) {
  const digitWidth = Math.max(2, Math.round(image.width * 0.009));
  const digitHeight = Math.max(3, Math.round(image.height * 0.045));
  const gap = Math.max(1, Math.round(image.width * 0.003));
  const totalWidth = digitCount * digitWidth + (digitCount - 1) * gap;
  const centerX = Math.round(image.width * 0.075);
  const startX = centerX - Math.floor(totalWidth / 2);
  const startY = Math.round(image.height * rowRatio);

  for (let digit = 0; digit < digitCount; digit += 1) {
    paintRect(
      image,
      startX + digit * (digitWidth + gap),
      startY,
      digitWidth,
      digitHeight,
      color,
    );
  }
}

function paintRelativeRect(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) {
  paintRect(
    image,
    Math.floor(image.width * x),
    Math.floor(image.height * y),
    Math.ceil(image.width * width),
    Math.ceil(image.height * height),
    color,
  );
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
      paintPixel(image, column, row, color);
    }
  }
}

function paintPixel(
  image: ImageData,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
) {
  const offset = (y * image.width + x) * 4;
  image.data.set(color, offset);
}
