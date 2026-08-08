export type AlertIssueReportPreflight = {
  kind: "one-row-buff-slots";
  description: string;
};

type ParserBox = {
  x?: number | null;
  y: number;
  row?: number | null;
  size?: number | null;
  side?: number | null;
  width?: number | null;
  height?: number | null;
};

const MIN_ONE_ROW_BUFF_SLOT_BOX_COUNT = 4;

export function createOneRowBuffSlotReportPreflight({
  boxCount,
  rowCount,
  boxes,
}: {
  boxCount?: number | null;
  rowCount?: number | null;
  boxes?: readonly ParserBox[] | null;
}): AlertIssueReportPreflight | null {
  if (!isOneRowBuffSlotParserResult({ boxCount, rowCount, boxes })) {
    return null;
  }

  return {
    kind: "one-row-buff-slots",
    description:
      "버프 아이콘이 한 줄로 길게 보이면 필요한 버프를 읽지 못할 수 있습니다. 게임 설정을 확인한 뒤 계속 제보해주세요.",
  };
}

export function isOneRowBuffSlotParserResult({
  boxCount,
  rowCount,
  boxes,
}: {
  boxCount?: number | null;
  rowCount?: number | null;
  boxes?: readonly ParserBox[] | null;
}): boolean {
  const effectiveBoxCount = boxCount ?? boxes?.length ?? 0;
  if (effectiveBoxCount < MIN_ONE_ROW_BUFF_SLOT_BOX_COUNT) {
    return false;
  }

  if (typeof rowCount === "number" && Number.isFinite(rowCount)) {
    return rowCount === 1;
  }

  if (!boxes?.length) {
    return false;
  }

  return countBuffSlotRows(boxes) === 1;
}

function countBuffSlotRows(boxes: readonly ParserBox[]): number {
  const explicitRows = boxes
    .map((box) => box.row)
    .filter((row): row is number => typeof row === "number" && Number.isFinite(row));
  if (explicitRows.length === boxes.length) {
    return new Set(explicitRows).size;
  }

  const rows: Array<{ y: number; size: number; count: number }> = [];
  for (const box of boxes) {
    const row = rows.find((candidate) => areBoxesOnSameRow(candidate, box));
    const size = getBoxSize(box);
    if (!row) {
      rows.push({ y: box.y, size, count: 1 });
      continue;
    }

    const nextCount = row.count + 1;
    row.y = (row.y * row.count + box.y) / nextCount;
    row.size = Math.max(row.size, size);
    row.count = nextCount;
  }

  return rows.length;
}

function areBoxesOnSameRow(row: { y: number; size: number }, box: ParserBox): boolean {
  const tolerance = Math.max(6, Math.max(row.size, getBoxSize(box)) * 0.48);
  return Math.abs(row.y - box.y) <= tolerance;
}

function getBoxSize(box: ParserBox): number {
  if (typeof box.size === "number" && Number.isFinite(box.size) && box.size > 0) {
    return box.size;
  }
  if (typeof box.side === "number" && Number.isFinite(box.side) && box.side > 0) {
    return box.side;
  }
  if (
    typeof box.width === "number" &&
    Number.isFinite(box.width) &&
    box.width > 0 &&
    typeof box.height === "number" &&
    Number.isFinite(box.height) &&
    box.height > 0
  ) {
    return Math.min(box.width, box.height);
  }
  return 32;
}
