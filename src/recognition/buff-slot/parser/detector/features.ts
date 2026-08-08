import type { FeatureMaps, ImageLike, Rect } from "../types.js";
import { clampInt, integral } from "./math.js";

export function buildFeatureMaps(image: ImageLike, roi: Rect): FeatureMaps {
  const width = roi.width;
  const height = roi.height;
  const edge = new Float32Array(width * height);
  const gradX = new Float32Array(width * height);
  const gradY = new Float32Array(width * height);
  const sat = new Float32Array(width * height);
  const dark = new Float32Array(width * height);
  const bright = new Float32Array(width * height);

  const data = image.data;
  const fullW = image.width;
  const fullH = image.height;
  const x0 = clampInt(roi.x, 0, fullW - 1);
  const y0 = clampInt(roi.y, 0, fullH - 1);

  for (let y = 0; y < height; y++) {
    const fy = y0 + y;
    for (let x = 0; x < width; x++) {
      const fx = x0 + x;
      const i = (fy * fullW + fx) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = (r * 299 + g * 587 + b * 114) / 1000;
      sat[y * width + x] = max - min;
      dark[y * width + x] = luma < 78 ? 1 : 0;
      bright[y * width + x] = luma > 148 ? 1 : 0;

      if (fx <= 0 || fy <= 0 || fx >= fullW - 1 || fy >= fullH - 1) continue;
      const li = (fy * fullW + fx - 1) * 4;
      const ri = (fy * fullW + fx + 1) * 4;
      const ui = ((fy - 1) * fullW + fx) * 4;
      const di = ((fy + 1) * fullW + fx) * 4;
      const gx =
        Math.abs((data[li] ?? 0) - (data[ri] ?? 0)) +
        Math.abs((data[li + 1] ?? 0) - (data[ri + 1] ?? 0)) +
        Math.abs((data[li + 2] ?? 0) - (data[ri + 2] ?? 0));
      const gy =
        Math.abs((data[ui] ?? 0) - (data[di] ?? 0)) +
        Math.abs((data[ui + 1] ?? 0) - (data[di + 1] ?? 0)) +
        Math.abs((data[ui + 2] ?? 0) - (data[di + 2] ?? 0));
      gradX[y * width + x] = Math.min(255, gx);
      gradY[y * width + x] = Math.min(255, gy);
      edge[y * width + x] = Math.min(255, gx + gy);
    }
  }

  return {
    width,
    height,
    edge,
    gradX,
    gradY,
    sat,
    dark,
    bright,
    edgeI: integral(edge, width, height),
    gradXI: integral(gradX, width, height),
    gradYI: integral(gradY, width, height),
    satI: integral(sat, width, height),
    darkI: integral(dark, width, height),
    brightI: integral(bright, width, height),
  };
}
