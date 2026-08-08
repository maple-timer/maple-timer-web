export const BUFF_SLOT_CLUSTER_LOCALIZER_VERSION =
  "buff-slot-cluster-localizer-v1";

export type BuffSlotClusterBox = {
  x: number;
  y: number;
  size: number;
};

export type BuffSlotClusterSourceSize = {
  width: number;
  height: number;
};

export type BuffSlotClusterLocalizationStatus =
  | "empty"
  | "selected"
  | "unavailable";

export type BuffSlotClusterLocalization = {
  version: typeof BUFF_SLOT_CLUSTER_LOCALIZER_VERSION;
  status: BuffSlotClusterLocalizationStatus;
  reason: "no-boxes" | "source-edge-anchor" | "inferred-top-rail" | "anchor-not-found";
  parserBoxCount: number;
  parserRowCount: number;
  selectedBoxIndexes: number[];
  rejectedBoxIndexes: number[];
  selectedRowCount: number;
};

type IndexedBox<T extends BuffSlotClusterBox> = {
  box: T;
  index: number;
};

type BoxRow<T extends BuffSlotClusterBox> = {
  y: number;
  size: number;
  right: number;
  boxes: Array<IndexedBox<T>>;
};

const ROW_GROUP_TOLERANCE_RATIO = 0.42;
const TOP_EDGE_GAP_RATIO = 3;
const SOURCE_RIGHT_GAP_RATIO = 3.5;
const ROW_RIGHT_RAIL_DRIFT_RATIO = 2.25;
const CONTIGUOUS_ROW_GAP_RATIO = 1.75;
const MIN_SIZE_RATIO = 0.65;
const MAX_SIZE_RATIO = 1.55;

export function localizeBuffSlotCluster<T extends BuffSlotClusterBox>(
  boxes: readonly T[],
  sourceSize?: BuffSlotClusterSourceSize | null,
): BuffSlotClusterLocalization {
  if (!boxes.length) {
    return createEmptyLocalization();
  }

  const indexedBoxes = boxes.flatMap((box, index) =>
    isValidBox(box) ? [{ box, index }] : [],
  );
  if (!indexedBoxes.length) {
    return createUnavailableLocalization(boxes.length, 0);
  }

  const rows = groupBoxesIntoRows(indexedBoxes);
  const medianSize = median(indexedBoxes.map(({ box }) => box.size));
  const topEdgeLimit = Math.max(8, medianSize * TOP_EDGE_GAP_RATIO);
  const sourceWidth =
    sourceSize && Number.isFinite(sourceSize.width) && sourceSize.width > 0
      ? sourceSize.width
      : null;

  const sourceAnchor = rows.find(
    (row) =>
      row.y <= topEdgeLimit &&
      sourceWidth !== null &&
      sourceWidth - row.right <=
        Math.max(8, row.size * SOURCE_RIGHT_GAP_RATIO),
  );
  const inferredAnchor =
    sourceAnchor ??
    rows.find(
      (row, rowIndex) =>
        row.y <= topEdgeLimit &&
        (row.boxes.length >= 2 ||
          hasAlignedFollowingRow(rows, rowIndex, row)),
    );
  if (!inferredAnchor) {
    return createUnavailableLocalization(boxes.length, rows.length);
  }

  const anchorIndex = rows.indexOf(inferredAnchor);
  const selectedRows: Array<BoxRow<T>> = [inferredAnchor];
  let previousRow = inferredAnchor;
  for (let rowIndex = anchorIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (!isContiguousBuffSlotRow(row, previousRow, inferredAnchor)) {
      break;
    }
    selectedRows.push(row);
    previousRow = row;
  }

  const selectedBoxIndexes = selectedRows
    .flatMap((row) => row.boxes.map(({ index }) => index))
    .sort((left, right) => left - right);
  const selectedIndexSet = new Set(selectedBoxIndexes);
  const rejectedBoxIndexes = boxes
    .map((_, index) => index)
    .filter((index) => !selectedIndexSet.has(index));

  return {
    version: BUFF_SLOT_CLUSTER_LOCALIZER_VERSION,
    status: "selected",
    reason: sourceAnchor ? "source-edge-anchor" : "inferred-top-rail",
    parserBoxCount: boxes.length,
    parserRowCount: rows.length,
    selectedBoxIndexes,
    rejectedBoxIndexes,
    selectedRowCount: selectedRows.length,
  };
}

