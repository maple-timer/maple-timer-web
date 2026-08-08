import { describe, expect, it } from "vitest";
import { localizeBuffSlotCluster } from "./buffSlotClusterLocalization";

describe("localizeBuffSlotCluster", () => {
  it("keeps a contiguous top-right buff-slot grid", () => {
    const boxes = [
      ...makeRow({ y: 3, right: 1916, size: 46, count: 9 }),
      ...makeRow({ y: 56, right: 1916, size: 45, count: 13 }),
      ...makeRow({ y: 101, right: 1916, size: 45, count: 4 }),
      ...makeRow({ y: 153, right: 1916, size: 45, count: 9 }),
      ...makeRow({ y: 205, right: 1916, size: 45, count: 1 }),
    ];

    const result = localizeBuffSlotCluster(boxes, {
      width: 1920,
      height: 1080,
    });

    expect(result).toMatchObject({
      status: "selected",
      reason: "source-edge-anchor",
      parserBoxCount: 36,
      parserRowCount: 5,
      selectedRowCount: 5,
    });
    expect(result.selectedBoxIndexes).toHaveLength(36);
    expect(result.rejectedBoxIndexes).toEqual([]);
  });

  it.each([
    {
      reportId: "fb7050f9-00e0-44d3-b922-ce1ce96c37f5",
      rows: [
        { y: 3, right: 1888, size: 46, count: 8 },
        { y: 56, right: 1888, size: 46, count: 13 },
        { y: 108, right: 1888, size: 45, count: 7 },
        { y: 500, right: 1372, size: 45, count: 3 },
      ],
      selectedRowCount: 3,
      selectedBoxCount: 28,
    },
    {
      reportId: "8bbd563f-6cd5-4634-a60e-f0afe2e8e37d",
      rows: [
        { y: 3, right: 1888, size: 46, count: 8 },
        { y: 56, right: 1888, size: 45, count: 12 },
        { y: 343, right: 1384, size: 45, count: 3 },
        { y: 388, right: 1295, size: 46, count: 1 },
        { y: 434, right: 1339, size: 45, count: 2 },
      ],
      selectedRowCount: 2,
      selectedBoxCount: 20,
    },
    {
      reportId: "6b3036c5-3cad-43f6-b002-1c807549fd2d",
      rows: [
        { y: 3, right: 1888, size: 46, count: 12 },
        { y: 56, right: 1888, size: 45, count: 12 },
        { y: 343, right: 1384, size: 45, count: 3 },
        { y: 387, right: 1295, size: 47, count: 1 },
        { y: 434, right: 1339, size: 45, count: 2 },
      ],
      selectedRowCount: 2,
      selectedBoxCount: 24,
    },
    {
      reportId: "6d1d6484-84b3-4409-8ced-df2553e5e703",
      rows: [
        { y: 3, right: 1888, size: 46, count: 7 },
        { y: 56, right: 1888, size: 45, count: 13 },
        { y: 108, right: 1888, size: 45, count: 7 },
        { y: 343, right: 1384, size: 45, count: 3 },
        { y: 387, right: 1295, size: 47, count: 1 },
        { y: 434, right: 1340, size: 45, count: 2 },
      ],
      selectedRowCount: 3,
      selectedBoxCount: 27,
    },
  ])(
    "separates detached favorite UI for report $reportId",
    ({ rows, selectedRowCount, selectedBoxCount }) => {
      const boxes = rows.flatMap(makeRow);
      const result = localizeBuffSlotCluster(boxes, {
        width: 1920,
        height: 1080,
      });

      expect(result.status).toBe("selected");
      expect(result.selectedRowCount).toBe(selectedRowCount);
      expect(result.selectedBoxIndexes).toHaveLength(selectedBoxCount);
      expect(result.rejectedBoxIndexes).toHaveLength(
        boxes.length - selectedBoxCount,
      );
    },
  );

  it("can infer a stable top rail when the game viewport is offset from the source edge", () => {
    const boxes = [
      ...makeRow({ y: 40, right: 1500, size: 40, count: 6 }),
      ...makeRow({ y: 86, right: 1500, size: 40, count: 4 }),
      ...makeRow({ y: 300, right: 1700, size: 40, count: 8 }),
    ];

    const result = localizeBuffSlotCluster(boxes, {
      width: 1920,
      height: 1080,
    });

    expect(result).toMatchObject({
      status: "selected",
      reason: "inferred-top-rail",
      selectedRowCount: 2,
    });
    expect(result.selectedBoxIndexes).toHaveLength(10);
  });

  it("does not promote a lone unanchored square into a buff-slot cluster", () => {
    const result = localizeBuffSlotCluster(
      [{ x: 300, y: 200, size: 40 }],
      { width: 1920, height: 1080 },
    );

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "anchor-not-found",
      selectedBoxIndexes: [],
      rejectedBoxIndexes: [0],
    });
  });

  it("returns an empty selection when the parser found no boxes", () => {
    expect(localizeBuffSlotCluster([], { width: 1920, height: 1080 })).toMatchObject({
      status: "empty",
      parserBoxCount: 0,
      selectedBoxIndexes: [],
    });
  });
});

function makeRow({
  y,
  right,
  size,
  count,
}: {
  y: number;
  right: number;
  size: number;
  count: number;
}) {
  return Array.from({ length: count }, (_, index) => ({
    x: right - size * (count - index),
    y,
    size,
  }));
}
