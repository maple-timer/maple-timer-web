import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  preprocessCooldownImageData as preprocessImageData,
  recognizeCooldownDigits as recognizeDigits,
} from "./recognizeCooldownDigits";

const TEMPLATE_ROWS: Record<string, string[]> = {
  "0": ["11111", "10001", "10011", "10101", "11001", "10001", "11111"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "6": ["01111", "10000", "10000", "11110", "10001", "10001", "01110"],
};

const MAPLE_ROWS: Record<string, string[]> = {
  "0": [
    "111111111",
    "111111111",
    "111000111",
    "111000111",
    "111000111",
    "111000111",
    "111000111",
    "111000111",
    "111000111",
    "111000111",
    "111000111",
    "111111111",
    "011111110",
  ],
  "1": [
    "001111111",
    "111111111",
    "111111111",
    "000011111",
    "000011111",
    "000011111",
    "000011111",
    "000011111",
    "000011111",
    "000011111",
    "000011111",
    "000011111",
    "000011100",
  ],
  "2": [
    "111111111",
    "111111111",
    "000000011",
    "000000011",
    "000000011",
    "000000011",
    "000001110",
    "000111110",
    "001111110",
    "001111000",
    "111111110",
    "111111110",
    "111111110",
  ],
  "3": [
    "111111111",
    "111111111",
    "000001111",
    "000001111",
    "000111111",
    "000111111",
    "111111111",
    "111111111",
    "000001111",
    "000001111",
    "111111111",
    "111111111",
    "111111110",
  ],
  "4": [
    "000011111",
    "001111111",
    "001111111",
    "001111111",
    "001111111",
    "001111111",
    "111111111",
    "111111111",
    "111111111",
    "111111111",
    "111111111",
    "111111111",
    "000011111",
  ],
  "7": [
    "000111111",
    "111111111",
    "111111111",
    "000000111",
    "000000111",
    "000000111",
    "000011110",
    "000011110",
    "000111000",
    "000111000",
    "000111000",
    "000111000",
    "000110000",
  ],
};

const REPORTED_COOLDOWN_TWO_PROCESSED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAH4AAAB+CAYAAADiI6WIAAADYklEQVR4AezYgW7DIAxF0bD//+dukVCVIlhRCGA/X2lREgLFfmdT1P0cx/HiiJfBCf/nzk+0" +
  "BICPJp77BT4HEe0EfDTx3C/wOYhoJ+Cjied+gc9BRDvdhY+Wk1y/wMuR9jUEfF9OcrOAlyPtawj4vpzkZgEvR9rXEPB9OcnNAl6OtK+h1fB9VTFregLAT4/Y" +
  "5gbA23SZXhXw0yO2uQHwNl2mVwX89IhtbgC8TZfpVQE/PWKbG3iBt5me46qAd4w3UjrwI+k5Xgu8Y7yR0oEfSc/xWuAd442UDvxIeo7XAu8Yb6R0dfiRbKTX" +
  "Ai/N224O+HY20k+Al+ZtNwd8OxvpJ8BL87abA76djfQT4KV5280BX89GfhR4eeJ6g8DXc5EfBV6euN5gWPjX63Vcj3o8uqNh4XVJ+zoDvi8nuVnAy5H2NSQL" +
  "f31/167LeGpzrmPl/Ma9m2FZeDcCmwoFflPwu7cFfrfApv1l4VNKR0r3j9Lj+r4/r8vn3u5l4b1BrK4X+NWJG9kPeCMQq8sAfnXi9f2WjwK/PHIbGwJvw2F5" +
  "FcAvj9zGhsBnh/O7+fXIw+9TSp//E3g/cHoBvFO40bKBH03Q6XrgncKNlg38aIJ719/eHfjb0fleCLxvv9vVA387Ot8Lw8Jfv7Of1yVjSlrf28v+wsKXQUS7" +
  "Bz6aeO4X+BxEtFMY+PM9fj1K6JS03+lFv0cY+LLx6PfAB/0NAB54rQSu7/Pz+lt355z/jm/rvT3nL96b2EP1Av9QkN4+BnhvYg/VC3xnkOX7v3OZ2Wk34c32" +
  "Q2GdCQDfGZTaNODVRDv7kYVP6fN/7yk9e9+Zr9lpsvBmEzdSGPBGIFaXAfzqxI3sB7wRiNVlLIZf3R77tRIAvpWM+Djw4sCt9oBvJSM+Drw4cKs94FvJiI8D" +
  "Lw7cag/4VjLi407gxRU2tAf8htAtbAm8BYUNNQC/IXQLWwJvQWFDDcBvCN3ClsBbUNhQA/AbQrewpTi8hYht1gC8TZfpVQE/PWKbGwBv02V6VcBPj9jmBsDb" +
  "dJleFfDTI7a5AfA2XaZXBXw1Yv1B4PWNqx0CX41FfxB4feNqh8BXY9EfBF7fuNoh8NVY9AeB1zeudgh8NZa7g37WAe/H6tFKgX80Tj8fBrwfq0crBf7ROP18" +
  "2C8AAAD//11+HqsAAAAGSURBVAMAtnoajm0ww1IAAAAASUVORK5CYII=";

const REPORTED_ERDA_FOUNTAIN_EDGE_PROCESSED_PNG_BASE64 =
  "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";

function makeBinaryDigit(rows: string[], scale = 4): ImageData {
  const width = rows[0].length * scale;
  const height = rows.length * scale;
  const imageData = new ImageData(width, height);

  rows.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      const value = cell === "1" ? 255 : 0;
      for (let y = rowIndex * scale; y < (rowIndex + 1) * scale; y++) {
        for (let x = columnIndex * scale; x < (columnIndex + 1) * scale; x++) {
          const index = (y * width + x) * 4;
          imageData.data[index] = value;
          imageData.data[index + 1] = value;
          imageData.data[index + 2] = value;
          imageData.data[index + 3] = 255;
        }
      }
    });
  });

  return imageData;
}

