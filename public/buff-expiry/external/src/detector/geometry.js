export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function overlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const intersection = width * height;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller ? intersection / smaller : 0;
}

export function nonMaxSuppress(boxes, overlapLimit = 0.45) {
  const kept = [];
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  for (const box of sorted) {
    if (!kept.some((other) => overlapRatio(box, other) > overlapLimit)) {
      kept.push(box);
    }
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function groupByNear(values, tolerance, key = (item) => item) {
  const groups = [];
  const sorted = [...values].sort((a, b) => key(a) - key(b));
  for (const item of sorted) {
    const value = key(item);
    const group = groups.find((entry) => Math.abs(entry.center - value) <= tolerance);
    if (group) {
      group.items.push(item);
      group.center = median(group.items.map(key));
    } else {
      groups.push({ center: value, items: [item] });
    }
  }
  return groups;
}