function groupBoxesIntoRows<T extends BuffSlotClusterBox>(
  boxes: Array<IndexedBox<T>>,
): Array<BoxRow<T>> {
  const rows: Array<BoxRow<T>> = [];
  for (const entry of [...boxes].sort(
    (left, right) =>
      left.box.y - right.box.y || left.box.x - right.box.x,
  )) {
    const row = rows.find((candidate) =>
      areBoxesOnSameRow(candidate, entry.box),
    );
    if (!row) {
      rows.push({
        y: entry.box.y,
        size: entry.box.size,
        right: entry.box.x + entry.box.size,
        boxes: [entry],
      });
      continue;
    }
    row.boxes.push(entry);
    row.y = median(row.boxes.map(({ box }) => box.y));
    row.size = median(row.boxes.map(({ box }) => box.size));
    row.right = Math.max(
      ...row.boxes.map(({ box }) => box.x + box.size),
    );
  }
  return rows.sort((left, right) => left.y - right.y);
}

function areBoxesOnSameRow(
  row: Pick<BoxRow<BuffSlotClusterBox>, "y" | "size">,
  box: BuffSlotClusterBox,
): boolean {
  const tolerance = Math.max(
    3,
    Math.max(row.size, box.size) * ROW_GROUP_TOLERANCE_RATIO,
  );
  return Math.abs(row.y - box.y) <= tolerance;
}

function hasAlignedFollowingRow<T extends BuffSlotClusterBox>(
  rows: Array<BoxRow<T>>,
  rowIndex: number,
  anchor: BoxRow<T>,
): boolean {
  const nextRow = rows[rowIndex + 1];
  return nextRow ? isContiguousBuffSlotRow(nextRow, anchor, anchor) : false;
}

function isContiguousBuffSlotRow<T extends BuffSlotClusterBox>(
  row: BoxRow<T>,
  previousRow: BoxRow<T>,
  anchorRow: BoxRow<T>,
): boolean {
  const referenceSize = Math.max(row.size, previousRow.size, anchorRow.size);
  const rowGap = row.y - previousRow.y;
  const sizeRatio = row.size / Math.max(1, anchorRow.size);
  return (
    rowGap > 0 &&
    rowGap <= Math.max(8, referenceSize * CONTIGUOUS_ROW_GAP_RATIO) &&
    Math.abs(row.right - anchorRow.right) <=
      Math.max(8, referenceSize * ROW_RIGHT_RAIL_DRIFT_RATIO) &&
    sizeRatio >= MIN_SIZE_RATIO &&
    sizeRatio <= MAX_SIZE_RATIO
  );
}

function isValidBox(box: BuffSlotClusterBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.size) &&
    box.size > 0
  );
}

function createEmptyLocalization(): BuffSlotClusterLocalization {
  return {
    version: BUFF_SLOT_CLUSTER_LOCALIZER_VERSION,
    status: "empty",
    reason: "no-boxes",
    parserBoxCount: 0,
    parserRowCount: 0,
    selectedBoxIndexes: [],
    rejectedBoxIndexes: [],
    selectedRowCount: 0,
  };
}

function createUnavailableLocalization(
  parserBoxCount: number,
  parserRowCount: number,
): BuffSlotClusterLocalization {
  return {
    version: BUFF_SLOT_CLUSTER_LOCALIZER_VERSION,
    status: "unavailable",
    reason: "anchor-not-found",
    parserBoxCount,
    parserRowCount,
    selectedBoxIndexes: [],
    rejectedBoxIndexes: Array.from(
      { length: parserBoxCount },
      (_, index) => index,
    ),
    selectedRowCount: 0,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