function imageDataFromPngBase64(base64: string): ImageData {
  const png = PNG.sync.read(Buffer.from(base64, "base64"));
  return new ImageData(new Uint8ClampedArray(png.data), png.width, png.height);
}

function makeBinaryDigits(digits: string, scale = 4): ImageData {
  const gap = "0".repeat(2);
  const rows = Array.from({ length: 7 }, (_, rowIndex) =>
    [...digits].map((digit) => TEMPLATE_ROWS[digit][rowIndex]).join(gap),
  );
  return makeBinaryDigit(rows, scale);
}

function addLowerCommandNoise(source: ImageData): ImageData {
  const extraHeight = 14;
  const target = new ImageData(source.width, source.height + extraHeight);

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sourceIndex = (y * source.width + x) * 4;
      const targetIndex = (y * target.width + x) * 4;
      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = 255;
    }
  }

  const commandRows = ["1111", "1000", "1000", "1000", "1111"];
  const scale = 2;
  const offsetX = source.width - commandRows[0].length * scale - 1;
  const offsetY = source.height + 2;

  commandRows.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      if (cell !== "1") {
        return;
      }

      for (let y = offsetY + rowIndex * scale; y < offsetY + (rowIndex + 1) * scale; y++) {
        for (let x = offsetX + columnIndex * scale; x < offsetX + (columnIndex + 1) * scale; x++) {
          const index = (y * target.width + x) * 4;
          target.data[index] = 255;
          target.data[index + 1] = 255;
          target.data[index + 2] = 255;
          target.data[index + 3] = 255;
        }
      }
    });
  });

  return target;
}

function makeMapleDigits(digits: string, scale = 4): ImageData {
  const gap = "0".repeat(2);
  const rows = Array.from({ length: 13 }, (_, rowIndex) =>
    [...digits].map((digit) => MAPLE_ROWS[digit][rowIndex]).join(gap),
  );
  return makeBinaryDigit(rows, scale);
}

function drawRows(
  target: ImageData,
  rows: string[],
  offsetX: number,
  offsetY: number,
  scale: number,
) {
  rows.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      if (cell !== "1") {
        return;
      }

      for (let y = offsetY + rowIndex * scale; y < offsetY + (rowIndex + 1) * scale; y++) {
        for (let x = offsetX + columnIndex * scale; x < offsetX + (columnIndex + 1) * scale; x++) {
          const index = (y * target.width + x) * 4;
          target.data[index] = 255;
          target.data[index + 1] = 255;
          target.data[index + 2] = 255;
          target.data[index + 3] = 255;
        }
      }
    });
  });
}

