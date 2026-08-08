export function integral(src: Float32Array, width: number, height: number) {
  const integralWidth = width + 1;
  const out = new Float32Array(integralWidth * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += src[y * width + x] ?? 0;
      out[(y + 1) * integralWidth + (x + 1)] = (out[y * integralWidth + (x + 1)] ?? 0) + row;
    }
  }
  return out;
}

export function rectSum(integralImage: Float32Array, sourceWidth: number, x: number, y: number, width: number, height: number) {
  const integralWidth = sourceWidth + 1;
  const x2 = x + width;
  const y2 = y + height;
  return (
    (integralImage[y2 * integralWidth + x2] ?? 0) -
    (integralImage[y * integralWidth + x2] ?? 0) -
    (integralImage[y2 * integralWidth + x] ?? 0) +
    (integralImage[y * integralWidth + x] ?? 0)
  );
}

export function avg(integralImage: Float32Array, sourceWidth: number, x: number, y: number, width: number, height: number) {
  return rectSum(integralImage, sourceWidth, x, y, width, height) / Math.max(1, width * height);
}

export function nms<T extends { x: number; y: number; size: number; score: number }>(items: T[], iouThreshold: number): T[] {
  const selected: T[] = [];
  for (const item of items.sort((a, b) => b.score - a.score)) {
    if (selected.some((other) => iou(item, other) > iouThreshold)) continue;
    selected.push(item);
  }
  return selected;
}

export function iou(a: { x: number; y: number; size: number }, b: { x: number; y: number; size: number }) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.size, b.x + b.size);
  const y2 = Math.min(a.y + a.size, b.y + b.size);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const intersection = width * height;
  const union = a.size * a.size + b.size * b.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

export function clusterValues(values: number[], tolerance: number) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const value of sorted) {
    const cluster = clusters[clusters.length - 1];
    if (!cluster || Math.abs(value - median(cluster)) > tolerance) clusters.push([value]);
    else cluster.push(value);
  }
  return clusters.map((cluster) => Math.round(median(cluster)));
}

export function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mean(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function clampInt(value: number, min: number, max: number) {
  return Math.floor(clamp(value, min, max));
}
