import { overlapRatio } from "../geometry.js?v=row-detector-v3-20260524";

export function nonMaxSuppressSpatial(boxes, overlapLimit, side) {
  if (boxes.length <= 1) return boxes;
  const cellSize = Math.max(1, side);
  const kept = [];
  const buckets = new Map();
  const sorted = [...boxes].sort((a, b) => b.score - a.score);

  for (const box of sorted) {
    const cellX = Math.floor(box.x / cellSize);
    const cellY = Math.floor(box.y / cellSize);
    let overlaps = false;

    for (let y = cellY - 1; y <= cellY + 1 && !overlaps; y += 1) {
      for (let x = cellX - 1; x <= cellX + 1 && !overlaps; x += 1) {
        const bucket = buckets.get(bucketKey(x, y));
        if (!bucket) continue;
        for (let index = 0; index < bucket.length; index += 1) {
          if (overlapRatio(box, bucket[index]) > overlapLimit) {
            overlaps = true;
            break;
          }
        }
      }
    }

    if (overlaps) continue;
    kept.push(box);
    const key = bucketKey(cellX, cellY);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(box);
    } else {
      buckets.set(key, [box]);
    }
  }

  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

function bucketKey(x, y) {
  return y * 65536 + x;
}
