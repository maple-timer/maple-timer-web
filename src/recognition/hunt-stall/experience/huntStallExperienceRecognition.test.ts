import { describe, expect, it } from "vitest";
import huntStallOcrV2ResearchSamples from "./__fixtures__/huntStallOcrV2ResearchSamples.json";
import huntStallRegressionSamples from "./__fixtures__/huntStallRegressionSamples.json";
import {
  getFingerprintDifference,
  normalizeExperienceTokens,
  preprocessExperienceImageData,
  recognizeExperienceDigitBitmap,
  readHuntStallReading,
  readHuntStallReadingFromImageData,
  type ExperienceToken,
} from "./huntStallExperienceRecognition";

type HuntStallRegressionSample = {
  name: string;
  width: number;
  height: number;
  expectedText: string;
  rgbaBase64: string;
};

const regressionSamples = huntStallRegressionSamples as HuntStallRegressionSample[];
const ocrV2ResearchSamples = huntStallOcrV2ResearchSamples as HuntStallRegressionSample[];
const readableRegressionSamples = regressionSamples.filter(
  (sample) => !sample.name.includes("yellow"),
);
const completeReadableRegressionSamples = readableRegressionSamples.filter(
  (sample) => !sample.expectedText.startsWith("--"),
);
const filledBarRegressionSamples = regressionSamples.filter((sample) =>
  sample.name.includes("yellow"),
);

function imageDataFromRgbaBase64(sample: HuntStallRegressionSample): ImageData {
  const binary = atob(sample.rgbaBase64);
  const data = new Uint8ClampedArray(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }

  return new ImageData(data, sample.width, sample.height);
}

function makeImage(width: number, height: number, points: Array<[number, number]> = []) {
  const imageData = new ImageData(width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 16;
    imageData.data[index + 1] = 18;
    imageData.data[index + 2] = 20;
    imageData.data[index + 3] = 255;
  }

  points.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    imageData.data[index] = 230;
    imageData.data[index + 1] = 230;
    imageData.data[index + 2] = 230;
  });

  return imageData;
}

function makeFilledImage(
  width: number,
  height: number,
  color: [number, number, number],
  points: Array<[number, number]> = [],
) {
  const imageData = new ImageData(width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = color[0];
    imageData.data[index + 1] = color[1];
    imageData.data[index + 2] = color[2];
    imageData.data[index + 3] = 255;
  }

  points.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    imageData.data[index] = 230;
    imageData.data[index + 1] = 230;
    imageData.data[index + 2] = 230;
  });

  return imageData;
}

function makeOutlinedFilledImage(
  width: number,
  height: number,
  fillColor: [number, number, number],
  textColor: [number, number, number],
  points: Array<[number, number]>,
) {
  const imageData = makeFilledImage(width, height, fillColor);

  points.forEach(([x, y]) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height || (dx === 0 && dy === 0)) {
          continue;
        }
        const index = (py * width + px) * 4;
        imageData.data[index] = 28;
        imageData.data[index + 1] = 28;
        imageData.data[index + 2] = 28;
      }
    }
  });

  points.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    imageData.data[index] = textColor[0];
    imageData.data[index + 1] = textColor[1];
    imageData.data[index + 2] = textColor[2];
  });

  return imageData;
}

function makeFilledImageWithText(
  width: number,
  height: number,
  fillColor: [number, number, number],
  textColor: [number, number, number],
  points: Array<[number, number]>,
) {
  const imageData = makeFilledImage(width, height, fillColor);

  points.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    imageData.data[index] = textColor[0];
    imageData.data[index + 1] = textColor[1];
    imageData.data[index + 2] = textColor[2];
  });

  return imageData;
}

function makeFilledImageWithTextAndStroke(
  width: number,
  height: number,
  fillColor: [number, number, number],
  textColor: [number, number, number],
  strokeColor: [number, number, number],
  points: Array<[number, number]>,
) {
  const imageData = makeFilledImage(width, height, fillColor);

  points.forEach(([x, y]) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height || (dx === 0 && dy === 0)) {
          continue;
        }
        const index = (py * width + px) * 4;
        imageData.data[index] = strokeColor[0];
        imageData.data[index + 1] = strokeColor[1];
        imageData.data[index + 2] = strokeColor[2];
      }
    }
  });

  points.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    imageData.data[index] = textColor[0];
    imageData.data[index + 1] = textColor[1];
    imageData.data[index + 2] = textColor[2];
  });

  return imageData;
}

