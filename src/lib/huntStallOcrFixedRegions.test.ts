import { describe, expect, it } from "vitest";
import { getFixedWideCandidates } from "./huntStallOcrFixedRegions";

describe("getFixedWideCandidates", () => {
  it("returns measured candidate rows for an exact supported capture size", () => {
    const candidates = getFixedWideCandidates(1368, 807);

    expect(candidates.map((candidate) => candidate.label)).toEqual([
      "fixed-y-wide 1368x807 #4",
      "fixed-y-wide 1368x807 #5",
      "fixed-y-wide 1368x807 #6",
    ]);
    expect(candidates[0].relativeRegion.x).toBe(0.33);
    expect(candidates[0].relativeRegion.y).toBeCloseTo(797 / 807, 12);
    expect(candidates[0].relativeRegion.width).toBe(0.34);
    expect(candidates[0].relativeRegion.height).toBeCloseTo(7 / 807, 12);
  });

  it("preserves measured pixels for near-identical capture heights", () => {
    const [candidate] = getFixedWideCandidates(1368, 808);

    expect(candidate.relativeRegion.y).toBeCloseTo(797 / 808, 12);
    expect(candidate.relativeRegion.height).toBeCloseTo(7 / 808, 12);
  });

  it("rescales measured rows when the capture is within tolerance but not near-identical", () => {
    const [candidate] = getFixedWideCandidates(1368, 860);

    expect(candidate.relativeRegion.y).toBeCloseTo(Math.round((797 / 807) * 860) / 860, 12);
    expect(candidate.relativeRegion.height).toBeCloseTo(Math.round((7 / 807) * 860) / 860, 12);
  });

  it("uses tolerance to choose the matching preset family", () => {
    const labels = getFixedWideCandidates(1920, 1200).map((candidate) => candidate.label);

    expect(labels).toEqual([
      "fixed-y-wide 1922x1239 #10",
      "fixed-y-wide 1920x1200 #11",
      "fixed-y-wide 1922x1239 #12",
    ]);
  });

  it("returns no candidates for unsupported capture sizes", () => {
    expect(getFixedWideCandidates(1600, 900)).toEqual([]);
  });
});
