import type { BuffIconBox } from "./types.js";

type BoxOrderFields = Pick<BuffIconBox, "x" | "y" | "size">;

/**
 * Compares boxes in the same order the MapleStory buff UI should be read:
 * top row first, then left to right inside each row.
 */
export function compareBuffIconBoxes(a: BoxOrderFields, b: BoxOrderFields) {
  return a.y - b.y || a.x - b.x || a.size - b.size;
}

/** Returns a new array sorted in stable game/UI order. */
export function orderBuffIconBoxes<T extends BoxOrderFields>(boxes: readonly T[]): T[] {
  const rows: Array<{ y: number; boxes: T[] }> = [];
  for (const box of [...boxes].sort(compareBuffIconBoxes)) {
    const tolerance = Math.max(5, box.size * 0.5);
    let row = rows.find((candidate) => Math.abs(candidate.y - box.y) <= tolerance);
    if (!row) {
      row = { y: box.y, boxes: [] };
      rows.push(row);
    }
    row.boxes.push(box);
    row.y = row.boxes.reduce((sum, item) => sum + item.y, 0) / row.boxes.length;
  }
  return rows
    .sort((a, b) => a.y - b.y)
    .flatMap((row) => row.boxes.sort((a, b) => a.x - b.x || a.y - b.y || a.size - b.size));
}
