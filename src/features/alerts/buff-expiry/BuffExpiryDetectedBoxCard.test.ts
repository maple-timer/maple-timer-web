import { describe, expect, it } from "vitest";
import type { BuffExpiryDetectedBoxView } from "./buffExpiryPrecisionTargetSlots";
import { getDetectedBoxLayout } from "./BuffExpiryDetectedBoxCard";

function createDetectedBoxView(
  x: number,
  y: number,
  row?: number,
  col?: number,
): BuffExpiryDetectedBoxView {
  return {
    box: {
      x,
      y,
      width: 32,
      height: 32,
      confidence: 0.9,
      ...(typeof row === "number" ? { row } : {}),
      ...(typeof col === "number" ? { col } : {}),
    },
    acceptedMatch: null,
    rejectedMatch: null,
    track: null,
    pendingTrack: null,
  };
}

describe("getDetectedBoxLayout", () => {
  it("returns an empty one-column layout when no boxes are present", () => {
    expect(getDetectedBoxLayout([])).toEqual({
      columnCount: 1,
      rows: [],
    });
  });

  it("uses provided row and column metadata when every box has it", () => {
    const layout = getDetectedBoxLayout([
      createDetectedBoxView(200, 40, 1, 2),
      createDetectedBoxView(100, 20, 0, 0),
      createDetectedBoxView(140, 20, 0, 1),
    ]);

    expect(layout.columnCount).toBe(3);
    expect(layout.rows.map((row) => row.key)).toEqual(["row:0", "row:1"]);
    expect(layout.rows[0]?.items.map((item) => item.colIndex)).toEqual([0, 1]);
    expect(layout.rows[1]?.items.map((item) => item.colIndex)).toEqual([2]);
  });

  it("falls back to coordinate grouping when parser layout metadata is missing", () => {
    const layout = getDetectedBoxLayout([
      createDetectedBoxView(141, 21),
      createDetectedBoxView(100, 20),
      createDetectedBoxView(101, 59),
      createDetectedBoxView(140, 60),
    ]);

    expect(layout.columnCount).toBe(2);
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows[0]?.items.map((item) => item.colIndex)).toEqual([0, 1]);
    expect(layout.rows[1]?.items.map((item) => item.colIndex)).toEqual([0, 1]);
  });
});
