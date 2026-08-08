import { describe, expect, it } from "vitest";
import {
  dedupeExperienceOcrV2Candidates,
  formatExperienceOcrV2Reading,
  isExperienceOcrV2ParserBoundaryAlternative,
  isValidExperienceOcrV2Reading,
  rankExperienceOcrV2Candidates,
  scoreToExperienceOcrV2Confidence,
  type ExperienceOcrV2Candidate,
} from "./experienceOcrV2Candidates";

function candidate({
  numberDigits,
  percentDigits,
  score,
  weight = 1,
  source = "font:neutral",
  sequence = `${numberDigits}[${percentDigits}%]`,
}: {
  numberDigits: string;
  percentDigits: string;
  score: number;
  weight?: number;
  source?: string;
  sequence?: string;
}): ExperienceOcrV2Candidate {
  return {
    reading: { numberDigits, percentDigits },
    sequence,
    score,
    weight,
    source,
    mask: new Uint8Array(1),
    width: 1,
    height: 1,
  };
}

describe("experienceOcrV2Candidates", () => {
  it("formats readings and confidence values", () => {
    expect(formatExperienceOcrV2Reading({ numberDigits: "1234567890", percentDigits: "1234" })).toBe(
      "1,234,567,890 [1.234%]",
    );
    expect(formatExperienceOcrV2Reading({ numberDigits: "42", percentDigits: "90" })).toBe("42 [0.090%]");
    expect(scoreToExperienceOcrV2Confidence(-0.08)).toBe(1);
    expect(scoreToExperienceOcrV2Confidence(0.42)).toBe(0);
  });

  it("validates OCR readings before ranking", () => {
    expect(isValidExperienceOcrV2Reading({ numberDigits: "1", percentDigits: "0000" })).toBe(true);
    expect(isValidExperienceOcrV2Reading({ numberDigits: "", percentDigits: "0000" })).toBe(false);
    expect(isValidExperienceOcrV2Reading({ numberDigits: "1", percentDigits: "999" })).toBe(false);
    expect(isValidExperienceOcrV2Reading({ numberDigits: "1", percentDigits: "100001" })).toBe(false);
  });

  it("dedupes candidates by reading while keeping the best score", () => {
    const duplicateLowWeight = candidate({ numberDigits: "12345678", percentDigits: "1234", score: 0.1, weight: 1 });
    const duplicateHighWeight = candidate({ numberDigits: "12345678", percentDigits: "1234", score: 0.1, weight: 3 });
    const distinct = candidate({ numberDigits: "87654321", percentDigits: "4321", score: 0.2, weight: 1 });

    expect(dedupeExperienceOcrV2Candidates([distinct, duplicateLowWeight, duplicateHighWeight])).toEqual([
      duplicateHighWeight,
      distinct,
    ]);
  });

  it("accepts only plausible boundary-skip alternatives", () => {
    const normal = candidate({ numberDigits: "1234567890", percentDigits: "1234", score: 0.16 });
    const boundaryAlternative = candidate({
      numberDigits: "34567890",
      percentDigits: "01234",
      score: 0.2,
      source: "font_boundary_skip:repaint",
    });
    const weakAlternative = candidate({
      numberDigits: "34567890",
      percentDigits: "01234",
      score: 0.3,
      source: "font_boundary_skip:repaint",
    });

    expect(isExperienceOcrV2ParserBoundaryAlternative(normal, boundaryAlternative)).toBe(true);
    expect(isExperienceOcrV2ParserBoundaryAlternative(normal, weakAlternative)).toBe(false);
    expect(isExperienceOcrV2ParserBoundaryAlternative(normal, { ...boundaryAlternative, source: "font:neutral" })).toBe(
      false,
    );
  });

  it("adds a supported consensus candidate and filters repetitive readings", () => {
    const first = candidate({ numberDigits: "12345678", percentDigits: "01234", score: 0.2, weight: 1 });
    const second = candidate({
      numberDigits: "12345678",
      percentDigits: "01234",
      score: 0.22,
      weight: 1,
      source: "font:bright",
    });
    const repetitive = candidate({ numberDigits: "11111112", percentDigits: "01234", score: 0.01, weight: 4 });

    const ranked = rankExperienceOcrV2Candidates([first, second, repetitive], 4);

    expect(ranked[0]).toMatchObject({
      reading: { numberDigits: "12345678", percentDigits: "01234" },
      source: "consensus:2",
      sequence: "consensus",
    });
    expect(ranked.some((item) => item.reading.numberDigits === "11111112")).toBe(false);
  });
});
