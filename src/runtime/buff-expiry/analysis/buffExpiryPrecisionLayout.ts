export type BuffExpiryPrecisionLayoutBox = {
  x: number;
  y: number;
  size: number;
};

export type BuffExpiryPrecisionLayoutBoxWithPosition<T extends BuffExpiryPrecisionLayoutBox> = T & {
  row: number;
  col: number;
};

export function assignBuffExpiryPrecisionBoxLayout<T extends BuffExpiryPrecisionLayoutBox>(
  boxes: T[],
): Array<BuffExpiryPrecisionLayoutBoxWithPosition<T>> {
  if (!boxes.length) {
    return [];
  }

  const rowGroups = groupBoxesByAxis(boxes, "y", 0.42);
  const colGroups = groupBoxesByAxis(boxes, "x", 0.28);

  return boxes.map((box) => ({
    ...box,
    row: findGroupIndex(rowGroups, box.y),
    col: findGroupIndex(colGroups, box.x),
  }));
}

function groupBoxesByAxis<T extends BuffExpiryPrecisionLayoutBox>(
  boxes: T[],
  axis: "x" | "y",
  toleranceRatio: number,
): Array<{ value: number; boxes: T[] }> {
  const sizes = boxes.map((box) => box.size).filter((size) => size > 0);
  const size = median(sizes.length ? sizes : [32]);
  const tolerance = Math.max(3, size * toleranceRatio);
  const groups: Array<{ value: number; boxes: T[] }> = [];

  for (const box of [...boxes].sort((a, b) => a[axis] - b[axis])) {
    const group = groups.find((candidate) => Math.abs(candidate.value - box[axis]) <= tolerance);
    if (group) {
      group.boxes.push(box);
      group.value = Math.round(median(group.boxes.map((entry) => entry[axis])));
    } else {
      groups.push({ value: Math.round(box[axis]), boxes: [box] });
    }
  }

  return groups.sort((a, b) => a.value - b.value);
}

function findGroupIndex(groups: Array<{ value: number }>, value: number): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < groups.length; index += 1) {
    const distance = Math.abs(groups[index]!.value - value);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}