function cloneImageData(source: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

function clearRightEdge(source: ImageData, width = 14) {
  for (let y = 0; y < source.height; y++) {
    for (let x = source.width - width; x < source.width; x++) {
      const index = (y * source.width + x) * 4;
      source.data[index] = 0;
      source.data[index + 1] = 0;
      source.data[index + 2] = 0;
    }
  }
}

function drawRect(target: ImageData, x0: number, y0: number, width: number, height: number) {
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      if (x < 0 || y < 0 || x >= target.width || y >= target.height) {
        continue;
      }

      const index = (y * target.width + x) * 4;
      target.data[index] = 255;
      target.data[index + 1] = 255;
      target.data[index + 2] = 255;
      target.data[index + 3] = 255;
    }
  }
}

type CropEdge = "top" | "right" | "bottom" | "left";

function getNonEmptyEdgeCombinations(): CropEdge[][] {
  const edges: CropEdge[] = ["top", "right", "bottom", "left"];
  const combinations: CropEdge[][] = [];
  for (let mask = 1; mask < 1 << edges.length; mask++) {
    combinations.push(edges.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return combinations;
}

function drawFrameEdge(target: ImageData, edge: CropEdge) {
  const thickness = 12;
  const length = 164;
  switch (edge) {
    case "top":
      drawRect(target, 0, 0, length, thickness);
      break;
    case "right":
      drawRect(target, target.width - thickness, 0, thickness, length);
      break;
    case "bottom":
      drawRect(target, 0, target.height - thickness, length, thickness);
      break;
    case "left":
      drawRect(target, 0, 0, thickness, length);
      break;
  }
}

function makeWideSkillIconCropWithCooldown(digits: string): ImageData {
  const imageData = new ImageData(152, 152);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index + 3] = 255;
  }

  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const isFrame =
        y < 10 ||
        x < 9 ||
        x >= imageData.width - 9 ||
        (y < 24 && (x < 42 || x > imageData.width - 42));
      if (!isFrame) {
        continue;
      }

      const index = (y * imageData.width + x) * 4;
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
    }
  }

  const scale = 3;
  const digitWidth = 9 * scale;
  const gap = 4;
  const totalWidth = digits.length * digitWidth + (digits.length - 1) * gap;
  let offsetX = Math.floor((imageData.width - totalWidth) / 2);
  for (const digit of digits) {
    drawRows(imageData, MAPLE_ROWS[digit], offsetX, 60, scale);
    offsetX += digitWidth + gap;
  }

  return imageData;
}

function makeErdaFountainCommandReportCrop(): ImageData {
  const imageData = new ImageData(156, 156);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index + 3] = 255;
  }

  for (let y = 0; y < 102; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const isSkillArtEdge =
        y < 10 ||
        x < 12 ||
        x >= imageData.width - 12 ||
        (y < 24 && (x < 48 || x > imageData.width - 48)) ||
        (y > 78 && (x < 36 || x > imageData.width - 36));
      if (!isSkillArtEdge) {
        continue;
      }

      const index = (y * imageData.width + x) * 4;
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
    }
  }

  drawRows(imageData, MAPLE_ROWS["2"], 51, 57, 3);
  drawRows(imageData, MAPLE_ROWS["2"], 81, 57, 3);
  drawRows(imageData, ["1111", "1000", "1000", "1000", "1111"], 120, 96, 5);
  drawRows(imageData, ["1111", "1000", "1111"], 111, 114, 5);

  return imageData;
}

