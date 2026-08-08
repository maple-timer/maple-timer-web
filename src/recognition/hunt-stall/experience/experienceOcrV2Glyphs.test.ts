import { describe, expect, it } from "vitest";
import {
  debugExperienceOcrV2Segment,
  formatExperienceOcrV2GlyphLabel,
  getExperienceOcrV2BoundaryNoiseCost,
  getExperienceOcrV2SegmentCosts,
  parseExperienceOcrV2DigitSeparators,
  type ExperienceOcrV2Class,
  type ExperienceOcrV2CostRow,
  type ExperienceOcrV2Segment,
} from "./experienceOcrV2Glyphs";

const CLASSES: ExperienceOcrV2Class[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "sep", "[", "]", "%"];

function costRow(best: ExperienceOcrV2Class, cost = 0): ExperienceOcrV2CostRow {
  const row = {} as ExperienceOcrV2CostRow;
  for (const label of CLASSES) {
    row[label] = 9;
  }
  row[best] = cost;
  return row;
}

function segmentFromPattern(lines: string[]): ExperienceOcrV2Segment {
  const height = lines.length;
  const width = lines[0].length;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = lines[y][x] === "#" ? 1 : 0;
    }
  }
  return { mask, width, height, x0: 0, x1: width, lineHeight: height };
}

describe("experienceOcrV2Glyphs", () => {
  it("formats OCR glyph labels for parser sequences", () => {
    expect(formatExperienceOcrV2GlyphLabel("sep")).toBe(".");
    expect(formatExperienceOcrV2GlyphLabel("8")).toBe("8");
  });

  it("parses digit and separator rows for number and percent sections", () => {
    const number = parseExperienceOcrV2DigitSeparators(
      [costRow("1"), costRow("2"), costRow("3"), costRow("sep"), costRow("4"), costRow("5"), costRow("6")],
      "number",
    );
    const percent = parseExperienceOcrV2DigitSeparators(
      [costRow("0"), costRow("1"), costRow("sep"), costRow("2"), costRow("3"), costRow("4")],
      "percent",
    );

    expect(number).toMatchObject({ digits: "123456", labels: ["1", "2", "3", "sep", "4", "5", "6"] });
    expect(percent).toMatchObject({ digits: "01234", labels: ["0", "1", "sep", "2", "3", "4"] });
  });

  it("penalizes only plausible boundary noise candidates", () => {
    expect(getExperienceOcrV2BoundaryNoiseCost({ ...costRow("0", 9), sep: 0.1, "1": 0.5, "[": 0.5, "]": 0.5 })).toBe(
      0.18,
    );
    expect(getExperienceOcrV2BoundaryNoiseCost({ ...costRow("0", 9), sep: 0.9, "1": 0.9, "[": 0.9, "]": 0.9 })).toBe(
      0.42,
    );
  });

  it("scores and debugs segment glyphs with sorted class candidates", () => {
    const segment = segmentFromPattern([".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."]);
    const costs = getExperienceOcrV2SegmentCosts(segment);
    const debug = debugExperienceOcrV2Segment(segment, 3);

    expect(costs["8"]).toBeLessThan(costs["1"]);
    expect(debug).toMatchObject({
      index: 3,
      x0: 0,
      x1: 5,
      width: 5,
      height: 7,
      activePixels: 17,
    });
    expect(debug.topClasses[0].label).toBe("8");
    expect(Array.from(debug.imageData.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });
});