function countMaskPixels(imageData: ImageData) {
  let count = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index] > 0) {
      count += 1;
    }
  }
  return count;
}

function makeExperienceTokens(text: string): ExperienceToken[] {
  let x = 0;
  return Array.from(text).flatMap((char) => {
    if (char === " ") {
      x += 3;
      return [];
    }

    const token: ExperienceToken = {
      text: char === "," || char === "." ? "separator" : char,
      confidence: 0.9,
      x,
      width: char === "," || char === "." ? 2 : 6,
    };
    x += token.width + 1;
    return [token];
  });
}

function widenPercentDigitSpacing(tokens: ExperienceToken[]): ExperienceToken[] {
  let isPercentBlock = false;
  let extra = 0;

  return tokens.map((token) => {
    if (token.text === "[") {
      isPercentBlock = true;
    }

    const widened = { ...token, x: token.x + extra };
    if (isPercentBlock && (/^\d$/.test(token.text) || token.text === "]")) {
      extra += 5;
    }

    return widened;
  });
}

describe("huntStall experience OCR", () => {
  it("creates stable fingerprints from bright text pixels", () => {
    const first = readHuntStallReading(
      preprocessExperienceImageData(makeImage(80, 20, [[10, 8], [11, 8], [10, 9], [11, 9]])),
    );
    const same = readHuntStallReading(
      preprocessExperienceImageData(makeImage(80, 20, [[10, 8], [11, 8], [10, 9], [11, 9]])),
    );
    const changed = readHuntStallReading(
      preprocessExperienceImageData(makeImage(80, 20, [[44, 8], [45, 8], [44, 9], [45, 9]])),
    );

    expect(getFingerprintDifference(first.fingerprint, same.fingerprint)).toBe(0);
    expect(getFingerprintDifference(first.fingerprint, changed.fingerprint)).toBeGreaterThan(0);
  });

  it("keeps outlined experience text and filters bright background noise", () => {
    const outlinedText = preprocessExperienceImageData(
      makeImage(80, 20, [[10, 8], [11, 8], [10, 9], [11, 9]]),
    );
    const brightBackgroundNoise = preprocessExperienceImageData(
      makeFilledImage(80, 20, [120, 122, 124], [[10, 8], [11, 8], [10, 9], [11, 9]]),
    );

    expect(countMaskPixels(outlinedText)).toBeGreaterThan(0);
    expect(countMaskPixels(brightBackgroundNoise)).toBe(0);
  });

  it("does not treat filled experience bar colors as text", () => {
    const yellowFill = preprocessExperienceImageData(makeFilledImage(80, 20, [205, 190, 42]));
    const greenFill = preprocessExperienceImageData(makeFilledImage(80, 20, [86, 184, 72]));
    const pinkFill = preprocessExperienceImageData(makeFilledImage(80, 20, [240, 144, 248]));

    expect(countMaskPixels(yellowFill)).toBe(0);
    expect(countMaskPixels(greenFill)).toBe(0);
    expect(countMaskPixels(pinkFill)).toBe(0);
  });

  it("keeps tinted experience text on filled yellow, green, or pink bars", () => {
    const points: Array<[number, number]> = [
      [10, 8],
      [11, 8],
      [12, 8],
      [10, 9],
      [12, 9],
      [10, 10],
      [11, 10],
      [12, 10],
    ];
    const yellowBarText = preprocessExperienceImageData(
      makeOutlinedFilledImage(80, 20, [205, 190, 42], [238, 228, 168], points),
    );
    const greenBarText = preprocessExperienceImageData(
      makeOutlinedFilledImage(80, 20, [86, 184, 72], [192, 240, 178], points),
    );
    const pinkBarText = preprocessExperienceImageData(
      makeOutlinedFilledImage(80, 20, [240, 144, 248], [248, 218, 248], points),
    );

    expect(countMaskPixels(yellowBarText)).toBeGreaterThan(0);
    expect(countMaskPixels(greenBarText)).toBeGreaterThan(0);
    expect(countMaskPixels(pinkBarText)).toBeGreaterThan(0);
  });

  it("keeps bright experience text on filled bars when the dark outline is weak", () => {
    const points: Array<[number, number]> = [
      [10, 8],
      [11, 8],
      [12, 8],
      [10, 9],
      [12, 9],
      [10, 10],
      [11, 10],
      [12, 10],
    ];
    const yellowBarText = preprocessExperienceImageData(
      makeFilledImageWithText(80, 20, [205, 190, 42], [238, 228, 168], points),
    );
    const greenBarText = preprocessExperienceImageData(
      makeFilledImageWithText(80, 20, [86, 184, 72], [192, 240, 178], points),
    );
    const pinkBarText = preprocessExperienceImageData(
      makeFilledImageWithText(80, 20, [240, 144, 248], [248, 218, 248], points),
    );

    expect(countMaskPixels(yellowBarText)).toBeGreaterThan(0);
    expect(countMaskPixels(greenBarText)).toBeGreaterThan(0);
    expect(countMaskPixels(pinkBarText)).toBeGreaterThan(0);
  });

  it("keeps filled-bar text strokes so partially filled bars do not lose digits", () => {
    const points: Array<[number, number]> = [
      [10, 8],
      [11, 8],
      [12, 8],
      [10, 9],
      [12, 9],
      [10, 10],
      [11, 10],
      [12, 10],
    ];
    const processed = preprocessExperienceImageData(
      makeFilledImageWithTextAndStroke(
        80,
        20,
        [215, 243, 1],
        [255, 255, 205],
        [103, 118, 0],
        points,
      ),
    );

    expect(countMaskPixels(processed)).toBeGreaterThan(points.length * 2);
  });

  it.each(readableRegressionSamples)(
    "recognizes reported experience sample $name",
    (sample) => {
      const reading = readHuntStallReading(
        preprocessExperienceImageData(imageDataFromRgbaBase64(sample)),
      );

      expect(reading.recognizedText).toBe(sample.expectedText);
      expect(reading.confidence).toBeGreaterThanOrEqual(0.62);
    },
  );

  it.each(filledBarRegressionSamples)(
    "does not accept unstable filled-bar experience sample $name as a valid reading",
    (sample) => {
      const reading = readHuntStallReading(
        preprocessExperienceImageData(imageDataFromRgbaBase64(sample)),
      );

      expect(reading.recognizedText).toBeNull();
    },
  );

  it.each(filledBarRegressionSamples)(
    "does not immediately trust unstable filled-bar experience sample $name with v2 OCR",
    (sample) => {
      const { reading } = readHuntStallReadingFromImageData(imageDataFromRgbaBase64(sample));

      expect(reading.recognizedText).toBeNull();
    },
  );

  it.each(completeReadableRegressionSamples)(
    "recognizes complete reported experience sample $name with v2 OCR",
    (sample) => {
      const { reading } = readHuntStallReadingFromImageData(imageDataFromRgbaBase64(sample));

      expect(reading.recognizedText).toBe(sample.expectedText);
      expect(reading.confidence).toBeGreaterThanOrEqual(0.55);
    },
  );

  it.each(ocrV2ResearchSamples)("recognizes external research sample $name with v2 OCR", (sample) => {
    const { reading } = readHuntStallReadingFromImageData(imageDataFromRgbaBase64(sample));

    expect(reading.recognizedText).toBe(sample.expectedText);
    expect(reading.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("normalizes experience text even when the percent glyph is missing", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("1,277,402,629,109 [8.279"))).toBe(
      "1,277,402,629,109 [8.279%]",
    );
  });

  it("ignores noisy glyph fragments after three percent decimal digits", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("1,277,780,223,709 [8.2827"))).toBe(
      "1,277,780,223,709 [8.282%]",
    );
  });

  it("supports two digit experience percent values", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("22,256,477,898,851 [18.682]"))).toBe(
      "22,256,477,898,851 [18.682%]",
    );
  });

  it("keeps normal decimal percent readings unchanged", () => {
    [
      "22,256,477,898,851 [0.001%]",
      "22,256,477,898,851 [5.682%]",
      "22,256,477,898,851 [10.000%]",
      "22,256,477,898,851 [56.827%]",
      "22,256,477,898,851 [99.999%]",
    ].forEach((text) => {
      expect(normalizeExperienceTokens(makeExperienceTokens(text))).toBe(text);
    });
  });

  it("restores a missing decimal point before the percent fraction", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("1,356,684,981,309 [9710%]"))).toBe(
      "1,356,684,981,309 [9.710%]",
    );
  });

  it("restores a missing decimal point for two digit percent values", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("22,256,477,898,851 [18682%]"))).toBe(
      "22,256,477,898,851 [18.682%]",
    );
  });

  it("ignores a low-confidence percent glyph misread as a compact percent digit", () => {
    const tokens = makeExperienceTokens("22,256,477,898,851 [56827]");
    const noisyPercentGlyphIndex = tokens.map((token) => token.text).lastIndexOf("7");
    tokens[noisyPercentGlyphIndex] = {
      ...tokens[noisyPercentGlyphIndex],
      confidence: 0.57,
      width: tokens[noisyPercentGlyphIndex].width + 4,
    };

    expect(normalizeExperienceTokens(tokens)).toBe("22,256,477,898,851 [5.682%]");
  });

  it("keeps genuine two digit compact percent values when all digits are reliable", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("22,256,477,898,851 [56827]"))).toBe(
      "22,256,477,898,851 [56.827%]",
    );
  });

  it("restores normal compact percent readings across the supported range", () => {
    [
      ["22,256,477,898,851 [0001%]", "22,256,477,898,851 [0.001%]"],
      ["22,256,477,898,851 [5682%]", "22,256,477,898,851 [5.682%]"],
      ["22,256,477,898,851 [10000%]", "22,256,477,898,851 [10.000%]"],
      ["22,256,477,898,851 [56827%]", "22,256,477,898,851 [56.827%]"],
      ["22,256,477,898,851 [99999%]", "22,256,477,898,851 [99.999%]"],
      ["22,256,477,898,851 [5682]", "22,256,477,898,851 [5.682%]"],
      ["22,256,477,898,851 [56827]", "22,256,477,898,851 [56.827%]"],
    ].forEach(([input, expected]) => {
      expect(normalizeExperienceTokens(makeExperienceTokens(input))).toBe(expected);
    });
  });

  it("keeps a weak compact percent digit when an explicit percent glyph follows", () => {
    const tokens = makeExperienceTokens("22,256,477,898,851 [56827%]");
    const finalPercentDigitIndex = tokens.map((token) => token.text).lastIndexOf("7");
    tokens[finalPercentDigitIndex] = {
      ...tokens[finalPercentDigitIndex],
      confidence: 0.57,
      width: tokens[finalPercentDigitIndex].width + 4,
    };

    expect(normalizeExperienceTokens(tokens)).toBe("22,256,477,898,851 [56.827%]");
  });

  it("restores a missing decimal point from compact debug OCR output", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("1.530.768.605.709[11120%]"))).toBe(
      "1,530,768,605,709 [11.120%]",
    );

    expect(normalizeExperienceTokens(makeExperienceTokens("1.529.635.821.909[11111%]"))).toBe(
      "1,529,635,821,909 [11.111%]",
    );
  });

  it("keeps parsing compact percent values when narrow digits have wider component gaps", () => {
    expect(
      normalizeExperienceTokens(
        widenPercentDigitSpacing(makeExperienceTokens("1.530.768.605.709[11120%]")),
      ),
    ).toBe("1,530,768,605,709 [11.120%]");
  });

  it("falls back to percent-only reading when filled-bar total digits are corrupted", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("4149.655.215[46441%]"))).toBe(
      "-- [46.441%]",
    );
  });

  it("treats bracket-shaped narrow ones as digits in experience values", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("].424.286.828.508[]0846%]"))).toBe(
      "1,424,286,828,508 [10.846%]",
    );
  });

  it("keeps parsing when the final experience group and percent bracket are noisy", () => {
    expect(normalizeExperienceTokens(makeExperienceTokens("].424.664.528.]08[]0848%]"))).toBe(
      "1,424,664,528,108 [10.848%]",
    );
  });

  it("recognizes experience-only digit shapes that generic cooldown OCR confuses", () => {
    const seven = [
      "110000001",
      "111111111",
      "000000011",
      "000000011",
      "000000011",
      "000000011",
      "000001110",
      "000001110",
      "000001110",
      "000011110",
      "000011000",
      "000011000",
      "000011000",
    ];
    const nine = [
      "001000110",
      "001111110",
      "110000011",
      "110000011",
      "110000011",
      "110000011",
      "001111111",
      "001111111",
      "000000011",
      "110000011",
      "110000011",
      "111111111",
      "001111110",
    ];

    expect(recognizeExperienceDigitBitmap(seven).text).toBe("7");
    expect(recognizeExperienceDigitBitmap(nine).text).toBe("9");
  });

  it("keeps blank bitmaps far below the experience digit acceptance threshold", () => {
    const blank = Array.from({ length: 13 }, () => "000000000");

    expect(recognizeExperienceDigitBitmap(blank).confidence).toBeLessThan(0.5);
  });

  it("recognizes thin high-resolution experience glyph variants from real samples", () => {
    const two = [
      "001111110",
      "001111110",
      "110000001",
      "110000001",
      "000000001",
      "000000001",
      "000000110",
      "000000110",
      "000011000",
      "000011000",
      "001100000",
      "001100000",
      "111111111",
    ];
    const three = [
      "001111110",
      "001111110",
      "110000001",
      "110000001",
      "000000001",
      "000000001",
      "000011110",
      "000011110",
      "000000001",
      "000000001",
      "110000001",
      "110000001",
      "001111110",
    ];
    const four = [
      "000000110",
      "000000110",
      "000011110",
      "000011110",
      "001100110",
      "001100110",
      "110000110",
      "110000110",
      "111111111",
      "111111111",
      "000000110",
      "000000110",
      "000000110",
    ];
    const five = [
      "111111111",
      "111111111",
      "110000000",
      "110000000",
      "110000000",
      "110000000",
      "001111110",
      "001111110",
      "000000001",
      "000000001",
      "110000001",
      "110000001",
      "001111110",
    ];
    const six = [
      "001111110",
      "001111110",
      "110000001",
      "110000001",
      "110000000",
      "110000000",
      "111111110",
      "111111110",
      "110000001",
      "110000001",
      "110000001",
      "110000001",
      "001111110",
    ];
    const seven = [
      "111111111",
      "111111111",
      "000000001",
      "000000001",
      "000000001",
      "000000001",
      "000000110",
      "000000110",
      "000000110",
      "000000110",
      "000011000",
      "000011000",
      "000011000",
    ];
    const eight = [
      "001111110",
      "001111110",
      "110000001",
      "110000001",
      "110000001",
      "110000001",
      "001111110",
      "001111110",
      "110000001",
      "110000001",
      "110000001",
      "110000001",
      "001111110",
    ];
    const nine = [
      "001111110",
      "001111110",
      "110000001",
      "110000001",
      "110000001",
      "110000001",
      "001111111",
      "001111111",
      "000000001",
      "000000001",
      "110000001",
      "110000001",
      "001111110",
    ];

    expect(recognizeExperienceDigitBitmap(two).text).toBe("2");
    expect(recognizeExperienceDigitBitmap(three).text).toBe("3");
    expect(recognizeExperienceDigitBitmap(four).text).toBe("4");
    expect(recognizeExperienceDigitBitmap(five).text).toBe("5");
    expect(recognizeExperienceDigitBitmap(six).text).toBe("6");
    expect(recognizeExperienceDigitBitmap(seven).text).toBe("7");
    expect(recognizeExperienceDigitBitmap(eight).text).toBe("8");
    expect(recognizeExperienceDigitBitmap(nine).text).toBe("9");
  });


});