describe("recognition", () => {
  it("recognizes a template-like digit", () => {
    const imageData = makeBinaryDigit([
      "01110",
      "10001",
      "10001",
      "01110",
      "10001",
      "10001",
      "01110",
    ]);

    expect(recognizeDigits(imageData)).toMatchObject({
      value: 8,
    });
  });

  it("preprocesses image data into binary output", () => {
    const imageData = new ImageData(new Uint8ClampedArray([0, 0, 0, 255, 250, 250, 250, 255]), 2, 1);
    const output = preprocessImageData(imageData);

    expect([...output.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("uses the yellow cooldown mask when enough yellow pixels exist", () => {
    const imageData = new ImageData(10, 10);
    for (let index = 0; index < imageData.data.length; index += 4) {
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = 255;
    }
    for (let pixel = 0; pixel < 3; pixel++) {
      const index = pixel * 4;
      imageData.data[index] = 245;
      imageData.data[index + 1] = 208;
      imageData.data[index + 2] = 55;
    }

    const output = preprocessImageData(imageData);

    expect(output.data[0]).toBe(255);
    expect(output.data[12]).toBe(0);
  });

  it("parses minute-second cooldown digits when there are three digits", () => {
    expect(recognizeDigits(makeBinaryDigits("110"))).toMatchObject({
      value: 70,
    });
  });

  it("keeps hollow Maple-style zeroes as one digit", () => {
    expect(recognizeDigits(makeMapleDigits("103"))).toMatchObject({
      value: 63,
      debug: { recognizedText: "103" },
    });
  });

  it("recognizes Maple-style minute-second samples", () => {
    expect(recognizeDigits(makeMapleDigits("122"))).toMatchObject({
      value: 82,
      debug: { recognizedText: "122" },
    });
  });

  it("treats values above the Maple timer display range as no recognition", () => {
    expect(recognizeDigits(makeMapleDigits("2302"))).toMatchObject({
      value: null,
      confidence: 0,
      debug: { recognizedText: "2302", reason: "out-of-range" },
    });
  });

  it("does not expand a separated 17 into 117", () => {
    expect(recognizeDigits(makeMapleDigits("17"))).toMatchObject({
      value: 17,
      debug: { recognizedText: "17" },
    });
  });

  it("does not read the reported cooldown digit 2 crop as 17", () => {
    expect(recognizeDigits(imageDataFromPngBase64(REPORTED_COOLDOWN_TWO_PROCESSED_PNG_BASE64))).toMatchObject({
      value: 2,
      debug: { recognizedText: "2" },
    });
  });

  it("caps confidence for ambiguous single high digits", () => {
    const result = recognizeDigits(makeBinaryDigit(TEMPLATE_ROWS["6"]));

    expect(result.value).toBe(6);
    expect(result.confidence).toBeLessThanOrEqual(0.53);
  });

  it("ignores lower command-key yellow UI fragments below the cooldown digits", () => {
    expect(recognizeDigits(addLowerCommandNoise(makeBinaryDigits("10")))).toMatchObject({
      value: 10,
      debug: { recognizedText: "10" },
    });
  });

  it("ignores Erda Fountain command and icon edge noise from the reported crop", () => {
    expect(recognizeDigits(makeErdaFountainCommandReportCrop())).toMatchObject({
      value: 22,
      debug: { recognizedText: "22" },
    });
  });

  it("falls back to a safe inset when a wide Erda Fountain crop exposes icon frame edges", () => {
    expect(recognizeDigits(imageDataFromPngBase64(REPORTED_ERDA_FOUNTAIN_EDGE_PROCESSED_PNG_BASE64))).toMatchObject({
      value: 27,
      debug: { recognizedText: "27", reason: "safe-inset-edge-fallback" },
    });
  });

  it("uses the safe inset for all wide Erda Fountain crop edge-noise combinations", () => {
    const base = imageDataFromPngBase64(REPORTED_ERDA_FOUNTAIN_EDGE_PROCESSED_PNG_BASE64);

    getNonEmptyEdgeCombinations().forEach((edges) => {
      const imageData = cloneImageData(base);
      clearRightEdge(imageData);
      edges.forEach((edge) => drawFrameEdge(imageData, edge));
      const result = recognizeDigits(imageData);

      expect(result, `edge combination: ${edges.join("+")}`).toMatchObject({
        value: 27,
        debug: { recognizedText: "27" },
      });
    });
  });

  it("ignores a wide skill icon frame when the crop includes surrounding UI", () => {
    expect(recognizeDigits(makeWideSkillIconCropWithCooldown("34"))).toMatchObject({
      value: 34,
      debug: { recognizedText: "34" },
    });
  });

  it("does not turn a frame-only oversized skill crop into a cooldown value", () => {
    const imageData = makeWideSkillIconCropWithCooldown("34");
    for (let y = 60; y < 100; y++) {
      for (let x = 40; x < 112; x++) {
        const index = (y * imageData.width + x) * 4;
        imageData.data[index] = 0;
        imageData.data[index + 1] = 0;
        imageData.data[index + 2] = 0;
      }
    }

    expect(recognizeDigits(imageData)).toMatchObject({
      value: null,
      debug: { reason: "no-foreground-components" },
    });
  });
});
